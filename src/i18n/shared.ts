/**
 * Hằng số ngôn ngữ dùng chung cho CẢ server và client.
 *
 * Phải nằm riêng khỏi `index.ts`: file đó có `import 'server-only'` nên component
 * phía client import vào sẽ lỗi build. Cùng lý do và cùng cách làm với
 * `components/theme.shared.ts`.
 */

export const LANG_COOKIE = 'vn-lang';

export const LOCALES = ['vi', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'vi';

export const LOCALE_LABEL: Record<Locale, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
};

/** Nhãn ngắn cho nút đổi ngôn ngữ. */
export const LOCALE_SHORT: Record<Locale, string> = {
  vi: 'VI',
  en: 'EN',
};

export function laLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/**
 * TÊN CỦA MỘT BẢN GHI THEO NGÔN GỮ ĐANG XEM.
 *
 * Database đã song ngữ sẵn: `name` (Anh) và `nameVi` (Việt) có ở phòng ban, nhóm,
 * chiến lược, ngành, vai trò, quyền. Nên đổi tên hiển thị KHÔNG phải việc dịch — chỉ
 * là đọc đúng cột.
 *
 * RƠI VỀ CỘT CÒN LẠI KHI RỖNG. `nameVi` là nullable ở vài bảng, và một bản ghi thiếu
 * tên tiếng Việt mà hiện ra chuỗi rỗng thì tệ hơn nhiều so với hiện tên tiếng Anh.
 */
export function tenTheoNgonNgu(
  entity: { name?: string | null; nameVi?: string | null },
  locale: Locale,
): string {
  const vi = entity.nameVi?.trim();
  const en = entity.name?.trim();
  return (locale === 'vi' ? (vi || en) : (en || vi)) ?? '';
}
