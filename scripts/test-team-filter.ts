/**
 * KIỂM THỬ KHỐI "VỐN & LÃI/LỖ THEO NHÓM" ĐI THEO BỘ LỌC.
 *
 * Trước đây `computeTeamPerformance` chỉ nhận `portfolioId`, nên khối này đứng yên
 * trong khi mọi ô khác trên Dashboard đổi theo bộ lọc.
 *
 * MỖI PHÉP KIỂM ĐỀU CÓ CẶP: "lọc xong thì ra số X" đứng một mình là phép kiểm rỗng —
 * nó vẫn xanh nếu bộ lọc bị bỏ qua hoàn toàn mà dữ liệu tình cờ khớp. Nên ở đâu cũng
 * phải kèm "và số đó KHÁC số khi không lọc".
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:team-filter
 */

import { prisma } from '@/lib/prisma';
import { computeTeamPerformance } from '@/domain/portfolio-engine';
import { ROLE, USER_STATUS, PORTFOLIO_STATUS } from '@/lib/enums';

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

const P = process.pid;
let stt = 0;

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    select: { id: true },
  });

  const clA = await prisma.strategy.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, nameVi: true },
  });
  const clB = await prisma.strategy.findFirstOrThrow({
    where: { isActive: true, id: { not: clA.id } },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, nameVi: true },
  });

  // Hai mã ở HAI NGÀNH khác nhau — để bộ lọc ngành có gì mà cắt.
  const ma1 = await prisma.stock.findFirstOrThrow({
    where: { status: 'ACTIVE', trades: { none: {} } },
    select: { id: true, symbol: true, sectorId: true },
  });
  const ma2 = await prisma.stock.findFirstOrThrow({
    where: { status: 'ACTIVE', trades: { none: {} }, sectorId: { not: ma1.sectorId } },
    select: { id: true, symbol: true, sectorId: true },
  });

  const nhom = await prisma.team.findFirstOrThrow({
    where: { isActive: true },
    select: { id: true, nameVi: true },
  });

  const lenh = async (
    stockId: string,
    soLuong: number,
    strategyId: string,
  ) => {
    stt += 1;
    return prisma.trade.create({
      data: {
        code: `TF${P}${stt}`,
        portfolioId: portfolio.id,
        stockId,
        userId: admin.id,
        createdById: admin.id,
        teamId: nhom.id,
        transactionType: 'BUY',
        status: 'EXECUTED',
        quantity: soLuong,
        price: 10_000n,
        fees: 0n,
        tax: 0n,
        executedAt: new Date(2026, 0, stt),
        strategies: {
          create: [{ strategyId, allocationBps: 10_000, allocationAmount: 0n }],
        },
      },
      select: { id: true },
    });
  };

  // Ngành 1 ↔ chiến lược A · Ngành 2 ↔ chiến lược B, mỗi bên một giá trị khác nhau.
  await lenh(ma1.id, 1000, clA.id); // 10.000.000
  await lenh(ma2.id, 3000, clB.id); // 30.000.000

  const layNhom = async (opt: Parameters<typeof computeTeamPerformance>[1]) => {
    const ds = await computeTeamPerformance(portfolio.id, opt);
    return ds.find((x) => x.teamId === nhom.id);
  };

  console.log(`\nNhóm: ${nhom.nameVi} · ${ma1.symbol}/${clA.nameVi} · ${ma2.symbol}/${clB.nameVi}`);

  console.log('\n1. Không lọc → gộp cả hai lệnh');
  const khongLoc = await layNhom({});
  kiem(khongLoc !== undefined, 'nhóm có mặt trong kết quả');
  kiem(khongLoc?.tradeCount === 2, 'đếm 2 lệnh', `${khongLoc?.tradeCount}`);
  kiem(
    khongLoc?.netCapital === 40_000_000n,
    'vốn triển khai = 10tr + 30tr',
    `${khongLoc?.netCapital}`,
  );
  kiem(khongLoc?.positionCount === 2, 'giữ 2 mã', `${khongLoc?.positionCount}`);

  console.log('\n2. Lọc theo CHIẾN LƯỢC → chỉ còn phần của chiến lược đó');
  {
    const a = await layNhom({ filter: { strategyId: clA.id } });
    kiem(a?.tradeCount === 1, 'còn 1 lệnh', `${a?.tradeCount}`);
    kiem(a?.netCapital === 10_000_000n, 'vốn còn 10tr', `${a?.netCapital}`);
    kiem(a?.positionCount === 1, 'còn 1 mã', `${a?.positionCount}`);
    kiem(
      a?.netCapital !== khongLoc?.netCapital,
      'KHÁC số khi không lọc — bộ lọc thật sự có tác dụng',
      `${a?.netCapital} vs ${khongLoc?.netCapital}`,
    );

    const b = await layNhom({ filter: { strategyId: clB.id } });
    kiem(b?.netCapital === 30_000_000n, 'chiến lược B ra 30tr', `${b?.netCapital}`);
    kiem(
      (a?.netCapital ?? 0n) + (b?.netCapital ?? 0n) === khongLoc?.netCapital,
      'hai chiến lược cộng lại = tổng không lọc — không rơi đồng nào',
    );
  }

  console.log('\n3. Lọc theo NGÀNH → chỉ còn mã của ngành đó');
  {
    const n1 = await layNhom({ filter: { sectorId: ma1.sectorId } });
    kiem(n1?.tradeCount === 1, 'còn 1 lệnh', `${n1?.tradeCount}`);
    kiem(n1?.netCapital === 10_000_000n, 'vốn còn 10tr', `${n1?.netCapital}`);
    kiem(
      n1?.netCapital !== khongLoc?.netCapital,
      'KHÁC số khi không lọc',
      `${n1?.netCapital}`,
    );

    const n2 = await layNhom({ filter: { sectorId: ma2.sectorId } });
    kiem(n2?.netCapital === 30_000_000n, 'ngành 2 ra 30tr', `${n2?.netCapital}`);
  }

  console.log('\n4. Vốn triển khai và giá vốn CÙNG một tập lệnh khi lọc');
  {
    /*
     * Hai con số này nằm cạnh nhau trên cùng một hàng và người ta trừ chúng trong đầu.
     * Nếu "vốn triển khai" lấy nguyên số tiền của lệnh còn "giá vốn" chỉ tính phần
     * thuộc chiến lược đang lọc, hàng đó sẽ báo một khoản lỗ không có thật.
     */
    const a = await layNhom({ filter: { strategyId: clA.id } });
    kiem(
      a?.netCapital === a?.investedCost,
      'vốn triển khai = giá vốn (chưa bán gì, cùng một tập lệnh)',
      `${a?.netCapital} vs ${a?.investedCost}`,
    );
  }

  console.log('\n5. Lệnh chia đôi cho hai chiến lược → tiền chia theo đúng tỷ lệ');
  {
    stt += 1;
    await prisma.trade.create({
      data: {
        code: `TF${P}${stt}`,
        portfolioId: portfolio.id,
        stockId: ma1.id,
        userId: admin.id,
        createdById: admin.id,
        teamId: nhom.id,
        transactionType: 'BUY',
        status: 'EXECUTED',
        quantity: 2000,
        price: 10_000n,
        fees: 0n,
        tax: 0n,
        executedAt: new Date(2026, 0, stt),
        strategies: {
          create: [
            { strategyId: clA.id, allocationBps: 2_500, allocationAmount: 0n },
            { strategyId: clB.id, allocationBps: 7_500, allocationAmount: 0n },
          ],
        },
      },
    });

    // Lệnh mới trị giá 20tr: A thêm 25% = 5tr, B thêm 75% = 15tr.
    const a = await layNhom({ filter: { strategyId: clA.id } });
    const b = await layNhom({ filter: { strategyId: clB.id } });

    kiem(a?.netCapital === 15_000_000n, 'A = 10tr + 5tr', `${a?.netCapital}`);
    kiem(b?.netCapital === 45_000_000n, 'B = 30tr + 15tr', `${b?.netCapital}`);

    const tong = await layNhom({});
    kiem(tong?.netCapital === 60_000_000n, 'không lọc = 60tr', `${tong?.netCapital}`);
    kiem(
      (a?.netCapital ?? 0n) + (b?.netCapital ?? 0n) === tong?.netCapital,
      'A + B = tổng, kể cả khi một lệnh chia cho cả hai',
    );
  }

  console.log('\n6. `onlyTeamId` vẫn lọc đúng nhóm');
  {
    const chiNhom = await computeTeamPerformance(portfolio.id, { onlyTeamId: nhom.id });
    kiem(chiNhom.length === 1, 'chỉ trả về 1 nhóm', `${chiNhom.length}`);
    kiem(chiNhom[0]?.teamId === nhom.id, 'đúng nhóm đã chọn');

    const tatCa = await computeTeamPerformance(portfolio.id, {});
    kiem(
      tatCa.length > 1,
      'không lọc thì nhiều hơn 1 nhóm — đối chứng cho phép lọc trên',
      `${tatCa.length}`,
    );
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
