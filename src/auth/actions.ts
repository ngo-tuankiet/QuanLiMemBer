'use server';

/**
 * Server Action cho xác thực: đăng ký, đăng nhập, đăng xuất, đổi mật khẩu.
 *
 * Mọi hành động ở đây đều ghi Audit Log (§20), kể cả đăng nhập thất bại — vì
 * chuỗi đăng nhập thất bại là dấu hiệu quan trọng nhất của một cuộc tấn công.
 */

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { registerSchema } from '@/domain/validation';
import { hashPassword, verifyPassword, fakeVerifyDelay, isCommonPassword } from '@/auth/password';
import { createSession, destroyCurrentSession, revokeAllSessions, pruneExpiredSessions } from '@/auth/session';
import { getCurrentUser, requireUserAllowPasswordChange, requestMeta } from '@/auth/guards';
import { AUDIT_ACTION, ENTITY_TYPE, USER_STATUS, USER_STATUS_LABEL_VI } from '@/lib/enums';

export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

/** Số lần sai liên tiếp và khoảng thời gian trước khi tạm khoá đăng nhập. */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;

function zodErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Đăng ký (§4)
// ---------------------------------------------------------------------------

/**
 * Tạo tài khoản ở trạng thái PENDING.
 *
 * KHÔNG gán role, department, team, và tuyệt đối không gán Strategy (§4).
 * Admin sẽ quyết định toàn bộ ở bước duyệt.
 */
export async function registerAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = registerSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    fullName: formData.get('fullName'),
    phone: formData.get('phone') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: 'Vui lòng kiểm tra lại thông tin.', fieldErrors: zodErrors(parsed.error) };
  }

  const { email, password, fullName, phone } = parsed.data;

  if (isCommonPassword(password)) {
    return { ok: false, fieldErrors: { password: ['Mật khẩu này quá phổ biến, hãy chọn mật khẩu khác.'] } };
  }

  const confirm = String(formData.get('confirmPassword') ?? '');
  if (confirm !== password) {
    return { ok: false, fieldErrors: { confirmPassword: ['Mật khẩu nhập lại không khớp.'] } };
  }

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    // Nói thẳng ở đây là chấp nhận được: đây là hệ thống nội bộ, và việc người
    // dùng biết mình đã có tài khoản quan trọng hơn việc che danh sách email.
    return { ok: false, fieldErrors: { email: ['Email này đã được đăng ký.'] } };
  }

  const meta = await requestMeta();
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      fullName,
      phone,
      status: USER_STATUS.PENDING,
      mustChangePassword: false,
    },
    select: { id: true, email: true, fullName: true },
  });

  await writeAudit({
    actor: { id: user.id, email: user.email, fullName: user.fullName },
    action: AUDIT_ACTION.CREATE,
    entityType: ENTITY_TYPE.USER,
    entityId: user.id,
    entityLabel: `Đăng ký: ${user.email}`,
    after: { email: user.email, fullName: user.fullName, status: USER_STATUS.PENDING },
    note: 'Tự đăng ký, chờ Admin duyệt.',
    ...meta,
  });

  redirect('/login?registered=1');
}

// ---------------------------------------------------------------------------
// Đăng nhập
// ---------------------------------------------------------------------------

