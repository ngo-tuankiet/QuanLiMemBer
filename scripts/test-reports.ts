/**
 * KIỂM TRANG REPORTS — dựng thật cả 9 báo cáo lẻ và tệp tổng.
 *
 * Đọc code rồi kết luận "trông ổn" không chứng minh được gì. Bài này gọi đúng
 * `buildReport` / `toCsv` / `buildArchive` mà endpoint tải tệp dùng, rồi soi kết quả.
 *
 * BỐI CẢNH QUAN TRỌNG: database vừa được dọn sạch để nạp dữ liệu thật. Đó chính là lúc
 * báo cáo dễ vỡ nhất — mảng rỗng, chia cho 0, chuỗi theo phiên không có phiên nào. Một
 * báo cáo ném lỗi ở đây nghĩa là người dùng bấm Tải về và nhận trang lỗi.
 *
 * Kiểm:
 *   1. cả 9 báo cáo dựng được, không ném lỗi
 *   2. CSV sinh ra hợp lệ: có dòng tiêu đề, số cột mọi dòng bằng nhau
 *   3. CSV chống lỗi định dạng: dấu phẩy/xuống dòng/nháy kép trong ô phải được bọc
 *   4. tệp tổng (.xlsx) dựng được và có đủ sheet
 *   5. `estimateRowCount` khớp số dòng THẬT của báo cáo — con số hiện trên trang
 *   6. trang /reports kết xuất được
 *
 * Chạy trên BẢN SAO database. Dùng: npm run test:reports
 */

import { renderToPipeableStream } from 'react-dom/server';
import type { ReactElement } from 'react';

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { REPORTS } from '@/reports/catalog';
import { buildReport, estimateRowCount, type ReportParams } from '@/reports/build';
import { toCsv } from '@/reports/csv';
import { buildArchive } from '@/reports/archive';
import { getCurrentUser } from '@/auth/guards';
import ReportsPage from '../app/(app)/reports/page';

let dat = 0;
let truot = 0;

function kiem(dieuKien: boolean, nhan: string, chiTiet = ''): void {
  if (dieuKien) {
    dat++;
    console.log(`  DAT   ${nhan}`);
  } else {
    truot++;
    console.log(`  TRUOT ${nhan}${chiTiet ? ` -> ${chiTiet}` : ''}`);
  }
}

function ketXuat(el: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const phan: Buffer[] = [];
    let xong = false;
    const { pipe } = renderToPipeableStream(el, {
      onAllReady() {
        pipe({
          write(c: unknown) {
            phan.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
            return true;
          },
          end() {
            if (!xong) { xong = true; resolve(Buffer.concat(phan).toString('utf8')); }
          },
          on() {}, once() {}, emit() {}, removeListener() {},
        } as never);
      },
      onError(e: unknown) { if (!xong) { xong = true; reject(e); } },
    });
  });
}

/**
 * Tách một dòng CSV thành các ô, TÔN TRỌNG dấu nháy kép.
 *
 * Không dùng `split(',')`: một ô hợp lệ có thể chứa dấu phẩy bên trong cặp nháy, và
 * đếm cột bằng `split` sẽ báo lệch cột cho một tệp hoàn toàn đúng — tức là bài kiểm
 * tự tạo ra lỗi giả.
 */
