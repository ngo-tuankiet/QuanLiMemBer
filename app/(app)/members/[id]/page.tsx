import Link from 'next/link';
import { forbidden, notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader, RoleBadge, TradeStatusChip } from '@/components/ui';
import { AvgCost, Change, Money, MoneyCompact, Price, Quantity, Weight } from '@/components/money';
import { seriesColor } from '@/components/charts';
import { Icon } from '@/components/icons';
import { dataScope } from '@/domain/permissions';
import {
  computeAccountBalances,
  computePositions,
  computeStrategyAllocation,
  type EngineFilter,
} from '@/domain/portfolio-engine';
import { BrokerAccountsCard } from '@/components/BrokerAccountsCard';
import { StatCard } from '@/components/StatCard';
import { netAmount, ratioToBps } from '@/lib/money';
import { absoluteVi } from '@/lib/elapsed';
import {
  PORTFOLIO_STATUS,
  TRANSACTION_TYPE,
  type TradeStatus,
} from '@/lib/enums';

export const metadata: Metadata = { title: 'Chi tiết cá nhân' };

/**
 * CHI TIẾT MỘT CÁ NHÂN — mã, khối lượng, chiến lược, giá mua/bán.
 *
 * Trả lời câu hỏi mà trang Teams chỉ tóm tắt được: *người này đang giữ những mã
 * nào, bao nhiêu cổ, giá vốn bao nhiêu, theo chiến lược nào, và đã mua bán ở giá
 * nào*.
 *
 * MỌI SỐ TÍNH TỪ GIAO DỊCH CỦA CHÍNH NGƯỜI NÀY. `computePositions` được gọi với
 * `userId`, nên giá vốn trung bình ở đây là giá vốn của riêng họ trên chuỗi lệnh
 * của họ. Nếu hai người cùng mua MBB ở hai mức giá thì mỗi người có một giá vốn
 * khác nhau — và đó chính là con số cần khi đánh giá từng người. Giá vốn trung
 * bình toàn danh mục là một con số thứ ba, không phải trung bình của hai số kia.
 *
 * "NGƯỜI THỰC HIỆN" là `trades.userId`, không phải người nhập hay người duyệt.
 * Bảng `trades` giữ cả ba vì đó là ba việc khác nhau (§8 nguyên tắc bốn mắt).
 *
 * PHẠM VI XEM. Theo `dataScope(permissions, 'position')`:
 *   ALL     xem được mọi người.
 *   SCOPED  chỉ xem người CÙNG NHÓM, cộng thêm chính mình.
 *   NONE    không xem được ai, kể cả bản thân — trang trả 403.
 *
 * Chính mình luôn xem được (khi còn `position.view`): chặn một người xem kết quả
 * giao dịch của chính họ thì con số đó không còn dùng để làm việc được.
 */
