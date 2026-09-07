import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getTheme } from '@/components/theme';
import { LoginForm } from './LoginForm';
import { BRAND_NAME_UPPER, BRAND_TAGLINE } from '@/lib/brand';
import { readSession } from '@/auth/session';

export const metadata: Metadata = { title: 'Đăng nhập' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; passwordChanged?: string; next?: string }>;
}) {
  const session = await readSession();
  if (session) {
    redirect('/dashboard');
  }

  const params = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-center">
          <ThemeToggle initial={await getTheme()} />
        </div>

        <div className="mb-8 text-center">
          <p className="text-xs font-semibold tracking-[0.2em] text-accent-400">
            {BRAND_NAME_UPPER}
          </p>
          <h1 className="mt-2 text-lg font-semibold text-strong">{BRAND_TAGLINE}</h1>
          <p className="mt-1 text-sm text-slate-muted">Đăng nhập để tiếp tục</p>
        </div>

        {params.registered ? (
          <p className="mb-4 rounded-lg border border-up-500/30 bg-up-500/10 px-3 py-2.5 text-sm text-up-500">
            Đăng ký thành công. Tài khoản đang chờ quản trị viên duyệt — bạn sẽ vào được hệ thống
            sau khi được gán vai trò.
          </p>
        ) : null}

        {params.passwordChanged ? (
          <p className="mb-4 rounded-lg border border-up-500/30 bg-up-500/10 px-3 py-2.5 text-sm text-up-500">
            Đã đổi mật khẩu. Mọi phiên đăng nhập cũ đã bị thu hồi — hãy đăng nhập lại bằng mật khẩu
            mới.
          </p>
        ) : null}

        <div className="rounded-xl border border-ink-700 bg-ink-900 p-6">
          <LoginForm />
        </div>

        {/*
          QUÊN MẬT KHẨU — nói thật là không có tự phục vụ, và nói phải làm gì.

          KHÔNG làm link tới một trang nhập email. Luồng tự phục vụ cần gửi được email,
          mà hệ thống này không có hạ tầng email nào — không thư viện, không SMTP, không
          khoá dịch vụ. Một ô "nhập email để nhận link đặt lại" sẽ là lời hứa suông: người
          dùng gõ email, chờ thư không bao giờ tới, rồi mất thêm thời gian tìm trong hộp
          thư rác trước khi nghĩ tới việc gọi cho quản trị viên.

          Một câu nói rõ ngay tại đây tiết kiệm đúng khoảng thời gian đó.

          Không đặt link `mailto:` vì địa chỉ quản trị viên là dữ liệu, không phải hằng
          số trong code — mỗi lần đổi người quản trị lại phải sửa và deploy lại.
        */}
        <details className="group mt-5">
          <summary className="cursor-pointer list-none text-center text-sm text-slate-muted transition hover:text-strong">
            Quên mật khẩu?
          </summary>
          <p className="mt-2.5 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 text-xs leading-relaxed text-slate-soft">
            Hệ thống <span className="font-medium text-strong">không gửi email</span> nên
            không tự đặt lại mật khẩu được. Hãy liên hệ quản trị viên: họ sinh cho bạn một
            mật khẩu tạm và đọc lại trực tiếp. Đăng nhập bằng mật khẩu tạm đó, hệ thống sẽ
            buộc bạn đổi sang mật khẩu của riêng mình ngay.
          </p>
        </details>

        <p className="mt-4 text-center text-sm text-slate-muted">
          Chưa có tài khoản?{' '}
          <Link href="/register" className="font-medium text-accent-400 hover:text-accent-500">
            Đăng ký
          </Link>
        </p>
      </div>
    </main>
  );
}
