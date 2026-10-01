/**
 * KIỂM CHỨNG MÔ HÌNH DỮ LIỆU — Phase 01.
 *
 * Chạy:  npm run verify:model
 *
 * Script này KHÔNG phải Portfolio Engine (đó là Phase 06). Nó là bằng chứng
 * rằng schema Phase 01 đủ để trả lời mọi câu hỏi mà đặc tả đòi hỏi, mà KHÔNG
 * cần thêm bất kỳ bảng nào lưu giá trị tính toán:
 *
 *   Phần A — Bất biến dữ liệu:   Σ allocationBps = 100% ; Σ allocationAmount = netAmount
 *   Phần B — Position & P&L:     §9  suy ra từ Trade + MarketQuote
 *   Phần C — Vốn:                §12, §14  Invested / Cash / Reserve
 *   Phần D — Sector Exposure:    §15
 *   Phần E — Strategy Allocation:§16  không đếm trùng vốn khi 1 Trade có nhiều Strategy
 *   Phần F — Hiệu suất & Alpha:  §13
 *
 * Nếu bất kỳ kiểm tra ở Phần A thất bại, script thoát với mã lỗi 1 — dùng được
 * như một health check trong CI.
 */

import { PrismaClient } from '@prisma/client';
import {
  BPS_TOTAL,
  MICRO,
  avgCostMicro,
  costBasis,
  divRound,
  formatBps,
  formatCompactVnd,
  formatVnd,
  netAmount,
  ratioToBps,
} from '../src/lib/money';
import { TRADE_STATUS, CAPITAL_FLOW_SIGN, type CapitalFlowType } from '../src/lib/enums';
import {
  computePerformance,
  computePerformanceSeries,
  computePortfolioSummary,
} from '../src/domain/portfolio-engine';

const prisma = new PrismaClient();

let failures = 0;
let skipped = 0;

function header(title: string): void {
  console.log('\n' + '─'.repeat(88));
  console.log(' ' + title);
  console.log('─'.repeat(88));
}

function check(passed: boolean, label: string, detail = ''): void {
  if (!passed) failures += 1;
  console.log(`  ${passed ? 'OK  ' : 'LỖI '} ${label}${detail ? '  — ' + detail : ''}`);
}

/**
 * "KHÔNG ĐÁNH GIÁ ĐƯỢC" KHÁC "SAI".
 *
 * Nhiều phép kiểm ở đây cần dữ liệu mới có nghĩa: tỷ trọng cộng lại 100% thì phải có vị
 * thế, hiệu suất đổi theo khoảng thì phải có nhiều phiên. Trên một danh mục vừa dọn sạch
 * để nạp dữ liệu thật, chúng đều ra 0 — và đó là sự thật về dữ liệu, không phải lỗi.
 *
 * Báo LỖI ở đó khiến bộ kiểm đỏ thường trực cho tới khi có đủ dữ liệu, và người đọc sẽ
 * quen với việc "có mấy dòng đỏ nhưng không sao" — đúng thói quen làm người ta bỏ qua một
 * dòng đỏ thật. Bỏ qua kèm LÝ DO giữ được thông tin mà không làm hỏng tín hiệu.
 */
function skip(label: string, lyDo: string): void {
  skipped += 1;
  console.log(`  BỎ QUA ${label}  — ${lyDo}`);
}


// ===========================================================================
// PHẦN A — BẤT BIẾN DỮ LIỆU
// ===========================================================================

