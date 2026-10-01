import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePageAnyPermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { computeAccountBalances, computeStrategyHoldings } from '@/domain/portfolio-engine';
import {
  DividendForm,
  type DividendAccount,
  type DividendHolding,
  type DividendPrefill,
} from '@/components/DividendForm';
import { PendingDividends, type MucDaBoQua } from '@/components/PendingDividends';
import { ghiDuoc, phamViCoTuc, trongPhamVi } from '@/dividends/scope';
import {
  computeDismissedCorporateEvents,
  computePendingCorporateEvents,
  nhanTaiKhoan,
} from '@/dividends/pending';
import { dangCoLuotQuet } from '@/dividends/scan';
import { tradingDayString } from '@/lib/trading-date';
import {
  BROKER,
  BROKER_LABEL_VI,
  CORPORATE_EVENT_KIND,
  PORTFOLIO_STATUS,
  SYNC_KIND,
  SYNC_STATUS,
  TRADE_STATUS,
  TRANSACTION_TYPE,
  type Broker,
} from '@/lib/enums';

export const metadata: Metadata = { title: 'Ghi nhận cổ tức' };

/**
 * Mã đang giữ + mã từng giữ của MỘT tài khoản — danh sách cho ô chọn mã.
 *
 * MÃ ĐÃ BÁN HẾT CŨNG PHẢI CÓ TRONG Ô CHỌN. Cổ tức trả theo số nắm tại ngày chốt
 * quyền. Bán sạch sau ngày chốt thì tiền vẫn về, nhưng `computeStrategyHoldings` đã
 * loại mã đó (nó bỏ mọi vị thế ≤ 0). Chỉ liệt kê mã đang giữ là khoá luôn đường ghi
 * khoản tiền có thật đó. Vẫn bó trong những mã TÀI KHOẢN NÀY TỪNG MUA.
 *
 * `ownerId` là CHỦ tài khoản, không phải người đang xem: khi quản lý ghi hộ, danh
 * sách phải là mã của thành viên đó.
 */
async function maCuaTaiKhoan(
  portfolioId: string,
  ownerId: string,
  accountId: string,
): Promise<DividendHolding[]> {
  const dangGiu = (await computeStrategyHoldings(portfolioId, ownerId, accountId)).filter(
    (h) => h.quantity > 0,
  );

  const tungGiu = await prisma.trade.findMany({
    where: {
      brokerAccountId: accountId,
      userId: ownerId,
      status: TRADE_STATUS.EXECUTED,
      transactionType: TRANSACTION_TYPE.BUY,
    },
    distinct: ['stockId'],
    select: { stock: { select: { id: true, symbol: true, companyName: true } } },
  });

  const dangGiuIds = new Set(dangGiu.map((h) => h.stockId));

  return [
    ...dangGiu.map((h) => ({
      stockId: h.stockId,
      symbol: h.symbol,
      companyName: h.companyName,
      quantity: h.quantity,
    })),
    ...tungGiu
      .filter((t) => !dangGiuIds.has(t.stock.id))
      .map((t) => ({
        stockId: t.stock.id,
        symbol: t.stock.symbol,
        companyName: t.stock.companyName,
        quantity: 0,
      })),
  ].sort((x, y) => x.symbol.localeCompare(y.symbol));
}

/**
 * GHI NHẬN CỔ TỨC.
 *
 * ĐẶT TRONG NHÁNH GIAO DỊCH, không đặt ở trang Tài khoản. Cổ tức là một sự kiện của VỊ
 * THẾ: nó chỉ tồn tại vì bạn đang nắm mã đó, và nó làm đổi khối lượng (cổ phiếu thưởng)
 * hoặc tiền (cổ tức tiền mặt). Trang Tài khoản nói về vốn nạp/rút — tiền của người dùng
 * đi vào và ra khỏi hệ thống — còn cổ tức là tiền doanh nghiệp trả cho cổ phần.
 *
 * AI MỞ ĐƯỢC TRANG. Trước đây chỉ người có `transaction.create`. Nay thêm người có
 * `transaction.view_all` (quản lý cấp cao): họ không tự đặt lệnh nhưng được xem và ghi
 * hộ cổ tức theo quyết định của người dùng — xem `src/dividends/scope.ts`.
 */
