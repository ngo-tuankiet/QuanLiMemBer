import 'server-only';

import { cookies } from 'next/headers';
import { THEME_COOKIE, type Theme } from '@/components/theme.shared';

export { THEME_COOKIE };
export type { Theme };

/**
 * CHỦ ĐỀ ĐỌC TỪ COOKIE Ở SERVER — không dùng script chặn.
 *
 * VÌ SAO KHÔNG DÙNG SCRIPT CHẶN
 * Cách phổ biến là nhét một `<script>` đồng bộ đọc localStorage rồi gắn
 * `data-theme` lên `<html>` trước khi trang vẽ. Trong App Router cách đó có ba
 * vấn đề thật, không phải lý thuyết:
 *
 *   1. `<script>` KHÔNG được là con trực tiếp của `<html>` — HTML không hợp lệ,
 *      React báo lỗi và hydration thất bại.
 *   2. Script sửa thuộc tính của `<html>` khiến HTML của server khác của client,
 *      buộc phải dùng `suppressHydrationWarning` — tức là tắt đúng cái cảnh báo
 *      đang cần nghe.
 *   3. Nó chèn thêm một đoạn JS chặn render vào đường tải tới hạn.
 *
 * Đọc cookie ở server giải quyết cả ba: `data-theme` có sẵn trong HTML đầu tiên,
 * server và client khớp nhau tuyệt đối, và không có JavaScript nào phải chạy
 * trước khi vẽ. Không nháy sai màu, không cảnh báo bị tắt.
 *
 * Đánh đổi: layout trở thành động vì đọc cookie. Ở app này không mất gì — mọi
 * trang đều đã động do phải xác thực người dùng.
 */





/**
 * Chủ đề người dùng đã chọn.
 *
 * `'system'` là mặc định và là một lựa chọn THẬT, không phải trạng thái "chưa
 * chọn": lúc đó `<html>` không có `data-theme` và CSS đi theo
 * `prefers-color-scheme` của hệ điều hành — kể cả khi hệ điều hành tự đổi theo
 * giờ trong lúc trang đang mở.
 */
export async function getTheme(): Promise<Theme> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** Giá trị cho thuộc tính `data-theme`; `undefined` nghĩa là theo hệ thống. */
export function themeAttribute(theme: Theme): 'light' | 'dark' | undefined {
  return theme === 'system' ? undefined : theme;
}