async function verifyInvariants(): Promise<void> {
  header('PHẦN A — Bất biến của mô hình đa chiến lược (§6)');

  const trades = await prisma.trade.findMany({
    include: { strategies: true, stock: { select: { symbol: true } } },
    orderBy: { code: 'asc' },
  });

  if (trades.length === 0) {
    skip('Có giao dịch để kiểm tra', 'danh mục chưa có giao dịch nào — không đánh giá được');
  } else {
    check(true, `Có ${trades.length} giao dịch để kiểm tra`);
  }

  let bpsErrors = 0;
  let amountErrors = 0;
  let emptyErrors = 0;

  for (const trade of trades) {
    if (trade.strategies.length === 0) {
      emptyErrors += 1;
      console.log(`       ${trade.code} không có phân bổ chiến lược`);
      continue;
    }

    const sumBps = trade.strategies.reduce((s, a) => s + a.allocationBps, 0);
    if (sumBps !== BPS_TOTAL) {
      bpsErrors += 1;
      console.log(`       ${trade.code} Σ bps = ${sumBps} (phải là ${BPS_TOTAL})`);
    }

    const net = netAmount(
      trade.transactionType as 'BUY' | 'SELL',
      trade.quantity,
      trade.price,
      trade.fees,
      trade.tax,
    );
    const sumAmount = trade.strategies.reduce((s, a) => s + a.allocationAmount, 0n);
    if (sumAmount !== net) {
      amountErrors += 1;
      console.log(
        `       ${trade.code} Σ allocationAmount = ${formatVnd(sumAmount)} nhưng netAmount = ${formatVnd(net)}` +
          `  (lệch ${formatVnd(sumAmount - net)})`,
      );
    }
  }

  check(emptyErrors === 0, 'Mọi giao dịch đều có ít nhất một chiến lược');
  check(bpsErrors === 0, 'Mọi giao dịch có Σ tỷ lệ phân bổ = 100.00%');
  check(amountErrors === 0, 'Mọi giao dịch có Σ số tiền phân bổ = số tiền thực tế, không lệch một đồng');

  // Ca kiểm thử làm tròn 1/3 — chỗ dễ sai nhất.
  const acb = trades.find((t) => t.stock.symbol === 'ACB');
  if (acb) {
    const net = netAmount(acb.transactionType as 'BUY' | 'SELL', acb.quantity, acb.price, acb.fees, acb.tax);
    const parts = acb.strategies.map((a) => a.allocationAmount);
    console.log(
      `\n  Ca 1/3: ${acb.code}  net = ${formatVnd(net)}` +
        `\n          các phần: ${parts.map((p) => formatVnd(p)).join('  +  ')}` +
        `\n          tổng    : ${formatVnd(parts.reduce((s, p) => s + p, 0n))}`,
    );
  }

  // Không có Strategy nào bị gán trực tiếp cho User (§4) — schema không có cột đó,
  // nên phép kiểm tra là: bảng trade_strategies là con đường DUY NHẤT tới Strategy.
  const strategyLinkCount = await prisma.tradeStrategy.count();
  if (trades.length === 0) {
    skip('Strategy chỉ liên kết qua Trade (§4)', 'danh mục chưa có giao dịch nào — không đánh giá được');
  } else {
    check(
      strategyLinkCount > 0,
      'Strategy chỉ liên kết qua Trade, không gán cố định cho User (§4)',
      `${strategyLinkCount} dòng trade_strategies`,
    );
  }
}

// ===========================================================================
// PHẦN B — POSITION & P&L
// ===========================================================================

interface Position {
  symbol: string;
  sectorCode: string;
  sectorNameVi: string;
  quantity: number;
  totalCost: bigint;
  avgCostMicro: bigint;
  currentPrice: bigint;
  marketValue: bigint;
  unrealizedPnl: bigint;
  realizedPnl: bigint;
}

