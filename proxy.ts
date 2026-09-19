import { NextResponse, type NextRequest } from 'next/server';

/**
 * KIỂM TRA LẠC QUAN — KHÔNG PHẢI LỚP BẢO VỆ.
 *
 * (Next.js 16 đổi tên quy ước `middleware` thành `proxy`. Vai trò không đổi.)
 *
 * Middleware chạy trên edge runtime nên không truy cập được database. Nó chỉ xem
 * cookie phiên có tồn tại hay không, để chuyển hướng cho mượt. Nó KHÔNG biết
 * cookie đó còn hiệu lực, đã bị thu hồi, hay người dùng có quyền gì.
 *
 * Lớp bảo vệ thật nằm ở `requireUser()` / `requirePermission()` trong
 * src/auth/guards.ts, và mọi page/layout/server action đều gọi chúng. Đây là
 * khuyến nghị chính thức của Next.js: xác thực ở tầng gần dữ liệu nhất.
 *
 * Nói cách khác: xoá file này đi thì ứng dụng vẫn an toàn, chỉ kém mượt.
 */

const SESSION_COOKIE = 'vn_session';

/** Đường dẫn công khai, không cần đăng nhập. */
const PUBLIC_PATHS = ['/login', '/register'];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Chưa có cookie mà vào khu vực nội bộ → về trang đăng nhập, giữ lại đích đến.
  if (!hasSessionCookie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Đã có cookie mà vào trang đăng nhập/đăng ký → về dashboard.
  // Nếu cookie thực ra đã hết hạn, guards ở /dashboard sẽ đẩy ngược lại /login.
  if (hasSessionCookie && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Bỏ qua tài nguyên tĩnh và nội bộ của Next.
     *
     * Bỏ qua `/pending` và `/change-password`: người dùng ở hai trang đó có phiên
     * hợp lệ nhưng chưa được vào khu vực chính, và chính guards xử lý việc đó.
     *
     * Bỏ qua `/api`: các route API tự xác thực theo cách riêng — Market Data
     * Service dùng shared secret, không dùng cookie phiên. Nếu để proxy xử lý,
     * nó sẽ chuyển hướng sang /login và client nhận về HTML thay vì JSON, gây
     * lỗi rất khó đoán ở phía tiến trình nền.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|pending|change-password|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
