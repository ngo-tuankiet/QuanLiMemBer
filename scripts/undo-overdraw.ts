/**
 * XOÁ CÁC LỆNH RÚT VỐN VƯỢT SỐ DƯ ĐÃ GHI TRƯỚC KHI CÓ CHỐT.
 *
 * Trước khi `recordFlow` có chốt "không rút quá số tiền còn lại", một lệnh rút bất kỳ
 * đều ghi được — kể cả lệnh rút 354.000.000 ₫ từ tài khoản còn 223.291.000 ₫. Kết quả
 * là số dư âm, thứ không tồn tại ở tài khoản chứng khoán thật.
 *
 * Script này chỉ xoá những dòng RÚT VỐN khiến số dư âm, và chỉ khi xoá xong số dư về
 * không âm. Nó KHÔNG xoá lệnh rút hợp lệ, không đụng tới lệnh nạp, không đụng tới giao
 * dịch.
 *
 * CÁCH CHỌN DÒNG ĐỂ XOÁ. Đi từ dòng rút MỚI NHẤT trở về trước, xoá dần cho tới khi số
 * dư không âm nữa. Lệnh rút mới nhất là ứng viên đúng nhất: những lệnh trước nó đã từng
 * hợp lệ ở thời điểm chúng được ghi, còn lệnh cuối mới là lệnh đẩy số dư qua 0.
 *
 * CHẠY THỬ TRƯỚC. Không có biến `--yes` thì script chỉ IN ra sẽ xoá gì, không xoá thật:
 *
 *     npm run fix:undo-overdraw          xem trước
 *     npm run fix:undo-overdraw -- --yes xoá thật (sao lưu prisma/dev.db trước)
 */

import { prisma } from '@/lib/prisma';
import { computeAccountBalances } from '@/domain/portfolio-engine';
import { formatVnd } from '@/lib/money';

const THAT = process.argv.includes('--yes');

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  const chuTaiKhoan = await prisma.user.findMany({
    where: { brokerAccounts: { some: {} } },
    select: { id: true, fullName: true },
  });

  const canXoa: { id: string; nhan: string; amount: bigint; occurredAt: Date }[] = [];

  for (const u of chuTaiKhoan) {
    for (const b of await computeAccountBalances(portfolio.id, u.id)) {
      if (b.available >= 0n) continue;

      const nhan = `${b.broker} ${b.accountNo} (${u.fullName})`;
      console.log(`${nhan}: còn ${formatVnd(b.available)}`);

      const ruts = await prisma.capitalFlow.findMany({
        where: { brokerAccountId: b.accountId, flowType: 'WITHDRAWAL', status: 'CONFIRMED' },
        orderBy: { occurredAt: 'desc' },
        select: { id: true, amount: true, occurredAt: true, note: true },
      });

      if (ruts.length === 0) {
        console.log('  không có lệnh rút nào — số âm đến từ nguyên nhân khác, xem npm run check:balances\n');
        continue;
      }

      /*
       * Cộng dần từ lệnh rút mới nhất: cần bù đủ phần âm. Dừng ngay khi đủ, không xoá
       * thêm — xoá quá là tự tạo ra tiền không có thật, đúng loại lỗi ngược lại.
       */
      let thieu = -b.available;
      for (const r of ruts) {
        if (thieu <= 0n) break;
        canXoa.push({ id: r.id, nhan, amount: r.amount, occurredAt: r.occurredAt });
        thieu -= r.amount;
        console.log(
          `  sẽ xoá: rút ${formatVnd(r.amount)} ngày ${r.occurredAt.toISOString().slice(0, 10)}` +
            `${r.note ? ` — ${r.note}` : ''}`,
        );
      }

      if (thieu > 0n) {
        console.log(
          `  CẢNH BÁO: xoá hết lệnh rút vẫn còn thiếu ${formatVnd(thieu)} — ` +
            'phần âm còn lại không do lệnh rút gây ra.',
        );
      }
      console.log('');
    }
  }

  if (canXoa.length === 0) {
    console.log('Không có lệnh rút nào cần xoá.');
    return;
  }

  if (!THAT) {
    console.log(
      `Xem trước: ${canXoa.length} dòng rút vốn sẽ bị xoá.\n` +
        'Chạy lại với  --yes  để xoá thật. Sao lưu prisma/dev.db trước.',
    );
    return;
  }

  await prisma.capitalFlow.deleteMany({ where: { id: { in: canXoa.map((x) => x.id) } } });

  console.log(`Đã xoá ${canXoa.length} dòng rút vốn.\n`);

  let conAm = 0;
  for (const u of chuTaiKhoan) {
    for (const b of await computeAccountBalances(portfolio.id, u.id)) {
      console.log(`  ${b.broker} ${b.accountNo}: còn ${formatVnd(b.available)}`);
      if (b.available < 0n) conAm++;
    }
  }

  console.log('');
  if (conAm === 0) {
    console.log('Không tài khoản nào âm tiền.');
  } else {
    console.log(`LỖI: còn ${conAm} tài khoản âm tiền.`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error('LOI:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
