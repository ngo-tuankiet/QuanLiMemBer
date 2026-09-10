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
import { formatVnd } from '@/lib/money';
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
    f.set('cashPerShare', '1000');
    const kq = await recordDividendAction(null, f);
    kiem(!kq.ok, 'tài khoản không giữ mã → từ chối', kq.fieldErrors?.stockId?.join(' ') ?? '');
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

  console.log('\n' + '='.repeat(76));
  console.log(` KẾT QUẢ: ${dat} đạt · ${truot} sai`);
  console.log('='.repeat(76) + '\n');

  await prisma.$disconnect();
  process.exit(truot === 0 ? 0 : 1);
}

void main();
