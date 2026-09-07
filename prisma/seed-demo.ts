/**
 * Seed DỮ LIỆU MINH HOẠ.
 *
 * Chạy:  npm run db:seed:demo   (yêu cầu đã chạy npm run db:seed trước)
 *
 * Mục đích không phải là "cho dashboard có số cho đẹp". Mục đích là CHỨNG MINH
 * mô hình dữ liệu Phase 01 đáp ứng đúng các yêu cầu khó nhất của đặc tả:
 *
 *   §6  Một Trade phân bổ nhiều Strategy, tổng luôn = 100%, không đếm trùng vốn.
 *   §9  Position / Average Cost / P&L tính được hoàn toàn từ Trade + MarketQuote,
 *       không cần bảng nào lưu sẵn.
 *   §20 Sửa giao dịch để lại dấu vết Before/After trong Audit Log.
 *
 * Mọi giao dịch ở đây đi qua `tradeSchema` và `buildTradeStrategyRows` — đúng
 * con đường mà UI ở Phase 04/05 sẽ dùng, nên nếu seed chạy được thì đường ghi
 * dữ liệu thật cũng chạy được.
 *
 * CẢNH BÁO: script này tạo dữ liệu GIẢ. Không chạy trên môi trường thật.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { tradeSchema, buildTradeStrategyRows, type TradeInput } from '../src/domain/validation';
import { calcFee, grossAmount, netAmount, formatVnd, formatCompactVnd } from '../src/lib/money';
import {
  ROLE,
  USER_STATUS,
  TRADE_STATUS,
  TRANSACTION_TYPE,
  CAPITAL_FLOW_TYPE,
  AUDIT_ACTION,
  ENTITY_TYPE,
  MARKET_DATA_SOURCE,
} from '../src/lib/enums';
import { stringifyForAudit } from '../src/lib/serialize';
import { toTradingDate } from '../src/lib/trading-date';

const prisma = new PrismaClient();

/** Phí môi giới 0,15% ; thuế bán 0,10%. Khớp mặc định trong SystemSetting. */
const FEE_RATE_BPS = 15;
const SELL_TAX_RATE_BPS = 10;

const DEMO_PASSWORD = 'Demo@2026Pass';

// ---------------------------------------------------------------------------
// Người dùng minh hoạ
// ---------------------------------------------------------------------------

interface DemoUser {
  email: string;
  fullName: string;
  roleCode: string | null;
  departmentCode: string | null;
  teamCode: string | null;
  status: string;
  employeeCode?: string;
}

const DEMO_USERS: readonly DemoUser[] = [
  {
    email: 'manager@vninvest.local',
    fullName: 'Trần Senior Manager',
    roleCode: ROLE.SENIOR_MANAGER,
    departmentCode: 'SENIOR_MANAGEMENT',
    teamCode: null,
    status: USER_STATUS.ACTIVE,
    employeeCode: 'SM-001',
  },
  {
    email: 'pm@vninvest.local',
    fullName: 'Lê Portfolio Manager',
    roleCode: ROLE.EXECUTION,
    departmentCode: 'INVESTMENT_MANAGEMENT',
    teamCode: 'TAI_CHINH',
    status: USER_STATUS.ACTIVE,
    employeeCode: 'PM-001',
  },
  {
    email: 'trader1@vninvest.local',
    fullName: 'Nguyễn Văn A',
    roleCode: ROLE.EXECUTION,
    departmentCode: 'INVESTMENT_MANAGEMENT',
    teamCode: 'DA_BONG',
    status: USER_STATUS.ACTIVE,
    employeeCode: 'EX-001',
  },
  {
    email: 'trader2@vninvest.local',
    fullName: 'Phạm Thị B',
    roleCode: ROLE.EXECUTION,
    departmentCode: 'INVESTMENT_MANAGEMENT',
    teamCode: 'CAU_LONG',
    status: USER_STATUS.ACTIVE,
    employeeCode: 'EX-002',
  },
  {
    email: 'support1@vninvest.local',
    fullName: 'Hoàng Văn C',
    roleCode: ROLE.SUPPORTING_EXECUTION,
    departmentCode: 'INVESTMENT_MANAGEMENT',
    teamCode: 'TAI_CHINH',
    status: USER_STATUS.ACTIVE,
    employeeCode: 'SE-001',
  },
  {
    // Minh hoạ luồng §4: đăng ký xong nằm ở PENDING, chưa có role/team.
    email: 'pending@vninvest.local',
    fullName: 'Đỗ Thị D',
    roleCode: null,
    departmentCode: null,
    teamCode: null,
    status: USER_STATUS.PENDING,
  },
];

