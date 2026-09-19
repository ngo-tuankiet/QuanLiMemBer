/**
 * CHUYỂN VỐN GÓP TỪ MỨC DANH MỤC VỀ MỘT TÀI KHOẢN CHỨNG KHOÁN.
 *
 * VÌ SAO CẦN. Lệnh mua 10.000 MBB của admin là dữ liệu mồi, ban đầu không gắn tài khoản
 * nào, nên tiền mua nó nằm trong vốn góp khai ở mức danh mục. Khi lô cổ phiếu đó được
 * gán về SSI · 12345 (xem `assign-mbb-account.ts`), chi phí 253.379.500 ₫ chuyển sang
 * tài khoản đó nhưng tiền thì không — SSI chỉ từng nhận 100.000.000 ₫, nên số dư âm
 * 30.088.500 ₫. Cổ phiếu đã chuyển thì tiền mua chúng phải chuyển theo.
 *
 * TỔNG VỐN CỦA DANH MỤC KHÔNG ĐỔI. Đây là điểm quan trọng nhất của script này: nó TÁCH
 * một phần ra khỏi dòng vốn ở mức danh mục rồi gắn phần đó vào tài khoản, chứ không tạo
 * thêm vốn. Khai một dòng "Nạp vốn" mới sẽ làm tổng nguồn vốn của danh mục tăng đúng
 * bằng số đó — và mọi tỷ lệ hiệu suất tính trên nguồn vốn sẽ sai theo.
 *
 *     trước:  danh mục 8.000.000.000 (không gắn TK)      SSI 100.000.000
 *     sau:    danh mục 7.746.620.500 (không gắn TK)      SSI 100.000.000 + 253.379.500
 *             ────────────────────────────────────────────────────────────────────────
 *             tổng 8.100.000.000                          tổng 8.100.000.000
 *
 * NGÀY GHI TRÙNG NGÀY MUA, không phải hôm nay: tiền phải có trong tài khoản vào lúc
 * lệnh khớp. Ghi ngày hôm nay thì mọi báo cáo theo thời gian đều thấy một tài khoản mua
 * 253 triệu bằng số tiền chỉ đến vài tháng sau.
 *
 * DỪNG LẠI NẾU DỮ LIỆU KHÁC LÚC VIẾT SCRIPT. Kiểm đủ điều kiện trước khi ghi, và làm
 * trong MỘT transaction.
 *
 * Dùng: npm run fix:move-capital   (sao lưu prisma/dev.db trước)
 */

import { prisma } from '@/lib/prisma';
import { computeAccountBalances } from '@/domain/portfolio-engine';
import { formatVnd } from '@/lib/money';
import { ROLE, USER_STATUS } from '@/lib/enums';