export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requirePagePermission('user.view');
  const { id } = await params;

  const scope = dataScope(viewer.permissions, 'position');

  const person = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      fullName: true,
      email: true,
      employeeCode: true,
      status: true,
      lastLoginAt: true,
      role: { select: { code: true, nameVi: true } },
      department: { select: { nameVi: true } },
      team: { select: { id: true, code: true, nameVi: true } },
    },
  });

  if (!person) notFound();

  /*
   * Chốt phạm vi Ở ĐÂY, không dựa vào việc trang Members có hiện link hay không.
   * URL này gõ tay được — `/members/<id>` của bất kỳ ai.
   */
  const isSelf = person.id === viewer.id;
  const sameTeam = Boolean(viewer.teamId) && person.team?.id === viewer.teamId;
  if (scope === 'NONE' || (scope === 'SCOPED' && !isSelf && !sameTeam)) forbidden();

  const portfolio = await prisma.portfolio.findFirst({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  const filter: EngineFilter = { portfolioId: portfolio?.id, userId: person.id };

  const [positions, trades, strategyAllocation, accountBalances] = await Promise.all([
    portfolio ? computePositions(filter) : Promise.resolve([]),

    /*
     * Sổ giao dịch của người này. Lấy MỌI trạng thái, không chỉ EXECUTED: lệnh
     * đang chờ duyệt hay bị huỷ cũng là việc người này đã làm và cần thấy được.
     * Cột trạng thái nói rõ cái nào đã vào vị thế, cái nào chưa.
     */
    prisma.trade.findMany({
      where: { userId: person.id, ...(portfolio ? { portfolioId: portfolio.id } : {}) },
      orderBy: [{ executedAt: 'desc' }, { code: 'desc' }],
      take: 60,
      select: {
        id: true,
        code: true,
        transactionType: true,
        quantity: true,
        price: true,
        fees: true,
        tax: true,
        executedAt: true,
        status: true,
        stock: { select: { symbol: true, sector: { select: { sortOrder: true } } } },
        strategies: {
          orderBy: { allocationBps: 'desc' },
          select: {
            allocationBps: true,
            allocationAmount: true,
            strategy: { select: { nameVi: true, sortOrder: true } },
          },
        },
      },
    }),

    /*
     * Vốn theo chiến lược — DÙNG ENGINE, không tự tính ở trang.
     *
     * Bản trang tự tính đã sai đúng cùng một kiểu với bản engine cũ: nó lấy
     * `allocationAmount` của lệnh bán (TIỀN THU VỀ) trừ vào `allocationAmount` của
     * lệnh mua (GIÁ VỐN). Hai đại lượng khác nhau, nên hiệu số là lãi/lỗ đã thực hiện
     * chứ không phải vốn còn lại: một chiến lược đã bán hết 5.000 MBB vẫn hiện
     * 18,41% / ₫23,947M — đúng bằng khoản lỗ.
     *
     * Hai bản cùng một phép tính ở hai chỗ là hai cơ hội để sai khác nhau. Gọi engine
     * thì trang này và trang Chiến lược không thể nói hai điều về cùng một vị thế.
     */
    portfolio ? computeStrategyAllocation(filter) : Promise.resolve([]),

    /*
     * TIỀN CỦA NGƯỜI NÀY — cộng số dư các tài khoản chứng khoán của họ.
     *
     * Không lấy `computeCash` của danh mục: đó là tiền của CẢ danh mục, gồm cả vốn khai
     * ở cấp danh mục và tiền của người khác. Câu hỏi ở trang này là "người này còn bao
     * nhiêu tiền", và câu trả lời duy nhất đúng là Σ số dư các tài khoản của họ.
     *
     * Cũng KHÔNG trừ quỹ dự phòng: `portfolios.reserveAmount` là một cột của DANH MỤC.
     * Trừ nó vào từng người sẽ trừ cùng một khoản dự phòng cho mỗi thành viên.
     */
    portfolio ? computeAccountBalances(portfolio.id, person.id) : Promise.resolve([]),
  ]);

  const open = positions.filter((p) => p.quantity > 0);
  const investedCost = open.reduce((s, p) => s + p.totalCost, 0n);
  const marketValue = open.reduce((s, p) => s + p.marketValue, 0n);
  const unrealizedPnl = open.reduce((s, p) => s + p.unrealizedPnl, 0n);
  const realizedPnl = positions.reduce((s, p) => s + p.realizedPnl, 0n);
  const totalPnl = realizedPnl + unrealizedPnl;

  /*
   * BỐN Ô SỐ LIỆU GIỐNG TRANG DANH MỤC, đo trên phạm vi một người.
   *
   *   Portfolio Value   giá trị thị trường vị thế + tiền còn trong các tài khoản
   *   Invested Capital  giá vốn của vị thế đang mở
   *   Available Cash    Σ số dư các tài khoản chứng khoán của người này
   *   Total P&L         lãi/lỗ đã chốt + chưa chốt
   *
   * Cùng bốn thước đo, cùng thứ tự, cùng cách trình bày — mở Danh mục rồi bấm vào một
   * thành viên thì cùng một câu hỏi được trả lời ở cùng một vị trí, chỉ khác phạm vi.
   */
  const availableCash = accountBalances.reduce((s, a) => s + a.available, 0n);
  const memberPortfolioValue = marketValue + availableCash;


  /*
   * "Phương pháp đang dùng" = GIÁ VỐN CỦA PHẦN CÒN GIỮ theo từng chiến lược, lấy
   * nguyên từ engine. Chiến lược đã thoát sạch không còn nằm trong danh sách.
   */
  const strategyRows = strategyAllocation;
  const strategyTotal = strategyRows.reduce((s, r) => s + r.netCapital, 0n);

  return (
    <>
      <PageHeader
        title={person.fullName}
        subtitle={
          [
            person.role?.nameVi ?? 'chưa gán vai trò',
            person.team ? `nhóm ${person.team.nameVi}` : 'chưa thuộc nhóm',
            person.employeeCode ?? null,
            isSelf ? 'chính bạn' : null,
          ]
            .filter(Boolean)
            .join(' · ')
        }
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/members"
              className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-slate-soft transition hover:border-ink-600 hover:text-strong"
            >
              ← Thành viên
            </Link>
            {person.team ? (
              <Link
                href="/teams"
                className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-slate-soft transition hover:border-ink-600 hover:text-strong"
              >
                Nhóm {person.team.nameVi}
              </Link>
            ) : null}
          </div>
        }
      />

      {/* ---- Nhận dạng ---- */}
      <Card className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 p-4 text-xs">
        <span className="flex items-center gap-2">
          <RoleBadge roleCode={person.role?.code ?? null} />
        </span>
        <span className="text-slate-muted">{person.email}</span>
        {person.department ? (
          <span className="text-slate-muted">{person.department.nameVi}</span>
        ) : null}
        <span className="text-slate-muted">
          {person.status === 'ACTIVE' ? 'đang hoạt động' : person.status}
        </span>
        <span className="tabular ml-auto text-ink-500">
          đăng nhập cuối{' '}
          {person.lastLoginAt ? absoluteVi(person.lastLoginAt) : 'chưa từng'}
        </span>
      </Card>

      {/* ---- KPI ---- */}
      {/*
        CÙNG `StatCard` VỚI `/portfolio`. Hai hàng ô này nằm trong cùng một luồng đọc
        (mở Danh mục rồi bấm vào một thành viên), nên chúng phải giống nhau. Bản cũ có
        một hàm `Kpi` riêng ở cuối file và nó đã lệch: `text-xl` ở đây, `text-2xl` ở
        trang danh mục.
      */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Portfolio Value"
          value={<MoneyCompact value={memberPortfolioValue} className="text-strong" />}
          hint="giá trị vị thế + số dư tiền"
        />
        <StatCard
          label="Invested Capital"
          value={<MoneyCompact value={investedCost} className="text-strong" />}
          hint={
            <>
              <Weight bps={ratioToBps(investedCost, memberPortfolioValue)} className="text-xs" />
              {' · '}
              {open.length} mã đang giữ
            </>
          }
        />
        <StatCard
          label="Available Cash"
          value={<MoneyCompact value={availableCash} className="text-strong" />}
          hint={
            <>
              <Weight bps={ratioToBps(availableCash, memberPortfolioValue)} className="text-xs" />
              {' · '}
              {accountBalances.length} tài khoản
            </>
          }
        />
        <StatCard
          label="Total P&amp;L"
          value={<MoneyCompact value={totalPnl} signed />}
          /*
            Dòng phụ giữ luôn phần ĐÃ CHỐT / CHƯA CHỐT.

            Bốn nhãn mới không còn ô riêng cho hai con số đó, mà chúng không xuất hiện ở
            chỗ nào khác trên trang: bảng vị thế chỉ có lãi/lỗ chưa chốt của từng mã, còn
            phần đã chốt thì biến mất hoàn toàn. Bỏ hẳn là mất dữ liệu, nên nó xuống dòng
            phụ — nơi nó vẫn trả lời được câu "lỗ này đã hiện thực hoá bao nhiêu".
          */
          hint={
            <>
              <Change bps={ratioToBps(totalPnl, investedCost)} className="text-xs" />
              <span className="tabular mt-0.5 block text-tiny text-ink-500">
                chốt <MoneyCompact value={realizedPnl} signed /> · chưa{' '}
                <MoneyCompact value={unrealizedPnl} signed />
              </span>
            </>
          }
        />
      </div>

      {/*
        Cùng component với `/profile`. Ở đây `isSelf` quyết định có form hay không:
        trưởng nhóm xem được tài khoản của người trong nhóm nhưng không sửa.
      */}
      <BrokerAccountsCard userId={person.id} isSelf={isSelf} className="mb-4" />

      {/* ---- Phương pháp đang dùng ---- */}
      <Card className="mb-4 p-5">
        <div className="mb-3 flex items-baseline gap-2">
          <span className="text-accent-400">
            <Icon name="strategies" />
          </span>
          <h2 className="text-sm font-semibold text-strong">Phương pháp đang dùng</h2>
        </div>

        {strategyRows.length === 0 ? (
          <p className="text-xs text-ink-500">Chưa thực hiện giao dịch nào.</p>
        ) : (
          <ul className="space-y-2">
            {strategyRows.map((r) => (
              <li key={r.strategyId} className="flex items-center gap-3">
                <span className="w-40 shrink-0 text-xs text-slate-soft">{r.nameVi}</span>
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ink-800">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(1, ratioToBps(r.netCapital, strategyTotal) / 100)}%`,
                      backgroundColor: seriesColor(r.colorIndex),
                    }}
                  />
                </span>
                <span className="tabular w-14 shrink-0 text-right text-tiny text-slate-muted">
                  <Weight bps={ratioToBps(r.netCapital, strategyTotal)} />
                </span>
                <span className="tabular w-24 shrink-0 text-right text-xs text-slate-soft">
                  <MoneyCompact value={r.netCapital} />
                </span>
                <span className="tabular w-16 shrink-0 text-right text-tiny text-ink-500">
                  {r.tradeCount} lệnh
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-tiny text-ink-500">
          Số tiền là GIÁ VỐN của phần còn đang giữ, không phải tổng đã giao dịch — chiến
          lược đã bán hết không còn trong danh sách. Chiến lược là QUAN SÁT từ giao dịch,
          không phải phân công: theo §4 người dùng không có chiến lược gán sẵn, và một
          lệnh có thể chia cho nhiều chiến lược (§6).
        </p>
      </Card>

      {/* ---- Vị thế đang giữ ---- */}
      <Card className="mb-4 overflow-hidden">
        <div className="flex items-baseline justify-between border-b border-ink-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-strong">Vị thế đang giữ</h2>
          <p className="text-tiny text-slate-muted">
            Giá vốn tính riêng trên chuỗi lệnh của người này
          </p>
        </div>

        {open.length === 0 ? (
          <EmptyState title="Không còn giữ mã nào" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-ink-800 text-left text-xs text-slate-muted">
                  <Th>Mã</Th>
                  <Th>Ngành</Th>
                  <Th className="text-right">Khối lượng</Th>
                  <Th className="text-right">Giá vốn TB</Th>
                  <Th className="text-right">Giá hiện tại</Th>
                  <Th className="text-right">Giá vốn</Th>
                  <Th className="text-right">Giá trị TT</Th>
                  <Th className="text-right">Lãi/lỗ</Th>
                  <Th className="text-right">%</Th>
                </tr>
              </thead>
              <tbody>
                {open.map((p) => (
                  <tr key={p.stockId} className="border-b border-ink-800 last:border-0">
                    <Td>
                      <span className="flex items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-sm"
                          style={{ backgroundColor: seriesColor(p.sectorSortOrder) }}
                          aria-hidden
                        />
                        <span className="font-mono font-semibold text-strong">{p.symbol}</span>
                      </span>
                    </Td>
                    <Td className="text-xs text-slate-muted">{p.sectorNameVi}</Td>
                    <Td className="text-right">
                      <Quantity value={p.quantity} className="text-slate-soft" />
                    </Td>
                    <Td className="text-right">
                      <AvgCost micro={p.avgCostMicro} className="text-slate-soft" />
                    </Td>
                    <Td className="text-right">
                      {p.missingPrice ? (
                        <span
                          className="text-tiny text-warn-500"
                          title="Mã này chưa có giá trong bảng giá — giá trị thị trường chưa tính được"
                        >
                          thiếu giá
                        </span>
                      ) : (
                        <span className={p.isStale ? 'text-warn-500' : 'text-slate-soft'}>
                          <Price value={p.currentPrice} />
                        </span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <Money value={p.totalCost} className="text-slate-muted" />
                    </Td>
                    <Td className="text-right">
                      <Money value={p.marketValue} className="text-strong" />
                    </Td>
                    <Td className="text-right">
                      <Money value={p.unrealizedPnl} signed />
                    </Td>
                    <Td className="text-right">
                      <Change bps={p.returnBps} className="text-xs" />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---- Sổ giao dịch ---- */}
      <Card className="overflow-hidden">
        <div className="flex items-baseline justify-between border-b border-ink-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-strong">Giao dịch đã thực hiện</h2>
          <p className="text-tiny text-slate-muted">
            {trades.length >= 60 ? '60 lệnh gần nhất' : `${trades.length} lệnh`} · gồm cả lệnh
            chờ duyệt và đã huỷ
          </p>
        </div>

        {trades.length === 0 ? (
          <EmptyState title="Chưa có giao dịch nào" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead>
                <tr className="border-b border-ink-800 text-left text-xs text-slate-muted">
                  <Th>Ngày</Th>
                  <Th>Loại</Th>
                  <Th>Mã</Th>
                  <Th className="text-right">Khối lượng</Th>
                  <Th className="text-right">Giá</Th>
                  <Th className="text-right">Phí + thuế</Th>
                  <Th className="text-right">Tiền ròng</Th>
                  <Th>Phương pháp</Th>
                  <Th>Trạng thái</Th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const buy = t.transactionType === TRANSACTION_TYPE.BUY;
                  return (
                    <tr key={t.id} className="border-b border-ink-800 last:border-0">
                      <Td className="tabular text-xs text-slate-muted">
                        {t.executedAt.toLocaleDateString('vi-VN')}
                      </Td>
                      <Td>
                        <span
                          className={`text-xs font-semibold ${buy ? 'text-up-500' : 'text-down-500'}`}
                        >
                          {buy ? 'MUA' : 'BÁN'}
                        </span>
                      </Td>
                      <Td>
                        <Link
                          href={`/transactions/${t.id}`}
                          className="font-mono font-semibold text-strong transition hover:text-accent-400"
                        >
                          {t.stock.symbol}
                        </Link>
                      </Td>
                      <Td className="text-right">
                        <Quantity value={t.quantity} className="text-slate-soft" />
                      </Td>
                      <Td className="text-right">
                        {/* GIÁ KHỚP của chính lệnh này — đây là "giá mua/bán" */}
                        <Price value={t.price} className="text-strong" />
                      </Td>
                      <Td className="text-right">
                        <Money value={t.fees + t.tax} className="text-slate-muted" />
                      </Td>
                      <Td className="text-right">
                        <Money
                          value={netAmount(buy ? 'BUY' : 'SELL', t.quantity, t.price, t.fees, t.tax)}
                          className="text-slate-soft"
                        />
                      </Td>
                      <Td>
                        {/*
                          Phân bổ đa chiến lược của CHÍNH lệnh đó — phần cốt lõi của
                          §6. Hiện đủ mọi chiến lược kèm tỷ lệ, không chỉ cái lớn
                          nhất: tổng các tỷ lệ luôn đúng 100% và đó là điều đáng
                          kiểm bằng mắt.
                        */}
                        <span className="flex flex-wrap gap-1">
                          {t.strategies.map((a) => (
                            <span
                              key={a.strategy.nameVi}
                              className="flex items-baseline gap-1 rounded border border-ink-700 px-1.5 py-px text-micro"
                              title={`${a.strategy.nameVi} · ${(a.allocationBps / 100).toFixed(2)}%`}
                            >
                              <span
                                className="size-1.5 rounded-sm"
                                style={{ backgroundColor: seriesColor(a.strategy.sortOrder - 1) }}
                                aria-hidden
                              />
                              <span className="text-slate-soft">{a.strategy.nameVi}</span>
                              <span className="tabular text-slate-muted">
                                <Weight bps={a.allocationBps} />
                              </span>
                            </span>
                          ))}
                        </span>
                      </Td>
                      <Td>
                        <TradeStatusChip status={t.status as TradeStatus} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-tiny text-ink-500">
        Giá vốn trung bình ở đây tính riêng trên chuỗi lệnh của {person.fullName}. Hai người
        cùng mua một mã ở hai mức giá sẽ có hai giá vốn khác nhau — giá vốn toàn danh mục là
        một con số thứ ba, không phải trung bình của hai số kia.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 ${className}`}>{children}</td>;
}
