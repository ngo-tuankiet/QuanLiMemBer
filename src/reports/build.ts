import 'server-only';

/**
 * Dựng dữ liệu cho từng báo cáo (§20) — Phase 10.
 *
 * MỌI SỐ ĐỀU TÍNH LẠI, KHÔNG ĐỌC SỐ LƯU SẴN. Báo cáo dùng chính Portfolio Engine
 * mà Dashboard dùng, nên tệp xuất ra và màn hình không bao giờ nói hai điều khác
 * nhau. Đây là lý do §23 cấm lưu P&L: chỉ cần một nơi tính khác đi là báo cáo gửi
 * cho lãnh đạo sẽ lệch với giao diện, và không ai biết bản nào đúng.
 *
 * Mỗi hàm trả về `{ headers, rows }` — không tự sinh CSV. Nhờ vậy sau này thêm
 * định dạng khác (XLSX, JSON) không phải viết lại phần truy vấn.
 */

import { prisma } from '@/lib/prisma';
import {
  computeCash,
  computePerformanceSeries,
  computePortfolioSummary,
  type PeriodCode,
} from '@/domain/portfolio-engine';
import {
  COUNTED_TRADE_STATUS,
  ALERT_STATUS,
  CAPITAL_FLOW_SIGN,
  type CapitalFlowType,
} from '@/lib/enums';
import { microToVnd, netAmount } from '@/lib/money';
import { csvDate, csvDateTime, csvPercent, type CsvCell } from '@/reports/csv';

export interface ReportData {
  headers: readonly string[];
  rows: CsvCell[][];
}

export interface ReportParams {
  portfolioId: string;
  from?: Date;
  to?: Date;
  period: PeriodCode;
  auditAction?: string;
  auditEntityType?: string;

  /**
   * PHẠM VI NHÓM — bắt buộc phải đi qua `applyScope` trước khi tới đây.
   *
   * BA TRẠNG THÁI, giống `EngineFilter`:
   *
   *   `undefined`  không lọc — chỉ dành cho người có `portfolio.view_all`
   *   `"<id>"`     chỉ dữ liệu của nhóm đó
   *   `null`       chỉ dữ liệu KHÔNG thuộc nhóm nào
   *
   * VÌ SAO TRƯỜNG NÀY PHẢI CÓ. Trước đây `ReportParams` không có nó, nên mọi báo cáo
   * đều dựng trên TOÀN danh mục bất kể ai xuất. Trưởng nhóm bị `applyScope` ép về nhóm
   * mình ở mọi trang, nhưng bấm Tải về thì nhận vị thế, giao dịch và dòng vốn của cả
   * bốn nhóm — cùng loại lỗ hổng đã có ở `/approvals`, khác ở chỗ đường vòng này XUẤT
   * RA TỆP, nên dữ liệu rời khỏi hệ thống.
   */
  teamId?: string | null;
}

// ---------------------------------------------------------------------------
// Vị thế
// ---------------------------------------------------------------------------

async function buildPositions(p: ReportParams): Promise<ReportData> {
  const summary = await computePortfolioSummary({
    portfolioId: p.portfolioId,
    ...(p.teamId !== undefined ? { teamId: p.teamId } : {}),
  });

  return {
    headers: [
      'symbol',
      'company',
      'sector',
      'quantity',
      'avg_cost_vnd',
      'price_vnd',
      'cost_vnd',
      'market_value_vnd',
      'unrealized_pnl_vnd',
      'realized_pnl_vnd',
      'return_pct',
      'weight_pct',
      'price_trading_date',
      'is_stale',
    ],
    rows: summary.positions
      .filter((pos) => pos.quantity > 0)
      .map((pos) => [
        pos.symbol,
        pos.companyName,
        pos.sectorNameVi,
        pos.quantity,
        // Giá vốn lưu ở micro-đồng để không mất chính xác khi chia; xuất ra thì
        // làm tròn về đồng, vì đồng là đơn vị nhỏ nhất tồn tại thật.
        microToVnd(pos.avgCostMicro),
        pos.currentPrice,
        pos.totalCost,
        pos.marketValue,
        pos.unrealizedPnl,
        pos.realizedPnl,
        csvPercent(pos.returnBps),
        csvPercent(pos.weightBps),
        csvDate(pos.priceTradingDate),
        // Ghi rõ mã nào đang dùng giá cũ hoặc thiếu giá: người đọc báo cáo phải
        // biết dòng nào không đáng tin, chứ không chỉ thấy một con số gọn gàng.
        pos.missingPrice ? 'MISSING_PRICE' : pos.isStale ? 'STALE' : 'FRESH',
      ]),
  };
}

