/**
 * Build production ra thư mục riêng, không đụng vào `.next` của dev server.
 *
 * VÌ SAO CẦN FILE NÀY
 * `next dev` và `next build` mặc định dùng chung thư mục output `.next`. Trên
 * Windows, khoá file khiến dev server đang chạy **crash ngay** khi có ai chạy
 * build. Triệu chứng rất dễ chẩn đoán sai: mọi trang cùng lúc "không vào được",
 * trông như lỗi ứng dụng chứ không như lỗi tiến trình.
 *
 * Đặt biến môi trường trực tiếp trong npm script thì không chạy được trên cả
 * Windows lẫn POSIX (`VAR=x cmd` là cú pháp POSIX, `set VAR=x` là cmd.exe). Dùng
 * một script Node nhỏ là cách duy nhất không cần thêm dependency như cross-env.
 */

import { spawnSync } from 'node:child_process';

const DIST_DIR = '.next-build';

/*
 * `--skip-generate` dùng khi schema Prisma chưa đổi. Cần thiết trên Windows vì
 * `prisma generate` không ghi được file query engine khi dev server đang giữ nó.
 */
const skipGenerate = process.argv.includes('--skip-generate');

const steps = skipGenerate ? ['next build'] : ['prisma generate', 'next build'];

for (const step of steps) {
  console.log(`\n> ${step}  (distDir=${DIST_DIR})`);

  /*
   * Truyền cả câu lệnh dưới dạng MỘT chuỗi, không tách thành mảng args.
   * `shell: true` kèm mảng args làm Node cảnh báo DEP0190 (args không được escape,
   * chỉ nối chuỗi). Ở đây câu lệnh là hằng số trong code, không có đầu vào từ
   * người dùng, nên dạng chuỗi vừa an toàn vừa không sinh cảnh báo — và vẫn tìm
   * được shim .cmd của npm trên Windows.
   */
  const result = spawnSync(step, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, NEXT_DIST_DIR: DIST_DIR },
  });

  if (result.error) {
    console.error(`\nKhông chạy được "${step}":`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    // `prisma generate` thường thất bại với EPERM khi dev server đang giữ file
    // query engine. Nói rõ nguyên nhân thay vì để người dùng tự đoán.
    if (step.startsWith('prisma')) {
      console.error(
        '\nprisma generate thất bại. Nếu lỗi là EPERM/EBUSY, dev server đang giữ ' +
          'file query engine — tắt dev server rồi chạy lại, hoặc dùng ' +
          '`npm run build:app` để bỏ qua bước generate khi schema chưa đổi.',
      );
    }
    process.exit(result.status ?? 1);
  }
}

console.log(`\nBuild xong. Output ở ${DIST_DIR}/ — chạy \`npm start\` để khởi động.`);
