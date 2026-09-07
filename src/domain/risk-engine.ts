/**
 * RISK ENGINE (§19) — Phase 09.
 *
 * Tầng ĐO LƯỜNG, thuần tính toán: nhận vào ngưỡng đã cấu hình cùng kết quả của
 * Portfolio Engine, trả ra danh sách phát hiện. Không đọc, không ghi database.
 * Việc lưu `risk_alerts` nằm ở src/risk/scan.ts.
 *
 * VÌ SAO TÁCH LÀM HAI: nhờ vậy quy tắc rủi ro kiểm chứng được mà không cần
 * database — đưa vào một danh mục giả rồi so kết quả. Nếu trộn cả đo lẫn ghi vào
 * một hàm thì muốn biết "MBB 12% có bắn cảnh báo không" phải dựng cả một database.
 *
 * ĐƠN VỊ. Cột `threshold` và `measuredValue` đều là `BigInt` nhưng mang BA loại
 * đơn vị khác nhau tuỳ `metric`: basis point (10000 = 100%), phút, và số đếm.
 * `RISK_METRIC_UNIT` trong lib/enums.ts là nơi duy nhất giữ bản đồ đó — mọi chỗ
 * hiển thị phải tra qua nó thay vì đoán.
 */

import {
  COMPARATOR_SYMBOL,
  RISK_METRIC,
  RISK_METRIC_UNIT,
  RISK_SCOPE,
  compareThreshold,
  type Comparator,
  type RiskMetric,
  type RiskScope,
  type Severity,
} from '@/lib/enums';
import { ratioToBps } from '@/lib/money';
import type { PortfolioSummary } from '@/domain/portfolio-engine';

// ---------------------------------------------------------------------------
// Kiểu dữ liệu
// ---------------------------------------------------------------------------

/** Ngưỡng rủi ro ở dạng engine cần — khớp các cột của bảng `risk_rules`. */
export interface RuleInput {
  id: string;
  code: string;
  nameVi: string;
  scope: string;
  metric: string;
  comparator: string;
  threshold: bigint;
  severity: string;
  /** Giới hạn rule vào một đối tượng cụ thể; null = áp cho mọi đối tượng. */
  targetRef: string | null;
  /** Giới hạn rule vào một danh mục; null = áp cho mọi danh mục. */
  portfolioId: string | null;
}

export interface RiskFinding {
  ruleId: string;
  ruleCode: string;
  severity: Severity;
  /** null cho cảnh báo cấp hệ thống (dữ liệu thị trường, hàng chờ duyệt chung). */
  portfolioId: string | null;
  /** Đối tượng cụ thể: symbol, mã ngành, mã chiến lược. null cho cấp danh mục. */
  targetRef: string | null;

  title: string;
  message: string;

  /**
   * Giá trị đo được. `null` nghĩa là KHÔNG ĐO ĐƯỢC nhưng điều kiện vẫn đúng —
   * trường hợp duy nhất là "chưa có lần đồng bộ giá nào": độ trễ không phải một
   * con số, nhưng nói "dữ liệu không trễ" thì sai hoàn toàn.
   */
  measured: bigint | null;
  threshold: bigint;
  context: Record<string, unknown>;
}

/** Bối cảnh cấp hệ thống, không thuộc riêng danh mục nào. */
export interface GlobalContext {
  /** Số phút kể từ lần đồng bộ giá thành công gần nhất; null = chưa từng có. */
  marketDataAgeMinutes: number | null;
  marketDataLastSuccessAt: Date | null;
  /** Số lệnh đang chờ duyệt trên toàn hệ thống. */
  pendingApprovalCount: number;
}

/** Bối cảnh của một danh mục: kết quả Portfolio Engine + số lệnh chờ của riêng nó. */
export interface PortfolioContext {
  summary: PortfolioSummary;
  pendingApprovalCount: number;
}

