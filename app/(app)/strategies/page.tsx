import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { MoneyCompact, Weight } from '@/components/money';
import { seriesColor } from '@/components/charts';
import { Icon } from '@/components/icons';
import { dataScope } from '@/domain/permissions';
import {
  applyScope,
  computeStrategyAllocation,
  computeStrategyBreakdown,
  type EngineFilter,
} from '@/domain/portfolio-engine';
import { formatVnd, ratioToBps } from '@/lib/money';

export const metadata: Metadata = { title: 'Strategies' };

/**
 * CHIẾN LƯỢC ĐẦU TƯ (§5, §16, §21) — mỗi chiến lược một thẻ.
 *
 * Trang này trả lời đúng một câu: **vốn đang chảy vào chiến lược nào, và cụ thể
 * vào những mã nào**. Vì Strategy thuộc Trade (§4), mọi số liệu đi qua bảng
 * `trade_strategies` — không có đường nào khác.
 *
 * DẠNG LƯỚI THAY VÌ DANH SÁCH DỌC. Năm chiến lược xếp thành lưới hai cột thì so
 * sánh được bằng một lần nhìn; xếp dọc thì phải cuộn và nhớ số của thẻ trước. Đây
 * là trang để SO SÁNH, không phải để đọc từng cái một.
 *
 * MỖI THẺ HIỆN PHÂN RÃ THEO MÃ, không phải danh sách giao dịch gần nhất. Câu hỏi
 * thật khi xem một chiến lược là "nó đang nằm ở những mã nào" — danh sách lệnh
 * theo thời gian trả lời câu khác, và nó ở sẵn sau một cú bấm.
 *
 * MÀU LẤY TỪ SLOT `--series-*`, KHÔNG dùng `strategy.colorHex` trong database.
 * `colorHex` là mã màu cứng (#2563eb) nên không đổi theo chế độ sáng/tối, và nó
 * lệch với màu chính chiến lược đó đang dùng ở biểu đồ tròn trên Dashboard. Một
 * chiến lược phải có đúng một màu trong toàn app; nguồn màu đó là `sortOrder`.
 */
