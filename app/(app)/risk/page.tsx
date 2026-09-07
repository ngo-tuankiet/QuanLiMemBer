import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { AcknowledgeButton, RescanForm, RuleEditor } from './RiskForms';
import {
  countOpenAlertsBySeverity,
  ensureRecentScan,
  lastScanRun,
  listOpenAlerts,
  listResolvedAlerts,
  type AlertView,
} from '@/risk/scan';
import { alertHref, describeCondition, formatMeasure } from '@/domain/risk-engine';
import { absoluteVi, elapsedVi } from '@/lib/elapsed';
import {
  ALERT_STATUS,
  ALERT_STATUS_LABEL_VI,
  RISK_METRIC_LABEL_VI,
  RISK_METRIC_UNIT,
  RISK_SCOPE_LABEL_VI,
  SCAN_STATUS,
  SEVERITY,
  SEVERITY_DOT,
  SEVERITY_LABEL_VI,
  type AlertStatus,
  type Comparator,
  type RiskMetric,
  type RiskScope,
  type Severity,
} from '@/lib/enums';

export const metadata: Metadata = { title: 'Risk & Alerts' };

/**
 * RISK & ALERTS (§19) — Phase 09.
 *
 * Trang này trả lời ba câu hỏi, theo đúng thứ tự đó:
 *   1. Engine có đang chạy không?  → khối trạng thái trên cùng
 *   2. Đang có gì phải xử lý?      → cảnh báo đang mở, gấp nhất lên trước
 *   3. Ngưỡng đang đặt ở đâu?      → bảng ngưỡng phía dưới
 *
 * Câu 1 đứng TRƯỚC câu 2 là có chủ ý. Một danh sách cảnh báo trống chỉ có nghĩa
 * khi biết rằng đã có người đo — nếu không, "không có cảnh báo" và "engine chết"
 * trông y như nhau, và cái thứ hai nguy hiểm hơn nhiều.
 */
