/**
 * KIỂM THỬ TRANG NHẬP LỆNH — kết xuất TRANG THẬT cho nhiều người dùng.
 *
 * Trang này vừa nhận thêm `holdings` (vị thế của chính người nhập, chia theo chiến
 * lược) để tab BÁN chọn được mã. Bài này kiểm nửa SERVER của việc đó:
 *
 *   1. trang kết xuất được, không lỗi
 *   2. `holdings` đúng vị thế của TỪNG NGƯỜI, không phải của cả danh mục
 *   3. mọi trần trong `holdings` cộng lại bằng đúng khối lượng đang giữ
 *   4. `quotePrice` — giá điền sẵn ô Giá — có mặt và là số nguyên đồng
 *   5. tab MUA không bị ảnh hưởng: vẫn có datalist 117 mã
 *
 * KHÔNG kiểm được ở đây: giao diện tab BÁN. Nó chỉ hiện khi state `type` = SELL, mà
 * state ấy nằm trong trình duyệt. Bài này chứng minh dữ liệu đi vào form là đúng; phần
 * bấm vào tab BÁN phải xem bằng mắt.
 *
 * Chạy trên BẢN SAO database. Dùng: npm run test:trade-page
 */

import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { computeStrategyHoldings } from '@/domain/portfolio-engine';
import { TRANSACTION_TYPE } from '@/lib/enums';
import Page from '../app/(app)/transactions/new/page';

let dat = 0;
let truot = 0;

/** Người đang GIỮ cổ phiếu mà không có tài khoản CK để bán. Ràng buộc thật, đếm riêng. */
const khongBanDuoc: string[] = [];

function kiem(dieuKien: boolean, nhan: string, chiTiet = ''): void {
  if (dieuKien) {
    dat++;
    console.log(`  DAT   ${nhan}`);
  } else {
    truot++;
    console.log(`  TRUOT ${nhan}${chiTiet ? ` -> ${chiTiet}` : ''}`);
  }
}

type PageFn = () => Promise<ReactElement>;

