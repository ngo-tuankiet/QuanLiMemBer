/**
 * Chốt kiểm tra quyền ở tầng dữ liệu.
 *
 * NGUYÊN TẮC: `middleware.ts` chỉ làm kiểm tra LẠC QUAN (có cookie hay không) để
 * chuyển hướng cho đẹp. Nó chạy trên edge runtime, không truy cập được database,
 * nên **không bao giờ được coi là lớp bảo vệ thật**.
 *
 * Lớp bảo vệ thật nằm ở đây, và mọi page/layout/server action đều phải gọi
 * `requireUser()` hoặc `requirePermission()`. Đây cũng là khuyến nghị chính thức
 * của Next.js: xác thực ở tầng gần dữ liệu nhất.
 */

import 'server-only';

import { forbidden, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { readSession } from '@/auth/session';
import { resolvePermissions, type UserPermissionOverride } from '@/domain/permissions';
import { USER_STATUS, type RoleCode } from '@/lib/enums';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  status: string;
  mustChangePassword: boolean;
  roleCode: RoleCode | null;
  roleNameVi: string | null;
  roleLevel: number;
  departmentId: string | null;
  departmentNameVi: string | null;
  teamId: string | null;
  teamNameVi: string | null;
  permissions: ReadonlySet<string>;
  sessionId: string;
}

/**
 * Người dùng của request hiện tại, hoặc null.
 *
 * Quyền được tính lại MỖI request từ Role + các override trong `user_permissions`.
 * Không cache vào cookie hay JWT: Admin rút quyền thì phải có hiệu lực ngay.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await readSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      role: { select: { code: true, nameVi: true, level: true } },
      department: { select: { nameVi: true } },
      team: { select: { nameVi: true } },
      permissions: {
        include: { permission: { select: { code: true } } },
      },
    },
  });

  if (!user) return null;

  const overrides: UserPermissionOverride[] = user.permissions.map((row) => ({
    permissionCode: row.permission.code,
    effect: row.effect as UserPermissionOverride['effect'],
    expiresAt: row.expiresAt,
  }));

  // Chỉ user ACTIVE mới có quyền. PENDING/SUSPENDED/REJECTED giữ danh tính để
  // hiển thị thông báo phù hợp, nhưng tập quyền rỗng.
  const roleCode = (user.role?.code ?? null) as RoleCode | null;
  const permissions =
    user.status === USER_STATUS.ACTIVE
      ? resolvePermissions(roleCode, overrides)
      : new Set<string>();

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    roleCode,
    roleNameVi: user.role?.nameVi ?? null,
    roleLevel: user.role?.level ?? 0,
    departmentId: user.departmentId,
    departmentNameVi: user.department?.nameVi ?? null,
    teamId: user.teamId,
    teamNameVi: user.team?.nameVi ?? null,
    permissions,
    sessionId: session.sessionId,
  };
}

/**
 * Bắt buộc đã đăng nhập, ACTIVE, và đã đổi mật khẩu bắt buộc.
 * Chuyển hướng nếu không thoả — dùng ở layout của khu vực đã đăng nhập.
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  if (user.status === USER_STATUS.PENDING) redirect('/pending');
  if (user.status === USER_STATUS.REJECTED) redirect('/pending?rejected=1');
  if (user.status === USER_STATUS.SUSPENDED) redirect('/pending?suspended=1');
  if (user.mustChangePassword) redirect('/change-password');

  return user;
}

/** Như `requireUser` nhưng bỏ qua bước buộc đổi mật khẩu — dùng cho chính trang đó. */
export async function requireUserAllowPasswordChange(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.status !== USER_STATUS.ACTIVE) redirect('/pending');
  return user;
}

export class ForbiddenError extends Error {
  constructor(public readonly permission: string) {
    super(`Thiếu quyền: ${permission}`);
    this.name = 'ForbiddenError';
  }
}

/**
 * VÌ SAO CÓ HAI HÀM KIỂM QUYỀN
 *
 * `requirePagePermission` dùng cho page/layout: nó gọi `forbidden()` của Next.js
 * nên phản hồi mang đúng mã HTTP **403**. Điều này quan trọng với hệ thống quản
 * lý vốn — log và hệ thống giám sát phải phân biệt được "bị chặn vì thiếu quyền"
 * với "server lỗi". Nếu để lỗi tự lan ra error boundary thì mọi lần thiếu quyền
 * đều thành 500 và cảnh báo vận hành sẽ nhiễu.
 *
 * `requirePermission` dùng cho server action: nó ném `ForbiddenError` để action
 * bắt được và trả về thông báo kèm mã quyền cụ thể cho người dùng thấy trong
 * form. `forbidden()` không mang theo dữ liệu nên không làm được việc đó.
 */

/** Dùng trong page và layout. Trả về 403 khi thiếu quyền. */
export async function requirePagePermission(code: string): Promise<AuthUser> {
  const user = await requireUser();
  if (!user.permissions.has(code)) {
    // Ghi lại để quản trị viên tìm được nguyên nhân — trang 403 không hiện mã quyền.
    console.warn(`[403] ${user.email} thiếu quyền ${code}`);
    forbidden();
  }
  return user;
}

/** Dùng trong page cần ít nhất một trong nhiều quyền. Trả về 403 khi thiếu. */
export async function requirePageAnyPermission(codes: readonly string[]): Promise<AuthUser> {
  const user = await requireUser();
  if (!codes.some((c) => user.permissions.has(c))) {
    console.warn(`[403] ${user.email} thiếu toàn bộ quyền ${codes.join(', ')}`);
    forbidden();
  }
  return user;
}

/**
 * Dùng trong SERVER ACTION.
 * Ném ForbiddenError để action trả thông báo có mã quyền cho người dùng.
 */
export async function requirePermission(code: string): Promise<AuthUser> {
  const user = await requireUser();
  if (!user.permissions.has(code)) throw new ForbiddenError(code);
  return user;
}

/** Bắt buộc có ít nhất một trong các quyền. Dùng trong server action. */
export async function requireAnyPermission(codes: readonly string[]): Promise<AuthUser> {
  const user = await requireUser();
  if (!codes.some((c) => user.permissions.has(c))) throw new ForbiddenError(codes.join(' | '));
  return user;
}

/** IP và User-Agent của request, để ghi vào Audit Log và Session. */
export async function requestMeta(): Promise<{ ipAddress?: string; userAgent?: string }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return {
    ipAddress: forwarded?.split(',')[0]?.trim() || h.get('x-real-ip') || undefined,
    userAgent: h.get('user-agent') ?? undefined,
  };
}