// ---------------------------------------------------------------------------
// Giao dịch minh hoạ
// ---------------------------------------------------------------------------

interface DemoTrade {
  symbol: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  /** [mã strategy, tỷ lệ bps] — tổng phải bằng 10000 */
  allocations: [string, number][];
  executedAt: string;
  trader: string;
  note?: string;
}

const DEMO_TRADES: readonly DemoTrade[] = [
  // Đúng ví dụ trong đặc tả §6: MBB, Value 50% / Signal 30% / Accumulation 20%
  {
    symbol: 'MBB',
    type: TRANSACTION_TYPE.BUY,
    quantity: 40_000,
    price: 25_300,
    allocations: [['VALUE', 5_000], ['SIGNAL', 3_000], ['ACCUMULATION', 2_000]],
    executedAt: '2026-02-10T09:35:00+07:00',
    trader: 'trader1@vninvest.local',
    note: 'Ví dụ tham chiếu của đặc tả §6.',
  },
  {
    symbol: 'VCB',
    type: TRANSACTION_TYPE.BUY,
    quantity: 12_000,
    price: 62_000,
    allocations: [['VALUE', 6_000], ['ACCUMULATION', 4_000]],
    executedAt: '2026-02-12T10:05:00+07:00',
    trader: 'trader1@vninvest.local',
  },
  {
    symbol: 'FPT',
    type: TRANSACTION_TYPE.BUY,
    quantity: 8_000,
    price: 118_000,
    allocations: [['SIGNAL', 7_000], ['VALUE', 3_000]],
    executedAt: '2026-02-18T13:40:00+07:00',
    trader: 'trader2@vninvest.local',
  },
  {
    symbol: 'HPG',
    type: TRANSACTION_TYPE.BUY,
    quantity: 30_000,
    price: 26_500,
    allocations: [['SECTOR_ROTATION', 10_000]],
    executedAt: '2026-03-03T09:20:00+07:00',
    trader: 'trader2@vninvest.local',
  },
  {
    symbol: 'SSI',
    type: TRANSACTION_TYPE.BUY,
    quantity: 25_000,
    price: 28_000,
    allocations: [['SIGNAL', 5_000], ['SECTOR_ROTATION', 5_000]],
    executedAt: '2026-03-11T11:15:00+07:00',
    trader: 'trader1@vninvest.local',
  },
  {
    symbol: 'VNM',
    type: TRANSACTION_TYPE.BUY,
    quantity: 10_000,
    price: 64_000,
    allocations: [['ACCUMULATION', 10_000]],
    executedAt: '2026-04-02T14:25:00+07:00',
    trader: 'pm@vninvest.local',
  },
  {
    symbol: 'TCB',
    type: TRANSACTION_TYPE.BUY,
    quantity: 25_000,
    price: 24_000,
    allocations: [['VALUE', 4_000], ['SIGNAL', 3_000], ['SECTOR_ROTATION', 3_000]],
    executedAt: '2026-04-15T09:50:00+07:00',
    trader: 'trader1@vninvest.local',
  },
  {
    symbol: 'DGC',
    type: TRANSACTION_TYPE.BUY,
    quantity: 5_000,
    price: 92_000,
    allocations: [['VALUE', 10_000]],
    executedAt: '2026-05-06T10:30:00+07:00',
    trader: 'trader2@vninvest.local',
  },
  {
    symbol: 'GAS',
    type: TRANSACTION_TYPE.BUY,
    quantity: 8_000,
    price: 68_000,
    allocations: [['OTHER', 10_000]],
    executedAt: '2026-05-20T13:10:00+07:00',
    trader: 'pm@vninvest.local',
  },
  {
    symbol: 'MWG',
    type: TRANSACTION_TYPE.BUY,
    quantity: 9_000,
    price: 58_000,
    allocations: [['SIGNAL', 6_000], ['VALUE', 4_000]],
    executedAt: '2026-06-09T09:45:00+07:00',
    trader: 'trader1@vninvest.local',
  },
  {
    // CA KIỂM THỬ LÀM TRÒN: chia 3 phần 33,34% / 33,33% / 33,33% trên một số
    // tiền không chia hết. Nếu allocateAmount() sai thì tổng phân bổ sẽ lệch
    // vài đồng so với giá trị lệnh — verify:model sẽ phát hiện ngay.
    symbol: 'ACB',
    type: TRANSACTION_TYPE.BUY,
    quantity: 7_777,
    price: 23_450,
    allocations: [['VALUE', 3_334], ['SIGNAL', 3_333], ['ACCUMULATION', 3_333]],
    executedAt: '2026-07-01T10:12:00+07:00',
    trader: 'support1@vninvest.local',
    note: 'Ca kiểm thử làm tròn phân bổ 1/3.',
  },
  {
    // Lệnh bán để tạo lãi/lỗ đã thực hiện (realized P&L).
    symbol: 'HPG',
    type: TRANSACTION_TYPE.SELL,
    quantity: 10_000,
    price: 28_900,
    allocations: [['SECTOR_ROTATION', 10_000]],
    executedAt: '2026-07-22T14:05:00+07:00',
    trader: 'trader2@vninvest.local',
    note: 'Chốt một phần vị thế HPG.',
  },
];

