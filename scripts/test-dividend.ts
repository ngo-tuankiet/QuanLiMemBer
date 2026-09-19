/**
 * GHI NHẬN CỔ TỨC — TIỀN MẶT VÀ CỔ PHIẾU.
 *
 * NĂM ĐIỀU PHẢI ĐÚNG, và mỗi cái ngăn một cách hiểu sai cụ thể:
 *
 *   1. Cổ tức CỔ PHIẾU làm khối lượng tăng, giá vốn KHÔNG đổi → giá vốn TB giảm đúng
 *      theo tỷ lệ chia. Đây là phép thử của cách ghi "mua giá 0".
 *   2. Cổ tức TIỀN MẶT vào số dư tài khoản, và KHÔNG tính vào vốn góp — nó là tiền
 *      doanh nghiệp trả, không phải tiền người dùng nạp thêm.
 *   3. Cổ tức tiền mặt KHÔNG cộng vào `unrealizedPnl`. Trộn vào thì cột % không còn là
 *      mức tăng giá so với giá vốn.
 *   4. `totalReturn` = lãi/lỗ giá + cổ tức, và khác `unrealizedPnl` đúng bằng cổ tức.
 *   5. Cổ phiếu thưởng chia về các chiến lược theo tỷ trọng đang nắm, tổng khớp tuyệt
 *      đối — không rơi cổ phiếu nào.
 *
 * VÀ MỘT CHỐT AN TOÀN: không ghi được cổ tức cho mã tài khoản không hề giữ.
 *
 * Chạy trên BẢN SAO: npm run test:dividend
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { recordDividendAction } from '@/trading/dividend-actions';
import {
  computePositions,
  computeAccountBalances,
  computeStrategyHoldings,
} from '@/domain/portfolio-engine';
import { bpsFromWeights, formatVnd } from '@/lib/money';
import { ROLE, USER_STATUS, TRANSACTION_TYPE } from '@/lib/enums';

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

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });
  await createSession(admin.id);

  const stock = await prisma.stock.findFirstOrThrow({
    where: { quote: { isNot: null } },
    select: { id: true, symbol: true, quote: { select: { price: true } } },
  });
  const chienLuoc = await prisma.strategy.findMany({
    where: { isActive: true },
    take: 2,
    select: { id: true },
  });
  if (chienLuoc.length < 2) throw new Error('cần ít nhất 2 chiến lược đang bật');

  const tk = await prisma.brokerAccount.create({
    data: { userId: admin.id, broker: 'SSI', accountNo: 'DIV00001' },
    select: { id: true },
  });
  const tkKhac = await prisma.brokerAccount.create({
    data: { userId: admin.id, broker: 'SSI', accountNo: 'DIV00002' },
    select: { id: true },
  });
  await prisma.capitalFlow.create({
    data: {
      portfolioId: portfolio.id,
      brokerAccountId: tk.id,
      flowType: 'CONTRIBUTION',
      status: 'CONFIRMED',
      amount: 5_000_000_000n,
      occurredAt: new Date(),
      createdById: admin.id,
    },
  });

  /*
   * Mua 4.000 CP chia hai chiến lược 60/40 — để kiểm bước chia cổ phiếu thưởng. Ghi
   * thẳng bằng prisma thay vì qua action: bài này kiểm CỔ TỨC, không kiểm luồng mua.
   */
  const giaMua = 22_484n;
  const lenh = await prisma.trade.create({
    data: {
      code: 'DIVBUY0001',
      portfolioId: portfolio.id,
      stockId: stock.id,
      brokerAccountId: tk.id,
      userId: admin.id,
      createdById: admin.id,
      transactionType: TRANSACTION_TYPE.BUY,
      status: 'EXECUTED',
      quantity: 4000,
      price: giaMua,
      fees: 0n,
      tax: 0n,
      executedAt: new Date('2026-02-01'),
    },
    select: { id: true },
  });
  await prisma.tradeStrategy.createMany({
    data: [
      { tradeId: lenh.id, strategyId: chienLuoc[0]!.id, allocationBps: 6000, allocationAmount: 53_961_600n },
      { tradeId: lenh.id, strategyId: chienLuoc[1]!.id, allocationBps: 4000, allocationAmount: 35_974_400n },
    ],
  });

  /** Tổng vốn góp đã xác nhận — dùng để chứng minh cổ tức không chạm vào nó. */
  const doVonGop = async (): Promise<bigint> =>
    (
      await prisma.capitalFlow.aggregate({
        where: { portfolioId: portfolio.id, flowType: 'CONTRIBUTION', status: 'CONFIRMED' },
        _sum: { amount: true },
      })
    )._sum.amount ?? 0n;

  const vonGopTruoc = await doVonGop();

  const truocVi = (await computePositions({ portfolioId: portfolio.id })).find(
    (p) => p.stockId === stock.id,
  )!;
  const truocTien = (await computeAccountBalances(portfolio.id, admin.id)).find(
    (b) => b.accountId === tk.id,
  )!;

  console.log(
    `\nTrước cổ tức: ${truocVi.quantity} CP · giá vốn ${formatVnd(truocVi.totalCost)} · ` +
      `giá vốn TB ${Number(truocVi.avgCostMicro / 1_000_000n)}`,
  );

  // -------------------------------------------------------------------------
  console.log('\n0. Chốt an toàn: mã không giữ ở tài khoản đó');
  // -------------------------------------------------------------------------
  {
    const f = new FormData();
    f.set('portfolioId', portfolio.id);
    f.set('brokerAccountId', tkKhac.id);
    f.set('stockId', stock.id);
    f.set('occurredAt', '2026-06-15');
    f.set('eligibleQuantity', '4000');
    f.set('cashPerShare', '1000');
    const kq = await recordDividendAction(null, f);
    kiem(!kq.ok, 'tài khoản chưa từng giữ mã → từ chối', kq.fieldErrors?.stockId?.join(' ') ?? '');
  }

  // -------------------------------------------------------------------------
  console.log('\n1-2. Ghi một đợt: 1.000 đ/cp tiền mặt + 400 CP thưởng');
  // -------------------------------------------------------------------------
  {
    const f = new FormData();
    f.set('portfolioId', portfolio.id);
    f.set('brokerAccountId', tk.id);
    f.set('stockId', stock.id);
    f.set('occurredAt', '2026-06-15');
    // Đúng bằng số đang giữ — đợt này không có mua/bán xen giữa ngày chốt và hôm nay.
    f.set('eligibleQuantity', '4000');
    f.set('cashPerShare', '1000');
    f.set('shareQuantity', '400');
    const kq = await recordDividendAction(null, f);
    kiem(kq.ok, 'ghi được đợt cổ tức có cả hai phần', kq.message ?? JSON.stringify(kq.fieldErrors));
  }

  const sauVi = (await computePositions({ portfolioId: portfolio.id })).find(
    (p) => p.stockId === stock.id,
  )!;
  const sauTien = (await computeAccountBalances(portfolio.id, admin.id)).find(
    (b) => b.accountId === tk.id,
  )!;

  console.log(
    `Sau cổ tức : ${sauVi.quantity} CP · giá vốn ${formatVnd(sauVi.totalCost)} · ` +
      `giá vốn TB ${Number(sauVi.avgCostMicro / 1_000_000n)} · cổ tức ${formatVnd(sauVi.dividendCash)}`,
  );

  const vonGopSau = await doVonGop();
  const tienDuKien = 1000n * 4000n;

  kiem(sauVi.quantity === 4400, 'khối lượng 4.000 → 4.400', `${sauVi.quantity}`);
  kiem(sauVi.totalCost === truocVi.totalCost, 'giá vốn KHÔNG đổi', `${sauVi.totalCost}`);
  kiem(
    sauVi.avgCostMicro < truocVi.avgCostMicro,
    'giá vốn TB GIẢM sau khi nhận cổ phiếu thưởng',
    `${truocVi.avgCostMicro} → ${sauVi.avgCostMicro}`,
  );
  kiem(
    sauVi.avgCostMicro === (truocVi.totalCost * 1_000_000n) / 4400n,
    'giá vốn TB mới = giá vốn / khối lượng mới',
    `${sauVi.avgCostMicro}`,
  );

  kiem(
    sauTien.available === truocTien.available + tienDuKien,
    'tiền mặt tài khoản tăng đúng số cổ tức',
    `${sauTien.available - truocTien.available}`,
  );
  kiem(
    sauTien.granted === truocTien.granted + tienDuKien,
    'cổ tức vào số dư (granted cộng dòng vốn theo dấu)',
  );

  /*
   * ĐO TRƯỚC/SAU, không so với một con số tuyệt đối: bản sao mang theo vốn góp có sẵn
   * của dữ liệu thật, nên "tổng vốn góp = 5 tỷ" là khẳng định về FIXTURE chứ không
   * phải về hành vi. Cái cần chứng minh là đợt cổ tức KHÔNG làm nó nhúc nhích.
   */
  kiem(
    vonGopSau === vonGopTruoc,
    'KHÔNG tính vào vốn góp — cổ tức không phải tiền nạp thêm',
    `${vonGopTruoc} → ${vonGopSau}`,
  );

  // -------------------------------------------------------------------------
  console.log('\n3-4. Cổ tức để RIÊNG, không trộn vào lãi/lỗ giá');
  // -------------------------------------------------------------------------
  kiem(sauVi.dividendCash === tienDuKien, 'cột Cổ tức đúng số', `${sauVi.dividendCash}`);
  kiem(
    sauVi.unrealizedPnl === sauVi.marketValue - sauVi.totalCost,
    'lãi/lỗ giá vẫn chỉ là giá trị TT trừ giá vốn — KHÔNG cộng cổ tức',
  );
  kiem(
    sauVi.totalReturn === sauVi.unrealizedPnl + sauVi.realizedPnl + sauVi.dividendCash,
    'Tổng = lãi/lỗ giá + đã chốt + cổ tức',
  );
  kiem(
    sauVi.totalReturn - sauVi.unrealizedPnl - sauVi.realizedPnl === tienDuKien,
    'Tổng khác lãi/lỗ giá ĐÚNG BẰNG phần cổ tức',
  );
  kiem(
    sauVi.totalReturnBps !== sauVi.returnBps,
    'hai cột phần trăm KHÁC nhau — nếu bằng nhau thì cổ tức chưa vào đâu cả',
    `${sauVi.returnBps} vs ${sauVi.totalReturnBps}`,
  );

  // -------------------------------------------------------------------------
  console.log('\n5. Cổ phiếu thưởng chia đúng tỷ trọng chiến lược');
  // -------------------------------------------------------------------------
  const kho = await computeStrategyHoldings(portfolio.id, admin.id, tk.id);
  const mk = kho.find((h) => h.stockId === stock.id)!;
  const tongTheoCl = mk.byStrategy.reduce((s, x) => s + x.quantity, 0);
  console.log(`  chia: ${mk.byStrategy.map((x) => x.quantity).join(' + ')} = ${tongTheoCl}`);
  kiem(tongTheoCl === 4400, 'Σ khối lượng theo chiến lược = 4.400, không rơi cổ phiếu nào');
  kiem(
    mk.byStrategy.length === 2,
    'vẫn đủ hai chiến lược — cổ phiếu thưởng không dồn hết vào một',
  );

  // -------------------------------------------------------------------------
  console.log('\n6. Khối lượng hưởng cổ tức SỬA ĐƯỢC, tiền tính theo số đã nhập');
  // -------------------------------------------------------------------------
  {
    /*
     * Đây là phép kiểm gốc của cả tính năng: trước đây tiền luôn = giá/cp × SỐ ĐANG
     * GIỮ. Ghi một đợt với khối lượng KHÁC hẳn số đang giữ (4.400 sau mục 1-2) rồi đo
     * tiền vào tài khoản — nếu action còn đọc vị thế thì con số sẽ là 4.400 × giá.
     */
    const truoc = (await computeAccountBalances(portfolio.id, admin.id)).find(
      (b) => b.accountId === tk.id,
    )!;

    const f = new FormData();
    f.set('portfolioId', portfolio.id);
    f.set('brokerAccountId', tk.id);
    f.set('stockId', stock.id);
    f.set('occurredAt', '2026-07-20');
    f.set('eligibleQuantity', '1000');
    f.set('cashPerShare', '500');
    const kq = await recordDividendAction(null, f);
    kiem(kq.ok, 'ghi được với khối lượng khác số đang giữ', kq.message ?? JSON.stringify(kq.fieldErrors));

    const sau = (await computeAccountBalances(portfolio.id, admin.id)).find(
      (b) => b.accountId === tk.id,
    )!;
    const tang = sau.available - truoc.available;
    kiem(tang === 500_000n, 'tiền tăng = 500 × 1.000 = 500.000 đ', `${tang}`);
    kiem(
      tang !== 500n * 4400n,
      'KHÔNG tính theo số đang giữ (4.400) — đây là lỗi cũ',
      `${tang} vs ${500n * 4400n}`,
    );
  }

  // -------------------------------------------------------------------------
  console.log('\n7. Khối lượng trống hoặc 0 → từ chối');
  // -------------------------------------------------------------------------
  for (const [nhan, gt] of [
    ['bỏ trống', ''],
    ['bằng 0', '0'],
    ['chữ', 'abc'],
  ] as [string, string][]) {
    const f = new FormData();
    f.set('portfolioId', portfolio.id);
    f.set('brokerAccountId', tk.id);
    f.set('stockId', stock.id);
    f.set('occurredAt', '2026-07-21');
    f.set('eligibleQuantity', gt);
    f.set('cashPerShare', '500');
    const kq = await recordDividendAction(null, f);
    kiem(
      !kq.ok && !!kq.fieldErrors?.eligibleQuantity,
      `khối lượng ${nhan} → từ chối`,
      JSON.stringify(kq.fieldErrors ?? {}),
    );
  }

  // -------------------------------------------------------------------------
  console.log('\n8. Mã ĐÃ BÁN HẾT vẫn ghi được cổ tức');
  // -------------------------------------------------------------------------
  {
    /*
     * Bán sạch sau ngày chốt quyền thì tiền cổ tức vẫn về. Trước đây
     * `computeStrategyHoldings` đã loại mã khỏi danh sách nên action từ chối thẳng —
     * người dùng mất một khoản tiền có thật trên sổ mà không có đường nào ghi vào.
     *
     * Bán hết bằng chính đường bán thật để trạng thái giống hệt ngoài đời.
     */
    const vi = (await computeStrategyHoldings(portfolio.id, admin.id, tk.id)).find(
      (h) => h.stockId === stock.id,
    )!;

    await prisma.trade.create({
      data: {
        code: `BANHET${process.pid}`,
        portfolioId: portfolio.id,
        stockId: stock.id,
        brokerAccountId: tk.id,
        userId: admin.id,
        createdById: admin.id,
        transactionType: 'SELL',
        status: 'EXECUTED',
        quantity: vi.quantity,
        price: 30_000n,
        fees: 0n,
        tax: 0n,
        executedAt: new Date('2026-08-01'),
        /*
         * CHIA LỆNH BÁN THEO ĐÚNG TỶ TRỌNG ĐANG NẮM, như đường bán thật làm.
         *
         * Bịa một bộ tỷ lệ khác sẽ bán quá tay ở chiến lược này và bán thiếu ở chiến
         * lược kia: tổng vị thế về 0 nhưng từng chiến lược còn dư âm/dương. Lúc đó bài
         * kiểm đo một trạng thái không lối bán nào tạo ra được — tức đo fixture của
         * chính nó, không phải sản phẩm.
         */
        strategies: {
          create: (() => {
            const bps = bpsFromWeights(vi.byStrategy.map((x) => BigInt(x.quantity)));
            return vi.byStrategy.map((x, i) => ({
              strategyId: x.strategyId,
              allocationBps: bps[i] ?? 0,
              allocationAmount: 0n,
            }));
          })(),
        },
      },
    });

    const conLai = (await computeStrategyHoldings(portfolio.id, admin.id, tk.id)).find(
      (h) => h.stockId === stock.id,
    );
    kiem(conLai === undefined, 'đã bán hết — mã không còn trong danh sách đang giữ');

    const truoc = (await computeAccountBalances(portfolio.id, admin.id)).find(
      (b) => b.accountId === tk.id,
    )!;

    const f = new FormData();
    f.set('portfolioId', portfolio.id);
    f.set('brokerAccountId', tk.id);
    f.set('stockId', stock.id);
    f.set('occurredAt', '2026-08-10');
    f.set('eligibleQuantity', '4400');
    f.set('cashPerShare', '800');
    const kq = await recordDividendAction(null, f);
    kiem(kq.ok, 'ghi được cổ tức cho mã đã bán hết', kq.message ?? JSON.stringify(kq.fieldErrors));

    const sau = (await computeAccountBalances(portfolio.id, admin.id)).find(
      (b) => b.accountId === tk.id,
    )!;
    kiem(
      sau.available - truoc.available === 800n * 4400n,
      'tiền vào đúng 800 × 4.400',
      `${sau.available - truoc.available}`,
    );
  }

  // -------------------------------------------------------------------------
  console.log('\n9. Cổ phiếu thưởng cho mã đã bán hết vẫn chia được theo chiến lược');
  // -------------------------------------------------------------------------
  {
    /*
     * Không còn vị thế thì không còn tỷ trọng chiến lược để đọc. Action phải lùi về
     * tỷ trọng của chính những lệnh MUA mã đó — nếu không, nó sẽ ghi một lệnh cổ phiếu
     * thưởng KHÔNG có `trade_strategies`, và phần vốn theo chiến lược thiếu đúng số cổ
     * phiếu vừa nhận mà bảng vị thế tổng vẫn đúng.
     */
    const f = new FormData();
    f.set('portfolioId', portfolio.id);
    f.set('brokerAccountId', tk.id);
    f.set('stockId', stock.id);
    f.set('occurredAt', '2026-08-11');
    f.set('eligibleQuantity', '4400');
    f.set('shareQuantity', '440');
    const kq = await recordDividendAction(null, f);
    kiem(kq.ok, 'ghi được cổ phiếu thưởng cho mã đã bán hết', kq.message ?? JSON.stringify(kq.fieldErrors));

    const kho2 = (await computeStrategyHoldings(portfolio.id, admin.id, tk.id)).find(
      (h) => h.stockId === stock.id,
    );
    kiem(kho2?.quantity === 440, 'vị thế mới = 440 CP thưởng', `${kho2?.quantity}`);
    const tong2 = kho2?.byStrategy.reduce((x, y) => x + y.quantity, 0) ?? 0;
    kiem(
      tong2 === 440,
      'Σ theo chiến lược = 440 — không rơi cổ phiếu nào ra ngoài chiến lược',
      `${tong2}`,
    );
  }

  console.log('\n' + '='.repeat(76));
  console.log(` KẾT QUẢ: ${dat} đạt · ${truot} sai`);
  console.log('='.repeat(76) + '\n');

  await prisma.$disconnect();
  process.exit(truot === 0 ? 0 : 1);
}

void main();
