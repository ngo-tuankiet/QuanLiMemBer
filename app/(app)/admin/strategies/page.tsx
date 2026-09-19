import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Money, Weight } from '@/components/money';
import { seriesColor } from '@/components/charts';
import { computeStrategyAllocation } from '@/domain/portfolio-engine';
import { formatVnd } from '@/lib/money';
import { PORTFOLIO_STATUS } from '@/lib/enums';
import { StrategyForm, ToggleStrategyButton, type StrategyRow } from '@/components/StrategyForms';

export const metadata: Metadata = { title: 'Quản lý chiến lược' };

/**
 * QUẢN LÝ CHIẾN LƯỢC — danh sách chiến lược đầu tư (§6).
 *
 * TÁCH KHỎI `/strategies` VÌ HAI TRANG TRẢ LỜI HAI CÂU KHÁC NHAU. Trang Strategies hỏi
 * "chiến lược nào đang hiệu quả" — một bảng số liệu để đọc. Trang này hỏi "hệ thống có
 * những chiến lược nào" — một chỗ để sửa. Gộp lại thì người xem hiệu suất phải lướt qua
 * các nút sửa, còn người muốn thêm chiến lược phải tìm giữa các biểu đồ.
 *
 * VỐN HIỆN NGAY TRONG DANH SÁCH, không phải trang trí: nó là điều kiện đóng. Một chiến
 * lược còn vốn mà bị đóng sẽ biến mất khỏi mọi biểu đồ phân bổ trong khi tiền vẫn nằm đó
 * — nên con số phải nằm ngay cạnh cái nút bị khoá, không phải ở một trang khác.
 */
export default async function AdminStrategiesPage() {
  const user = await requirePagePermission('strategy.view');

  const [strategies, portfolios] = await Promise.all([
    prisma.strategy.findMany({
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        nameVi: true,
        description: true,
        colorHex: true,
        sortOrder: true,
        isActive: true,
        maxAllocationBps: true,
        _count: { select: { tradeStrategies: true } },
      },
    }),
    prisma.portfolio.findMany({
      where: { status: PORTFOLIO_STATUS.ACTIVE },
      select: { id: true },
    }),
  ]);

  /*
   * Vốn đang nằm trong từng chiến lược, cộng qua mọi danh mục đang hoạt động.
   *
   * Dùng `computeStrategyAllocation` chứ không đếm `trade_strategies`: con số cần ở đây
   * là GIÁ VỐN PHẦN CÒN GIỮ, và đó chính là con số quyết định chiến lược có đóng được
   * hay không. Đếm số lệnh sẽ chặn cả những chiến lược đã thoát sạch vị thế.
   */
  const vonTheoCL = new Map<string, bigint>();
  for (const p of portfolios) {
    for (const r of await computeStrategyAllocation({ portfolioId: p.id })) {
      vonTheoCL.set(r.strategyId, (vonTheoCL.get(r.strategyId) ?? 0n) + r.netCapital);
    }
  }

  const tongVon = [...vonTheoCL.values()].reduce((s, v) => s + v, 0n);

  const suaDuoc = user.permissions.has('strategy.update');
  const taoDuoc = user.permissions.has('strategy.create');

  const rows: StrategyRow[] = strategies.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    nameVi: s.nameVi,
    description: s.description,
    colorHex: s.colorHex,
    sortOrder: s.sortOrder,
    isActive: s.isActive,
    maxAllocationBps: s.maxAllocationBps,
    netCapital: (vonTheoCL.get(s.id) ?? 0n).toString(),
    tradeCount: s._count.tradeStrategies,
  }));

  const dangBat = rows.filter((r) => r.isActive).length;

  return (
    <>
      <PageHeader
        title="Quản lý chiến lược"
        subtitle={`${dangBat}/${rows.length} chiến lược đang bật · mọi thay đổi đều được ghi vào Audit Log`}
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 px-5 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-accent-400">
              <Icon name="strategies" />
            </span>
            <h2 className="text-sm font-semibold text-strong">Chiến lược</h2>
            <span className="text-tiny text-ink-500">
              vốn đang triển khai <Money value={tongVon} className="text-slate-soft" />
            </span>
          </div>
          {taoDuoc ? <StrategyForm /> : null}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Chưa có chiến lược nào"
            hint="Mỗi lệnh phải chia 100% cho ít nhất một chiến lược, nên cần tạo ít nhất một cái trước khi nhập lệnh."
          />
        ) : (
          <ul className="divide-y divide-ink-800">
            {rows.map((s) => {
              const von = BigInt(s.netCapital);
              const conVon = von !== 0n;

              const lyDoChan = conVon
                ? `Chưa đóng được: còn ${formatVnd(von)} vốn đang nằm trong chiến lược này. ` +
                  'Bán hết phần vị thế thuộc chiến lược đó trước khi đóng.'
                : null;

              return (
                <li key={s.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span
                          className="inline-block size-2 shrink-0 rounded-sm"
                          style={{ backgroundColor: s.colorHex ?? seriesColor(s.sortOrder - 1) }}
                          aria-hidden
                        />
                        <span className="text-sm font-medium text-strong">{s.nameVi}</span>
                        <span className="font-mono text-micro text-ink-500">{s.code}</span>
                        {!s.isActive ? (
                          <span className="rounded border border-ink-700 px-1.5 py-px text-micro text-slate-muted">
                            đã đóng
                          </span>
                        ) : null}
                      </div>

                      <p className="tabular mt-0.5 text-tiny text-slate-muted">
                        vốn <Money value={von} className="text-slate-soft" />
                        {' · '}
                        {s.tradeCount} lượt phân bổ
                        {' · '}
                        {s.maxAllocationBps != null ? (
                          <>
                            hạn mức <Weight bps={s.maxAllocationBps} className="text-slate-soft" />
                          </>
                        ) : (
                          'không đặt hạn mức'
                        )}
                        {' · thứ tự '}
                        {s.sortOrder}
                      </p>

                      {s.description ? (
                        <p className="mt-1 max-w-2xl text-tiny text-ink-500">{s.description}</p>
                      ) : null}
                    </div>

                    {suaDuoc ? (
                      <span className="flex shrink-0 items-start gap-1">
                        <StrategyForm strategy={s} />
                        <ToggleStrategyButton
                          strategyId={s.id}
                          isActive={s.isActive}
                          blockedReason={lyDoChan}
                        />
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="mt-3 text-tiny leading-relaxed text-ink-500">
        <span className="font-mono">Mã</span> không sửa được sau khi tạo — nó là khoá nối bản ghi
        này với dữ liệu chuẩn trong mã nguồn. Chiến lược không xoá được, chỉ đóng: phân bổ của
        các lệnh cũ trỏ về nó và sẽ mồ côi nếu nó biến mất. Chiến lược{' '}
        <span className="text-slate-soft">còn vốn thì chưa đóng được</span> — biểu đồ phân bổ chỉ
        vẽ chiến lược đang bật, nên đóng lúc còn vốn sẽ làm phần tiền đó biến mất khỏi mọi biểu đồ
        mà tổng vẫn trông hợp lý.
      </p>
    </>
  );
}
