'use server';

/**
 * Server Action cho quản trị người dùng và phân quyền (§3, §4).
 *
 * Ba quy tắc được áp dụng nhất quán ở mọi hành động trong file này:
 *
 *   1. Kiểm quyền TRƯỚC khi làm bất cứ việc gì (`requirePermission`).
 *   2. Ghi Audit Log Before/After cho mọi thay đổi (§20).
 *   3. Thu hồi phiên của người bị ảnh hưởng khi quyền hoặc trạng thái đổi —
 *      nếu không, người vừa bị rút quyền vẫn dùng quyền cũ tới khi phiên hết hạn.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { requirePermission, requestMeta, type AuthUser } from '@/auth/guards';
import { randomBytes } from 'node:crypto';
import { readSession, revokeAllSessions } from '@/auth/session';
import { hashPassword } from '@/auth/password';
import { approveUserSchema, rejectUserSchema } from '@/domain/validation';
import { PERMISSION_BY_CODE } from '@/domain/permissions';
import {
  AUDIT_ACTION,
  ENTITY_TYPE,
  USER_STATUS,
  PERMISSION_EFFECT,
  ROLE_LEVEL,
  type RoleCode,
} from '@/lib/enums';

export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

function zodErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function refreshAdminPages(): void {
  revalidatePath('/admin/users');
  revalidatePath('/members');
  revalidatePath('/audit');
}

/**
 * Không ai được cấp hoặc gán vai trò cao hơn chính mình.
 *
 * Nếu thiếu quy tắc này, một Senior Manager có quyền `user.assign_role` có thể
 * tự nâng mình thành ADMIN — leo thang đặc quyền kinh điển.
 */
function assertCanAssignRole(actor: AuthUser, targetRole: RoleCode): void {
  const targetLevel = ROLE_LEVEL[targetRole];
  if (targetLevel > actor.roleLevel) {
    throw new Error(
      `Không thể gán vai trò cao hơn vai trò của bạn (${actor.roleNameVi ?? actor.roleCode}).`,
    );
  }
}

/** Không cho tự thao tác lên chính mình ở các hành động nguy hiểm. */
function assertNotSelf(actor: AuthUser, targetUserId: string, action: string): void {
  if (actor.id === targetUserId) {
    throw new Error(`Không thể tự ${action} chính tài khoản của mình.`);
  }
}

// ---------------------------------------------------------------------------
// Duyệt tài khoản (§4)
// ---------------------------------------------------------------------------

/**
 * PENDING → ACTIVE, kèm gán Role / Department / Team.
 *
 * Cố tình KHÔNG có tham số strategy: theo §4, Strategy thuộc Trade chứ không
 * thuộc User. Đây là chỗ dễ bị "thêm cho tiện" nhất nên ghi rõ ở đây.
 */
