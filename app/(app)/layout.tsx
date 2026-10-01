import { requireUser } from '@/auth/guards';
import { AppShell } from '@/components/AppShell';

/**
 * Layout của toàn bộ khu vực đã đăng nhập.
 *
 * `requireUser()` ở đây là chốt chặn thật: nó tra database mỗi request nên phiên
 * bị thu hồi hay tài khoản bị khoá có hiệu lực ngay. Middleware chỉ lo chuyển
 * hướng cho mượt, không thay được chốt này.
 *
 * Lưu ý cho các phase sau: layout chạy TRƯỚC page, nhưng Next.js không bảo đảm
 * layout luôn re-render khi điều hướng phía client. Vì vậy mọi page hiển thị dữ
 * liệu nhạy cảm vẫn phải tự gọi `requireUser()` / `requirePermission()` — không
 * dựa vào layout để phân quyền.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