export default async function StrategiesPage() {
  const user = await requirePagePermission('strategy.view');

  const portfolio = await prisma.portfolio.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  const scope = dataScope(user.permissions, 'portfolio');
  const filter: EngineFilter = portfolio
    ? applyScope({ portfolioId: portfolio.id }, scope, user.teamId)
    : {};

  const [strategies, allocation, breakdown] = await Promise.all([
    prisma.strategy.findMany({ orderBy: { sortOrder: 'asc' } }),

    portfolio ? computeStrategyAllocation(filter) : Promise.resolve([]),

    /*
     * Phân rã (chiến lược × mã) — LẤY TỪ ENGINE, cùng nguồn với tổng ở trên.
     *
     * Bản trước tự truy vấn `trade_strategies` rồi làm "Σ mua − Σ bán" trên
     * `allocationAmount`. Phép đó lấy TIỀN THU VỀ của lệnh bán trừ vào GIÁ VỐN của
     * lệnh mua, nên ra lãi/lỗ đã thực hiện chứ không phải vốn còn lại — và sau khi
     * engine được sửa, hai con số trên CÙNG một thẻ đến từ hai phép khác nhau: tổng
     * nói một đằng, danh sách mã cộng lại ra một nẻo.
     *
     * Dùng chung `computeStrategyBreakdown` thì Σ theo mã bằng đúng tổng theo định
     * nghĩa, và bộ lọc phạm vi cũng chỉ khai một lần nên không thể lệch nhau.
     */
    portfolio
      ? computeStrategyBreakdown(filter)
      : Promise.resolve(new Map<string, never>()),
  ]);

  const allocationById = new Map(allocation.map((a) => [a.strategyId, a]));
  const totalDeployed = allocation.reduce((s, a) => s + a.netCapital, 0n);

  // --- Thẻ từng chiến lược -------------------------------------------------

  const cards = strategies.map((strategy) => {
    const alloc = allocationById.get(strategy.id);
    const chiTiet = breakdown.get(strategy.id);

    /*
     * Engine đã sắp theo vốn giảm dần và đã bỏ mã bán hết (mã còn 0 CP không có giá
     * vốn nào để chia). Trang chỉ đổi tên trường cho khớp phần hiển thị bên dưới.
     */
    const symbols = (chiTiet?.symbols ?? []).map((x) => ({
      symbol: x.symbol,
      sectorSortOrder: x.sectorSortOrder,
      net: x.netCapital,
    }));

    const symbolTotal = chiTiet?.total ?? 0n;

    return {
      strategy,
      alloc,
      symbols,
      symbolTotal,
      lastAt: chiTiet?.lastTradeAt ?? null,
      // Slot màu theo `sortOrder` của chính chiến lược — cùng màu với biểu đồ
      // tròn Strategy Allocation trên Dashboard.
      color: seriesColor(strategy.sortOrder - 1),
    };
  });

  return (
    <>
      <PageHeader
        title="Strategies"
        subtitle={
          `${strategies.filter((s) => s.isActive).length} chiến lược đang dùng · ` +
          `vốn ròng đang triển khai ${formatVnd(totalDeployed)}` +
          (scope === 'ALL' ? '' : ` · phạm vi nhóm ${user.teamNameVi ?? 'chưa gán'}`)
        }
      />

      <Card className="mb-4 flex items-start gap-3 p-4">
        <span className="mt-0.5 text-accent-400">
          <Icon name="strategies" />
        </span>
        <p className="text-xs leading-relaxed text-slate-muted">
          <span className="text-slate-soft">
            Chiến lược thuộc giao dịch, không thuộc người dùng.
          </span>{' '}
          Một người có thể thực hiện lệnh cho nhiều chiến lược, và một lệnh có thể được phân bổ
          cho nhiều chiến lược cùng lúc. Vì vậy hệ thống không hỏi &quot;chiến lược của
          ai&quot; mà hỏi &quot;bao nhiêu vốn đã triển khai theo chiến lược nào&quot;.
        </p>
      </Card>

      {strategies.length === 0 ? (
        <Card>
          <EmptyState
            title="Chưa có chiến lược nào"
            hint="Chạy npm run db:seed để nạp 5 chiến lược theo đặc tả §5."
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {cards.map((card, index) => (
            <StrategyCard
              key={card.strategy.id}
              {...card}
              totalDeployed={totalDeployed}
              /*
               * Thẻ cuối chiếm cả hai cột khi số thẻ là số lẻ. Nếu không, nó nằm
               * một mình ở cột trái và để trống nửa dòng — mắt đọc thành "còn một
               * thẻ nữa chưa tải xong".
               */
              wide={index === cards.length - 1 && cards.length % 2 === 1}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Thẻ một chiến lược
// ---------------------------------------------------------------------------

type Alloc = {
  netCapital: bigint;
  weightBps: number;
  tradeCount: number;
  overLimit: boolean;
};

function StrategyCard({
  strategy,
  alloc,
  symbols,
  symbolTotal,
  lastAt,
  color,
  totalDeployed,
  wide,
}: {
  strategy: {
    id: string;
    code: string;
    nameVi: string;
    description: string | null;
    isActive: boolean;
    maxAllocationBps: number | null;
  };
  alloc: Alloc | undefined;
  symbols: { symbol: string; sectorSortOrder: number; net: bigint }[];
  symbolTotal: bigint;
  lastAt: Date | null;
  color: string;
  totalDeployed: bigint;
  wide: boolean;
}) {
  const netCapital = alloc?.netCapital ?? 0n;
  const weightBps = alloc?.weightBps ?? 0;

  /*
   * Chênh giữa con số lớn của thẻ và tổng các mã đang hiển thị.
   *
   * `netCapital` (từ engine) gồm MỌI mã, kể cả mã đã thoát hết hoặc bán vượt.
   * `symbolTotal` chỉ gồm mã còn net > 0. Hiệu số là phần đã rời khỏi chiến lược.
   */
  const residual = netCapital - symbolTotal;

  return (
    <Card
      className={`flex flex-col overflow-hidden ${wide ? 'xl:col-span-2' : ''} ${
        strategy.isActive ? '' : 'opacity-70'
      }`}
    >
      {/*
        Vạch màu ở lề trên thay vì lề trái: thẻ trong lưới hẹp hơn, vạch ngang
        chạy hết chiều rộng nên nhận ra màu chiến lược ngay cả khi thẻ bị cuộn
        chỉ còn thấy nửa trên.
      */}
      <div className="h-1 w-full shrink-0" style={{ backgroundColor: color }} aria-hidden />

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-strong">{strategy.nameVi}</h2>
            <span className="rounded bg-ink-850 px-1.5 py-px font-mono text-micro text-slate-muted">
              {strategy.code}
            </span>
            {!strategy.isActive ? (
              <span className="rounded border border-ink-600 px-1.5 py-px text-micro text-ink-500">
                không dùng
              </span>
            ) : null}
            {alloc?.overLimit ? (
              <span className="rounded bg-warn-500/15 px-1.5 py-px text-micro font-medium text-warn-500">
                vượt hạn mức
              </span>
            ) : null}
          </div>
          {strategy.description ? (
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-muted">
              {strategy.description}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 text-right">
          {/* Số lớn đứng một mình dùng chữ số tỷ lệ, không dùng đẳng khoảng */}
          <p className="hero-figure text-2xl font-semibold">
            <MoneyCompact value={netCapital} className="text-strong" />
          </p>
          <p className="tabular mt-0.5 text-xs text-slate-muted">
            <Weight bps={weightBps} /> · {alloc?.tradeCount ?? 0} lệnh
          </p>
        </div>
      </div>

      {/* Tỷ trọng trên tổng vốn đang triển khai */}
      <div className="px-5 pt-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(0.5, Number(ratioToBps(netCapital, totalDeployed)) / 100)}%`,
              backgroundColor: color,
            }}
            aria-hidden
          />
        </div>
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-3 text-tiny text-ink-500">
          {strategy.maxAllocationBps !== null ? (
            <span>
              hạn mức tối đa <Weight bps={strategy.maxAllocationBps} />
            </span>
          ) : (
            <span>không đặt hạn mức</span>
          )}
          {lastAt ? (
            <span className="tabular">
              lệnh gần nhất {lastAt.toLocaleDateString('vi-VN')}
            </span>
          ) : null}
        </p>
      </div>

      {/* ---- Phân rã theo mã ---- */}
      <div className="mt-4 flex-1 border-t border-ink-800 px-5 py-3.5">
        {symbols.length === 0 ? (
          <p className="text-xs text-ink-500">
            Chưa có mã nào đang được triển khai theo chiến lược này.
          </p>
        ) : (
          <>
            <p className="mb-2.5 text-tiny font-medium tracking-wide text-slate-muted">
              VỐN THEO MÃ · {symbols.length} mã
            </p>
            <ul className="space-y-1.5">
              {symbols.map((s) => {
                const shareBps = ratioToBps(s.net, symbolTotal);
                return (
                  <li key={s.symbol} className="flex items-center gap-3">
                    <Link
                      href={`/portfolio/positions?strategy=${strategy.id}`}
                      className="w-12 shrink-0 font-mono text-xs font-semibold text-strong transition hover:text-accent-400"
                      title={`Xem vị thế ${s.symbol} thuộc ${strategy.nameVi}`}
                    >
                      {s.symbol}
                    </Link>

                    {/*
                      Thanh mảnh 6px, đầu bo tròn, neo vào lề trái. Màu theo NGÀNH
                      của mã chứ không theo chiến lược: trong một thẻ mọi thanh
                      cùng màu chiến lược thì màu không mang thông tin gì, còn màu
                      ngành cho thấy ngay chiến lược này đang dồn vào ngành nào.
                    */}
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ink-800">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(1, shareBps / 100)}%`,
                          backgroundColor: seriesColor(s.sectorSortOrder),
                        }}
                      />
                    </span>

                    <span className="tabular w-11 shrink-0 text-right text-tiny text-slate-muted">
                      <Weight bps={shareBps} />
                    </span>
                    <span className="tabular w-20 shrink-0 text-right text-xs text-slate-soft">
                      <MoneyCompact value={s.net} />
                    </span>
                  </li>
                );
              })}

              {/*
                PHẦN DƯ — chỉ hiện khi tổng các mã KHÔNG bằng con số lớn của thẻ.

                Danh sách trên chỉ giữ mã còn đang triển khai (net > 0). Một mã đã
                thoát hết nằm ở net = 0, còn mã bán vượt phần mua cho net âm — cả
                hai đều thuộc con số lớn nhưng không phải "vốn đang triển khai" nên
                không đáng một dòng riêng có tên mã.

                Nhưng bỏ đi mà không nói thì cột tiền không cộng lại được, và người
                đọc sẽ tự đi tìm ₫X triệu đang thiếu. Nguyên tắc đã ghi trong
                docs/UI-CHARTS.md: mỗi phép chia nhỏ phải có phép kiểm cộng dồn;
                nếu chiều đó cho phép phần thừa thì phần thừa là MỘT DÒNG, không
                phải một trường hợp bị bỏ qua.

                Với dữ liệu hiện tại phần dư bằng 0 ở cả năm chiến lược, nên dòng
                này chưa xuất hiện — nó ở đây để ngày nó xuất hiện thì đúng, không
                phải để trang trí.
              */}
              {residual !== 0n ? (
                <li className="flex items-center gap-3 border-t border-ink-800 pt-1.5">
                  <span
                    className="w-12 shrink-0 text-tiny text-ink-500"
                    title="Phần thuộc chiến lược nhưng không còn là vốn đang triển khai"
                  >
                    đã thoát
                  </span>
                  <span className="h-1.5 min-w-0 flex-1 rounded-full bg-ink-850" aria-hidden />
                  <span className="w-11 shrink-0" />
                  <span className="tabular w-20 shrink-0 text-right text-xs text-slate-muted">
                    <MoneyCompact value={residual} signed />
                  </span>
                </li>
              ) : null}
            </ul>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-4 border-t border-ink-800 px-5 py-2.5 text-xs">
        <Link
          href={`/transactions?strategy=${strategy.id}`}
          className="text-accent-400 transition hover:underline"
        >
          Giao dịch →
        </Link>
        <Link
          href={`/portfolio/positions?strategy=${strategy.id}`}
          className="text-accent-400 transition hover:underline"
        >
          Vị thế →
        </Link>
      </div>
    </Card>
  );
}