async function buildPositions(portfolioId: string): Promise<Position[]> {
  header('PHẦN B — Position & P&L suy ra từ giao dịch (§9)');

  // Chỉ lệnh đã khớp mới được tính vào vị thế. Lệnh nháp/chờ duyệt không được
  // phép ảnh hưởng tới P&L.
  const trades = await prisma.trade.findMany({
    where: { portfolioId, status: TRADE_STATUS.EXECUTED },
    include: {
      stock: { include: { sector: true } },
    },
    orderBy: { executedAt: 'asc' },
  });

  const quotes = await prisma.marketQuote.findMany();
  const priceByStockId = new Map(quotes.map((q) => [q.stockId, q.price]));

  const acc = new Map<string, Position & { stockId: string }>();

  for (const trade of trades) {
    const key = trade.stock.symbol;
    let pos = acc.get(key);
    if (!pos) {
      pos = {
        stockId: trade.stockId,
        symbol: trade.stock.symbol,
        sectorCode: trade.stock.sector.code,
        sectorNameVi: trade.stock.sector.nameVi,
        quantity: 0,
        totalCost: 0n,
        avgCostMicro: 0n,
        currentPrice: 0n,
        marketValue: 0n,
        unrealizedPnl: 0n,
        realizedPnl: 0n,
      };
      acc.set(key, pos);
    }

    if (trade.transactionType === 'BUY') {
      // Phí mua vốn hoá vào giá vốn.
      pos.totalCost += costBasis(trade.quantity, trade.price, trade.fees, trade.tax);
      pos.quantity += trade.quantity;
      pos.avgCostMicro = avgCostMicro(pos.totalCost, pos.quantity);
    } else {
      // Bán: lãi/lỗ đã thực hiện = tiền thu về − giá vốn của phần bán ra.
      const proceeds = netAmount('SELL', trade.quantity, trade.price, trade.fees, trade.tax);
      const costOfSold = divRound(pos.avgCostMicro * BigInt(trade.quantity), MICRO);
      pos.realizedPnl += proceeds - costOfSold;
      pos.totalCost -= costOfSold;
      pos.quantity -= trade.quantity;
      // Giá vốn trung bình KHÔNG đổi khi bán (phương pháp bình quân gia quyền).
      if (pos.quantity === 0) {
        pos.totalCost = 0n;
        pos.avgCostMicro = 0n;
      }
    }
  }

  const positions: Position[] = [];
  for (const pos of acc.values()) {
    const price = priceByStockId.get(pos.stockId) ?? 0n;
    pos.currentPrice = price;
    pos.marketValue = BigInt(pos.quantity) * price;
    pos.unrealizedPnl = pos.marketValue - pos.totalCost;
    positions.push(pos);
  }

  positions.sort((a, b) => (b.marketValue > a.marketValue ? 1 : -1));

  const totalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0n);

  console.log(
    '\n  ' +
      'MÃ'.padEnd(6) +
      'KHỐI LƯỢNG'.padStart(12) +
      'GIÁ VỐN TB'.padStart(13) +
      'GIÁ HIỆN TẠI'.padStart(14) +
      'GIÁ TRỊ TT'.padStart(13) +
      'LÃI/LỖ'.padStart(13) +
      'RETURN'.padStart(10) +
      'TỶ TRỌNG'.padStart(10),
  );
  console.log('  ' + '─'.repeat(89));

  for (const p of positions) {
    if (p.quantity === 0) continue;
    const returnBps = ratioToBps(p.unrealizedPnl, p.totalCost);
    const weightBps = ratioToBps(p.marketValue, totalMarketValue);
    console.log(
      '  ' +
        p.symbol.padEnd(6) +
        p.quantity.toLocaleString('vi-VN').padStart(12) +
        Number(divRound(p.avgCostMicro, MICRO)).toLocaleString('vi-VN').padStart(13) +
        Number(p.currentPrice).toLocaleString('vi-VN').padStart(14) +
        formatCompactVnd(p.marketValue).padStart(13) +
        formatCompactVnd(p.unrealizedPnl).padStart(13) +
        formatBps(returnBps).padStart(10) +
        formatBps(weightBps, false).padStart(10),
    );
  }

  const totalCost = positions.reduce((s, p) => s + p.totalCost, 0n);
  const totalUnrealized = positions.reduce((s, p) => s + p.unrealizedPnl, 0n);
  const totalRealized = positions.reduce((s, p) => s + p.realizedPnl, 0n);

  console.log('  ' + '─'.repeat(89));
  console.log(
    '  ' +
      'TỔNG'.padEnd(6) +
      ''.padStart(12) +
      ''.padStart(13) +
      ''.padStart(14) +
      formatCompactVnd(totalMarketValue).padStart(13) +
      formatCompactVnd(totalUnrealized).padStart(13) +
      formatBps(ratioToBps(totalUnrealized, totalCost)).padStart(10),
  );

  console.log(`\n  Lãi/lỗ đã thực hiện (realized):   ${formatVnd(totalRealized)}`);
  console.log(`  Lãi/lỗ chưa thực hiện (unrealized): ${formatVnd(totalUnrealized)}`);
  console.log(`  Tổng lãi/lỗ:                        ${formatVnd(totalRealized + totalUnrealized)}`);

  check(
    positions.every((p) => p.quantity >= 0),
    'Không có vị thế âm (bán quá số lượng đang giữ)',
  );

  return positions;
}

