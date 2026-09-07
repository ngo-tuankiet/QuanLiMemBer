/**
 * KIỂM THỬ QUỸ DỰ PHÒNG KHÔNG ĐƯỢC LÀM SỐ DƯ ÂM.
 *
 * `portfolios.reserveAmount` là một CHÍNH SÁCH — "giữ lại 480 triệu" — chứ không phải
 * khoản nợ. Bản đầu trừ thẳng nó khỏi số dư nên một danh mục chưa nạp vốn hiện
 * "Available Cash = −480 triệu", trong khi thực tế đang có 0 đồng.
 *
 * Bài này kiểm bốn vùng, và vùng quan trọng nhất là vùng KHÔNG ĐƯỢC ĐỔI:
 *
 *   1. tiền ≥ dự phòng   → mọi con số y như trước bản sửa (đây là mọi ca đang chạy đúng)
 *   2. 0 < tiền < dự phòng → giữ được đúng phần đang có, khả dụng về 0, ghi phần thiếu
 *   3. tiền = 0          → giữ 0 · khả dụng 0 · thiếu trọn mức cấu hình
 *   4. tiền ÂM           → VẪN ÂM, không bị phép kẹp che mất (đó là lỗi dữ liệu thật)
 *
 * Và một bất biến đúng ở mọi vùng:
 *
 *       cashBalance = availableCash + reserveAmount
 *
 * Chạy trên BẢN SAO database. Dùng: npm run test:cash-reserve
 */

import { prisma } from '@/lib/prisma';
import { computeCash } from '@/domain/portfolio-engine';
import { formatVnd } from '@/lib/money';

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
  const pf = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true, reserveAmount: true },
  });

  const admin = await prisma.user.findFirstOrThrow({
    where: { email: 'admin@vninvest.local' },
    select: { id: true },
  });

  const DU_PHONG = pf.reserveAmount;
  console.log(`Quỹ dự phòng cấu hình: ${formatVnd(DU_PHONG)}\n`);

  kiem(DU_PHONG > 0n, 'nền: danh mục CÓ đặt quỹ dự phòng — không thì bài kiểm vô nghĩa');

  /** Đặt số dư tiền về đúng một mức, rồi đo lại. */
  const datTien = async (muc: bigint) => {
    await prisma.capitalFlow.deleteMany({ where: { portfolioId: pf.id } });
    if (muc !== 0n) {
      await prisma.capitalFlow.create({
        data: {
          portfolioId: pf.id,
          flowType: muc > 0n ? 'CONTRIBUTION' : 'WITHDRAWAL',
          amount: muc > 0n ? muc : -muc,
          occurredAt: new Date(),
          status: 'CONFIRMED',
          createdById: admin.id,
          note: 'Dựng cho bài kiểm quỹ dự phòng',
        },
      });
    }
    return computeCash(pf.id);
  };

  const vung: { ten: string; tien: bigint; giu: bigint; khaDung: bigint; thieu: bigint }[] = [
    {
      ten: '1. tiền ≥ dự phòng — KHÔNG ĐƯỢC ĐỔI so với bản cũ',
      tien: DU_PHONG * 3n,
      giu: DU_PHONG,
      khaDung: DU_PHONG * 3n - DU_PHONG,
      thieu: 0n,
    },
    {
      ten: '2. 0 < tiền < dự phòng',
      tien: DU_PHONG / 2n,
      giu: DU_PHONG / 2n,
      khaDung: 0n,
      thieu: DU_PHONG - DU_PHONG / 2n,
    },
    {
      ten: '3. tiền = 0 — đúng tình huống sau khi dọn dữ liệu',
      tien: 0n,
      giu: 0n,
      khaDung: 0n,
      thieu: DU_PHONG,
    },
    {
      ten: '4. tiền ÂM — phép kẹp KHÔNG được che lỗi dữ liệu',
      tien: -100_000_000n,
      giu: 0n,
      khaDung: -100_000_000n,
      thieu: DU_PHONG,
    },
  ];

  for (const v of vung) {
    console.log(`\n${v.ten}`);
    const c = await datTien(v.tien);

    console.log(
      `        tiền ${formatVnd(c.cashBalance)} · giữ ${formatVnd(c.reserveAmount)} · ` +
        `khả dụng ${formatVnd(c.availableCash)} · thiếu ${formatVnd(c.reserveShortfall)}`,
    );

    kiem(c.cashBalance === v.tien, `số dư tiền = ${formatVnd(v.tien)}`, formatVnd(c.cashBalance));
    kiem(c.reserveAmount === v.giu, `giữ được ${formatVnd(v.giu)}`, formatVnd(c.reserveAmount));
    kiem(c.availableCash === v.khaDung, `khả dụng ${formatVnd(v.khaDung)}`, formatVnd(c.availableCash));
    kiem(c.reserveShortfall === v.thieu, `thiếu ${formatVnd(v.thieu)}`, formatVnd(c.reserveShortfall));

    /*
     * BẤT BIẾN: tiền = khả dụng + giữ được. Đúng ở CẢ vùng số dư âm — đó là điều phân biệt
     * một phép kẹp đúng với một phép `Math.max(0, …)` vội vàng làm mất tiền.
     */
    kiem(
      c.cashBalance === c.availableCash + c.reserveAmount,
      'bất biến: tiền = khả dụng + giữ được',
      `${formatVnd(c.cashBalance)} ≠ ${formatVnd(c.availableCash + c.reserveAmount)}`,
    );

    kiem(
      c.reserveAmount + c.reserveShortfall === DU_PHONG,
      'giữ được + thiếu = mức cấu hình',
      `${formatVnd(c.reserveAmount + c.reserveShortfall)} ≠ ${formatVnd(DU_PHONG)}`,
    );

    kiem(c.reserveAmount >= 0n, 'không giữ số âm');
  }

  /*
   * PHÉP KIỂM PHẢI BIẾT TRƯỢT: dựng lại công thức CŨ và xem nó có vi phạm không. Nếu
   * công thức cũ cũng đạt thì bài kiểm này không chứng minh được gì.
   */
  console.log('\n5. Chứng minh bài kiểm bắt được công thức cũ');
  {
    const c = await datTien(0n);
    const cuKhaDung = c.cashBalance - DU_PHONG;
    console.log(`        công thức cũ cho khả dụng: ${formatVnd(cuKhaDung)}`);
    kiem(
      cuKhaDung < 0n && c.availableCash === 0n,
      'công thức cũ ra số ÂM ở cùng dữ liệu, công thức mới ra 0',
      `cũ ${formatVnd(cuKhaDung)} · mới ${formatVnd(c.availableCash)}`,
    );
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
