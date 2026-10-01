import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { getDict } from '@/i18n';
import { prisma } from '@/lib/prisma';
import { dataScope } from '@/domain/permissions';
import {
  Card,
  EmptyState,
  PageHeader,
  TradeStatusChip,
  TradeTypeChip,
} from '@/components/ui';
import { Money, Price, Quantity, Weight } from '@/components/money';
import { netAmount } from '@/lib/money';
import {
  APPROVAL_STATUS,
  CAPITAL_FLOW_STATUS,
  CAPITAL_FLOW_TYPE,
  ENTITY_TYPE,
  TRADE_STATUS,
  BROKER,
  BROKER_LABEL_VI,
  type Broker,
  type TradeStatus,
} from '@/lib/enums';
import { WithdrawalDecision } from '@/components/WithdrawalDecision';
import { computeAccountBalances } from '@/domain/portfolio-engine';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.nav.approvals };
}

/**
 * Hàng chờ duyệt (§21 menu Approvals) — Phase 04.
 *
 * Nguyên tắc bốn mắt: lệnh do chính người đang xem nhập sẽ hiện nhưng không có nút
 * duyệt, kèm ghi chú giải thích. Ẩn hoàn toàn sẽ khiến người ta tưởng lệnh bị mất.
 */
export default async function ApprovalsPage() {
  const user = await requirePagePermission('approval.view');
  const { t } = await getDict();

  /*
   * HÀNG CHỜ DUYỆT PHẢI THEO PHẠM VI, giống mọi khối tiền khác.
   *
   * Trước đây truy vấn này không lọc gì: ai có `approval.view` cũng thấy lệnh chờ
   * duyệt của MỌI nhóm và MỌI danh mục. Không ai phát hiện vì chỉ Quản trị và Quản
   * lý cấp cao có quyền đó, mà cả hai đều có `transaction.view_all`.
   *
   * Vai trò "Quản lý nhóm" làm lỗ hổng lộ ra: nó có `approval.view` nhưng KHÔNG có
   * `view_all` nào, nên đúng ra chỉ được thấy nhóm mình — vậy mà lại thấy hết.
   */
  const scope = dataScope(user.permissions, 'transaction');
  const teamFilter =
    scope === 'ALL'
      ? {}
      : { teamId: user.teamId ?? '__no_team__' };

  /*
   * PHẠM VI CỦA VỐN TÍNH RIÊNG, không dùng lại `scope` của giao dịch.
   *
   * `dataScope(…, 'capital')` và `dataScope(…, 'transaction')` là hai câu hỏi khác
   * nhau và có thể trả lời khác nhau: một vai trò được xem lệnh của mọi nhóm nhưng chỉ
   * được xem vốn của nhóm mình là cấu hình hợp lệ. Dùng chung một biến là cho người
   * dùng thấy yêu cầu rút vốn của nhóm khác chỉ vì họ được xem lệnh của nhóm khác.
   */
  const capitalScope = dataScope(user.permissions, 'capital');
  const capitalTeamFilter =
    capitalScope === 'ALL' ? {} : { teamId: user.teamId ?? '__no_team__' };

  const [pendingTrades, decided, pendingWithdrawals] = await Promise.all([
    prisma.trade.findMany({
      where: { status: TRADE_STATUS.PENDING_APPROVAL, ...teamFilter },
      orderBy: { executedAt: 'asc' },
      include: {
        stock: { select: { symbol: true, companyName: true } },
        executor: { select: { id: true, fullName: true } },
        team: { select: { nameVi: true } },
        createdBy: { select: { id: true, fullName: true } },
        strategies: {
          include: { strategy: { select: { code: true, nameVi: true, colorHex: true } } },
          orderBy: { allocationBps: 'desc' },
        },
      },
    }),
    prisma.approvalRequest.findMany({
      where: { entityType: ENTITY_TYPE.TRADE, status: { not: APPROVAL_STATUS.PENDING } },
      orderBy: { decidedAt: 'desc' },
      take: 20,
      include: {
        requestedBy: { select: { fullName: true } },
        decidedBy: { select: { fullName: true } },
      },
    }),

    /*
     * YÊU CẦU RÚT VỐN ĐANG CHỜ.
     *
     * `capitalScope === NONE` thì không truy vấn gì: người không được xem vốn cũng
     * không được thấy ai đang xin rút bao nhiêu.
     */
    capitalScope === 'NONE'
      ? Promise.resolve([])
      : prisma.capitalFlow.findMany({
          where: {
            flowType: CAPITAL_FLOW_TYPE.WITHDRAWAL,
            status: CAPITAL_FLOW_STATUS.PENDING,
            ...capitalTeamFilter,
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            amount: true,
            occurredAt: true,
            createdAt: true,
            note: true,
            createdById: true,
            portfolioId: true,
            createdBy: { select: { id: true, fullName: true } },
            team: { select: { nameVi: true } },
            brokerAccount: {
              select: {
                id: true,
                broker: true,
                brokerOther: true,
                accountNo: true,
                userId: true,
                user: { select: { id: true, fullName: true } },
              },
            },
          },
        }),
  ]);

  /*
   * SỐ DƯ CỦA TỪNG TÀI KHOẢN LIÊN QUAN — người duyệt cần thấy trước khi đồng ý.
   *
   * "Rút 200 triệu" một mình không nói được gì; "rút 200 triệu trên 1 tỷ còn lại" thì
   * quyết định được. Đây cũng là con số mà `quyetDinhRut` kiểm lại lúc bấm duyệt, nên
   * người duyệt không bị từ chối bởi một con số họ chưa từng thấy.
   */
  const chuTaiKhoan = [
    ...new Set(pendingWithdrawals.map((w) => w.brokerAccount?.userId).filter(Boolean)),
  ] as string[];

  const soDuTheoTK = new Map<string, bigint>();
  for (const uid of chuTaiKhoan) {
    const pid = pendingWithdrawals.find((w) => w.brokerAccount?.userId === uid)?.portfolioId;
    if (!pid) continue;
    for (const b of await computeAccountBalances(pid, uid)) {
      soDuTheoTK.set(b.accountId, b.available);
    }
  }

  // Nạp thông tin lệnh cho phần đã xử lý.
  const decidedTradeIds = decided.map((d) => d.entityId);
  const decidedTrades = decidedTradeIds.length
    ? await prisma.trade.findMany({
        where: { id: { in: decidedTradeIds } },
        select: {
          id: true,
          code: true,
          status: true,
          transactionType: true,
          quantity: true,
          price: true,
          stock: { select: { symbol: true } },
        },
      })
    : [];
  const tradeById = new Map(decidedTrades.map((t) => [t.id, t]));

  const canDecide = user.permissions.has('transaction.approve');
  const canDecideCapital = user.permissions.has('capital.approve');

  return (
    <>
      <PageHeader
        title={t.nav.approvals}
        subtitle={
          [
            `${pendingTrades.length} giao dịch`,
            pendingWithdrawals.length > 0 ? `${pendingWithdrawals.length} yêu cầu rút vốn` : null,
          ]
            .filter(Boolean)
            .join(' · ') + ' đang chờ duyệt'
        }
      />

      {/* ---------------------------------------------------------------- */}
      {/* YÊU CẦU RÚT VỐN — đặt TRƯỚC giao dịch                            */}
      {/* ---------------------------------------------------------------- */}
      {/*
        Đặt trên đầu vì tiền ra khỏi hệ thống không đảo lại được, còn một lệnh giao
        dịch chờ duyệt thì vẫn có thể huỷ. Danh sách này thường rỗng, nên nó không
        đẩy phần giao dịch xuống trong ngày thường.
      */}
      {pendingWithdrawals.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-strong">
            Yêu cầu rút vốn{' '}
            <span className="font-normal text-slate-muted">
              — tiền ra khỏi hệ thống, cần cấp quản lý nhóm trở lên chấp nhận
            </span>
          </h2>

          <div className="space-y-3">
            {pendingWithdrawals.map((w) => {
              const tk = w.brokerAccount;
              const nhanSan =
                tk == null
                  ? 'cấp danh mục'
                  : tk.broker === BROKER.OTHER
                    ? (tk.brokerOther ?? 'Khác')
                    : (BROKER_LABEL_VI[tk.broker as Broker] ?? tk.broker);

              const conLai = tk ? soDuTheoTK.get(tk.id) : undefined;

              /*
               * "Của chính mình" gồm CẢ người gửi yêu cầu VÀ chủ tài khoản — hai người
               * này có thể khác nhau và cả hai đều hưởng lợi từ khoản tiền ra. Chốt thật
               * trong `quyetDinhRut` chặn đúng hai người đó.
               */
              const laCuaMinh = w.createdById === user.id || tk?.userId === user.id;

              return (
                <Card key={w.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2.5">
                        <Money value={w.amount} className="text-lg font-semibold text-down-500" />
                        <span className="text-xs text-slate-muted">
                          rút khỏi <span className="font-mono text-slate-soft">
                            {nhanSan}{tk ? ` · ${tk.accountNo}` : ''}
                          </span>
                        </span>
                        {w.team ? (
                          <span className="rounded-md border border-ink-700 px-1.5 py-0.5 text-tiny text-slate-muted">
                            {w.team.nameVi}
                          </span>
                        ) : null}
                      </div>

                      <p className="mt-1.5 text-xs text-slate-muted">
                        {tk?.user ? (
                          <>
                            Tài khoản của{' '}
                            <span className="text-slate-soft">{tk.user.fullName}</span>
                          </>
                        ) : null}
                        {tk?.user && tk.user.id !== w.createdBy.id ? (
                          <>
                            {' · gửi bởi '}
                            <span className="text-slate-soft">{w.createdBy.fullName}</span>
                          </>
                        ) : null}
                        {' · ngày rút '}
                        {w.occurredAt.toLocaleDateString('vi-VN')}
                      </p>

                      {/* Số dư là dữ kiện để quyết định, không phải trang trí. */}
                      {conLai !== undefined ? (
                        <p className="tabular mt-1 text-xs text-slate-muted">
                          Tài khoản còn <Money value={conLai} className="text-slate-soft" />
                          {conLai >= w.amount ? (
                            <span className="text-up-500">{' — đủ'}</span>
                          ) : (
                            <span className="text-down-500">
                              {' — KHÔNG đủ cho yêu cầu này'}
                            </span>
                          )}
                        </p>
                      ) : null}

                      {w.note ? (
                        <p className="mt-2 max-w-2xl rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-xs leading-relaxed text-slate-soft">
                          {w.note}
                        </p>
                      ) : null}
                    </div>

                    <div className="shrink-0">
                      {!canDecideCapital ? (
                        <p className="max-w-48 text-xs text-slate-muted">
                          Bạn không có quyền duyệt rút vốn.
                        </p>
                      ) : laCuaMinh ? (
                        <p className="max-w-48 rounded-lg border border-warn-500/30 bg-warn-500/5 px-3 py-2 text-xs leading-relaxed text-warn-500">
                          Yêu cầu của chính bạn — theo nguyên tắc bốn mắt, người khác phải
                          quyết định.
                        </p>
                      ) : (
                        <WithdrawalDecision flowId={w.id} />
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      {pendingTrades.length === 0 && pendingWithdrawals.length === 0 ? (
        <Card>
          <EmptyState
            title="Không có gì chờ duyệt"
            hint="Giao dịch vượt ngưỡng giá trị hoặc do người không có quyền duyệt nhập sẽ xuất hiện ở đây."
          />
        </Card>
      ) : pendingTrades.length === 0 ? null : (
        <div className="space-y-4">
          {pendingTrades.map((trade) => {
            const net = netAmount(
              trade.transactionType as 'BUY' | 'SELL',
              trade.quantity,
              trade.price,
              trade.fees,
              trade.tax,
            );
            const isOwn = trade.createdById === user.id || trade.userId === user.id;

            return (
              <Card key={trade.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <TradeTypeChip type={trade.transactionType} />
                      <span className="font-mono text-base font-semibold text-strong">
                        {trade.stock.symbol}
                      </span>
                      <Link
                        href={`/transactions/${trade.id}`}
                        className="font-mono text-xs text-accent-400 hover:text-accent-500"
                      >
                        {trade.code}
                      </Link>
                      <TradeStatusChip status={trade.status as TradeStatus} />
                    </div>

                    <p className="mt-1 truncate text-xs text-slate-muted">
                      {trade.stock.companyName}
                    </p>

                    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
                      <div className="flex gap-2">
                        <dt className="text-slate-muted">KL</dt>
                        <dd>
                          <Quantity value={trade.quantity} className="text-strong" />
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-slate-muted">Giá</dt>
                        <dd>
                          <Price value={trade.price} className="text-strong" />
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-slate-muted">
                          {trade.transactionType === 'BUY' ? 'Chi ra' : 'Thu về'}
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
                    </dl>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {trade.strategies.map((a) => (
                        <span
                          key={a.id}
                          className="rounded border px-1.5 py-0.5 text-tiny"
                          style={{
                            borderColor: `${a.strategy.colorHex ?? '#3d4a63'}55`,
                            color: a.strategy.colorHex ?? undefined,
                          }}
                          title={`${a.allocationAmount.toLocaleString('vi-VN')} ₫`}
                        >
                          {a.strategy.nameVi} <Weight bps={a.allocationBps} />
                        </span>
                      ))}
                    </div>

                    <p className="mt-3 text-xs text-slate-muted">
                      {trade.createdBy.fullName} nhập
                      {trade.team ? ` · ${trade.team.nameVi}` : ''} ·{' '}
                      <span className="tabular">
                        {trade.executedAt.toLocaleString('vi-VN')}
                      </span>
                    </p>

                    {trade.investmentThesis ? (
                      <p className="mt-2 max-w-2xl rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-xs leading-relaxed text-slate-soft">
                        {trade.investmentThesis}
                      </p>
                    ) : null}
                  </div>

                  <div className="shrink-0">
                    {!canDecide ? (
                      <p className="max-w-48 text-xs text-slate-muted">
                        Bạn không có quyền duyệt giao dịch.
                      </p>
                    ) : isOwn ? (
                      <p className="max-w-48 rounded-lg border border-warn-500/30 bg-warn-500/5 px-3 py-2 text-xs leading-relaxed text-warn-500">
                        Lệnh do chính bạn nhập — theo nguyên tắc bốn mắt, người khác phải duyệt.
                      </p>
                    ) : (
                      <Link
                        href={`/transactions/${trade.id}`}
                        className="inline-block rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-500"
                      >
                        Xem &amp; duyệt
                      </Link>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {decided.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-strong">Đã xử lý gần đây</h2>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-ink-800">
              {decided.map((a) => {
                const trade = tradeById.get(a.entityId);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <span
                      className={`rounded px-1.5 py-px font-mono text-micro font-medium ${
                        a.status === APPROVAL_STATUS.APPROVED
                          ? 'bg-up-500/15 text-up-500'
                          : a.status === APPROVAL_STATUS.REJECTED
                            ? 'bg-down-500/15 text-down-500'
                            : 'bg-ink-800 text-slate-muted'
                      }`}
                    >
                      {a.status}
                    </span>

                    {trade ? (
                      <Link
                        href={`/transactions/${trade.id}`}
                        className="font-mono text-xs text-accent-400 hover:text-accent-500"
                      >
                        {trade.code}
                      </Link>
                    ) : (
                      <span className="text-xs text-ink-500">giao dịch đã xoá</span>
                    )}

                    {trade ? (
                      <span className="text-sm text-slate-soft">
                        {trade.transactionType} {trade.stock.symbol}{' '}
                        <Quantity value={trade.quantity} className="text-xs text-slate-muted" />
                      </span>
                    ) : null}

                    <span className="ml-auto text-xs text-slate-muted">
                      {a.requestedBy.fullName} → {a.decidedBy?.fullName ?? '—'}
                    </span>

                    <span className="tabular text-xs text-ink-500">
                      {a.decidedAt?.toLocaleString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>

                    {a.comment ? (
                      <span className="w-full text-xs text-slate-muted">Ý kiến: {a.comment}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      ) : null}
    </>
  );
}
