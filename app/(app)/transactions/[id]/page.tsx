import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { getDict } from '@/i18n';
import { prisma } from '@/lib/prisma';
import {
  Card,
  PageHeader,
  TradeStatusChip,
  TradeTypeChip,
} from '@/components/ui';
import { Money, Price, Quantity, Weight, WeightBar } from '@/components/money';
import { dataScope } from '@/domain/permissions';
import { grossAmount, netAmount, formatVnd } from '@/lib/money';
import { parseJsonField } from '@/lib/serialize';
import {
  BROKER,
  BROKER_LABEL_VI,
  TRADE_STATUS,
  ENTITY_TYPE,
  type Broker,
  type TradeStatus,
} from '@/lib/enums';
import {
  ApproveRejectForms,
  CancelTradeForm,
  EditTradeForm,
  SubmitForApprovalForm,
} from './TradeActions';

export const metadata: Metadata = { title: 'Chi tiết giao dịch' };

/**
 * Chi tiết giao dịch (§8, §20).
 *
 * Trang này là nơi thể hiện rõ nhất hai đặc trưng của hệ thống:
 *   — phân bổ đa chiến lược với số tiền cụ thể từng phần (§6);
 *   — toàn bộ lịch sử thay đổi kèm Before/After (§20).
 */
export default async function TradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePagePermission('transaction.view');
  const { t } = await getDict();
  const { id } = await params;

  const trade = await prisma.trade.findUnique({
    where: { id },
    include: {
      stock: {
        include: {
          sector: { select: { nameVi: true, colorHex: true } },
          industry: { select: { nameVi: true } },
          quote: { select: { price: true, tradingDate: true, source: true } },
        },
      },
      portfolio: { select: { code: true, name: true, nameVi: true } },
      executor: { select: { fullName: true, email: true } },
      team: { select: { nameVi: true } },
      brokerAccount: {
        select: {
          broker: true,
          brokerOther: true,
          accountNo: true,
          ib: { select: { code: true, name: true } },
        },
      },
      createdBy: { select: { fullName: true } },
      updatedBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
      cancelledBy: { select: { fullName: true } },
      strategies: {
        include: { strategy: { select: { code: true, nameVi: true, colorHex: true } } },
        orderBy: { allocationBps: 'desc' },
      },
    },
  });

  if (!trade) notFound();

  // Ép phạm vi: người không có view_all chỉ xem được giao dịch của nhóm mình.
  const scope = dataScope(user.permissions, 'transaction');
  if (scope !== 'ALL' && trade.teamId !== user.teamId) notFound();

  const [auditLogs, approvals] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entityType: ENTITY_TYPE.TRADE, entityId: id },
      orderBy: { occurredAt: 'desc' },
    }),
    prisma.approvalRequest.findMany({
      where: { entityType: ENTITY_TYPE.TRADE, entityId: id },
      orderBy: { requestedAt: 'desc' },
      include: {
        requestedBy: { select: { fullName: true } },
        decidedBy: { select: { fullName: true } },
      },
    }),
  ]);

  const status = trade.status as TradeStatus;
  const gross = grossAmount(trade.quantity, trade.price);
  const net = netAmount(
    trade.transactionType as 'BUY' | 'SELL',
    trade.quantity,
    trade.price,
    trade.fees,
    trade.tax,
  );

  const allocationTotalBps = trade.strategies.reduce((s, a) => s + a.allocationBps, 0);
  const allocationTotalAmount = trade.strategies.reduce((s, a) => s + a.allocationAmount, 0n);
  const allocationExact = allocationTotalBps === 10_000 && allocationTotalAmount === net;

  const isOwn = trade.createdById === user.id || trade.userId === user.id;
  const canApprove =
    user.permissions.has('transaction.approve') &&
    status === TRADE_STATUS.PENDING_APPROVAL &&
    !isOwn;
  const canEdit =
    user.permissions.has('transaction.update') &&
    status !== TRADE_STATUS.CANCELLED &&
    status !== TRADE_STATUS.REJECTED;
  const canCancel =
    user.permissions.has('transaction.cancel') &&
    status !== TRADE_STATUS.CANCELLED &&
    status !== TRADE_STATUS.REJECTED;
  const canSubmit = status === TRADE_STATUS.DRAFT && isOwn;

  return (
    <>
      <div className="mb-4">
        <Link href="/transactions" className="text-xs text-slate-muted hover:text-slate-soft">
          ← Transactions
        </Link>
      </div>

      <PageHeader
        title={`${trade.transactionType} ${trade.stock.symbol}`}
        subtitle={`${trade.code} · ${trade.portfolio.nameVi ?? trade.portfolio.name}`}
        actions={
          <>
            <TradeTypeChip type={trade.transactionType} />
            <TradeStatusChip status={status} />
          </>
        }
      />

      {/* Chỉ hiện khi bất biến §6 bị vi phạm — đáng lẽ không bao giờ xảy ra */}
      {!allocationExact ? (
        <Card className="mb-4 border-down-500/40 bg-down-500/5 p-4">
          <p className="text-sm font-medium text-down-500">
            Cảnh báo toàn vẹn dữ liệu: phân bổ chiến lược không khớp
          </p>
          <p className="mt-1 text-xs text-slate-muted">
            Tổng tỷ lệ {(allocationTotalBps / 100).toFixed(2)}% (phải 100%), tổng tiền{' '}
            {formatVnd(allocationTotalAmount)} so với giá trị lệnh {formatVnd(net)}. Chạy{' '}
            <span className="font-mono">npm run verify:model</span> để kiểm tra toàn bộ database.
          </p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          {/* ---------------------------------------------------------- */}
          {/* Số liệu giao dịch                                          */}
          {/* ---------------------------------------------------------- */}
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-strong">Số liệu</h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <dl className="space-y-2.5 text-sm">
                <Row label="Mã chứng khoán">
                  {/* Không còn là link: trang danh sách mã đã được bỏ. */}
                  <span className="font-mono font-semibold text-strong">
                    {trade.stock.symbol}
                  </span>
                </Row>
                <Row label="Công ty">
                  <span className="text-right text-xs text-slate-soft">
                    {trade.stock.companyName}
                  </span>
                </Row>
                <Row label="Sàn / Ngành">
                  <span className="text-right text-xs text-slate-soft">
                    {trade.stock.exchange} · {trade.stock.sector.nameVi}
                  </span>
                </Row>
                <Row label="Khối lượng">
                  <Quantity value={trade.quantity} className="text-strong" />
                </Row>
                <Row label="Giá khớp">
                  <Price value={trade.price} className="text-strong" />
                </Row>
                <Row label="Thời điểm khớp">
                  <span className="tabular text-xs text-slate-soft">
                    {trade.executedAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                  </span>
                </Row>
              </dl>

              <dl className="space-y-2.5 text-sm">
                <Row label="Giá trị">
                  <Money value={gross} className="text-strong" />
                </Row>
                <Row label="Phí">
                  <Money value={trade.fees} className="text-slate-soft" />
                </Row>
                <Row label="Thuế">
                  <Money value={trade.tax} className="text-slate-soft" />
                </Row>
                <div className="flex items-baseline justify-between gap-3 border-t border-ink-800 pt-2.5">
                  <dt className="text-sm font-medium text-strong">
                    {trade.transactionType === 'BUY' ? 'Tiền chi ra' : 'Tiền thu về'}
                  </dt>
                  <dd>
                    <Money
                      value={net}
                      className={
                        trade.transactionType === 'BUY'
                          ? 'font-semibold text-down-500'
                          : 'font-semibold text-up-500'
                      }
                    />
                  </dd>
                </div>
                <Row label="Giá hiện tại">
                  {trade.stock.quote ? (
                    <Price value={trade.stock.quote.price} className="text-slate-soft" />
                  ) : (
                    <span className="text-xs text-ink-500">chưa có</span>
                  )}
                </Row>
              </dl>
            </div>

            {trade.orderId || trade.broker || trade.executionNote ? (
              <dl className="mt-4 space-y-2 border-t border-ink-800 pt-4 text-xs">
                {trade.orderId ? <Row label="Mã lệnh môi giới">{trade.orderId}</Row> : null}
                {trade.broker ? <Row label="Công ty chứng khoán">{trade.broker}</Row> : null}
                {trade.executionNote ? (
                  <div>
                    <dt className="text-slate-muted">Ghi chú thực thi</dt>
                    <dd className="mt-1 text-slate-soft">{trade.executionNote}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}

            {trade.investmentThesis ? (
              <div className="mt-4 border-t border-ink-800 pt-4">
                <p className="text-xs text-slate-muted">Luận điểm đầu tư</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-soft">
                  {trade.investmentThesis}
                </p>
              </div>
            ) : null}
          </Card>

          {/* ---------------------------------------------------------- */}
          {/* PHÂN BỔ CHIẾN LƯỢC — §6                                    */}
          {/* ---------------------------------------------------------- */}
          <Card className="p-5">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-strong">Phân bổ chiến lược</h2>
                <p className="mt-0.5 text-xs text-slate-muted">
                  {trade.strategies.length} chiến lược · tổng khớp tuyệt đối với giá trị lệnh
                </p>
              </div>
              <span
                className={`tabular rounded-md border px-2 py-0.5 text-sm font-semibold ${
                  allocationTotalBps === 10_000
                    ? 'border-up-500/40 bg-up-500/10 text-up-500'
                    : 'border-down-500/40 bg-down-500/10 text-down-500'
                }`}
              >
                {(allocationTotalBps / 100).toFixed(2)}%
              </span>
            </div>

            <ul className="space-y-3">
              {trade.strategies.map((a) => (
                <li key={a.id}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: a.strategy.colorHex ?? 'var(--color-ink-500)' }}
                      />
                      <span className="text-sm text-slate-soft">{a.strategy.nameVi}</span>
                      <span className="font-mono text-micro text-ink-500">
                        {a.strategy.code}
                      </span>
                    </span>
                    <span className="flex items-baseline gap-3">
                      <Weight bps={a.allocationBps} className="text-xs text-slate-muted" />
                      <Money value={a.allocationAmount} className="text-sm text-strong" />
                    </span>
                  </div>
                  <WeightBar bps={a.allocationBps} color={a.strategy.colorHex} />
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-ink-800 pt-3">
              <span className="text-sm font-medium text-strong">Tổng</span>
              <Money
                value={allocationTotalAmount}
                className={
                  allocationTotalAmount === net
                    ? 'text-sm font-semibold text-up-500'
                    : 'text-sm font-semibold text-down-500'
                }
              />
            </div>
          </Card>

          {/* ---------------------------------------------------------- */}
          {/* Audit trail §20                                            */}
          {/* ---------------------------------------------------------- */}
          {user.permissions.has('audit.view') ? (
            <Card className="overflow-hidden">
              <div className="border-b border-ink-800 px-5 py-3">
                <h2 className="text-sm font-semibold text-strong">Lịch sử thay đổi</h2>
                <p className="mt-0.5 text-xs text-slate-muted">
                  {auditLogs.length} bản ghi · không sửa và không xoá được
                </p>
              </div>

              <ul className="divide-y divide-ink-800">
                {auditLogs.map((log) => {
                  const before = parseJsonField<Record<string, unknown>>(log.beforeJson);
                  const after = parseJsonField<Record<string, unknown>>(log.afterJson);
                  const changed = parseJsonField<string[]>(log.changedFieldsJson);

                  return (
                    <li key={log.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <time className="tabular text-xs text-slate-muted">
                          {log.occurredAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                        </time>
                        <span className="rounded bg-ink-800 px-1.5 py-px font-mono text-micro text-slate-soft">
                          {log.action}
                        </span>
                        <span className="text-sm text-strong">{log.actorName ?? 'hệ thống'}</span>
                        {log.actorRole ? (
                          <span className="rounded border border-ink-700 px-1.5 py-px text-micro text-slate-muted">
                            {log.actorRole}
                          </span>
                        ) : null}
                      </div>

                      {log.note ? (
                        <p className="mt-1 text-xs text-slate-muted">{log.note}</p>
                      ) : null}

                      {before || after ? (
                        <div className="mt-2 grid grid-cols-1 gap-2 text-tiny sm:grid-cols-2">
                          {before ? (
                            <div className="rounded-lg border border-down-500/20 bg-down-500/5 p-2.5">
                              <p className="mb-1 font-medium text-down-500">{t.page.before}</p>
                              <KeyValues data={before} changed={changed} />
                            </div>
                          ) : (
                            <div />
                          )}
                          {after ? (
                            <div className="rounded-lg border border-up-500/20 bg-up-500/5 p-2.5">
                              <p className="mb-1 font-medium text-up-500">{t.page.after}</p>
                              <KeyValues data={after} changed={changed} />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
        </div>

        {/* ------------------------------------------------------------ */}
        {/* Cột phải: hành động và thông tin                             */}
        {/* ------------------------------------------------------------ */}
        <div className="space-y-4">
          {canApprove || canSubmit || canEdit || canCancel ? (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-strong">Hành động</h2>
              <div className="space-y-3">
                {canApprove ? <ApproveRejectForms tradeId={trade.id} /> : null}
                {canSubmit ? <SubmitForApprovalForm tradeId={trade.id} /> : null}
                {canEdit ? (
                  <EditTradeForm
                    tradeId={trade.id}
                    version={trade.version}
                    quantity={trade.quantity}
                    price={trade.price.toString()}
                    fees={trade.fees.toString()}
                    tax={trade.tax.toString()}
                  />
                ) : null}
                {canCancel ? (
                  <CancelTradeForm
                    tradeId={trade.id}
                    isExecuted={status === TRADE_STATUS.EXECUTED}
                  />
                ) : null}
              </div>
            </Card>
          ) : null}

          {/* Nguyên tắc bốn mắt: giải thích vì sao không thấy nút duyệt */}
          {status === TRADE_STATUS.PENDING_APPROVAL &&
          isOwn &&
          user.permissions.has('transaction.approve') ? (
            <Card className="border-warn-500/30 bg-warn-500/5 p-4">
              <p className="text-xs leading-relaxed text-warn-500">
                Bạn có quyền duyệt nhưng đây là lệnh do chính bạn nhập. Theo nguyên tắc bốn mắt,
                người khác phải duyệt.
              </p>
            </Card>
          ) : null}

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-strong">Trách nhiệm</h2>
            <dl className="space-y-2 text-xs">
              <Row label="Người thực hiện">{trade.executor.fullName}</Row>
              <Row label="Nhóm">{trade.team?.nameVi ?? '—'}</Row>
              {/*
                TÀI KHOẢN THỰC HIỆN. Dấu "—" ở đây KHÔNG phải thiếu dữ liệu mà là lệnh
                có TRƯỚC khi hệ thống có khái niệm tài khoản; gán bừa một tài khoản cho
                chúng là bịa. Lệnh nhập mới luôn có.
              */}
              <Row label="Tài khoản">
                {trade.brokerAccount ? (
                  <span className="text-right">
                    <span className="block">
                      {trade.brokerAccount.broker === BROKER.OTHER
                        ? (trade.brokerAccount.brokerOther ?? 'Khác')
                        : (BROKER_LABEL_VI[trade.brokerAccount.broker as Broker] ??
                          trade.brokerAccount.broker)}{' '}
                      <span className="font-mono text-slate-soft">
                        {trade.brokerAccount.accountNo}
                      </span>
                    </span>
                    {trade.brokerAccount.ib ? (
                      <span className="block text-tiny text-ink-500">
                        IB {trade.brokerAccount.ib.code} · {trade.brokerAccount.ib.name}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-ink-500" title="Lệnh có trước khi hệ thống có tài khoản chứng khoán">
                    —
                  </span>
                )}
              </Row>
              <Row label="Người nhập">{trade.createdBy.fullName}</Row>
              {trade.updatedBy ? <Row label="Sửa lần cuối">{trade.updatedBy.fullName}</Row> : null}
              {trade.approvedBy ? (
                <Row label="Người duyệt">{trade.approvedBy.fullName}</Row>
              ) : null}
              {trade.approvedAt ? (
                <Row label="Duyệt lúc">
                  <span className="tabular">
                    {trade.approvedAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                  </span>
                </Row>
              ) : null}
              {trade.cancelledBy ? (
                <Row label="Người huỷ">{trade.cancelledBy.fullName}</Row>
              ) : null}
              <Row label="Phiên bản">
                <span className="tabular">v{trade.version}</span>
              </Row>
              <Row label="Tạo lúc">
                <span className="tabular">
                  {trade.createdAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                </span>
              </Row>
            </dl>
          </Card>

          {approvals.length > 0 ? (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-strong">Đề nghị duyệt</h2>
              <ul className="space-y-3">
                {approvals.map((a) => (
                  <li key={a.id} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded px-1.5 py-px font-mono text-micro ${
                          a.status === 'APPROVED'
                            ? 'bg-up-500/15 text-up-500'
                            : a.status === 'REJECTED'
                              ? 'bg-down-500/15 text-down-500'
                              : a.status === 'PENDING'
                                ? 'bg-warn-500/15 text-warn-500'
                                : 'bg-ink-800 text-slate-muted'
                        }`}
                      >
                        {a.status}
                      </span>
                      <span className="tabular text-slate-muted">
                        {a.requestedAt.toLocaleString('vi-VN', {
                          timeZone: 'Asia/Ho_Chi_Minh',
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-soft">
                      {a.requestedBy.fullName} đề nghị
                      {a.decidedBy ? ` · ${a.decidedBy.fullName} xử lý` : ''}
                    </p>
                    {a.reason ? <p className="mt-0.5 text-ink-500">{a.reason}</p> : null}
                    {a.comment ? (
                      <p className="mt-0.5 text-slate-muted">Ý kiến: {a.comment}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-slate-muted">{label}</dt>
      <dd className="text-right text-slate-soft">{children}</dd>
    </div>
  );
}

function KeyValues({
  data,
  changed,
}: {
  data: Record<string, unknown>;
  changed: string[] | null;
}) {
  return (
    <dl className="space-y-0.5">
      {Object.entries(data).map(([key, value]) => {
        const isChanged = changed?.includes(key);
        return (
          <div key={key} className="flex gap-2">
            <dt className={`shrink-0 ${isChanged ? 'text-warn-500' : 'text-slate-muted'}`}>
              {key}
            </dt>
            <dd
              className={`tabular min-w-0 break-all ${
                isChanged ? 'font-medium text-strong' : 'text-slate-soft'
              }`}
            >
              {formatValue(value)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return `${value.length} mục`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
