/**
 * KIỂM THỬ `computeAccountPositions` — bấm vào một tài khoản thì thấy nó đang giữ gì.
 *
 * BẢNG NÀY NẰM NGAY DƯỚI MỘT THANH ĐÃ CÓ SỐ. Khối "Giá trị từng tài khoản" in sẵn
 * "vị thế X (n mã: A, B, C)" từ `computeAccountBalances`; bảng mở ra bên dưới đi qua
 * một đường tính khác (`computePositions` lọc theo tài khoản). Hai đường mà lệch nhau
 * thì người dùng thấy cả hai con số cùng lúc, cách nhau vài dòng.
 *
 * Nên phép kiểm đáng giá nhất là ĐỐI CHIẾU NGƯỢC trên dữ liệu thật của mọi người:
 *
 *   Σ giá trị thị trường các dòng  =  `positionValue` của thanh
 *   danh sách mã của bảng          =  `heldSymbols` của thanh
 *   Σ khối lượng qua các tài khoản =  khối lượng của cả người
 *
 * Phần còn lại dựng ca riêng để canh thứ dữ liệu thật chưa chắc có: giá vốn độc lập
 * giữa hai tài khoản, lệnh không gắn tài khoản, vị thế đã bán hết.
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:account-positions
 */

import { prisma } from '@/lib/prisma';
import {
  computeAccountBalances,
  computeAccountPositions,
  computePositions,
  weightInAccount,
} from '@/domain/portfolio-engine';
import { microToVnd } from '@/lib/money';
import { ROLE, USER_STATUS, PORTFOLIO_STATUS } from '@/lib/enums';

let dat = 0;
let truot = 0;

function kiem(dieuKien: boolean, nhan: string, chiTiet = ''): void {
  if (dieuKien) {
    dat++;
    console.log(`  DAT   ${nhan}`);
  } else {
    truot++;
    console.log(`  TRUOT ${nhan}${chiTiet ? ` -> ${chiTiet}` : ''}`);
  }
}