/** Giá thị trường hiện tại để Portfolio Engine tính lãi/lỗ chưa thực hiện. */
const DEMO_QUOTES: Record<string, number> = {
  MBB: 26_150,
  VCB: 67_200,
  FPT: 131_800,
  HPG: 25_950,
  SSI: 29_900,
  VNM: 61_500,
  TCB: 26_800,
  DGC: 88_400,
  GAS: 71_300,
  MWG: 64_500,
  ACB: 24_100,
};

// ---------------------------------------------------------------------------
// Thực thi
// ---------------------------------------------------------------------------

async function seedDemoUsers(): Promise<Map<string, string>> {
  console.log('\n[1/6] Người dùng minh hoạ');

  const [roles, departments, teams] = await Promise.all([
    prisma.role.findMany(),
    prisma.department.findMany(),
    prisma.team.findMany(),
  ]);
  const roleByCode = new Map(roles.map((r) => [r.code, r.id]));
  const deptByCode = new Map(departments.map((d) => [d.code, d.id]));
  const teamByCode = new Map(teams.map((t) => [t.code, t.id]));

  const admin = await prisma.user.findFirst({ where: { employeeCode: 'ADMIN-001' } });
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const userIds = new Map<string, string>();

  for (const u of DEMO_USERS) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        passwordHash,
        fullName: u.fullName,
        status: u.status,
        roleId: u.roleCode ? roleByCode.get(u.roleCode) ?? null : null,
        departmentId: u.departmentCode ? deptByCode.get(u.departmentCode) ?? null : null,
        teamId: u.teamCode ? teamByCode.get(u.teamCode) ?? null : null,
        employeeCode: u.employeeCode,
        approvedById: u.status === USER_STATUS.ACTIVE ? admin?.id ?? null : null,
        approvedAt: u.status === USER_STATUS.ACTIVE ? new Date('2026-01-08T09:00:00+07:00') : null,
        mustChangePassword: true,
      },
      update: {},
    });
    userIds.set(u.email, row.id);
    console.log(`  ${u.email.padEnd(30)} ${(u.roleCode ?? 'CHƯA GÁN ROLE').padEnd(22)} ${u.status}`);
  }

  return userIds;
}

