import 'server-only';

/**
 * LƯU KẾT QUẢ QUÉT RỦI RO (§19) — Phase 09.
 *
 * Tầng ghi: gọi Risk Engine rồi đối chiếu kết quả với `risk_alerts` đang có.
 * Toàn bộ phép đo nằm ở src/domain/risk-engine.ts và không chạm database.
 *
 * BA VIỆC MỖI LƯỢT QUÉT
 *   1. MỞ  — phát hiện mới chưa có cảnh báo tương ứng.
 *   2. CẬP NHẬT — cảnh báo đã có, điều kiện vẫn đúng: ghi lại số đo hiện tại,
 *      GIỮ NGUYÊN `triggeredAt` và `status`.
 *   3. ĐÓNG — cảnh báo đã có nhưng điều kiện không còn đúng: chuyển RESOLVED.
 *
 * Việc (3) là việc quan trọng nhất và cũng dễ bị bỏ nhất. Không có nó thì danh
 * sách cảnh báo chỉ dài ra mãi, mọi thứ trong đó đều đã cũ, và người dùng học
 * được rằng cảnh báo là thứ nên bỏ qua — lúc đó hệ thống cảnh báo tệ hơn là
 * không có.
 *
 * VÌ SAO KHÔNG GHI AUDIT LOG Ở ĐÂY: `risk_scan_runs` chính là nhật ký của việc
 * quét, và bản thân mỗi cảnh báo đã là một bản ghi có thời điểm. Đổ thêm vào
 * `audit_logs` mỗi 5 phút sẽ nhấn chìm những thứ thật sự cần soi — hành động của
 * con người. Audit Log chỉ ghi khi CON NGƯỜI tiếp nhận / đóng cảnh báo hoặc sửa
 * ngưỡng; xem src/risk/actions.ts.
 */

import { prisma } from '@/lib/prisma';
import {
  ALERT_STATUS,
  PORTFOLIO_STATUS,
  SCAN_STATUS,
  SEVERITY_RANK,
  TRADE_STATUS,
  type ScanTrigger,
  type Severity,
} from '@/lib/enums';
import {
  computePortfolioSummary,
  getMarketDataStatus,
} from '@/domain/portfolio-engine';
import {
  evaluateGlobalRules,
  evaluatePortfolioRules,
  findingKey,
  type RiskFinding,
  type RuleInput,
} from '@/domain/risk-engine';

export interface ScanResult {
  runId: string;
  rulesEvaluated: number;
  opened: number;
  updated: number;
  resolved: number;
  durationMs: number;
}

/**
 * Tuổi tối đa của lượt quét gần nhất trước khi quét lười kích hoạt (giây).
 *
 * Đặt trong `.env`, KHÔNG trong `system_settings`: đây là tham số triển khai
 * giống `MARKET_DATA_INTERVAL_SECONDS`, không phải quy tắc nghiệp vụ. Quy ước
 * "mỗi tham số chỉ có một nơi" xem chú thích trong src/data/master-data.ts.
 */
