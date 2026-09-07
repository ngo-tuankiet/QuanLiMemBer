import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { StatCard } from '@/components/StatCard';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Change, Money, MoneyCompact, Price, Quantity, Weight, WeightBar } from '@/components/money';
import { AvgCost } from '@/components/money';
import { dataScope } from '@/domain/permissions';
import { computePortfolioSummary, applyScope, type EngineFilter } from '@/domain/portfolio-engine';

export const metadata: Metadata = { title: 'Portfolio' };

/**
 * Portfolio Overview (§21 Portfolio → Overview) — Phase 06.
 *
 * Mọi con số trên trang này được TÍNH RA từ giao dịch và giá thị trường, không có
 * bảng nào lưu sẵn. Đó là lý do trang luôn khớp với dữ liệu giao dịch thực tế.
 */
export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; strategy?: string; sector?: string }>;
}) {
  const user = await requirePagePermission('portfolio.view');
  const params = await searchParams;

  const portfolio = await prisma.portfolio.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (!portfolio) {
    return (
      <>
        <PageHeader title="Portfolio" />
        <Card>
          <EmptyState
            title="Chưa có danh mục nào"
            hint="Chạy npm run db:seed để tạo danh mục mặc định."
          />
        </Card>
      </>
    );
  }

  const scope = dataScope(user.permissions, 'portfolio');
  const baseFilter: EngineFilter & { portfolioId: string } = {
    portfolioId: portfolio.id,
    teamId: params.team,
    strategyId: params.strategy,
    sectorId: params.sector,
  };

  const filter = {
    ...applyScope(baseFilter, scope, user.teamId),
    portfolioId: portfolio.id,
  };

  const summary = await computePortfolioSummary(filter);
  const open = summary.positions.filter((p) => p.quantity > 0);
  const top = open.slice(0, 8);

  return (
    <>
      <PageHeader
        title="Portfolio Overview"
        subtitle={`${summary.portfolioName} · ${summary.positionCount} vị thế đang giữ`}
        actions={
          <div className="flex gap-2">
            <Link
              href="/portfolio/positions"
              className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-slate-soft transition hover:border-ink-500 hover:text-strong"
            >
              Positions
            </Link>
            <Link
              href="/portfolio/allocation"
              className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-slate-soft transition hover:border-ink-500 hover:text-strong"
            >
              Allocation
            </Link>
          </div>
        }
      />

      {/* Cảnh báo khi có mã thiếu giá — số liệu bên dưới sẽ thiếu */}
      {summary.marketData.missingPriceCount > 0 ? (
        <Card className="mb-4 border-warn-500/30 bg-warn-500/5 p-4">
          <p className="text-sm font-medium text-warn-500">
            {summary.marketData.missingPriceCount} mã đang giữ chưa có giá thị trường
          </p>
          <p className="mt-1 text-xs text-slate-muted">
            Giá trị thị trường của những mã này được tính là 0, nên Portfolio Value và P&amp;L đang
            thiếu.{' '}
            <Link href="/market/market-data" className="text-accent-400 hover:text-accent-500">
              Nhập giá tại Market Data
            </Link>
            .
          </p>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* KPI §12                                                          */}
      {/* ---------------------------------------------------------------- */}
      {/* Cùng `StatCard` với `/members/[id]` — xem chú thích trong component. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Portfolio Value"
          value={<MoneyCompact value={summary.portfolioValue} className="text-strong" />}
          hint="giá trị vị thế + số dư tiền"
        />
        <StatCard
          label="Invested Capital"
          value={<MoneyCompact value={summary.investedValue} className="text-strong" />}
          hint={<Weight bps={summary.allocation.investedBps} className="text-xs" />}
        />
        <StatCard
          label="Available Cash"
          value={<MoneyCompact value={summary.cash.availableCash} className="text-strong" />}
          hint={<Weight bps={summary.allocation.cashBps} className="text-xs" />}
        />
        <StatCard
          label="Total P&amp;L"
          value={<MoneyCompact value={summary.totalPnl} signed />}
          hint={<Change bps={summary.totalPnlBps} className="text-xs" />}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ------------------------------------------------------------ */}
        {/* Top Positions §17                                            */}
        {/* ------------------------------------------------------------ */}
        <Card className="overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 border-b border-ink-800 px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold text-strong">Top Positions</h2>
              <p className="mt-0.5 text-xs text-slate-muted">
                Sắp theo giá trị thị trường
              </p>
            </div>
            <Link
              href="/portfolio/positions"
              className="text-xs text-accent-400 hover:text-accent-500"
            >
              Xem tất cả →
            </Link>
          </div>

          {top.length === 0 ? (
            <EmptyState
              title="Chưa có vị thế nào"
              hint="Nhập giao dịch mua để hình thành vị thế đầu tiên."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-700 text-left text-xs text-slate-muted">
                    <th className="px-4 py-2.5 font-medium">Mã</th>
                    <th className="px-4 py-2.5 text-right font-medium">KL</th>
                    <th className="px-4 py-2.5 text-right font-medium">Giá vốn TB</th>
                    <th className="px-4 py-2.5 text-right font-medium">Giá hiện tại</th>
                    <th className="px-4 py-2.5 text-right font-medium">Giá trị TT</th>
                    <th className="px-4 py-2.5 text-right font-medium">Lãi/Lỗ</th>
                    <th className="px-4 py-2.5 text-right font-medium">Return</th>
                    <th className="px-4 py-2.5 text-right font-medium">Tỷ trọng</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((p) => (
                    <tr
                      key={p.stockId}
                      className="border-b border-ink-800 last:border-0 hover:bg-ink-850/60"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/transactions?symbol=${p.symbol}`}
                          className="font-mono font-semibold text-strong hover:text-accent-400"
                          title={p.companyName}
                        >
                          {p.symbol}
                        </Link>
                        <span className="ml-2 text-tiny text-slate-muted">
                          {p.sectorNameVi}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Quantity value={p.quantity} className="text-slate-soft" />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <AvgCost micro={p.avgCostMicro} className="text-slate-soft" />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {p.missingPrice ? (
                          <span className="text-xs text-warn-500">thiếu giá</span>
                        ) : (
                          <Price value={p.currentPrice} className="text-strong" />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <MoneyCompact value={p.marketValue} className="text-strong" />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <MoneyCompact value={p.unrealizedPnl} signed />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Change bps={p.returnBps} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Weight bps={p.weightBps} className="text-slate-soft" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ------------------------------------------------------------ */}
        {/* Capital Allocation §14 + phân rã tiền                        */}
        {/* ------------------------------------------------------------ */}
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-strong">Capital Allocation</h2>
            <p className="mt-0.5 mb-4 text-xs text-slate-muted">
              Ba phần cộng lại bằng 100% giá trị danh mục.
            </p>

            <ul className="space-y-3">
              <AllocRow
                label="Đang đầu tư"
                bps={summary.allocation.investedBps}
                amount={summary.investedValue}
                color="var(--color-accent-500)"
              />
              <AllocRow
                label="Tiền khả dụng"
                bps={summary.allocation.cashBps}
                amount={summary.cash.availableCash}
                color="var(--color-up-500)"
              />
              <AllocRow
                label="Quỹ dự phòng"
                bps={summary.allocation.reserveBps}
                amount={summary.cash.reserveAmount}
                color="var(--color-warn-500)"
              />
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-strong">Nguồn vốn</h2>
            <dl className="mt-3 space-y-2 text-xs">
              <CashRow label="Vốn góp ròng" value={summary.cash.contributedCapital} />
              <CashRow label="Cổ tức, lãi, thu khác" value={summary.cash.otherFlows} />
              <CashRow label="Tiền chi mua" value={-summary.cash.spentOnBuys} />
              <CashRow label="Tiền thu bán" value={summary.cash.receivedFromSells} />
              <div className="flex items-baseline justify-between gap-3 border-t border-ink-800 pt-2">
                <dt className="font-medium text-strong">Số dư tiền</dt>
                <dd>
                  <Money value={summary.cash.cashBalance} className="text-strong" />
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-tiny leading-relaxed text-ink-500">
              Tiền của giao dịch không được ghi vào bảng dòng vốn — nó được suy ra từ chính các
              lệnh, nên không có nguy cơ đếm trùng.
            </p>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-strong">Lãi/lỗ</h2>
            <dl className="mt-3 space-y-2 text-xs">
              <CashRow label="Đã thực hiện" value={summary.realizedPnl} signed />
              <CashRow label="Chưa thực hiện" value={summary.unrealizedPnl} signed />
              <div className="flex items-baseline justify-between gap-3 border-t border-ink-800 pt-2">
                <dt className="font-medium text-strong">Tổng</dt>
                <dd>
                  <Money value={summary.totalPnl} signed className="font-semibold" />
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>

      {scope !== 'ALL' ? (
        <p className="mt-4 text-xs text-slate-muted">
          Bạn đang xem trong phạm vi nhóm của mình. Cần quyền{' '}
          <span className="font-mono">portfolio.view_all</span> để xem toàn danh mục.
        </p>
      ) : null}
    </>
  );
}

function AllocRow({
  label,
  bps,
  amount,
  color,
}: {
  label: string;
  bps: number;
  amount: bigint;
  color: string;
}) {
  return (
    <li>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm text-slate-soft">{label}</span>
        <span className="flex items-baseline gap-2.5">
          <Weight bps={bps} className="text-xs text-slate-muted" />
          <MoneyCompact value={amount} className="text-sm text-strong" />
        </span>
      </div>
      <WeightBar bps={bps} color={color} />
    </li>
  );
}

function CashRow({
  label,
  value,
  signed = false,
}: {
  label: string;
  value: bigint;
  signed?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-muted">{label}</dt>
      <dd>
        <Money value={value} signed={signed} className={signed ? '' : 'text-slate-soft'} />
      </dd>
    </div>
  );
}