export default async function DividendPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; account?: string }>;
}) {
  const user = await requirePageAnyPermission(['transaction.create', 'transaction.view_all']);
  const params = await searchParams;

  const portfolio = await prisma.portfolio.findFirst({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, nameVi: true },
  });

  if (!portfolio) {
    return (
      <>
        <PageHeader title="Ghi nhận cổ tức" />
        <Card className="p-5">
          <EmptyState title="Chưa có danh mục nào đang hoạt động" />
        </Card>
      </>
    );
  }

  const pv = phamViCoTuc(user);

  const [choGhi, boQuaRaw, lanQuet, dangQuet] = await Promise.all([
    computePendingCorporateEvents(pv),
    computeDismissedCorporateEvents(pv),
    prisma.marketDataSync.findFirst({
      where: {
        kind: SYNC_KIND.EVENTS,
        status: { in: [SYNC_STATUS.SUCCESS, SYNC_STATUS.PARTIAL, SYNC_STATUS.FAILED] },
      },
      orderBy: { startedAt: 'desc' },
      select: {
        startedAt: true,
        finishedAt: true,
        status: true,
        symbolsRequested: true,
        symbolsFailed: true,
        errorMessage: true,
      },
    }),
    // Chỉ lượt còn mới — lượt đã chết không được hiện "Đang quét…" mãi.
    dangCoLuotQuet(),
  ]);

  const boQua: MucDaBoQua[] = boQuaRaw.map((r) => ({
    id: r.id,
    symbol: r.event.stock.symbol,
    titleVi: r.event.titleVi,
    accountLabel: nhanTaiKhoan(r.brokerAccount),
    ownerName: r.brokerAccount.user.fullName,
    reason: r.reason,
    resolvedBy: r.resolvedBy.fullName,
    createdAt: r.createdAt,
    hoanTacDuoc: ghiDuoc(user, { id: r.brokerAccount.userId, teamId: r.brokerAccount.user.teamId }),
  }));

  const ghiDuocMuc = (m: { ownerId: string; ownerTeamId: string | null }) =>
    ghiDuoc(user, { id: m.ownerId, teamId: m.ownerTeamId });

  /*
   * ĐIỀN SẴN TỪ MỘT MỤC (`?event=…&account=…`).
   *
   * Tìm lại mục trong CHÍNH danh sách vừa tính, không tra riêng: tham số trên URL là
   * thứ ai cũng gõ được, và mục chỉ được điền nếu nó thật sự đang chờ, trong phạm vi
   * người xem, và người xem ghi được.
   */
  const mucChon =
    params.event && params.account
      ? (choGhi.find(
          (m) =>
            m.eventId === params.event &&
            m.accountId === params.account &&
            m.kind !== CORPORATE_EVENT_KIND.RIGHTS_ISSUE &&
            !m.choTienVe &&
            trongPhamVi(pv, { id: m.ownerId, teamId: m.ownerTeamId }) &&
            ghiDuocMuc(m),
        ) ?? null)
      : null;

  /*
   * TÀI KHOẢN CỦA FORM.
   *
   *   điền sẵn cho NGƯỜI KHÁC → đúng một tài khoản đó (ghi hộ)
   *   còn lại                  → tài khoản của chính người xem, như trước
   */
  let accounts: DividendAccount[] = [];
  const holdingsByAccount: Record<string, DividendHolding[]> = {};
  let prefill: DividendPrefill | null = null;

  if (mucChon && mucChon.ownerId !== user.id) {
    accounts = [{ id: mucChon.accountId, label: `${mucChon.accountLabel} · ${mucChon.ownerName}` }];
    holdingsByAccount[mucChon.accountId] = await maCuaTaiKhoan(
      portfolio.id,
      mucChon.ownerId,
      mucChon.accountId,
    );
  } else if (user.permissions.has('transaction.create')) {
    const balances = await computeAccountBalances(portfolio.id, user.id);
    accounts = balances
      .filter((a) => a.isActive)
      .map((a) => {
        const tenSan =
          a.broker === BROKER.OTHER
            ? (a.brokerOther ?? 'Khác')
            : (BROKER_LABEL_VI[a.broker as Broker] ?? a.broker);
        return {
          id: a.accountId,
          label: `${tenSan} · ${a.accountNo}${a.ibLabel ? ` · IB ${a.ibLabel}` : ''}`,
        };
      });
    /*
     * Một truy vấn cho mỗi tài khoản — cùng cách với trang nhập lệnh. Người dùng có vài
     * tài khoản nên số truy vấn nhỏ, đổi lại đổi tài khoản trên form không phải chờ mạng.
     */
    for (const a of accounts) {
      holdingsByAccount[a.id] = await maCuaTaiKhoan(portfolio.id, user.id, a.id);
    }
  }

  if (mucChon) {
    const laTien = mucChon.kind === CORPORATE_EVENT_KIND.CASH_DIVIDEND;
    prefill = {
      corporateEventId: mucChon.eventId,
      accountId: mucChon.accountId,
      stockId: mucChon.stockId,
      eligibleQuantity: mucChon.eligibleQuantity,
      /*
       * NGÀY GHI: tiền mặt theo NGÀY TRẢ (tiền về tài khoản hôm đó); cổ phiếu theo ngày
       * GDKHQ, vì nguồn thường không có ngày cổ phiếu về tài khoản.
       */
      occurredAt: tradingDayString(
        laTien && mucChon.payoutDate ? mucChon.payoutDate : mucChon.exRightDate,
      ),
      cashPerShare: laTien && mucChon.cashPerShare ? mucChon.cashPerShare.toString() : '',
      shareQuantity: laTien ? '' : String(mucChon.expectedShares),
      note: `${mucChon.symbol} · ${mucChon.titleVi}`,
      onBehalfOf: mucChon.ownerId !== user.id ? mucChon.ownerName : null,
    };
  }

  const coViThe = Object.values(holdingsByAccount).some((x) => x.length > 0);
  const moiLaGhiHo = mucChon !== null && mucChon.ownerId !== user.id;

  return (
    <>
      <Link href="/transactions" className="text-tiny text-slate-muted hover:text-strong">
        ← Transactions
      </Link>
      <PageHeader
        title="Ghi nhận cổ tức"
        subtitle={`${portfolio.nameVi ?? portfolio.name} · cổ tức trả theo số cổ phiếu nắm trước ngày GDKHQ`}
      />

      <PendingDividends
        items={choGhi}
        dismissed={boQua}
        hienChuTaiKhoan={pv.loai !== 'SELF'}
        ghiDuoc={ghiDuocMuc}
        viewerId={user.id}
        lanQuet={lanQuet}
        dangQuet={dangQuet}
        quetDuoc={user.permissions.has('market_data.sync')}
      />

      {params.event && !mucChon ? (
        <p className="mb-4 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs text-warn-500">
          Mục vừa chọn không còn chờ ghi nhận — có thể vừa được ghi hoặc bỏ qua. Danh sách ở trên
          đã là bản mới nhất.
        </p>
      ) : null}

      {accounts.length > 0 || moiLaGhiHo ? (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-medium text-strong">
            {moiLaGhiHo ? 'Ghi hộ cổ tức' : 'Ghi tay một đợt cổ tức'}
          </h2>
          {accounts.length === 0 ? (
            <EmptyState
              title="Chưa khai tài khoản chứng khoán nào"
              hint="Vào Tài khoản của tôi để khai tài khoản trước."
            />
          ) : !coViThe ? (
            <EmptyState
              title="Chưa mua mã nào"
              hint="Cổ tức trả trên cổ phiếu đã mua, nên phải có ít nhất một lệnh mua trước đã."
            />
          ) : (
            <DividendForm
              /*
                KEY THEO MỤC ĐIỀN SẴN. Form giữ state phía trình duyệt; bấm sang mục khác
                chỉ đổi props, và `useState` bỏ qua giá trị khởi tạo mới — form sẽ giữ số
                của mục trước. Đổi key là dựng form mới với đúng số của mục vừa chọn.
              */
              key={prefill ? `${prefill.corporateEventId}|${prefill.accountId}` : 'tay'}
              portfolioId={portfolio.id}
              accounts={accounts}
              holdingsByAccount={holdingsByAccount}
              prefill={prefill}
            />
          )}
        </Card>
      ) : null}

      <div className="mt-4 space-y-2 text-tiny leading-relaxed text-ink-500">
        <p>
          <span className="text-slate-muted">Cổ tức tiền mặt</span> vào thẳng số dư của tài khoản
          và được ghi là một dòng <span className="text-slate-soft">capital_flows</span> gắn mã cổ
          phiếu — nhờ vậy bảng vị thế trả lời được câu “mã này đã mang về bao nhiêu”. Nó KHÔNG
          tính vào vốn góp, vì đó là tiền doanh nghiệp trả chứ không phải tiền bạn nạp thêm.
        </p>
        <p>
          <span className="text-slate-muted">Cổ tức bằng cổ phiếu</span> và{' '}
          <span className="text-slate-muted">cổ phiếu thưởng</span> được ghi là một dòng giao dịch
          giá 0: khối lượng tăng, giá vốn giữ nguyên, nên giá vốn trung bình giảm đúng theo tỷ lệ
          chia. Số cổ phiếu thưởng được chia về các chiến lược theo đúng tỷ trọng chúng đang nắm.
        </p>
        <p>
          <span className="text-slate-muted">Quyền mua</span> không phải cổ tức: phải nộp tiền mới
          có cổ phiếu. Nó có mặt trong danh sách để nhắc; thực hiện quyền thì nhập lệnh mua, rồi bấm
          “Bỏ qua” với lý do đã mua.
        </p>
        <p>
          Danh sách chỉ tính các đợt có ngày GDKHQ từ ngày tài khoản được đưa vào hệ thống. Số
          lượng khai lúc đưa vào lấy từ sao kê, nên đã gồm các đợt chia trước đó.
        </p>
      </div>
    </>
  );
}
