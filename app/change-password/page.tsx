import type { Metadata } from 'next';
import { requireUserAllowPasswordChange } from '@/auth/guards';
import { logoutAction } from '@/auth/actions';
import { ChangePasswordForm } from './ChangePasswordForm';
import { BRAND_NAME_UPPER } from '@/lib/brand';

export const metadata: Metadata = { title: 'Đổi mật khẩu' };

export default async function ChangePasswordPage() {
  const user = await requireUserAllowPasswordChange();

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-accent-400">
            {BRAND_NAME_UPPER}
          </p>
          <h1 className="mt-2 text-lg font-semibold text-strong">
            {user.mustChangePassword ? 'Bắt buộc đổi mật khẩu' : 'Đổi mật khẩu'}
          </h1>
          <p className="mt-1 text-sm text-slate-muted">{user.email}</p>
        </div>

        {user.mustChangePassword ? (
          <p className="mb-4 rounded-lg border border-warn-500/30 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-warn-500">
            Mật khẩu hiện tại do hệ thống khởi tạo. Bạn phải đặt mật khẩu riêng trước khi sử dụng
            hệ thống.
          </p>
        ) : null}

        <div className="rounded-xl border border-ink-700 bg-ink-900 p-6">
          <ChangePasswordForm />
        </div>

        <p className="mt-4 text-center text-xs text-slate-muted">
          Đổi mật khẩu sẽ thu hồi toàn bộ phiên đăng nhập, kể cả phiên này.
        </p>

        <form action={logoutAction} className="mt-4">
          <button
            type="submit"
            className="w-full rounded-lg border border-ink-700 px-4 py-2 text-xs text-slate-muted transition hover:border-ink-600 hover:text-strong"
          >
            Đăng xuất
          </button>
        </form>
      </div>
    </main>
  );
}
