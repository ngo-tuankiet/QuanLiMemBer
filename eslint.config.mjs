/**
 * CẤU HÌNH ESLINT (flat config).
 *
 * Thay cho `.eslintrc.json` + `next lint`: từ Next 16, `next lint` đã bị bỏ, và
 * ESLint 9 chỉ đọc file này. Script `npm run lint` gọi thẳng `eslint .`.
 *
 * Bộ quy tắc giữ nguyên như trước — core-web-vitals của Next, cộng thêm phần
 * TypeScript. Chưa hạ hay siết quy tắc nào ở nhịp này: mục đích trước hết là
 * ĐẾM xem có bao nhiêu lỗi và thuộc loại gì, rồi mới quyết định xử lý.
 */

import { defineConfig, globalIgnores } from 'eslint/config';
import next from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  globalIgnores([
    '.next/**',
    // Bản build ghi ra thư mục riêng để không khoá file của server dev đang chạy.
    '.next-build/**',
    'node_modules/**',
    'prisma/generated/**',
    'src/generated/**',
    'public/**',
    // Môi trường ảo Python: JS đóng gói sẵn của matplotlib, không phải mã của dự án.
    '**/.venv/**',
  ]),
  next,
  nextTs,
  {
    /*
     * DẤU GẠCH DƯỚI = "CỐ Ý BỎ".
     *
     * `const { quantityMicro: _drop, ...view } = pos` là cách bỏ một trường ra khỏi
     * object; `_prev` là tham số bắt buộc của `useActionState` mà hành động không
     * dùng tới. Cả hai đều PHẢI viết ra mới chạy đúng — xoá đi là hỏng code.
     *
     * Đây không phải hạ quy tắc mà là khai báo quy ước sẵn có của mã nguồn: biến
     * bắt đầu bằng `_` là đã nói rõ "biết thừa, cố tình". Biến thừa thật sự vẫn bị
     * bắt như cũ.
     */
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
]);
