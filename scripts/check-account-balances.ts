/**
 * SOÁT SỐ DƯ TIỀN TỪNG TÀI KHOẢN CHỨNG KHOÁN.
 *
 * Tài khoản chứng khoán thật không bao giờ âm tiền. Số âm trong hệ thống luôn có một
 * nghĩa: các lệnh MUA đã đi qua tài khoản này nhưng vốn nạp chưa được khai đủ ở MỨC
 * TÀI KHOẢN — thường vì vốn được ghi ở mức danh mục (`brokerAccountId = null`), hoặc vì
 * một lệnh cũ được gán vào tài khoản mà tiền mua nó thì không.
 *
 *     số dư = Σ vốn (theo dấu flowType) − Σ net lệnh MUA + Σ net lệnh BÁN
 *
 * Script chỉ ĐỌC. Nó không sửa gì, vì cách sửa phụ thuộc một dữ kiện chỉ chủ tài khoản
 * biết: tiền mua lô cổ phiếu đó thật sự nằm ở tài khoản nào.
 *
 * Với mỗi tài khoản âm, in ra: thiếu bao nhiêu, những lệnh MUA nào không có vốn tương
 * ứng, và bao nhiêu vốn đang nằm ở mức danh mục chưa gắn tài khoản nào.
 *
 * Dùng: npm run check:balances
 */

import { prisma } from '@/lib/prisma';
import { computeAccountBalances } from '@/domain/portfolio-engine';
import { formatVnd, netAmount } from '@/lib/money';
import { TRANSACTION_TYPE, COUNTED_TRADE_STATUS, BROKER_LABEL_VI, type Broker } from '@/lib/enums';

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true, nameVi: true, name: true },
  });

  const chuTaiKhoan = await prisma.user.findMany({
    where: { brokerAccounts: { some: {} } },
    select: { id: true, fullName: true },
  });

  const am: {
    ten: string;
    chu: string;
    accountId: string;
    thieu: bigint;
    granted: bigint;
    spent: bigint;
    received: bigint;
  }[] = [];

  let soTaiKhoan = 0;

  for (const u of chuTaiKhoan) {
    for (const b of await computeAccountBalances(portfolio.id, u.id)) {
      soTaiKhoan++;
      if (b.available >= 0n) continue;

      const nhan =
        b.broker === 'OTHER'
          ? (b.brokerOther ?? 'Khác')
          : (BROKER_LABEL_VI[b.broker as Broker] ?? b.broker);

      am.push({
        ten: `${nhan} · ${b.accountNo}`,
        chu: u.fullName,
        accountId: b.accountId,
        thieu: -b.available,
        granted: b.granted,
        spent: b.spentOnBuys,
        received: b.receivedFromSells,
      });
    }
  }

  console.log(`Danh mục: ${portfolio.nameVi ?? portfolio.name}`);
  console.log(`${soTaiKhoan} tài khoản chứng khoán · ${am.length} tài khoản âm tiền\n`);

  if (am.length === 0) {
    console.log('Không tài khoản nào âm tiền.');
  }

  for (const a of am) {
    console.log(`${a.ten} — ${a.chu}`);
    console.log(`  vốn góp đã khai   ${formatVnd(a.granted).padStart(20)}`);
    console.log(`  chi mua           ${formatVnd(a.spent).padStart(20)}`);
    console.log(`  thu bán           ${formatVnd(a.received).padStart(20)}`);
    console.log(`  THIẾU             ${formatVnd(a.thieu).padStart(20)}`);

    /*
     * Lệnh MUA của tài khoản này, xếp theo ngày. Lệnh nằm TRƯỚC dòng vốn đầu tiên là
     * ứng viên rõ nhất: lúc nó khớp, hệ thống chưa biết tài khoản có đồng nào.
     */
    const [muas, vonDau] = await Promise.all([
      prisma.trade.findMany({
        where: {
          brokerAccountId: a.accountId,
          portfolioId: portfolio.id,
          status: COUNTED_TRADE_STATUS,
          transactionType: TRANSACTION_TYPE.BUY,
        },
        orderBy: { executedAt: 'asc' },
        select: {
          code: true,
          quantity: true,
          price: true,
          fees: true,
          tax: true,
          executedAt: true,
          stock: { select: { symbol: true } },
        },
      }),
      prisma.capitalFlow.findFirst({
        where: { brokerAccountId: a.accountId, status: 'CONFIRMED' },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      }),
    ]);

    const truocVon = muas.filter((t) => !vonDau || t.executedAt < vonDau.occurredAt);

    if (truocVon.length > 0) {
      console.log(
        `  --- ${truocVon.length} lệnh MUA khớp TRƯỚC dòng vốn đầu tiên` +
          `${vonDau ? ` (${vonDau.occurredAt.toISOString().slice(0, 10)})` : ' (chưa có dòng vốn nào)'} ---`,
      );
      for (const t of truocVon) {
        const net = netAmount('BUY', t.quantity, t.price, t.fees, t.tax);
        console.log(
          `    ${t.executedAt.toISOString().slice(0, 10)} ${t.code} ` +
            `${t.quantity.toLocaleString('vi-VN')} ${t.stock.symbol} — ${formatVnd(net)}`,
        );
      }
    }

    console.log('');
  }

  /*
   * Vốn nằm ở MỨC DANH MỤC. Đây thường là nơi số tiền còn thiếu đang nằm: vốn góp mồi
   * hoặc vốn góp khai chung, chưa quy về tài khoản nào.
   */
  const chung = await prisma.capitalFlow.findMany({
    where: { portfolioId: portfolio.id, brokerAccountId: null, status: 'CONFIRMED' },
    select: { flowType: true, amount: true, note: true, occurredAt: true },
    orderBy: { occurredAt: 'asc' },
  });

  if (chung.length > 0) {
    const tong = chung.reduce((s, f) => s + f.amount, 0n);
    console.log(`${chung.length} dòng vốn ở MỨC DANH MỤC, chưa gắn tài khoản nào — ${formatVnd(tong)}:`);
    for (const f of chung) {
      console.log(
        `  ${f.occurredAt.toISOString().slice(0, 10)} ${f.flowType.padEnd(13)} ` +
          `${formatVnd(f.amount).padStart(18)}  ${f.note ?? ''}`,
      );
    }
    console.log(
      '\nSố tiền còn thiếu của các tài khoản trên thường nằm trong đây. Quy nó về đúng\n' +
        'tài khoản thì tổng vốn của danh mục KHÔNG đổi; khai thêm một dòng vốn mới thì\n' +
        'tổng vốn tăng lên đúng bằng số đó.',
    );
  }

  if (am.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('LOI:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
