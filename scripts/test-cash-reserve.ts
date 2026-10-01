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
 * ĐỔI NGHĨA THEO QUYẾT ĐỊNH CỦA NGƯỜI DÙNG: "tiền khả dụng" nay là TIỀN MẶT CÒN,
 * không trừ quỹ dự phòng. Phần trừ dự phòng có tên riêng là `deployableCash`.
 * Bài kiểm này canh `deployableCash` — chính con số mà `availableCash` từng mang —
 * nên mọi phép kiểm về phép kẹp dự phòng vẫn còn nguyên giá trị.
 *
 * Và một bất biến đúng ở mọi vùng:
 *
 *       cashBalance = deployableCash + reserveAmount
 *
 * Chạy trên BẢN SAO database. Dùng: npm run test:cash-reserve
 */

import { prisma } from '@/lib/prisma';
import { computeCash, computePortfolioSummary } from '@/domain/portfolio-engine';
import { formatVnd, ratioToBps } from '@/lib/money';

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

  /*
   * BÀI KIỂM TỰ DỰNG QUỸ DỰ PHÒNG, KHÔNG ĐỌC CẤU HÌNH THẬT.
   *
   * Bản trước lấy `pf.reserveAmount` của database rồi tự kiểm "phải > 0". Ngày người
   * dùng đặt quỹ dự phòng về 0 — một thao tác hoàn toàn hợp lệ — cả bài kiểm đỏ rực
   * 10 dòng, trong khi sản phẩm không sai gì cả. Một bài kiểm đỏ vì cấu hình thay đổi
   * dạy người ta bỏ qua màu đỏ, và đó là thiệt hại lớn hơn hẳn thứ nó canh.
   *
   * Chạy trên BẢN SAO nên đặt giá trị ở đây không đụng gì tới cấu hình thật.
   */
  const DU_PHONG = 480_000_000n;
  await prisma.portfolio.update({
    where: { id: pf.id },
    data: { reserveAmount: DU_PHONG },
  });
  console.log(`Quỹ dự phòng bài kiểm tự đặt: ${formatVnd(DU_PHONG)}\n`);

  /**
   * Đặt số dư tiền về ĐÚNG một mức, rồi đo lại.
   *
   * TIỀN KHÔNG CHỈ ĐẾN TỪ `capital_flows`. Nó còn trừ tiền mua và cộng tiền bán, nên
   * xoá sạch dòng vốn KHÔNG đưa số dư về 0 — bản sao vẫn mang theo lệnh thật. Bản
   * trước bỏ qua điều này và mọi mức đặt đều lệch đúng bằng phần tiền do lệnh tạo ra.
   *
   * Cách làm: đo phần "không phải dòng vốn" trước, rồi tạo một dòng bù đúng phần còn
   * thiếu. Nhờ vậy bài kiểm không phụ thuộc vào việc bản sao có bao nhiêu lệnh.
   */
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
        `khả dụng ${formatVnd(c.deployableCash)} · thiếu ${formatVnd(c.reserveShortfall)}`,
    );

    kiem(c.cashBalance === v.tien, `số dư tiền = ${formatVnd(v.tien)}`, formatVnd(c.cashBalance));
    kiem(c.reserveAmount === v.giu, `giữ được ${formatVnd(v.giu)}`, formatVnd(c.reserveAmount));
    kiem(c.deployableCash === v.khaDung, `khả dụng ${formatVnd(v.khaDung)}`, formatVnd(c.deployableCash));
    kiem(c.reserveShortfall === v.thieu, `thiếu ${formatVnd(v.thieu)}`, formatVnd(c.reserveShortfall));

    /*
     * BẤT BIẾN: tiền = khả dụng + giữ được. Đúng ở CẢ vùng số dư âm — đó là điều phân biệt
     * một phép kẹp đúng với một phép `Math.max(0, …)` vội vàng làm mất tiền.
     */
    kiem(
      c.cashBalance === c.deployableCash + c.reserveAmount,
      'bất biến: tiền = giải ngân được + giữ được',
      `${formatVnd(c.cashBalance)} ≠ ${formatVnd(c.deployableCash + c.reserveAmount)}`,
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
      cuKhaDung < 0n && c.deployableCash === 0n,
      'công thức cũ ra số ÂM ở cùng dữ liệu, công thức mới ra 0',
      `cũ ${formatVnd(cuKhaDung)} · mới ${formatVnd(c.deployableCash)}`,
    );
  }

  // -------------------------------------------------------------------------
  console.log('\n6. Biểu đồ phân bổ: tiền là MỘT phần, quỹ dự phòng nằm bên trong');
  // -------------------------------------------------------------------------
  {
    /*
     * Người dùng đã chọn gộp "Tiền khả dụng" và "Quỹ dự phòng" thành một lát.
     *
     * Trên database thật quỹ dự phòng đang bằng 0, nên nhìn màn hình KHÔNG phân biệt
     * được lát tiền lấy theo số dư hay theo phần khả dụng — hai con số bằng nhau. Chỉ
     * khi quỹ dự phòng khác 0 mới lộ ra, và đó đúng là trạng thái mục này dựng.
     */
    const c = await datTien(DU_PHONG * 3n);
    const tt = await computePortfolioSummary({ portfolioId: pf.id });

    const theoSoDu = ratioToBps(c.cashBalance, tt.portfolioValue);
    const theoKhaDung = ratioToBps(c.deployableCash, tt.portfolioValue);

    kiem(
      tt.allocation.cashBps === theoSoDu,
      'lát tiền tính theo SỐ DƯ (đã gồm quỹ dự phòng)',
      `${tt.allocation.cashBps} vs ${theoSoDu}`,
    );

    /*
     * ĐỐI CHỨNG. Thiếu dòng này thì phép kiểm trên vẫn xanh kể cả khi lát tiền vẫn là
     * phần khả dụng — miễn quỹ dự phòng bằng 0. Ở đây nó khác 0, nên hai cách tính
     * BẮT BUỘC ra hai số khác nhau.
     */
    kiem(
      theoSoDu !== theoKhaDung,
      'hai cách tính thật sự khác nhau ở dữ liệu này — phép kiểm trên không rỗng',
      `số dư ${theoSoDu} vs khả dụng ${theoKhaDung}`,
    );

    kiem(
      tt.allocation.reserveBps > 0 &&
        tt.allocation.reserveBps <= tt.allocation.cashBps,
      'quỹ dự phòng nằm TRONG phần tiền, không vượt ra ngoài',
      `${tt.allocation.reserveBps} / ${tt.allocation.cashBps}`,
    );

    kiem(
      Math.abs(tt.allocation.investedBps + tt.allocation.cashBps - 10_000) <= 3,
      'đầu tư + tiền = 100% giá trị danh mục',
      `${tt.allocation.investedBps + tt.allocation.cashBps}`,
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
