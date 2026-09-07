import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="text-center">
        <p className="text-sm font-medium tracking-[0.2em] text-accent-400">404</p>
        <h1 className="mt-2 text-xl font-semibold text-strong">Không tìm thấy trang</h1>
        <p className="mt-1 text-sm text-slate-muted">
          Đường dẫn này không tồn tại, hoặc thuộc phase chưa được triển khai.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500"
        >
          Về Dashboard
        </Link>
      </div>
    </main>
  );
}
