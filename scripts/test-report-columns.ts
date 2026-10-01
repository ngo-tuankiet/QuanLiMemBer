/**
 * KIỂM THỬ BA NHÓM CỘT MỚI CỦA BÁO CÁO.
 *
 *   1. `positions`      — cổ tức tách riêng khỏi lãi/lỗ giá
 *   2. `transactions` / `capital-flows` — tài khoản chứng khoán
 *   3. tệp tổng         — master data IB và tài khoản chứng khoán
 *
 * VÌ SAO CẦN BA NHÓM NÀY. Cả ba đều là chỗ báo cáo NÓI ÍT HƠN MÀN HÌNH, và kiểu sai
 * đó không bao giờ báo lỗi: tệp vẫn tải được, số vẫn cộng được, chỉ là nó trả lời
 * một câu khác với câu người đọc tưởng mình đang hỏi.
 *
 * MỖI PHÉP KIỂM PHẢI PHÂN BIỆT ĐƯỢC. Kiểm "có cột dividend_cash_vnd" là vô nghĩa nếu
 * giá trị luôn bằng 0 — cột rỗng thì có cũng như không. Nên bài này GHI MỘT ĐỢT CỔ
 * TỨC THẬT rồi đòi hai cột phần trăm phải KHÁC nhau.
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:report-columns
 */

import { prisma } from '@/lib/prisma';
import { buildReport } from '@/reports/build';
import { toCsv } from '@/reports/csv';
import { masterDataSheets } from '@/reports/archive';
import { createSession } from '@/auth/session';
import { ROLE, USER_STATUS, PORTFOLIO_STATUS } from '@/lib/enums';

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

const P = process.pid;

