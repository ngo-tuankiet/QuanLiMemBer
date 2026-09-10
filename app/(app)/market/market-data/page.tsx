import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { getDict } from '@/i18n';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Change, Price } from '@/components/money';
import { getMarketDataStatus } from '@/domain/portfolio-engine';
import { ManualQuoteForm } from './ManualQuoteForm';
import { SyncPricesButton } from './SyncPricesButton';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.nav.marketData };
}

/**
 * Trạng thái dữ liệu thị trường (§10) — Phase 03.
 *
 * Đặc tả yêu cầu hệ thống phải **thể hiện trạng thái dữ liệu**, không im lặng khi
 * nguồn bị lỗi. Trang này đọc từ `market_data_syncs` và `market_quotes`.
 *
 * Market Data Service bằng Python gọi `vnstock` là Phase 07. Đến lúc đó, giá được
 * nhập thủ công và mọi dòng như vậy ghi `source = MANUAL` để không bị nhầm là dữ
 * liệu chính thức.
 */
export default async function MarketDataPage() {
  const user = await requirePagePermission('market_data.view');
  const { t } = await getDict();

  const [status, quotes, quoteTotal, manualTotal, syncs, missingCount, stocksWithoutQuote] =
    await Promise.all([
    getMarketDataStatus(),
    /*
      BẢNG chỉ hiện 100 dòng mới nhất. Đây là giới hạn của BẢNG, không phải của
      dữ liệu — nên mọi con số tổng phải đếm riêng, xem hai truy vấn ngay dưới.
    */
    prisma.marketQuote.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { stock: { select: { symbol: true, companyName: true, exchange: true } } },
    }),
    /*
      ĐẾM THẬT, KHÔNG DÙNG `quotes.length`.

      `quotes` đã bị `take: 100` cắt, nên độ dài của nó là "số dòng bảng đang hiện",
      không phải "số mã có giá". Hai con số đó trùng nhau khi hệ thống mới chỉ theo
      dõi 12 mã, và lệch ngay khi phạm vi lấy giá mở ra 101 mã — ô "Data Status" báo
      100 trong khi thực tế là 101. Một con số sai kiểu này trông y như số đúng.
    */
    prisma.marketQuote.count(),
    prisma.marketQuote.count({ where: { source: 'MANUAL' } }),
    prisma.marketDataSync.findMany({
      orderBy: { startedAt: 'desc' },
      take: 15,
      include: { triggeredByUser: { select: { fullName: true } } },
    }),
    /*
     * Chỉ đếm mã ĐÃ CÓ GIAO DỊCH mà thiếu giá.
     *
     * Đếm mọi mã ACTIVE thiếu giá là con số vô nghĩa: master data có 84 mã nhưng
     * danh mục chỉ nắm giữ hơn chục mã, và service cố tình chỉ lấy giá cho những
     * mã có giao dịch. Báo "72 mã thiếu giá" khi cả 72 mã đó đều không được nắm
     * giữ chỉ tạo báo động giả.
     */
    prisma.stock.count({ where: { status: 'ACTIVE', quote: null, trades: { some: {} } } }),
    prisma.stock.findMany({
      where: { status: 'ACTIVE', quote: null, trades: { some: {} } },
      select: { id: true, symbol: true, companyName: true },
      orderBy: { symbol: 'asc' },
      take: 40,
    }),
  ]);

  const canSync = user.permissions.has('market_data.sync');


  return (
    <>
      {/*
        NÚT CẬP NHẬT GIÁ đặt ở ĐẦU TRANG, cùng tầm mắt với ô "Market Data ● Delayed".

        Người vào trang này gần như luôn vì thấy chỉ báo "trễ N phút" trên thanh
        đầu. Câu hỏi trong đầu họ là "làm gì để hết trễ", nên câu trả lời phải nằm
        ngay cạnh chỗ báo trễ — không phải cuối trang, sau bảng giá.

        Gác bằng `market_data.sync`, không phải `market_data.view`: xem trạng thái
        và gọi nguồn ngoài là hai việc khác nhau. Quyền này hiện chỉ Admin có.
      */}
      <PageHeader
        title={t.nav.marketData}
        subtitle="Nguồn giá và nhật ký đồng bộ. Frontend không bao giờ gọi VNStock trực tiếp (§23)."
        actions={canSync ? <SyncPricesButton /> : undefined}
      />

      {/* -------------------------------------------------------------- */}
      {/* Ô trạng thái đúng theo §10                                     */}
      {/* -------------------------------------------------------------- */}
      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-slate-muted">{t.nav.marketData}</p>
          <p className="mt-1.5 flex items-center gap-2 text-sm font-medium">
            <span
              className={`size-2 rounded-full ${
                status.lastSuccessAt
                  ? status.connected
                    ? 'bg-up-500'
                    : 'bg-warn-500'
                  : 'bg-ink-500'
              }`}
            />
            <span
              className={
                status.lastSuccessAt
                  ? status.connected
                    ? 'text-up-500'
                    : 'text-warn-500'
                  : 'text-slate-muted'
              }
            >
              {status.lastSuccessAt
                ? status.connected
                  ? 'Connected'
                  : 'Delayed'
                : 'Chưa kết nối'}
            </span>
          </p>
          <p className="mt-1 text-tiny text-ink-500">
            {status.source ? `nguồn ${status.source}` : 'chưa có lần đồng bộ nào'}
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-slate-muted">{t.page.lastUpdated}</p>
          <p className="tabular mt-1.5 text-sm font-medium text-strong">
            {status.lastSuccessAt
              ? status.lastSuccessAt.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
              : '—'}
          </p>
          <p className="mt-1 text-tiny text-ink-500">
            {status.ageMinutes === null
              ? 'chưa có dữ liệu'
              : status.duringSession
                ? `${status.ageMinutes} phút trước · đang trong phiên, ngưỡng ${status.staleAfterMinutes} phút`
                : `${status.ageMinutes} phút trước · ngoài phiên nên đo theo phiên giao dịch, không theo phút`}
          </p>
        </Card>

        {/*
          PHIÊN GIAO DỊCH — thẻ này trả lời câu hỏi thật: giá đang lưu có phải của
          phiên gần nhất đã đóng không. Ngoài giờ giao dịch, đó mới là thước đo đúng.
        */}
        <Card className="p-4">
          <p className="text-xs text-slate-muted">Phiên giao dịch</p>
          <p className="tabular mt-1.5 text-sm font-medium text-strong">
            {status.quoteTradingDate
              ? status.quoteTradingDate.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
              : '—'}
          </p>
          <p className="mt-1 text-tiny text-ink-500">
            {status.sessionsBehind === 0
              ? `phiên gần nhất đã đóng · đang mới nhất`
              : `chậm ${status.sessionsBehind} phiên so với ${status.expectedSession.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`}
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-slate-muted">{t.page.dataStatus}</p>
          <p className="mt-1.5 text-sm font-medium">
            {missingCount === 0 ? (
              <span className="text-up-500">● Normal</span>
            ) : (
              <span className="text-warn-500">● Thiếu giá</span>
            )}
          </p>
          <p className="mt-1 text-tiny text-ink-500">
            {missingCount === 0
              ? `${quoteTotal} mã có giá · mọi mã đang nắm giữ đều có giá`
              : `${missingCount} mã đang nắm giữ chưa có giá`}
          </p>
        </Card>

        <Card className="p-4">
          <p className="text-xs text-slate-muted">Nguồn giá</p>
          <p className="tabular mt-1.5 text-sm font-medium text-strong">
            {quoteTotal - manualTotal} tự động · {manualTotal} thủ công
          </p>
          <p className="mt-1 text-tiny text-ink-500">
            {canSync ? 'bấm "Cập nhật giá" ở trên để lấy từ VNStock' : 'nguồn tự động: VNStock'}
          </p>
        </Card>
      </div>

      {/* Cảnh báo khi có mã đang giữ mà thiếu giá — giá trị danh mục sẽ bị thiếu */}
      {stocksWithoutQuote.length > 0 ? (
        <Card className="mb-5 border-warn-500/30 bg-warn-500/5 p-4">
          <p className="text-sm font-medium text-warn-500">
            {stocksWithoutQuote.length} mã đã có giao dịch nhưng chưa có giá
          </p>
          <p className="mt-1 text-xs text-slate-muted">
            Những mã này được tính giá trị thị trường bằng 0, nên {t.kpi.portfolioValue} và P&amp;L đang
            thiếu. Bấm “Cập nhật giá” ở đầu trang, hoặc nhập tay bên dưới.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {stocksWithoutQuote.map((s) => (
              <span
                key={s.id}
                className="rounded border border-warn-500/30 px-1.5 py-0.5 font-mono text-tiny text-warn-500"
                title={s.companyName}
              >
                {s.symbol}
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      {canSync ? (
        <Card className="mb-5 p-5">
          <h2 className="text-sm font-semibold text-strong">Nhập giá thủ công</h2>
          <p className="mt-0.5 mb-4 text-xs text-slate-muted">
            Phương án dự phòng khi VNStock không có mã đó, hoặc nguồn đang lỗi. Mọi dòng
            nhập tay được ghi <span className="font-mono">source = MANUAL</span> và có bản ghi
            {t.nav.auditLog} riêng, nên không bị nhầm là dữ liệu chính thức.
          </p>
          <ManualQuoteForm />
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ------------------------------------------------------------ */}
        {/* Bảng giá                                                     */}
        {/* ------------------------------------------------------------ */}
        <Card className="overflow-hidden">
          <div className="border-b border-ink-800 px-5 py-3">
            <h2 className="text-sm font-semibold text-strong">Giá mới nhất</h2>
            <p className="mt-0.5 text-xs text-slate-muted">
              Một dòng cho mỗi mã, luôn ghi đè — không tích lũy lịch sử ở bảng này.
              {quoteTotal > quotes.length
                ? ` Hiện ${quotes.length} mã mới cập nhật nhất trong ${quoteTotal} mã.`
                : ''}
            </p>
          </div>

          {quoteTotal === 0 ? (
            <EmptyState
              title="Chưa có giá nào"
              hint="Bấm &quot;Cập nhật giá&quot; ở đầu trang để lấy từ VNStock, hoặc nhập thủ công ở trên."
            />
          ) : (
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-ink-900">
                  <tr className="border-b border-ink-700 text-left text-xs text-slate-muted">
                    <th className="px-4 py-2.5 font-medium">Mã</th>
                    <th className="px-4 py-2.5 text-right font-medium">Giá</th>
                    <th className="px-4 py-2.5 text-right font-medium">+/-</th>
                    <th className="px-4 py-2.5 font-medium">Nguồn</th>
                    <th className="px-4 py-2.5 text-right font-medium">Cập nhật</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr
                      key={q.id}
                      className="border-b border-ink-800 last:border-0 hover:bg-ink-850/60"
                    >
                      <td className="px-4 py-2">
                        <span className="font-mono font-semibold text-strong">
                          {q.stock.symbol}
                        </span>
                        <span className="ml-2 text-xs text-slate-muted">{q.stock.exchange}</span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Price value={q.price} className="text-strong" />
                      </td>
                      <td className="px-4 py-2 text-right">
                        {q.changeBps !== null ? (
                          <Change bps={q.changeBps} />
                        ) : (
                          <span className="text-xs text-ink-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-1.5 py-px font-mono text-micro ${
                            q.source === 'MANUAL'
                              ? 'bg-warn-500/15 text-warn-500'
                              : q.source === 'SEED'
                                ? 'bg-ink-800 text-slate-muted'
                                : 'bg-up-500/15 text-up-500'
                          }`}
                        >
                          {q.source}
                        </span>
                        {q.isStale ? (
                          <span className="ml-1.5 text-micro text-warn-500">trễ</span>
                        ) : null}
                      </td>
                      <td className="tabular px-4 py-2 text-right text-xs text-slate-muted">
                        {q.fetchedAt.toLocaleString('vi-VN', {
                          timeZone: 'Asia/Ho_Chi_Minh',
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ------------------------------------------------------------ */}
        {/* Nhật ký đồng bộ                                              */}
        {/* ------------------------------------------------------------ */}
        <Card className="overflow-hidden">
          <div className="border-b border-ink-800 px-5 py-3">
            <h2 className="text-sm font-semibold text-strong">Nhật ký đồng bộ</h2>
            <p className="mt-0.5 text-xs text-slate-muted">
              Nguồn dữ liệu cho ô trạng thái ở trên.
            </p>
          </div>

          {syncs.length === 0 ? (
            <EmptyState title="Chưa có lần đồng bộ nào" />
          ) : (
            <ul className="divide-y divide-ink-800">
              {syncs.map((sync) => (
                <li key={sync.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded px-1.5 py-px font-mono text-micro font-medium ${
                        sync.status === 'SUCCESS'
                          ? 'bg-up-500/15 text-up-500'
                          : sync.status === 'FAILED'
                            ? 'bg-down-500/15 text-down-500'
                            : sync.status === 'PARTIAL'
                              ? 'bg-warn-500/15 text-warn-500'
                              : 'bg-ink-800 text-slate-muted'
                      }`}
                    >
                      {sync.status}
                    </span>
                    <span className="tabular text-tiny text-slate-muted">
                      {sync.startedAt.toLocaleString('vi-VN', {
                        timeZone: 'Asia/Ho_Chi_Minh',
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>

                  <p className="tabular mt-1.5 text-xs text-slate-soft">
                    {sync.kind} · {sync.symbolsUpdated}/{sync.symbolsRequested} mã
                    {sync.symbolsFailed > 0 ? (
                      <span className="text-down-500"> · {sync.symbolsFailed} lỗi</span>
                    ) : null}
                    {sync.durationMs !== null ? (
                      <span className="text-ink-500"> · {sync.durationMs}ms</span>
                    ) : null}
                  </p>

                  <p className="mt-0.5 text-tiny text-ink-500">
                    {sync.source} · {sync.triggeredBy}
                    {sync.triggeredByUser ? ` · ${sync.triggeredByUser.fullName}` : ''}
                  </p>

                  {sync.errorMessage ? (
                    <p className="mt-1 text-tiny text-down-500">{sync.errorMessage}</p>
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