export async function approveUserAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('user.approve');

  const parsed = approveUserSchema.safeParse({
    userId: formData.get('userId'),
    roleCode: formData.get('roleCode'),
    departmentId: formData.get('departmentId'),
    teamId: formData.get('teamId') || undefined,
    employeeCode: formData.get('employeeCode') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: 'Thiếu thông tin bắt buộc.', fieldErrors: zodErrors(parsed.error) };
  }

  const { userId, roleCode, departmentId, teamId, employeeCode } = parsed.data;

  try {
    assertCanAssignRole(actor, roleCode);

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        email: true, fullName: true, status: true,
        roleId: true, departmentId: true, teamId: true, employeeCode: true,
      },
    });

    if (before.status !== USER_STATUS.PENDING) {
      return { ok: false, message: 'Tài khoản này không còn ở trạng thái chờ duyệt.' };
    }

    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });

    /*
     * NHÓM KHÔNG PHẢI THUỘC PHÒNG BAN ĐÃ CHỌN.
     *
     * Chốt cũ ở đây từ chối khi `team.departmentId !== departmentId`, với lý do
     * "nếu không thì cây tổ chức §2 vô nghĩa". Lý do đó sai ở một chỗ: hai ô trả
     * lời hai câu khác nhau.
     *
     *   PHÒNG BAN  người này ngồi ở đâu trong cây tổ chức
     *   NHÓM       giao dịch của người này thuộc nhóm nào (`trades.teamId`)
     *
     * Trường hợp thật đã chặn: Quản lý cấp cao thuộc "Ban lãnh đạo" vẫn giao dịch
     * dưới nhóm "Cá nhân". "Ban lãnh đạo" không có nhóm nào — đúng thiết kế, vì
     * nhóm là đơn vị giao dịch chứ không phải đơn vị tổ chức — nên chốt cũ khiến
     * người đó KHÔNG THỂ được gán nhóm nào cả.
     *
     * Vẫn kiểm nhóm có tồn tại: id đến từ form nên không được tin.
     */
    if (teamId) {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { isActive: true },
      });
      if (!team) return { ok: false, fieldErrors: { teamId: ['Nhóm không tồn tại.'] } };
      if (!team.isActive) {
        return { ok: false, fieldErrors: { teamId: ['Nhóm này đã ngừng hoạt động.'] } };
      }
    }

    const meta = await requestMeta();

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          status: USER_STATUS.ACTIVE,
          roleId: role.id,
          departmentId,
          teamId: teamId ?? null,
          employeeCode: employeeCode ?? undefined,
          approvedById: actor.id,
          approvedAt: new Date(),
          rejectedReason: null,
          // Mật khẩu do người dùng tự đặt khi đăng ký nên không buộc đổi lại.
        },
        select: {
          email: true, fullName: true, status: true,
          roleId: true, departmentId: true, teamId: true, employeeCode: true,
        },
      });

      await writeAudit({
        tx,
        actor,
        action: AUDIT_ACTION.APPROVE,
        entityType: ENTITY_TYPE.USER,
        entityId: userId,
        entityLabel: `${before.fullName} <${before.email}>`,
        before,
        after: updated,
        note: `Duyệt tài khoản và gán vai trò ${roleCode}.`,
        ...meta,
      });

      return updated;
    });

    refreshAdminPages();
    return { ok: true, message: `Đã duyệt ${after.email} với vai trò ${roleCode}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Duyệt tài khoản thất bại.' };
  }
}

export async function rejectUserAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('user.approve');

  const parsed = rejectUserSchema.safeParse({
    userId: formData.get('userId'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: zodErrors(parsed.error) };

  try {
    assertNotSelf(actor, parsed.data.userId, 'từ chối');

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: parsed.data.userId },
      select: { email: true, fullName: true, status: true, rejectedReason: true },
    });

    const meta = await requestMeta();

    const after = await prisma.user.update({
      where: { id: parsed.data.userId },
      data: {
        status: USER_STATUS.REJECTED,
        rejectedReason: parsed.data.reason,
        approvedById: actor.id,
        approvedAt: new Date(),
      },
      select: { email: true, fullName: true, status: true, rejectedReason: true },
    });

    await revokeAllSessions(parsed.data.userId, actor.id);

    await writeAudit({
      actor,
      action: AUDIT_ACTION.REJECT,
      entityType: ENTITY_TYPE.USER,
      entityId: parsed.data.userId,
      entityLabel: `${before.fullName} <${before.email}>`,
      before,
      after,
      note: `Từ chối tài khoản. Lý do: ${parsed.data.reason}`,
      ...meta,
    });

    refreshAdminPages();
    return { ok: true, message: `Đã từ chối ${after.email}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Từ chối tài khoản thất bại.' };
  }
}

// ---------------------------------------------------------------------------
// Khoá / mở khoá
// ---------------------------------------------------------------------------

