import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { getDict } from '@/i18n';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import {
  AvgCost,
  Change,
  Money,
  MoneyCompact,
  Price,
  Quantity,
  Weight,
} from '@/components/money';
import { dataScope } from '@/domain/permissions';
import { applyScope, computePositions, type EngineFilter, type PositionView } from '@/domain/portfolio-engine';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.nav.positions };
}

type SortKey = 'weight' | 'pnl' | 'return' | 'value' | 'sector' | 'symbol';

/**
 * Danh sách vị thế (§9, §17) — Phase 06.
 *
 * §17 yêu cầu sort được theo Weight / P&L / Return / Market Value / Sector. Sắp xếp
 * làm trên kết quả đã tính, không phải trong SQL, vì các cột này không tồn tại
 * trong database — chúng là giá trị suy ra.
 */
export default async function PositionsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: SortKey; strategy?: string; sector?: string; closed?: string }>;
}) {
  const user = await requirePagePermission('position.view');
  const { t } = await getDict();
  const params = await searchParams;

  const portfolio = await prisma.portfolio.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, nameVi: true },
  });

  if (!portfolio) {
    return (
      <>
        <PageHeader title={t.nav.positions} />
        <Card>
          <EmptyState title="Chưa có danh mục nào" />
        </Card>
      </>
    );
  }

  const scope = dataScope(user.permissions, 'position');
  const baseFilter: EngineFilter = {
    portfolioId: portfolio.id,
    strategyId: params.strategy,
    sectorId: params.sector,
  };

  const [allPositions, strategies, sectors] = await Promise.all([
    computePositions({ ...applyScope(baseFilter, scope, user.teamId), portfolioId: portfolio.id }),
    prisma.strategy.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, nameVi: true },
    }),
    prisma.sector.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, nameVi: true },
    }),
  ]);

  const showClosed = params.closed === '1';
  const positions = showClosed ? allPositions : allPositions.filter((p) => p.quantity > 0);
  const sorted = sortPositions(positions, params.sort ?? 'weight');
  const closedCount = allPositions.filter((p) => p.quantity === 0).length;

  const open = allPositions.filter((p) => p.quantity > 0);
  const totalValue = open.reduce((s, p) => s + p.marketValue, 0n);
  const totalCost = open.reduce((s, p) => s + p.totalCost, 0n);
  const totalUnrealized = open.reduce((s, p) => s + p.unrealizedPnl, 0n);
  const totalRealized = allPositions.reduce((s, p) => s + p.realizedPnl, 0n);

  const strategyName = params.strategy
    ? strategies.find((s) => s.id === params.strategy)?.nameVi
    : null;

  return (
    <>
      <div className="mb-4">
        <Link href="/portfolio" className="text-xs text-slate-muted hover:text-slate-soft">
          ← Portfolio
        </Link>
      </div>

      <PageHeader
        title={t.nav.positions}
        subtitle={`${open.length} vị thế đang giữ${closedCount > 0 ? ` · ${closedCount} đã đóng` : ''}`}
      />

      {/* Khi lọc theo chiến lược, số liệu là PHẦN vốn thuộc chiến lược đó */}
      {strategyName ? (
        <Card className="mb-4 border-accent-500/30 bg-accent-500/5 p-4">
          <p className="text-sm text-accent-400">
            Đang lọc theo chiến lược <span className="font-medium">{strategyName}</span>
          </p>
          <p className="mt-1 text-xs text-slate-muted">
            Khối lượng và số tiền hiển thị là <span className="text-slate-soft">phần</span> thuộc
            chiến lược này, tính theo tỷ lệ phân bổ của từng giao dịch — nên có thể không tròn lô.
            Đây là cách duy nhất để không đếm trùng vốn khi một lệnh thuộc nhiều chiến lược (§16).
          </p>
        </Card>
      ) : null}

      {/* Bộ lọc + sort §17 */}
      <Card className="mb-4 p-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="sort" className="field-label">
              Sắp xếp theo
            </label>
            <select id="sort" name="sort" defaultValue={params.sort ?? 'weight'} className="field">
              <option value="weight">Tỷ trọng</option>
              <option value="pnl">Lãi/Lỗ</option>
              <option value="return">{t.common.retPct}</option>
              <option value="value">Giá trị thị trường</option>
              <option value="sector">Ngành</option>
              <option value="symbol">Mã</option>
            </select>
          </div>

          <div>
            <label htmlFor="strategy" className="field-label">
              Chiến lược
            </label>
            <select id="strategy" name="strategy" defaultValue={params.strategy ?? ''} className="field">
              <option value="">Toàn danh mục</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameVi}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="sector" className="field-label">
              Ngành
            </label>
            <select id="sector" name="sector" defaultValue={params.sector ?? ''} className="field">
              <option value="">Tất cả</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameVi}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 pb-2.5 text-xs text-slate-soft">
            <input
              type="checkbox"
              name="closed"
              value="1"
              defaultChecked={showClosed}
              className="accent-accent-500"
            />
            Hiện vị thế đã đóng
          </label>

          <button
            type="submit"
            className="rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-500"
          >
            Áp dụng
          </button>
          <a
            href="/portfolio/positions"
            className="rounded-lg border border-ink-600 px-3.5 py-2 text-sm text-slate-soft transition hover:border-ink-500 hover:text-strong"
          >
            Xoá lọc
          </a>
        </form>
      </Card>

      <Card className="overflow-hidden">
        {sorted.length === 0 ? (
          <EmptyState
            title="Chưa có vị thế nào"
            hint="Vị thế được suy ra từ giao dịch đã khớp. Nhập lệnh mua để bắt đầu."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-left text-xs text-slate-muted">
                  <th className="px-4 py-2.5 font-medium">Mã</th>
                  <th className="px-4 py-2.5 font-medium">Ngành</th>
                  <th className="px-4 py-2.5 text-right font-medium">Khối lượng</th>
                  <th className="px-4 py-2.5 text-right font-medium">Giá vốn TB</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tổng giá vốn</th>
                  <th className="px-4 py-2.5 text-right font-medium">Giá hiện tại</th>
                  <th className="px-4 py-2.5 text-right font-medium">Giá trị TT</th>
                  <th className="px-4 py-2.5 text-right font-medium">Chưa thực hiện</th>
                  <th className="px-4 py-2.5 text-right font-medium">Đã thực hiện</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t.common.ret}</th>
                  <th className="px-4 py-2.5 text-right font-medium">Tỷ trọng</th>
                </tr>
              </thead>

              <tbody>
                {sorted.map((p) => (
                  <tr
                    key={p.stockId}
                    className={`border-b border-ink-800 last:border-0 hover:bg-ink-850/60 ${
                      p.quantity === 0 ? 'opacity-50' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/transactions?symbol=${p.symbol}`}
                        className="font-mono font-semibold text-strong hover:text-accent-400"
                        title={p.companyName}
                      >
                        {p.symbol}
                      </Link>
                      {p.quantity === 0 ? (
                        <span className="ml-2 rounded bg-ink-800 px-1.5 py-px text-micro text-ink-500">
                          đã đóng
                        </span>
                      ) : null}
                    </td>

                    <td className="px-4 py-2.5 text-xs">
                      {/*
                        Chấm màu + chữ mực thường, không tô màu chính chữ: màu ngành
                        lấy từ bảng phân loại, vốn chỉ được kiểm ở ngưỡng 3:1 dành cho
                        dấu vẽ. Dùng nó làm màu chữ là dùng sai thang.
                      */}
                      <span className="flex items-center gap-1.5">
                        <span
                          className="size-1.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: p.sectorColor ?? 'var(--ink-500)' }}
                          aria-hidden
                        />
                        <span className="text-slate-soft">{p.sectorNameVi}</span>
                      </span>
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      <Quantity value={p.quantity} className="text-slate-soft" />
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      {p.quantity > 0 ? (
                        <AvgCost micro={p.avgCostMicro} className="text-slate-soft" />
                      ) : (
                        <span className="text-xs text-ink-500">—</span>
                      )}
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      <MoneyCompact value={p.totalCost} className="text-slate-soft" />
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
                      {p.quantity > 0 ? (
                        <MoneyCompact value={p.unrealizedPnl} signed />
                      ) : (
                        <span className="text-xs text-ink-500">—</span>
                      )}
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      {p.realizedPnl !== 0n ? (
                        <MoneyCompact value={p.realizedPnl} signed />
                      ) : (
                        <span className="text-xs text-ink-500">—</span>
                      )}
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      {p.quantity > 0 ? (
                        <Change bps={p.returnBps} />
                      ) : (
                        <span className="text-xs text-ink-500">—</span>
                      )}
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      <Weight bps={p.weightBps} className="text-slate-soft" />
                    </td>
                  </tr>
                ))}
              </tbody>

              <tfoot>
                <tr className="border-t border-ink-700 bg-ink-850/50">
                  <td className="px-4 py-3 text-sm font-medium text-strong" colSpan={4}>
                    Tổng {open.length} vị thế đang giữ
                  </td>
                  <td className="px-4 py-3 text-right">
                    <MoneyCompact value={totalCost} className="font-medium text-slate-soft" />
                  </td>
                  <td />
                  <td className="px-4 py-3 text-right">
                    <MoneyCompact value={totalValue} className="font-semibold text-strong" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <MoneyCompact value={totalUnrealized} signed className="font-semibold" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <MoneyCompact value={totalRealized} signed className="font-semibold" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Change
                      bps={totalCost === 0n ? 0 : Number((totalUnrealized * 10_000n) / totalCost)}
                      className="font-semibold"
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-muted">100.00%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-muted">
        <span>
          Tổng lãi/lỗ:{' '}
          <Money value={totalRealized + totalUnrealized} signed className="font-medium" />
        </span>
        <span>
          Không có bảng nào lưu các con số này — tất cả tính từ giao dịch và giá thị trường.
        </span>
      </div>
    </>
  );
}

/** Sắp xếp §17. Làm trên kết quả đã tính vì các cột này không có trong database. */
function sortPositions(positions: PositionView[], key: SortKey): PositionView[] {
  const list = [...positions];

  switch (key) {
    case 'pnl':
      return list.sort((a, b) =>
        b.unrealizedPnl + b.realizedPnl > a.unrealizedPnl + a.realizedPnl ? 1 : -1,
      );
    case 'return':
      return list.sort((a, b) => b.returnBps - a.returnBps);
    case 'value':
      return list.sort((a, b) => (b.marketValue > a.marketValue ? 1 : -1));
    case 'sector':
      return list.sort(
        (a, b) =>
          a.sectorNameVi.localeCompare(b.sectorNameVi) ||
          (b.marketValue > a.marketValue ? 1 : -1),
      );
    case 'symbol':
      return list.sort((a, b) => a.symbol.localeCompare(b.symbol));
    case 'weight':
    default:
      return list.sort((a, b) => b.weightBps - a.weightBps);
  }
}
