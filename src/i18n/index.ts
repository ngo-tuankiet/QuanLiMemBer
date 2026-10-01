import 'server-only';

/**
 * NGÔN NGỮ ĐỌC TỪ COOKIE Ở SERVER — cùng cách với chủ đề sáng/tối.
 *
 * Đọc ở server nghĩa là HTML đầu tiên đã đúng ngôn ngữ: không nháy tiếng Việt rồi đổi
 * sang tiếng Anh, không cần script chặn render, và server với client khớp nhau tuyệt
 * đối nên không phải tắt cảnh báo hydration. Chi tiết lập luận nằm ở `components/theme.ts`.
 *
 * Đánh đổi: layout thành động vì đọc cookie. Ở app này không mất gì — mọi trang đều đã
 * động do phải xác thực người dùng.
 */

import { cookies } from 'next/headers';
import { LANG_COOKIE, DEFAULT_LOCALE, laLocale, type Locale } from '@/i18n/shared';
import { vi, type Dict } from '@/i18n/vi';
import { en } from '@/i18n/en';

const BAN: Record<Locale, Dict> = { vi, en };

/** Ngôn ngữ người dùng đang chọn. Không có cookie = tiếng Việt. */
export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return laLocale(v) ? v : DEFAULT_LOCALE;
}

/** Từ điển của ngôn ngữ đang chọn, kèm chính mã ngôn ngữ đó. */
export async function getDict(): Promise<{ t: Dict; locale: Locale }> {
  const locale = await getLocale();
  return { t: BAN[locale], locale };
}

export { LANG_COOKIE, type Locale };
export type { Dict };