async function seedCapital(portfolioId: string, adminId: string): Promise<void> {
  console.log('\n[2/6] Nguồn vốn');

  const flows: { type: string; amount: bigint; date: string; note: string }[] = [
    { type: CAPITAL_FLOW_TYPE.CONTRIBUTION, amount: 8_000_000_000n, date: '2026-01-06T09:00:00+07:00', note: 'Vốn góp đợt 1' },
    { type: CAPITAL_FLOW_TYPE.CONTRIBUTION, amount: 2_500_000_000n, date: '2026-03-02T09:00:00+07:00', note: 'Vốn góp đợt 2' },
    { type: CAPITAL_FLOW_TYPE.DIVIDEND, amount: 84_000_000n, date: '2026-06-15T09:00:00+07:00', note: 'Cổ tức tiền mặt VNM' },
    { type: CAPITAL_FLOW_TYPE.INTEREST, amount: 12_400_000n, date: '2026-06-30T09:00:00+07:00', note: 'Lãi tiền gửi không kỳ hạn' },
  ];

  // Xoá dòng vốn demo cũ để chạy lại không cộng dồn.
  await prisma.capitalFlow.deleteMany({ where: { portfolioId, reference: { startsWith: 'DEMO-' } } });

  let index = 0;
  for (const flow of flows) {
    index += 1;
    await prisma.capitalFlow.create({
      data: {
        portfolioId,
        flowType: flow.type,
        amount: flow.amount,
        occurredAt: new Date(flow.date),
        reference: `DEMO-CF-${String(index).padStart(3, '0')}`,
        note: flow.note,
        createdById: adminId,
        approvedById: adminId,
        approvedAt: new Date(flow.date),
      },
    });
    console.log(`  ${flow.type.padEnd(14)} ${formatVnd(flow.amount).padStart(20)}  ${flow.note}`);
  }

  await prisma.portfolio.update({
    where: { id: portfolioId },
    data: { reserveAmount: 480_000_000n, inceptionDate: new Date('2026-01-06T09:00:00+07:00') },
  });
  console.log(`  ${'RESERVE'.padEnd(14)} ${formatVnd(480_000_000n).padStart(20)}  Quỹ dự phòng`);
}

