/**
 * CHẠY MỘT SCRIPT KIỂM THỬ TRÊN BẢN SAO CỦA DATABASE.
 *
 * Vì sao cần lớp bọc này thay vì tự đặt DATABASE_URL ở dòng lệnh: script kiểm thử
 * XOÁ dữ liệu thật. Nếu biến môi trường bị quên một lần, nó chạy thẳng vào
 * `prisma/dev.db`. Đưa việc sao chép vào code khiến chuyện đó không xảy ra được —
 * không có đường nào chạy script mà không đi qua bản sao.
 *
 * Bản sao được xoá sau khi chạy, kể cả khi script trượt hay ném lỗi.
 *
 * Dùng: node scripts/run-test-copy.mjs scripts/<tên>.ts
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const scriptKiemThu = process.argv[2];
if (!scriptKiemThu) {
  console.error('Thiếu tham số: node scripts/run-test-copy.mjs scripts/<tên>.ts');
  process.exit(2);
}

const goc = path.join('prisma', 'dev.db');
// Tên có PID để hai lần chạy song song không đạp lên nhau.
const tenBanSao = `test-copy-${process.pid}.db`;
const banSao = path.join('prisma', tenBanSao);

if (!existsSync(goc)) {
  console.error(`Không thấy ${goc}. Chạy "npm run db:setup" trước.`);
  process.exit(2);
}

function don() {
  // SQLite có thể để lại -journal / -wal / -shm bên cạnh file chính.
  for (const duoi of ['', '-journal', '-wal', '-shm']) {
    const f = banSao + duoi;
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

copyFileSync(goc, banSao);
console.log(`Bản sao: ${banSao} (dev.db không bị đụng tới)`);

/*
 * Gọi thẳng file JS của tsx bằng `process.execPath`, KHÔNG qua `npx`.
 *
 * Trên Windows, `spawnSync('npx.cmd', …)` trả EINVAL nếu không bật `shell: true`
 * — Node đã chặn việc chạy `.cmd` không qua shell. Mà bật shell thì lại phải lo
 * chuyện thoát dấu ngoặc trong đường dẫn ("Dashboard CKVN" có khoảng trắng).
 * Trỏ đúng vào `tsx/dist/cli.mjs` tránh được cả hai, và chạy như nhau trên mọi
 * hệ điều hành.
 */
const tsxCli = path.join('node_modules', 'tsx', 'dist', 'cli.mjs');
if (!existsSync(tsxCli)) {
  don();
  console.error(`Không thấy ${tsxCli}. Chạy "npm install" trước.`);
  process.exit(2);
}

try {
  const kq = spawnSync(
    process.execPath,
    // Tham số sau tên script được chuyển tiếp — script sửa dữ liệu cần cờ --yes.
    [tsxCli, '--tsconfig', 'tsconfig.test.json', scriptKiemThu, ...process.argv.slice(3)],
    {
      stdio: 'inherit',
      // Đường dẫn trong DATABASE_URL của SQLite tính từ thư mục prisma/.
      env: { ...process.env, DATABASE_URL: `file:./${tenBanSao}` },
    },
  );

  // Báo rõ lỗi spawn. Bản đầu của file này chỉ đọc `kq.status`, nên khi spawn
  // thất bại nó im lặng trả về mã 1 — trông y như bài kiểm thử trượt.
  if (kq.error) {
    console.error(`Không chạy được ${scriptKiemThu}: ${kq.error.message}`);
    process.exitCode = 2;
  } else {
    process.exitCode = kq.status ?? 1;
  }
} finally {
  don();
}
