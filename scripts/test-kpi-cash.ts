/**
 * KIỂM THỬ Ô "TIỀN KHẢ DỤNG" — con số và phần trăm phải nói về CÙNG MỘT THỨ.
 *
 * SAU KHI ĐỔI NGHĨA (quyết định của người dùng): ô "Tiền khả dụng" hiện TIỀN MẶT
 * CÒN, không trừ quỹ dự phòng. Phần trừ dự phòng là `deployableCash`, hiện ở dòng
 * phụ. Bài này canh cả hai, và canh chúng KHÁC NHAU khi có dự phòng — nếu bằng nhau
 * thì việc tách hai khái niệm đã không có tác dụng gì.
 *
 * LỖI ĐÃ XẢY RA THẬT, và nó không làm gì hỏng cả — chỉ làm thẻ tự mâu thuẫn:
 *
 *     Tiền khả dụng
 *     ₫0
 *     14.84% danh mục · giữ 440,95 triệu quỹ dự phòng
 *
 * Số không đồng mà chiếm 14,84% danh mục. Nguyên nhân: ô lấy giá trị từ
 * `cash.availableCash` nhưng lấy phần trăm từ `allocation.cashBps` — thứ đã được đổi
 * thành tỷ trọng của TOÀN BỘ số dư tiền khi biểu đồ phân bổ gộp hai lát làm một.
 *
 * Bài này canh ba điều:
 *
 *   1. `availableCash` = tiền mặt còn · `deployableCash` = tiền mặt còn − phần giữ được
 *   2. phần trăm của ô = ratioToBps(availableCash, portfolioValue)
 *   3. khi số dư THẤP HƠN mức dự phòng: giải ngân được là 0, `reserveShortfall` khác 0,
 *      và ô vẫn hiện đúng số tiền mặt còn thay vì 0.
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:kpi-cash
 */

