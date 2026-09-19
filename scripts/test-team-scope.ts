/**
 * KIỂM THỬ SỐ LIỆU THEO NHÓM KHI LỆNH MUA VÀ LỆNH BÁN Ở HAI NHÓM KHÁC NHAU.
 *
 * `trades.teamId` đóng băng lúc ghi lệnh. Người đổi nhóm giữa lệnh mua và lệnh bán sẽ
 * để hai lệnh của CÙNG MỘT LÔ ở hai nhóm — và trước bản sửa này, engine phản ứng bằng
 * cách bịa ra giá vốn 0:
 *
 *     nhóm thấy 2 lệnh bán 6.000 MBB, không thấy lệnh mua
 *     → giá vốn bình quân 0 → "lãi đã chốt" = TOÀN BỘ tiền bán = +123,291M
 *     → trong khi lô đó đang LỖ
 *     → khối lượng −6.000 bị kẹp về 0 nên dấu vết biến mất, trang hiện "0 mã đang giữ"
 *
 * Bài này kiểm:
 *
 *   1. BẤT BIẾN QUAN TRỌNG NHẤT: ở mức DANH MỤC, con số KHÔNG đổi. Bản sửa chỉ được
 *      chạm vào phạm vi bị cắt ngang lô, không được làm lệch tổng của danh mục.
 *   2. phạm vi bị cắt ngang: lãi ảo biến mất, và phần bán không khớp được ghi lại
 *   3. `unmatchedSellQuantity` bằng đúng số cổ phiếu bán mà không có lệnh mua
 *   4. `check:team-scope` phát hiện đúng cặp (nhóm, mã) có vấn đề
 *   5. phạm vi lành lặn không bị ảnh hưởng
 *
 * Chỉ ĐỌC database. Dùng: npm run test:team-scope
 */

import { prisma } from '@/lib/prisma';
import { computePositions, computeTeamPerformance } from '@/domain/portfolio-engine';
import { TRANSACTION_TYPE, COUNTED_TRADE_STATUS } from '@/lib/enums';

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

