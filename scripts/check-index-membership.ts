/**
 * ĐỐI CHIẾU RỔ CHỈ SỐ TRONG SEED VỚI RỔ THẬT.
 *
 * VÌ SAO CẦN. `VN30_SEED` và `VN100_SEED` trong `src/data/master-data.ts` là danh
 * sách viết tay. Rổ được cơ cấu lại mỗi kỳ, nên danh sách viết tay sẽ cũ đi — và một
 * mã sai trong đó trông y hệt một mã đúng. Trước khi có phép kiểm này, cờ VN30 trong
 * seed đã **lệch 11 mã** (thừa TPB BVH BCM PLX POW, thiếu BSR LPB MCH TCX VIB VPL)
 * mà không có gì báo, dù `isVn30` được dùng thật ở báo cáo và ở thứ tự mã trên form
 * nhập lệnh.
 *
 * Script này KHÔNG tự sửa seed. Quyết định mã nào vào master data là của app (§7):
 * thêm một mã còn cần phân ngành, mà phân ngành là việc con người phải xem. Script
 * chỉ nói chỗ nào lệch và cần làm gì.
 *
 * Không có mạng hoặc chưa cài venv thì script THOÁT SẠCH với thông báo, không báo
 * lệch — "không kiểm được" khác "kiểm rồi và khớp".
 *
 * Dùng: npm run check:index
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { STOCK_SEED, VN30_SEED, VN100_SEED } from '../src/data/master-data';

const ROI = ['VN30', 'VN100'] as const;

function layRoTuNguon(): Record<string, string[]> | null {
  const cwd = path.join(process.cwd(), 'services', 'market-data');
  const python = path.join(cwd, '.venv', 'Scripts', 'python.exe');

  if (!existsSync(python)) {
    console.log(`Chưa có venv tại ${path.relative(process.cwd(), python)} — bỏ qua.`);
    return null;
  }

  /*
   * Nhận kết quả qua FILE, không qua stdout: `vnstock` in banner quảng cáo ra chính
   * stdout mỗi lần import, nên đọc stdout là phải đoán dòng nào là JSON.
   */
  const thuMuc = mkdtempSync(path.join(tmpdir(), 'vn-index-'));
  const fileKq = path.join(thuMuc, 'groups.json');

  try {
    const kq = spawnSync(
      python,
      ['sync.py', 'groups', '--groups', ROI.join(','), '--out', fileKq],
      { cwd, encoding: 'utf8', timeout: 180_000, windowsHide: true },
    );

    if (kq.error) {
      console.log(`Không chạy được service: ${kq.error.message} — bỏ qua.`);
      return null;
    }
    if (!existsSync(fileKq)) {
      const loi = (kq.stderr || '').split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
      console.log(`Service không trả về dữ liệu${loi ? `: ${loi}` : ''} — bỏ qua.`);
      return null;
    }

    return JSON.parse(readFileSync(fileKq, 'utf8')) as Record<string, string[]>;
  } finally {
    rmSync(thuMuc, { recursive: true, force: true });
  }
}

function main(): void {
  const nguon = layRoTuNguon();
  if (!nguon) {
    console.log('KHÔNG KIỂM ĐƯỢC — khác với "đã kiểm và khớp".');
    return;
  }

  const trongSeed: Record<string, readonly string[]> = { VN30: VN30_SEED, VN100: VN100_SEED };
  const maCoSan = new Set(STOCK_SEED.map((s) => s.symbol));

  let lech = 0;

  for (const ro of ROI) {
    const thuc = new Set(nguon[ro] ?? []);
    const seed = new Set(trongSeed[ro] ?? []);

    const thua = [...seed].filter((x) => !thuc.has(x)).sort();
    const thieu = [...thuc].filter((x) => !seed.has(x)).sort();

    console.log(`\n${ro}: seed ${seed.size} mã · nguồn ${thuc.size} mã`);

    if (thua.length === 0 && thieu.length === 0) {
      console.log('  KHỚP');
      continue;
    }

    lech += thua.length + thieu.length;
    if (thua.length > 0) console.log(`  seed THỪA (đã rời rổ): ${thua.join(' ')}`);
    if (thieu.length > 0) console.log(`  seed THIẾU (mới vào rổ): ${thieu.join(' ')}`);

    /*
     * Tách riêng phần "mã mới vào rổ mà master data cũng chưa có". Đây là nhóm tốn
     * công nhất: thêm vào `VN100_SEED` là chưa đủ, còn phải khai `s(...)` kèm phân
     * ngành, nếu không seed sẽ dừng với lỗi (xem phép kiểm trong prisma/seed.ts).
     */
    const chuaCoMaster = thieu.filter((x) => !maCoSan.has(x));
    if (chuaCoMaster.length > 0) {
      console.log(
        `  trong đó ${chuaCoMaster.length} mã CHƯA có trong STOCK_SEED, cần khai kèm ngành: ${chuaCoMaster.join(' ')}`,
      );
    }
  }

  if (lech === 0) {
    console.log('\nCả hai rổ khớp với nguồn.');
    return;
  }

  console.log(
    [
      `\n${lech} điểm lệch. Cách sửa, trong src/data/master-data.ts:`,
      '  1. Cập nhật VN30_SEED / VN100_SEED theo danh sách trên.',
      '  2. Mã mới chưa có trong STOCK_SEED thì thêm dòng s(...) kèm ngành và phân ngành.',
      '  3. npm run db:seed',
      '',
      'Không xoá dòng s(...) của mã đã rời rổ: mã rời VN100 vẫn có thể đang được nắm giữ,',
      'và cổng nạp lấy giá theo HỢP của "đang đầu tư" và VN100 nên vị thế đó vẫn có giá.',
    ].join('\n'),
  );
  process.exitCode = 1;
}

main();
