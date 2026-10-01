'use server';

/**
 * QUẢN LÝ CƠ CẤU TỔ CHỨC — phòng ban và nhóm.
 *
 * VÌ SAO FILE NÀY RA ĐỜI MUỘN. Bốn nhóm và ba phòng ban vốn chỉ tồn tại trong
 * `master-data.ts` và được dựng bằng `npm run db:seed`. Đổi tên một nhóm nghĩa là sửa mã
 * nguồn rồi chạy lại seed — một việc không thể yêu cầu người vận hành làm. Quyền
 * `team.create`, `team.update`, `department.manage` đã được khai từ đầu nhưng chưa có gì
 * dùng tới; đây là phần bù lại.
 *
 * BA NGUYÊN TẮC, giống mọi action quản trị khác:
 *
 *   1. `requirePermission()` gác ngay dòng đầu — không dựa vào việc giao diện có hiện
 *      nút hay không, vì URL và form đều gửi tay được.
 *   2. Ghi Audit Log before/after cho mọi thay đổi (§20).
 *   3. Không xoá, chỉ đóng. Xoá một nhóm sẽ làm mồ côi `trades.teamId` và
 *      `capital_flows.teamId` — lúc đó tiền và lệnh vẫn còn nhưng không biết thuộc về ai.
 *
 * `code` KHÔNG SỬA ĐƯỢC SAU KHI TẠO. Nó là khoá mà `db:seed` dùng để `upsert`, và là thứ
 * duy nhất nối bản ghi trong database với `master-data.ts`. Đổi `code` sẽ khiến lần seed
 * sau tạo một nhóm MỚI thay vì cập nhật nhóm cũ, và mọi lệnh đã gắn nhóm sẽ trỏ về một
 * nhóm không còn ai nhìn thấy. Tên hiển thị thì sửa thoải mái.
 */

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { requirePermission, requestMeta } from '@/auth/guards';
import { departmentSchema, teamSchema, zodErrors } from '@/domain/validation';
import { AUDIT_ACTION, ENTITY_TYPE } from '@/lib/enums';

export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

function lamMoi(): void {
  revalidatePath('/teams');
  revalidatePath('/admin/organization');
  revalidatePath('/members');
  revalidatePath('/dashboard');
}

// ---------------------------------------------------------------------------
// Phòng ban
// ---------------------------------------------------------------------------

export async function saveDepartmentAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('department.manage');

  const id = String(formData.get('id') ?? '') || undefined;

  const parsed = departmentSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    nameVi: formData.get('nameVi'),
    parentId: String(formData.get('parentId') ?? '') || undefined,
    sortOrder: formData.get('sortOrder'),
  });

  if (!parsed.success) {
    return { ok: false, message: 'Kiểm tra lại thông tin.', fieldErrors: zodErrors(parsed.error) };
  }

  const input = parsed.data;
  const meta = await requestMeta();

  /*
   * `code` trùng là lỗi nghiệp vụ, không phải lỗi hệ thống — bắt trước để trả câu tiếng
   * Việt, thay vì để ràng buộc unique ném ra lỗi Prisma. Ràng buộc ở database vẫn là
   * chốt cuối khi hai người bấm cùng lúc.
   */
  const trung = await prisma.department.findUnique({
    where: { code: input.code },
    select: { id: true },
  });
  if (trung && trung.id !== id) {
    return { ok: false, fieldErrors: { code: [`Mã ${input.code} đã có phòng ban khác dùng.`] } };
  }

  if (id) {
    const before = await prisma.department.findUnique({ where: { id } });
    if (!before) return { ok: false, message: 'Không tìm thấy phòng ban.' };

    /*
     * KHÔNG CHO PHÒNG BAN LÀM CHA CỦA CHÍNH NÓ. Cây phòng ban đi lên bằng `parentId`;
     * một vòng lặp sẽ treo mọi chỗ duyệt cây, kể cả trang đang hiển thị nó.
     */
    if (input.parentId === id) {
      return { ok: false, fieldErrors: { parentId: ['Phòng ban không thể là cấp trên của chính nó.'] } };
    }
    if (input.parentId && (await laConCháu(id, input.parentId))) {
      return {
        ok: false,
        fieldErrors: { parentId: ['Không chọn được phòng ban cấp dưới làm cấp trên — sẽ tạo vòng lặp.'] },
      };
    }

    const after = await prisma.department.update({
      where: { id },
      data: {
        code: input.code,
        name: input.name,
        nameVi: input.nameVi,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder,
      },
    });

    await writeAudit({
      actor,
      action: AUDIT_ACTION.UPDATE,
      entityType: ENTITY_TYPE.DEPARTMENT,
      entityId: id,
      entityLabel: after.nameVi,
      before,
      after,
      note: 'Sửa phòng ban',
      ...meta,
    });

    lamMoi();
    return { ok: true, message: `Đã cập nhật phòng ban ${after.nameVi}.` };
  }

  const created = await prisma.department.create({
    data: {
      code: input.code,
      name: input.name,
      nameVi: input.nameVi,
      parentId: input.parentId ?? null,
      sortOrder: input.sortOrder,
    },
  });

  await writeAudit({
    actor,
    action: AUDIT_ACTION.CREATE,
    entityType: ENTITY_TYPE.DEPARTMENT,
    entityId: created.id,
    entityLabel: created.nameVi,
    after: created,
    note: 'Tạo phòng ban',
    ...meta,
  });

  lamMoi();
  return { ok: true, message: `Đã tạo phòng ban ${created.nameVi}.` };
}

