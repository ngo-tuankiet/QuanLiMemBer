import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, PageHeader } from '@/components/ui';
import { formatVnd } from '@/lib/money';
import { COUNTED_TRADE_STATUS, TRANSACTION_TYPE } from '@/lib/enums';
import {
  TradeForm,
  type AccountOption,
  type HoldingOption,
  type StockOption,
  type StrategyOption,
} from './TradeForm';
import { computeAccountBalances, computeStrategyHoldings } from '@/domain/portfolio-engine';
import { BROKER, BROKER_LABEL_VI, type Broker } from '@/lib/enums';
import { ratesByAccount, defaultRates } from '@/trading/fee-rates';

export const metadata: Metadata = { title: 'Nhập giao dịch' };

/**
 * Nhập giao dịch mới (§8) — Phase 04/05.
 *
 * Trang tải sẵn danh mục mã chuẩn kèm **khối lượng đang giữ** của từng mã, để form
 * chặn được lệnh bán vượt số đang giữ ngay trên giao diện. Server vẫn kiểm tra lại.
 */
export default async function NewTradePage() {
  const user = await requirePagePermission('transaction.create');

  const portfolio = await prisma.portfolio.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, code: true, name: true, nameVi: true },
  });

  if (!portfolio) {
    return (
      <>
        <PageHeader title="Nhập giao dịch" />
        <Card className="p-8 text-center">
          <p className="text-sm text-slate-soft">Chưa có danh mục nào đang hoạt động.</p>
          <p className="mt-1 text-xs text-slate-muted">
            Chạy <span className="font-mono">npm run db:seed</span> để tạo danh mục mặc định.
          </p>
        </Card>
      </>
    );
  }

  const [stocks, strategies, settings, executedTrades] = await Promise.all([
    prisma.stock.findMany({
      where: { status: { in: ['ACTIVE', 'WATCHLIST'] } },
      orderBy: [{ isVn30: 'desc' }, { symbol: 'asc' }],
      select: {
        id: true,
        symbol: true,
        companyName: true,
        exchange: true,
        sector: { select: { nameVi: true } },
        quote: { select: { price: true } },
      },
    }),
    prisma.strategy.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, nameVi: true, colorHex: true },
    }),
    prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            'trading.default_fee_rate_bps',
            'trading.sell_tax_rate_bps',
            'trading.require_approval_above_vnd',
          ],
        },
      },
    }),
    // Tính khối lượng đang giữ của mọi mã trong một lượt.
    prisma.trade.groupBy({
      by: ['stockId', 'transactionType'],
      where: { portfolioId: portfolio.id, status: COUNTED_TRADE_STATUS },
      _sum: { quantity: true },
    }),
  ]);

  const held = new Map<string, number>();
  for (const row of executedTrades) {
    const sign = row.transactionType === TRANSACTION_TYPE.BUY ? 1 : -1;
    held.set(row.stockId, (held.get(row.stockId) ?? 0) + sign * (row._sum.quantity ?? 0));
  }

  /*
   * SỐ DƯ TỪNG TÀI KHOẢN CỦA CHÍNH NGƯỜI ĐANG NHẬP.
   *
   * Lấy riêng chứ không nhét vào `Promise.all` ở trên: nó cần `portfolio.id` đã
   * chốt, và nó chỉ đọc tài khoản của một người nên rẻ.
   */
  const balances = await computeAccountBalances(portfolio.id, user.id);
  const openAccounts = balances.filter((a) => a.isActive);

  const accountOptions: AccountOption[] = openAccounts.map((a) => {
    const brokerName =
      a.broker === BROKER.OTHER
        ? (a.brokerOther ?? 'Khác')
        : (BROKER_LABEL_VI[a.broker as Broker] ?? a.broker);
    return {
      id: a.accountId,
      accountNo: a.accountNo,
      label: `${brokerName} · ${a.accountNo}${a.ibLabel ? ` · IB ${a.ibLabel}` : ''}`,
      available: a.available.toString(),
    };
  });

  const settingMap = new Map(settings.map((s) => [s.key, s.value]));

  /*
   * BIỂU PHÍ THEO TỪNG TÀI KHOẢN, không phải một cặp số cho cả trang.
   *
   * Phí và thuế nay khai theo IB, mà IB gắn với TÀI KHOẢN — nên đổi ô "Tài khoản
   * thực hiện" là đổi cả bảng phí. Việc đó xảy ra ở client, nên gửi sẵn cả bảng
   * thay vì hỏi lại server sau mỗi lần chọn.
   *
   * Mức chung đi kèm để dùng khi chưa chọn tài khoản nào.
   */
  const ratesByAcc = await ratesByAccount(openAccounts.map((a) => a.accountId));
  const rateMacDinh = await defaultRates();
  const approvalThreshold = settingMap.get('trading.require_approval_above_vnd') ?? '0';

  const stockOptions: StockOption[] = stocks.map((s) => ({
    symbol: s.symbol,
    companyName: s.companyName,
    exchange: s.exchange,
    sectorNameVi: s.sector.nameVi,
    currentPrice: s.quote ? s.quote.price.toString() : null,
    heldQuantity: held.get(s.id) ?? 0,
  }));

  /*
   * VỊ THẾ THEO TỪNG TÀI KHOẢN, chia theo chiến lược.
   *
   * Thị trường Việt Nam không có bán khống nên tab BÁN chỉ chọn được trong danh sách
   * này. Dựng lại từ `trades` + `trade_strategies` chứ không đọc một bảng vị thế lưu
   * sẵn (§23), nên nó luôn khớp với những gì Dashboard đang hiển thị.
   *
   * THEO TÀI KHOẢN, KHÔNG THEO NGƯỜI. Cổ phiếu nằm ở một tài khoản chứng khoán cụ
   * thể và lệnh bán đi qua đúng tài khoản đó. Gộp theo người thì chọn tài khoản
   * VPBankS vẫn thấy MBB đang nằm ở tài khoản SSI, bán được, và VPBankS thành âm
   * 5.000 MBB — đã xảy ra thật trước khi có chốt này.
   *
   * Cũng không theo phạm vi xem: người xem được cả danh mục vẫn chỉ bán được cổ phiếu
   * trong tài khoản của mình — `createTradeAction` chặn đúng như vậy, form phải nói
   * cùng một điều.
   *
   * Một truy vấn cho mỗi tài khoản. Người dùng có vài tài khoản nên số truy vấn nhỏ,
   * và đổi lại là đổi tài khoản trên form không phải chờ mạng.
   */
  const holdingsByAccount: Record<string, HoldingOption[]> = {};

  for (const a of accountOptions) {
    holdingsByAccount[a.id] = (
      await computeStrategyHoldings(portfolio.id, user.id, a.id)
    )
      /*
       * Bỏ vị thế 0 và ÂM. Vị thế 0 không có gì để bán; vị thế âm là dữ liệu sai (một
       * lệnh bán đã ghi vào tài khoản chưa từng giữ mã đó) và bày nó ra ô chọn là mời
       * người dùng bán thêm để âm sâu hơn.
       */
      .filter((h) => h.quantity > 0)
      .map((h) => ({
        stockId: h.stockId,
        symbol: h.symbol,
        companyName: h.companyName,
        quantity: h.quantity,
        quotePrice: h.quotePrice.toString(),
        byStrategy: h.byStrategy
          .filter((x) => x.quantity > 0)
          .map((x) => ({
            strategyId: x.strategyId,
            strategyNameVi: x.strategyNameVi,
            quantity: x.quantity,
          })),
      }));
  }

  const strategyOptions: StrategyOption[] = strategies;
  const canExecuteDirectly = user.permissions.has('transaction.approve');

  /*
   * KHÔNG CÓ TÀI KHOẢN THÌ KHÔNG NHẬP ĐƯỢC LỆNH.
   *
   * Chặn ở đây là để nói rõ PHẢI LÀM GÌ, không phải để bảo mật — chốt thật nằm
   * trong `createTradeAction` (nó kiểm tài khoản có tồn tại, có phải của người gọi,
   * và có đang mở không). Ẩn form mà không nói lý do thì người dùng chỉ thấy một
   * trang trống.
   */
  if (accountOptions.length === 0) {
    const hasClosedOnly = balances.length > 0;
    return (
      <>
        <div className="mb-4">
          <Link href="/transactions" className="text-xs text-slate-muted hover:text-slate-soft">
            ← Transactions
          </Link>
        </div>

        <PageHeader title="Nhập giao dịch" subtitle="Cần một tài khoản chứng khoán trước" />

        <Card className="max-w-2xl p-6">
          <h2 className="text-sm font-semibold text-strong">
            {hasClosedOnly
              ? 'Mọi tài khoản của bạn đang đóng'
              : 'Bạn chưa khai tài khoản chứng khoán nào'}
          </h2>

          <p className="mt-2 text-xs leading-relaxed text-slate-muted">
            Mỗi lệnh phải gắn với một tài khoản chứng khoán — đó là nơi tiền thật sự ra
            vào. Không có tài khoản thì không tính được lệnh này lấy tiền từ đâu, và số dư
            từng tài khoản cũng không dựng được.
          </p>

          <ol className="mt-4 space-y-2 text-xs text-slate-muted">
            <li>
              <span className="mr-1.5 text-accent-400">1.</span>
              Vào {' '}
              <Link href="/profile" className="text-accent-400 hover:underline">
                Tài khoản của tôi
              </Link>{' '}
              — khai sàn, số tài khoản, IB.
            </li>
            <li>
              <span className="mr-1.5 text-accent-400">2.</span>
              Bấm <span className="text-up-500">Nạp vốn</span> trên dòng tài khoản để ghi
              nhận tiền đã nạp.
            </li>
            <li>
              <span className="mr-1.5 text-accent-400">3.</span>
              Quay lại trang này — ô chọn tài khoản sẽ hiện kèm số dư.
            </li>
          </ol>

          <Link
            href="/profile"
            className="mt-5 inline-block rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-500"
          >
            {hasClosedOnly ? 'Mở lại tài khoản →' : 'Khai tài khoản chứng khoán →'}
          </Link>
        </Card>
      </>
    );
  }

  return (
    <>
      <div className="mb-4">
        <Link href="/transactions" className="text-xs text-slate-muted hover:text-slate-soft">
          ← Transactions
        </Link>
      </div>

      <PageHeader
        title="Nhập giao dịch"
        subtitle={`${portfolio.nameVi ?? portfolio.name} · ${stockOptions.length} mã khả dụng`}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="p-6">
          <TradeForm
            portfolioId={portfolio.id}
            portfolioName={portfolio.nameVi ?? portfolio.name}
            stocks={stockOptions}
            holdingsByAccount={holdingsByAccount}
            accounts={accountOptions}
            strategies={strategyOptions}
            ratesByAccount={ratesByAcc}
            defaultRates={rateMacDinh}
            approvalThreshold={approvalThreshold}
            canExecuteDirectly={canExecuteDirectly}
          />
        </Card>

        {/* Giải thích quy tắc — người nhập cần biết vì sao lệnh của mình đi đường nào */}
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-strong">Quy tắc áp dụng</h2>
            <ul className="mt-3 space-y-2.5 text-xs leading-relaxed text-slate-muted">
              <li>
                <span className="text-slate-soft">Tổng phân bổ = 100%.</span> Bắt buộc, không có
                ngoại lệ. Số tiền từng chiến lược do hệ thống tính nên tổng luôn khớp tuyệt đối với
                giá trị lệnh.
              </li>
              <li>
                <span className="text-slate-soft">Ngưỡng duyệt.</span>{' '}
                {approvalThreshold === '0' ? (
                  'Chưa cấu hình ngưỡng.'
                ) : (
                  <>
                    Lệnh từ {formatVnd(BigInt(approvalThreshold))} trở lên bắt buộc qua bước duyệt.
                  </>
                )}
              </li>
              <li>
                <span className="text-slate-soft">Nguyên tắc bốn mắt.</span> Không ai tự duyệt lệnh
                do chính mình nhập.
              </li>
              <li>
                <span className="text-slate-soft">Quyền của bạn.</span>{' '}
                {canExecuteDirectly
                  ? 'Bạn có quyền duyệt nên lệnh dưới ngưỡng được ghi nhận đã khớp ngay.'
                  : 'Bạn không có quyền duyệt nên mọi lệnh đều chuyển sang chờ duyệt.'}
              </li>
              <li>
                <span className="text-slate-soft">Bán không vượt số đang giữ.</span> Form chặn ngay
                khi nhập, server kiểm tra lại lúc ghi.
              </li>
              <li>
                <span className="text-slate-soft">Bắt buộc có tài khoản.</span> Mỗi lệnh gắn với
                một tài khoản chứng khoán của chính bạn và đang mở. Thiếu tiền ở tài khoản thì
                form <em>cảnh báo</em> chứ không chặn — một lệnh đã khớp thật vẫn phải ghi được.
              </li>
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-strong">Chiến lược</h2>
            <ul className="mt-3 space-y-2">
              {strategies.map((s) => (
                <li key={s.id} className="flex items-start gap-2 text-xs">
                  <span
                    className="mt-1 size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: s.colorHex ?? 'var(--color-ink-500)' }}
                  />
                  <span>
                    <span className="text-slate-soft">{s.nameVi}</span>
                    <span className="ml-1.5 font-mono text-micro text-ink-500">{s.code}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-tiny leading-relaxed text-ink-500">
              Chiến lược thuộc giao dịch, không thuộc người nhập (§4). Cùng một người có thể thực
              hiện lệnh cho nhiều chiến lược khác nhau.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