export async function setUserStatusAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('user.suspend');

  const userId = String(formData.get('userId') ?? '');
  const status = String(formData.get('status') ?? '');
  const reason = String(formData.get('reason') ?? '').trim() || null;

  if (status !== USER_STATUS.ACTIVE && status !== USER_STATUS.SUSPENDED) {
    return { ok: false, message: 'Trạng thái không hợp lệ.' };
  }

  try {
    assertNotSelf(actor, userId, status === USER_STATUS.SUSPENDED ? 'khoá' : 'đổi trạng thái');

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, fullName: true, status: true, role: { select: { level: true } } },
    });

    // Không được khoá người có vai trò cao hơn mình.
    if ((before.role?.level ?? 0) > actor.roleLevel) {
      return { ok: false, message: 'Không thể thao tác lên tài khoản có vai trò cao hơn bạn.' };
    }

    const meta = await requestMeta();

    const after = await prisma.user.update({
      where: { id: userId },
      data: { status },
      select: { email: true, fullName: true, status: true },
    });

    let revoked = 0;
    if (status === USER_STATUS.SUSPENDED) {
      revoked = await revokeAllSessions(userId, actor.id);
    }

    await writeAudit({
      actor,
      action: AUDIT_ACTION.UPDATE,
      entityType: ENTITY_TYPE.USER,
      entityId: userId,
      entityLabel: `${before.fullName} <${before.email}>`,
      before: { status: before.status },
      after: { status: after.status },
      note:
        (status === USER_STATUS.SUSPENDED
          ? `Tạm khoá tài khoản, thu hồi ${revoked} phiên.`
          : 'Mở khoá tài khoản.') + (reason ? ` Lý do: ${reason}` : ''),
      ...meta,
    });

    refreshAdminPages();
    return {
      ok: true,
      message:
        status === USER_STATUS.SUSPENDED
          ? `Đã khoá ${after.email} và thu hồi ${revoked} phiên đăng nhập.`
          : `Đã mở khoá ${after.email}.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Đổi trạng thái thất bại.' };
  }
}

// ---------------------------------------------------------------------------
// Gán lại vai trò / phòng ban / nhóm
// ---------------------------------------------------------------------------

export async function assignUserAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('user.assign_role');

  const userId = String(formData.get('userId') ?? '');
  const roleCode = String(formData.get('roleCode') ?? '') as RoleCode;
  const departmentId = String(formData.get('departmentId') ?? '') || null;
  const teamId = String(formData.get('teamId') ?? '') || null;

  if (!userId || !ROLE_LEVEL[roleCode]) return { ok: false, message: 'Dữ liệu không hợp lệ.' };

  try {
    assertCanAssignRole(actor, roleCode);

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        email: true, fullName: true,
        roleId: true, departmentId: true, teamId: true,
        role: { select: { code: true, level: true } },
      },
    });

    if ((before.role?.level ?? 0) > actor.roleLevel) {
      return { ok: false, message: 'Không thể thao tác lên tài khoản có vai trò cao hơn bạn.' };
    }

    // Nhóm độc lập với phòng ban — xem chú thích trong `approveUserAction`.
    if (teamId) {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { isActive: true },
      });
      if (!team) return { ok: false, fieldErrors: { teamId: ['Nhóm không tồn tại.'] } };
      if (!team.isActive) {
        return { ok: false, fieldErrors: { teamId: ['Nhóm này đã ngừng hoạt động.'] } };
      }
    }

    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const meta = await requestMeta();

    const after = await prisma.user.update({
      where: { id: userId },
      data: { roleId: role.id, departmentId, teamId },
      select: { email: true, roleId: true, departmentId: true, teamId: true },
    });

    /*
     * Đổi vai trò là đổi tập quyền → thu hồi phiên để không thiết bị nào giữ quyền cũ.
     *
     * NHƯNG GIỮ LẠI PHIÊN CỦA CHÍNH NGƯỜI ĐANG THAO TÁC khi họ sửa tài khoản của mình.
     * Không giữ thì admin đổi nhóm cho bản thân sẽ bị đá ra trang đăng nhập ngay lúc
     * lưu — và từ phía họ, việc lưu trông y như thất bại: không thông báo thành công,
     * không thay đổi nào nhìn thấy được, chỉ có màn hình đăng nhập. Đó là lỗi người
     * dùng báo lại: "tôi không lưu thay đổi được", trong khi dữ liệu đã lưu xong.
     *
     * An toàn vì `getCurrentUser()` đọc lại vai trò và quyền từ database ở mọi request:
     * phiên được giữ lập tức chạy theo quyền mới, kể cả khi quyền vừa bị hạ.
     */
    const phienHienTai = actor.id === userId ? (await readSession())?.sessionId : undefined;
    const revoked = await revokeAllSessions(userId, actor.id, phienHienTai);

    await writeAudit({
      actor,
      action: AUDIT_ACTION.PERMISSION_CHANGE,
      entityType: ENTITY_TYPE.USER,
      entityId: userId,
      entityLabel: `${before.fullName} <${before.email}>`,
      before: { roleCode: before.role?.code ?? null, departmentId: before.departmentId, teamId: before.teamId },
      after: { roleCode, departmentId, teamId },
      note: `Gán lại vai trò và tổ chức, thu hồi ${revoked} phiên.`,
      ...meta,
    });

    refreshAdminPages();
    revalidatePath(`/admin/users/${userId}`);
    /*
     * Thông báo phải nói đúng chuyện vừa xảy ra với NGƯỜI ĐANG ĐỌC nó. Tự sửa mình thì
     * phiên hiện tại được giữ, nên câu "cần đăng nhập lại" là sai và gây hoang mang.
     */
    return {
      ok: true,
      message:
        actor.id === userId
          ? `Đã cập nhật tài khoản của bạn. Quyền mới có hiệu lực ngay; ${revoked} phiên khác đã bị thu hồi.`
          : `Đã cập nhật ${after.email}. Người dùng cần đăng nhập lại.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Cập nhật thất bại.' };
  }
}

