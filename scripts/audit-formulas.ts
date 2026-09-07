/**
 * KIỂM TOÀN BỘ CÔNG THỨC — đối chiếu engine với phép tính ĐỘC LẬP từ dữ liệu thô.
 *
 * Khác `verify-model.ts` ở chỗ: file đó chứng minh MÔ HÌNH DỮ LIỆU đủ để tính ra mọi
 * con số. File này chứng minh CÁC HÀM ĐANG CHẠY tính đúng — bằng cách tính lại từ
 * `trades` / `capital_flows` / `market_quotes` theo một đường khác rồi so từng đồng.
 *
 * Nguyên tắc: mỗi phép kiểm phải so hai con số đến từ HAI ĐƯỜNG KHÁC NHAU. So engine
 * với chính engine chỉ chứng minh nó nhất quán với bản thân, không chứng minh nó đúng.
 *
 * Chạy: npx tsx scripts/audit-formulas.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  applyScope,
  computeAccountBalances,
  computeCash,
  computeMemberPerformance,
  computePerformance,
  computePerformanceSeries,
  computePortfolioSummary,
  computePositions,
  computeTeamPerformance,
} from '@/domain/portfolio-engine';
import {
  BPS_TOTAL,
  costBasis,
  formatBps,
  formatVnd,
  grossAmount,
  netAmount,
  ratioToBps,
  allocateAmount,
} from '@/lib/money';
import {
  CAPITAL_FLOW_AFFECTS_CONTRIBUTED,
  CAPITAL_FLOW_SIGN,
  COUNTED_TRADE_STATUS,
  TRANSACTION_TYPE,
  type CapitalFlowType,
} from '@/lib/enums';

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
let skipped = 0;
const failures: string[] = [];

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

function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    pass += 1;
    console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
  } else {
    fail += 1;
    failures.push(label + (detail ? ' — ' + detail : ''));
    console.log(`  SAI   ${label}${detail ? '  — ' + detail : ''}`);
  }
}

function eq(a: bigint, b: bigint, label: string): void {
  check(a === b, label, a === b ? String(a) : `${a} vs ${b} (lệch ${a - b})`);
}

function header(t: string): void {
  console.log('\n' + '─'.repeat(88));
  console.log(' ' + t);
  console.log('─'.repeat(88));
}


async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    orderBy: { createdAt: 'asc' },
    select: { id: true, reserveAmount: true },
  });
  const pid = portfolio.id;

  // =========================================================================
  header('A — Số học cơ bản: netAmount, costBasis, ratioToBps');
  // =========================================================================

  {
    // netAmount phải khớp định nghĩa: BUY = gross + phí + thuế, SELL = gross − phí − thuế
    const trades = await prisma.trade.findMany({
      where: { portfolioId: pid, status: COUNTED_TRADE_STATUS },
      select: { transactionType: true, quantity: true, price: true, fees: true, tax: true },
    });

    let sai = 0;
    for (const t of trades) {
      const gross = BigInt(t.quantity) * t.price;
      const mong =
        t.transactionType === TRANSACTION_TYPE.BUY
          ? gross + t.fees + t.tax
          : gross - t.fees - t.tax;
      const thuc = netAmount(
        t.transactionType === TRANSACTION_TYPE.BUY ? 'BUY' : 'SELL',
        t.quantity,
        t.price,
        t.fees,
        t.tax,
      );
      if (mong !== thuc) sai += 1;
      if (grossAmount(t.quantity, t.price) !== gross) sai += 1;
    }
    check(sai === 0, `netAmount và grossAmount đúng định nghĩa trên ${trades.length} lệnh`);

    // costBasis của lệnh mua = gross + phí + thuế
    const mua = trades.filter((t) => t.transactionType === TRANSACTION_TYPE.BUY);
    const saiCost = mua.filter(
      (t) =>
        costBasis(t.quantity, t.price, t.fees, t.tax) !==
        BigInt(t.quantity) * t.price + t.fees + t.tax,
    ).length;
    check(saiCost === 0, `costBasis đúng định nghĩa trên ${mua.length} lệnh mua`);
  }

  {
    // ratioToBps: làm tròn nửa RA XA 0, và 0 khi mẫu số bằng 0
    const cases: [bigint, bigint, number][] = [
      [1n, 2n, 5000],
      [-1n, 2n, -5000],
      [1n, 3n, 3333],
      [2n, 3n, 6667],
      [-2n, 3n, -6667],
      [0n, 100n, 0],
      [50n, 0n, 0], // mẫu số 0 → 0, KHÔNG phải Infinity
      [100n, 100n, 10000],
    ];
    const sai = cases.filter(([a, b, want]) => ratioToBps(a, b) !== want);
    check(
      sai.length === 0,
      'ratioToBps: làm tròn nửa ra xa 0, mẫu số 0 trả về 0',
      sai.length ? JSON.stringify(sai) : `${cases.length} trường hợp`,
    );
    check(
      ratioToBps(50n, 0n) === 0,
      'Chia cho 0 KHÔNG ném lỗi và KHÔNG ra Infinity (nơi hiển thị phải tự phân biệt)',
    );
  }

  // =========================================================================
  header('B — Vị thế: engine vs tính lại độc lập từ trades');
  // =========================================================================

  const positions = await computePositions({ portfolioId: pid });

  /*
   * Danh mục rỗng thì hàng loạt phép kiểm bên dưới không đánh giá được — xem chú thích
   * của `skip`. Tính một lần ở đây thay vì đếm lại ở từng chỗ.
   */
  const coDuLieu = (await prisma.trade.count({ where: { portfolioId: pid } })) > 0;
  const open = positions.filter((p) => p.quantity > 0);

  {
    // Khối lượng: Σ mua − Σ bán, tính thẳng từ bảng
    const rows = await prisma.trade.groupBy({
      by: ['stockId', 'transactionType'],
      where: { portfolioId: pid, status: COUNTED_TRADE_STATUS },
      _sum: { quantity: true },
    });
    const kl = new Map<string, number>();
    for (const r of rows) {
      const dau = r.transactionType === TRANSACTION_TYPE.BUY ? 1 : -1;
      kl.set(r.stockId, (kl.get(r.stockId) ?? 0) + dau * (r._sum.quantity ?? 0));
    }
    const sai = positions.filter((p) => (kl.get(p.stockId) ?? 0) !== p.quantity);
    check(
      sai.length === 0,
      `Khối lượng từng mã khớp Σ mua − Σ bán (${positions.length} mã)`,
      sai.length ? sai.map((p) => p.symbol).join(', ') : '',
    );
  }

  {
    // marketValue = khối lượng × giá hiện tại
    const sai = open.filter((p) => BigInt(p.quantity) * p.currentPrice !== p.marketValue);
    check(sai.length === 0, 'marketValue = khối lượng × giá hiện tại');

    // unrealizedPnl = marketValue − totalCost
    const sai2 = open.filter((p) => p.marketValue - p.totalCost !== p.unrealizedPnl);
    check(sai2.length === 0, 'Lãi/lỗ chưa thực hiện = giá trị thị trường − giá vốn');

    // Mã thiếu giá không được âm thầm tính thành 0
    const thieuGia = open.filter((p) => p.missingPrice);
    check(
      thieuGia.every((p) => p.marketValue === 0n),
      `Mã thiếu giá (${thieuGia.length}) có marketValue = 0, không bịa giá`,
    );
  }

  // =========================================================================
  header('C — Tiền: engine vs tính lại độc lập từ capital_flows + trades');
  // =========================================================================

  const cash = await computeCash(pid);

  {
    const flows = await prisma.capitalFlow.findMany({
      where: { portfolioId: pid, status: 'CONFIRMED' },
      select: { flowType: true, amount: true },
    });
    let gop = 0n;
    let khac = 0n;
    for (const f of flows) {
      const ft = f.flowType as CapitalFlowType;
      const signed = BigInt(CAPITAL_FLOW_SIGN[ft]) * f.amount;
      if (CAPITAL_FLOW_AFFECTS_CONTRIBUTED[ft]) gop += signed;
      else khac += signed;
    }

    const trades = await prisma.trade.findMany({
      where: { portfolioId: pid, status: COUNTED_TRADE_STATUS },
      select: { transactionType: true, quantity: true, price: true, fees: true, tax: true },
    });
    let mua = 0n;
    let ban = 0n;
    for (const t of trades) {
      const n = netAmount(
        t.transactionType === TRANSACTION_TYPE.BUY ? 'BUY' : 'SELL',
        t.quantity,
        t.price,
        t.fees,
        t.tax,
      );
      if (t.transactionType === TRANSACTION_TYPE.BUY) mua += n;
      else ban += n;
    }

    eq(cash.contributedCapital, gop, 'Vốn góp ròng');
    eq(cash.otherFlows, khac, 'Dòng tiền khác (cổ tức, lãi…)');
    eq(cash.spentOnBuys, mua, 'Tiền chi mua');
    eq(cash.receivedFromSells, ban, 'Tiền thu bán');
    eq(cash.cashBalance, gop + khac - mua + ban, 'Số dư tiền = góp + khác − mua + bán');
    /*
     * QUỸ DỰ PHÒNG BỊ KẸP THEO SỐ TIỀN ĐANG CÓ — hai khẳng định cũ ở đây đã sai.
     *
     * Bản cũ khẳng định `availableCash === cashBalance − portfolio.reserveAmount` và
     * `reserveAmount === portfolio.reserveAmount`, tức là trừ thẳng mức cấu hình bất kể
     * có tiền hay không. Hậu quả đo được: danh mục chưa nạp vốn hiện "Available Cash =
     * −480 triệu", trong khi thực tế đang có 0 đồng. Không thể để dành số tiền chưa có.
     *
     * `computeCash` nay kẹp mức dự phòng theo tiền đang có và ghi phần còn thiếu vào
     * `reserveShortfall`. Ba khẳng định dưới đây mô tả hợp đồng MỚI, và chúng vẫn ràng
     * con số vào dữ liệu thô chứ không đơn thuần đọc lại engine:
     *
     *   1. giữ được = min(cấu hình, max(0, tiền))
     *   2. tiền = khả dụng + giữ được          — bất biến, đúng cả khi tiền âm
     *   3. giữ được + còn thiếu = cấu hình     — không đồng nào bốc hơi
     */
    const tienDuong = cash.cashBalance > 0n ? cash.cashBalance : 0n;
    const giuDuoc =
      portfolio.reserveAmount < tienDuong ? portfolio.reserveAmount : tienDuong;

    check(cash.scope === 'PORTFOLIO', 'Phạm vi mặc định là toàn danh mục');
    eq(cash.reserveAmount, giuDuoc, "Quỹ dự phòng giữ được = min(cấu hình, tiền đang có)");
    eq(
      cash.availableCash + cash.reserveAmount,
      cash.cashBalance,
      "Bất biến: tiền = khả dụng + giữ được",
    );
    eq(
      cash.reserveAmount + cash.reserveShortfall,
      portfolio.reserveAmount,
      "Giữ được + còn thiếu = mức cấu hình",
    );

    /*
     * VÀ KHÔNG BAO GIỜ ÂM VÌ QUỸ DỰ PHÒNG. Số dư âm vẫn để âm (vốn nạp chưa khai đủ),
     * nhưng phép trừ quỹ dự phòng không được TẠO RA số âm.
     */
    check(
      cash.cashBalance >= 0n ? cash.availableCash >= 0n : true,
      'Quỹ dự phòng không làm tiền khả dụng âm khi số dư không âm',
      `số dư ${formatVnd(cash.cashBalance)} · khả dụng ${formatVnd(cash.availableCash)}`,
    );
  }

  // =========================================================================
  header('D — Tổng hợp danh mục & tỷ trọng');
  // =========================================================================

  const summary = await computePortfolioSummary({ portfolioId: pid });

  {
    const inv = open.reduce((s, p) => s + p.marketValue, 0n);
    const cost = open.reduce((s, p) => s + p.totalCost, 0n);
    const unre = open.reduce((s, p) => s + p.unrealizedPnl, 0n);
    const real = positions.reduce((s, p) => s + p.realizedPnl, 0n);

    eq(summary.investedValue, inv, 'investedValue = Σ giá trị thị trường vị thế mở');
    eq(summary.investedCost, cost, 'investedCost = Σ giá vốn vị thế mở');
    eq(summary.unrealizedPnl, unre, 'unrealizedPnl = Σ theo mã');
    eq(summary.realizedPnl, real, 'realizedPnl = Σ theo mã (gồm cả mã đã đóng)');
    eq(summary.totalPnl, real + unre, 'totalPnl = đã chốt + chưa chốt');
    eq(
      summary.portfolioValue,
      summary.investedValue + cash.cashBalance,
      'portfolioValue = vị thế + SỐ DƯ tiền (không phải available)',
    );
    check(
      summary.totalPnlBps === ratioToBps(summary.totalPnl, summary.investedCost),
      'totalPnlBps chia cho GIÁ VỐN, không chia cho portfolioValue',
      formatBps(summary.totalPnlBps),
    );

    const a = summary.allocation;
    const tong = a.investedBps + a.cashBps + a.reserveBps;
    if (!coDuLieu) {
      skip('Invested + Cash + Reserve = 100% (§14)', 'danh mục chưa có giao dịch nào — không đánh giá được');
    } else {
      check(
        Math.abs(tong - BPS_TOTAL) <= 3,
        'Invested + Cash + Reserve = 100% (§14)',
        formatBps(tong, false),
      );
    }
  }

  // =========================================================================
  header('E — Tỷ trọng ngành & phân bổ chiến lược');
  // =========================================================================

  {
    const tongTT = summary.sectorExposure.reduce((s, x) => s + x.marketValue, 0n);
    eq(tongTT, summary.investedValue, 'Σ giá trị theo ngành = tổng vị thế');
    const tongBps = summary.sectorExposure.reduce((s, x) => s + x.weightBps, 0);
    if (!coDuLieu) {
      skip('Σ tỷ trọng ngành = 100%', 'danh mục chưa có giao dịch nào — không đánh giá được');
    } else {
      check(
        Math.abs(tongBps - BPS_TOTAL) <= 3,
        'Σ tỷ trọng ngành = 100%',
        formatBps(tongBps, false),
      );
    }
  }

  {
    // Σ allocationBps của mỗi lệnh = 10000; Σ allocationAmount = số tiền thực tế
    const trades = await prisma.trade.findMany({
      where: { portfolioId: pid, status: COUNTED_TRADE_STATUS },
      select: {
        code: true,
        transactionType: true,
        quantity: true,
        price: true,
        fees: true,
        tax: true,
        strategies: { select: { allocationBps: true, allocationAmount: true } },
      },
    });
    let saiBps = 0;
    let saiTien = 0;
    for (const t of trades) {
      const sBps = t.strategies.reduce((s, x) => s + x.allocationBps, 0);
      if (sBps !== BPS_TOTAL) saiBps += 1;
      const net = netAmount(
        t.transactionType === TRANSACTION_TYPE.BUY ? 'BUY' : 'SELL',
        t.quantity,
        t.price,
        t.fees,
        t.tax,
      );
      const sTien = t.strategies.reduce((s, x) => s + x.allocationAmount, 0n);
      if (sTien !== net) saiTien += 1;
    }
    check(saiBps === 0, `Σ allocationBps = 100% ở cả ${trades.length} lệnh`);
    check(
      saiTien === 0,
      'Σ allocationAmount = số tiền thực tế của lệnh, không lệch một đồng (largest remainder)',
    );

    /*
     * VỐN THEO CHIẾN LƯỢC = GIÁ VỐN PHẦN CÒN GIỮ, không phải dòng tiền ròng.
     *
     * Phép kiểm cũ ở đây so `Σ netCapital` với "Σ tiền mua − Σ tiền bán", và nó đúng
     * chừng nào `computeStrategyAllocation` còn tính theo cách cũ: cộng
     * `allocationAmount` lệnh mua, trừ `allocationAmount` lệnh bán. Nhưng cách đó lấy
     * TIỀN THU VỀ của lệnh bán trừ vào GIÁ VỐN của lệnh mua — hiệu số là lãi/lỗ đã
     * thực hiện, không phải vốn còn lại. Một chiến lược bán hết lỗ vẫn hiện còn vốn.
     *
     * Sau khi engine chuyển sang "giá vốn phần còn giữ", hai vế KHÔNG còn bằng nhau và
     * cũng không nên bằng nhau. Quan hệ đúng giữa chúng là:
     *
     *     Σ tiền mua − Σ tiền bán  =  Σ giá vốn còn giữ  −  lãi/lỗ đã chốt
     *
     * Kiểm đúng đẳng thức đó thì vẫn ràng được cả hai con số vào dữ liệu thô, mà không
     * ép engine quay về định nghĩa sai.
     */
    const tongCL = summary.strategyAllocation.reduce((s, x) => s + x.netCapital, 0n);
    const vonRong = trades.reduce((s, t) => {
      const n = netAmount(
        t.transactionType === TRANSACTION_TYPE.BUY ? 'BUY' : 'SELL',
        t.quantity,
        t.price,
        t.fees,
        t.tax,
      );
      return t.transactionType === TRANSACTION_TYPE.BUY ? s + n : s - n;
    }, 0n);

    const giaVonConGiu = positions
      .filter((p) => p.quantity > 0)
      .reduce((s, p) => s + p.totalCost, 0n);
    const daChot = positions.reduce((s, p) => s + p.realizedPnl, 0n);

    eq(
      tongCL,
      giaVonConGiu,
      'Σ vốn theo chiến lược = Σ giá vốn vị thế đang mở (không đếm trùng §16)',
    );
    eq(
      vonRong,
      giaVonConGiu - daChot,
      'Σ tiền mua − Σ tiền bán = giá vốn còn giữ − lãi/lỗ đã chốt',
    );
  }

  // =========================================================================
  header('F — Chia theo NHÓM: từng phần cộng lại phải bằng tổng');
  // =========================================================================

  {
    const teams = await computeTeamPerformance(pid);
    const s = (f: (t: (typeof teams)[number]) => bigint) => teams.reduce((a, t) => a + f(t), 0n);

    eq(s((t) => t.marketValue), summary.investedValue, 'Σ giá trị TT các nhóm = toàn danh mục');
    eq(s((t) => t.investedCost), summary.investedCost, 'Σ giá vốn các nhóm');
    eq(s((t) => t.realizedPnl), summary.realizedPnl, 'Σ lãi/lỗ đã chốt các nhóm');
    eq(s((t) => t.unrealizedPnl), summary.unrealizedPnl, 'Σ lãi/lỗ chưa chốt các nhóm');
    eq(s((t) => t.totalPnl), summary.totalPnl, 'Σ tổng lãi/lỗ các nhóm');
    eq(
      s((t) => t.netCapital),
      cash.spentOnBuys - cash.receivedFromSells,
      'Σ vốn ròng các nhóm = chi mua − thu bán',
    );

    const tongLenh = teams.reduce((a, t) => a + t.tradeCount, 0);
    const soLenh = await prisma.trade.count({
      where: { portfolioId: pid, status: COUNTED_TRADE_STATUS },
    });
    check(tongLenh === soLenh, 'Σ số lệnh các nhóm = tổng số lệnh', `${tongLenh} vs ${soLenh}`);

    // Tiền theo nhóm
    const teamRows = await prisma.team.findMany({ select: { id: true } });
    let tongDu = 0n;
    for (const t of [...teamRows.map((x) => x.id), null]) {
      const c = await computeCash(pid, { teamId: t });
      tongDu += c.cashBalance;
      if (c.scope !== 'TEAM' || c.reserveAmount !== 0n) {
        check(false, 'Phạm vi nhóm phải có reserveAmount = 0');
      }
    }
    eq(tongDu, cash.cashBalance, 'Σ số dư tiền các nhóm (kể cả chưa gán) = số dư danh mục');
  }

  // =========================================================================
  header('G — Chia theo CÁ NHÂN');
  // =========================================================================

  {
    const members = await computeMemberPerformance(pid);
    const s = (f: (m: (typeof members)[number]) => bigint) =>
      members.reduce((a, m) => a + f(m), 0n);

    eq(s((m) => m.marketValue), summary.investedValue, 'Σ giá trị TT các cá nhân');
    eq(s((m) => m.investedCost), summary.investedCost, 'Σ giá vốn các cá nhân');
    eq(s((m) => m.totalPnl), summary.totalPnl, 'Σ lãi/lỗ các cá nhân');

    const saiTyLe = members.filter(
      (m) =>
        m.returnBps !== null && m.returnBps !== ratioToBps(m.totalPnl, m.investedCost),
    );
    check(saiTyLe.length === 0, 'returnBps = totalPnl / investedCost ở mọi cá nhân');
    const saiNull = members.filter((m) => (m.investedCost === 0n) !== (m.returnBps === null));
    check(
      saiNull.length === 0,
      'returnBps là null KHI VÀ CHỈ KHI chưa có giá vốn (không in 0% giả)',
    );
  }

  // =========================================================================
  header('H — Tài khoản chứng khoán');
  // =========================================================================

  {
    const users = await prisma.user.findMany({ select: { id: true } });
    let capTong = 0n;
    let muaTong = 0n;
    let banTong = 0n;
    let soTK = 0;
    for (const u of users) {
      for (const b of await computeAccountBalances(pid, u.id)) {
        soTK += 1;
        capTong += b.granted;
        muaTong += b.spentOnBuys;
        banTong += b.receivedFromSells;
        if (b.available !== b.granted - b.spentOnBuys + b.receivedFromSells) {
          check(false, `Số dư TK ${b.accountNo} không khớp công thức`);
        }
      }
    }
    check(true, `Số dư mọi tài khoản = cấp − chi mua + thu bán (${soTK} tài khoản)`);

    // Phần chưa gắn tài khoản phải bù đúng phần chênh
    const flowChuaGan = await prisma.capitalFlow.findMany({
      where: { portfolioId: pid, status: 'CONFIRMED', brokerAccountId: null },
      select: { flowType: true, amount: true },
    });
    const capChuaGan = flowChuaGan.reduce(
      (s, f) => s + BigInt(CAPITAL_FLOW_SIGN[f.flowType as CapitalFlowType]) * f.amount,
      0n,
    );
    eq(
      capTong + capChuaGan,
      cash.contributedCapital + cash.otherFlows,
      'Σ vốn theo tài khoản + phần chưa gắn = tổng dòng vốn',
    );

    const lenhChuaGan = await prisma.trade.findMany({
      where: { portfolioId: pid, status: COUNTED_TRADE_STATUS, brokerAccountId: null },
      select: { transactionType: true, quantity: true, price: true, fees: true, tax: true },
    });
    let muaChuaGan = 0n;
    let banChuaGan = 0n;
    for (const t of lenhChuaGan) {
      const n = netAmount(
        t.transactionType === TRANSACTION_TYPE.BUY ? 'BUY' : 'SELL',
        t.quantity,
        t.price,
        t.fees,
        t.tax,
      );
      if (t.transactionType === TRANSACTION_TYPE.BUY) muaChuaGan += n;
      else banChuaGan += n;
    }
    eq(muaTong + muaChuaGan, cash.spentOnBuys, 'Σ chi mua theo TK + chưa gắn = tổng chi mua');
    eq(banTong + banChuaGan, cash.receivedFromSells, 'Σ thu bán theo TK + chưa gắn = tổng thu bán');
  }

  // =========================================================================
  header('I — Hiệu suất theo khoảng & Alpha');
  // =========================================================================

  {
    const series = await computePerformanceSeries(pid, 'YTD');
    const pts = series.points;
    if (!coDuLieu) {
      skip('Chuỗi theo phiên dựng được', 'danh mục chưa có giao dịch nào — không đánh giá được');
    } else {
      check(pts.length > 0, `Chuỗi theo phiên dựng được (${pts.length} phiên)`);
    }

    if (pts.length > 0) {
      check(
        Math.abs(pts[0]!.portfolioIndex - 100) < 1e-9,
        'portfolioIndex của phiên đầu = 100 (chuẩn hoá đúng gốc)',
      );
      const coIdx = pts.filter((p) => p.benchmarkIndex !== null);
      if (coIdx.length > 0) {
        check(
          Math.abs(coIdx[0]!.benchmarkIndex! - 100) < 1e-9,
          'benchmarkIndex của phiên đầu = 100 (CÙNG gốc với danh mục)',
        );
      }
      const saiRet = pts.filter(
        (p) => p.returnBps !== ratioToBps(p.marketValue - p.costValue, p.costValue),
      );
      check(saiRet.length === 0, 'returnBps từng phiên = (giá trị − giá vốn) / giá vốn');
    }

    const perf = await computePerformance(pid, 'YTD', summary.totalPnlBps, series);
    check(
      perf.alphaBps === perf.portfolioBps - perf.benchmarkBps,
      'Alpha = danh mục − chỉ số',
      formatBps(perf.alphaBps),
    );

    if (perf.source === 'series') {
      const both = pts.filter((p) => p.benchmarkIndex !== null);
      const end = both[both.length - 1]!;
      const bps = (i: number) => {
        const v = (i / 100 - 1) * 10_000;
        return v >= 0 ? Math.round(v) : -Math.round(-v);
      };
      check(
        perf.portfolioBps === bps(end.portfolioIndex) &&
          perf.benchmarkBps === bps(end.benchmarkIndex!),
        'Hai vế Alpha đọc ở CÙNG một phiên cuối (cùng gốc, cùng đích)',
        `phiên ${end.date.toISOString().slice(0, 10)}`,
      );
      check(perf.comparable, 'comparable = true khi hai vế cùng khoảng');
      check(
        perf.window !== null && perf.window.from.getTime() === pts[0]!.date.getTime(),
        'window.from = phiên gốc của chuỗi (nhãn nói đúng khoảng thật)',
      );
    }

    // Đổi khoảng phải đổi số — lỗi cũ là mọi khoảng ra cùng một con số
    const kq = new Set<number>();
    for (const p of ['1W', '1M', '3M', '6M', 'YTD'] as const) {
      const se = await computePerformanceSeries(pid, p);
      const pe = await computePerformance(pid, p, summary.totalPnlBps, se);
      kq.add(pe.portfolioBps);
    }
    if (!coDuLieu) {
      skip('Hiệu suất ĐỔI theo khoảng', 'danh mục chưa có giao dịch nào — không đánh giá được');
    } else {
      check(kq.size > 1, `Hiệu suất ĐỔI theo khoảng (${kq.size} giá trị khác nhau trên 5 khoảng)`);
    }
  }

  // =========================================================================
  header('J — Chốt phạm vi quyền (applyScope)');
  // =========================================================================

  {
    const team = await prisma.team.findFirstOrThrow({ select: { id: true } });
    const team2 = await prisma.team.findFirst({
      where: { id: { not: team.id } },
      select: { id: true },
    });

    const scoped = applyScope({ portfolioId: pid, teamId: team2?.id }, 'SCOPED', team.id);
    check(scoped.teamId === team.id, 'SCOPED ghi đè teamId người dùng tự truyền');

    const none = applyScope({ portfolioId: pid, teamId: team.id }, 'NONE', team.id);
    check(
      none.teamId === '__no_access__',
      'NONE ép về sentinel không khớp nhóm nào',
      String(none.teamId),
    );

    const khongNhom = applyScope({ portfolioId: pid }, 'SCOPED', null);
    check(khongNhom.teamId === '__no_team__', 'SCOPED không thuộc nhóm nào → sentinel riêng');

    const rong = await computePositions({ portfolioId: pid, teamId: '__no_access__' });
    check(rong.length === 0, 'Sentinel trả về 0 vị thế (không rò rỉ)');
  }


  // =========================================================================
  header('K — Lọc theo CHIẾN LƯỢC: số học khối lượng lẻ (§16)');
  // =========================================================================

  {
    /*
     * Lọc theo chiến lược nhân tiền theo `allocationBps`, nên khối lượng thành số lẻ
     * và `computePositions` phải giữ nó ở đơn vị micro. Đây là chỗ dễ mất/thừa tiền
     * nhất trong engine: cộng phần của mọi chiến lược lại PHẢI ra đúng bản không lọc.
     */
    const strategies = await prisma.strategy.findMany({
      where: { isActive: true },
      select: { id: true, nameVi: true },
    });

    let sumMv = 0n;
    let sumCost = 0n;
    for (const st of strategies) {
      const pos = await computePositions({ portfolioId: pid, strategyId: st.id });
      const o = pos.filter((x) => x.quantity > 0);
      sumMv += o.reduce((s, x) => s + x.marketValue, 0n);
      sumCost += o.reduce((s, x) => s + x.totalCost, 0n);
    }

    // Cho phép lệch tối đa 1 đồng cho mỗi (mã × chiến lược) vì mỗi lát được làm tròn
    const soLat = strategies.length * open.length;
    const lechMv = sumMv - summary.investedValue;
    const lechCost = sumCost - summary.investedCost;
    const absMv = lechMv < 0n ? -lechMv : lechMv;
    const absCost = lechCost < 0n ? -lechCost : lechCost;

    check(
      absMv <= BigInt(soLat),
      'Σ giá trị TT qua mọi chiến lược = tổng (sai số ≤ 1đ mỗi lát làm tròn)',
      `lệch ${lechMv}đ trên ${soLat} lát`,
    );
    check(
      absCost <= BigInt(soLat),
      'Σ giá vốn qua mọi chiến lược = tổng',
      `lệch ${lechCost}đ trên ${soLat} lát`,
    );
  }

  // =========================================================================
  header('L — allocateAmount: chia tiền theo tỷ lệ, không mất một đồng');
  // =========================================================================

  {
    const bo: [bigint, number[]][] = [
      [100n, [3333, 3333, 3334]],
      [1n, [5000, 5000]],
      [7n, [3333, 3333, 3334]],
      [1_000_000_007n, [2500, 2500, 2500, 2500]],
      [999_999_999n, [1, 9999]],
      [0n, [5000, 5000]],
    ];
    let sai = 0;
    for (const [tong, bps] of bo) {
      const phan = allocateAmount(tong, bps);
      const lai = phan.reduce((a, b) => a + b, 0n);
      if (lai !== tong) {
        sai += 1;
        console.log(`        ${tong} chia ${bps.join('/')} → Σ ${lai}`);
      }
      if (phan.length !== bps.length) sai += 1;
    }
    check(sai === 0, `Σ các phần luôn bằng đúng tổng ban đầu (${bo.length} trường hợp)`);

    // Số âm (lệnh bán) cũng phải chia đúng
    const am = allocateAmount(-100n, [3333, 3333, 3334]);
    check(
      am.reduce((a, b) => a + b, 0n) === -100n,
      'Chia đúng cả với số âm',
      am.join(' + ') + ' = ' + am.reduce((a, b) => a + b, 0n),
    );
  }

  // =========================================================================
  header('M — Engine rủi ro: đo lại từng cảnh báo đang mở');
  // =========================================================================

  {
    const alerts = await prisma.riskAlert.findMany({
      where: { status: 'OPEN' },
      select: {
        id: true,
        title: true,
        measuredValue: true,
        thresholdValue: true,
        targetRef: true,
        // comparator va metric nam o RiskRule, khong o RiskAlert
        rule: { select: { metric: true, comparator: true } },
      },
    });

    check(alerts.length >= 0, `${alerts.length} cảnh báo đang mở`);

    // Cảnh báo tập trung một mã: đo lại tỷ trọng từ vị thế
    let saiDo = 0;
    for (const a of alerts) {
      if (a.rule.metric !== 'SINGLE_STOCK_WEIGHT' || !a.targetRef || a.measuredValue === null) continue;
      const p = open.find((x) => x.symbol === a.targetRef);
      if (!p) {
        saiDo += 1;
        console.log(`        ${a.targetRef}: có cảnh báo nhưng không còn vị thế`);
        continue;
      }
      const bps = BigInt(ratioToBps(p.marketValue, summary.investedValue));
      if (bps !== a.measuredValue) {
        saiDo += 1;
        console.log(
          `        ${a.targetRef}: cảnh báo ghi ${a.measuredValue} bps, đo lại ${bps} bps`,
        );
      }
    }
    check(
      saiDo === 0,
      'Cảnh báo "tập trung một mã" khớp tỷ trọng đo lại từ vị thế hiện tại',
      'lưu ý: lệch là bình thường nếu giá đã đổi sau lần quét gần nhất',
    );

    // Điều kiện so sánh phải thật sự bị vi phạm
    const khongViPham = alerts.filter((a) => {
      if (a.thresholdValue === null || a.measuredValue === null) return false;
      switch (a.rule.comparator) {
        case 'GT':
          return !(a.measuredValue > a.thresholdValue);
        case 'GTE':
          return !(a.measuredValue >= a.thresholdValue);
        case 'LT':
          return !(a.measuredValue < a.thresholdValue);
        case 'LTE':
          return !(a.measuredValue <= a.thresholdValue);
        default:
          return false;
      }
    });
    check(
      khongViPham.length === 0,
      'Mọi cảnh báo đang mở đều thật sự vi phạm ngưỡng của nó',
      khongViPham.map((a) => a.title).join(' · '),
    );
  }

  // =========================================================================
  console.log('\n' + '='.repeat(88));
  console.log(` KẾT QUẢ: ${pass} đạt · ${fail} sai · ${skipped} bỏ qua`);
  if (fail > 0) {
    console.log('\n Các phép kiểm KHÔNG đạt:');
    for (const f of failures) console.log('   • ' + f);
  }
  console.log('='.repeat(88));

  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('\nLỖI KHI CHẠY:', e);
  await prisma.$disconnect();
  process.exit(1);
});