/** Cắt CSV thành mảng ô theo dòng — đủ dùng cho dữ liệu bài kiểm (không có dấu phẩy trong ô). */
function bang(csv: string): string[][] {
  return csv
    .trim()
    .split(/\r?\n/)
    .map((d) => d.split(','));
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true, email: true },
  });
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });
  await createSession(admin.id);

  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    select: { id: true },
  });
  const chienLuoc = await prisma.strategy.findFirstOrThrow({
    where: { isActive: true },
    select: { id: true },
  });

  // --- Dàn cảnh: IB có biểu phí RIÊNG + một IB để TRỐNG hoàn toàn -------
  const ibRieng = await prisma.introducingBroker.create({
    data: {
      code: `RC_RIENG_${P}`,
      name: 'IB khai riêng',
      broker: 'SSI',
      buyFeeRateBps: 15,
      sellFeeRateBps: 20,
      sellTaxRateBps: 0, // 0 THẬT: miễn thuế, khác hẳn "chưa khai"
    },
    select: { id: true, code: true },
  });
  const ibTrong = await prisma.introducingBroker.create({
    data: { code: `RC_TRONG_${P}`, name: 'IB theo mức chung', broker: 'SSI' },
    select: { id: true, code: true },
  });

  const tk = await prisma.brokerAccount.create({
    data: {
      userId: admin.id,
      broker: 'SSI',
      accountNo: `RC${P}`,
      ibId: ibRieng.id,
    },
    select: { id: true, accountNo: true },
  });

  const ma = await prisma.stock.findFirstOrThrow({
    where: { status: 'ACTIVE', trades: { none: {} } },
    select: { id: true, symbol: true },
  });

  const lenh = await prisma.trade.create({
    data: {
      code: `RC${P}`,
      portfolioId: portfolio.id,
      stockId: ma.id,
      brokerAccountId: tk.id,
      userId: admin.id,
      createdById: admin.id,
      transactionType: 'BUY',
      status: 'EXECUTED',
      quantity: 1000,
      price: 20_000n,
      fees: 0n,
      tax: 0n,
      executedAt: new Date(2026, 0, 5),
      strategies: {
        create: [{ strategyId: chienLuoc.id, allocationBps: 10_000, allocationAmount: 20_000_000n }],
      },
    },
    select: { id: true, code: true },
  });

  /*
   * CỔ TỨC TIỀN MẶT THẬT — không có nó thì mọi phép kiểm về cột cổ tức đều vô nghĩa:
   * cột toàn số 0 vẫn "có mặt" đúng như khi tính năng chưa được làm.
   */
  await prisma.capitalFlow.create({
    data: {
      portfolioId: portfolio.id,
      brokerAccountId: tk.id,
      stockId: ma.id,
      flowType: 'DIVIDEND',
      status: 'CONFIRMED',
      amount: 1_500_000n,
      occurredAt: new Date(2026, 0, 20),
      createdById: admin.id,
    },
  });

  const params = { portfolioId: portfolio.id, period: 'ALL' as const };

  console.log(`\nMã: ${ma.symbol} · TK: SSI ${tk.accountNo} · IB: ${ibRieng.code}`);

  // =====================================================================
  console.log('\n1. positions — cổ tức tách riêng khỏi lãi/lỗ giá');
  // =====================================================================
  {
    const kq = await buildReport('positions', params);
    const b = bang(toCsv(kq.headers, kq.rows));
    const h = b[0]!;
    const dong = b.find((r) => r[0] === ma.symbol);

    for (const cot of ['dividend_cash_vnd', 'total_return_vnd', 'total_return_pct']) {
      kiem(h.includes(cot), `có cột ${cot}`, h.join(','));
    }
    kiem(dong !== undefined, `có dòng ${ma.symbol}`);

    const o = (ten: string) => dong?.[h.indexOf(ten)] ?? '';
    kiem(o('dividend_cash_vnd') === '1500000', 'cổ tức = 1.500.000', o('dividend_cash_vnd'));

    /*
     * ĐỐI CHỨNG QUAN TRỌNG NHẤT CỦA CẢ BÀI.
     *
     * Nếu `total_return_pct` chỉ là bản sao của `return_pct` thì ba cột mới có mặt
     * nhưng không mang thêm thông tin nào — đúng trạng thái trước khi sửa. Ở đây có
     * 1,5 triệu cổ tức nên hai con số BẮT BUỘC khác nhau.
     */
    kiem(
      o('return_pct') !== o('total_return_pct'),
      'return_pct KHÁC total_return_pct — cổ tức thật sự được cộng vào',
      `${o('return_pct')} vs ${o('total_return_pct')}`,
    );
    kiem(
      Number(o('total_return_pct')) > Number(o('return_pct')),
      'tổng sinh lời LỚN HƠN lãi/lỗ giá',
    );
    kiem(
      BigInt(o('total_return_vnd')) - BigInt(o('unrealized_pnl_vnd')) === 1_500_000n,
      'tổng trừ lãi/lỗ giá = đúng phần cổ tức',
      `${o('total_return_vnd')} - ${o('unrealized_pnl_vnd')}`,
    );
  }

  // =====================================================================
  console.log('\n2. transactions — tài khoản chứng khoán');
  // =====================================================================
  {
    const kq = await buildReport('transactions', params);
    const b = bang(toCsv(kq.headers, kq.rows));
    const h = b[0]!;
    const dong = b.find((r) => r[0] === lenh.code);

    for (const cot of ['broker', 'account_no', 'ib']) {
      kiem(h.includes(cot), `có cột ${cot}`, h.join(','));
    }
    const o = (ten: string) => dong?.[h.indexOf(ten)] ?? '';
    kiem(o('broker') === 'SSI', 'sàn = SSI', o('broker'));
    kiem(o('account_no') === tk.accountNo, 'đúng số tài khoản', o('account_no'));
    kiem(o('ib') === ibRieng.code, 'đúng mã IB', o('ib'));
  }

  // =====================================================================
  console.log('\n3. capital-flows — tài khoản, nhóm và mã cổ phiếu');
  // =====================================================================
  {
    const kq = await buildReport('capital-flows', params);
    const b = bang(toCsv(kq.headers, kq.rows));
    const h = b[0]!;

    for (const cot of ['broker', 'account_no', 'team', 'symbol']) {
      kiem(h.includes(cot), `có cột ${cot}`, h.join(','));
    }

    const ct = b.find((r) => r[h.indexOf('flow_type')] === 'DIVIDEND');
    kiem(ct !== undefined, 'có dòng cổ tức');
    kiem(
      ct?.[h.indexOf('symbol')] === ma.symbol,
      'dòng cổ tức nêu ĐÚNG MÃ — trước đây không nói mã nào',
      ct?.[h.indexOf('symbol')],
    );
    kiem(
      ct?.[h.indexOf('account_no')] === tk.accountNo,
      'dòng cổ tức nêu đúng tài khoản',
      ct?.[h.indexOf('account_no')],
    );

    /*
     * ĐỐI CHỨNG: dòng NẠP không có mã. Thiếu ca này thì một cài đặt điền bừa cùng một
     * mã cho mọi dòng vẫn qua được phép kiểm trên.
     */
    const nap = b.find((r) => r[h.indexOf('flow_type')] === 'CONTRIBUTION');
    if (nap) {
      kiem(
        nap[h.indexOf('symbol')] === '',
        'dòng nạp vốn KHÔNG có mã — cột không bị điền bừa',
        nap[h.indexOf('symbol')],
      );
    } else {
      console.log('  (bỏ qua đối chứng dòng nạp — bản sao không có dòng nào)');
    }
  }

  // =====================================================================
  console.log('\n4. Tệp tổng — master data IB và tài khoản chứng khoán');
  // =====================================================================
  {
    /*
     * ĐỌC THẲNG DỮ LIỆU MASTER DATA, không qua Buffer .xlsx.
     *
     * `buildArchive` trả về một tệp đã đóng gói; muốn kiểm "ô phí để TRỐNG chứ không
     * phải 0" thì phải giải nén ZIP và đọc XML — lúc đó bài kiểm đang đo bộ giải mã
     * của chính nó. Sheet nào có mặt trong tệp thì `test:reports` đã kiểm rồi.
     */
    const sheets = await masterDataSheets();
    const ten = sheets.map((s) => s.name);

    kiem(ten.includes('MD IB'), 'có sheet MD IB', ten.join(', '));
    kiem(
      ten.includes('MD Tài khoản chứng khoán'),
      'có sheet MD Tài khoản chứng khoán',
      ten.join(', '),
    );

    const sIb = sheets.find((s) => s.name === 'MD IB')!;
    const hIb = sIb.headers.map(String);
    const dIb = sIb.rows.map((r) => r.map((c) => String(c ?? '')));

    const rieng = dIb.find((r) => r[0] === ibRieng.code);
    const trong = dIb.find((r) => r[0] === ibTrong.code);
    kiem(rieng !== undefined && trong !== undefined, 'có cả hai IB vừa tạo');

    const oIb = (r: string[] | undefined, c: string) => r?.[hIb.indexOf(c)] ?? '(thiếu)';
    kiem(oIb(rieng, 'buy_fee_pct') === '0.15', 'IB khai riêng: phí mua 0.15', oIb(rieng, 'buy_fee_pct'));

    /*
     * PHÉP KIỂM ĐẮT NHẤT CỦA MỤC NÀY: Ô TRỐNG ≠ SỐ 0.
     *
     * `null` nghĩa là "theo mức chung", `0` nghĩa là "miễn phí". Xuất `null` thành 0 sẽ
     * biến mọi IB chưa khai riêng thành IB miễn phí NGAY TRONG TỆP LƯU TRỮ — mà đó là
     * tệp người ta mở ra để đối chiếu nhiều năm sau, khi không còn ai nhớ mức chung là
     * bao nhiêu.
     */
    kiem(
      oIb(trong, 'buy_fee_pct') === '',
      'IB chưa khai: ô TRỐNG, không phải 0',
      oIb(trong, 'buy_fee_pct'),
    );
    kiem(
      oIb(rieng, 'sell_tax_pct') === '0.00',
      'thuế 0 THẬT vẫn in ra 0.00 — phân biệt được với ô trống',
      oIb(rieng, 'sell_tax_pct'),
    );
    kiem(oIb(rieng, 'broker') === 'SSI', 'IB mang theo sàn', oIb(rieng, 'broker'));

    const sTk = sheets.find((s) => s.name === 'MD Tài khoản chứng khoán')!;
    const hTk = sTk.headers.map(String);
    const dTk = sTk.rows.map((r) => r.map((c) => String(c ?? '')));
    const dong = dTk.find((r) => r[hTk.indexOf('account_no')] === tk.accountNo);

    kiem(dong !== undefined, 'có tài khoản vừa tạo');
    const oTk = (c: string) => dong?.[hTk.indexOf(c)] ?? '(thiếu)';
    kiem(oTk('owner_email') === admin.email, 'ghi đúng chủ tài khoản', oTk('owner_email'));
    kiem(
      oTk('ib_code') === ibRieng.code,
      'ghép được tài khoản với IB — khoá để tra biểu phí',
      oTk('ib_code'),
    );
    kiem(oTk('is_active') === 'YES', 'trạng thái tài khoản');
  }

  console.log(`\n${dat} dat / ${truot} truot`);
  if (truot > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