async function seedTrades(
  portfolioId: string,
  userIds: Map<string, string>,
): Promise<string[]> {
  console.log('\n[3/6] Giao dịch (đi qua zod + allocateAmount)');

  const [stocks, strategies, users] = await Promise.all([
    prisma.stock.findMany({ select: { id: true, symbol: true } }),
    prisma.strategy.findMany({ select: { id: true, code: true } }),
    prisma.user.findMany({ select: { id: true, teamId: true, email: true } }),
  ]);
  const stockBySymbol = new Map(stocks.map((s) => [s.symbol, s.id]));
  const strategyByCode = new Map(strategies.map((s) => [s.code, s.id]));
  const teamByUser = new Map(users.map((u) => [u.id, u.teamId]));

  // Xoá giao dịch demo cũ (TradeStrategy tự xoá theo cascade).
  await prisma.trade.deleteMany({ where: { code: { startsWith: 'TXN-2026-' } } });

  /*
   * MỘT TÀI KHOẢN CHỨNG KHOÁN CHO MỖI NGƯỜI THỰC HIỆN.
   *
   * `tradeSchema` nay bắt buộc `brokerAccountId` — không có tài khoản thì không
   * nhập được lệnh. Seed phải đi đúng con đường đó, nếu không nó sẽ dựng ra thứ dữ
   * liệu mà chính ứng dụng không cho phép tạo, và bug sẽ chỉ lộ ra ở người dùng thật.
   *
   * `upsert` theo (broker, accountNo) nên chạy seed nhiều lần không tạo trùng. Số
   * tài khoản dựng từ email để mỗi người một số cố định.
   */
  const accountByUser = new Map<string, string>();
  /*
   * IB demo phải là một BẢN GHI trong danh mục, không còn là chuỗi gõ vào tài khoản.
   * `upsert` theo `code` để chạy seed nhiều lần không đẻ ra nhiều IB trùng tên.
   */
  const ibDemo = await prisma.introducingBroker.upsert({
    where: { code: 'DEMO_IB' },
    update: {},
    create: { code: 'DEMO_IB', name: 'Demo IB', note: 'IB do seed demo tạo' },
    select: { id: true },
  });

  for (const u of users) {
    const local = u.email.split('@')[0] ?? '';
    const suffix = local.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (!suffix) continue;
    const accountNo = `DEMO${suffix}`;
    const acc = await prisma.brokerAccount.upsert({
      where: { broker_accountNo: { broker: 'SSI', accountNo } },
      update: {},
      create: {
        userId: u.id,
        broker: 'SSI',
        accountNo,
        ibId: ibDemo.id,
        note: 'Tài khoản demo do seed tạo',
      },
      select: { id: true },
    });
    accountByUser.set(u.id, acc.id);
  }

  const tradeIds: string[] = [];
  let seq = 0;

  for (const t of DEMO_TRADES) {
    seq += 1;
    const stockId = stockBySymbol.get(t.symbol);
    if (!stockId) throw new Error(`Không có mã ${t.symbol} trong master data`);

    const executorId = userIds.get(t.trader);
    if (!executorId) throw new Error(`Không có người dùng ${t.trader}`);

    const price = BigInt(t.price);
    const gross = grossAmount(t.quantity, price);
    const fees = calcFee(gross, FEE_RATE_BPS);
    const tax = t.type === TRANSACTION_TYPE.SELL ? calcFee(gross, SELL_TAX_RATE_BPS) : 0n;

    // Dựng input rồi cho zod kiểm tra — đúng đường mà form ở Phase 04 sẽ đi.
    const input: TradeInput = tradeSchema.parse({
      portfolioId,
      stockId,
      transactionType: t.type,
      quantity: t.quantity,
      price,
      fees,
      tax,
      executedAt: new Date(t.executedAt),
      userId: executorId,
      teamId: teamByUser.get(executorId) ?? undefined,
      brokerAccountId: accountByUser.get(executorId),
      status: TRADE_STATUS.EXECUTED,
      broker: 'SSI',
      executionNote: t.note,
      strategies: t.allocations.map(([code, bps]) => {
        const strategyId = strategyByCode.get(code);
        if (!strategyId) throw new Error(`Không có chiến lược ${code}`);
        return { strategyId, allocationBps: bps };
      }),
    });

    const { netAmount: net, rows } = buildTradeStrategyRows(input);

    // Ghi Trade + TradeStrategy trong MỘT transaction. Không bao giờ được tồn tại
    // một Trade thiếu phân bổ chiến lược, hoặc phân bổ không đủ 100%.
    const trade = await prisma.$transaction(async (tx) => {
      const created = await tx.trade.create({
        data: {
          code: `TXN-2026-${String(seq).padStart(6, '0')}`,
          portfolioId: input.portfolioId,
          stockId: input.stockId,
          transactionType: input.transactionType,
          quantity: input.quantity,
          price: input.price,
          fees: input.fees,
          tax: input.tax,
          executedAt: input.executedAt,
          status: TRADE_STATUS.EXECUTED,
          userId: input.userId,
          teamId: input.teamId ?? null,
          broker: input.broker,
          executionNote: input.executionNote,
          createdById: input.userId,
        },
      });

      await tx.tradeStrategy.createMany({
        data: rows.map((r) => ({ tradeId: created.id, ...r })),
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.userId,
          actorName: t.trader,
          action: AUDIT_ACTION.CREATE,
          entityType: ENTITY_TYPE.TRADE,
          entityId: created.id,
          entityLabel: `${t.type} ${t.symbol} ${t.quantity.toLocaleString('vi-VN')} @ ${t.price.toLocaleString('vi-VN')}`,
          afterJson: stringifyForAudit({
            code: created.code,
            symbol: t.symbol,
            transactionType: t.type,
            quantity: t.quantity,
            price: t.price,
            fees,
            tax,
            netAmount: net,
            strategies: t.allocations.map(([code, bps]) => ({ code, percent: bps / 100 })),
          }),
          occurredAt: input.executedAt,
        },
      });

      return created;
    });

    tradeIds.push(trade.id);

    const allocText = t.allocations.map(([c, b]) => `${c} ${b / 100}%`).join(' / ');
    console.log(
      `  ${trade.code}  ${t.type.padEnd(4)} ${t.symbol.padEnd(4)} ` +
        `${t.quantity.toLocaleString('vi-VN').padStart(9)} @ ${t.price.toLocaleString('vi-VN').padStart(8)}  ` +
        `${formatCompactVnd(net).padStart(10)}  ${allocText}`,
    );
  }

  return tradeIds;
}