// ---------------------------------------------------------------------------
// Giao dịch
// ---------------------------------------------------------------------------

/**
 * Điều kiện lọc chung cho `trades`.
 *
 * `teamId !== undefined` mới thêm điều kiện — `undefined` nghĩa là không lọc, còn
 * `null` là một giá trị lọc THẬT (chỉ lệnh chưa gắn nhóm). Viết `p.teamId ? … : …` sẽ
 * gộp hai trạng thái đó làm một và người chỉ được xem phần chưa gắn nhóm lại thấy tất.
 */
function tradeWhere(p: ReportParams) {
  return {
    portfolioId: p.portfolioId,
    ...(p.teamId !== undefined ? { teamId: p.teamId } : {}),
    ...(p.from || p.to
      ? {
          executedAt: {
            ...(p.from ? { gte: p.from } : {}),
            ...(p.to ? { lte: p.to } : {}),
          },
        }
      : {}),
  };
}

async function buildTransactions(p: ReportParams): Promise<ReportData> {
  const trades = await prisma.trade.findMany({
    where: tradeWhere(p),
    orderBy: [{ executedAt: 'desc' }, { code: 'desc' }],
    include: {
      stock: { select: { symbol: true } },
      executor: { select: { fullName: true } },
      team: { select: { nameVi: true, name: true } },
      approvedBy: { select: { fullName: true } },
      strategies: {
        orderBy: { allocationBps: 'desc' },
        include: { strategy: { select: { code: true } } },
      },
    },
  });

  return {
    headers: [
      'code',
      'executed_at',
      'type',
      'symbol',
      'quantity',
      'price_vnd',
      'gross_vnd',
      'fees_vnd',
      'tax_vnd',
      'net_vnd',
      'status',
      'executor',
      'team',
      'approved_by',
      'strategies',
    ],
    rows: trades.map((t) => {
      const gross = BigInt(t.quantity) * t.price;
      return [
        t.code,
        csvDateTime(t.executedAt),
        t.transactionType,
        t.stock.symbol,
        t.quantity,
        t.price,
        gross,
        t.fees,
        t.tax,
        netAmount(t.transactionType === 'BUY' ? 'BUY' : 'SELL', t.quantity, t.price, t.fees, t.tax),
        t.status,
        t.executor.fullName,
        t.team?.nameVi ?? t.team?.name ?? '',
        t.approvedBy?.fullName ?? '',
        // Gộp phân bổ vào một ô để sổ giao dịch giữ đúng "một dòng một lệnh".
        // Cần từng dòng riêng thì dùng báo cáo `trade-strategies`.
        t.strategies.map((s) => `${s.strategy.code} ${(s.allocationBps / 100).toFixed(2)}%`).join(' | '),
      ];
    }),
  };
}

