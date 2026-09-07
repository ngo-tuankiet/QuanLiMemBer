/**
 * Băm và kiểm tra mật khẩu.
 *
 * bcrypt với cost 12. Không dùng SHA/MD5 — chúng nhanh, và với mật khẩu thì
 * nhanh nghĩa là dễ brute-force.
 */

import bcrypt from 'bcryptjs';

/** Cost 12 ≈ 250ms trên CPU hiện đại: đủ chậm để chống dò, đủ nhanh để đăng nhập. */
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * So sánh giả khi email không tồn tại.
 *
 * Nếu bỏ qua bước này, thời gian phản hồi của "email không tồn tại" (nhanh) khác
 * hẳn "sai mật khẩu" (chậm vì phải bcrypt) — kẻ tấn công dò được email nào có
 * trong hệ thống. Hàm này tiêu tốn đúng lượng thời gian tương đương.
 */
export async function fakeVerifyDelay(): Promise<void> {
  await bcrypt.compare(
    'dummy-password-for-timing-equalisation',
    '$2b$12$C9tK7HRxJDwGZLxvJmVeAOTBqOAlXQ5UUwNRfBnV9M7VLZKMlqBQi',
  );
}

/** Mật khẩu nằm trong danh sách phổ biến thì từ chối, dù có đủ độ phức tạp. */
const COMMON_PASSWORDS = new Set([
  'password123',
  'Password123',
  'Password@123',
  'Admin@123456',
  '123456789012',
  'qwertyuiop12',
  'Vietnam@2026',
  'ChangeMe@2026',
]);

export function isCommonPassword(plain: string): boolean {
  return COMMON_PASSWORDS.has(plain);
}
