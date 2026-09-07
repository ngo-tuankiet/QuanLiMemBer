/**
 * SOÁT TÍNH TOÀN VẸN CỦA PHẠM VI NHÓM.
 *
 * `trades.teamId` được đóng băng lúc ghi lệnh: lịch sử không đổi theo hiện tại. Hệ quả
 * là LỆNH MUA VÀ LỆNH BÁN CỦA CÙNG MỘT LÔ có thể rơi vào hai nhóm khác nhau — khi người
 * thực hiện đổi nhóm giữa hai lệnh, hoặc khi lệnh cũ chưa gắn nhóm nào.
 *
 * Lúc đó mọi con số theo nhóm đều sai, và sai theo kiểu KHÔNG BÁO LỖI:
 *
 *   nhóm thấy lệnh bán mà không thấy lệnh mua
 *     → giá vốn bình quân = 0
 *     → "lãi đã chốt" = TOÀN BỘ tiền bán, dù lô đó thực ra lỗ
 *     → vốn triển khai âm
 *     → khối lượng âm nên vị thế bị lọc mất, trang hiện "0 mã đang giữ"
 *
 *   nhóm thấy lệnh mua mà không thấy lệnh bán
 *     → vị thế phình ra, lãi/lỗ chưa chốt tính trên số cổ phiếu đã bán mất rồi
 *
 * Script này chỉ ĐỌC. Nó tìm mọi cặp (nhóm, mã) có khối lượng ròng ÂM — dấu hiệu chắc
 * chắn của việc lệnh bán bị tách khỏi lệnh mua — và mọi mã có lệnh nằm ở nhiều nhóm.
 *
 * Dùng: npm run check:team-scope
 */

import { prisma } from '@/lib/prisma';
import { TRANSACTION_TYPE, COUNTED_TRADE_STATUS } from '@/lib/enums';

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true, nameVi: true, name: true },
  });

  const teams = await prisma.team.findMany({ select: { id: true, nameVi: true } });
  const tenNhom = new Map(teams.map((t) => [t.id, t.nameVi]));
  const nhan = (id: string | null) => (id === null ? '(chưa gắn nhóm)' : (tenNhom.get(id) ?? id));

  const trades = await prisma.trade.findMany({
    where: { portfolioId: portfolio.id, status: COUNTED_TRADE_STATUS },
    select: {
      code: true,
      teamId: true,
      quantity: true,
      transactionType: true,
      executedAt: true,
      stock: { select: { id: true, symbol: true } },
      executor: { select: { fullName: true, teamId: true } },
    },
    orderBy: { executedAt: 'asc' },
  });

  console.log(`Danh mục: ${portfolio.nameVi ?? portfolio.name} · ${trades.length} lệnh\n`);

  // ---- Khối lượng ròng theo (nhóm, mã) -----------------------------------
  const theoNhomMa = new Map<string, number>();
  const maTheoNhom = new Map<string, Set<string>>();

  for (const t of trades) {
    const key = `${t.teamId ?? 'NULL'}|${t.stock.symbol}`;
    const dau = t.transactionType === TRANSACTION_TYPE.BUY ? 1 : -1;
    theoNhomMa.set(key, (theoNhomMa.get(key) ?? 0) + t.quantity * dau);

    const ds = maTheoNhom.get(t.stock.symbol) ?? new Set<string>();
    ds.add(t.teamId ?? 'NULL');
    maTheoNhom.set(t.stock.symbol, ds);
  }

  const am = [...theoNhomMa.entries()].filter(([, q]) => q < 0);

  console.log('1. Cặp (nhóm, mã) có khối lượng ÂM — lệnh bán bị tách khỏi lệnh mua');
  if (am.length === 0) {
    console.log('   không có\n');
  } else {
    for (const [key, q] of am) {
      const [teamId, symbol] = key.split('|');
      console.log(`   ${nhan(teamId === 'NULL' ? null : teamId!)} · ${symbol}: ${q.toLocaleString('vi-VN')} CP`);

      const lienQuan = trades.filter((t) => t.stock.symbol === symbol);
      for (const t of lienQuan) {
        console.log(
          `      ${t.executedAt.toISOString().slice(0, 10)} ${t.code} ${t.transactionType} ` +
            `${t.quantity.toLocaleString('vi-VN')} — ${t.executor.fullName} · ` +
            `lệnh thuộc ${nhan(t.teamId)} · người nay thuộc ${nhan(t.executor.teamId)}`,
        );
      }
    }
    console.log('');
  }

  // ---- Mã bị trải trên nhiều nhóm ----------------------------------------
  const traiNhieuNhom = [...maTheoNhom.entries()].filter(([, ds]) => ds.size > 1);

  console.log('2. Mã có lệnh nằm ở NHIỀU nhóm — lãi/lỗ theo nhóm chia không đúng lô');
  if (traiNhieuNhom.length === 0) {
    console.log('   không có\n');
  } else {
    for (const [symbol, ds] of traiNhieuNhom) {
      console.log(
        `   ${symbol}: ${[...ds].map((id) => nhan(id === 'NULL' ? null : id)).join(' · ')}`,
      );
    }
    console.log('');
  }

  // ---- Lệnh có teamId khác nhóm hiện tại của người thực hiện --------------
  const lech = trades.filter((t) => (t.teamId ?? null) !== (t.executor.teamId ?? null));

  console.log('3. Lệnh có nhóm KHÁC nhóm hiện tại của người thực hiện');
  if (lech.length === 0) {
    console.log('   không có\n');
  } else {
    console.log(`   ${lech.length}/${trades.length} lệnh:`);
    for (const t of lech.slice(0, 20)) {
      console.log(
        `      ${t.code} ${t.stock.symbol} — ${t.executor.fullName}: ` +
          `lệnh ${nhan(t.teamId)} → người nay ${nhan(t.executor.teamId)}`,
      );
    }
    if (lech.length > 20) console.log(`      … và ${lech.length - 20} lệnh nữa`);
    console.log('');
  }

  const coVanDe = am.length > 0 || traiNhieuNhom.length > 0;
  console.log(
    coVanDe
      ? 'CÓ VẤN ĐỀ: số liệu theo nhóm ở trên đang sai. Xem chú thích đầu file để biết sai thế nào.'
      : 'Không phát hiện vấn đề về phạm vi nhóm.',
  );

  if (coVanDe) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('LOI:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
