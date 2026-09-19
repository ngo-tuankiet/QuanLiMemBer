import Link from 'next/link';
import type { Metadata } from 'next';
import { RegisterForm } from './RegisterForm';
import { BRAND_NAME_UPPER } from '@/lib/brand';

export const metadata: Metadata = { title: 'Đăng ký' };

export default function RegisterPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-accent-400">
            {BRAND_NAME_UPPER}
          </p>
          <h1 className="mt-2 text-lg font-semibold text-strong">Đăng ký tài khoản</h1>
        </div>

        {/* Nói trước luồng duyệt để người dùng không chờ đợi vô ích (§4). */}
        <p className="mb-4 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-xs leading-relaxed text-slate-muted">
          Tài khoản mới ở trạng thái <span className="text-warn-500">chờ duyệt</span>. Quản trị viên
          sẽ gán vai trò, phòng ban và nhóm trước khi bạn truy cập được hệ thống.
        </p>

        <div className="rounded-xl border border-ink-700 bg-ink-900 p-6">
          <RegisterForm />
        </div>

        <p className="mt-5 text-center text-sm text-slate-muted">
          Đã có tài khoản?{' '}
          <Link href="/login" className="font-medium text-accent-400 hover:text-accent-500">
            Đăng nhập
          </Link>
        </p>
      </div>
    </main>
  );
}
