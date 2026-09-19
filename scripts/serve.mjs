/**
 * Chạy server production, phục vụ ĐÚNG thư mục mà `npm run build` đã ghi ra.
 *
 * VÌ SAO CẦN FILE NÀY — MỘT LỖI IM LẶNG ĐÃ ĐO ĐƯỢC.
 *
 * `next.config.ts` đặt `distDir: process.env.NEXT_DIST_DIR ?? '.next'`, và
 * `scripts/build.mjs` đặt biến đó thành `.next-build` để build không đụng vào `.next`
 * của dev server. Nhưng `npm start` trước đây là `next start` TRẦN — không có biến đó,
 * nên nó rơi về `.next`, tức là thư mục dev server dùng.
 *
 * Nó không báo lỗi. `.next` có sẵn `BUILD_ID` từ một lần build cũ nên `next start`
 * khởi động bình thường, trả HTTP 200, trông y như đang chạy đúng. Đo lúc phát hiện:
 *
 *     .next/BUILD_ID        25/08  (cũ 9 ngày)
 *     .next-build/BUILD_ID  03/09  (bản vừa build)
 *
 * Nghĩa là ai build rồi khởi động lại sẽ phục vụ code của chín ngày trước mà không có
 * dấu hiệu gì. Đây là kiểu sai tệ nhất: không lỗi, không cảnh báo, chỉ là dữ liệu và
 * giao diện của một phiên bản khác.
 *
 * KIỂM TRƯỚC KHI CHẠY. Thư mục build phải tồn tại và phải MỚI HƠN `.next`; nếu không
 * thì nói thẳng thay vì lặng lẽ phục vụ bản cũ.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const DIST_DIR = '.next-build';
const buildId = path.join(DIST_DIR, 'BUILD_ID');

if (!existsSync(buildId)) {
  console.error(
    `Chưa có build production tại ${DIST_DIR}/.\n` +
      'Chạy `npm run build` (hoặc `npm run build:app` nếu schema Prisma chưa đổi) trước.',
  );
  process.exit(1);
}

/*
 * Cảnh báo khi build đã cũ hơn mã nguồn.
 *
 * So với `package.json` chứ không quét cả cây nguồn: quét cây thì phải bỏ qua
 * node_modules, .next, logs… và mỗi lần bỏ sót một thư mục là một cảnh báo sai. Mốc
 * này không bắt được mọi trường hợp, nên nó CẢNH BÁO chứ không chặn — chặn dựa trên
 * một phép đo không đầy đủ sẽ làm người dùng học cách bỏ qua nó.
 */
const tuoiBuild = statSync(buildId).mtimeMs;
const nguon = ['package.json', 'next.config.ts', 'prisma/schema.prisma']
  .filter((f) => existsSync(f))
  .map((f) => ({ f, t: statSync(f).mtimeMs }))
  .filter((x) => x.t > tuoiBuild);

if (nguon.length > 0) {
  console.warn(
    `Cảnh báo: ${DIST_DIR}/ cũ hơn ${nguon.map((x) => x.f).join(', ')}. ` +
      'Có thể cần build lại.',
  );
}

console.log(`> next start  (distDir=${DIST_DIR})`);

/*
 * GỌI THẲNG FILE `next`, KHÔNG GỌI TÊN `next`.
 *
 * `next` chỉ có trên PATH khi npm thêm `node_modules/.bin` vào — tức là chỉ khi
 * chạy qua `npm start`. Chạy `node scripts/serve.mjs` trực tiếp (từ một shell khác,
 * từ Task Scheduler, từ thư mục Startup) thì shell không tìm thấy `next` và báo
 * "'next' is not recognized" — trong khi Node dùng để chạy chính file này vẫn ở đó.
 *
 * Chỉ ra đúng file JS và chạy nó bằng `process.execPath` thì không phụ thuộc PATH,
 * cũng không cần `shell: true` (xem lỗi EINVAL với .cmd trên Windows ở chỗ khác).
 */
const nextBin = path.join('node_modules', 'next', 'dist', 'bin', 'next');

if (!existsSync(nextBin)) {
  console.error(`Không tìm thấy ${nextBin}. Chạy \`npm install\` trước.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [nextBin, 'start', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NEXT_DIST_DIR: DIST_DIR },
});

if (result.error) {
  console.error('Không chạy được next start:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 0);