async function seedQuotes(): Promise<void> {
  console.log('\n[4/6] Giá thị trường');

  const now = new Date();
  // Chuẩn hoá qua toTradingDate: nếu ghi thẳng 15:00+07 thì cột lưu 08:00Z, khác
  // với 00:00Z mà Market Data Service ghi, và khoá unique sẽ không chặn được trùng.
  const tradingDate = toTradingDate('2026-08-24');

  for (const [symbol, price] of Object.entries(DEMO_QUOTES)) {
    const stock = await prisma.stock.findUnique({ where: { symbol } });
    if (!stock) continue;

    // Giá tham chiếu giả định thấp hơn 0,8% để có changeBps khác 0.
    const reference = BigInt(Math.round(price / 1.008 / 10) * 10);

    await prisma.marketQuote.upsert({
      where: { stockId: stock.id },
      create: {
        stockId: stock.id,
        price: BigInt(price),
        referencePrice: reference,
        tradingDate,
        source: MARKET_DATA_SOURCE.SEED,
        fetchedAt: now,
        changeBps: Number(((BigInt(price) - reference) * 10_000n) / reference),
      },
      update: {
        price: BigInt(price),
        referencePrice: reference,
        tradingDate,
        fetchedAt: now,
        isStale: false,
        changeBps: Number(((BigInt(price) - reference) * 10_000n) / reference),
      },
    });
  }
  console.log(`  ${Object.keys(DEMO_QUOTES).length} mã có giá`);

  /*
   * Chỉ số tham chiếu để tính Alpha (§13).
   *
   * CHỈ chèn khi CHƯA có dữ liệu chỉ số thật. Hai mốc dưới đây là số bịa, dùng để
   * `verify:model` chứng minh được phép tính Alpha khi Market Data Service (Phase
   * 07) chưa chạy.
   *
   * Trộn chúng vào chuỗi dữ liệu thật là có hại: mốc đầu kỳ bịa sẽ làm Alpha sai
   * hoàn toàn (đã thực sự xảy ra — Dashboard báo +47% thay vì con số thật). Vì vậy
   * dữ liệu thật luôn thắng, và seed tự lùi bước.
   */
  const realIndexRows = await prisma.marketIndexHistory.count({
    where: { source: { not: MARKET_DATA_SOURCE.SEED } },
  });

  if (realIndexRows > 0) {
    console.log(`  Bỏ qua chỉ số minh hoạ — đã có ${realIndexRows} phiên dữ liệu thật.`);
  } else {
    await prisma.marketIndexHistory.upsert({
      where: { indexCode_tradingDate: { indexCode: 'VNINDEX', tradingDate } },
      create: { indexCode: 'VNINDEX', tradingDate, closeValue: 128_543n, source: MARKET_DATA_SOURCE.SEED },
      update: { closeValue: 128_543n },
    });
    await prisma.marketIndexHistory.upsert({
      where: {
        indexCode_tradingDate: { indexCode: 'VNINDEX', tradingDate: toTradingDate('2026-01-02') },
      },
      create: {
        indexCode: 'VNINDEX',
        tradingDate: toTradingDate('2026-01-02'),
        closeValue: 121_470n,
        source: MARKET_DATA_SOURCE.SEED,
      },
      update: { closeValue: 121_470n },
    });
    console.log('  VNINDEX minh hoạ 02/01/2026 = 1.214,70 → 24/08/2026 = 1.285,43');
    console.log('  (chạy `python sync.py index --days 365` để thay bằng dữ liệu thật)');
  }

  // Nhật ký đồng bộ thành công để Dashboard hiện "Market Data ● Connected".
  await prisma.marketDataSync.create({
    data: {
      source: MARKET_DATA_SOURCE.SEED,
      kind: 'QUOTE',
      startedAt: new Date(now.getTime() - 1_800),
      finishedAt: now,
      status: 'SUCCESS',
      symbolsRequested: Object.keys(DEMO_QUOTES).length,
      symbolsUpdated: Object.keys(DEMO_QUOTES).length,
      durationMs: 1_800,
      triggeredBy: 'MANUAL',
    },
  });
}