// ---------------------------------------------------------------------------
// Trình bày số đo
// ---------------------------------------------------------------------------

/**
 * Một số đo thành chữ, theo đúng đơn vị của metric.
 *
 * Có hàm này vì lỗi dễ mắc nhất khi đọc bảng rủi ro là nhầm đơn vị: ngưỡng 1000
 * của `WEIGHT_BPS` là 10%, còn ngưỡng 15 của `DATA_DELAY_MINUTES` là 15 phút.
 * In thô con số ra là mời người đọc hiểu sai.
 */
export function formatMeasure(metric: RiskMetric, value: bigint | null): string {
  if (value === null) return 'không đo được';

  switch (RISK_METRIC_UNIT[metric]) {
    case 'BPS': {
      const percent = Number(value) / 100;
      // Dấu phẩy thập phân theo chuẩn Việt Nam.
      return `${percent.toFixed(2).replace('.', ',')}%`;
    }
    case 'MINUTES':
      return `${value.toString()} phút`;
    case 'COUNT':
      return value.toString();
  }
}

/** Mô tả điều kiện của rule, ví dụ `> 10,00%`. */
export function describeCondition(
  metric: RiskMetric,
  comparator: Comparator,
  threshold: bigint,
): string {
  return `${COMPARATOR_SYMBOL[comparator]} ${formatMeasure(metric, threshold)}`;
}

// ---------------------------------------------------------------------------
// Đánh giá
// ---------------------------------------------------------------------------

/** Rule có áp cho đối tượng này không (khi rule bị ghim vào một đối tượng). */
function targetMatches(rule: RuleInput, target: string): boolean {
  return rule.targetRef === null || rule.targetRef.toUpperCase() === target.toUpperCase();
}

/**
 * Ngưỡng cấp hệ thống: dữ liệu thị trường và hàng chờ duyệt chung.
 *
 * Tách riêng khỏi vòng lặp danh mục vì độ trễ dữ liệu giá là MỘT sự việc duy
 * nhất. Nếu đánh giá nó bên trong vòng lặp thì năm danh mục sẽ sinh năm cảnh báo
 * cho cùng một nguồn giá bị treo, và người trực phải xác nhận năm lần.
 */
export function evaluateGlobalRules(
  rules: readonly RuleInput[],
  ctx: GlobalContext,
): RiskFinding[] {
  const findings: RiskFinding[] = [];

  for (const rule of rules) {
    const scope = rule.scope as RiskScope;
    const metric = rule.metric as RiskMetric;
    const comparator = rule.comparator as Comparator;
    const severity = rule.severity as Severity;

    // Ngưỡng ghim vào một danh mục cụ thể được xử lý ở vòng lặp danh mục.
    if (rule.portfolioId !== null) continue;

    if (scope === RISK_SCOPE.MARKET_DATA && metric === RISK_METRIC.DATA_DELAY_MINUTES) {
      if (ctx.marketDataLastSuccessAt === null) {
        /*
         * CHƯA TỪNG ĐỒNG BỘ. Đây là trường hợp phải bắn nhưng không có số để đo:
         * độ trễ là vô hạn chứ không phải một số phút. Ghi `measured = null` là
         * cách trung thực — không bịa ra một con số để so sánh cho có.
         *
         * Không bỏ qua trường hợp này: service giá chết ngay từ đầu là đúng cái
         * mà ngưỡng này tồn tại để phát hiện.
         */
        findings.push({
          ruleId: rule.id,
          ruleCode: rule.code,
          severity,
          portfolioId: null,
          targetRef: null,
          title: 'Chưa có dữ liệu thị trường',
          message:
            'Chưa có lần đồng bộ giá thành công nào. Mọi giá trị thị trường trên hệ ' +
            'thống đang dựa vào giá nhập tay hoặc không tính được.',
          measured: null,
          threshold: rule.threshold,
          context: { scope, metric, neverSynced: true },
        });
        continue;
      }

      const measured = BigInt(ctx.marketDataAgeMinutes ?? 0);
      if (compareThreshold(measured, comparator, rule.threshold)) {
        findings.push({
          ruleId: rule.id,
          ruleCode: rule.code,
          severity,
          portfolioId: null,
          targetRef: null,
          title: 'Dữ liệu thị trường trễ',
          message:
            `Giá gần nhất cập nhật cách đây ${measured} phút, vượt ngưỡng ` +
            `${rule.threshold} phút. Giá trị danh mục đang dựa trên dữ liệu cũ.`,
          measured,
          threshold: rule.threshold,
          context: {
            scope,
            metric,
            lastSuccessAt: ctx.marketDataLastSuccessAt.toISOString(),
          },
        });
      }
      continue;
    }

    if (scope === RISK_SCOPE.APPROVAL && metric === RISK_METRIC.PENDING_COUNT) {
      const measured = BigInt(ctx.pendingApprovalCount);
      if (compareThreshold(measured, comparator, rule.threshold)) {
        findings.push({
          ruleId: rule.id,
          ruleCode: rule.code,
          severity,
          portfolioId: null,
          targetRef: null,
          title: 'Hàng chờ duyệt tồn đọng',
          message:
            `Có ${measured} lệnh đang chờ duyệt, vượt ngưỡng ${rule.threshold}. ` +
            'Lệnh chưa duyệt không được tính vào vị thế nên số liệu danh mục đang thiếu.',
          measured,
          threshold: rule.threshold,
          context: { scope, metric },
        });
      }
    }
  }

  return findings;
}