// ---------------------------------------------------------------------------
// Quyền riêng cho từng user (GRANT / DENY)
// ---------------------------------------------------------------------------

/**
 * Thêm hoặc bỏ một override quyền cho một người dùng.
 *
 * `effect = 'CLEAR'` xoá override, đưa quyền về đúng theo Role.
 * Quy tắc phân giải nằm ở `resolvePermissions()`: DENY > GRANT > Role.
 */
export async function setUserPermissionAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('permission.manage');

  const userId = String(formData.get('userId') ?? '');
  const permissionCode = String(formData.get('permissionCode') ?? '');
  const effect = String(formData.get('effect') ?? '');

  if (!PERMISSION_BY_CODE.has(permissionCode)) {
    return { ok: false, message: `Quyền không tồn tại: ${permissionCode}` };
  }
  if (effect !== PERMISSION_EFFECT.GRANT && effect !== PERMISSION_EFFECT.DENY && effect !== 'CLEAR') {
    return { ok: false, message: 'Tác động không hợp lệ.' };
  }

  try {
    const target = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, fullName: true, role: { select: { level: true } } },
    });

    if ((target.role?.level ?? 0) > actor.roleLevel) {
      return { ok: false, message: 'Không thể thao tác lên tài khoản có vai trò cao hơn bạn.' };
    }

    const permission = await prisma.permission.findUniqueOrThrow({ where: { code: permissionCode } });
    const existing = await prisma.userPermission.findUnique({
      where: { userId_permissionId: { userId, permissionId: permission.id } },
      select: { id: true, effect: true },
    });

    const meta = await requestMeta();

    if (effect === 'CLEAR') {
      if (!existing) return { ok: true, message: 'Không có gì để xoá.' };
      await prisma.userPermission.delete({ where: { id: existing.id } });
    } else {
      await prisma.userPermission.upsert({
        where: { userId_permissionId: { userId, permissionId: permission.id } },
        create: { userId, permissionId: permission.id, effect, grantedById: actor.id },
        update: { effect, grantedById: actor.id, grantedAt: new Date() },
      });
    }

    const revoked = await revokeAllSessions(userId, actor.id);

    await writeAudit({
      actor,
      action: AUDIT_ACTION.PERMISSION_CHANGE,
      entityType: ENTITY_TYPE.USER,
      entityId: userId,
      entityLabel: `${target.fullName} <${target.email}>`,
      before: { permission: permissionCode, effect: existing?.effect ?? null },
      after: { permission: permissionCode, effect: effect === 'CLEAR' ? null : effect },
      note: `Điều chỉnh quyền riêng, thu hồi ${revoked} phiên.`,
      ...meta,
    });

    revalidatePath(`/admin/users/${userId}`);
    revalidatePath('/audit');
    return {
      ok: true,
      message:
        effect === 'CLEAR'
          ? `Đã xoá override cho ${permissionCode}.`
          : `Đã đặt ${permissionCode} = ${effect}. Người dùng cần đăng nhập lại.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Cập nhật quyền thất bại.' };
  }
}

// ---------------------------------------------------------------------------
// Thu hồi phiên thủ công
// ---------------------------------------------------------------------------

export async function revokeUserSessionsAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('user.update');
  const userId = String(formData.get('userId') ?? '');

  try {
    const target = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, fullName: true, role: { select: { level: true } } },
    });

    if ((target.role?.level ?? 0) > actor.roleLevel) {
      return { ok: false, message: 'Không thể thao tác lên tài khoản có vai trò cao hơn bạn.' };
    }

    const revoked = await revokeAllSessions(userId, actor.id);
    const meta = await requestMeta();

    await writeAudit({
      actor,
      action: AUDIT_ACTION.UPDATE,
      entityType: ENTITY_TYPE.USER,
      entityId: userId,
      entityLabel: `${target.fullName} <${target.email}>`,
      note: `Thu hồi thủ công ${revoked} phiên đăng nhập.`,
      ...meta,
    });

    revalidatePath(`/admin/users/${userId}`);
    return { ok: true, message: `Đã thu hồi ${revoked} phiên.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Thu hồi phiên thất bại.' };
  }
}