/** `con` có nằm trong nhánh dưới `to` không — dùng để chặn vòng lặp cây phòng ban. */
async function laConCháu(to: string, con: string): Promise<boolean> {
  let hienTai: string | null = con;
  const daQua = new Set<string>();

  while (hienTai) {
    if (hienTai === to) return true;
    if (daQua.has(hienTai)) return false; // dữ liệu đã có vòng lặp sẵn — dừng, đừng treo
    daQua.add(hienTai);

    const row: { parentId: string | null } | null = await prisma.department.findUnique({
      where: { id: hienTai },
      select: { parentId: true },
    });
    hienTai = row?.parentId ?? null;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Nhóm
// ---------------------------------------------------------------------------

export async function saveTeamAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get('id') ?? '') || undefined;

  // Tạo và sửa là hai quyền khác nhau — người được sửa tên chưa chắc được lập nhóm mới.
  const actor = await requirePermission(id ? 'team.update' : 'team.create');

  const parsed = teamSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    nameVi: formData.get('nameVi'),
    description: String(formData.get('description') ?? '') || undefined,
    departmentId: formData.get('departmentId'),
    leaderId: String(formData.get('leaderId') ?? '') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: 'Kiểm tra lại thông tin.', fieldErrors: zodErrors(parsed.error) };
  }

  const input = parsed.data;
  const meta = await requestMeta();

  const trung = await prisma.team.findUnique({
    where: { code: input.code },
    select: { id: true },
  });
  if (trung && trung.id !== id) {
    return { ok: false, fieldErrors: { code: [`Mã ${input.code} đã có nhóm khác dùng.`] } };
  }

  const phongBan = await prisma.department.findUnique({
    where: { id: input.departmentId },
    select: { id: true, isActive: true },
  });
  if (!phongBan) return { ok: false, fieldErrors: { departmentId: ['Phòng ban không tồn tại.'] } };
  if (!phongBan.isActive) {
    return { ok: false, fieldErrors: { departmentId: ['Phòng ban đã đóng, không gán nhóm vào được.'] } };
  }

  /*
   * TRƯỞNG NHÓM PHẢI LÀ NGƯỜI THUỘC NHÓM ĐÓ. Gán một người ở nhóm khác làm trưởng sẽ cho
   * họ quyền quyết định trên dữ liệu của một nhóm mà `dataScope` không cho họ xem — hai
   * chốt nói hai điều trái ngược.
   */
  if (input.leaderId) {
    const nguoi = await prisma.user.findUnique({
      where: { id: input.leaderId },
      select: { id: true, teamId: true, fullName: true },
    });
    if (!nguoi) return { ok: false, fieldErrors: { leaderId: ['Người dùng không tồn tại.'] } };
    if (id && nguoi.teamId !== id) {
      return {
        ok: false,
        fieldErrors: {
          leaderId: [`${nguoi.fullName} không thuộc nhóm này. Chuyển họ vào nhóm trước khi giao trưởng nhóm.`],
        },
      };
    }
    if (!id) {
      return {
        ok: false,
        fieldErrors: { leaderId: ['Nhóm mới chưa có thành viên nào — giao trưởng nhóm sau khi thêm người.'] },
      };
    }
  }

  if (id) {
    const before = await prisma.team.findUnique({ where: { id } });
    if (!before) return { ok: false, message: 'Không tìm thấy nhóm.' };

    const after = await prisma.team.update({
      where: { id },
      data: {
        code: input.code,
        name: input.name,
        nameVi: input.nameVi,
        description: input.description ?? null,
        departmentId: input.departmentId,
        leaderId: input.leaderId ?? null,
      },
    });

    await writeAudit({
      actor,
      action: AUDIT_ACTION.UPDATE,
      entityType: ENTITY_TYPE.TEAM,
      entityId: id,
      entityLabel: after.nameVi,
      before,
      after,
      note: 'Sửa nhóm',
      ...meta,
    });

    lamMoi();
    return { ok: true, message: `Đã cập nhật nhóm ${after.nameVi}.` };
  }

  const created = await prisma.team.create({
    data: {
      code: input.code,
      name: input.name,
      nameVi: input.nameVi,
      description: input.description ?? null,
      departmentId: input.departmentId,
    },
  });

  await writeAudit({
    actor,
    action: AUDIT_ACTION.CREATE,
    entityType: ENTITY_TYPE.TEAM,
    entityId: created.id,
    entityLabel: created.nameVi,
    after: created,
    note: 'Tạo nhóm',
    ...meta,
  });

  lamMoi();
  return { ok: true, message: `Đã tạo nhóm ${created.nameVi}.` };
}