export default async function RiskPage() {
  const user = await requirePagePermission('risk.view');

  /*
   * Quét lười trước khi đọc: mở trang Risk mà thấy số liệu của một giờ trước là
   * vô nghĩa. Hàm này tự điều tiết và không bao giờ ném lỗi — xem src/risk/scan.ts.
   */
  await ensureRecentScan();

  const [counts, open, resolved, lastRun, rules, recentRuns] = await Promise.all([
    countOpenAlertsBySeverity(),
    listOpenAlerts(),
    listResolvedAlerts(20),
    lastScanRun(),
    prisma.riskRule.findMany({
      orderBy: [{ scope: 'asc' }, { code: 'asc' }],
      include: { portfolio: { select: { code: true } } },
    }),
    prisma.riskScanRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 8,
      include: { triggeredBy: { select: { fullName: true } } },
    }),
  ]);

  const canManage = user.permissions.has('risk.manage_rules');
  const canAcknowledge = user.permissions.has('risk.acknowledge_alert');
  const totalOpen = open.length;

  return (
    <>
      <PageHeader
        title="Risk &amp; Alerts"
        subtitle={
          totalOpen === 0
            ? 'Không có cảnh báo nào đang mở'
            : `${totalOpen} cảnh báo đang mở · ${rules.filter((r) => r.isActive).length}/${rules.length} ngưỡng đang bật`
        }
        actions={canManage ? <RescanForm /> : undefined}
      />

      {/* ---------------------------------------------------------------- */}
      {/* 1. Engine còn sống không                                         */}
      {/* ---------------------------------------------------------------- */}
      <EngineStatus run={lastRun} />

      {/* ---------------------------------------------------------------- */}
      {/* Đếm theo mức nghiêm trọng — bốn con số thì dùng ô số, không vẽ    */}
      {/* biểu đồ: bốn cột không cho biết thêm gì so với bốn con số.        */}
      {/* ---------------------------------------------------------------- */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [SEVERITY.CRITICAL, SEVERITY.HIGH, SEVERITY.WARNING, SEVERITY.INFO] as Severity[]
        ).map((severity) => (
          <Card key={severity} className="p-4">
            <p className="flex items-center gap-1.5 text-xs text-slate-muted">
              <span aria-hidden>{SEVERITY_DOT[severity]}</span>
              {SEVERITY_LABEL_VI[severity]}
            </p>
            <p
              className={`tabular mt-1.5 text-2xl font-semibold ${
                counts[severity] > 0 ? severityTextClass(severity) : 'text-ink-500'
              }`}
            >
              {counts[severity]}
            </p>
          </Card>
        ))}
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* 2. Cảnh báo đang mở                                              */}
      {/* ---------------------------------------------------------------- */}
      <Card className="mb-6 overflow-hidden">
        <div className="flex items-baseline justify-between border-b border-ink-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-strong">Đang mở</h2>
          <p className="text-tiny text-slate-muted">
            Gấp nhất lên trước; cùng mức thì cái tồn tại lâu hơn lên trước
          </p>
        </div>

        {open.length === 0 ? (
          <EmptyState
            title="Không có cảnh báo nào đang mở"
            hint={
              lastRun?.status === SCAN_STATUS.SUCCESS
                ? `Lượt quét lúc ${absoluteVi(lastRun.startedAt)} không thấy ngưỡng nào bị vượt.`
                : 'Chưa có lượt quét thành công nào — con số này chưa đáng tin.'
            }
          />
        ) : (
          <ul className="divide-y divide-ink-800">
            {open.map((alert) => (
              <AlertRow key={alert.id} alert={alert} canAcknowledge={canAcknowledge} />
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* 3. Ngưỡng                                                        */}
      {/* ---------------------------------------------------------------- */}
      <Card className="mb-6 overflow-hidden">
        <div className="flex items-baseline justify-between border-b border-ink-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-strong">Ngưỡng rủi ro</h2>
          <p className="text-tiny text-slate-muted">
            {canManage
              ? 'Sửa ngưỡng sẽ quét lại ngay để thấy hậu quả'
              : 'Cần quyền risk.manage_rules để sửa'}
          </p>
        </div>

        <ul className="divide-y divide-ink-800">
          {rules.map((rule) => {
            const metric = rule.metric as RiskMetric;
            const unit = RISK_METRIC_UNIT[metric];

            return (
              <li key={rule.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span aria-hidden>{SEVERITY_DOT[rule.severity as Severity]}</span>
                  <span className="font-mono text-tiny text-slate-muted">{rule.code}</span>
                  <span className="text-sm text-strong">{rule.nameVi}</span>
                  {!rule.isActive ? (
                    <span className="rounded border border-ink-600 px-1.5 py-px text-micro text-ink-500">
                      đã tắt
                    </span>
                  ) : null}
                  {rule.portfolio ? (
                    <span className="rounded border border-ink-700 px-1.5 py-px text-micro text-slate-muted">
                      chỉ {rule.portfolio.code}
                    </span>
                  ) : null}
                  {rule.targetRef ? (
                    <span className="rounded border border-ink-700 px-1.5 py-px text-micro text-slate-muted">
                      chỉ {rule.targetRef}
                    </span>
                  ) : null}

                  <span className="tabular ml-auto text-xs text-slate-soft">
                    {RISK_SCOPE_LABEL_VI[rule.scope as RiskScope]} ·{' '}
                    {RISK_METRIC_LABEL_VI[metric]}{' '}
                    {describeCondition(metric, rule.comparator as Comparator, rule.threshold)}
                  </span>
                </div>

                {rule.description ? (
                  <p className="mt-1 max-w-3xl text-xs text-slate-muted">{rule.description}</p>
                ) : null}

                {canManage ? (
                  <div className="mt-2.5">
                    <RuleEditor
                      ruleId={rule.id}
                      threshold={rule.threshold.toString()}
                      severity={rule.severity as Severity}
                      isActive={rule.isActive}
                      unitHint={unitHintFor(unit)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Lịch sử                                                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-ink-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-strong">Cảnh báo đã hết</h2>
            <p className="mt-0.5 text-tiny text-slate-muted">
              Engine tự đóng khi đo lại thấy điều kiện không còn đúng
            </p>
          </div>
          {resolved.length === 0 ? (
            <EmptyState title="Chưa có cảnh báo nào được đóng" />
          ) : (
            <ul className="divide-y divide-ink-800">
              {resolved.map((alert) => (
                <li key={alert.id} className="flex items-baseline gap-2.5 px-4 py-2.5">
                  <span aria-hidden className="opacity-50">
                    {SEVERITY_DOT[alert.severity]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-soft">
                    {alert.title}
                  </span>
                  <time className="tabular shrink-0 text-tiny text-slate-muted">
                    {alert.resolvedAt ? absoluteVi(alert.resolvedAt) : '—'}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-ink-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-strong">Lịch sử quét</h2>
            <p className="mt-0.5 text-tiny text-slate-muted">
              SCHEDULE = bộ hẹn giờ · LAZY = có người mở trang · MANUAL = bấm tay
            </p>
          </div>
          {recentRuns.length === 0 ? (
            <EmptyState title="Chưa có lượt quét nào" />
          ) : (
            <ul className="divide-y divide-ink-800">
              {recentRuns.map((run) => (
                <li key={run.id} className="flex flex-wrap items-baseline gap-x-2.5 px-4 py-2.5">
                  <span
                    className={`rounded px-1.5 py-px font-mono text-micro ${scanStatusClass(run.status)}`}
                  >
                    {run.status}
                  </span>
                  <span className="font-mono text-micro text-slate-muted">{run.trigger}</span>
                  <time className="tabular text-tiny text-slate-soft">
                    {absoluteVi(run.startedAt)}
                  </time>
                  {run.status === SCAN_STATUS.SUCCESS ? (
                    <span className="tabular ml-auto text-tiny text-slate-muted">
                      {run.rulesEvaluated} ngưỡng · +{run.alertsOpened} / −{run.alertsResolved} ·{' '}
                      {run.durationMs} ms
                    </span>
                  ) : run.errorMessage ? (
                    <span className="ml-auto max-w-[60%] truncate text-tiny text-down-500">
                      {run.errorMessage}
                    </span>
                  ) : null}
                  {run.triggeredBy ? (
                    <span className="w-full text-tiny text-ink-500">
                      {run.triggeredBy.fullName}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Thành phần
// ---------------------------------------------------------------------------

type ScanRun = {
  status: string;
  trigger: string;
  startedAt: Date;
  durationMs: number | null;
  rulesEvaluated: number;
  errorMessage: string | null;
  triggeredBy: { fullName: string } | null;
};

function EngineStatus({ run }: { run: ScanRun | null }) {
  if (!run) {
    return (
      <Card className="mb-6 border-warn-500/30 bg-warn-500/5 p-4">
        <p className="text-sm font-medium text-warn-500">Risk Engine chưa từng chạy</p>
        <p className="mt-1 text-xs text-slate-soft">
          Chưa có lượt quét nào được ghi lại, nên danh sách cảnh báo bên dưới chưa phản ánh
          thực tế. Mở lại trang này sẽ kích hoạt một lượt quét.
        </p>
      </Card>
    );
  }

  if (run.status === SCAN_STATUS.FAILED) {
    return (
      <Card className="mb-6 border-down-500/30 bg-down-500/5 p-4">
        <p className="text-sm font-medium text-down-500">
          Lượt quét gần nhất thất bại · {elapsedVi(run.startedAt)} trước
        </p>
        <p className="mt-1 font-mono text-xs break-words text-slate-soft">
          {run.errorMessage ?? 'Không có thông báo lỗi.'}
        </p>
        <p className="mt-1.5 text-xs text-slate-muted">
          Cảnh báo bên dưới là kết quả của lượt quét thành công TRƯỚC ĐÓ, không phải hiện trạng.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1 p-4">
      <span className="flex items-center gap-2 text-sm text-strong">
        <span className="size-1.5 rounded-full bg-up-500" />
        Risk Engine hoạt động
      </span>
      <span className="tabular text-xs text-slate-soft">
        quét gần nhất {elapsedVi(run.startedAt)} trước
      </span>
      <span className="text-xs text-slate-muted">
        {absoluteVi(run.startedAt)} · {run.trigger}
        {run.triggeredBy ? ` · ${run.triggeredBy.fullName}` : ''}
      </span>
      <span className="tabular ml-auto text-xs text-slate-muted">
        {run.rulesEvaluated} ngưỡng · {run.durationMs ?? '—'} ms
      </span>
    </Card>
  );
}

function AlertRow({
  alert,
  canAcknowledge,
}: {
  alert: AlertView;
  canAcknowledge: boolean;
}) {
  const metric = alert.ruleMetric as RiskMetric;
  const acknowledged = alert.status === ALERT_STATUS.ACKNOWLEDGED;

  return (
    <li className={`px-4 py-3.5 ${acknowledged ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 shrink-0">
          {SEVERITY_DOT[alert.severity]}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-sm font-medium text-strong">{alert.title}</span>
            <span className="font-mono text-micro text-slate-muted">{alert.ruleCode}</span>
            {alert.portfolioCode ? (
              <span className="rounded border border-ink-700 px-1.5 py-px text-micro text-slate-muted">
                {alert.portfolioCode}
              </span>
            ) : null}
            {acknowledged ? (
              <span className="rounded border border-accent-500/40 bg-accent-500/10 px-1.5 py-px text-micro text-accent-400">
                {ALERT_STATUS_LABEL_VI[alert.status as AlertStatus]}
                {alert.acknowledgedByName ? ` · ${alert.acknowledgedByName}` : ''}
              </span>
            ) : null}
          </div>

          <p className="mt-1 text-xs text-slate-soft">{alert.message}</p>

          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-tiny">
            {/*
              Số đo và ngưỡng luôn hiện dưới dạng chữ có đơn vị. Cùng cột BigInt
              mang bps, phút, hoặc số đếm — in thô sẽ khiến "1000" của tỷ trọng
              trông như một nghìn thay vì 10%.
            */}
            <span className="tabular text-slate-muted">
              đo được{' '}
              <span className={severityTextClass(alert.severity)}>
                {formatMeasure(metric, alert.measuredValue)}
              </span>
              {alert.thresholdValue !== null
                ? ` · ngưỡng ${formatMeasure(metric, alert.thresholdValue)}`
                : ''}
            </span>
            <span className="tabular text-slate-muted">
              đã {elapsedVi(alert.triggeredAt)} · {absoluteVi(alert.triggeredAt)}
            </span>
            <Link
              href={alertHref(alert.ruleScope)}
              className="text-accent-400 transition hover:underline"
            >
              Xem chi tiết →
            </Link>
          </div>
        </div>

        {canAcknowledge && !acknowledged ? <AcknowledgeButton alertId={alert.id} /> : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Trình bày
// ---------------------------------------------------------------------------

/**
 * Màu chữ theo mức nghiêm trọng.
 *
 * Dùng bộ màu TRẠNG THÁI, không dùng slot màu chuỗi dữ liệu. Đây là quy tắc cứng:
 * màu trạng thái được giữ riêng và không bao giờ tái sử dụng làm "chuỗi thứ 4",
 * để 🔴 luôn có nghĩa là nghiêm trọng ở mọi nơi trong app.
 */
function severityTextClass(severity: Severity): string {
  switch (severity) {
    case SEVERITY.CRITICAL:
      return 'text-down-500';
    case SEVERITY.HIGH:
      return 'text-serious-500';
    case SEVERITY.WARNING:
      return 'text-warn-500';
    case SEVERITY.INFO:
      return 'text-slate-soft';
  }
}

function scanStatusClass(status: string): string {
  if (status === SCAN_STATUS.SUCCESS) return 'bg-up-500/15 text-up-500';
  if (status === SCAN_STATUS.FAILED) return 'bg-down-500/15 text-down-500';
  return 'bg-ink-800 text-slate-muted';
}

function unitHintFor(unit: 'BPS' | 'MINUTES' | 'COUNT'): string {
  switch (unit) {
    case 'BPS':
      return 'Đơn vị: basis point — 1000 = 10,00% · 2500 = 25,00%';
    case 'MINUTES':
      return 'Đơn vị: phút';
    case 'COUNT':
      return 'Đơn vị: số đếm';
  }
}
