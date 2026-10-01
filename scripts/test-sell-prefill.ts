/**
 * KIỂM THỬ PHÉP CHIA ĐIỀN SẴN CỦA FORM BÁN.
 *
 * Form điền sẵn khối lượng theo tỷ trọng đang giữ: `allocateAmount(q, bpsFromWeights(trần))`.
 * Server nhận bộ số đó rồi đổi ngược lại: `allocateAmount(q, bpsFromWeights(nhập))` phải
 * dựng lại đúng bộ số vừa nhập, nếu không thì TỪ CHỐI.
 *
 * Hai phép `bpsFromWeights` chạy trên hai đầu vào KHÁC NHAU — trần khi điền sẵn, và
 * chính bộ số đã điền khi kiểm. Không có gì bảo đảm sẵn rằng chúng cho cùng một bộ bps.
 * Nếu lệch, form sẽ điền sẵn một bộ số mà chính server từ chối — lỗi tệ nhất có thể có
 * ở đây, vì người dùng không sửa gì cả mà vẫn bị từ chối.
 *
 * Bốn điều cần đúng với mọi (trần, khối lượng bán):
 *
 *   1. tổng phần chia bằng ĐÚNG khối lượng bán      (chốt "tổng phải khớp" của server)
 *   2. không dòng nào vượt trần của nó               (chốt "không bán quá số đã mua")
 *   3. đổi qua rồi đổi lại KHỚP TUYỆT ĐỐI            (chốt round-trip của server)
 *   4. không âm
 *
 * Chạy trên vị thế THẬT trong database, cộng các ca dựng riêng để chọc vào chỗ làm
 * tròn dễ vỡ nhất (trần 1 cổ phiếu, trần lệch nhau 10.000 lần, số nguyên tố).
 *
 * Chỉ ĐỌC database. Dùng: npm run test:sell-prefill
 */

import { prisma } from '@/lib/prisma';
import { allocateAmount, bpsFromWeights } from '@/lib/money';
import { computeStrategyHoldings } from '@/domain/portfolio-engine';

let dat = 0;
let truot = 0;

/** Các ca không biểu diễn được ở 0,01% — form chặn trước, đếm riêng để nhìn thấy. */
const khongLuuDuoc: string[] = [];

function kiem(dieuKien: boolean, nhan: string, chiTiet = ''): void {
  if (dieuKien) {
    dat++;
  } else {
    truot++;
    console.log(`  TRUOT ${nhan}${chiTiet ? ` -> ${chiTiet}` : ''}`);
  }
}

/**
 * Đúng phép form dùng để điền sẵn. Giữ một bản ở đây vì file form là 'use client'.
 *
 * Phải khớp `chiaTheoTyTrong` trong `TradeForm.tsx`. Bản đầu của bài kiểm này thiếu
 * cả nhánh bán hết và phần kẹp trần, và chính nó đã bắt ra rằng phép chia trần thuần
 * `bpsFromWeights` đẩy một dòng lên trên trần của nó.
 */
function chiaTheoTyTrong(tran: number[], soBan: number): number[] {
  const tongTran = tran.reduce((a, b) => a + b, 0);

  // Bán hết: mỗi chiến lược bán đúng số đang giữ, không qua phép làm tròn nào.
  if (soBan === tongTran) return [...tran];

  const bps = bpsFromWeights(tran.map((x) => BigInt(x)));
  const chia = allocateAmount(BigInt(soBan), bps).map((x) => Number(x));

  // Kẹp vào trần rồi dồn phần thừa sang dòng còn chỗ — chỉ di chuyển, không tạo thêm.
  let thua = 0;
  for (let i = 0; i < chia.length; i++) {
    const t = tran[i] ?? 0;
    if (chia[i]! > t) {
      thua += chia[i]! - t;
      chia[i] = t;
    }
  }

  while (thua > 0) {
    const con = chia
      .map((v, i) => ({ i, cho: (tran[i] ?? 0) - v }))
      .filter((x) => x.cho > 0)
      .sort((a, b) => b.cho - a.cho);

    if (con.length === 0) break;

    const them = Math.min(thua, con[0]!.cho);
    chia[con[0]!.i] = chia[con[0]!.i]! + them;
    thua -= them;
  }

  return chia;
}

/** Phép `luuDuoc` của form — cũng chính là chốt round-trip của server. */
function luuDuoc(khoiLuong: number[], soBan: number): boolean {
  const guiDi = khoiLuong.filter((v) => v > 0);
  if (guiDi.length === 0) return false;

  const bps = bpsFromWeights(guiDi.map((x) => BigInt(x)));
  const dungLai = allocateAmount(BigInt(soBan), bps);
  return guiDi.every((v, i) => dungLai[i] === BigInt(v));
}