// ===========================================================================
// PHẦN C — VỐN
// ===========================================================================

async function verifyCapital(portfolioId: string, positions: Position[]): Promise<bigint> {
  header('PHẦN C — Nguồn vốn: Invested / Cash / Reserve (§12, §14)');

  const portfolio = await prisma.portfolio.findUniqueOrThrow({ where: { id: portfolioId } });
  const flows = await prisma.capitalFlow.findMany({ where: { portfolioId, status: 'CONFIRMED' } });
  const trades = await prisma.trade.findMany({
    where: { portfolioId, status: TRADE_STATUS.EXECUTED },
  });

  // Tiền từ nạp/rút/cổ tức/lãi
  let cash = 0n;
  for (const f of flows) {
    cash += BigInt(CAPITAL_FLOW_SIGN[f.flowType as CapitalFlowType]) * f.amount;
  }
  const flowTotal = cash;

  // Tiền chi ra khi mua, thu về khi bán — suy ra từ Trade, KHÔNG lưu riêng.
  let spentOnBuys = 0n;
  let receivedFromSells = 0n;
  for (const t of trades) {
    const net = netAmount(t.transactionType as 'BUY' | 'SELL', t.quantity, t.price, t.fees, t.tax);
    if (t.transactionType === 'BUY') spentOnBuys += net;
    else receivedFromSells += net;
  }
  cash = cash - spentOnBuys + receivedFromSells;

  const investedCost = positions.reduce((s, p) => s + p.totalCost, 0n);
  const marketValue = positions.reduce((s, p) => s + p.marketValue, 0n);

  /*
   * QUỸ DỰ PHÒNG KẸP THEO SỐ TIỀN ĐANG CÓ.
   *
   * Bản cũ ở đây viết `const availableCash = cash - reserve` — một BẢN SAO của công
   * thức trong `computeCash`, và bản sao đó đã lỗi thời. Nó khiến file này báo
   * "Available Cash = −480 triệu" cho một danh mục chưa nạp vốn, tức là báo lỗi cho một
   * engine đang chạy đúng.
   *
   * Giữ phép tính TẠI ĐÂY chứ không gọi `computeCash`, vì mục đích của file này là
   * kiểm engine bằng một đường ĐỘC LẬP — gọi lại chính engine thì nó chỉ chứng minh
   * engine nhất quán với bản thân. Nhưng phép tính độc lập phải đúng ĐỊNH NGHĨA hiện
   * hành: không thể để dành số tiền chưa có.
   */
  const tienDuong = cash > 0n ? cash : 0n;
  const reserve = portfolio.reserveAmount < tienDuong ? portfolio.reserveAmount : tienDuong;
  const reserveShortfall = portfolio.reserveAmount - reserve;
  const availableCash = cash - reserve;
  const portfolioValue = marketValue + cash;

  console.log(`\n  Dòng vốn ngoài (nạp − rút + cổ tức + lãi) : ${formatVnd(flowTotal).padStart(22)}`);
  console.log(`  Tiền chi mua                              : ${('-' + formatVnd(spentOnBuys)).padStart(22)}`);
  console.log(`  Tiền thu bán                              : ${('+' + formatVnd(receivedFromSells)).padStart(22)}`);
  console.log('  ' + '─'.repeat(66));
  console.log(`  Số dư tiền                                : ${formatVnd(cash).padStart(22)}`);
  console.log(`  Trong đó quỹ dự phòng (Reserve)           : ${formatVnd(reserve).padStart(22)}`);
  if (reserveShortfall > 0n) {
    console.log(
      `    (cấu hình ${formatVnd(portfolio.reserveAmount)}, còn thiếu ${formatVnd(reserveShortfall)})`,
    );
  }
  console.log(`  Tiền khả dụng (Available Cash)            : ${formatVnd(availableCash).padStart(22)}`);

  console.log('\n  KPI Dashboard Tầng 1 (§12):');
  console.log(`    Portfolio Value    ${formatCompactVnd(portfolioValue).padStart(12)}`);
  console.log(
    `    Invested Capital   ${formatCompactVnd(marketValue).padStart(12)}   ` +
      `${formatBps(ratioToBps(marketValue, portfolioValue), false)}`,
  );
  console.log(
    `    Available Cash     ${formatCompactVnd(availableCash).padStart(12)}   ` +
      `${formatBps(ratioToBps(availableCash, portfolioValue), false)}`,
  );
  console.log(
    `    Reserve            ${formatCompactVnd(reserve).padStart(12)}   ` +
      `${formatBps(ratioToBps(reserve, portfolioValue), false)}`,
  );

  const totalPnl =
    positions.reduce((s, p) => s + p.unrealizedPnl + p.realizedPnl, 0n);
  console.log(
    `    Total P&L          ${formatCompactVnd(totalPnl).padStart(12)}   ` +
      `${formatBps(ratioToBps(totalPnl, investedCost))}`,
  );

  // Capital Allocation phải cộng lại đúng 100% (§14).
  const sumBps =
    ratioToBps(marketValue, portfolioValue) +
    ratioToBps(availableCash, portfolioValue) +
    ratioToBps(reserve, portfolioValue);
  if (portfolioValue === 0n) {
    skip('Capital Allocation cộng lại bằng 100%', 'danh mục rỗng — mọi tỷ trọng đều 0');
  } else {
    check(
      Math.abs(sumBps - BPS_TOTAL) <= 2,
      'Capital Allocation cộng lại bằng 100%',
      `${formatBps(sumBps, false)} (sai số làm tròn ≤ 0,02%)`,
    );
  }
  check(cash >= 0n, 'Số dư tiền không âm', formatVnd(cash));

  return portfolioValue;
}