/** Tài khoản nhận, và dòng vốn mức danh mục bị tách. */
const BROKER_NHAN = 'SSI';
const SO_TK_NHAN = '12345';
const GHI_CHU_NGUON = 'Vốn góp đợt 1';
const MA = 'MBB';

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true, fullName: true },
  });

  const tk = await prisma.brokerAccount.findFirstOrThrow({
    where: { userId: admin.id, broker: BROKER_NHAN, accountNo: SO_TK_NHAN },
    select: { id: true },
  });

  // ---- Số tiền cần chuyển = net của chính lệnh mua đó ----------------------
  const mua = await prisma.trade.findMany({
    where: {
      brokerAccountId: tk.id,
      portfolioId: portfolio.id,
      status: 'EXECUTED',
      transactionType: 'BUY',
      stock: { symbol: MA },
    },
    select: { id: true, code: true, quantity: true, price: true, fees: true, tax: true, executedAt: true },
  });

  if (mua.length !== 1) {
    console.error(
      `Dừng: tìm thấy ${mua.length} lệnh mua ${MA} ở ${BROKER_NHAN} ${SO_TK_NHAN}, cần đúng 1.`,
    );
    process.exitCode = 1;
    return;
  }

  const t = mua[0]!;
  const canChuyen = BigInt(t.quantity) * t.price + t.fees + t.tax;

  // ---- Dòng vốn mức danh mục bị tách --------------------------------------
  const nguon = await prisma.capitalFlow.findMany({
    where: {
      portfolioId: portfolio.id,
      brokerAccountId: null,
      flowType: 'CONTRIBUTION',
      note: GHI_CHU_NGUON,
    },
    select: { id: true, amount: true, occurredAt: true, createdById: true, teamId: true },
  });

  if (nguon.length !== 1) {
    console.error(`Dừng: tìm thấy ${nguon.length} dòng vốn "${GHI_CHU_NGUON}", cần đúng 1.`);
    process.exitCode = 1;
    return;
  }

  const src = nguon[0]!;

  if (src.amount < canChuyen) {
    console.error(
      `Dừng: dòng vốn nguồn chỉ có ${formatVnd(src.amount)}, không tách được ${formatVnd(canChuyen)}.`,
    );
    process.exitCode = 1;
    return;
  }

  // ---- Ảnh trước ----------------------------------------------------------
  const truoc = await computeAccountBalances(portfolio.id, admin.id);
  const tongTruoc = (
    await prisma.capitalFlow.findMany({
      where: { portfolioId: portfolio.id, status: 'CONFIRMED', flowType: 'CONTRIBUTION' },
      select: { amount: true },
    })
  ).reduce((s, f) => s + f.amount, 0n);

  console.log(`Lệnh nguồn: ${t.code} — ${t.quantity.toLocaleString('vi-VN')} ${MA}`);
  console.log(`Cần chuyển: ${formatVnd(canChuyen)}`);
  console.log(`\nTRƯỚC:`);
  for (const b of truoc) {
    console.log(`  ${b.broker} ${b.accountNo}: vốn ${formatVnd(b.granted)} · còn ${formatVnd(b.available)}`);
  }
  console.log(`  vốn góp mức danh mục "${GHI_CHU_NGUON}": ${formatVnd(src.amount)}`);
  console.log(`  TỔNG vốn góp toàn danh mục: ${formatVnd(tongTruoc)}`);

  // ---- Ghi, trong một transaction -----------------------------------------
  await prisma.$transaction(async (tx) => {
    await tx.capitalFlow.update({
      where: { id: src.id },
      data: { amount: src.amount - canChuyen },
    });

    await tx.capitalFlow.create({
      data: {
        portfolioId: portfolio.id,
        brokerAccountId: tk.id,
        teamId: src.teamId,
        flowType: 'CONTRIBUTION',
        amount: canChuyen,
        // Trùng ngày lệnh khớp: tiền phải có trong tài khoản vào lúc mua.
        occurredAt: t.executedAt,
        note: `Tách từ "${GHI_CHU_NGUON}" về ${BROKER_NHAN} ${SO_TK_NHAN} — vốn mua ${t.quantity.toLocaleString('vi-VN')} ${MA} (${t.code})`,
        status: 'CONFIRMED',
        createdById: src.createdById,
      },
    });
  });

  // ---- Ảnh sau ------------------------------------------------------------
  const sau = await computeAccountBalances(portfolio.id, admin.id);
  const tongSau = (
    await prisma.capitalFlow.findMany({
      where: { portfolioId: portfolio.id, status: 'CONFIRMED', flowType: 'CONTRIBUTION' },
      select: { amount: true },
    })
  ).reduce((s, f) => s + f.amount, 0n);

  console.log(`\nSAU:`);
  for (const b of sau) {
    console.log(`  ${b.broker} ${b.accountNo}: vốn ${formatVnd(b.granted)} · còn ${formatVnd(b.available)}`);
  }
  console.log(`  TỔNG vốn góp toàn danh mục: ${formatVnd(tongSau)}`);

  const am = sau.filter((b) => b.available < 0n);
  const tongGiuNguyen = tongSau === tongTruoc;

  console.log('');
  console.log(tongGiuNguyen ? 'Tổng vốn danh mục KHÔNG đổi.' : `LỖI: tổng vốn đổi ${formatVnd(tongSau - tongTruoc)}.`);
  console.log(am.length === 0 ? 'Không tài khoản nào âm tiền.' : `LỖI: còn ${am.length} tài khoản âm.`);

  if (!tongGiuNguyen || am.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('LOI:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
