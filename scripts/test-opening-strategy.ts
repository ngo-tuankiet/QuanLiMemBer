/**
 * KIỂM THỬ KHAI VỊ THẾ ĐẦU KỲ — CHIẾN LƯỢC THEO TỪNG MÃ.
 *
 * Trước đây form chỉ có MỘT chiến lược áp cho cả lô, nên mọi mã trong một tài khoản
 * mang cùng một luận điểm và lãi/lỗ theo chiến lược sai ngay từ ngày đầu. Nay mỗi dòng
 * mang chiến lược của chính nó.
 *
 * Bài này kiểm cả đường đi, không chỉ phép gán:
 *
 *   1. mỗi mã được ghi với ĐÚNG chiến lược của dòng đó, 100% (10000 bps)
 *   2. dữ liệu CHẢY VÀO hệ thống: vị thế theo chiến lược, vốn theo chiến lược, và vốn
 *      góp đều thấy được ngay sau khi lưu
 *   3. vốn góp = Σ (khối lượng × giá vốn) + tiền mặt còn — không thì số dư tài khoản âm
 *   4. một dòng chiến lược sai → TỪ CHỐI và không ghi gì cả (transaction cuộn lại)
 *   5. form cũ chỉ gửi `openingStrategyId` vẫn chạy được (giá trị dự phòng)
 *
 * Gọi ĐÚNG `createBrokerAccountAction`. Chạy trên BẢN SAO database.
 * Dùng: npm run test:opening-strategy
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { createBrokerAccountAction } from '@/accounts/actions';
import {
  computeStrategyAllocation,
  computeStrategyHoldings,
} from '@/domain/portfolio-engine';
import { formatVnd } from '@/lib/money';
import { ROLE, USER_STATUS, BROKER } from '@/lib/enums';

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

interface Dong {
  symbol: string;
  qty: number;
  price: number;
  strategyId: string;
  strategyNameVi: string;
}

/** Dựng FormData đúng như form gửi lên. */
function nenForm(
  accountNo: string,
  dongs: { symbol: string; qty: number; price: number; strategyId?: string }[],
  cash: number,
  batchStrategyId?: string,
): FormData {
  const f = new FormData();
  f.set('broker', BROKER.SSI);
  f.set('accountNo', accountNo);
  f.set('openingCount', String(dongs.length));
  f.set('openingCash', String(cash));
  if (batchStrategyId) f.set('openingStrategyId', batchStrategyId);

  dongs.forEach((d, i) => {
    f.set(`opening_${i}_symbol`, d.symbol);
    f.set(`opening_${i}_qty`, String(d.qty));
    f.set(`opening_${i}_price`, String(d.price));
    f.set(`opening_${i}_at`, '2025-06-02');
    if (d.strategyId) f.set(`opening_${i}_strategyId`, d.strategyId);
  });

  return f;
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

  const chienLuoc = await prisma.strategy.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, nameVi: true },
    take: 3,
  });

  if (chienLuoc.length < 3) {
    console.log('  BOQUA: can it nhat 3 chien luoc dang bat');
    return;
  }

  /*
   * BA MÃ, BA CHIẾN LƯỢC KHÁC NHAU. Đây là điều kiện để bài kiểm có ý nghĩa: nếu dùng
   * cùng một chiến lược cho cả ba thì bản cũ (áp cho cả lô) cũng đạt, và bài kiểm không
   * phân biệt được hai hành vi.
   */
  const ma = await prisma.stock.findMany({
    where: { status: 'ACTIVE', symbol: { in: ['FPT', 'HPG', 'VNM'] } },
    select: { id: true, symbol: true },
  });

  if (ma.length < 3) {
    console.log('  BOQUA: khong tim thay 3 ma can dung');
    return;
  }

  const dongs: Dong[] = ma.map((m, i) => ({
    symbol: m.symbol,
    qty: 1_000 * (i + 1),
    price: 20_000 + i * 5_000,
    strategyId: chienLuoc[i]!.id,
    strategyNameVi: chienLuoc[i]!.nameVi,
  }));

  const tienMat = 7_000_000;
  const tongGiaVon = dongs.reduce((s, d) => s + d.qty * d.price, 0);

  console.log('Khai:');
  for (const d of dongs) {
    console.log(
      `  ${d.symbol} ${d.qty.toLocaleString('vi-VN')} CP @ ${d.price.toLocaleString('vi-VN')} → ${d.strategyNameVi}`,
    );
  }
  console.log(`  tiền mặt còn ${tienMat.toLocaleString('vi-VN')}`);
  console.log(`  vốn dự kiến ghi nhận: ${(tongGiaVon + tienMat).toLocaleString('vi-VN')}`);

  // =========================================================================
  // 1 + 2 + 3. Khai được, gán đúng chiến lược từng mã, chảy vào hệ thống
  // =========================================================================
  console.log('\n1. Khai tài khoản với 3 mã, 3 chiến lược khác nhau');

  const soTK = `TEST${Date.now() % 100_000}`;
  const truocLenh = await prisma.trade.count({ where: { portfolioId: portfolio.id } });

  const kq = await createBrokerAccountAction(
    null,
    nenForm(
      soTK,
      dongs.map((d) => ({ symbol: d.symbol, qty: d.qty, price: d.price, strategyId: d.strategyId })),
      tienMat,
    ),
  );

  kiem(kq.ok === true, `lưu được tài khoản ${soTK}`, JSON.stringify(kq));
  if (kq.ok !== true) {
    console.log(`\n===== ${dat} đạt, ${truot} trượt =====`);
    process.exitCode = 1;
    return;
  }
  console.log(`        ${kq.message ?? ''}`);

  const tk = await prisma.brokerAccount.findFirstOrThrow({
    where: { userId: admin.id, accountNo: soTK },
    select: { id: true },
  });

  kiem(
    (await prisma.trade.count({ where: { portfolioId: portfolio.id } })) === truocLenh + 3,
    'ghi đúng 3 lệnh MUA',
  );

  console.log('\n2. Mỗi mã mang đúng chiến lược của dòng đó');

  for (const d of dongs) {
    const lenh = await prisma.trade.findFirst({
      where: { brokerAccountId: tk.id, stock: { symbol: d.symbol } },
      select: {
        quantity: true,
        price: true,
        status: true,
        transactionType: true,
        strategies: {
          select: {
            allocationBps: true,
            allocationAmount: true,
            strategy: { select: { id: true, nameVi: true } },
          },
        },
      },
    });

    kiem(lenh !== null, `${d.symbol}: có lệnh`);
    if (!lenh) continue;

    kiem(lenh.quantity === d.qty && lenh.price === BigInt(d.price), `${d.symbol}: khối lượng và giá vốn đúng`);
    kiem(lenh.status === 'EXECUTED', `${d.symbol}: ghi thẳng EXECUTED, không chờ duyệt`);
    kiem(lenh.strategies.length === 1, `${d.symbol}: đúng một dòng chiến lược`);

    const cl = lenh.strategies[0];
    kiem(
      cl?.strategy.id === d.strategyId,
      `${d.symbol}: gán "${d.strategyNameVi}" — không phải chiến lược của dòng khác`,
      `nhận "${cl?.strategy.nameVi}"`,
    );
    kiem(cl?.allocationBps === 10_000, `${d.symbol}: 100% cho chiến lược đó`);
    kiem(
      cl?.allocationAmount === BigInt(d.qty * d.price),
      `${d.symbol}: allocationAmount = giá vốn`,
      `${cl?.allocationAmount} vs ${d.qty * d.price}`,
    );
  }

  console.log('\n3. Dữ liệu chảy vào hệ thống ngay sau khi lưu');

  // Vị thế theo chiến lược, đo ở mức TÀI KHOẢN — đúng cách tab BÁN đo.
  const kho = await computeStrategyHoldings(portfolio.id, admin.id, tk.id);
  kiem(kho.length === 3, `vị thế tài khoản thấy đủ 3 mã`, `thấy ${kho.length}`);

  for (const d of dongs) {
    const h = kho.find((x) => x.symbol === d.symbol);
    kiem(h?.quantity === d.qty, `${d.symbol}: vị thế ${d.qty.toLocaleString('vi-VN')} CP`);
    kiem(
      h?.byStrategy.length === 1 && h.byStrategy[0]!.strategyId === d.strategyId,
      `${d.symbol}: vị thế quy về đúng "${d.strategyNameVi}" — bán được ngay theo chiến lược đó`,
      JSON.stringify(h?.byStrategy.map((x) => x.strategyNameVi)),
    );
  }

  // Vốn theo chiến lược — thẻ "Phương pháp đang dùng" và trang Chiến lược.
  const phanBo = await computeStrategyAllocation({ portfolioId: portfolio.id, userId: admin.id });
  for (const d of dongs) {
    const cl = phanBo.find((x) => x.strategyId === d.strategyId);
    kiem(
      cl !== undefined && cl.netCapital >= BigInt(d.qty * d.price),
      `vốn theo chiến lược có "${d.strategyNameVi}" ≥ giá vốn ${d.symbol}`,
      `${cl?.netCapital}`,
    );
  }

  // Vốn góp.
  const dongVon = await prisma.capitalFlow.findFirst({
    where: { brokerAccountId: tk.id },
    select: { amount: true, flowType: true, status: true },
  });

  kiem(
    dongVon?.amount === BigInt(tongGiaVon + tienMat),
    `vốn góp = Σ giá vốn + tiền mặt = ${formatVnd(BigInt(tongGiaVon + tienMat))}`,
    `${dongVon?.amount}`,
  );
  kiem(dongVon?.flowType === 'CONTRIBUTION' && dongVon.status === 'CONFIRMED', 'dòng vốn đúng loại và đã xác nhận');

  // =========================================================================
  // 4. Một dòng chiến lược sai → từ chối, không ghi gì
  // =========================================================================
  console.log('\n4. Một dòng chiến lược sai → từ chối và không ghi gì');

  const truocLenh2 = await prisma.trade.count({ where: { portfolioId: portfolio.id } });
  const truocTK = await prisma.brokerAccount.count({ where: { userId: admin.id } });

  const soTK2 = `TEST${(Date.now() + 1) % 100_000}X`;
  const kqSai = await createBrokerAccountAction(
    null,
    nenForm(
      soTK2,
      [
        { symbol: dongs[0]!.symbol, qty: 100, price: 20_000, strategyId: dongs[0]!.strategyId },
        { symbol: dongs[1]!.symbol, qty: 100, price: 20_000, strategyId: 'cl000000000000000000000000' },
      ],
      0,
    ),
  );

  kiem(kqSai.ok === false, 'bị từ chối');
  kiem(
    (await prisma.trade.count({ where: { portfolioId: portfolio.id } })) === truocLenh2,
    'KHÔNG lệnh nào được ghi — kể cả dòng đầu vốn hợp lệ',
  );
  kiem(
    (await prisma.brokerAccount.count({ where: { userId: admin.id } })) === truocTK,
    'KHÔNG tài khoản nào được tạo — transaction cuộn lại trọn vẹn',
  );
  console.log(
    `        thông báo: ${kqSai.message ?? JSON.stringify(kqSai.fieldErrors)}`.slice(0, 200),
  );

  // =========================================================================
  // 5. Form cũ chỉ gửi openingStrategyId — vẫn chạy được
  // =========================================================================
  console.log('\n5. Form cũ (chỉ có chiến lược mức lô) vẫn chạy — giá trị dự phòng');

  const soTK3 = `TEST${(Date.now() + 2) % 100_000}Y`;
  const kqCu = await createBrokerAccountAction(
    null,
    nenForm(
      soTK3,
      [{ symbol: dongs[0]!.symbol, qty: 500, price: 20_000 }],
      0,
      dongs[2]!.strategyId,
    ),
  );

  kiem(kqCu.ok === true, 'lưu được khi dòng không gửi chiến lược riêng', JSON.stringify(kqCu));

  if (kqCu.ok === true) {
    const tk3 = await prisma.brokerAccount.findFirstOrThrow({
      where: { userId: admin.id, accountNo: soTK3 },
      select: { id: true },
    });
    const lenh3 = await prisma.trade.findFirst({
      where: { brokerAccountId: tk3.id },
      select: { strategies: { select: { strategy: { select: { id: true, nameVi: true } } } } },
    });
    kiem(
      lenh3?.strategies[0]?.strategy.id === dongs[2]!.strategyId,
      `rơi về chiến lược mức lô "${dongs[2]!.strategyNameVi}"`,
      lenh3?.strategies[0]?.strategy.nameVi,
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
