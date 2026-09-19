/**
 * GẮN NHÓM CHO NHỮNG LỆNH CŨ CHƯA CÓ NHÓM, KHI ĐIỀU ĐÓ VÁ LẠI MỘT LÔ BỊ CẮT.
 *
 * `trades.teamId` đóng băng lúc ghi lệnh — đó là chủ ý, để lịch sử không đổi theo hiện
 * tại. Nhưng lệnh CHƯA GẮN NHÓM NÀO (`null`) thì không có lịch sử gì để giữ: nó chỉ là
 * dữ liệu mồi hoặc lệnh nhập trước khi người thực hiện được xếp nhóm. Khi lệnh bán của
 * cùng lô đã nằm trong một nhóm, để lệnh mua ở `null` làm số liệu nhóm sai hoàn toàn.
 *
 * PHẠM VI HẸP, VÀ CHỈ SỬA KHI CÓ ÍCH:
 *
 *   - chỉ lệnh có `teamId = null`
 *   - chỉ khi người thực hiện HIỆN THUỘC một nhóm
 *   - chỉ khi trong nhóm đó, mã của lệnh đang có khối lượng ròng ÂM (tức là nhóm đang
 *     thấy lệnh bán mà thiếu lệnh mua) — nếu không có gì để vá thì không đụng vào
 *
 * KHÔNG đụng tới lệnh đã có nhóm: đổi nhóm một lệnh đã gắn là viết lại lịch sử, và chỉ
 * người dùng mới quyết định được điều đó.
 *
 *     npm run fix:trade-team           xem trước
 *     npm run fix:trade-team -- --yes  sửa thật (sao lưu prisma/dev.db trước)
 */

import { prisma } from '@/lib/prisma';
import { TRANSACTION_TYPE, COUNTED_TRADE_STATUS } from '@/lib/enums';

const THAT = process.argv.includes('--yes');

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  const teams = await prisma.team.findMany({ select: { id: true, nameVi: true } });
  const tenNhom = new Map(teams.map((t) => [t.id, t.nameVi]));

  const trades = await prisma.trade.findMany({
    where: { portfolioId: portfolio.id, status: COUNTED_TRADE_STATUS },
    select: {
      id: true,
      code: true,
      teamId: true,
      quantity: true,
      transactionType: true,
      stock: { select: { id: true, symbol: true } },
      executor: { select: { fullName: true, teamId: true } },
    },
  });

  /** Khối lượng ròng theo (nhóm, mã). */
  const rong = new Map<string, number>();
  for (const t of trades) {
    if (!t.teamId) continue;
    const key = `${t.teamId}|${t.stock.id}`;
    const dau = t.transactionType === TRANSACTION_TYPE.BUY ? 1 : -1;
    rong.set(key, (rong.get(key) ?? 0) + t.quantity * dau);
  }

  const canGan = trades.filter((t) => {
    if (t.teamId !== null) return false;
    if (!t.executor.teamId) return false;
    if (t.transactionType !== TRANSACTION_TYPE.BUY) return false;
    return (rong.get(`${t.executor.teamId}|${t.stock.id}`) ?? 0) < 0;
  });

  if (canGan.length === 0) {
    console.log('Không có lệnh nào cần gắn nhóm.');
    return;
  }

  console.log(`${canGan.length} lệnh sẽ được gắn nhóm:`);
  for (const t of canGan) {
    console.log(
      `  ${t.code} ${t.transactionType} ${t.quantity.toLocaleString('vi-VN')} ${t.stock.symbol} ` +
        `— ${t.executor.fullName}: (chưa gắn nhóm) → ${tenNhom.get(t.executor.teamId!) ?? '?'}`,
    );
    console.log(
      `      lý do: nhóm đó đang thiếu ${-(rong.get(`${t.executor.teamId}|${t.stock.id}`) ?? 0)} CP ${t.stock.symbol}`,
    );
  }

  if (!THAT) {
    console.log('\nXem trước. Chạy lại với  --yes  để sửa thật. Sao lưu prisma/dev.db trước.');
    return;
  }

  for (const t of canGan) {
    await prisma.trade.update({
      where: { id: t.id },
      data: { teamId: t.executor.teamId },
    });
  }

  console.log(`\nĐã gắn nhóm cho ${canGan.length} lệnh.`);

  // ---- Soát lại: không còn cặp (nhóm, mã) âm ------------------------------
  const sau = await prisma.trade.findMany({
    where: { portfolioId: portfolio.id, status: COUNTED_TRADE_STATUS },
    select: {
      teamId: true,
      quantity: true,
      transactionType: true,
      stock: { select: { id: true, symbol: true } },
    },
  });

  const rongSau = new Map<string, number>();
  for (const t of sau) {
    const key = `${t.teamId ?? 'NULL'}|${t.stock.symbol}`;
    const dau = t.transactionType === TRANSACTION_TYPE.BUY ? 1 : -1;
    rongSau.set(key, (rongSau.get(key) ?? 0) + t.quantity * dau);
  }

  const conAm = [...rongSau.entries()].filter(([, q]) => q < 0);
  if (conAm.length === 0) {
    console.log('Không còn cặp (nhóm, mã) nào âm.');
  } else {
    console.log('Còn cặp âm:');
    for (const [k, q] of conAm) console.log(`  ${k}: ${q}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error('LOI:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