async function seedAuditTrailExample(tradeIds: string[]): Promise<void> {
  console.log('\n[5/6] Ví dụ sửa giao dịch có dấu vết (§20)');

  const firstTradeId = tradeIds[0];
  if (!firstTradeId) return;

  const before = await prisma.trade.findUnique({
    where: { id: firstTradeId },
    include: { stock: true },
  });
  if (!before) return;

  const manager = await prisma.user.findUnique({ where: { email: 'manager@vninvest.local' } });
  const newQuantity = 42_000;
  const newFees = calcFee(grossAmount(newQuantity, before.price), FEE_RATE_BPS);

  // Sửa khối lượng: 40.000 → 42.000. Phân bổ chiến lược phải được tính lại theo
  // số tiền mới, nếu không thì Σ allocationAmount sẽ lệch so với giá trị lệnh.
  const existingAllocations = await prisma.tradeStrategy.findMany({
    where: { tradeId: firstTradeId },
    orderBy: { allocationBps: 'desc' },
  });

  const newNet = netAmount(
    before.transactionType as 'BUY' | 'SELL',
    newQuantity,
    before.price,
    newFees,
    before.tax,
  );

  const { allocateAmount } = await import('../src/lib/money');
  const newAmounts = allocateAmount(newNet, existingAllocations.map((a) => a.allocationBps));

  await prisma.$transaction(async (tx) => {
    const after = await tx.trade.update({
      where: { id: firstTradeId },
      data: {
        quantity: newQuantity,
        fees: newFees,
        updatedById: manager?.id ?? null,
        version: { increment: 1 },
      },
    });

    for (let i = 0; i < existingAllocations.length; i++) {
      await tx.tradeStrategy.update({
        where: { id: existingAllocations[i]!.id },
        data: { allocationAmount: newAmounts[i]! },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId: manager?.id ?? null,
        actorName: manager?.fullName ?? 'Manager',
        actorRole: ROLE.SENIOR_MANAGER,
        action: AUDIT_ACTION.UPDATE,
        entityType: ENTITY_TYPE.TRADE,
        entityId: firstTradeId,
        entityLabel: `${before.transactionType} ${before.stock.symbol}`,
        beforeJson: stringifyForAudit({ quantity: before.quantity, fees: before.fees, version: before.version }),
        afterJson: stringifyForAudit({ quantity: after.quantity, fees: after.fees, version: after.version }),
        changedFieldsJson: JSON.stringify(['quantity', 'fees']),
        note: 'Điều chỉnh khối lượng khớp theo xác nhận của môi giới.',
      },
    });
  });

  console.log(`  ${before.stock.symbol}: quantity ${before.quantity.toLocaleString('vi-VN')} → ${newQuantity.toLocaleString('vi-VN')}`);
  console.log(`  ${' '.repeat(before.stock.symbol.length)}  fees     ${formatVnd(before.fees)} → ${formatVnd(newFees)}`);
  console.log('  Đã ghi AuditLog với Before/After và danh sách field thay đổi.');
}