/**
 * Kiểm một ca điền sẵn. Trả về `null` nếu đạt, hoặc câu nói rõ nó vỡ ở đâu.
 *
 * TÁCH HAI LOẠI KẾT LUẬN, vì chúng khác nhau về bản chất:
 *
 *   HỢP ĐỒNG CỦA FORM — tổng khớp, không vượt trần, không âm. Luôn phải đúng. Vi
 *   phạm là lỗi của form: nó bày ra một con số sai.
 *
 *   LƯU ĐƯỢC — bộ số có biểu diễn được ở độ phân giải bps 0,01% không. Với trần lệch
 *   nhau trên 10.000 lần thì KHÔNG, và đó không phải lỗi: không tồn tại cách chia
 *   nào lưu được, nên lệnh đó buộc phải tách làm hai. Điều kiện đúng ở đây là FORM
 *   PHẢI CHẶN TRƯỚC (`luuDuoc` = false → nút Ghi lệnh tắt), chứ không phải là mọi
 *   ca đều lưu được.
 *
 * Gộp hai loại lại thì bài kiểm buộc phải chọn: hoặc báo trượt một hạn chế có thật
 * của cách lưu trữ, hoặc bỏ qua luôn cả lỗi vượt trần. Cả hai đều sai.
 */
function thu(tran: number[], soBan: number): string | null {
  const chia = chiaTheoTyTrong(tran, soBan);

  const tong = chia.reduce((a, b) => a + b, 0);
  if (tong !== soBan) return `tổng ${tong} ≠ khối lượng bán ${soBan}`;

  const iVuot = chia.findIndex((v, i) => v > tran[i]!);
  if (iVuot >= 0) return `dòng ${iVuot} điền ${chia[iVuot]} vượt trần ${tran[iVuot]}`;

  const iAm = chia.findIndex((v) => v < 0);
  if (iAm >= 0) return `dòng ${iAm} âm (${chia[iAm]})`;

  /*
   * PHÉP ĐỔI NGƯỢC — đúng những dòng server chạy.
   *
   * Server chỉ nhận các dòng CÓ SỐ (`readSellQuantities` bỏ qua ô trống và ô 0), nên
   * lọc trước rồi mới đổi, y như server. Không lọc thì bài kiểm này soi một đầu vào
   * server không bao giờ thấy.
   */
  if (chia.every((v) => v === 0)) return `không dòng nào có số (bán ${soBan})`;

  /*
   * Round-trip: form và server chạy CÙNG phép này. Miễn hai bên cùng kết luận thì
   * người bán không bao giờ gặp cảnh bấm Ghi lệnh rồi bị từ chối — form tắt nút
   * trước. Ca không lưu được vẫn tính là ĐẠT, và ghi lại để đếm riêng.
   */
  if (!luuDuoc(chia, soBan)) khongLuuDuoc.push(`[${tran}] bán ${soBan} → [${chia}]`);

  return null;
}