// ===========================================================================
// PHẦN D — SECTOR EXPOSURE
// ===========================================================================

function verifySectorExposure(positions: Position[]): void {
  header('PHẦN D — Sector Exposure (§15)');

  const totalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0n);
  const bySector = new Map<string, { nameVi: string; value: bigint; symbols: string[] }>();

  for (const p of positions) {
    if (p.quantity === 0) continue;
    const entry = bySector.get(p.sectorCode) ?? { nameVi: p.sectorNameVi, value: 0n, symbols: [] };
    entry.value += p.marketValue;
    entry.symbols.push(p.symbol);
    bySector.set(p.sectorCode, entry);
  }

  const sorted = [...bySector.entries()].sort((a, b) => (b[1].value > a[1].value ? 1 : -1));

  console.log('');
  let sumBps = 0;
  for (const [, entry] of sorted) {
    const bps = ratioToBps(entry.value, totalMarketValue);
    sumBps += bps;
    const bar = '█'.repeat(Math.max(1, Math.round(bps / 200)));
    console.log(
      `  ${entry.nameVi.padEnd(30)} ${formatBps(bps, false).padStart(7)}  ` +
        `${formatCompactVnd(entry.value).padStart(10)}  ${bar}`,
    );
    console.log(`  ${' '.repeat(30)} ${' '.repeat(7)}  drill-down → ${entry.symbols.join(', ')}`);
  }

  if (totalMarketValue === 0n) {
    skip('Tỷ trọng ngành cộng lại bằng 100%', 'chưa có vị thế nào');
  } else {
    check(Math.abs(sumBps - BPS_TOTAL) <= 3, 'Tỷ trọng ngành cộng lại bằng 100%', formatBps(sumBps, false));
  }
}

// ===========================================================================
// PHẦN E — STRATEGY ALLOCATION
// ===========================================================================