import { prisma } from '@/lib/prisma';
import { computeCash, computePortfolioSummary } from '@/domain/portfolio-engine';
import { formatVnd, ratioToBps } from '@/lib/money';
import { PORTFOLIO_STATUS, ROLE, USER_STATUS } from '@/lib/enums';

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
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    select: { id: true },
  });
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });

  /** Đặt số dư tiền về đúng một mức, không phụ thuộc lệnh có sẵn trong bản sao. */
  const datTien = async (muc: bigint) => {
    await prisma.capitalFlow.deleteMany({ where: { portfolioId: pf.id } });
    const nen = (await computeCash(pf.id)).cashBalance;
    const bu = muc - nen;
    if (bu !== 0n) {
      await prisma.capitalFlow.create({
        data: {
          portfolioId: pf.id,
          flowType: bu > 0n ? 'CONTRIBUTION' : 'WITHDRAWAL',
          amount: bu > 0n ? bu : -bu,
          occurredAt: new Date(),
          status: 'CONFIRMED',
          createdById: admin.id,
          note: 'Dựng cho bài kiểm ô Tiền khả dụng',
        },
      });
    }
  };

  const datDuPhong = (muc: bigint) =>
    prisma.portfolio.update({ where: { id: pf.id }, data: { reserveAmount: muc } });

  const doOKpi = async () => {
    const cash = await computeCash(pf.id);
    const s = await computePortfolioSummary({ portfolioId: pf.id });
    return {
      cash,
      s,
      /** Đúng công thức mà thẻ đang dùng: tỷ trọng của TIỀN MẶT CÒN. */
      bpsCuaO: ratioToBps(cash.availableCash, s.portfolioValue),
    };
  };

  console.log('\n1. Số dư THẤP HƠN mức dự phòng → tiền mặt còn nguyên, giải ngân được 0');
  {
    await datDuPhong(480_000_000n);
    await datTien(440_952_967n);
    const { cash, s, bpsCuaO } = await doOKpi();

    console.log(
      `        số dư ${formatVnd(cash.cashBalance)} · giữ ${formatVnd(cash.reserveAmount)} · thiếu ${formatVnd(cash.reserveShortfall)}`,
    );

    kiem(
      cash.availableCash === 440_952_967n,
      'tiền khả dụng = TIỀN MẶT CÒN, không bị trừ dự phòng',
      formatVnd(cash.availableCash),
    );
    kiem(
      cash.deployableCash === 0n,
      'giải ngân được = 0 (số dư thấp hơn mức dự phòng)',
      formatVnd(cash.deployableCash),
    );
    /*
     * ĐỐI CHỨNG CỦA VIỆC TÁCH HAI KHÁI NIỆM: ở đúng dữ liệu này hai con số phải KHÁC
     * nhau. Nếu ai gộp lại thì phép kiểm này đỏ ngay, chứ không chờ tới lúc có người
     * nhìn thấy số sai trên thẻ.
     */
    kiem(
      cash.availableCash !== cash.deployableCash,
      'hai con số KHÁC nhau — tách khái niệm có tác dụng thật',
      `${formatVnd(cash.availableCash)} vs ${formatVnd(cash.deployableCash)}`,
    );
    kiem(
      cash.reserveShortfall === 39_047_033n,
      'còn thiếu 39.047.033 ₫ so với chính sách',
      formatVnd(cash.reserveShortfall),
    );
    /*
     * Ô hiện tiền mặt còn, nên phần trăm của ô BẰNG tỷ trọng tiền của biểu đồ phân
     * bổ — hai chỗ cùng nói về một thứ thì phải ra cùng một số. Đây là điều kiện
     * ngược với bản trước, và nó đúng vì định nghĩa đã đổi.
     */
    kiem(
      bpsCuaO === s.allocation.cashBps,
      'phần trăm của ô = tỷ trọng tiền của biểu đồ phân bổ',
      `${bpsCuaO} vs ${s.allocation.cashBps}`,
    );
    kiem(bpsCuaO !== 0, 'phần trăm KHÁC 0 — vì tiền mặt còn thật', String(bpsCuaO));
  }

  console.log('\n2. Số dư CAO HƠN mức dự phòng → khả dụng dương, phần trăm khớp');
  {
    await datDuPhong(480_000_000n);
    await datTien(1_480_000_000n);
    const { cash, s, bpsCuaO } = await doOKpi();

    kiem(
      cash.availableCash === 1_480_000_000n,
      'tiền khả dụng = toàn bộ 1.480tr tiền mặt còn',
      formatVnd(cash.availableCash),
    );
    kiem(
      cash.deployableCash === 1_000_000_000n,
      'giải ngân được = 1.480tr − 480tr = 1 tỷ',
      formatVnd(cash.deployableCash),
    );
    kiem(cash.reserveShortfall === 0n, 'không thiếu gì so với chính sách');
    kiem(
      bpsCuaO === ratioToBps(1_480_000_000n, s.portfolioValue),
      'phần trăm của ô tính trên đúng 1.480tr',
      String(bpsCuaO),
    );
    kiem(
      ratioToBps(cash.deployableCash, s.portfolioValue) < bpsCuaO,
      'tỷ trọng phần giải ngân được NHỎ HƠN — vì đã trừ dự phòng',
    );
  }

  console.log('\n3. Không đặt dự phòng → hai cách tính trùng nhau');
  {
    await datDuPhong(0n);
    await datTien(1_000_000_000n);
    const { cash, s, bpsCuaO } = await doOKpi();

    kiem(cash.availableCash === cash.cashBalance, 'khả dụng = số dư');
    kiem(
      bpsCuaO === s.allocation.cashBps,
      'hai cách tính cho cùng một số khi không giữ gì',
      `${bpsCuaO} vs ${s.allocation.cashBps}`,
    );
  }

  console.log('\n4. Bất biến của engine ở mọi mức dự phòng');
  {
    for (const [duPhong, tien] of [
      [0n, 500_000_000n],
      [200_000_000n, 500_000_000n],
      [500_000_000n, 500_000_000n],
      [900_000_000n, 500_000_000n],
      [480_000_000n, 0n],
    ] as [bigint, bigint][]) {
      await datDuPhong(duPhong);
      await datTien(tien);
      const c = await computeCash(pf.id);
      kiem(
        c.cashBalance === c.deployableCash + c.reserveAmount,
        `dự phòng ${formatVnd(duPhong)} · tiền ${formatVnd(tien)}: số dư = giải ngân được + giữ được`,
        `${c.cashBalance} vs ${c.deployableCash}+${c.reserveAmount}`,
      );
      kiem(
        c.reserveAmount + c.reserveShortfall === duPhong,
        '  giữ được + còn thiếu = mức cấu hình',
        `${c.reserveAmount}+${c.reserveShortfall} vs ${duPhong}`,
      );
    }
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
