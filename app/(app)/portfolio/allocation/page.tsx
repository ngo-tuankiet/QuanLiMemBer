import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { getDict } from '@/i18n';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Change, Money, MoneyCompact, Weight } from '@/components/money';
import {
  Donut,
  DonutLegend,
  foldSlices,
  seriesColor,
  type DonutSlice,
} from '@/components/charts';
import { dataScope } from '@/domain/permissions';
import { applyScope, computePortfolioSummary, type EngineFilter } from '@/domain/portfolio-engine';
import { formatBps, formatCompactVnd } from '@/lib/money';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.nav.allocation };
}

/**
 * Phân bổ danh mục (§14, §15, §16) — Phase 06.
 *
 * Ba cách nhìn cùng một khối vốn, mỗi cách một biểu đồ tròn kèm chú giải có SỐ
 * LIỆU CHÍNH XÁC. Chú giải không phải trang trí: một số slot màu nằm dưới 3:1 trên
 * nền sáng, nên màu không được là kênh thông tin duy nhất.
 *
 * Biểu đồ tròn chỉ để đọc "phần trên tổng thể ở mức tổng quan". Khi cần so sánh
 * các giá trị gần nhau thì con số trong chú giải mới đáng tin — mắt so chiều dài
 * và so số chính xác hơn nhiều so với so diện tích cung tròn.
 */
