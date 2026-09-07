/**
 * KIỂM QUẢN LÝ CHIẾN LƯỢC — thêm, sửa, đóng.
 *
 * Trước tính năng này chiến lược chỉ sống trong `master-data.ts`; thêm một chiến lược
 * phải sửa mã nguồn rồi chạy `npm run db:seed`.
 *
 * CHỐT QUAN TRỌNG NHẤT: KHÔNG ĐÓNG ĐƯỢC CHIẾN LƯỢC CÒN VỐN.
 *
 * `computeStrategyAllocation` chỉ liệt kê chiến lược `isActive: true`. Đóng một chiến
 * lược còn giữ cổ phiếu sẽ làm phần vốn ấy biến mất khỏi mọi biểu đồ phân bổ, và bất biến
 * "Σ vốn theo chiến lược = Σ giá vốn vị thế đang mở" vỡ — im lặng, vì biểu đồ vẫn trông
 * hoàn chỉnh. Bài này dựng đúng tình huống đó rồi kiểm cả hai chiều.
 *
 * Chạy trên BẢN SAO database. Dùng: npm run test:strategy-admin
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { saveStrategyAction, toggleStrategyAction } from '@/admin/strategy-actions';
import { computeStrategyAllocation, computePositions } from '@/domain/portfolio-engine';
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

const f = (o: Record<string, string>): FormData => {
  const d = new FormData();
  for (const [k, v] of Object.entries(o)) d.set(k, v);
  return d;
};

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { email: 'admin@vninvest.local' },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });
  await createSession(admin.id);

  const pf = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  // =========================================================================
  // 1. Tạo chiến lược mới
  // =========================================================================
  console.log('1. Tạo chiến lược');
  let moiId = '';
  {
    const truocSo = await prisma.strategy.count();
    const truocAudit = await prisma.auditLog.count();

    const kq = await saveStrategyAction(
      null,
      f({
        code: 'KIEM_THU',
        name: 'Test Strategy',
        nameVi: 'Chiến lược kiểm thử',
        description: 'Dựng cho bài kiểm',
        colorHex: '#ff8800',
        sortOrder: '9',
        maxAllocationPercent: '35',
      }),
    );

    kiem(kq.ok === true, 'tạo được', JSON.stringify(kq));
    kiem((await prisma.strategy.count()) === truocSo + 1, 'đúng một chiến lược được tạo');

    const moi = await prisma.strategy.findUnique({
      where: { code: 'KIEM_THU' },
      select: { id: true, maxAllocationBps: true, colorHex: true, sortOrder: true, isActive: true },
    });
    moiId = moi?.id ?? '';

    /*
     * 35% phải thành 3500 bps. Đây là phép đổi duy nhất giữa đơn vị người dùng gõ và đơn
     * vị database lưu — sai ở đây thì hạn mức lệch 100 lần mà không có gì báo.
     */
    kiem(moi?.maxAllocationBps === 3_500, `hạn mức 35% lưu thành 3500 bps`, String(moi?.maxAllocationBps));
    kiem(moi?.colorHex === '#ff8800', 'màu lưu đúng');
    kiem(moi?.sortOrder === 9, 'thứ tự lưu đúng');
    kiem(moi?.isActive === true, 'chiến lược mới đang bật');
    kiem((await prisma.auditLog.count()) === truocAudit + 1, 'ghi Audit Log');
  }

  // =========================================================================
  // 2. Hạn mức ngoài khoảng → từ chối
  // =========================================================================
  console.log('\n2. Hạn mức ngoài 0–100% → từ chối');
  {
    const kq = await saveStrategyAction(
      null,
      f({
        id: moiId,
        code: 'KIEM_THU',
        name: 'Test Strategy',
        nameVi: 'Chiến lược kiểm thử',
        sortOrder: '9',
        maxAllocationPercent: '1000',
      }),
    );
    kiem(kq.ok === false, 'từ chối 1000%');
    kiem(
      kq.fieldErrors?.maxAllocationBps?.[0]?.includes('0 đến 100') === true,
      'thông báo nói bằng đơn vị người dùng gõ (%)',
      JSON.stringify(kq.fieldErrors),
    );
    console.log(`        thông báo: ${kq.fieldErrors?.maxAllocationBps?.[0]}`);
  }

  // =========================================================================
  // 3. Mã trùng → từ chối
  // =========================================================================
  console.log('\n3. Mã trùng → từ chối');
  {
    const khac = await prisma.strategy.findFirst({
      where: { id: { not: moiId } },
      select: { id: true, code: true, nameVi: true, sortOrder: true },
    });

    if (!khac) {
      console.log('  BOQUA: chi co mot chien luoc');
    } else {
      const kq = await saveStrategyAction(
        null,
        f({
          id: khac.id,
          code: 'KIEM_THU',
          name: khac.nameVi,
          nameVi: khac.nameVi,
          sortOrder: String(khac.sortOrder),
        }),
      );
      kiem(kq.ok === false, 'bị từ chối');
      kiem(
        kq.fieldErrors?.code?.[0]?.includes('đã có chiến lược khác dùng') === true,
        'thông báo nói rõ mã trùng',
      );
    }
  }

  // =========================================================================
  // 4. Đổi tên — id giữ nguyên
  // =========================================================================
  console.log('\n4. Đổi tên chiến lược');
  {
    const kq = await saveStrategyAction(
      null,
      f({
        id: moiId,
        code: 'KIEM_THU',
        name: 'Renamed',
        nameVi: 'Tên đã đổi',
        sortOrder: '9',
      }),
    );
    kiem(kq.ok === true, 'lưu được', JSON.stringify(kq));

    const sau = await prisma.strategy.findUniqueOrThrow({
      where: { id: moiId },
      select: { id: true, nameVi: true, code: true, maxAllocationBps: true },
    });
    kiem(sau.nameVi === 'Tên đã đổi', `tên đổi thành "${sau.nameVi}"`);
    kiem(sau.id === moiId && sau.code === 'KIEM_THU', 'ID và mã giữ nguyên');
    kiem(sau.maxAllocationBps === null, 'bỏ trống hạn mức thì xoá hạn mức');
  }

  // =========================================================================
  // 5. Đóng chiến lược RỖNG → được
  // =========================================================================
  console.log('\n5. Chiến lược chưa có vốn → đóng được');
  {
    const kq = await toggleStrategyAction(null, f({ id: moiId }));
    kiem(kq.ok === true, 'đóng được', JSON.stringify(kq));
    kiem(
      (await prisma.strategy.findUniqueOrThrow({ where: { id: moiId }, select: { isActive: true } }))
        .isActive === false,
      'trạng thái đã đóng',
    );

    const mo = await toggleStrategyAction(null, f({ id: moiId }));
    kiem(mo.ok === true, 'mở lại được — không cần điều kiện gì');
  }

  // =========================================================================
  // 6. CHỐT CHÍNH: chiến lược CÒN VỐN → không đóng được
  // =========================================================================
  console.log('\n6. Chiến lược còn vốn → KHÔNG đóng được');
  {
    const ma = await prisma.stock.findFirstOrThrow({
      where: { status: 'ACTIVE' },
      select: { id: true, symbol: true },
    });

    /*
     * Dựng một lệnh MUA phân bổ 100% cho chiến lược đang kiểm. Ghi thẳng bằng `prisma` vì
     * đây là NỀN — thứ đang kiểm là chốt đóng chiến lược, không phải đường nhập lệnh.
     */
    const lenh = await prisma.trade.create({
      data: {
        code: `TXN-STRAT-${String(Date.now()).slice(-6)}`,
        portfolioId: pf.id,
        stockId: ma.id,
        transactionType: 'BUY',
        quantity: 1_000,
        price: 60_000n,
        fees: 0n,
        tax: 0n,
        executedAt: new Date(),
        status: 'EXECUTED',
        userId: admin.id,
        createdById: admin.id,
      },
    });
    await prisma.tradeStrategy.create({
      data: {
        tradeId: lenh.id,
        strategyId: moiId,
        allocationBps: 10_000,
        allocationAmount: 60_000_000n,
      },
    });

    const von =
      (await computeStrategyAllocation({ portfolioId: pf.id })).find((r) => r.strategyId === moiId)
        ?.netCapital ?? 0n;
    kiem(von > 0n, `nền: chiến lược đang giữ ${formatVnd(von)}`, formatVnd(von));

    const kq = await toggleStrategyAction(null, f({ id: moiId }));
    kiem(kq.ok === false, 'bị từ chối');
    kiem(
      kq.message?.includes('còn') === true && kq.message?.includes('vốn') === true,
      'thông báo nêu số vốn còn lại',
      kq.message,
    );
    kiem(
      (await prisma.strategy.findUniqueOrThrow({ where: { id: moiId }, select: { isActive: true } }))
        .isActive === true,
      'chiến lược VẪN bật',
    );
    console.log(`        thông báo: ${kq.message}`);

    /*
     * CHỨNG MINH VÌ SAO CHỐT NÀY TỒN TẠI: nếu đóng được, bất biến "Σ vốn theo chiến lược =
     * Σ giá vốn vị thế mở" sẽ vỡ vì `computeStrategyAllocation` bỏ qua chiến lược đã đóng.
     */
    const viThe = await computePositions({ portfolioId: pf.id });
    const giaVon = viThe.filter((p) => p.quantity > 0).reduce((s, p) => s + p.totalCost, 0n);
    const tongCL = (await computeStrategyAllocation({ portfolioId: pf.id })).reduce(
      (s, r) => s + r.netCapital,
      0n,
    );
    kiem(tongCL === giaVon, 'bất biến còn nguyên khi chiến lược vẫn bật', `${tongCL} vs ${giaVon}`);

    // Tắt bằng đường vòng để đo hậu quả — đây là thứ chốt đang ngăn.
    await prisma.strategy.update({ where: { id: moiId }, data: { isActive: false } });
    const tongSauKhiTat = (await computeStrategyAllocation({ portfolioId: pf.id })).reduce(
      (s, r) => s + r.netCapital,
      0n,
    );
    kiem(
      tongSauKhiTat !== giaVon,
      `nếu ép tắt: Σ vốn tụt còn ${formatVnd(tongSauKhiTat)} trong khi giá vốn vẫn ${formatVnd(giaVon)} — đúng thứ chốt đang ngăn`,
    );
    await prisma.strategy.update({ where: { id: moiId }, data: { isActive: true } });
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