const P = process.pid;
let stt = 0;

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    select: { id: true },
  });

  console.log('\n1. Đối chiếu với thanh "Giá trị từng tài khoản" — dữ liệu thật, mọi người');
  {
    const nguoi = await prisma.user.findMany({
      where: { brokerAccounts: { some: {} } },
      select: { id: true, fullName: true },
    });

    let soTk = 0;
    let soDong = 0;
    const lechGiaTri: string[] = [];
    const lechMa: string[] = [];
    const lechKhoiLuong: string[] = [];
    const lechChienLuoc: string[] = [];
    const lechTyTrong: string[] = [];
    const coViTheDong: string[] = [];

    for (const n of nguoi) {
      const [soDu, viThe, caNguoi] = await Promise.all([
        computeAccountBalances(portfolio.id, n.id),
        computeAccountPositions(portfolio.id, n.id),
        computePositions({ portfolioId: portfolio.id, userId: n.id }),
      ]);

      const tongTheoMa = new Map<string, number>();

      for (const b of soDu) {
        soTk++;
        const ds = viThe.get(b.accountId) ?? [];
        soDong += ds.length;
        const nhan = `${n.fullName}/${b.accountNo}`;

        const tong = ds.reduce((s, p) => s + p.marketValue, 0n);
        if (tong !== b.positionValue) lechGiaTri.push(`${nhan}: ${tong} vs ${b.positionValue}`);

        const ma = ds.map((p) => p.symbol).sort().join(',');
        if (ma !== b.heldSymbols.join(',')) lechMa.push(`${nhan}: [${ma}] vs [${b.heldSymbols}]`);

        for (const p of ds) {
          if (p.quantity <= 0) coViTheDong.push(`${nhan}/${p.symbol}`);
          tongTheoMa.set(p.stockId, (tongTheoMa.get(p.stockId) ?? 0) + p.quantity);

          if (p.strategies.length > 0) {
            const t = p.strategies.reduce((s, c) => s + c.quantity, 0);
            if (t !== p.quantity) lechChienLuoc.push(`${nhan}/${p.symbol}: ${t} vs ${p.quantity}`);
          }
        }

        /*
         * Tỷ trọng các dòng + tiền mặt phải ra 100%. Mỗi dòng làm tròn riêng nên cho
         * phép lệch tối đa 1 bps mỗi dòng — chặt hơn thì đỏ vì số học, lỏng hơn thì
         * không bắt được một dòng bị tính sai mẫu số.
         */
        if (ds.length > 0 && b.available >= 0n) {
          const tongBps =
            ds.reduce((s, p) => s + weightInAccount(p.marketValue, b.positionValue, b.available), 0) +
            weightInAccount(b.available, b.positionValue, b.available);
          if (Math.abs(tongBps - 10_000) > ds.length + 1) {
            lechTyTrong.push(`${nhan}: ${tongBps} bps`);
          }
        }
      }

      for (const p of caNguoi) {
        const t = tongTheoMa.get(p.stockId) ?? 0;
        if (t !== p.quantity) lechKhoiLuong.push(`${n.fullName}/${p.symbol}: ${t} vs ${p.quantity}`);
      }
    }

    console.log(`        ${nguoi.length} người · ${soTk} tài khoản · ${soDong} dòng vị thế`);
    /*
     * ĐỐI CHỨNG: các phép kiểm dưới đây đều là "không có dòng nào lệch". Chạy trên
     * một database không có vị thế nào thì chúng xanh hết mà không kiểm được gì.
     */
    kiem(soDong > 0, 'có vị thế thật để đối chiếu — các phép kiểm dưới không xanh rỗng', `${soDong}`);
    kiem(lechGiaTri.length === 0, 'Σ giá trị các dòng = `positionValue` của thanh', lechGiaTri.join(' | '));
    kiem(lechMa.length === 0, 'danh sách mã của bảng = danh sách mã in trên thanh', lechMa.join(' | '));
    kiem(lechKhoiLuong.length === 0, 'Σ khối lượng qua các tài khoản = khối lượng của cả người', lechKhoiLuong.join(' | '));
    kiem(lechChienLuoc.length === 0, 'Σ khối lượng theo chiến lược = khối lượng của dòng', lechChienLuoc.join(' | '));
    kiem(lechTyTrong.length === 0, 'tỷ trọng các dòng + tiền mặt = 100%', lechTyTrong.join(' | '));
    kiem(coViTheDong.length === 0, 'không dòng nào có khối lượng ≤ 0', coViTheDong.join(' | '));
  }

  // -------------------------------------------------------------------------
  // Từ đây dựng dữ liệu riêng
  // -------------------------------------------------------------------------

  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  const chienLuoc = await prisma.strategy.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    take: 2,
    select: { id: true, nameVi: true },
  });
  const clA = chienLuoc[0];
  const clB = chienLuoc[1];
  if (!clA || !clB) throw new Error('can it nhat 2 chien luoc dang bat');

  // Mã chưa có lệnh nào và ĐÃ CÓ GIÁ, để giá trị thị trường khác 0.
  const ma = await prisma.stock.findFirstOrThrow({
    where: { status: 'ACTIVE', trades: { none: {} }, quote: { isNot: null } },
    select: { id: true, symbol: true, quote: { select: { price: true } } },
  });
  const gia = ma.quote?.price ?? 0n;

  const tk = async (accountNo: string, broker: string) =>
    prisma.brokerAccount.create({
      data: { userId: admin.id, broker, accountNo, isActive: true },
      select: { id: true },
    });
  const tkA = await tk(`KAP${P}1`, 'SSI');
  const tkB = await tk(`KAP${P}2`, 'VPS');
  const tkRong = await tk(`KAP${P}3`, 'TCBS');

  const lenh = async (
    accountId: string | null,
    loai: 'BUY' | 'SELL',
    soLuong: number,
    donGia: bigint,
    phanBo: { strategyId: string; allocationBps: number }[] = [
      { strategyId: clA.id, allocationBps: 10_000 },
    ],
  ) => {
    stt += 1;
    return prisma.trade.create({
      data: {
        code: `KAP${P}${stt}`,
        portfolioId: portfolio.id,
        stockId: ma.id,
        brokerAccountId: accountId,
        userId: admin.id,
        createdById: admin.id,
        transactionType: loai,
        status: 'EXECUTED',
        quantity: soLuong,
        price: donGia,
        fees: 0n,
        tax: 0n,
        executedAt: new Date(2026, 0, stt),
        strategies: {
          create: phanBo.map((p) => ({ ...p, allocationAmount: 0n })),
        },
      },
      select: { id: true },
    });
  };

  const doc = async () => {
    const m = await computeAccountPositions(portfolio.id, admin.id);
    const tim = (id: string) => (m.get(id) ?? []).find((p) => p.stockId === ma.id);
    return { m, a: tim(tkA.id), b: tim(tkB.id) };
  };

  console.log(`\n2. Cùng mã ${ma.symbol} ở HAI tài khoản, mua hai giá → giá vốn độc lập`);
  {
    await lenh(tkA.id, 'BUY', 1000, 20_000n);
    await lenh(tkB.id, 'BUY', 500, 30_000n);

    const { a, b } = await doc();
    kiem(a?.quantity === 1000, 'tài khoản A giữ 1.000', `${a?.quantity}`);
    kiem(b?.quantity === 500, 'tài khoản B giữ 500', `${b?.quantity}`);
    kiem(microToVnd(a?.avgCostMicro ?? 0n) === 20_000n, 'giá vốn A = 20.000', `${a?.avgCostMicro}`);
    kiem(microToVnd(b?.avgCostMicro ?? 0n) === 30_000n, 'giá vốn B = 30.000', `${b?.avgCostMicro}`);

    /*
     * ĐỐI CHỨNG: giá vốn của CẢ NGƯỜI phải khác cả hai — 23.333. Nếu bộ lọc tài khoản
     * không có tác dụng thì cả ba con số bằng nhau và hai phép kiểm trên vẫn có thể
     * xanh nhờ trùng hợp ở một dữ liệu khác.
     */
    const caNguoi = (await computePositions({ portfolioId: portfolio.id, userId: admin.id })).find(
      (p) => p.stockId === ma.id,
    );
    const vonCaNguoi = microToVnd(caNguoi?.avgCostMicro ?? 0n);
    kiem(
      vonCaNguoi !== 20_000n && vonCaNguoi !== 30_000n,
      'giá vốn của cả người KHÁC cả hai tài khoản — bộ lọc có tác dụng thật',
      `${vonCaNguoi}`,
    );

    kiem(a?.marketValue === 1000n * gia, 'giá trị A = 1.000 × giá hiện tại', `${a?.marketValue}`);
    kiem(
      a?.unrealizedPnl === 1000n * gia - 20_000_000n,
      'lãi/lỗ A = giá trị − giá vốn của riêng A',
      `${a?.unrealizedPnl}`,
    );
  }

  console.log('\n3. Bán bớt ở B → A không đổi một con số nào');
  {
    const truoc = (await doc()).a;
    await lenh(tkB.id, 'SELL', 200, 35_000n);
    const { a, b } = await doc();

    kiem(b?.quantity === 300, 'B còn 300', `${b?.quantity}`);
    kiem(microToVnd(b?.avgCostMicro ?? 0n) === 30_000n, 'giá vốn B giữ nguyên 30.000 sau khi bán');
    kiem(b?.realizedPnl === 200n * 5_000n, 'B chốt lãi 200 × (35.000 − 30.000)', `${b?.realizedPnl}`);
    kiem(
      a?.quantity === truoc?.quantity &&
        a?.totalCost === truoc?.totalCost &&
        a?.realizedPnl === truoc?.realizedPnl,
      'A: khối lượng, giá vốn, lãi đã chốt đều y nguyên',
      `${a?.quantity}/${a?.totalCost}/${a?.realizedPnl}`,
    );
  }

  console.log('\n4. Chia theo chiến lược');
  {
    await lenh(tkA.id, 'BUY', 1000, 20_000n, [
      { strategyId: clA.id, allocationBps: 7_000 },
      { strategyId: clB.id, allocationBps: 3_000 },
    ]);
    const { a } = await doc();

    kiem(a?.quantity === 2000, 'A giữ 2.000 sau lệnh mua thứ hai', `${a?.quantity}`);
    const qA = a?.strategies.find((c) => c.strategyId === clA.id)?.quantity;
    const qB = a?.strategies.find((c) => c.strategyId === clB.id)?.quantity;
    kiem(qA === 1700, `${clA.nameVi}: 1.000 + 700 = 1.700`, `${qA}`);
    kiem(qB === 300, `${clB.nameVi}: 300`, `${qB}`);
    kiem((qA ?? 0) + (qB ?? 0) === a?.quantity, 'Σ theo chiến lược = khối lượng của dòng');
  }

  console.log('\n5. Lệnh KHÔNG gắn tài khoản → không rơi vào tài khoản nào');
  {
    const truoc = await doc();
    await lenh(null, 'BUY', 9000, 20_000n);
    const sau = await doc();

    kiem(sau.a?.quantity === truoc.a?.quantity, 'A không nhận 9.000 cổ phiếu vô chủ', `${sau.a?.quantity}`);
    kiem(sau.b?.quantity === truoc.b?.quantity, 'B cũng không', `${sau.b?.quantity}`);
    /*
     * ĐỐI CHỨNG: lệnh đó CÓ được tính ở phạm vi cả người. Thiếu dòng này thì hai phép
     * kiểm trên xanh cả khi lệnh bị hỏng từ lúc tạo và chẳng được tính ở đâu.
     */
    const caNguoi = (await computePositions({ portfolioId: portfolio.id, userId: admin.id })).find(
      (p) => p.stockId === ma.id,
    );
    kiem(
      caNguoi?.quantity === (sau.a?.quantity ?? 0) + (sau.b?.quantity ?? 0) + 9000,
      'nhưng cả người thì có tính 9.000 đó',
      `${caNguoi?.quantity}`,
    );
  }

  console.log('\n6. Bán hết ở B → B không còn dòng nào của mã này');
  {
    await lenh(tkB.id, 'SELL', 300, 35_000n);
    const { m, b } = await doc();
    kiem(b === undefined, 'mã đã bán hết biến khỏi bảng của B');
    kiem(m.has(tkB.id), 'nhưng B vẫn có mặt trong kết quả (danh sách rỗng, không phải thiếu khoá)');
    kiem((m.get(tkRong.id) ?? []).length === 0, 'tài khoản chưa từng giao dịch → danh sách rỗng');
  }

  console.log('\n7. Tỷ trọng trong tài khoản');
  {
    kiem(weightInAccount(40n, 40n, 60n) === 4_000, '40 vị thế + 60 tiền → mã chiếm 40%');
    kiem(weightInAccount(60n, 40n, 60n) === 6_000, 'và tiền mặt chiếm 60%');
    kiem(weightInAccount(40n, 40n, 0n) === 10_000, 'không có tiền mặt → 100%');
    /*
     * Tiền ÂM không được làm mẫu số nhỏ đi. 40/(40−30) sẽ ra 400% — một tỷ trọng vô
     * nghĩa hiện ngay cạnh các con số đúng.
     */
    kiem(
      weightInAccount(40n, 40n, -30n) === 10_000,
      'tiền âm bị loại khỏi mẫu số — không ra 400%',
      `${weightInAccount(40n, 40n, -30n)}`,
    );
    kiem(weightInAccount(0n, 0n, 0n) === 0, 'tài khoản rỗng → 0, không chia cho 0');
  }

  console.log(`\n${dat} dat / ${truot} truot`);
  if (truot > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