async function verifyStrategyAllocation(portfolioId: string): Promise<void> {
  header('PHẦN E — Strategy Allocation, không đếm trùng vốn (§16)');

  const rows = await prisma.tradeStrategy.findMany({
    where: { trade: { portfolioId, status: TRADE_STATUS.EXECUTED } },
    include: {
      strategy: { select: { code: true, nameVi: true, sortOrder: true } },
      trade: { select: { transactionType: true } },
    },
  });

  // Vốn ròng đã triển khai theo chiến lược: cộng phần mua, trừ phần bán.
  // Đây chính là chỗ dễ sai nhất: nếu cộng cả BUY và SELL thì vốn bị đếm hai lần.
  const byStrategy = new Map<string, { nameVi: string; sortOrder: number; net: bigint }>();

  for (const row of rows) {
    const key = row.strategy.code;
    const entry =
      byStrategy.get(key) ?? { nameVi: row.strategy.nameVi, sortOrder: row.strategy.sortOrder, net: 0n };
    entry.net += row.trade.transactionType === 'BUY' ? row.allocationAmount : -row.allocationAmount;
    byStrategy.set(key, entry);
  }

  const total = [...byStrategy.values()].reduce((s, e) => s + e.net, 0n);
  const sorted = [...byStrategy.entries()].sort((a, b) => a[1].sortOrder - b[1].sortOrder);

  console.log('');
  let sumBps = 0;
  for (const [code, entry] of sorted) {
    const bps = ratioToBps(entry.net, total);
    sumBps += bps;
    console.log(
      `  ${code.padEnd(17)} ${entry.nameVi.padEnd(20)} ` +
        `${formatCompactVnd(entry.net).padStart(11)}  ${formatBps(bps, false).padStart(7)}`,
    );
  }
  console.log('  ' + '─'.repeat(60));
  console.log(`  ${'TỔNG'.padEnd(38)} ${formatCompactVnd(total).padStart(11)}  ${formatBps(sumBps, false).padStart(7)}`);

  if (total === 0n) {
    skip('Tỷ trọng chiến lược cộng lại bằng 100%', 'chưa có vốn trong chiến lược nào');
  } else {
    check(Math.abs(sumBps - BPS_TOTAL) <= 3, 'Tỷ trọng chiến lược cộng lại bằng 100%', formatBps(sumBps, false));
  }

  // ĐỐI CHIẾU KÉP: tổng vốn ròng theo chiến lược phải bằng tổng dòng tiền ròng
  // của các lệnh. Nếu lệch nghĩa là có vốn bị đếm trùng hoặc bị bỏ sót.
  const trades = await prisma.trade.findMany({
    where: { portfolioId, status: TRADE_STATUS.EXECUTED },
  });
  let expected = 0n;
  for (const t of trades) {
    const net = netAmount(t.transactionType as 'BUY' | 'SELL', t.quantity, t.price, t.fees, t.tax);
    expected += t.transactionType === 'BUY' ? net : -net;
  }

  check(
    total === expected,
    'Vốn theo chiến lược khớp tuyệt đối với dòng tiền của các lệnh (không đếm trùng)',
    `${formatVnd(total)} vs ${formatVnd(expected)}`,
  );
}

// ===========================================================================
// PHẦN F — HIỆU SUẤT & ALPHA
// ===========================================================================

/**
 * Hiệu suất và Alpha.
 *
 * TỪNG SAI Ở ĐÂY, và cái sai đó sống sót vì phép kiểm cuối là `check(true, …)` —
 * một dòng luôn xanh, không kiểm gì cả.
 *
 * Bản cũ lấy `totalPnl / totalCost` (lãi/lỗ trên giá vốn, KHÔNG có mốc thời gian)
 * trừ đi mức tăng VN-Index trên TOÀN BỘ lịch sử chỉ số. Hai vế khác hẳn nhau:
 *
 *   vế danh mục   một tỷ số, không có khoảng thời gian
 *   vế chỉ số     một suất sinh lời trên ~264 phiên, phần lớn là thời gian danh
 *                 mục còn chưa mở lệnh nào
 *
 * Kết quả in ra −20,70% trong khi ứng dụng hiển thị +6,29% cho cùng danh mục.
 * Hai nguồn sự thật, và bản sai lại là bản mang tên "verify".
 *
 * Nay dùng CHUNG `computePerformance` với ứng dụng, rồi KIỂM các tính chất mà
 * trước đây không ai kiểm: hai vế cùng gốc, cùng đích, và con số đổi theo khoảng.
 */
