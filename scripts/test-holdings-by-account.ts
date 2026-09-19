/**
 * KIỂM THỬ `computeHoldingsByAccount` — cột "Tài khoản" trong bảng vị thế.
 *
 * BẤT BIẾN DUY NHẤT ĐÁNG CANH: Σ khối lượng theo tài khoản = đúng cột "Khối lượng"
 * mà `computePositions` tính, trên cùng một bộ lọc. Hai con số này nằm cạnh nhau trên
 * cùng một dòng bảng; lệch nhau một cổ phiếu là người đọc mất lòng tin vào cả bảng mà
 * không có cách nào biết bên nào đúng.
 *
 * Nên gần như mọi phép kiểm ở đây đều đối chiếu ngược về `computePositions`, chứ không
 * so với một con số tôi tự viết ra.
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:holdings-by-account
 */

import { prisma } from '@/lib/prisma';
import { computeHoldingsByAccount, computePositions } from '@/domain/portfolio-engine';
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
  const chienLuoc = await prisma.strategy.findFirstOrThrow({
    where: { isActive: true },
    select: { id: true },
  });
  const chienLuoc2 = await prisma.strategy.findFirst({
    where: { isActive: true, id: { not: chienLuoc.id } },
    select: { id: true },
  });

  /*
   * MÃ RIÊNG CHO BÀI KIỂM, không dùng mã đang có dữ liệu thật: bản sao mang theo lệnh
   * có sẵn, nên bám vào một mã đang giữ sẽ trộn hai nguồn và không còn khẳng định được
   * con số nào do bài kiểm tạo ra.
   */
  const ma = await prisma.stock.findFirstOrThrow({
    where: { status: 'ACTIVE', trades: { none: {} } },
    select: { id: true, symbol: true },
  });

  const tk = async (accountNo: string, broker = 'SSI') =>
    prisma.brokerAccount.create({
      data: { userId: admin.id, broker, accountNo, isActive: true },
      select: { id: true, accountNo: true },
    });

  const tkA = await tk(`HBA${P}1`);
  const tkB = await tk(`HBA${P}2`, 'VPS');

  const lenh = async (
    accountId: string | null,
    loai: 'BUY' | 'SELL',
    soLuong: number,
    clId: string = chienLuoc.id,
  ) => {
    stt += 1;
    return prisma.trade.create({
      data: {
        code: `HBA${P}${stt}`,
        portfolioId: portfolio.id,
        stockId: ma.id,
        brokerAccountId: accountId,
        userId: admin.id,
        createdById: admin.id,
        transactionType: loai,
        status: 'EXECUTED',
        quantity: soLuong,
        price: 20_000n,
        fees: 0n,
        tax: 0n,
        executedAt: new Date(2026, 0, stt),
        strategies: { create: [{ strategyId: clId, allocationBps: 10_000, allocationAmount: 0n }] },
      },
      select: { id: true },
    });
  };

  const loc = { portfolioId: portfolio.id, userId: admin.id };

  /** Σ theo tài khoản, và khối lượng mà bảng vị thế hiển thị — phải bằng nhau. */
  async function doiChieu(nhan: string) {
    const vt = (await computePositions(loc)).find((p) => p.stockId === ma.id);
    const theoTk = (await computeHoldingsByAccount(loc)).get(ma.id) ?? [];
    const tong = theoTk.reduce((s, x) => s + x.quantity, 0);
    kiem(
      tong === (vt?.quantity ?? 0),
      `${nhan}: Σ theo tài khoản = cột Khối lượng (${tong})`,
      `${tong} vs ${vt?.quantity ?? 0}`,
    );
    return { vt, theoTk };
  }

  console.log(`\nMã dùng để kiểm: ${ma.symbol}`);

  console.log('\n1. Cùng một mã mua ở HAI tài khoản → tách đúng hai dòng');
  {
    await lenh(tkA.id, 'BUY', 1000);
    await lenh(tkB.id, 'BUY', 400);

    const { theoTk } = await doiChieu('hai tài khoản');
    kiem(theoTk.length === 2, 'có đúng 2 dòng tài khoản', `${theoTk.length}`);

    const a = theoTk.find((x) => x.brokerAccountId === tkA.id);
    const b = theoTk.find((x) => x.brokerAccountId === tkB.id);
    kiem(a?.quantity === 1000, 'tài khoản A giữ 1.000', `${a?.quantity}`);
    kiem(b?.quantity === 400, 'tài khoản B giữ 400', `${b?.quantity}`);
    kiem(a?.broker === 'SSI' && b?.broker === 'VPS', 'mang theo đúng sàn của từng tài khoản');
    kiem(
      theoTk[0]?.quantity === 1000,
      'xếp nhiều nhất trước',
      theoTk.map((x) => x.quantity).join(' > '),
    );
  }

  console.log('\n2. Bán bớt ở một tài khoản → chỉ tài khoản đó giảm');
  {
    await lenh(tkA.id, 'SELL', 300);

    const { theoTk } = await doiChieu('sau khi bán 300 ở A');
    const a = theoTk.find((x) => x.brokerAccountId === tkA.id);
    const b = theoTk.find((x) => x.brokerAccountId === tkB.id);
    kiem(a?.quantity === 700, 'A còn 700', `${a?.quantity}`);
    kiem(b?.quantity === 400, 'B KHÔNG đổi', `${b?.quantity}`);
  }

  console.log('\n3. Bán hết ở một tài khoản → tài khoản đó biến mất khỏi danh sách');
  {
    await lenh(tkB.id, 'SELL', 400);

    const { theoTk } = await doiChieu('sau khi bán hết ở B');
    kiem(theoTk.length === 1, 'chỉ còn 1 dòng', `${theoTk.length}`);
    kiem(
      theoTk.every((x) => x.brokerAccountId !== tkB.id),
      'B không còn trong danh sách — nó không còn giữ gì',
    );
    /*
     * ĐỐI CHỨNG cho chính phép lọc đó: A vẫn phải còn. Nếu phép lọc quét sạch mọi thứ
     * thì phép kiểm trên vẫn xanh mà cột Tài khoản thì trống trơn.
     */
    kiem(theoTk[0]?.brokerAccountId === tkA.id, 'A vẫn còn');
  }

  console.log('\n4. Lệnh CHƯA GẮN tài khoản → một nhóm riêng, không gán bừa');
  {
    await lenh(null, 'BUY', 250);

    const { theoTk } = await doiChieu('có lệnh chưa gắn tài khoản');
    const khong = theoTk.find((x) => x.brokerAccountId === null);
    kiem(khong !== undefined, 'có dòng cho phần chưa gắn tài khoản');
    kiem(khong?.quantity === 250, 'đúng 250 CP', `${khong?.quantity}`);

    const a = theoTk.find((x) => x.brokerAccountId === tkA.id);
    kiem(a?.quantity === 700, 'KHÔNG bị cộng nhầm vào tài khoản A', `${a?.quantity}`);
  }

  console.log('\n5. Lọc theo chiến lược → chia theo đúng tỷ lệ, vẫn khớp cột Khối lượng');
  {
    if (!chienLuoc2) {
      console.log('  (bỏ qua — database chỉ có một chiến lược đang bật)');
    } else {
      /*
       * Một lệnh chia đôi cho hai chiến lược. Khi lọc theo một chiến lược,
       * `computePositions` chỉ tính nửa khối lượng — `computeHoldingsByAccount` phải
       * chia y hệt, nếu không cột Tài khoản sẽ nói một đằng còn cột Khối lượng một nẻo
       * đúng lúc người dùng bật bộ lọc chiến lược.
       */
      stt += 1;
      await prisma.trade.create({
        data: {
          code: `HBA${P}${stt}`,
          portfolioId: portfolio.id,
          stockId: ma.id,
          brokerAccountId: tkB.id,
          userId: admin.id,
          createdById: admin.id,
          transactionType: 'BUY',
          status: 'EXECUTED',
          quantity: 1000,
          price: 20_000n,
          fees: 0n,
          tax: 0n,
          executedAt: new Date(2026, 0, stt),
          strategies: {
            create: [
              { strategyId: chienLuoc.id, allocationBps: 5_000, allocationAmount: 0n },
              { strategyId: chienLuoc2.id, allocationBps: 5_000, allocationAmount: 0n },
            ],
          },
        },
      });

      const locCl = { ...loc, strategyId: chienLuoc2.id };
      const vt = (await computePositions(locCl)).find((p) => p.stockId === ma.id);
      const theoTk = (await computeHoldingsByAccount(locCl)).get(ma.id) ?? [];
      const tong = theoTk.reduce((s, x) => s + x.quantity, 0);

      kiem(vt?.quantity === 500, 'lọc theo chiến lược 2 → 500 CP', `${vt?.quantity}`);
      kiem(tong === 500, 'Σ theo tài khoản cũng = 500', `${tong}`);
      kiem(
        theoTk.length === 1 && theoTk[0]?.brokerAccountId === tkB.id,
        'chỉ tài khoản B — lệnh của chiến lược đó nằm ở đó',
        theoTk.map((x) => x.accountNo).join(','),
      );

      // Không lọc thì tổng phải lớn hơn hẳn — nếu bằng nhau thì bộ lọc không có tác dụng.
      const { vt: vtAll } = await doiChieu('không lọc chiến lược');
      kiem(
        (vtAll?.quantity ?? 0) > 500,
        'bỏ lọc thì khối lượng lớn hơn — bộ lọc thật sự có tác dụng',
        `${vtAll?.quantity}`,
      );
    }
  }

  console.log('\n6. Mã không có lệnh nào → không có khoá trong Map');
  {
    const maKhac = await prisma.stock.findFirst({
      where: { status: 'ACTIVE', trades: { none: {} }, id: { not: ma.id } },
      select: { id: true },
    });
    if (maKhac) {
      const m = await computeHoldingsByAccount(loc);
      kiem(m.get(maKhac.id) === undefined, 'mã chưa giao dịch không xuất hiện');
    } else {
      console.log('  (bỏ qua — không còn mã nào chưa giao dịch)');
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