export default async function AllocationPage() {
  const user = await requirePagePermission('portfolio.view');
  const { t } = await getDict();

  const portfolio = await prisma.portfolio.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, maxStockWeightBps: true, maxSectorWeightBps: true },
  });

  if (!portfolio) {
    return (
      <>
        <PageHeader title={t.nav.allocation} />
        <Card>
          <EmptyState title="Chưa có danh mục nào" />
        </Card>
      </>
    );
  }

  const scope = dataScope(user.permissions, 'portfolio');
  const filter: EngineFilter & { portfolioId: string } = {
    ...applyScope({ portfolioId: portfolio.id }, scope, user.teamId),
    portfolioId: portfolio.id,
  };

  const [summary, thresholds] = await Promise.all([
    computePortfolioSummary(filter),
    prisma.systemSetting.findMany({
      where: { key: { in: ['risk.max_stock_weight_bps', 'risk.max_sector_weight_bps'] } },
    }),
  ]);

  const settingMap = new Map(thresholds.map((s) => [s.key, Number(s.value)]));
  const maxStockBps = portfolio.maxStockWeightBps ?? settingMap.get('risk.max_stock_weight_bps') ?? 1000;
  const maxSectorBps =
    portfolio.maxSectorWeightBps ?? settingMap.get('risk.max_sector_weight_bps') ?? 2500;

  const open = summary.positions.filter((p) => p.quantity > 0);
  const overweightStocks = open.filter((p) => p.weightBps > maxStockBps);
  const overweightSectors = summary.sectorExposure.filter((s) => s.weightBps > maxSectorBps);

  /* ------------------------------------------------------------------
     §14 Capital Allocation — ba phần cố định, dùng ba slot màu đầu.
     Ba slot đầu là bộ duy nhất đã kiểm chứng an toàn cho MỌI cặp, phù hợp
     với biểu đồ tròn nơi bất kỳ hai phần nào cũng có thể bị so trực tiếp.
     ------------------------------------------------------------------ */
  const capitalSlices: DonutSlice[] = [
    {
      key: 'invested',
      label: 'Đang đầu tư',
      value: summary.investedValue,
      bps: summary.allocation.investedBps,
      color: seriesColor(0),
    },
    {
      key: 'cash',
      label: 'Tiền khả dụng',
      value: summary.cash.availableCash,
      bps: summary.allocation.cashBps,
      color: seriesColor(1),
    },
    {
      key: 'reserve',
      label: 'Quỹ dự phòng',
      value: summary.cash.reserveAmount,
      bps: summary.allocation.reserveBps,
      color: seriesColor(2),
    },
  ];

  // §16 — màu theo colorIndex của chính chiến lược, không theo thứ hạng.
  const strategySlices: DonutSlice[] = summary.strategyAllocation.map((s) => ({
    key: s.strategyId,
    label: s.nameVi,
    value: s.netCapital,
    bps: s.weightBps,
    color: seriesColor(s.colorIndex),
  }));

  // §15 — gộp phần dư thành "Khác" để không bao giờ vượt số slot màu.
  const sectorSlices = foldSlices(
    summary.sectorExposure.map((s) => ({
      key: s.sectorId,
      label: s.nameVi,
      value: s.marketValue,
      bps: s.weightBps,
      color: seriesColor(s.colorIndex),
    })),
  );

  return (
    <>
      <div className="mb-4">
        <Link href="/portfolio" className="text-xs text-slate-muted hover:text-slate-soft">
          ← Portfolio
        </Link>
      </div>

      <PageHeader
        title={t.nav.allocation}
        subtitle="Ba cách nhìn cùng một khối vốn: theo loại tài sản, theo chiến lược, theo ngành."
      />

      {/* Vượt ngưỡng tỷ trọng — tiền đề của Risk Engine ở Phase 09 */}
      {overweightStocks.length > 0 || overweightSectors.length > 0 ? (
        <Card className="mb-4 border-warn-500/30 bg-warn-500/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-warn-500">
            <span aria-hidden>⚠</span> Vượt ngưỡng tỷ trọng
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-soft">
            {overweightStocks.map((p) => (
              <li key={p.stockId}>
                <span className="font-mono">{p.symbol}</span> chiếm{' '}
                <Weight bps={p.weightBps} /> — ngưỡng một mã là <Weight bps={maxStockBps} />
              </li>
            ))}
            {overweightSectors.map((s) => (
              <li key={s.sectorId}>
                {s.nameVi} chiếm <Weight bps={s.weightBps} /> — ngưỡng một ngành là{' '}
                <Weight bps={maxSectorBps} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* -------------------------------------------------------------- */}
      {/* §14 + §16 — hai biểu đồ tròn cạnh nhau                         */}
      {/* -------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-strong">{t.page.capitalAllocation}</h2>
          <p className="mt-0.5 mb-4 text-xs text-slate-muted">
            Ba phần cộng lại bằng 100% giá trị danh mục.
          </p>

          <div className="flex flex-wrap items-center gap-6">
            <Donut
              slices={capitalSlices}
              centerValue={formatCompactVnd(summary.portfolioValue)}
              centerLabel="tổng danh mục"
            />
            <DonutLegend slices={capitalSlices} className="min-w-52 flex-1" />
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-strong">{t.dash.strategyAllocation}</h2>
          <p className="mt-0.5 mb-4 text-xs text-slate-muted">
            Vốn ròng đang triển khai — mua cộng, bán trừ, không đếm trùng.
          </p>

          {strategySlices.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-muted">Chưa có giao dịch nào.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-6">
                <Donut
                  slices={strategySlices}
                  centerValue={String(summary.strategyAllocation.length)}
                  centerLabel="chiến lược"
                />
                <DonutLegend slices={strategySlices} className="min-w-52 flex-1" />
              </div>

              {/* Cảnh báo vượt hạn mức: icon + nhãn, không bao giờ chỉ dựa vào màu */}
              {summary.strategyAllocation.some((s) => s.overLimit) ? (
                <ul className="mt-4 space-y-1 border-t border-ink-800 pt-3">
                  {summary.strategyAllocation
                    .filter((s) => s.overLimit)
                    .map((s) => (
                      <li key={s.strategyId} className="flex items-center gap-2 text-xs text-warn-500">
                        <span aria-hidden>⚠</span>
                        {s.nameVi} chiếm {formatBps(s.weightBps, false)} — vượt hạn mức{' '}
                        {formatBps(s.maxAllocationBps ?? 0, false)}
                      </li>
                    ))}
                </ul>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-ink-800 pt-3">
                {summary.strategyAllocation.map((s) => (
                  <Link
                    key={s.strategyId}
                    href={`/portfolio/positions?strategy=${s.strategyId}`}
                    className="text-xs text-accent-400 hover:text-accent-500"
                  >
                    Vị thế {s.nameVi} →
                  </Link>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* -------------------------------------------------------------- */}
      {/* §15 Sector Exposure — biểu đồ tròn + drill-down xuống mã        */}
      {/* -------------------------------------------------------------- */}
      <Card className="mt-4 p-5">
        <h2 className="text-sm font-semibold text-strong">{t.dash.sectorExposure}</h2>
        <p className="mt-0.5 mb-4 text-xs text-slate-muted">
          Bấm tên ngành để lọc vị thế, bấm mã để xem giao dịch.
        </p>

        {sectorSlices.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-muted">Chưa có vị thế nào.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-8">
              <Donut
                slices={sectorSlices}
                size={188}
                centerValue={String(summary.sectorExposure.length)}
                centerLabel="ngành"
              />
              <DonutLegend slices={sectorSlices} className="min-w-64 flex-1" />
            </div>

            {/* Drill-down §15: ngành → mã, kèm mức sinh lời của từng mã */}
            <div className="mt-6 space-y-3 border-t border-ink-800 pt-5">
              {summary.sectorExposure.map((s) => (
                <div key={s.sectorId} className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                  <Link
                    href={`/portfolio/positions?sector=${s.sectorId}`}
                    className="flex w-48 shrink-0 items-center gap-2 text-sm text-slate-soft hover:text-strong"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: seriesColor(s.colorIndex) }}
                      aria-hidden
                    />
                    <span className="truncate">{s.nameVi}</span>
                  </Link>

                  <div className="flex flex-wrap gap-1.5">
                    {s.symbols.map((symbol) => {
                      const pos = open.find((p) => p.symbol === symbol);
                      return (
                        <Link
                          key={symbol}
                          href={`/transactions?symbol=${symbol}`}
                          className="flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-tiny transition hover:border-ink-600"
                          title={pos?.companyName ?? symbol}
                        >
                          <span className="font-mono text-slate-soft">{symbol}</span>
                          {pos ? (
                            <>
                              <Weight bps={pos.weightBps} className="text-ink-500" />
                              <Change bps={pos.returnBps} />
                            </>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <p className="mt-4 text-xs text-slate-muted">
        Tổng giá vốn đang đầu tư{' '}
        <Money value={summary.investedCost} className="text-slate-soft" /> · lãi/lỗ chưa thực hiện{' '}
        <Money value={summary.unrealizedPnl} signed /> · giá trị thị trường{' '}
        <MoneyCompact value={summary.investedValue} className="text-slate-soft" />
      </p>
    </>
  );
}