// ---------------------------------------------------------------------------
// Xoá tài khoản người dùng (§3, §20)
// ---------------------------------------------------------------------------

/**
 * XOÁ HẲN MỘT TÀI KHOẢN — chỉ dành cho tài khoản CHƯA CÓ LỊCH SỬ.
 *
 * VÌ SAO KHÔNG XOÁ ĐƯỢC NGƯỜI ĐÃ GIAO DỊCH. Đây là hệ thống ghi sổ: một lệnh phải
 * mãi mãi trả lời được câu "ai đặt". Xoá người đặt lệnh sẽ hoặc phá huỷ chuỗi giao
 * dịch (nếu cascade), hoặc để lại một tham chiếu mồ côi. Cả hai đều làm mọi con số
 * phía sau mất căn cứ.
 *
 * Ràng buộc khoá ngoại trong `schema.prisma` đã encode đúng chính sách này:
 *
 *   trades.userId / createdById        bắt buộc → RESTRICT, database tự chặn
 *   capital_flows.createdById          bắt buộc → RESTRICT
 *   broker_accounts.userId             bắt buộc → RESTRICT
 *   approval_requests.requestedById    bắt buộc → RESTRICT
 *   trade_attachments.uploadedById     bắt buộc → RESTRICT
 *
 *   sessions / user_permissions / portfolio_access   → CASCADE, tự dọn
 *   audit_logs.actorUserId                           → SET NULL
 *
 * `audit_logs` là chỗ đáng nói: nó cố ý cho phép xoá, vì mỗi dòng đã lưu sẵn ảnh
 * chụp `actorEmail` / `actorName` / `actorRole`. Nhật ký vẫn đọc được nguyên vẹn sau
 * khi người đó không còn trong bảng `users` — đúng §20 "không sửa mất dấu vết".
 *
 * Vậy hàm này KHÔNG nới lỏng gì cả. Nó chỉ làm hai việc mà database không làm được:
 * kiểm TRƯỚC để trả về một câu tiếng Việt thay vì lỗi Prisma, và ghi audit trước khi
 * bản ghi biến mất.
 *
 * DÙNG "KHOÁ" CHO MỌI TRƯỜNG HỢP KHÁC. Khoá thu hồi mọi phiên đăng nhập ngay và giữ
 * nguyên toàn bộ lịch sử — đó mới là thao tác đúng cho một người đã nghỉ việc.
 */