async function buildTradeStrategies(p: ReportParams): Promise<ReportData> {
  const rows = await prisma.tradeStrategy.findMany({
    where: { trade: tradeWhere(p) },
    orderBy: [{ trade: { executedAt: 'desc' } }, { allocationBps: 'desc' }],
    include: {
      strategy: { select: { code: true, nameVi: true } },
      trade: {
        select: {
          code: true,
          executedAt: true,
          transactionType: true,
          quantity: true,
          price: true,
          fees: true,
          tax: true,
          stock: { select: { symbol: true } },
        },
      },
    },
  });

  return {
    headers: [
      'trade_code',
      'executed_at',
      'symbol',
      'type',
      'strategy_code',
      'strategy',
      'allocation_pct',
      'allocation_amount_vnd',
      'trade_net_vnd',
    ],
    rows: rows.map((r) => [
      r.trade.code,
      csvDateTime(r.trade.executedAt),
      r.trade.stock.symbol,
      r.trade.transactionType,
      r.strategy.code,
      r.strategy.nameVi,
      csvPercent(r.allocationBps),
      /*
       * `allocationAmount` là số ĐÃ ĐÓNG BĂNG lúc ghi lệnh, không tính lại ở đây.
       * Nó được chia bằng thuật toán phần dư lớn nhất nên tổng các phần đúng
       * bằng tiền ròng của lệnh, tới từng đồng. Tính lại bằng bps × tiền sẽ làm
       * tổng lệch đúng phần đồng lẻ mà thuật toán kia đã xử lý.
       */
      r.allocationAmount,
      netAmount(
        r.trade.transactionType === 'BUY' ? 'BUY' : 'SELL',
        r.trade.quantity,
        r.trade.price,
        r.trade.fees,
        r.trade.tax,
      ),
    ]),
  };
}

// ---------------------------------------------------------------------------
// Phân bổ
// ---------------------------------------------------------------------------

async function buildSectorAllocation(p: ReportParams): Promise<ReportData> {
  const summary = await computePortfolioSummary({
    portfolioId: p.portfolioId,
    ...(p.teamId !== undefined ? { teamId: p.teamId } : {}),
  });

  return {
    headers: [
      'sector_code',
      'sector',
      'symbols',
      'symbol_count',
      'cost_vnd',
      'market_value_vnd',
      'unrealized_pnl_vnd',
      'weight_pct',
    ],
    rows: summary.sectorExposure.map((s) => [
      s.code,
      s.nameVi,
      s.symbols.join(' '),
      s.symbols.length,
      s.costValue,
      s.marketValue,
      s.unrealizedPnl,
      csvPercent(s.weightBps),
    ]),
  };
}

async function buildStrategyAllocation(p: ReportParams): Promise<ReportData> {
  const summary = await computePortfolioSummary({
    portfolioId: p.portfolioId,
    ...(p.teamId !== undefined ? { teamId: p.teamId } : {}),
  });

  return {
    headers: [
      'strategy_code',
      'strategy',
      'net_capital_vnd',
      'weight_pct',
      'trade_count',
      'max_allocation_pct',
      'over_limit',
    ],
    rows: summary.strategyAllocation.map((s) => [
      s.code,
      s.nameVi,
      s.netCapital,
      csvPercent(s.weightBps),
      s.tradeCount,
      s.maxAllocationBps === null ? '' : csvPercent(s.maxAllocationBps),
      s.overLimit ? 'YES' : 'NO',
    ]),
  };
}

// ---------------------------------------------------------------------------
// Dòng vốn
// ---------------------------------------------------------------------------

