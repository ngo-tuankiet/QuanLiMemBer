import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { getDict } from '@/i18n';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader, TradeStatusChip, TradeTypeChip } from '@/components/ui';
import { MoneyCompact, Price, Quantity, Weight } from '@/components/money';
import { dataScope } from '@/domain/permissions';
import { netAmount } from '@/lib/money';
import { TRADE_STATUS, TRADE_STATUS_LABEL_VI, TRANSACTION_TYPE, type TradeStatus } from '@/lib/enums';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.nav.transactions };
}

const PAGE_SIZE = 30;

/**
 * Danh sách giao dịch (§8, §21) — Phase 04.
 *
 * PHẠM VI DỮ LIỆU theo quyền: người có `transaction.view_all` xem toàn bộ; người
 * chỉ có `transaction.view` bị giới hạn vào nhóm của mình. Việc ép phạm vi làm ở
 * SERVER, không dựa vào giao diện ẩn lựa chọn — người dùng có thể sửa query string.
 */
export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    status?: string;
    symbol?: string;
    strategy?: string;
    team?: string;
    page?: string;
  }>;
}) {
  const user = await requirePagePermission('transaction.view');
  const { t } = await getDict();
  const params = await searchParams;

  const scope = dataScope(user.permissions, 'transaction');
  const page = Math.max(1, Number(params.page ?? '1') || 1);

  // Ép phạm vi trước, rồi mới áp bộ lọc người dùng chọn.
  const scopeWhere =
    scope === 'ALL'
      ? {}
      : { teamId: user.teamId ?? '__no_team__' };

  const where = {
    ...scopeWhere,
    ...(params.type ? { transactionType: params.type } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.symbol ? { stock: { symbol: params.symbol.toUpperCase() } } : {}),
    ...(params.strategy ? { strategies: { some: { strategyId: params.strategy } } } : {}),
    ...(scope === 'ALL' && params.team ? { teamId: params.team } : {}),
  };

  const [trades, total, strategies, teams, statusCounts] = await Promise.all([
    prisma.trade.findMany({
      where,
      orderBy: [{ executedAt: 'desc' }, { code: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        stock: { select: { symbol: true, companyName: true } },
        executor: { select: { fullName: true } },
        team: { select: { nameVi: true } },
        strategies: {
          include: { strategy: { select: { code: true, nameVi: true, colorHex: true } } },
          orderBy: { allocationBps: 'desc' },
        },
      },
    }),
    prisma.trade.count({ where }),
    prisma.strategy.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, nameVi: true },
    }),
    scope === 'ALL'
      ? prisma.team.findMany({ where: { isActive: true }, select: { id: true, nameVi: true } })
      : Promise.resolve([]),
    prisma.trade.groupBy({ by: ['status'], where: scopeWhere, _count: true }),
  ]);

  const canCreate = user.permissions.has('transaction.create');
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const countByStatus = new Map(statusCounts.map((s) => [s.status, s._count]));

  return (
    <>
      <PageHeader
        title={t.nav.transactions}
        subtitle={
          scope === 'ALL'
            ? `${total.toLocaleString('vi-VN')} giao dịch trên toàn hệ thống`
            : `${total.toLocaleString('vi-VN')} giao dịch của ${user.teamNameVi ?? 'nhóm bạn'}`
        }
        actions={
          canCreate ? (
            <Link
              href="/transactions/new"
              className="rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-500"
            >
              Nhập giao dịch
            </Link>
          ) : null
        }
      />

      {/* Lọc nhanh theo loại — khớp menu §21 (All / Buy / Sell) */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip label={`Tất cả (${total})`} href="/transactions" active={!params.type} />
        <Chip
          label={t.nav.buy}
          href="/transactions?type=BUY"
          active={params.type === TRANSACTION_TYPE.BUY}
          tone="up"
        />
        <Chip
          label={t.nav.sell}
          href="/transactions?type=SELL"
          active={params.type === TRANSACTION_TYPE.SELL}
          tone="down"
        />
        <span className="mx-1 w-px bg-ink-700" />
        {(
          [
            TRADE_STATUS.EXECUTED,
            TRADE_STATUS.PENDING_APPROVAL,
            TRADE_STATUS.DRAFT,
            TRADE_STATUS.REJECTED,
            TRADE_STATUS.CANCELLED,
          ] as TradeStatus[]
        ).map((s) =>
          countByStatus.get(s) ? (
            <Chip
              key={s}
              label={`${TRADE_STATUS_LABEL_VI[s]} (${countByStatus.get(s)})`}
              href={`/transactions?status=${s}`}
              active={params.status === s}
            />
          ) : null,
        )}
      </div>

      {/* Bộ lọc chi tiết */}
      <Card className="mb-4 p-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          {params.type ? <input type="hidden" name="type" value={params.type} /> : null}

          <div>
            <label htmlFor="symbol" className="field-label">
              Mã
            </label>
            <input
              id="symbol"
              name="symbol"
              defaultValue={params.symbol ?? ''}
              placeholder="MBB"
              className="field tabular w-28 font-mono"
            />
          </div>

          <div>
            <label htmlFor="strategy" className="field-label">
              Chiến lược
            </label>
            <select id="strategy" name="strategy" defaultValue={params.strategy ?? ''} className="field">
              <option value="">Tất cả</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameVi}
                </option>
              ))}
            </select>
          </div>

          {scope === 'ALL' && teams.length > 0 ? (
            <div>
              <label htmlFor="team" className="field-label">
                Nhóm
              </label>
              <select id="team" name="team" defaultValue={params.team ?? ''} className="field">
                <option value="">Tất cả</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nameVi}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label htmlFor="status" className="field-label">
              Trạng thái
            </label>
            <select id="status" name="status" defaultValue={params.status ?? ''} className="field">
              <option value="">Tất cả</option>
              {Object.entries(TRADE_STATUS_LABEL_VI).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-500"
          >
            Lọc
          </button>
          <Link
            href="/transactions"
            className="rounded-lg border border-ink-600 px-3.5 py-2 text-sm text-slate-soft transition hover:border-ink-500 hover:text-strong"
          >
            Xoá lọc
          </Link>
        </form>
      </Card>

      <Card className="overflow-hidden">
        {trades.length === 0 ? (
          <EmptyState
            title="Không có giao dịch nào"
            hint={
              canCreate
                ? 'Bấm "Nhập giao dịch" để tạo lệnh đầu tiên.'
                : 'Thử xoá bộ lọc, hoặc liên hệ quản trị viên nếu bạn cần xem thêm phạm vi.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-left text-xs text-slate-muted">
                  <th className="px-4 py-2.5 font-medium">Mã GD</th>
                  <th className="px-4 py-2.5 font-medium">Thời điểm</th>
                  <th className="px-4 py-2.5 font-medium">Loại</th>
                  <th className="px-4 py-2.5 font-medium">CK</th>
                  <th className="px-4 py-2.5 text-right font-medium">KL</th>
                  <th className="px-4 py-2.5 text-right font-medium">Giá</th>
                  <th className="px-4 py-2.5 text-right font-medium">Giá trị</th>
                  <th className="px-4 py-2.5 font-medium">Chiến lược</th>
                  <th className="px-4 py-2.5 font-medium">Người nhập</th>
                  <th className="px-4 py-2.5 font-medium">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const net = netAmount(
                    t.transactionType as 'BUY' | 'SELL',
                    t.quantity,
                    t.price,
                    t.fees,
                    t.tax,
                  );

                  return (
                    <tr
                      key={t.id}
                      className="border-b border-ink-800 last:border-0 hover:bg-ink-850/60"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/transactions/${t.id}`}
                          className="font-mono text-xs text-accent-400 hover:text-accent-500"
                        >
                          {t.code}
                        </Link>
                      </td>

                      <td className="tabular px-4 py-2.5 text-xs text-slate-muted">
                        {t.executedAt.toLocaleString('vi-VN', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>

                      <td className="px-4 py-2.5">
                        <TradeTypeChip type={t.transactionType} />
                      </td>

                      <td className="px-4 py-2.5">
                        <span className="font-mono font-semibold text-strong">
                          {t.stock.symbol}
                        </span>
                      </td>

                      <td className="px-4 py-2.5 text-right">
                        <Quantity value={t.quantity} className="text-slate-soft" />
                      </td>

                      <td className="px-4 py-2.5 text-right">
                        <Price value={t.price} className="text-slate-soft" />
                      </td>

                      <td className="px-4 py-2.5 text-right">
                        <MoneyCompact value={net} className="text-strong" />
                      </td>

                      {/* Phân bổ chiến lược — điểm khác biệt cốt lõi của hệ thống */}
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {t.strategies.map((a) => (
                            <span
                              key={a.id}
                              className="rounded border px-1.5 py-px text-micro"
                              style={{
                                borderColor: `${a.strategy.colorHex ?? '#3d4a63'}55`,
                                color: a.strategy.colorHex ?? undefined,
                              }}
                              title={`${a.strategy.nameVi} — ${a.allocationAmount.toLocaleString('vi-VN')} ₫`}
                            >
                              {a.strategy.code} <Weight bps={a.allocationBps} />
                            </span>
                          ))}
                        </div>
                      </td>

                      <td className="px-4 py-2.5 text-xs text-slate-muted">
                        {t.executor.fullName}
                        {t.team ? (
                          <span className="block text-tiny text-ink-500">{t.team.nameVi}</span>
                        ) : null}
                      </td>

                      <td className="px-4 py-2.5">
                        <TradeStatusChip status={t.status as TradeStatus} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm">
          <PageLink params={params} page={page - 1} disabled={page <= 1} label="← Trước" />
          <span className="tabular text-xs text-slate-muted">
            Trang {page} / {totalPages}
          </span>
          <PageLink params={params} page={page + 1} disabled={page >= totalPages} label={t.page.next} />
        </nav>
      ) : null}

      {scope !== 'ALL' ? (
        <p className="mt-4 text-xs text-slate-muted">
          Bạn đang xem trong phạm vi nhóm của mình. Cần quyền{' '}
          <span className="font-mono">transaction.view_all</span> để xem toàn hệ thống.
        </p>
      ) : null}
    </>
  );
}

function Chip({
  label,
  href,
  active,
  tone = 'neutral',
}: {
  label: string;
  href: string;
  active: boolean;
  tone?: 'neutral' | 'up' | 'down';
}) {
  const toneCls =
    tone === 'up' ? 'text-up-500/80' : tone === 'down' ? 'text-down-500/80' : 'text-slate-muted';
  return (
    <a
      href={href}
      className={`rounded-md border px-2.5 py-1 text-xs transition ${
        active
          ? 'border-accent-500/40 bg-accent-500/10 text-accent-400'
          : `border-ink-700 ${toneCls} hover:border-ink-600 hover:text-slate-soft`
      }`}
    >
      {label}
    </a>
  );
}

function PageLink({
  params,
  page,
  disabled,
  label,
}: {
  params: Record<string, string | undefined>;
  page: number;
  disabled: boolean;
  label: string;
}) {
  if (disabled) return <span className="cursor-not-allowed text-xs text-ink-500">{label}</span>;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v && k !== 'page') qs.set(k, v);
  }
  if (page > 1) qs.set('page', String(page));

  return (
    <a
      href={`/transactions${qs.toString() ? `?${qs}` : ''}`}
      className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-slate-soft transition hover:border-ink-600 hover:text-strong"
    >
      {label}
    </a>
  );
}