async function seedPendingApproval(portfolioId: string, userIds: Map<string, string>): Promise<void> {
  console.log('\n[6/6] Giao dịch chờ duyệt & đề nghị duyệt');

  const stock = await prisma.stock.findUnique({ where: { symbol: 'VHM' } });
  const strategy = await prisma.strategy.findUnique({ where: { code: 'VALUE' } });
  const traderId = userIds.get('trader1@vninvest.local');
  if (!stock || !strategy || !traderId) return;

  const trader = await prisma.user.findUnique({ where: { id: traderId } });
  const quantity = 20_000;
  const price = 58_500n;
  const fees = calcFee(grossAmount(quantity, price), FEE_RATE_BPS);
  const net = netAmount('BUY', quantity, price, fees, 0n);

  const trade = await prisma.trade.create({
    data: {
      code: 'TXN-2026-000900',
      portfolioId,
      stockId: stock.id,
      transactionType: TRANSACTION_TYPE.BUY,
      quantity,
      price,
      fees,
      executedAt: new Date('2026-08-24T09:30:00+07:00'),
      status: TRADE_STATUS.PENDING_APPROVAL,
      userId: traderId,
      teamId: trader?.teamId ?? null,
      createdById: traderId,
      investmentThesis: 'Giá về vùng hỗ trợ dài hạn, P/B dưới trung bình 5 năm.',
      strategies: {
        create: [{ strategyId: strategy.id, allocationBps: 10_000, allocationAmount: net }],
      },
    },
  });

  await prisma.approvalRequest.create({
    data: {
      entityType: ENTITY_TYPE.TRADE,
      entityId: trade.id,
      action: 'CREATE',
      requestedById: traderId,
      reason: 'Giá trị lệnh vượt ngưỡng 1 tỷ đồng nên cần duyệt.',
      requestedAt: new Date('2026-08-24T09:31:00+07:00'),
    },
  });

  console.log(`  ${trade.code}  BUY VHM ${quantity.toLocaleString('vi-VN')} @ 58.500  ${formatCompactVnd(net)}  → PENDING_APPROVAL`);
  console.log('  Đã tạo ApprovalRequest tương ứng.');
}

async function main(): Promise<void> {
  console.log('='.repeat(95));
  console.log(' SEED DỮ LIỆU MINH HOẠ — CHỈ DÙNG CHO MÔI TRƯỜNG PHÁT TRIỂN');
  console.log('='.repeat(95));

  const portfolio = await prisma.portfolio.findUnique({ where: { code: 'MAIN' } });
  if (!portfolio) throw new Error('Chưa có danh mục MAIN. Chạy `npm run db:seed` trước.');

  const admin = await prisma.user.findFirst({ where: { employeeCode: 'ADMIN-001' } });
  if (!admin) throw new Error('Chưa có tài khoản admin. Chạy `npm run db:seed` trước.');

  const userIds = await seedDemoUsers();
  await seedCapital(portfolio.id, admin.id);
  const tradeIds = await seedTrades(portfolio.id, userIds);
  await seedQuotes();
  await seedAuditTrailExample(tradeIds);
  await seedPendingApproval(portfolio.id, userIds);

  console.log('\n' + '='.repeat(95));
  console.log(` HOÀN TẤT — mật khẩu mọi tài khoản demo: ${DEMO_PASSWORD}`);
  console.log('='.repeat(95));
  console.log(' Chạy `npm run verify:model` để kiểm chứng Position / P&L / Strategy.\n');
}

main()
  .catch((error: unknown) => {
    console.error('\nSEED DEMO THẤT BẠI:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