export async function deleteUserAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('user.delete');
  const userId = String(formData.get('userId') ?? '');
  const xacNhan = String(formData.get('confirmEmail') ?? '').trim().toLowerCase();

  try {
    assertNotSelf(actor, userId, 'xoá');

    const target = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: { select: { code: true, nameVi: true } } },
    });
    if (!target) return { ok: false, message: 'Không tìm thấy người dùng.' };

    /*
     * GÕ LẠI EMAIL để xác nhận.
     *
     * Một hộp thoại "bạn có chắc không?" là thứ người ta bấm Yes theo phản xạ. Ở một
     * bảng hai mươi dòng, bấm nhầm dòng là chuyện xảy ra thật, và hành động này không
     * hoàn nguyên được. Gõ lại email buộc mắt phải đọc đúng người mình đang xoá.
     */
    if (xacNhan !== target.email.toLowerCase()) {
      return {
        ok: false,
        fieldErrors: {
          confirmEmail: [`Gõ đúng email "${target.email}" để xác nhận xoá.`],
        },
      };
    }

    /*
     * Không xoá người có vai trò từ ngang mình trở lên — cùng lý do như
     * `assertCanAssignRole`: nếu thiếu, một người có `user.delete` sẽ xoá được Quản
     * trị hệ thống và tự thành người cao nhất còn lại.
     */
    const targetLevel = target.role ? ROLE_LEVEL[target.role.code as RoleCode] : 0;
    if (targetLevel >= actor.roleLevel) {
      return {
        ok: false,
        message: `Không thể xoá người có vai trò từ ngang bạn trở lên (${target.role?.nameVi ?? 'chưa gán'}).`,
      };
    }

    /*
     * KIỂM LỊCH SỬ TRƯỚC KHI XOÁ.
     *
     * Database sẽ tự chặn bằng RESTRICT, nhưng lỗi Prisma trả về là một chuỗi tiếng
     * Anh nói về ràng buộc khoá ngoại — vô dụng với người đang dùng. Kiểm ở đây để
     * nói rõ CÁI GÌ đang giữ lại và PHẢI LÀM GÌ thay thế.
     */
    const [soLenh, soLenhNhap, soDongVon, soTaiKhoan, soDeNghi, soFileKem] = await Promise.all([
      prisma.trade.count({ where: { userId } }),
      prisma.trade.count({ where: { createdById: userId } }),
      prisma.capitalFlow.count({ where: { createdById: userId } }),
      prisma.brokerAccount.count({ where: { userId } }),
      prisma.approvalRequest.count({ where: { requestedById: userId } }),
      prisma.tradeAttachment.count({ where: { uploadedById: userId } }),
    ]);

    const raoCan = [
      soLenh > 0 && `${soLenh} lệnh đã thực hiện`,
      soLenhNhap > 0 && `${soLenhNhap} lệnh đã nhập`,
      soDongVon > 0 && `${soDongVon} dòng vốn`,
      soTaiKhoan > 0 && `${soTaiKhoan} tài khoản chứng khoán`,
      soDeNghi > 0 && `${soDeNghi} đề nghị duyệt`,
      soFileKem > 0 && `${soFileKem} tệp đính kèm`,
    ].filter((x): x is string => typeof x === 'string');

    if (raoCan.length > 0) {
      return {
        ok: false,
        message:
          `Không xoá được: người này còn ${raoCan.join(', ')}. ` +
          'Xoá sẽ làm mất dấu vết những bản ghi đó. Dùng "Khoá" thay thế — nó thu hồi ' +
          'mọi phiên đăng nhập ngay và giữ nguyên toàn bộ lịch sử.',
      };
    }

    const meta = await requestMeta();

    /*
     * GHI AUDIT TRƯỚC KHI XOÁ, trong cùng transaction.
     *
     * Ghi sau thì bản ghi đã biến mất và không còn gì để chụp lại. `writeAudit` nhận
     * `tx` đúng để dùng được ở đây.
     */
    await prisma.$transaction(async (tx) => {
      await writeAudit({
        tx,
        actor,
        action: AUDIT_ACTION.DELETE,
        entityType: ENTITY_TYPE.USER,
        entityId: userId,
        entityLabel: `${target.fullName} <${target.email}>`,
        before: target,
        note: 'Xoá tài khoản chưa phát sinh lịch sử giao dịch',
        ...meta,
      });

      // sessions / user_permissions / portfolio_access tự xoá theo CASCADE.
      await tx.user.delete({ where: { id: userId } });
    });

    revalidatePath('/admin/users');
    revalidatePath('/members');
    revalidatePath('/audit');

    return {
      ok: true,
      message: `Đã xoá ${target.fullName} <${target.email}>. Nhật ký kiểm toán giữ lại bản chụp.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Xoá tài khoản thất bại.',
    };
  }
}

// ---------------------------------------------------------------------------
// Đặt lại mật khẩu (§4) — đường phục hồi duy nhất khi người dùng quên
// ---------------------------------------------------------------------------

/**
 * Bộ ký tự sinh mật khẩu tạm, đã BỎ những ký tự dễ đọc lẫn.
 *
 * Mật khẩu này được đọc cho nhau qua điện thoại hoặc chat, không phải copy-paste từ
 * email — vì hệ thống không có email. Nên `0/O`, `1/l/I`, `5/S`, `8/B` bị loại: một
 * ký tự đọc sai là một lần đăng nhập thất bại và một cuộc gọi lại.
 *
 * Ba nhóm tách riêng để bảo đảm mật khẩu sinh ra luôn thoả quy tắc của
 * `registerSchema` (có in hoa, có chữ thường, có số) — nếu không, người dùng đăng
 * nhập được nhưng trang đổi mật khẩu lại từ chối chính mật khẩu họ vừa dùng.
 */
const PW_HOA = 'ACDEFGHJKLMNPQRTUVWXYZ';
const PW_THUONG = 'abcdefghijkmnpqrtuvwxyz';
const PW_SO = '234679';

/**
 * Sinh mật khẩu tạm bằng `crypto.randomBytes`, KHÔNG dùng `Math.random()`.
 *
 * `Math.random()` không phải nguồn ngẫu nhiên mật mã: nó dùng được cho hoạt ảnh,
 * không dùng được cho thứ bảo vệ một tài khoản. Đây là chỗ khác biệt đó có hậu quả
 * thật.
 *
 * Cách rút: lấy byte ngẫu nhiên rồi loại bỏ phần dư gây LỆCH PHÂN PHỐI. Nếu chỉ làm
 * `byte % len` thì các ký tự đầu bảng chữ cái xuất hiện nhiều hơn phần còn lại — sai
 * lệch nhỏ nhưng có thật, và nó làm giảm entropy thực tế.
 */
function sinhMatKhauTam(doDai = 14): string {
  const bang = PW_HOA + PW_THUONG + PW_SO;

  const rut = (nguon: string): string => {
    const nguong = Math.floor(256 / nguon.length) * nguon.length;
    for (;;) {
      const b = randomBytes(1)[0]!;
      if (b < nguong) return nguon[b % nguon.length]!;
    }
  };

  // Bảo đảm đủ ba nhóm, phần còn lại rút từ toàn bảng.
  const kyTu = [rut(PW_HOA), rut(PW_THUONG), rut(PW_SO)];
  while (kyTu.length < doDai) kyTu.push(rut(bang));

  /*
   * Trộn Fisher–Yates với cùng nguồn ngẫu nhiên. Không trộn thì ba ký tự đầu luôn
   * theo đúng thứ tự hoa–thường–số, tức là ba vị trí đầu bị đoán được một phần.
   */
  for (let i = kyTu.length - 1; i > 0; i--) {
    const nguong = Math.floor(256 / (i + 1)) * (i + 1);
    let b: number;
    do {
      b = randomBytes(1)[0]!;
    } while (b >= nguong);
    const j = b % (i + 1);
    [kyTu[i], kyTu[j]] = [kyTu[j]!, kyTu[i]!];
  }

  return kyTu.join('');
}

/**
 * ĐẶT LẠI MẬT KHẨU CHO NGƯỜI KHÁC — đường phục hồi duy nhất khi quên mật khẩu.
 *
 * VÌ SAO KHÔNG PHẢI "QUÊN MẬT KHẨU" TỰ PHỤC VỤ QUA EMAIL.
 *
 * Luồng tự phục vụ cần gửi được email, mà hệ thống này KHÔNG có hạ tầng email nào —
 * không thư viện, không SMTP, không khoá dịch vụ. Thêm nó vào nghĩa là thêm một dịch
 * vụ bên ngoài và gửi địa chỉ email người dùng ra khỏi máy này. Đó là một quyết định
 * hạ tầng, không phải một hàm.
 *
 * Với một hệ nội bộ vài chục người, đường phục hồi qua quản trị viên vừa đủ và vừa
 * kín hơn: mật khẩu tạm được đọc trực tiếp cho người cần, không đi qua hộp thư nào.
 *
 * DÙNG LẠI CỖ MÁY ĐÃ CÓ. `mustChangePassword` tồn tại trong schema và đã được
 * `requireUser()` cưỡng chế (đá về `/change-password`), nhưng trước đây KHÔNG chỗ nào
 * đặt nó thành `true` — một cỗ máy hoàn chỉnh chưa ai bật. Action này bật nó, nên mật
 * khẩu tạm chỉ dùng được đúng một lần để vào đổi mật khẩu thật.
 *
 * MẬT KHẨU TẠM KHÔNG BAO GIỜ ĐƯỢC GHI XUỐNG.
 *
 * Không vào audit log, không vào console, không vào file log. Audit chỉ ghi "đã đặt
 * lại", không ghi đặt thành gì. Nó trả về trong `message` để hiện MỘT LẦN cho người
 * quản trị đọc lại cho người dùng — tải lại trang là mất, và đó là đúng.
 */
export async function resetUserPasswordAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('user.reset_password');
  const userId = String(formData.get('userId') ?? '');

  try {
    /*
     * Tự đặt lại mật khẩu của mình thì đi qua `/change-password` — ở đó phải nhập
     * mật khẩu hiện tại, tức là có thêm một lớp xác thực. Cho phép ở đây sẽ tạo một
     * đường đổi mật khẩu KHÔNG cần biết mật khẩu cũ: ai chiếm được phiên đăng nhập
     * của một quản trị viên sẽ đổi được mật khẩu và chiếm hẳn tài khoản.
     */
    assertNotSelf(actor, userId, 'đặt lại mật khẩu cho');

    const target = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: { select: { code: true, nameVi: true } } },
    });
    if (!target) return { ok: false, message: 'Không tìm thấy người dùng.' };

    // Cùng chốt chống leo thang như `assertCanAssignRole`: không với tới người
    // ngang hoặc cao hơn mình.
    const targetLevel = target.role ? ROLE_LEVEL[target.role.code as RoleCode] : 0;
    if (targetLevel >= actor.roleLevel) {
      return {
        ok: false,
        message: `Không thể đặt lại mật khẩu của người có vai trò từ ngang bạn trở lên (${target.role?.nameVi ?? 'chưa gán'}).`,
      };
    }

    const matKhauTam = sinhMatKhauTam();
    const meta = await requestMeta();

    await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(matKhauTam),
        mustChangePassword: true,
      },
    });

    /*
     * THU HỒI PHIÊN Ở ĐÂY LÀ BẮT BUỘC THẬT, khác với trường hợp đổi vai trò.
     *
     * Mật khẩu cũ vừa bị thay; mọi phiên tạo bằng nó phải chết. Nếu không, người đang
     * giữ phiên cũ vẫn dùng tài khoản bình thường và bỏ qua được cả bước buộc đổi mật
     * khẩu.
     */
    const soPhien = await revokeAllSessions(userId, actor.id);

    await writeAudit({
      actor,
      action: AUDIT_ACTION.PASSWORD_RESET,
      entityType: ENTITY_TYPE.USER,
      entityId: userId,
      entityLabel: `${target.fullName} <${target.email}>`,
      // KHÔNG ghi mật khẩu. Chỉ ghi rằng đã đặt lại và hệ quả.
      after: { mustChangePassword: true, sessionsRevoked: soPhien },
      note: 'Đặt lại mật khẩu do người dùng quên. Mật khẩu tạm không được lưu ở đâu.',
      ...meta,
    });

    revalidatePath('/admin/users');
    revalidatePath(`/admin/users/${userId}`);
    revalidatePath('/audit');

    return {
      ok: true,
      message:
        /*
         * ĐỊNH DẠNG: mật khẩu là DÒNG ĐẦU, đứng một mình; giải thích ở dòng sau.
         *
         * Giao diện cần tách hai phần để hiện mật khẩu ở cỡ chữ đọc được. Bản đầu
         * ghép chúng thành một câu ("Mật khẩu tạm của X: abc") và form phải tách theo
         * dấu hai chấm — hỏng ngay nếu tên người có dấu hai chấm. Dòng đầu đứng riêng
         * thì không còn gì phải đoán.
         */
        `${matKhauTam}\n` +
        `Đọc cho họ ngay — tải lại trang là mất, và nó không được lưu ở đâu cả. ` +
        `Lần đăng nhập tới họ buộc phải đổi mật khẩu.` +
        (soPhien > 0 ? ` Đã thu hồi ${soPhien} phiên đang hoạt động.` : ''),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Đặt lại mật khẩu thất bại.',
    };
  }
}
