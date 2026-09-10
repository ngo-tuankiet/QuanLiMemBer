import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { computeAccountBalances, computeStrategyHoldings } from '@/domain/portfolio-engine';
import {
  DividendForm,
  type DividendAccount,
  type DividendHolding,
} from '@/components/DividendForm';
import { BROKER, BROKER_LABEL_VI, PORTFOLIO_STATUS, type Broker } from '@/lib/enums';

export const metadata: Metadata = { title: 'Ghi nhận cổ tức' };

/**
 * GHI NHẬN CỔ TỨC.
 *
 * ĐẶT TRONG NHÁNH GIAO DỊCH, không đặt ở trang Tài khoản. Cổ tức là một sự kiện của VỊ
 * THẾ: nó chỉ tồn tại vì bạn đang nắm mã đó, và nó làm đổi khối lượng (cổ phiếu thưởng)
 * hoặc tiền (cổ tức tiền mặt). Trang Tài khoản nói về vốn nạp/rút — tiền của người dùng
 * đi vào và ra khỏi hệ thống — còn cổ tức là tiền doanh nghiệp trả cho cổ phần.
 */
export default async function DividendPage() {
  const user = await requirePagePermission('transaction.create');

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

  const balances = await computeAccountBalances(portfolio.id, user.id);
  const moTk = balances.filter((a) => a.isActive);

  const accounts: DividendAccount[] = moTk.map((a) => {
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
  const holdingsByAccount: Record<string, DividendHolding[]> = {};
  for (const a of accounts) {
    holdingsByAccount[a.id] = (await computeStrategyHoldings(portfolio.id, user.id, a.id))
      .filter((h) => h.quantity > 0)
      .map((h) => ({
        stockId: h.stockId,
        symbol: h.symbol,
        companyName: h.companyName,
        quantity: h.quantity,
      }));
  }

  const coViThe = Object.values(holdingsByAccount).some((x) => x.length > 0);

  return (
    <>
      <Link href="/transactions" className="text-tiny text-slate-muted hover:text-strong">
        ← Transactions
      </Link>
      <PageHeader
        title="Ghi nhận cổ tức"
        subtitle={`${portfolio.nameVi ?? portfolio.name} · cổ tức chỉ trả trên vị thế đang nắm`}
      />

      <Card className="p-5">
        {accounts.length === 0 ? (
          <EmptyState
            title="Chưa khai tài khoản chứng khoán nào"
            hint="Vào Tài khoản của tôi để khai tài khoản trước."
          />
        ) : !coViThe ? (
          <EmptyState
            title="Chưa giữ mã nào"
            hint="Cổ tức trả trên số cổ phiếu đang nắm, nên phải có vị thế trước đã."
          />
        ) : (
          <DividendForm
            portfolioId={portfolio.id}
            accounts={accounts}
            holdingsByAccount={holdingsByAccount}
          />
        )}
      </Card>

      <div className="mt-4 space-y-2 text-tiny leading-relaxed text-ink-500">
        <p>
          <span className="text-slate-muted">Cổ tức tiền mặt</span> vào thẳng số dư của tài khoản
          và được ghi là một dòng <span className="text-slate-soft">capital_flows</span> gắn mã cổ
          phiếu — nhờ vậy bảng vị thế trả lời được câu “mã này đã mang về bao nhiêu”. Nó KHÔNG
          tính vào vốn góp, vì đó là tiền doanh nghiệp trả chứ không phải tiền bạn nạp thêm.
        </p>
        <p>
          <span className="text-slate-muted">Cổ tức bằng cổ phiếu</span> được ghi là một dòng
          giao dịch giá 0: khối lượng tăng, giá vốn giữ nguyên, nên giá vốn trung bình giảm đúng
          theo tỷ lệ chia. Số cổ phiếu thưởng được chia về các chiến lược theo đúng tỷ trọng
          chúng đang nắm.
        </p>
        <p>
          Trên bảng vị thế, cổ tức tiền mặt nằm ở cột riêng chứ không cộng vào Lãi/lỗ giá — hai
          nguồn lợi nhuận khác nhau, trộn lại thì cột phần trăm không còn là mức tăng giá so với
          giá vốn.
        </p>
      </div>
    </>
  );
}