/**
 * Ngưỡng cấp danh mục: tập trung mã, tập trung ngành, tập trung chiến lược,
 * hiệu suất, tiền khả dụng, và số mã thiếu giá.
 */
export function evaluatePortfolioRules(
  rules: readonly RuleInput[],
  ctx: PortfolioContext,
): RiskFinding[] {
  const { summary } = ctx;
  const findings: RiskFinding[] = [];

  // Chỉ vị thế đang giữ mới có tỷ trọng — mã đã bán hết thì tỷ trọng là 0 và
  // không có nghĩa gì khi so với ngưỡng tập trung.
  const open = summary.positions.filter((p) => p.quantity > 0);

  for (const rule of rules) {
    // Rule ghim vào danh mục khác thì bỏ qua.
    if (rule.portfolioId !== null && rule.portfolioId !== summary.portfolioId) continue;

    const scope = rule.scope as RiskScope;
    const metric = rule.metric as RiskMetric;
    const comparator = rule.comparator as Comparator;
    const severity = rule.severity as Severity;

    const base = {
      ruleId: rule.id,
      ruleCode: rule.code,
      severity,
      portfolioId: summary.portfolioId,
      threshold: rule.threshold,
    };

    // --- Tập trung một mã (§19: "MBB concentration > 10%") -----------------
    if (scope === RISK_SCOPE.STOCK && metric === RISK_METRIC.WEIGHT_BPS) {
      for (const position of open) {
        if (!targetMatches(rule, position.symbol)) continue;

        const measured = BigInt(position.weightBps);
        if (!compareThreshold(measured, comparator, rule.threshold)) continue;

        findings.push({
          ...base,
          targetRef: position.symbol,
          title: `Tập trung một mã: ${position.symbol}`,
          message:
            `${position.symbol} chiếm ${formatMeasure(metric, measured)} giá trị danh mục ` +
            `${summary.portfolioCode}, ${describeCondition(metric, comparator, rule.threshold)}.`,
          measured,
          context: {
            scope,
            metric,
            symbol: position.symbol,
            companyName: position.companyName,
            sector: position.sectorNameVi,
            marketValue: position.marketValue.toString(),
            portfolioCode: summary.portfolioCode,
          },
        });
      }
      continue;
    }

    // --- Tập trung ngành (§19: "Banking exposure > 20%") -------------------
    if (scope === RISK_SCOPE.SECTOR && metric === RISK_METRIC.WEIGHT_BPS) {
      for (const sector of summary.sectorExposure) {
        if (!targetMatches(rule, sector.code)) continue;

        const measured = BigInt(sector.weightBps);
        if (!compareThreshold(measured, comparator, rule.threshold)) continue;

        findings.push({
          ...base,
          targetRef: sector.code,
          title: `Tập trung ngành: ${sector.nameVi}`,
          message:
            `Ngành ${sector.nameVi} chiếm ${formatMeasure(metric, measured)} giá trị danh mục ` +
            `${summary.portfolioCode}, ${describeCondition(metric, comparator, rule.threshold)}. ` +
            `Gồm ${sector.symbols.length} mã: ${sector.symbols.slice(0, 6).join(', ')}` +
            `${sector.symbols.length > 6 ? '…' : ''}.`,
          measured,
          context: {
            scope,
            metric,
            sectorCode: sector.code,
            sectorName: sector.nameVi,
            symbols: sector.symbols,
            marketValue: sector.marketValue.toString(),
            portfolioCode: summary.portfolioCode,
          },
        });
      }
      continue;
    }

    // --- Tập trung chiến lược ---------------------------------------------
    if (scope === RISK_SCOPE.STRATEGY && metric === RISK_METRIC.WEIGHT_BPS) {
      for (const strategy of summary.strategyAllocation) {
        if (!targetMatches(rule, strategy.code)) continue;

        const measured = BigInt(strategy.weightBps);
        if (!compareThreshold(measured, comparator, rule.threshold)) continue;

        findings.push({
          ...base,
          targetRef: strategy.code,
          title: `Tập trung chiến lược: ${strategy.nameVi}`,
          message:
            `Chiến lược ${strategy.nameVi} chiếm ${formatMeasure(metric, measured)} tổng vốn ` +
            `đang triển khai, ${describeCondition(metric, comparator, rule.threshold)}.`,
          measured,
          context: {
            scope,
            metric,
            strategyCode: strategy.code,
            strategyName: strategy.nameVi,
            netCapital: strategy.netCapital.toString(),
            portfolioCode: summary.portfolioCode,
          },
        });
      }
      continue;
    }

    if (scope !== RISK_SCOPE.PORTFOLIO && scope !== RISK_SCOPE.APPROVAL) continue;

    // --- Hiệu suất danh mục ------------------------------------------------
    if (metric === RISK_METRIC.PNL_BPS) {
      /*
       * KHÔNG đánh giá khi chưa bỏ vốn. `totalPnlBps` chia cho giá vốn, nên danh
       * mục chưa có vị thế nào sẽ cho 0 — và 0 không "giảm quá 10%", nhưng nó
       * cũng không phải một phép đo. Bỏ qua để cảnh báo không bao giờ dựa trên
       * một con số vô nghĩa.
       */
      if (summary.investedCost === 0n) continue;

      const measured = BigInt(summary.totalPnlBps);
      if (!compareThreshold(measured, comparator, rule.threshold)) continue;

      findings.push({
        ...base,
        targetRef: null,
        title: 'Hiệu suất danh mục dưới ngưỡng',
        message:
          `Danh mục ${summary.portfolioCode} đang ở mức ${formatMeasure(metric, measured)} ` +
          `trên giá vốn, ${describeCondition(metric, comparator, rule.threshold)}.`,
        measured,
        context: {
          scope,
          metric,
          totalPnl: summary.totalPnl.toString(),
          investedCost: summary.investedCost.toString(),
          portfolioCode: summary.portfolioCode,
        },
      });
      continue;
    }

    // --- Tiền khả dụng -----------------------------------------------------
    if (metric === RISK_METRIC.CASH_BPS) {
      // Danh mục rỗng thì tỷ lệ tiền không xác định — chia cho 0.
      if (summary.portfolioValue <= 0n) continue;

      const measured = BigInt(
        ratioToBps(summary.cash.availableCash, summary.portfolioValue),
      );
      if (!compareThreshold(measured, comparator, rule.threshold)) continue;

      findings.push({
        ...base,
        targetRef: null,
        title: 'Tiền khả dụng thấp',
        message:
          `Tiền khả dụng của ${summary.portfolioCode} còn ${formatMeasure(metric, measured)} ` +
          `tổng giá trị danh mục, ${describeCondition(metric, comparator, rule.threshold)}. ` +
          'Không còn dư địa giải ngân hoặc chịu áp lực rút vốn.',
        measured,
        context: {
          scope,
          metric,
          availableCash: summary.cash.availableCash.toString(),
          portfolioValue: summary.portfolioValue.toString(),
          portfolioCode: summary.portfolioCode,
        },
      });
      continue;
    }

    // --- Mã đang giữ nhưng thiếu giá ---------------------------------------
    if (metric === RISK_METRIC.MISSING_PRICE_COUNT) {
      const measured = BigInt(summary.marketData.missingPriceCount);
      if (!compareThreshold(measured, comparator, rule.threshold)) continue;

      const missing = open.filter((p) => p.missingPrice).map((p) => p.symbol);

      findings.push({
        ...base,
        targetRef: null,
        title: 'Có mã đang giữ chưa có giá',
        message:
          `${measured} mã trong ${summary.portfolioCode} chưa có giá trong bảng giá` +
          `${missing.length > 0 ? ` (${missing.join(', ')})` : ''}. ` +
          'Giá trị danh mục đang thiếu đúng phần này — con số hiển thị thấp hơn thực tế.',
        measured,
        context: { scope, metric, symbols: missing, portfolioCode: summary.portfolioCode },
      });
      continue;
    }

    // --- Hàng chờ duyệt của riêng danh mục này -----------------------------
    if (scope === RISK_SCOPE.APPROVAL && metric === RISK_METRIC.PENDING_COUNT) {
      const measured = BigInt(ctx.pendingApprovalCount);
      if (!compareThreshold(measured, comparator, rule.threshold)) continue;

      findings.push({
        ...base,
        targetRef: null,
        title: `Hàng chờ duyệt tồn đọng: ${summary.portfolioCode}`,
        message:
          `${summary.portfolioCode} có ${measured} lệnh chờ duyệt, ` +
          `${describeCondition(metric, comparator, rule.threshold)}.`,
        measured,
        context: { scope, metric, portfolioCode: summary.portfolioCode },
      });
    }
  }

  return findings;
}

