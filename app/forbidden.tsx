import Link from 'next/link';

/**
 * Trang 403.
 *
 * Được render khi `requirePagePermission()` gọi `forbidden()` của Next.js. Khác
 * với error boundary, đường này trả về đúng mã HTTP 403 — nhờ vậy log và hệ thống
 * giám sát phân biệt được "bị chặn vì thiếu quyền" với "server lỗi".
 *
 * Cố tình KHÔNG hiện mã quyền còn thiếu: `forbidden()` không mang theo dữ liệu, và
 * việc liệt kê tên quyền cho người không có quyền cũng là rò rỉ thông tin không
 * cần thiết. Mã quyền được ghi vào log phía server để quản trị viên tra được.
 */
export default function Forbidden() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="max-w-md text-center">
        <p className="text-xs font-semibold tracking-[0.2em] text-down-500">403</p>

        <h1 className="mt-2 text-lg font-semibold text-strong">
          Bạn không có quyền xem nội dung này
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-slate-muted">
          Quyền truy cập được cấp theo vai trò. Nếu bạn cho rằng mình cần quyền này, liên hệ quản
          trị viên — họ có thể cấp thêm quyền riêng cho tài khoản của bạn.
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500"
          >
            Về Dashboard
          </Link>
          <Link
            href="/profile"
            className="rounded-lg border border-ink-600 px-4 py-2 text-sm text-slate-soft transition hover:border-ink-500 hover:text-strong"
          >
            Xem quyền của tôi
          </Link>
        </div>
      </div>
    </main>
  );
}