function maxScanAgeSeconds(): number {
  const raw = Number(process.env.RISK_SCAN_MAX_AGE_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : 300;
}

/** Một lượt quét coi là treo sau bao lâu — để tiến trình chết không chặn mãi. */
const STALE_RUN_MINUTES = 5;

// ---------------------------------------------------------------------------
// Quét
// ---------------------------------------------------------------------------

export async function runRiskScan(options: {
  trigger: ScanTrigger;
  actorId?: string | null;
}): Promise<ScanResult> {
  const startedAt = Date.now();

  const run = await prisma.riskScanRun.create({
    data: {
      trigger: options.trigger,
      status: SCAN_STATUS.RUNNING,
      triggeredById: options.actorId ?? null,
    },
    select: { id: true },
  });

  try {
    const rules = await prisma.riskRule.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        nameVi: true,
        scope: true,
        metric: true,
        comparator: true,
        threshold: true,
        severity: true,
        targetRef: true,
        portfolioId: true,
      },
    });

    const findings = await collectFindings(rules);
    const { opened, updated, resolved } = await reconcile(rules, findings);

    const durationMs = Date.now() - startedAt;
    await prisma.riskScanRun.update({
      where: { id: run.id },
      data: {
        status: SCAN_STATUS.SUCCESS,
        finishedAt: new Date(),
        durationMs,
        rulesEvaluated: rules.length,
        alertsOpened: opened,
        alertsUpdated: updated,
        alertsResolved: resolved,
      },
    });

    return { runId: run.id, rulesEvaluated: rules.length, opened, updated, resolved, durationMs };
  } catch (error) {
    /*
     * Lượt quét thất bại được ghi lại thay vì im lặng. Đây là lý do bảng
     * `risk_scan_runs` tồn tại: một danh sách cảnh báo trống có thể nghĩa là
     * "không có gì vượt ngưỡng" hoặc "engine đang lỗi", và hai điều đó phải phân
     * biệt được từ giao diện.
     */
    const message = error instanceof Error ? error.message : String(error);
    await prisma.riskScanRun.update({
      where: { id: run.id },
      data: {
        status: SCAN_STATUS.FAILED,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        errorMessage: message.slice(0, 1000),
      },
    });
    throw error;
  }
}