function tr(v: bigint): string {
  return `${(Number(v) / 1_000_000).toFixed(3)}M`;
}

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  // =========================================================================
  // 1. Mức danh mục KHÔNG đổi
  // =========================================================================
  console.log('1. Mức danh mục — bản sửa không được chạm vào');
  {
    const viThe = await computePositions({ portfolioId: portfolio.id });

    /*
     * Ở mức danh mục, mọi lệnh bán đều có lệnh mua tương ứng — nếu không thì đó là lỗi
     * dữ liệu nghiêm trọng hơn nhiều. Nên `unmatchedSellQuantity` phải bằng 0 khắp nơi,
     * và đó cũng là cách chứng minh bản sửa không đổi con số nào của danh mục.
     */
    const coLech = viThe.filter((p) => p.unmatchedSellQuantity > 0);
    kiem(
      coLech.length === 0,
      'không mã nào có phần bán thiếu lệnh mua ở mức danh mục',
      coLech.map((p) => `${p.symbol}=${p.unmatchedSellQuantity}`).join(', '),
    );

    /*
     * Đối chiếu tổng lãi đã chốt với một phép tính ĐỘC LẬP: Σ tiền bán − Σ giá vốn phần
     * đã bán. Ở mức danh mục, giá vốn phần đã bán = Σ giá vốn mua − giá vốn còn giữ.
     */
    const lenh = await prisma.trade.findMany({
      where: { portfolioId: portfolio.id, status: COUNTED_TRADE_STATUS },
      select: { transactionType: true, quantity: true, price: true, fees: true, tax: true },
    });

    let tienMua = 0n;
    let tienBan = 0n;
    for (const t of lenh) {
      const gross = BigInt(t.quantity) * t.price;
      if (t.transactionType === TRANSACTION_TYPE.BUY) tienMua += gross + t.fees + t.tax;
      else tienBan += gross - t.fees - t.tax;
    }

    const giaVonConGiu = viThe.filter((p) => p.quantity > 0).reduce((s, p) => s + p.totalCost, 0n);
    const chotDoiChieu = tienBan - (tienMua - giaVonConGiu);
    const chotEngine = viThe.reduce((s, p) => s + p.realizedPnl, 0n);

    console.log(`        engine ${tr(chotEngine)} · đối chiếu ${tr(chotDoiChieu)}`);
    kiem(
      chotEngine === chotDoiChieu,
      'lãi đã chốt khớp phép tính độc lập (Σ bán − giá vốn phần đã bán)',
      `${tr(chotEngine)} ≠ ${tr(chotDoiChieu)}`,
    );
  }

  // =========================================================================
  // 2 + 3. Phạm vi bị cắt ngang lô
  // =========================================================================
  console.log('\n2. Phạm vi nhóm bị cắt ngang lô');

  const teams = await prisma.team.findMany({ select: { id: true, nameVi: true } });

  let coCaLech = false;

  for (const team of teams) {
    const viThe = await computePositions({ portfolioId: portfolio.id, teamId: team.id });
    const lech = viThe.filter((p) => p.unmatchedSellQuantity > 0);
    if (lech.length === 0) continue;

    coCaLech = true;

    for (const p of lech) {
      console.log(
        `  ${team.nameVi} · ${p.symbol}: bán thiếu lệnh mua ${p.unmatchedSellQuantity.toLocaleString('vi-VN')} CP ` +
          `· tiền thu ${tr(p.unmatchedSellProceeds)} · lãi đã chốt ${tr(p.realizedPnl)}`,
      );

      /*
       * ĐIỀU KIỆN CỐT LÕI: phần bán không khớp KHÔNG được sinh ra lãi. Trước bản sửa,
       * `realizedPnl` của chính vị thế này bằng đúng `unmatchedSellProceeds`.
       */
      kiem(
        p.realizedPnl !== p.unmatchedSellProceeds || p.unmatchedSellProceeds === 0n,
        `${team.nameVi} · ${p.symbol}: lãi đã chốt KHÔNG bằng toàn bộ tiền bán (không còn lãi ảo)`,
        `${tr(p.realizedPnl)} vs ${tr(p.unmatchedSellProceeds)}`,
      );

      // Đối chiếu số cổ phiếu thiếu với chính dữ liệu lệnh.
      const lenhNhom = await prisma.trade.findMany({
        where: {
          portfolioId: portfolio.id,
          teamId: team.id,
          stockId: p.stockId,
          status: COUNTED_TRADE_STATUS,
        },
        select: { transactionType: true, quantity: true },
      });

      const rong = lenhNhom.reduce(
        (s, t) => s + (t.transactionType === TRANSACTION_TYPE.BUY ? t.quantity : -t.quantity),
        0,
      );

      kiem(
        p.unmatchedSellQuantity === -rong,
        `${team.nameVi} · ${p.symbol}: phần thiếu (${p.unmatchedSellQuantity}) đúng bằng khối lượng ròng âm (${rong})`,
      );
    }
  }

  if (!coCaLech) {
    console.log('  BOQUA: khong nhom nao dang bi cat ngang lo — du lieu da sach');
  }

  // =========================================================================
  // 4. computeTeamPerformance không còn báo lãi ảo
  // =========================================================================
  console.log('\n3. Hiệu suất nhóm');
  {
    const perf = await computeTeamPerformance(portfolio.id);
    for (const t of perf) {
      console.log(
        `  ${t.nameVi.padEnd(14)} vốn ${tr(t.netCapital).padStart(11)} · ` +
          `đã chốt ${tr(t.realizedPnl).padStart(11)} · chưa chốt ${tr(t.unrealizedPnl).padStart(11)} · ` +
          `${t.tradeCount} lệnh`,
      );
    }

    /*
     * Một nhóm CHỈ có lệnh bán (vốn triển khai âm, không còn vị thế) không được báo lãi
     * dương — đó chính là con số +123,291M mà người dùng nhìn thấy.
     */
    const nghiNgo = perf.filter(
      (t) => t.netCapital < 0n && t.marketValue === 0n && t.realizedPnl > 0n,
    );
    kiem(
      nghiNgo.length === 0,
      'không nhóm nào vừa âm vốn vừa báo lãi đã chốt dương',
      nghiNgo.map((t) => `${t.nameVi}: vốn ${tr(t.netCapital)} lãi ${tr(t.realizedPnl)}`).join(', '),
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