/**
 * Khoá chống trùng của một phát hiện.
 *
 * PHẢI gồm cả ba thành phần. Chỉ dùng (ruleId, targetRef) thì hai danh mục cùng
 * vi phạm `PORTFOLIO_DRAWDOWN_10` sẽ đè lên nhau — cảnh báo của danh mục thứ hai
 * bị coi là bản trùng của danh mục thứ nhất và không bao giờ xuất hiện.
 */
export function findingKey(finding: {
  ruleId: string;
  portfolioId: string | null;
  targetRef: string | null;
}): string {
  return `${finding.ruleId}|${finding.portfolioId ?? ''}|${finding.targetRef ?? ''}`;
}

/** Đường dẫn drill-down cho một cảnh báo, suy từ scope. */
export function alertHref(scope: string): string {
  switch (scope) {
    case RISK_SCOPE.STOCK:
    case RISK_SCOPE.SECTOR:
      return '/portfolio/allocation';
    case RISK_SCOPE.STRATEGY:
      return '/strategies';
    case RISK_SCOPE.PORTFOLIO:
      return '/portfolio';
    case RISK_SCOPE.MARKET_DATA:
      return '/market/market-data';
    case RISK_SCOPE.APPROVAL:
      return '/approvals';
    default:
      return '/risk';
  }
}