/** Gom phát hiện từ ngưỡng cấp hệ thống và từng danh mục đang hoạt động. */
async function collectFindings(rules: readonly RuleInput[]): Promise<RiskFinding[]> {
  const [marketData, pendingTotal, portfolios] = await Promise.all([
    getMarketDataStatus(),
    prisma.trade.count({ where: { status: TRADE_STATUS.PENDING_APPROVAL } }),
    prisma.portfolio.findMany({
      where: { status: PORTFOLIO_STATUS.ACTIVE },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const findings: RiskFinding[] = [
    ...evaluateGlobalRules(rules, {
      marketDataAgeMinutes: marketData.ageMinutes,
      marketDataLastSuccessAt: marketData.lastSuccessAt,
      pendingApprovalCount: pendingTotal,
    }),
  ];

  /*
   * Quét TỪNG danh mục, không chỉ danh mục mặc định.
   *
   * Đây là quét nền nên không có "người dùng hiện tại" và không áp
   * `applyScope()` — engine phải thấy toàn bộ, còn việc ai được XEM cảnh báo nào
   * là chuyện của trang hiển thị. Trộn hai tầng đó lại sẽ khiến rủi ro của một
   * nhóm không bao giờ được phát hiện chỉ vì người mở trang không thuộc nhóm đó.
   *
   * Tuần tự chứ không song song: mỗi lượt là hàng loạt truy vấn, chạy song song
   * nhiều danh mục sẽ làm nghẽn connection pool của SQLite.
   */
  for (const portfolio of portfolios) {
    const [summary, pending] = await Promise.all([
      computePortfolioSummary({ portfolioId: portfolio.id }),
      prisma.trade.count({
        where: { status: TRADE_STATUS.PENDING_APPROVAL, portfolioId: portfolio.id },
      }),
    ]);

    findings.push(
      ...evaluatePortfolioRules(rules, { summary, pendingApprovalCount: pending }),
    );
  }

  return findings;
}

/** Đối chiếu phát hiện với cảnh báo đang có: mở mới, cập nhật, hoặc đóng. */
async function reconcile(
  rules: readonly RuleInput[],
  findings: readonly RiskFinding[],
): Promise<{ opened: number; updated: number; resolved: number }> {
  const ruleIds = rules.map((r) => r.id);

  const live = await prisma.riskAlert.findMany({
    where: {
      status: { in: [ALERT_STATUS.OPEN, ALERT_STATUS.ACKNOWLEDGED] },
    },
    select: { id: true, ruleId: true, portfolioId: true, targetRef: true },
  });

  const liveByKey = new Map(live.map((a) => [findingKey(a), a]));
  const foundKeys = new Set(findings.map(findingKey));

  let opened = 0;
  let updated = 0;

  for (const finding of findings) {
    const existing = liveByKey.get(findingKey(finding));

    if (existing) {
      /*
       * GIỮ NGUYÊN `triggeredAt` và `status`.
       *
       * `triggeredAt` là "vi phạm này bắt đầu từ khi nào" — thông tin quản trị
       * quan trọng nhất của một cảnh báo đang mở. Ghi đè nó mỗi lượt quét sẽ làm
       * mọi cảnh báo trông như vừa mới xảy ra, và một vi phạm kéo dài ba tuần
       * không còn cách nào nhận ra.
       *
       * `status` giữ nguyên để việc người dùng đã tiếp nhận không bị lượt quét
       * sau đó xoá đi.
       */
      await prisma.riskAlert.update({
        where: { id: existing.id },
        data: {
          severity: finding.severity,
          title: finding.title,
          message: finding.message,
          measuredValue: finding.measured,
          thresholdValue: finding.threshold,
          contextJson: JSON.stringify(finding.context),
        },
      });
      updated += 1;
      continue;
    }

    await prisma.riskAlert.create({
      data: {
        ruleId: finding.ruleId,
        portfolioId: finding.portfolioId,
        targetRef: finding.targetRef,
        severity: finding.severity,
        title: finding.title,
        message: finding.message,
        measuredValue: finding.measured,
        thresholdValue: finding.threshold,
        contextJson: JSON.stringify(finding.context),
        status: ALERT_STATUS.OPEN,
      },
    });
    opened += 1;
  }

  /*
   * Đóng cảnh báo mà lượt quét này không còn thấy.
   *
   * CHỈ đóng cảnh báo thuộc rule ĐANG HOẠT ĐỘNG và đã được đánh giá trong lượt
   * này. Cảnh báo của một rule vừa bị tắt sẽ được giữ ở trạng thái mở — người
   * tắt rule cần thấy hậu quả của việc mình vừa làm, chứ không nên thấy mọi cảnh
   * báo liên quan tự biến mất như thể vấn đề đã được giải quyết.
   */
  const evaluatedRules = new Set(ruleIds);
  const toResolve = live.filter(
    (alert) => evaluatedRules.has(alert.ruleId) && !foundKeys.has(findingKey(alert)),
  );

  if (toResolve.length > 0) {
    await prisma.riskAlert.updateMany({
      where: { id: { in: toResolve.map((a) => a.id) } },
      data: { status: ALERT_STATUS.RESOLVED, resolvedAt: new Date() },
    });
  }

  return { opened, updated, resolved: toResolve.length };
}

// ---------------------------------------------------------------------------
// Quét lười
// ---------------------------------------------------------------------------

/**
 * Quét nếu lượt gần nhất đã cũ — gọi được từ mọi trang, an toàn khi gọi liên tục.
 *
 * VÌ SAO CÓ CƠ CHẾ NÀY: hệ thống phải tự đứng được mà không cần bộ hẹn giờ bên
 * ngoài. Cài Task Scheduler là việc tốt hơn (cảnh báo sẽ được phát hiện cả khi
 * không ai mở trang), nhưng nếu chưa cài thì cảnh báo vẫn phải đúng lúc người
 * dùng nhìn vào — không được hiện số liệu của tuần trước.
 *
 * Không bao giờ ném lỗi: một lượt quét thất bại không được phép làm trắng trang
 * Dashboard. Lỗi đã được ghi vào `risk_scan_runs` và hiện lên giao diện.
 */
export async function ensureRecentScan(): Promise<void> {
  const cutoff = new Date(Date.now() - maxScanAgeSeconds() * 1000);

  try {
    const recent = await prisma.riskScanRun.findFirst({
      where: {
        startedAt: { gte: cutoff },
        // Lượt đang chạy cũng tính là "vừa quét": nếu không, hai request đến cùng
        // lúc sẽ cùng khởi động một lượt quét.
        status: { in: [SCAN_STATUS.SUCCESS, SCAN_STATUS.RUNNING] },
      },
      select: { id: true },
    });
    if (recent) return;

    /*
     * Lượt treo: tiến trình chết giữa đường để lại một bản ghi RUNNING mãi mãi.
     * Nếu chỉ dựa vào điều kiện trên thì sau khi treo, quét lười sẽ chạy lại mỗi
     * lần mở trang — đúng cái mà điều tiết cố tránh. Đánh dấu thất bại rồi quét.
     */
    await prisma.riskScanRun.updateMany({
      where: {
        status: SCAN_STATUS.RUNNING,
        startedAt: { lt: new Date(Date.now() - STALE_RUN_MINUTES * 60_000) },
      },
      data: {
        status: SCAN_STATUS.FAILED,
        finishedAt: new Date(),
        errorMessage: `Lượt quét không kết thúc sau ${STALE_RUN_MINUTES} phút — coi như treo.`,
      },
    });

    await runRiskScan({ trigger: 'LAZY' });
  } catch (error) {
    console.error('[risk] quét lười thất bại:', error);
  }
}

// ---------------------------------------------------------------------------
// Đọc để hiển thị
// ---------------------------------------------------------------------------

export interface AlertView {
  id: string;
  severity: Severity;
  status: string;
  title: string;
  message: string;
  targetRef: string | null;
  measuredValue: bigint | null;
  thresholdValue: bigint | null;
  triggeredAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedByName: string | null;
  resolvedAt: Date | null;
  ruleCode: string;
  ruleScope: string;
  ruleMetric: string;
  portfolioCode: string | null;
}

/**
 * Chặn trên khi đọc để sắp xếp — luôn cao hơn `limit` mà nơi gọi yêu cầu.
 *
 * Xem chú thích của `listOpenAlerts` để biết vì sao con số này phải tách khỏi
 * `limit`. Cảnh báo đang mở trong thực tế là hàng chục, không phải hàng nghìn:
 * mỗi lượt quét chỉ mở tối đa một cảnh báo cho mỗi (ngưỡng × đối tượng), và
 * những cái hết điều kiện thì tự đóng. 500 là chặn an toàn, không phải kỳ vọng.
 */
const SORT_WINDOW = 500;

/**
 * Cảnh báo đang mở, sắp theo mức nghiêm trọng rồi tới thời điểm bắt đầu.
 *
 * SẮP XẾP Ở TẦNG ỨNG DỤNG, không trong SQL: `severity` là chuỗi, nên
 * `ORDER BY severity` cho thứ tự theo bảng chữ cái — CRITICAL trước INFO (đúng
 * do tình cờ) nhưng HIGH trước WARNING (sai). Xem `SEVERITY_RANK`.
 *
 * VÌ VẬY PHẢI ĐỌC RỘNG RỒI MỚI CẮT. Trước đây hàm này truyền thẳng `limit` vào
 * `take`, nên với `limit = 6` trên Dashboard, database chọn 6 cảnh báo MỚI NHẤT
 * rồi mới sắp theo mức nghiêm trọng — một cảnh báo CRITICAL đã tồn tại một tuần
 * sẽ bị sáu cảnh báo INFO vừa xuất hiện đẩy ra khỏi màn hình. Danh sách trông
 * như "gấp nhất lên trước" nhưng chỉ đúng trong phạm vi sáu dòng vừa lấy về.
 *
 * Cắt sau khi sắp thì thứ tự đúng trên toàn bộ tập cảnh báo đang mở.
 */
export async function listOpenAlerts(limit = 100): Promise<AlertView[]> {
  const rows = await prisma.riskAlert.findMany({
    where: { status: { in: [ALERT_STATUS.OPEN, ALERT_STATUS.ACKNOWLEDGED] } },
    orderBy: { triggeredAt: 'desc' },
    take: Math.max(limit, SORT_WINDOW),
    include: {
      rule: { select: { code: true, scope: true, metric: true } },
      portfolio: { select: { code: true } },
      acknowledgedBy: { select: { fullName: true } },
    },
  });

  return rows.map(toView).sort(bySeverityThenAge).slice(0, limit);
}

/** Cảnh báo đã đóng — để trả lời "hôm qua có gì" mà không làm rối danh sách mở. */
export async function listResolvedAlerts(limit = 30): Promise<AlertView[]> {
  const rows = await prisma.riskAlert.findMany({
    where: { status: ALERT_STATUS.RESOLVED },
    orderBy: { resolvedAt: 'desc' },
    take: limit,
    include: {
      rule: { select: { code: true, scope: true, metric: true } },
      portfolio: { select: { code: true } },
      acknowledgedBy: { select: { fullName: true } },
    },
  });

  return rows.map(toView);
}

type AlertRow = {
  id: string;
  severity: string;
  status: string;
  title: string;
  message: string;
  targetRef: string | null;
  measuredValue: bigint | null;
  thresholdValue: bigint | null;
  triggeredAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  rule: { code: string; scope: string; metric: string };
  portfolio: { code: string } | null;
  acknowledgedBy: { fullName: string } | null;
};

function toView(row: AlertRow): AlertView {
  return {
    id: row.id,
    severity: row.severity as Severity,
    status: row.status,
    title: row.title,
    message: row.message,
    targetRef: row.targetRef,
    measuredValue: row.measuredValue,
    thresholdValue: row.thresholdValue,
    triggeredAt: row.triggeredAt,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedByName: row.acknowledgedBy?.fullName ?? null,
    resolvedAt: row.resolvedAt,
    ruleCode: row.rule.code,
    ruleScope: row.rule.scope,
    ruleMetric: row.rule.metric,
    portfolioCode: row.portfolio?.code ?? null,
  };
}

function bySeverityThenAge(a: AlertView, b: AlertView): number {
  const rank = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (rank !== 0) return rank;
  // Cùng mức nghiêm trọng: cái tồn tại lâu hơn xếp trên — nó đã bị bỏ lâu hơn.
  return a.triggeredAt.getTime() - b.triggeredAt.getTime();
}

/**
 * Đếm cảnh báo đang mở theo mức nghiêm trọng.
 *
 * PHẢI ở đây, KHÔNG ở src/risk/actions.ts. Mọi hàm export từ một file
 * `'use server'` trở thành một endpoint gọi được từ ngoài — kể cả hàm chỉ đọc và
 * không kiểm tra quyền. Đặt một hàm đếm dữ liệu ở đó là tự mở một API công khai
 * mà không ai để ý, vì file vẫn biên dịch và giao diện vẫn chạy đúng.
 */
export async function countOpenAlertsBySeverity(): Promise<Record<Severity, number>> {
  const rows = await prisma.riskAlert.groupBy({
    by: ['severity'],
    where: { status: { in: [ALERT_STATUS.OPEN, ALERT_STATUS.ACKNOWLEDGED] } },
    _count: true,
  });

  const out: Record<Severity, number> = { INFO: 0, WARNING: 0, HIGH: 0, CRITICAL: 0 };
  for (const row of rows) {
    if (row.severity in out) out[row.severity as Severity] = row._count;
  }
  return out;
}

/** Lượt quét gần nhất — để giao diện nói được engine còn sống hay không. */
export async function lastScanRun() {
  return prisma.riskScanRun.findFirst({
    orderBy: { startedAt: 'desc' },
    include: { triggeredBy: { select: { fullName: true } } },
  });
}