function tachO(dong: string): string[] {
  const o: string[] = [];
  let cur = '';
  let trongNhay = false;

  for (let i = 0; i < dong.length; i += 1) {
    const c = dong[i];
    if (trongNhay) {
      if (c === '"') {
        if (dong[i + 1] === '"') { cur += '"'; i += 1; } else { trongNhay = false; }
      } else cur += c;
    } else if (c === '"') trongNhay = true;
    else if (c === ',') { o.push(cur); cur = ''; }
    else cur += c;
  }
  o.push(cur);
  return o;
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { email: 'admin@vninvest.local' },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });
  await createSession(admin.id);

  const pf = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true, nameVi: true, name: true },
  });

  const soLenh = await prisma.trade.count();
  console.log(`Danh mục: ${pf.nameVi ?? pf.name} · ${soLenh} lệnh trong database\n`);

  const params: ReportParams = {
    portfolioId: pf.id,
    period: 'ALL',
  } as ReportParams;

  // =========================================================================
  // 1–3. Chín báo cáo lẻ
  // =========================================================================
  console.log(`1. Dựng ${REPORTS.length} báo cáo lẻ`);

  const soDongThat = new Map<string, number>();

  for (const r of REPORTS) {
    try {
      const kq = await buildReport(r.code, params);
      const csv = toCsv(kq.headers, kq.rows);
      const dong = csv.split('\n').filter((d) => d.trim() !== '');

      soDongThat.set(r.code, kq.rows.length);

      // Dòng tiêu đề phải có, và số cột phải khớp số cột đã khai.
      const cotTieuDe = dong.length > 0 ? tachO(dong[0]!).length : 0;
      const lechCot = dong
        .slice(1)
        .map((d, i) => ({ i: i + 2, n: tachO(d).length }))
        .filter((x) => x.n !== cotTieuDe);

      const ok =
        dong.length >= 1 &&
        cotTieuDe === kq.headers.length &&
        lechCot.length === 0;

      kiem(
        ok,
        `${r.code.padEnd(20)} ${String(kq.rows.length).padStart(5)} dòng · ${kq.headers.length} cột`,
        lechCot.length > 0
          ? `dòng ${lechCot[0]!.i} có ${lechCot[0]!.n} cột thay vì ${cotTieuDe}`
          : `tiêu đề ${cotTieuDe} cột vs khai ${kq.headers.length}`,
      );
    } catch (e) {
      kiem(false, `${r.code} dựng được`, String(e).split('\n')[0]?.slice(0, 120));
    }
  }

  // =========================================================================
  // 4. CSV chống lỗi định dạng
  // =========================================================================
  console.log('\n2. CSV bọc đúng ký tự nguy hiểm');
  {
    const cot = ['Có,phẩy', 'Có"nháy', 'Có xuống dòng'];
    const hang = [['x,y', 'nói "vậy"', 'dòng1\ndòng2']];

    const csv = toCsv(cot, hang);
    const dong = csv.split('\n');

    /*
     * Một ô chứa xuống dòng làm CSV có nhiều dòng vật lý hơn số bản ghi — đó là đúng
     * chuẩn. Điều phải đúng là: đọc lại bằng bộ tách tôn trọng nháy thì ra ĐÚNG 3 ô.
     */
    kiem(csv.includes('"x,y"'), 'ô chứa dấu phẩy được bọc nháy');
    kiem(csv.includes('""'), 'dấu nháy bên trong được nhân đôi', csv.slice(0, 120));
    kiem(dong.length > 2, 'ô chứa xuống dòng giữ nguyên, không bị nuốt');
  }

  // =========================================================================
  // 5. estimateRowCount khớp số dòng thật
  // =========================================================================
  console.log('\n3. Số dòng ước tính trên trang khớp số dòng thật');
  for (const r of REPORTS) {
    const uoc = await estimateRowCount(r.code, pf.id);
    const that = soDongThat.get(r.code);

    if (uoc === null) {
      console.log(`  BOQUA ${r.code.padEnd(20)} không ước tính (thiết kế)`);
      continue;
    }
    kiem(
      uoc === that,
      `${r.code.padEnd(20)} ước ${uoc} · thật ${that}`,
      `lệch ${uoc !== undefined && that !== undefined ? uoc - that : '?'}`,
    );
  }

  // =========================================================================
  // 6. Tệp tổng
  // =========================================================================
  console.log('\n4. Tệp tổng (.xlsx)');
  try {
    const actor = await getCurrentUser();
    const kq = await buildArchive({
      actor: actor!,
      params,
      portfolioCode: 'TEST',
      includeAudit: true,
    });

    kiem(
      kq.buffer.byteLength > 1_000,
      `dựng được · ${(kq.buffer.byteLength / 1024).toFixed(1)} KB · ${kq.totalRows} dòng`,
    );
    // .xlsx là tệp ZIP — hai byte đầu phải là chữ ký PK.
    kiem(kq.buffer[0] === 0x50 && kq.buffer[1] === 0x4b, 'đúng định dạng ZIP/xlsx (chữ ký PK)');
    kiem(kq.filename.endsWith('.xlsx'), `tên tệp đúng đuôi: ${kq.filename}`);

    const sheet = Object.keys(kq.rowCounts);
    console.log(`        ${sheet.length} sheet: ${sheet.join(", ")}`);
    kiem(sheet.length >= REPORTS.length, `có đủ ${REPORTS.length} sheet báo cáo`, `${sheet.length}`);
  } catch (e) {
    kiem(false, 'tệp tổng dựng được', String(e).split('\n')[0]?.slice(0, 140));
  }

  // =========================================================================
  // 7. Trang /reports
  // =========================================================================
  console.log('\n5. Trang /reports');
  try {
    const html = await ketXuat(
      await (ReportsPage as unknown as () => Promise<ReactElement>)(),
    );
    kiem(html.length > 2_000, `kết xuất được · ${html.length} ký tự`);

    let thieu = 0;
    for (const r of REPORTS) {
      if (!html.includes(r.nameVi)) {
        thieu += 1;
        console.log(`        thiếu: ${r.nameVi}`);
      }
    }
    kiem(thieu === 0, `trang nêu đủ ${REPORTS.length} báo cáo`);
  } catch (e) {
    kiem(false, 'trang kết xuất được', String(e).split('\n')[0]?.slice(0, 140));
  }

  console.log(`\n===== ${dat} đạt, ${truot} trượt =====`);
  if (truot > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('\nLOI:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