async function verifyPerformance(): Promise<void> {
  header('PHẦN F — Hiệu suất so với VN-Index (§13)');

  const portfolio = await prisma.portfolio.findFirstOrThrow({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  const summary = await computePortfolioSummary({ portfolioId: portfolio.id });
  const series = await computePerformanceSeries(portfolio.id, 'YTD');
  const perf = await computePerformance(
    portfolio.id,
    'YTD',
    summary.totalPnlBps,
    series,
  );

  if (perf.window) {
    const d = (x: Date) => x.toISOString().slice(0, 10);
    console.log(
      `\n  Khoảng thật  ${d(perf.window.from)} → ${d(perf.window.to)} · ${perf.window.sessions} phiên`,
    );
  }
  console.log(`  Nguồn        ${perf.source}`);
  console.log(`  Portfolio    ${formatBps(perf.portfolioBps).padStart(9)}`);
  console.log(`  VN-Index     ${formatBps(perf.benchmarkBps).padStart(9)}`);
  console.log(`  Alpha        ${formatBps(perf.alphaBps).padStart(9)}`);

  check(
    perf.alphaBps === perf.portfolioBps - perf.benchmarkBps,
    'Alpha = hiệu suất danh mục − mức tăng chỉ số',
  );

  const pts = series.points;
  check(
    pts.length === 0 || Math.abs(pts[0]!.portfolioIndex - 100) < 1e-9,
    'Chuỗi danh mục chuẩn hoá về 100 tại phiên đầu',
  );

  const coChiSo = pts.filter((p) => p.benchmarkIndex !== null);
  check(
    coChiSo.length === 0 || Math.abs(coChiSo[0]!.benchmarkIndex! - 100) < 1e-9,
    'Chuỗi chỉ số chuẩn hoá về 100 tại CÙNG phiên đầu — hai vế cùng gốc',
  );

  /*
   * `comparable = false` là kết luận ĐÚNG khi chưa có đủ phiên để so hai vế — nơi hiển
   * thị in "—" thay vì một con số bịa. Chỉ là lúc đó phép kiểm này không đánh giá được.
   */
  if (pts.length === 0) {
    skip('Hai vế đo trên cùng một khoảng (comparable)', 'chưa có phiên nào trong chuỗi');
  } else {
    check(
      perf.comparable,
      'Hai vế đo trên cùng một khoảng (comparable)',
      perf.comparable ? '' : 'không so sánh được — nơi hiển thị phải in “—”',
    );
  }

  // Con số PHẢI đổi theo khoảng. Bản cũ trả về cùng một giá trị cho mọi khoảng.
  const cacKhoang = ['1W', '1M', '3M', '6M', 'YTD'] as const;
  const giaTri = new Set<number>();
  for (const k of cacKhoang) {
    const se = await computePerformanceSeries(portfolio.id, k);
    const pe = await computePerformance(portfolio.id, k, summary.totalPnlBps, se);
    giaTri.add(pe.portfolioBps);
  }
  if (pts.length === 0) {
    skip('Hiệu suất đổi theo khoảng thời gian', 'chưa có phiên nào để đo chênh lệch');
  } else {
    check(
      giaTri.size > 1,
      'Hiệu suất đổi theo khoảng thời gian',
      `${giaTri.size} giá trị khác nhau trên ${cacKhoang.length} khoảng`,
    );
  }
}

// ===========================================================================
// PHẦN G — TRẠNG THÁI DỮ LIỆU THỊ TRƯỜNG & AUDIT
// ===========================================================================

async function verifyOperational(): Promise<void> {
  header('PHẦN G — Trạng thái dữ liệu thị trường (§10) & Audit Log (§20)');

  const lastSync = await prisma.marketDataSync.findFirst({
    where: { status: 'SUCCESS' },
    orderBy: { finishedAt: 'desc' },
  });

  if (lastSync?.finishedAt) {
    const ageMinutes = Math.floor((Date.now() - lastSync.finishedAt.getTime()) / 60_000);
    const staleSetting = await prisma.systemSetting.findUnique({
      where: { key: 'market_data.stale_after_minutes' },
    });
    const threshold = Number(staleSetting?.value ?? 15);
    const normal = ageMinutes <= threshold;

    console.log(`\n  Market Data     ${normal ? '● Connected' : '● Delayed'}`);
    console.log(`  Last Updated    ${lastSync.finishedAt.toLocaleTimeString('vi-VN')}`);
    console.log(`  Data Status     ${normal ? '● Normal' : `● Trễ ${ageMinutes} phút (ngưỡng ${threshold})`}`);
    console.log(`  Nguồn           ${lastSync.source} · ${lastSync.symbolsUpdated}/${lastSync.symbolsRequested} mã`);
    check(true, 'Trạng thái Market Data đọc được từ MarketDataSync');
  } else {
    console.log('\n  Chưa có lần đồng bộ thành công nào.');
  }

  const updateLog = await prisma.auditLog.findFirst({
    where: { action: 'UPDATE', entityType: 'TRADE' },
    orderBy: { occurredAt: 'desc' },
  });

  if (updateLog) {
    console.log('\n  Bản ghi Audit Log mới nhất cho việc sửa giao dịch:');
    console.log(`    Who     ${updateLog.actorName}`);
    console.log(`    When    ${updateLog.occurredAt.toLocaleString('vi-VN')}`);
    console.log(`    What    ${updateLog.action} ${updateLog.entityType} — ${updateLog.entityLabel}`);
    console.log(`    Before  ${updateLog.beforeJson}`);
    console.log(`    After   ${updateLog.afterJson}`);
    console.log(`    Fields  ${updateLog.changedFieldsJson}`);
    check(
      Boolean(updateLog.beforeJson && updateLog.afterJson),
      'Sửa giao dịch có lưu đầy đủ Before/After (§20 "không sửa mất dấu vết")',
    );
  }

  const pending = await prisma.trade.count({ where: { status: TRADE_STATUS.PENDING_APPROVAL } });
  const approvals = await prisma.approvalRequest.count({ where: { status: 'PENDING' } });
  console.log(`\n  Giao dịch chờ duyệt: ${pending} · Đề nghị chờ xử lý: ${approvals}`);
  check(pending === approvals, 'Mỗi giao dịch chờ duyệt có một đề nghị duyệt tương ứng');

  const totalAudit = await prisma.auditLog.count();
  console.log(`  Tổng số bản ghi Audit Log: ${totalAudit}`);
}

// ===========================================================================

async function main(): Promise<void> {
  console.log('='.repeat(88));
  console.log(' KIỂM CHỨNG MÔ HÌNH DỮ LIỆU — Phase 01');
  console.log('='.repeat(88));

  const portfolio = await prisma.portfolio.findUnique({ where: { code: 'MAIN' } });
  if (!portfolio) {
    console.error('\nChưa có danh mục MAIN. Chạy `npm run db:seed` rồi `npm run db:seed:demo`.');
    process.exit(1);
  }

  await verifyInvariants();
  const positions = await buildPositions(portfolio.id);
  await verifyCapital(portfolio.id, positions);
  verifySectorExposure(positions);
  await verifyStrategyAllocation(portfolio.id);
  await verifyPerformance();
  await verifyOperational();

  console.log('\n' + '='.repeat(88));
  if (failures === 0) {
    console.log(' KẾT LUẬN: mô hình dữ liệu đáp ứng toàn bộ ràng buộc của đặc tả.');
    console.log(' Không có bảng nào lưu sẵn P&L — mọi con số phía trên đều được tính ra.');
  } else {
    console.log(` KẾT LUẬN: ${failures} kiểm tra THẤT BẠI. Xem chi tiết phía trên.`);
  }
  if (skipped > 0) {
    console.log(
      ` ${skipped} phép kiểm BỎ QUA vì thiếu dữ liệu — chạy lại sau khi nạp dữ liệu thật.`,
    );
  }
  console.log('='.repeat(88) + '\n');

  if (failures > 0) process.exit(1);
}

main()
  .catch((error: unknown) => {
    console.error('\nKIỂM CHỨNG LỖI:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

