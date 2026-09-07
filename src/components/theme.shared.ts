/**
 * Hằng số chủ đề dùng chung cho CẢ server và client.
 *
 * Phải nằm riêng khỏi `theme.ts`: file đó có `import 'server-only'` nên client
 * import vào sẽ lỗi build. Tách hằng số ra đây để hai phía dùng đúng một tên
 * cookie, không phải khai báo hai lần rồi lệch nhau.
 */

export const THEME_COOKIE = 'vn-theme';

export type Theme = 'light' | 'dark' | 'system';
