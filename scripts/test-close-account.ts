/**
 * KIỂM THỬ ĐIỀU KIỆN ĐÓNG TÀI KHOẢN CHỨNG KHOÁN.
 *
 * Yêu cầu: chỉ đóng được khi tài khoản KHÔNG còn mã đầu tư nào và KHÔNG còn tiền.
 *
 * Mỗi điều kiện ngăn một hậu quả cụ thể:
 *
 *   còn mã     form BÁN chỉ chọn tài khoản đang mở → vị thế kẹt vĩnh viễn nhưng vẫn
 *              tính vào lãi/lỗ của danh mục
 *   còn tiền   `recordFlow` chặn tài khoản đã đóng → tiền vẫn tính vào Available Cash
 *              của danh mục nhưng không rút ra được nữa
 *   còn yêu cầu rút chờ duyệt   duyệt thì tiền ra từ một tài khoản đã chốt sổ
 *
 * Bài này kiểm:
 *
 *   1. tài khoản trống → đóng được
 *   2. còn tiền → TỪ CHỐI, tài khoản vẫn mở
 *   3. còn mã đầu tư → TỪ CHỐI, và thông báo nêu đúng tên mã
 *   4. còn yêu cầu rút chờ duyệt → TỪ CHỐI
 *   5. số dư ÂM cũng chặn (không phải "khác 0 theo hướng tốt" mới chặn)
 *   6. MỞ LẠI không cần điều kiện gì
 *   7. chỉ chủ tài khoản đổi được trạng thái
 *
 * Gọi ĐÚNG `toggleBrokerAccountAction`. Chạy trên BẢN SAO database.
 * Dùng: npm run test:close-account
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import {
  depositCapitalAction,
  toggleBrokerAccountAction,
  withdrawCapitalAction,
} from '@/accounts/actions';
import { kiemDongTaiKhoan, lyDoChuaDong } from '@/accounts/close-rules';
import { computeAccountBalances } from '@/domain/portfolio-engine';
import { formatVnd } from '@/lib/money';
import { ROLE, USER_STATUS } from '@/lib/enums';

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
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true, fullName: true },
  });
  await createSession(admin.id);

  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  const dangMo = async (id: string): Promise<boolean> =>
    (await prisma.brokerAccount.findUniqueOrThrow({ where: { id }, select: { isActive: true } }))
      .isActive;

  const formId = (id: string): FormData => {
    const f = new FormData();
    f.set('id', id);
    return f;
  };

  const formTien = (accountId: string, amount: bigint): FormData => {
    const f = new FormData();
    f.set('brokerAccountId', accountId);
    f.set('amount', String(amount));
    f.set('occurredAt', new Date().toISOString());
    return f;
  };

  /*
   * DỰNG MỘT TÀI KHOẢN TRỐNG RIÊNG CHO BÀI KIỂM.
   *
   * Không dùng tài khoản có sẵn: chúng đang có tiền và vị thế thật, nên phép kiểm 1
   * ("trống thì đóng được") sẽ không bao giờ chạy. Tạo bằng `prisma` trực tiếp vì đây là
   * NỀN — phần đang kiểm là `toggleBrokerAccountAction`.
   */
  const tk = await prisma.brokerAccount.create({
    data: {
      userId: admin.id,
      broker: 'VPS',
      accountNo: `KT${String(Date.now()).slice(-6)}`,
      isActive: true,
      note: 'Tài khoản dựng cho bài kiểm đóng tài khoản',
    },
    select: { id: true, broker: true, accountNo: true },
  });

  console.log(`Tài khoản kiểm: ${tk.broker} ${tk.accountNo}\n`);

  // =========================================================================
  // 1. Trống → đóng được
  // =========================================================================
  console.log('1. Tài khoản trống → đóng được');
  {
    const ly = await kiemDongTaiKhoan(portfolio.id, admin.id, tk.id);
    kiem(ly.soMaConGiu === 0 && ly.tienConLai === 0n && ly.soYeuCauCho === 0, 'nền: trống hoàn toàn');
    kiem(lyDoChuaDong(ly) === null, 'không có lý do nào chặn');

    const kq = await toggleBrokerAccountAction(null, formId(tk.id));
    kiem(kq.ok === true, 'đóng được', JSON.stringify(kq));
    kiem((await dangMo(tk.id)) === false, 'tài khoản đã đóng');
  }

  // =========================================================================
  // 6. Mở lại không cần điều kiện
  // =========================================================================
  console.log('\n6. Mở lại không cần điều kiện gì');
  {
    const kq = await toggleBrokerAccountAction(null, formId(tk.id));
    kiem(kq.ok === true, 'mở lại được', JSON.stringify(kq));
    kiem((await dangMo(tk.id)) === true, 'tài khoản đang mở');
  }

  // =========================================================================
  // 2. Còn tiền → từ chối
  // =========================================================================
  console.log('\n2. Còn tiền → từ chối');
  {
    await depositCapitalAction(null, formTien(tk.id, 50_000_000n));

    const conLai = (await computeAccountBalances(portfolio.id, admin.id)).find(
      (b) => b.accountId === tk.id,
    )?.available;
    kiem(conLai === 50_000_000n, `nền: tài khoản còn ${formatVnd(50_000_000n)}`, formatVnd(conLai ?? 0n));

    const kq = await toggleBrokerAccountAction(null, formId(tk.id));
    kiem(kq.ok === false, 'bị từ chối');
    kiem(kq.message?.includes('còn 50.000.000') === true, 'thông báo nêu đúng số tiền', kq.message);
    kiem((await dangMo(tk.id)) === true, 'tài khoản VẪN mở');
    console.log(`        thông báo: ${kq.message}`);
  }

  // =========================================================================
  // 4. Còn yêu cầu rút chờ duyệt → từ chối
  // =========================================================================
  console.log('\n4. Còn yêu cầu rút chờ duyệt → từ chối');
  {
    const kqRut = await withdrawCapitalAction(null, formTien(tk.id, 50_000_000n));
    kiem(kqRut.ok === true, 'gửi được yêu cầu rút hết', JSON.stringify(kqRut));

    const ly = await kiemDongTaiKhoan(portfolio.id, admin.id, tk.id);
    kiem(ly.soYeuCauCho === 1, 'nền: có 1 yêu cầu chờ duyệt', String(ly.soYeuCauCho));

    const kq = await toggleBrokerAccountAction(null, formId(tk.id));
    kiem(kq.ok === false, 'bị từ chối');
    kiem(
      kq.message?.includes('chờ duyệt') === true,
      'thông báo nêu yêu cầu đang chờ duyệt',
      kq.message,
    );
    console.log(`        thông báo: ${kq.message}`);
  }

  // =========================================================================
  // 3. Còn mã đầu tư → từ chối
  // =========================================================================
  console.log('\n3. Còn mã đầu tư → từ chối');
  {
    /*
     * Ghi một lệnh MUA trực tiếp bằng `prisma`: đi qua `createTradeAction` sẽ phải dựng
     * thêm phân bổ chiến lược, ngưỡng duyệt và đủ tiền — toàn bộ là NỀN, không phải thứ
     * đang kiểm. Điều cần dựng chỉ là "tài khoản này còn một vị thế".
     */
    const ma = await prisma.stock.findFirstOrThrow({
      where: { status: 'ACTIVE', symbol: 'FPT' },
      select: { id: true, symbol: true },
    });

    await prisma.trade.create({
      data: {
        code: `TXN-TEST-${String(Date.now()).slice(-6)}`,
        portfolioId: portfolio.id,
        stockId: ma.id,
        transactionType: 'BUY',
        quantity: 1_000,
        price: 100_000n,
        fees: 0n,
        tax: 0n,
        executedAt: new Date(),
        status: 'EXECUTED',
        userId: admin.id,
        brokerAccountId: tk.id,
        createdById: admin.id,
      },
    });

    const ly = await kiemDongTaiKhoan(portfolio.id, admin.id, tk.id);
    kiem(ly.soMaConGiu === 1 && ly.maConGiu[0] === 'FPT', 'nền: còn đúng 1 mã FPT', JSON.stringify(ly.maConGiu));

    const kq = await toggleBrokerAccountAction(null, formId(tk.id));
    kiem(kq.ok === false, 'bị từ chối');
    kiem(kq.message?.includes('FPT') === true, 'thông báo nêu đúng tên mã còn giữ', kq.message);
    kiem((await dangMo(tk.id)) === true, 'tài khoản VẪN mở');
    console.log(`        thông báo: ${kq.message}`);
  }

  // =========================================================================
  // 5. Số dư ÂM cũng chặn
  // =========================================================================
  console.log('\n5. Số dư âm cũng chặn');
  {
    /*
     * Lệnh mua ở mục 3 tốn 100 triệu trong khi tài khoản chỉ có 50 triệu, nên số dư nay
     * âm. Đây đúng là trạng thái "vốn nạp chưa khai đủ" — đóng lại là chốt sổ một tài
     * khoản đang sai, nên nó phải bị chặn chứ không được coi là "hết tiền".
     */
    const conLai = (await computeAccountBalances(portfolio.id, admin.id)).find(
      (b) => b.accountId === tk.id,
    )?.available;

    kiem((conLai ?? 0n) < 0n, `nền: số dư âm ${formatVnd(conLai ?? 0n)}`, formatVnd(conLai ?? 0n));

    const ly = await kiemDongTaiKhoan(portfolio.id, admin.id, tk.id);
    const loi = lyDoChuaDong(ly);
    kiem(loi !== null, 'vẫn có lý do chặn');
    kiem(loi?.includes('âm') === true, 'nói rõ số dư đang âm', loi ?? '');
    console.log(`        thông báo: ${loi}`);
  }

  // =========================================================================
  // 7. Chỉ chủ tài khoản đổi được trạng thái
  // =========================================================================
  console.log('\n7. Người khác không đổi được trạng thái tài khoản này');
  {
    /*
     * PHẢI LOẠI người đang bị buộc đổi mật khẩu. `requireUser()` chuyển hướng họ sang
     * /change-password TRƯỚC khi tới chốt sở hữu, nên bài kiểm sẽ ném lỗi chuyển hướng và
     * không kiểm được điều nó cần kiểm.
     */
    const nguoiKhac = await prisma.user.findFirst({
      where: {
        id: { not: admin.id },
        status: USER_STATUS.ACTIVE,
        mustChangePassword: false,
      },
      select: { id: true, fullName: true },
    });

    if (!nguoiKhac) {
      console.log('  BOQUA: khong co nguoi dung nao khac');
    } else {
      await createSession(nguoiKhac.id);
      const kq = await toggleBrokerAccountAction(null, formId(tk.id));
      kiem(kq.ok === false, `${nguoiKhac.fullName} không đổi được`);
      kiem(
        kq.message?.includes('Chỉ chủ tài khoản') === true,
        'thông báo nói rõ lý do',
        kq.message,
      );
      await createSession(admin.id);
    }
  }

  // =========================================================================
  // 1b. Dọn sạch rồi đóng được — chứng minh chốt KHÔNG chặn oan
  // =========================================================================
  console.log('\n8. Bán hết và rút hết → đóng được (chốt không chặn oan)');
  {
    const ma = await prisma.stock.findFirstOrThrow({ where: { symbol: 'FPT' }, select: { id: true } });

    // Bán hết vị thế.
    await prisma.trade.create({
      data: {
        code: `TXN-TEST-${String(Date.now() + 1).slice(-6)}`,
        portfolioId: portfolio.id,
        stockId: ma.id,
        transactionType: 'SELL',
        quantity: 1_000,
        price: 100_000n,
        fees: 0n,
        tax: 0n,
        executedAt: new Date(),
        status: 'EXECUTED',
        userId: admin.id,
        brokerAccountId: tk.id,
        createdById: admin.id,
      },
    });

    // Xử lý yêu cầu rút đang chờ và đưa tiền về 0.
    await prisma.capitalFlow.updateMany({
      where: { brokerAccountId: tk.id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });

    const conLai = (await computeAccountBalances(portfolio.id, admin.id)).find(
      (b) => b.accountId === tk.id,
    )?.available ?? 0n;

    if (conLai !== 0n) {
      await prisma.capitalFlow.create({
        data: {
          portfolioId: portfolio.id,
          brokerAccountId: tk.id,
          flowType: conLai > 0n ? 'WITHDRAWAL' : 'CONTRIBUTION',
          amount: conLai > 0n ? conLai : -conLai,
          occurredAt: new Date(),
          status: 'CONFIRMED',
          createdById: admin.id,
          note: 'Dọn sạch cho bài kiểm',
        },
      });
    }

    const ly = await kiemDongTaiKhoan(portfolio.id, admin.id, tk.id);
    kiem(
      ly.soMaConGiu === 0 && ly.tienConLai === 0n && ly.soYeuCauCho === 0,
      'nền: đã sạch cả ba điều kiện',
      JSON.stringify({ ma: ly.maConGiu, tien: String(ly.tienConLai), cho: ly.soYeuCauCho }),
    );

    const kq = await toggleBrokerAccountAction(null, formId(tk.id));
    kiem(kq.ok === true, 'đóng được sau khi dọn sạch', JSON.stringify(kq));
    kiem((await dangMo(tk.id)) === false, 'tài khoản đã đóng');
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