async function main(): Promise<void> {
  // =========================================================================
  // 1. Vị thế THẬT trong database
  // =========================================================================
  console.log('1. Vị thế thật — mọi người, mọi mã, quét khối lượng bán');

  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  const nguoi = await prisma.user.findMany({
    where: { tradesExecuted: { some: { portfolioId: portfolio.id } } },
    select: { id: true, fullName: true },
  });

  let soCa = 0;
  let soViThe = 0;

  /*
   * QUÉT THEO TỪNG TÀI KHOẢN, cộng một lượt theo cả người.
   *
   * Form bán lấy trần theo tài khoản, nên đó là tập hợp đầu vào thật. Nhưng vẫn quét
   * cả mức người: 15/16 lệnh trong dữ liệu chưa gắn tài khoản, nên nếu chỉ quét theo
   * tài khoản thì bài kiểm gần như không có ca nào để chạy và sẽ luôn xanh vô nghĩa.
   */
  const phamVi: { ten: string; userId: string; tkId?: string }[] = [];
  for (const n of nguoi) {
    phamVi.push({ ten: `${n.fullName} (cả người)`, userId: n.id });
    const tk = await prisma.brokerAccount.findMany({
      where: { userId: n.id },
      select: { id: true, broker: true, accountNo: true },
    });
    for (const a of tk) {
      phamVi.push({ ten: `${n.fullName} · ${a.broker} ${a.accountNo}`, userId: n.id, tkId: a.id });
    }
  }

  for (const pv of phamVi) {
    const kho = await computeStrategyHoldings(portfolio.id, pv.userId, pv.tkId);

    for (const h of kho) {
      if (h.quantity <= 0) continue;
      soViThe++;

      const tran = h.byStrategy.map((x) => x.quantity);

      /*
       * Quét khối lượng bán: các mốc nhỏ, các mốc quanh biên, và bán hết. Bán hết là
       * ca dễ vỡ nhất — mọi dòng chạm đúng trần nên chỉ lệch 1 là vượt.
       */
      const mocs = new Set<number>([
        1,
        2,
        99,
        100,
        101,
        1_000,
        Math.floor(h.quantity / 3),
        Math.floor(h.quantity / 2),
        h.quantity - 1,
        h.quantity,
      ]);

      for (const q of mocs) {
        if (q <= 0 || q > h.quantity) continue;
        soCa++;
        const loi = thu(tran, q);
        kiem(loi === null, `${pv.ten} bán ${q} ${h.symbol} (trần [${tran}])`, loi ?? '');
      }
    }
  }

  console.log(`  ${soViThe} vị thế · ${soCa} ca · ${truot === 0 ? 'tất cả đạt' : `${truot} trượt`}`);

  // =========================================================================
  // 2. Ca dựng riêng — chọc vào chỗ làm tròn dễ vỡ nhất
  // =========================================================================
  console.log('\n2. Ca dựng riêng — biên của phép làm tròn');

  const truotTruoc = truot;

  const caDung: { ten: string; tran: number[] }[] = [
    { ten: 'trần 1 cổ phiếu', tran: [1, 1, 1] },
    { ten: 'một dòng cực nhỏ', tran: [1, 999_999] },
    { ten: 'lệch 10.000 lần', tran: [1, 10_000, 100_000_000] },
    { ten: 'số nguyên tố', tran: [7, 13, 97] },
    { ten: 'bằng nhau chia 3', tran: [1_000, 1_000, 1_000] },
    { ten: 'một chiến lược duy nhất', tran: [12_345] },
    { ten: 'bảy chiến lược lệch nhau', tran: [3, 11, 47, 101, 997, 4_999, 30_011] },
    { ten: 'hai dòng 33/67', tran: [33, 67] },
  ];

  for (const c of caDung) {
    const tong = c.tran.reduce((a, b) => a + b, 0);
    const mocs = new Set<number>([1, 2, 3, 7, 100, Math.floor(tong / 2), tong - 1, tong]);

    let loiDau: string | null = null;
    let soThu = 0;

    for (const q of mocs) {
      if (q <= 0 || q > tong) continue;
      soThu++;
      const loi = thu(c.tran, q);
      if (loi !== null && loiDau === null) loiDau = `bán ${q}: ${loi}`;
    }

    kiem(loiDau === null, `${c.ten} [${c.tran}] — ${soThu} mốc`, loiDau ?? '');
  }

  if (truot === truotTruoc) console.log(`  ${caDung.length}/${caDung.length} ca dựng riêng đạt`);

  // =========================================================================
  // 3. Bài kiểm phải BIẾT TRƯỢT — nếu không, nó không kiểm gì cả
  // =========================================================================
  console.log('\n3. Chứng minh bài kiểm bắt được lỗi thật');

  // Chia đều bất chấp trần: đúng cái người ta hay làm thay cho tỷ trọng.
  function chiaDeuSai(tran: number[], soBan: number): number[] {
    const moi = Math.floor(soBan / tran.length);
    return tran.map((_, i) => (i === 0 ? soBan - moi * (tran.length - 1) : moi));
  }

  {
    const tran = [1, 999_999];
    const sai = chiaDeuSai(tran, 1_000);
    const coVuot = sai.some((v, i) => v > tran[i]!);
    kiem(coVuot, 'chia đều bất chấp trần THÌ vượt trần — phép kiểm 2 có tác dụng',
      `[${sai}] với trần [${tran}]`);
  }

  {
    // Bộ số mà server không dựng lại được: một dòng chiếm dưới 0,01% tổng.
    const guiDi = [1, 999_999];
    const soBan = 1_000_000;
    const bps = bpsFromWeights(guiDi.map((x) => BigInt(x)));
    const dungLai = allocateAmount(BigInt(soBan), bps).map((x) => Number(x));
    kiem(
      guiDi.some((v, i) => v !== dungLai[i]),
      'bộ số dưới 0,01% THÌ server dựng lại lệch — phép kiểm 3 có tác dụng',
      `gửi [${guiDi}] dựng [${dungLai}] bps [${bps}]`,
    );

    /*
     * Bán hết trần [1, 999.999] BUỘC phải ra đúng [1, 999.999] — không có cách chia
     * nào khác vừa đủ tổng vừa trong trần. Bộ đó không lưu được, nên điều kiện đúng
     * là: form điền đúng số thật, và `luuDuoc` nói KHÔNG để nút Ghi lệnh tắt.
     */
    const banHet = chiaTheoTyTrong([1, 999_999], 1_000_000);
    kiem(
      banHet[0] === 1 && banHet[1] === 999_999,
      'bán hết điền đúng trần thật, không vượt',
      `[${banHet}]`,
    );
    kiem(
      !luuDuoc(banHet, 1_000_000),
      'và form CHẶN nó lại vì không lưu được — người bán không bấm rồi mới biết',
    );
  }

  if (khongLuuDuoc.length > 0) {
    console.log(
      `\n${khongLuuDuoc.length} ca không biểu diễn được ở 0,01% — form chặn trước, ` +
        'không phải lỗi:',
    );
    for (const c of khongLuuDuoc.slice(0, 6)) console.log(`  ${c}`);
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
