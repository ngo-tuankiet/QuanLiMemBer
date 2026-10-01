/**
 * Gọi một lượt quét rủi ro qua cổng nội bộ.
 *
 *   npm run risk:scan            quét một lần
 *   npm run risk:scan -- --check chỉ xem trạng thái engine, không quét
 *
 * VÌ SAO GỌI QUA HTTP CHỨ KHÔNG IMPORT TRỰC TIẾP: `src/risk/scan.ts` đánh dấu
 * `server-only` và chạy trong ngữ cảnh Next.js. Gọi qua endpoint là đúng đường mà
 * bộ hẹn giờ sẽ dùng, nên script này kiểm chứng luôn cả đường đó — chứ không
 * kiểm chứng một đường thứ hai mà thực tế không ai đi.
 *
 * Đây cũng chính là lệnh để đưa vào Windows Task Scheduler.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Đọc .env tối giản — script này chạy bằng node trần, không qua Next.js. */
function loadEnv() {
  const file = path.join(process.cwd(), '.env');
  if (!fs.existsSync(file)) return {};

  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };

const token = env.MARKET_DATA_INGEST_TOKEN;
if (!token) {
  console.error('Thiếu MARKET_DATA_INGEST_TOKEN trong .env — endpoint sẽ trả 503.');
  process.exit(1);
}

/*
 * Địa chỉ app suy từ MARKET_DATA_INGEST_URL, chỉ thay phần đường dẫn.
 *
 * Không thêm biến APP_BASE_URL: "app đang chạy ở đâu" đã có MỘT nơi khai báo.
 * Thêm biến thứ hai cho cùng một thông tin là mời người ta đổi một cái rồi quên
 * cái kia — đúng loại lỗi mà dự án này đã phải dọn hai lần.
 */
const ingest = env.MARKET_DATA_INGEST_URL || 'http://127.0.0.1:3000/api/market-data/ingest';
const url = new URL('/api/risk/scan', ingest).toString();
const checkOnly = process.argv.includes('--check');

try {
  const response = await fetch(url, {
    method: checkOnly ? 'GET' : 'POST',
    headers: { 'x-market-data-token': token },
  });

  const body = await response.json();

  if (!response.ok) {
    console.error(`HTTP ${response.status}:`, body.error ?? body);
    process.exit(1);
  }

  if (checkOnly) {
    console.log(`Cảnh báo đang mở: ${body.openAlerts}`);
    if (body.lastRun) {
      console.log(
        `Lượt gần nhất: ${body.lastRun.status} · ${body.lastRun.trigger} · ` +
          `${body.lastRun.startedAt} · cách đây ${body.ageSeconds}s`,
      );
      if (body.lastRun.errorMessage) console.log(`Lỗi: ${body.lastRun.errorMessage}`);
    } else {
      console.log('Chưa có lượt quét nào.');
    }
  } else {
    console.log(
      `Đã quét ${body.rulesEvaluated} ngưỡng trong ${body.durationMs} ms · ` +
        `mở ${body.opened} · cập nhật ${body.updated} · đóng ${body.resolved}`,
    );
  }
} catch (error) {
  // Nguyên nhân thường gặp nhất: app chưa chạy. Nói thẳng ra thay vì in stack.
  console.error(`Không gọi được ${url}`);
  console.error(error instanceof Error ? error.message : error);
  console.error('App có đang chạy không? (npm run dev hoặc npm start)');
  process.exit(1);
}
