/**
 * KIỂM THỬ LỆNH BÁN THEO CHIẾN LƯỢC.
 *
 * Thị trường Việt Nam không có bán khống: chỉ bán được thứ đang giữ, và phải quy về
 * đúng chiến lược đã mua. Bài này kiểm bốn điều:
 *
 *   1. bán trong trần từng chiến lược → ghi được, `trade_strategies` đúng khối lượng
 *   2. vượt trần MỘT chiến lược → từ chối, dù tổng vẫn nhỏ hơn số đang giữ
 *   3. tổng chia theo chiến lược ≠ khối lượng bán → từ chối
 *   4. bán quá số CỦA MÌNH (dù còn dưới số của cả danh mục) → từ chối
 *
 * Điều 4 là thay đổi hành vi: trước đây chốt đo ở mức danh mục nên một người bán được
 * 52.000 MBB trong khi tài khoản họ chỉ có 10.000.
 *
 * Gọi ĐÚNG `createTradeAction`. Chạy trên BẢN SAO database.
 * Dùng: npm run test:sell-strategy
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { createTradeAction } from '@/trading/actions';
import { computeStrategyHoldings } from '@/domain/portfolio-engine';
import { allocateAmount } from '@/lib/money';
import { ROLE, USER_STATUS, TRANSACTION_TYPE } from '@/lib/enums';

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

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  // Người bán: admin — có tài khoản chứng khoán và có quyền transaction.create.
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true, fullName: true },
  });
  await createSession(admin.id);

  /*
   * CHỌN TÀI KHOẢN THEO VỊ THẾ, không lấy tài khoản đầu tiên.
   *
   * Trần khi bán đo theo TÀI KHOẢN. Lấy bừa một tài khoản rồi tính trần theo tài
   * khoản khác là bài kiểm tự dựng một tình huống không tồn tại — và đó đúng là lỗi
   * vừa sửa: form cho bán MBB của tài khoản SSI qua tài khoản VPBankS.
   */
  const dsTaiKhoan = await prisma.brokerAccount.findMany({
    where: { userId: admin.id, isActive: true },
    select: { id: true, broker: true, accountNo: true },
  });

  let taiKhoan: { id: string; broker: string; accountNo: string } | null = null;
  let mk: Awaited<ReturnType<typeof computeStrategyHoldings>>[number] | undefined;

  for (const a of dsTaiKhoan) {
    const kho = await computeStrategyHoldings(portfolio.id, admin.id, a.id);
    const m = kho.find((h) => h.quantity > 0 && h.byStrategy.length >= 2);
    if (m) {
      taiKhoan = a;
      mk = m;
      break;
    }
  }

  if (!taiKhoan || !mk) {
    console.log('  BOQUA: khong tai khoan nao cua admin giu ma co tu 2 chien luoc tro len');
    return;
  }

  console.log(`Tài khoản bán: ${taiKhoan.broker} ${taiKhoan.accountNo}`);

  console.log(
    `Nền: tài khoản này giữ ${mk.quantity.toLocaleString('vi-VN')} ${mk.symbol} — ` +
      mk.byStrategy.map((x) => `${x.strategyNameVi} ${x.quantity.toLocaleString('vi-VN')}`).join(' · '),
  );

  const cuaDanhMuc = (
    await prisma.trade.findMany({
      where: { portfolioId: portfolio.id, stockId: mk.stockId, status: 'EXECUTED' },
      select: { transactionType: true, quantity: true },
    })
  ).reduce((s, t) => s + (t.transactionType === TRANSACTION_TYPE.BUY ? t.quantity : -t.quantity), 0);
  console.log(`      cả danh mục giữ ${cuaDanhMuc.toLocaleString('vi-VN')} ${mk.symbol}`);
  kiem(
    cuaDanhMuc > mk.quantity,
    'danh mục giữ NHIỀU HƠN tài khoản này — đúng tình huống cần kiểm điều 4',
  );

  const nen = (them: Record<string, string>): FormData => {
    const f = new FormData();
    f.set('portfolioId', portfolio.id);
    f.set('symbol', mk.symbol);
    f.set('transactionType', TRANSACTION_TYPE.SELL);
    f.set('price', String(mk.quotePrice));
    f.set('brokerAccountId', taiKhoan.id);
    f.set('executedAt', new Date().toISOString());
    for (const [k, v] of Object.entries(them)) f.set(k, v);
    return f;
  };

  console.log('\n1. Bán trong trần từng chiến lược → ghi được');
  {
    // Bán một nửa mỗi chiến lược (làm tròn xuống), để chắc chắn trong trần.
    const chia = mk.byStrategy.map((x) => ({ id: x.strategyId, ten: x.strategyNameVi, q: Math.floor(x.quantity / 2) }));
    const tong = chia.reduce((s, x) => s + x.q, 0);

    const f = nen({ quantity: String(tong) });
    for (const c of chia) f.set(`qty_${c.id}`, String(c.q));

    const truocSo = await prisma.trade.count({ where: { portfolioId: portfolio.id } });
    const kq = await createTradeAction(null, f);
    kiem(kq.ok === true, `bán ${tong.toLocaleString('vi-VN')} ${mk.symbol}`, JSON.stringify(kq));
    kiem(
      (await prisma.trade.count({ where: { portfolioId: portfolio.id } })) === truocSo + 1,
      'đúng một lệnh được tạo',
    );

    const lenh = await prisma.trade.findFirst({
      where: { portfolioId: portfolio.id, stockId: mk.stockId, transactionType: TRANSACTION_TYPE.SELL },
      orderBy: { createdAt: 'desc' },
      select: {
        quantity: true, status: true, userId: true, brokerAccountId: true,
        strategies: { select: { strategyId: true, allocationBps: true } },
      },
    });

    kiem(lenh?.quantity === tong, 'khối lượng đúng');
    kiem(lenh?.userId === admin.id, 'lệnh thuộc về người bán');
    kiem(lenh?.brokerAccountId === taiKhoan.id, 'gắn đúng tài khoản chứng khoán');

    const tongBps = (lenh?.strategies ?? []).reduce((s, x) => s + x.allocationBps, 0);
    kiem(tongBps === 10_000, 'tổng bps đúng 10000', String(tongBps));

    /*
     * PHÉP KIỂM QUAN TRỌNG NHẤT: dựng lại khối lượng từ bps đã lưu phải bằng đúng
     * những gì đã nhập. Nếu lệch, khối lượng theo chiến lược sẽ trôi và trần lần sau
     * sai theo.
     */
    const bpsTheoId = new Map((lenh?.strategies ?? []).map((x) => [x.strategyId, x.allocationBps]));
    const thuTu = chia.filter((c) => bpsTheoId.has(c.id));
    const dungLai = allocateAmount(BigInt(tong), thuTu.map((c) => bpsTheoId.get(c.id)!));
    const khop = thuTu.every((c, i) => dungLai[i] === BigInt(c.q));
    kiem(khop, 'dựng lại khối lượng từ bps khớp đúng số đã nhập',
      thuTu.map((c, i) => `${c.ten}: nhập ${c.q} dựng ${dungLai[i]}`).join(' · '));
  }

  console.log('\n2. Vượt trần MỘT chiến lược → từ chối (dù tổng vẫn dưới số đang giữ)');
  {
    const khoMoi = await computeStrategyHoldings(portfolio.id, admin.id, taiKhoan.id);
    const m = khoMoi.find((h) => h.stockId === mk.stockId)!;
    /*
     * HAI CHIẾN LƯỢC PHẢI KHÁC NHAU, không chỉ khác kích cỡ.
     *
     * Bản đầu lấy "nhỏ nhất" và "lớn nhất" bằng hai lần sắp xếp. Khi các chiến lược
     * giữ BẰNG NHAU — admin giữ 2.000 + 2.000 MBB — cả hai phép cùng trả về một chiến
     * lược, `qty_<id>` bị đặt hai lần nên lần sau ghi đè lần trước. Tổng gửi đi thành
     * 100 thay vì 1.200, và lỗi rơi vào chốt "tổng không khớp" chứ không phải chốt
     * trần. Bài kiểm báo trượt cho một chốt đang chạy đúng.
     */
    const theoCo = [...m.byStrategy].sort((a, b) => a.quantity - b.quantity);
    const nho = theoCo[0]!;
    const lon = theoCo.find((x) => x.strategyId !== nho.strategyId);

    if (!lon) {
      console.log('  BOQUA: chi co mot chien luoc, khong tach duoc tran rieng khoi tong');
    } else {

      const qNho = nho.quantity + 100; // vượt trần chiến lược nhỏ
      const qLon = 100;
      const tong = qNho + qLon;
      kiem(
        tong <= m.quantity,
        `tổng ${tong} vẫn dưới số đang giữ ${m.quantity} — nên chỉ trần chiến lược mới chặn`,
      );

      const f = nen({ quantity: String(tong) });
      f.set(`qty_${nho.strategyId}`, String(qNho));
      f.set(`qty_${lon.strategyId}`, String(qLon));

      const truocSo = await prisma.trade.count({ where: { portfolioId: portfolio.id } });
      const kq = await createTradeAction(null, f);
      kiem(kq.ok === false, 'bị từ chối');
      kiem(
        kq.fieldErrors?.strategies?.some((m2) => m2.includes(nho.strategyNameVi)) === true,
        'thông báo nêu đúng tên chiến lược bị vượt',
        JSON.stringify(kq.fieldErrors),
      );
      kiem(
        (await prisma.trade.count({ where: { portfolioId: portfolio.id } })) === truocSo,
        'không lệnh nào được tạo',
      );
      console.log(`        thông báo: ${kq.fieldErrors?.strategies?.[0]}`);
    }
  }

  console.log('\n3. Tổng chia theo chiến lược ≠ khối lượng bán → từ chối');
  {
    const khoMoi = await computeStrategyHoldings(portfolio.id, admin.id, taiKhoan.id);
    const m = khoMoi.find((h) => h.stockId === mk.stockId)!;
    const cl = m.byStrategy[0]!;

    const f = nen({ quantity: '1000' });
    f.set(`qty_${cl.strategyId}`, '400'); // chia 400 nhưng bán 1000

    const kq = await createTradeAction(null, f);
    kiem(kq.ok === false, 'bị từ chối');
    kiem(
      kq.fieldErrors?.strategies?.some((m2) => m2.includes('phải bằng đúng khối lượng bán')) === true,
      'nói rõ tổng không khớp',
      JSON.stringify(kq.fieldErrors),
    );
    console.log(`        thông báo: ${kq.fieldErrors?.strategies?.find((x) => x.includes('phải bằng'))}`);
  }

  console.log('\n4. Bán quá số CỦA TÀI KHOẢN nhưng dưới số cả danh mục → từ chối');
  {
    const khoMoi = await computeStrategyHoldings(portfolio.id, admin.id, taiKhoan.id);
    const m = khoMoi.find((h) => h.stockId === mk.stockId)!;
    const quaNhieu = m.quantity + 1000;
    kiem(
      quaNhieu < cuaDanhMuc,
      `${quaNhieu} vượt số của tài khoản (${m.quantity}) nhưng vẫn dưới số cả danh mục (${cuaDanhMuc})`,
    );

    const f = nen({ quantity: String(quaNhieu) });
    // Chia hết cho một chiến lược để lỗi rơi vào trần, không rơi vào tổng
    f.set(`qty_${m.byStrategy[0]!.strategyId}`, String(quaNhieu));

    const truocSo = await prisma.trade.count({ where: { portfolioId: portfolio.id } });
    const kq = await createTradeAction(null, f);
    kiem(kq.ok === false, 'bị từ chối');
    kiem(
      (await prisma.trade.count({ where: { portfolioId: portfolio.id } })) === truocSo,
      'không lệnh nào được tạo',
    );
    console.log(`        thông báo: ${JSON.stringify(kq.fieldErrors ?? kq.message).slice(0, 160)}`);
  }

  console.log('\n5. Bán mã KHÔNG giữ → từ chối');
  {
    const khongGiu = await prisma.stock.findFirstOrThrow({
      where: { status: 'ACTIVE', trades: { none: { userId: admin.id } } },
      select: { symbol: true },
    });
    const f = nen({ quantity: '100' });
    f.set('symbol', khongGiu.symbol);

    const kq = await createTradeAction(null, f);
    kiem(kq.ok === false, `bị từ chối khi bán ${khongGiu.symbol}`);
    kiem(
      kq.fieldErrors?.symbol?.some((m2) => m2.includes('không giữ')) === true,
      'nói rõ là không giữ mã đó',
      JSON.stringify(kq.fieldErrors),
    );
    console.log(`        thông báo: ${kq.fieldErrors?.symbol?.[0]}`);
  }

  console.log('\n6. Bán mã đang giữ ở TÀI KHOẢN KHÁC → từ chối');
  {
    /*
     * ĐÂY LÀ LỖI NGƯỜI DÙNG PHÁT HIỆN. Trước khi sửa: chọn tài khoản VPBankS rồi bán
     * MBB đang nằm ở tài khoản SSI thì lệnh vẫn ghi được, và VPBankS thành âm MBB.
     */
    const khac = dsTaiKhoan.find((a) => a.id !== taiKhoan!.id);

    if (!khac) {
      console.log('  BOQUA: admin chi co mot tai khoan, khong dung duoc tinh huong nay');
    } else {
      const khoKhac = await computeStrategyHoldings(portfolio.id, admin.id, khac.id);
      const coMa = khoKhac.find((h) => h.stockId === mk!.stockId);
      kiem(
        !coMa || coMa.quantity <= 0,
        `${khac.broker} ${khac.accountNo} KHÔNG giữ ${mk!.symbol} — đúng tình huống cần kiểm`,
        `${coMa?.quantity ?? 0}`,
      );

      const f = nen({ quantity: String(mk!.byStrategy[0]!.quantity) });
      f.set('brokerAccountId', khac.id);
      f.set(`qty_${mk!.byStrategy[0]!.strategyId}`, String(mk!.byStrategy[0]!.quantity));

      const truocSo = await prisma.trade.count({ where: { portfolioId: portfolio.id } });
      const kq = await createTradeAction(null, f);

      kiem(kq.ok === false, `bị từ chối khi bán ${mk!.symbol} qua ${khac.broker} ${khac.accountNo}`);
      kiem(
        kq.fieldErrors?.symbol?.some((m2) => m2.includes('Tài khoản này không giữ')) === true,
        'thông báo nói rõ tài khoản này không giữ mã đó',
        JSON.stringify(kq.fieldErrors),
      );
      kiem(
        (await prisma.trade.count({ where: { portfolioId: portfolio.id } })) === truocSo,
        'không lệnh nào được tạo — không sinh vị thế âm',
      );
      console.log(`        thông báo: ${kq.fieldErrors?.symbol?.[0]}`);
    }
  }

  console.log(`\n===== ${dat} đạt, ${truot} trượt =====`);
  if (truot > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('\nLOI:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