// ---------------------------------------------------------------------------
// Đóng / mở lại
// ---------------------------------------------------------------------------

/**
 * Đóng hoặc mở lại một nhóm. KHÔNG xoá.
 *
 * Xoá nhóm làm mồ côi `trades.teamId` và `capital_flows.teamId` — lệnh và tiền vẫn còn
 * nhưng không còn biết thuộc nhóm nào, và mọi con số theo nhóm sẽ hụt mà biểu đồ vẫn
 * trông hoàn chỉnh.
 *
 * ĐÓNG CÓ ĐIỀU KIỆN: nhóm còn thành viên thì không đóng được. Người ở trong một nhóm đã
 * đóng vẫn mang `teamId` đó, nên `dataScope` vẫn ép họ về một nhóm không còn tồn tại
 * trên giao diện — họ sẽ thấy trang trống mà không có gì giải thích.
 */
export async function toggleTeamAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('team.update');
  const id = String(formData.get('id') ?? '');

  const before = await prisma.team.findUnique({
    where: { id },
    select: { id: true, nameVi: true, isActive: true, _count: { select: { members: true } } },
  });
  if (!before) return { ok: false, message: 'Không tìm thấy nhóm.' };

  if (before.isActive && before._count.members > 0) {
    return {
      ok: false,
      message:
        `Chưa đóng được: nhóm còn ${before._count.members} thành viên. ` +
        'Chuyển họ sang nhóm khác trước.',
    };
  }

  const meta = await requestMeta();
  const after = await prisma.team.update({
    where: { id },
    data: { isActive: !before.isActive },
  });

  await writeAudit({
    actor,
    action: AUDIT_ACTION.UPDATE,
    entityType: ENTITY_TYPE.TEAM,
    entityId: id,
    entityLabel: after.nameVi,
    before,
    after,
    note: after.isActive ? 'Mở lại nhóm' : 'Đóng nhóm',
    ...meta,
  });

  lamMoi();
  return { ok: true, message: after.isActive ? 'Đã mở lại nhóm.' : 'Đã đóng nhóm.' };
}