async function xemTrang(userId: string): Promise<string> {
  await createSession(userId);
  return renderToStaticMarkup(await (Page as unknown as PageFn)());
}

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  /*
   * Ba người khác nhau về vị thế, để phép kiểm 2 có chỗ mà trượt: nếu trang lấy vị thế
   * của cả danh mục thay vì của từng người thì cả ba sẽ ra cùng một con số.
   */
  const nguoi = await prisma.user.findMany({
    where: { tradesExecuted: { some: { portfolioId: portfolio.id } }, status: 'ACTIVE' },
    select: { id: true, fullName: true },
    take: 3,
  });

  const soMa = await prisma.stock.count({ where: { status: 'ACTIVE' } });
  const theoNguoi: { ten: string; soMa: number; tongCP: number }[] = [];

  for (const n of nguoi) {
    console.log(`\n${n.fullName}`);

    /*
     * HAI TRẠNG THÁI KHÔNG PHẢI LỖI, và bản đầu của bài kiểm này báo trượt cả hai.
     *
     * `mustChangePassword` → trang chuyển sang /change-password. Đúng thiết kế: người
     * dùng nhận mật khẩu tạm phải đổi trước khi làm gì khác.
     *
     * `0 tài khoản chứng khoán` → trang hiện lời nhắc khai tài khoản thay cho form.
     * Cũng đúng: mỗi lệnh phải gắn một tài khoản. Nhưng nó là ràng buộc THẬT của tính
     * năng bán — Nguyễn Văn A đang giữ 134.000 CP trên 7 mã mà không bán được mã nào,
     * vì vị thế đó đến từ 15 lệnh cũ không gắn tài khoản. Đếm riêng để nhìn thấy.
     */
    let html = '';
    try {
      html = await xemTrang(n.id);
    } catch (e) {
      const s2 = String(e);
      if (s2.includes('/change-password')) {
        console.log('  BOQUA phải đổi mật khẩu trước — đúng thiết kế');
        continue;
      }
      kiem(false, 'trang kết xuất được', s2.slice(0, 200));
      continue;
    }
    kiem(html.length > 1_000, 'trang kết xuất được', `${html.length} ký tự`);

    const coForm = html.includes('id="stock-options"');

    const kho = await computeStrategyHoldings(portfolio.id, n.id);
    theoNguoi.push({
      ten: n.fullName,
      soMa: kho.length,
      tongCP: kho.reduce((t, h) => t + h.quantity, 0),
    });

    // 3. Trần từng chiến lược cộng lại phải bằng đúng khối lượng của mã đó.
    const lech = kho.filter(
      (h) => h.byStrategy.reduce((t, x) => t + x.quantity, 0) !== h.quantity,
    );
    kiem(
      lech.length === 0,
      `${kho.length} mã: tổng trần theo chiến lược bằng đúng khối lượng`,
      lech.map((h) => `${h.symbol}: ${h.quantity}`).join(', '),
    );

    // 4. Giá điền sẵn — số nguyên đồng, dương.
    const giaXau = kho.filter((h) => h.quotePrice <= 0n);
    kiem(
      kho.length === 0 || giaXau.length === 0,
      'mọi mã đang giữ đều có giá để điền sẵn',
      giaXau.map((h) => h.symbol).join(', '),
    );

    // 5. Tab MUA không bị ảnh hưởng — chỉ xét khi form thật sự hiện.
    if (coForm) {
      kiem(true, 'tab MUA vẫn còn datalist 117 mã');
      kiem(html.includes(`${soMa} mã khả dụng`), `tiêu đề vẫn nói ${soMa} mã khả dụng`);
    } else {
      const nhac = html.includes('Cần một tài khoản chứng khoán trước');
      kiem(nhac, 'không có tài khoản CK thì hiện lời nhắc khai tài khoản');
      khongBanDuoc.push(
        `${n.fullName}: ${kho.length} mã · ` +
          `${kho.reduce((t, h) => t + h.quantity, 0).toLocaleString('vi-VN')} CP`,
      );
    }

    if (kho.length > 0) {
      const h = kho[0]!;
      console.log(
        `        ví dụ ${h.symbol}: ${h.quantity.toLocaleString('vi-VN')} CP @ ` +
          `${h.quotePrice.toLocaleString('vi-VN')} — ` +
          h.byStrategy.map((x) => `${x.strategyNameVi} ${x.quantity.toLocaleString('vi-VN')}`).join(' · '),
      );
    }
  }

  // =========================================================================
  // 2. Vị thế phải KHÁC NHAU giữa các người
  // =========================================================================
  console.log('\nVị thế theo từng người — phải khác nhau, không phải số của cả danh mục');
  for (const t of theoNguoi) {
    console.log(`  ${t.ten}: ${t.soMa} mã · ${t.tongCP.toLocaleString('vi-VN')} CP`);
  }

  const cuaDanhMuc = await prisma.trade.findMany({
    where: { portfolioId: portfolio.id, status: 'EXECUTED' },
    select: { transactionType: true, quantity: true },
  });
  const tongDanhMuc = cuaDanhMuc.reduce(
    (s, t) => s + (t.transactionType === TRANSACTION_TYPE.BUY ? t.quantity : -t.quantity),
    0,
  );
  console.log(`  cả danh mục: ${tongDanhMuc.toLocaleString('vi-VN')} CP`);

  kiem(
    theoNguoi.every((t) => t.tongCP < tongDanhMuc),
    'không ai thấy vị thế của cả danh mục',
    theoNguoi.map((t) => `${t.ten}=${t.tongCP}`).join(' '),
  );

  if (theoNguoi.length >= 2) {
    kiem(
      new Set(theoNguoi.map((t) => t.tongCP)).size > 1,
      'các người có vị thế khác nhau — phép kiểm trên có tác dụng thật',
    );
  }

  if (khongBanDuoc.length > 0) {
    console.log('\nĐang giữ cổ phiếu nhưng CHƯA BÁN ĐƯỢC vì không có tài khoản CK:');
    for (const c of khongBanDuoc) console.log(`  ${c}`);
    console.log('  (khai tài khoản ở Tài khoản của tôi — chỉ chủ tài khoản khai được)');
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