async function buildCapitalFlows(p: ReportParams): Promise<ReportData> {
  const flows = await prisma.capitalFlow.findMany({
    where: {
      portfolioId: p.portfolioId,
      ...(p.teamId !== undefined ? { teamId: p.teamId } : {}),
      ...(p.from || p.to
        ? {
            occurredAt: {
              ...(p.from ? { gte: p.from } : {}),
              ...(p.to ? { lte: p.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { occurredAt: 'desc' },
    include: {
      createdBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
    },
  });

  return {
    headers: [
      'occurred_at',
      'flow_type',
      'amount_vnd',
      'status',
      'reference',
      'created_by',
      'approved_by',
      'note',
    ],
    rows: flows.map((f) => [
      csvDateTime(f.occurredAt),
      f.flowType,
      /*
       * `amount` trong database LUÔN DƯƠNG; chiều tác động nằm ở `flowType`. Xuất
       * ra thì áp dấu, vì một cột "amount" mà rút vốn cũng dương sẽ cho tổng sai
       * ngay khi ai đó kéo SUM trong Excel.
       */
      f.amount * BigInt(CAPITAL_FLOW_SIGN[f.flowType as CapitalFlowType] ?? 1),
      f.status,
      f.reference ?? '',
      f.createdBy.fullName,
      f.approvedBy?.fullName ?? '',
      f.note ?? '',
    ]),
  };
}

// ---------------------------------------------------------------------------
// Hiệu suất
// ---------------------------------------------------------------------------

async function buildPerformanceSeries(p: ReportParams): Promise<ReportData> {
  const [series, cash] = await Promise.all([
    computePerformanceSeries(
      p.portfolioId,
      p.period,
      p.teamId !== undefined ? { teamId: p.teamId } : {},
    ),
    computeCash(p.portfolioId, p.teamId !== undefined ? { teamId: p.teamId } : {}),
  ]);

  return {
    headers: [
      'trading_date',
      'portfolio_value_vnd',
      'portfolio_index',
      'benchmark_index',
      'benchmark_code',
    ],
    rows: series.points.map((point) => [
      csvDate(point.date),
      /*
       * Giá trị vị thế tại phiên đó CỘNG số dư tiền hiện tại — giống định nghĩa
       * Portfolio Value ở §12. Số dư tiền là số hiện tại, không phải số của phiên
       * đó: engine chưa dựng lại số dư tiền theo từng ngày. Cột `portfolio_index`
       * mới là cột dùng để so sánh, và nó chỉ dựa trên giá trị vị thế nên không
       * bị ảnh hưởng bởi giới hạn này.
       */
      point.marketValue + cash.cashBalance,
      point.portfolioIndex.toFixed(2),
      point.benchmarkIndex === null ? '' : point.benchmarkIndex.toFixed(2),
      series.benchmarkCode,
    ]),
  };
}

// ---------------------------------------------------------------------------
// Cảnh báo rủi ro
// ---------------------------------------------------------------------------

async function buildRiskAlerts(p: ReportParams): Promise<ReportData> {
  const alerts = await prisma.riskAlert.findMany({
    where:
      p.from || p.to
        ? {
            triggeredAt: {
              ...(p.from ? { gte: p.from } : {}),
              ...(p.to ? { lte: p.to } : {}),
            },
          }
        : {},
    orderBy: { triggeredAt: 'desc' },
    include: {
      rule: { select: { code: true, scope: true, metric: true } },
      portfolio: { select: { code: true } },
      acknowledgedBy: { select: { fullName: true } },
    },
  });

  return {
    headers: [
      'triggered_at',
      'severity',
      'status',
      'rule_code',
      'scope',
      'metric',
      'target',
      'portfolio',
      'measured',
      'threshold',
      'title',
      'message',
      'acknowledged_by',
      'acknowledged_at',
      'resolved_at',
    ],
    rows: alerts.map((a) => [
      csvDateTime(a.triggeredAt),
      a.severity,
      a.status,
      a.rule.code,
      a.rule.scope,
      /*
       * Xuất `measured`/`threshold` ở dạng SỐ THÔ kèm cột `metric`, không đổi
       * thành "12,40%". Đơn vị suy được từ `metric` (bps / phút / số đếm), còn
       * một chuỗi có ký hiệu phần trăm thì không tính toán được trong Excel —
       * mà báo cáo tồn tại chính để người ta lọc và cộng.
       */
      a.rule.metric,
      a.targetRef ?? '',
      a.portfolio?.code ?? '',
      a.measuredValue,
      a.thresholdValue,
      a.title,
      a.message,
      a.acknowledgedBy?.fullName ?? '',
      csvDateTime(a.acknowledgedAt),
      csvDateTime(a.resolvedAt),
    ]),
  };
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

async function buildAuditLog(p: ReportParams): Promise<ReportData> {
  const logs = await prisma.auditLog.findMany({
    where: {
      ...(p.auditAction ? { action: p.auditAction } : {}),
      ...(p.auditEntityType ? { entityType: p.auditEntityType } : {}),
      ...(p.from || p.to
        ? {
            occurredAt: {
              ...(p.from ? { gte: p.from } : {}),
              ...(p.to ? { lte: p.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { occurredAt: 'desc' },
    /*
     * Có chặn trên. Audit Log là bảng chỉ ghi thêm nên nó lớn không giới hạn, và
     * một lần xuất không giới hạn sẽ nạp toàn bộ vào RAM rồi dựng chuỗi từ đó.
     * Cần xa hơn thì lọc theo khoảng ngày — đó cũng là cách đọc đúng của một
     * nhật ký.
     */
    take: 20_000,
  });

  return {
    headers: [
      'occurred_at',
      'action',
      'entity_type',
      'entity_id',
      'entity_label',
      'actor_name',
      'actor_email',
      'actor_role',
      'changed_fields',
      'before_json',
      'after_json',
      'note',
      'ip_address',
    ],
    rows: logs.map((log) => [
      csvDateTime(log.occurredAt),
      log.action,
      log.entityType,
      log.entityId ?? '',
      log.entityLabel ?? '',
      log.actorName ?? '',
      log.actorEmail ?? '',
      log.actorRole ?? '',
      log.changedFieldsJson ?? '',
      log.beforeJson ?? '',
      log.afterJson ?? '',
      log.note ?? '',
      log.ipAddress ?? '',
    ]),
  };
}

// ---------------------------------------------------------------------------
// Điều phối
// ---------------------------------------------------------------------------

const BUILDERS: Record<string, (p: ReportParams) => Promise<ReportData>> = {
  positions: buildPositions,
  transactions: buildTransactions,
  'trade-strategies': buildTradeStrategies,
  'sector-allocation': buildSectorAllocation,
  'strategy-allocation': buildStrategyAllocation,
  'capital-flows': buildCapitalFlows,
  'performance-series': buildPerformanceSeries,
  'risk-alerts': buildRiskAlerts,
  'audit-log': buildAuditLog,
};

export async function buildReport(code: string, params: ReportParams): Promise<ReportData> {
  const builder = BUILDERS[code];
  if (!builder) throw new Error(`Báo cáo không tồn tại: ${code}`);
  return builder(params);
}

/** Số dòng ước tính, để trang Reports nói trước "sẽ tải về bao nhiêu dòng". */
export async function estimateRowCount(code: string, portfolioId: string): Promise<number | null> {
  switch (code) {
    case 'transactions':
      return prisma.trade.count({ where: { portfolioId } });
    case 'trade-strategies':
      return prisma.tradeStrategy.count({ where: { trade: { portfolioId } } });
    case 'capital-flows':
      return prisma.capitalFlow.count({ where: { portfolioId } });
    case 'risk-alerts':
      return prisma.riskAlert.count();
    case 'audit-log':
      return prisma.auditLog.count();
    case 'positions':
      /*
       * Đếm số mã CÓ giao dịch, không phải số vị thế đang giữ. Biết chắc số vị thế
       * mở đòi hỏi chạy cả Portfolio Engine, và đây chỉ là con số gợi ý hiện cạnh
       * nút tải — không đáng để tính lại toàn bộ danh mục cho mỗi lần mở trang.
       */
      return prisma.trade
        .findMany({
          where: { portfolioId, status: COUNTED_TRADE_STATUS },
          distinct: ['stockId'],
          select: { stockId: true },
        })
        .then((rows) => rows.length);
    default:
      return null;
  }
}

/** Số cảnh báo chưa đóng — hiện cạnh báo cáo rủi ro. */
export async function openAlertCount(): Promise<number> {
  return prisma.riskAlert.count({
    where: { status: { in: [ALERT_STATUS.OPEN, ALERT_STATUS.ACKNOWLEDGED] } },
  });
}