export async function loginAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { ok: false, message: 'Vui lòng nhập email và mật khẩu.' };
  }

  const meta = await requestMeta();

  // Tạm khoá sau nhiều lần sai liên tiếp. Đếm từ chính Audit Log nên không cần
  // bảng riêng, và số lần thử luôn khớp với nhật ký mà Admin xem được.
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60_000);
  const recentFailures = await prisma.auditLog.count({
    where: { action: AUDIT_ACTION.LOGIN_FAILED, actorEmail: email, occurredAt: { gte: since } },
  });

  if (recentFailures >= MAX_FAILED_ATTEMPTS) {
    await writeAudit({
      actor: { email },
      action: AUDIT_ACTION.LOGIN_FAILED,
      entityType: ENTITY_TYPE.USER,
      entityLabel: email,
      note: `Bị chặn do quá ${MAX_FAILED_ATTEMPTS} lần sai trong ${LOCKOUT_WINDOW_MINUTES} phút.`,
      ...meta,
    });
    return {
      ok: false,
      message: `Tài khoản tạm bị khoá do nhập sai quá nhiều lần. Thử lại sau ${LOCKOUT_WINDOW_MINUTES} phút.`,
    };
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      fullName: true,
      passwordHash: true,
      status: true,
      role: { select: { code: true } },
    },
  });

  // Email không tồn tại: vẫn tiêu tốn thời gian tương đương một lần bcrypt để
  // không lộ danh sách email qua thời gian phản hồi.
  if (!user) {
    await fakeVerifyDelay();
    await writeAudit({
      actor: { email },
      action: AUDIT_ACTION.LOGIN_FAILED,
      entityType: ENTITY_TYPE.USER,
      entityLabel: email,
      note: 'Email không tồn tại.',
      ...meta,
    });
    return { ok: false, message: 'Email hoặc mật khẩu không đúng.' };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    await writeAudit({
      actor: { id: user.id, email: user.email, fullName: user.fullName, roleCode: user.role?.code },
      action: AUDIT_ACTION.LOGIN_FAILED,
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      entityLabel: user.email,
      note: `Sai mật khẩu (lần thứ ${recentFailures + 1}).`,
      ...meta,
    });
    return { ok: false, message: 'Email hoặc mật khẩu không đúng.' };
  }

  // Mật khẩu đúng nhưng tài khoản chưa được duyệt hoặc đã bị khoá.
  if (user.status === USER_STATUS.SUSPENDED || user.status === USER_STATUS.REJECTED) {
    await writeAudit({
      actor: { id: user.id, email: user.email, fullName: user.fullName },
      action: AUDIT_ACTION.LOGIN_FAILED,
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      entityLabel: user.email,
      note: `Tài khoản ở trạng thái ${user.status}.`,
      ...meta,
    });
    return {
      ok: false,
      message: `Tài khoản đang ở trạng thái "${USER_STATUS_LABEL_VI[user.status as keyof typeof USER_STATUS_LABEL_VI]}". Liên hệ quản trị viên.`,
    };
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id, meta);
  await pruneExpiredSessions();

  await writeAudit({
    actor: { id: user.id, email: user.email, fullName: user.fullName, roleCode: user.role?.code },
    action: AUDIT_ACTION.LOGIN,
    entityType: ENTITY_TYPE.USER,
    entityId: user.id,
    entityLabel: user.email,
    ...meta,
  });

  // PENDING vẫn được tạo phiên, nhưng chỉ tới được trang /pending.
  redirect(user.status === USER_STATUS.PENDING ? '/pending' : '/dashboard');
}

// ---------------------------------------------------------------------------
// Đăng xuất
// ---------------------------------------------------------------------------

export async function logoutAction(): Promise<void> {
  const user = await getCurrentUser();
  const meta = await requestMeta();

  await destroyCurrentSession();

  if (user) {
    await writeAudit({
      actor: { id: user.id, email: user.email, fullName: user.fullName, roleCode: user.roleCode },
      action: AUDIT_ACTION.LOGOUT,
      entityType: ENTITY_TYPE.USER,
      entityId: user.id,
      entityLabel: user.email,
      ...meta,
    });
  }

  redirect('/login');
}

// ---------------------------------------------------------------------------
// Đổi mật khẩu
// ---------------------------------------------------------------------------

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'),
    newPassword: z
      .string()
      .min(10, 'Mật khẩu tối thiểu 10 ký tự')
      .regex(/[A-Z]/, 'Phải có chữ in hoa')
      .regex(/[a-z]/, 'Phải có chữ thường')
      .regex(/[0-9]/, 'Phải có số'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Mật khẩu nhập lại không khớp',
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
  });

export async function changePasswordAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const user = await requireUserAllowPasswordChange();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: zodErrors(parsed.error) };
  }

  if (isCommonPassword(parsed.data.newPassword)) {
    return { ok: false, fieldErrors: { newPassword: ['Mật khẩu này quá phổ biến, hãy chọn mật khẩu khác.'] } };
  }

  const record = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { passwordHash: true },
  });

  if (!(await verifyPassword(parsed.data.currentPassword, record.passwordHash))) {
    return { ok: false, fieldErrors: { currentPassword: ['Mật khẩu hiện tại không đúng.'] } };
  }

  const meta = await requestMeta();

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword),
      mustChangePassword: false,
    },
  });

  // Thu hồi mọi phiên khác: đổi mật khẩu phải đẩy mọi thiết bị khác ra ngoài.
  await revokeAllSessions(user.id, user.id);

  await writeAudit({
    actor: { id: user.id, email: user.email, fullName: user.fullName, roleCode: user.roleCode },
    action: AUDIT_ACTION.UPDATE,
    entityType: ENTITY_TYPE.USER,
    entityId: user.id,
    entityLabel: user.email,
    // Cố tình KHÔNG ghi giá trị mật khẩu hay hash vào nhật ký.
    before: { passwordChanged: false },
    after: { passwordChanged: true, mustChangePassword: false },
    note: 'Người dùng tự đổi mật khẩu. Toàn bộ phiên khác đã bị thu hồi.',
    ...meta,
  });

  // Phiên hiện tại cũng vừa bị thu hồi → buộc đăng nhập lại bằng mật khẩu mới.
  await destroyCurrentSession();
  revalidatePath('/', 'layout');
  redirect('/login?passwordChanged=1');
}
