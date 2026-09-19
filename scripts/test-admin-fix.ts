/**
 * KIỂM THỬ ADMIN SỬA LỖI NHẬP CỦA THÀNH VIÊN.
 *
 * Bốn đường mới: đổi chiến lược của một lệnh, xoá hẳn lệnh, sửa dòng nạp/rút, xoá hẳn
 * dòng nạp/rút.
 *
 * ĐIỀU BÀI NÀY THỰC SỰ CANH: sau mỗi lần sửa, CON SỐ TÍNH RA phải đổi theo — không
 * phải "action trả về ok". Hệ thống không lưu sẵn P&L hay số dư, nên phép kiểm đúng
 * là gọi lại engine và so. Một action ghi vào database nhưng engine không đọc tới sẽ
 * qua được mọi phép kiểm hình thức mà vẫn sai trên màn hình.
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:admin-fix
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { deleteTradeAction, updateTradeAction } from '@/trading/actions';
import { deleteCapitalFlowAction, updateCapitalFlowAction } from '@/accounts/actions';
import { computePositions, computeCash, computeStrategyHoldings } from '@/domain/portfolio-engine';
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

function fd(v: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });

  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    select: { id: true },
  });

  const vaiTro = await prisma.role.findMany({ select: { id: true, code: true } });
  const idVaiTro = (code: string): string => {
    const r = vaiTro.find((x) => x.code === code);
    if (!r) throw new Error(`thieu vai tro ${code}`);
    return r.id;
  };

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

  const ma = await prisma.stock.findFirstOrThrow({
    where: { status: 'ACTIVE', trades: { none: {} } },
    select: { id: true, symbol: true },
  });

  // Thành viên "nhập sai" — người mà admin sẽ đi sửa hộ.
  const thanhVien = await prisma.user.create({
    data: {
      email: `nhapsai-${P}@example.invalid`,
      passwordHash: 'x'.repeat(60),
      fullName: 'Thanh vien nhap sai',
      status: USER_STATUS.ACTIVE,
      roleId: idVaiTro(ROLE.EXECUTION),
    },
    select: { id: true },
  });

  const tk = await prisma.brokerAccount.create({
    data: { userId: thanhVien.id, broker: 'SSI', accountNo: `FIX${P}` },
    select: { id: true },
  });

  const locTV = { portfolioId: portfolio.id, userId: thanhVien.id };

  /** Lệnh MUA của thành viên, gán 100% cho chiến lược A. */
  const taoLenh = async (soLuong: number, gia: bigint, ngay: Date) =>
    prisma.trade.create({
      data: {
        code: `FIX${P}${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        portfolioId: portfolio.id,
        stockId: ma.id,
        brokerAccountId: tk.id,
        userId: thanhVien.id,
        createdById: thanhVien.id,
        transactionType: 'BUY',
        status: 'EXECUTED',
        quantity: soLuong,
        price: gia,
        fees: 0n,
        tax: 0n,
        executedAt: ngay,
        strategies: {
          create: [{ strategyId: clA.id, allocationBps: 10_000, allocationAmount: 0n }],
        },
      },
      select: { id: true, code: true, version: true },
    });

  await createSession(admin.id);

  console.log(`\nMã kiểm thử: ${ma.symbol} · chiến lược A=${clA.nameVi} B=${clB.nameVi}`);

  console.log('\n1. Admin sửa KHỐI LƯỢNG lệnh của thành viên → vị thế tính lại');
  {
    const lenh = await taoLenh(1000, 20_000n, new Date(2026, 0, 5));

    const truoc = (await computePositions(locTV)).find((p) => p.stockId === ma.id);
    kiem(truoc?.quantity === 1000, 'trước khi sửa: 1.000 CP', `${truoc?.quantity}`);

    const kq = await updateTradeAction(
      null,
      fd({
        tradeId: lenh.id,
        version: String(lenh.version),
        quantity: '600',
        price: '20000',
        reason: 'Thanh vien nhap thua, so dung la 600',
      }),
    );
    kiem(kq.ok, 'sửa được lệnh của người khác', kq.message ?? JSON.stringify(kq.fieldErrors));

    const sau = (await computePositions(locTV)).find((p) => p.stockId === ma.id);
    kiem(sau?.quantity === 600, 'ENGINE tính lại: còn 600 CP', `${sau?.quantity}`);
    kiem(
      sau?.totalCost === 600n * 20_000n,
      'giá vốn tính lại theo khối lượng mới',
      `${sau?.totalCost}`,
    );

    // Tiền phân bổ cho chiến lược phải bằng đúng giá trị lệnh mới, không còn số cũ.
    const ts = await prisma.tradeStrategy.findMany({
      where: { tradeId: lenh.id },
      select: { allocationAmount: true, allocationBps: true },
    });
    kiem(
      ts.reduce((x, y) => x + y.allocationAmount, 0n) === 600n * 20_000n,
      'Σ tiền phân bổ = giá trị lệnh MỚI',
      `${ts.reduce((x, y) => x + y.allocationAmount, 0n)}`,
    );

    await prisma.trade.delete({ where: { id: lenh.id } });
  }

  console.log('\n2. Admin đổi CHIẾN LƯỢC của lệnh → phân bổ theo chiến lược đổi theo');
  {
    const lenh = await taoLenh(1000, 20_000n, new Date(2026, 0, 6));

    const truoc = (await computeStrategyHoldings(portfolio.id, thanhVien.id, tk.id)).find(
      (h) => h.stockId === ma.id,
    );
    kiem(
      truoc?.byStrategy.length === 1 && truoc.byStrategy[0]?.strategyId === clA.id,
      'trước khi sửa: 100% ở chiến lược A',
      truoc?.byStrategy.map((x) => x.strategyId).join(),
    );

    const kq = await updateTradeAction(
      null,
      fd({
        tradeId: lenh.id,
        version: String(lenh.version),
        quantity: '1000',
        price: '20000',
        reason: 'Thanh vien chon nham chien luoc',
        [`alloc_${clA.id}`]: '60',
        [`alloc_${clB.id}`]: '40',
      }),
    );
    kiem(kq.ok, 'đổi được chiến lược', kq.message ?? JSON.stringify(kq.fieldErrors));

    const sau = (await computeStrategyHoldings(portfolio.id, thanhVien.id, tk.id)).find(
      (h) => h.stockId === ma.id,
    );
    kiem(sau?.byStrategy.length === 2, 'giờ có hai chiến lược', `${sau?.byStrategy.length}`);
    const a = sau?.byStrategy.find((x) => x.strategyId === clA.id);
    const b = sau?.byStrategy.find((x) => x.strategyId === clB.id);
    kiem(a?.quantity === 600 && b?.quantity === 400, '600 / 400 theo đúng 60/40', `${a?.quantity}/${b?.quantity}`);
    kiem(
      (sau?.byStrategy.reduce((x, y) => x + y.quantity, 0) ?? 0) === 1000,
      'Σ theo chiến lược vẫn = tổng vị thế, không rơi cổ phiếu nào',
    );

    const ts = await prisma.tradeStrategy.findMany({
      where: { tradeId: lenh.id },
      select: { allocationAmount: true },
    });
    kiem(
      ts.reduce((x, y) => x + y.allocationAmount, 0n) === 1000n * 20_000n,
      'Σ tiền phân bổ vẫn khớp tuyệt đối giá trị lệnh',
      `${ts.reduce((x, y) => x + y.allocationAmount, 0n)}`,
    );

    console.log('\n2b. Tổng tỷ lệ không đủ 100% → từ chối, không ghi gì');
    const ver2 = (await prisma.trade.findUniqueOrThrow({
      where: { id: lenh.id },
      select: { version: true },
    })).version;
    const xau = await updateTradeAction(
      null,
      fd({
        tradeId: lenh.id,
        version: String(ver2),
        quantity: '1000',
        price: '20000',
        reason: 'thu tong sai',
        [`alloc_${clA.id}`]: '60',
        [`alloc_${clB.id}`]: '30',
      }),
    );
    kiem(!xau.ok && !!xau.fieldErrors?.allocations, 'tổng 90% bị từ chối', JSON.stringify(xau.fieldErrors));

    const conNguyen = (await computeStrategyHoldings(portfolio.id, thanhVien.id, tk.id)).find(
      (h) => h.stockId === ma.id,
    );
    kiem(
      conNguyen?.byStrategy.find((x) => x.strategyId === clA.id)?.quantity === 600,
      'phân bổ cũ còn nguyên sau khi bị từ chối',
    );

    await prisma.trade.delete({ where: { id: lenh.id } });
  }

  console.log('\n3. Admin XOÁ HẲN lệnh → biến mất khỏi database và khỏi vị thế');
  {
    const lenh = await taoLenh(1000, 20_000n, new Date(2026, 0, 7));
    const soLenhTruoc = await prisma.trade.count();
    const soPhanBoTruoc = await prisma.tradeStrategy.count();

    const kq = await deleteTradeAction(
      null,
      fd({ tradeId: lenh.id, reason: 'Thanh vien bam nham hai lan' }),
    );
    kiem(kq.ok, 'xoá được', kq.message);

    kiem((await prisma.trade.count()) === soLenhTruoc - 1, 'đúng một lệnh biến mất');
    kiem(
      (await prisma.trade.findUnique({ where: { id: lenh.id } })) === null,
      'dòng không còn trong database',
    );
    kiem(
      (await prisma.tradeStrategy.count()) === soPhanBoTruoc - 1,
      'phân bổ chiến lược bị xoá theo (cascade)',
    );

    const sau = (await computePositions(locTV)).find((p) => p.stockId === ma.id);
    kiem(sau === undefined || sau.quantity === 0, 'vị thế về 0', `${sau?.quantity}`);

    /*
     * NHẬT KÝ LÀ BẢN GHI DUY NHẤT CÒN LẠI, nên nó phải đủ để dựng lại lệnh bằng tay.
     * Chỉ ghi "đã xoá một lệnh" là vô dụng đúng lúc cần nhất.
     */
    const nk = await prisma.auditLog.findFirst({
      where: { entityType: 'TRADE', entityId: lenh.id, action: 'DELETE' },
      orderBy: { occurredAt: 'desc' },
      select: { beforeJson: true, note: true, actorUserId: true },
    });
    kiem(nk !== null, 'có dòng nhật ký DELETE');
    kiem(nk?.actorUserId === admin.id, 'ghi đúng người xoá');
    const b = String(nk?.beforeJson ?? '');
    kiem(b.includes(lenh.code), 'nhật ký lưu mã lệnh', b.slice(0, 80));
    kiem(b.includes('"quantity":1000'), 'nhật ký lưu khối lượng');
    kiem(b.includes(clA.id), 'nhật ký lưu phân bổ chiến lược');
    kiem(nk?.note?.includes('bam nham') === true, 'nhật ký lưu lý do', String(nk?.note));
  }

  console.log('\n4. Xoá lệnh MUA làm vị thế âm → bị chặn');
  {
    const mua = await taoLenh(1000, 20_000n, new Date(2026, 0, 8));
    await prisma.trade.create({
      data: {
        code: `FIXS${P}`,
        portfolioId: portfolio.id,
        stockId: ma.id,
        brokerAccountId: tk.id,
        userId: thanhVien.id,
        createdById: thanhVien.id,
        transactionType: 'SELL',
        status: 'EXECUTED',
        quantity: 800,
        price: 21_000n,
        fees: 0n,
        tax: 0n,
        executedAt: new Date(2026, 0, 9),
        strategies: {
          create: [{ strategyId: clA.id, allocationBps: 10_000, allocationAmount: 0n }],
        },
      },
    });

    const kq = await deleteTradeAction(
      null,
      fd({ tradeId: mua.id, reason: 'thu xoa lenh mua da ban bot' }),
    );
    kiem(!kq.ok, 'bị chặn');
    kiem(kq.message?.includes('âm') === true, 'nói rõ vị thế sẽ âm', kq.message);
    kiem(
      (await prisma.trade.findUnique({ where: { id: mua.id } })) !== null,
      'lệnh KHÔNG bị xoá',
    );

    await prisma.trade.deleteMany({ where: { stockId: ma.id, userId: thanhVien.id } });
  }

  console.log('\n5. Admin SỬA dòng nạp vốn → tiền tính lại');
  {
    const flow = await prisma.capitalFlow.create({
      data: {
        portfolioId: portfolio.id,
        brokerAccountId: tk.id,
        flowType: 'CONTRIBUTION',
        status: 'CONFIRMED',
        amount: 6_000_000_000n, // thừa một số 0
        occurredAt: new Date(2026, 0, 3),
        createdById: thanhVien.id,
      },
      select: { id: true },
    });

    const truoc = await computeCash(portfolio.id);

    const kq = await updateCapitalFlowAction(
      null,
      fd({
        id: flow.id,
        amount: '600000000',
        occurredAt: '2026-01-04',
        note: 'da sua',
        reason: 'Thanh vien go thua mot so 0',
      }),
    );
    kiem(kq.ok, 'sửa được', kq.message ?? JSON.stringify(kq.fieldErrors));

    const sau = await computeCash(portfolio.id);
    kiem(
      truoc.cashBalance - sau.cashBalance === 5_400_000_000n,
      'ENGINE tính lại: tiền giảm đúng 5,4 tỷ',
      `${truoc.cashBalance - sau.cashBalance}`,
    );

    const dong = await prisma.capitalFlow.findUniqueOrThrow({
      where: { id: flow.id },
      select: { amount: true, occurredAt: true, note: true, flowType: true },
    });
    kiem(dong.amount === 600_000_000n, 'số tiền đã đổi');
    kiem(dong.occurredAt.toISOString().slice(0, 10) === '2026-01-04', 'ngày đã đổi');
    kiem(dong.note === 'da sua', 'ghi chú đã đổi');
    kiem(dong.flowType === 'CONTRIBUTION', 'LOẠI không đổi — không có đường đảo dấu');

    console.log('\n5b. Thiếu lý do → từ chối');
    const thieu = await updateCapitalFlowAction(
      null,
      fd({ id: flow.id, amount: '700000000', occurredAt: '2026-01-04', reason: '  ' }),
    );
    kiem(!thieu.ok && !!thieu.fieldErrors?.reason, 'bắt buộc nêu lý do');
    kiem(
      (await prisma.capitalFlow.findUniqueOrThrow({ where: { id: flow.id } })).amount ===
        600_000_000n,
      'không ghi gì khi thiếu lý do',
    );

    console.log('\n6. Admin XOÁ HẲN dòng nạp vốn');
    const truocXoa = await computeCash(portfolio.id);
    const soDongTruoc = await prisma.capitalFlow.count();

    const xoa = await deleteCapitalFlowAction(
      null,
      fd({ id: flow.id, reason: 'Khoan nay khong co that' }),
    );
    kiem(xoa.ok, 'xoá được', xoa.message);
    kiem((await prisma.capitalFlow.count()) === soDongTruoc - 1, 'đúng một dòng biến mất');
    kiem(
      (await prisma.capitalFlow.findUnique({ where: { id: flow.id } })) === null,
      'dòng không còn trong database',
    );

    const sauXoa = await computeCash(portfolio.id);
    kiem(
      truocXoa.cashBalance - sauXoa.cashBalance === 600_000_000n,
      'tiền giảm đúng 600 triệu',
      `${truocXoa.cashBalance - sauXoa.cashBalance}`,
    );

    const nk = await prisma.auditLog.findFirst({
      where: { entityType: 'CAPITAL_FLOW', entityId: flow.id, action: 'DELETE' },
      select: { beforeJson: true, note: true },
    });
    kiem(nk !== null, 'có dòng nhật ký DELETE');
    kiem(
      String(nk?.beforeJson ?? '').includes('600000000'),
      'nhật ký lưu số tiền trước khi xoá',
      String(nk?.beforeJson).slice(0, 90),
    );
  }

  console.log('\n7. Không đụng được dòng CỔ TỨC qua đường sửa nạp/rút');
  {
    /*
     * `capital_flows` chứa nhiều loại. Nếu màn hình "sửa nạp rút" đụng được vào dòng cổ
     * tức thì sửa được số tiền doanh nghiệp đã trả mà không đụng gì tới vị thế tương ứng
     * — hai nguồn số liệu lệch nhau, và không có gì báo.
     */
    const ct = await prisma.capitalFlow.create({
      data: {
        portfolioId: portfolio.id,
        brokerAccountId: tk.id,
        stockId: ma.id,
        flowType: 'DIVIDEND',
        status: 'CONFIRMED',
        amount: 5_000_000n,
        occurredAt: new Date(2026, 0, 10),
        createdById: thanhVien.id,
      },
      select: { id: true },
    });

    const sua = await updateCapitalFlowAction(
      null,
      fd({ id: ct.id, amount: '9000000', occurredAt: '2026-01-10', reason: 'thu sua co tuc' }),
    );
    kiem(!sua.ok, 'sửa bị từ chối');
    kiem(sua.message?.includes('DIVIDEND') === true, 'nói rõ đây là loại nào', sua.message);

    const xoa = await deleteCapitalFlowAction(
      null,
      fd({ id: ct.id, reason: 'thu xoa co tuc' }),
    );
    kiem(!xoa.ok, 'xoá cũng bị từ chối');

    const con = await prisma.capitalFlow.findUnique({
      where: { id: ct.id },
      select: { amount: true },
    });
    kiem(con?.amount === 5_000_000n, 'dòng cổ tức còn nguyên, không đổi số');
  }

  console.log('\n8. Người không có quyền → ForbiddenError, không đụng được gì');
  {
    const nguoi = await prisma.user.create({
      data: {
        email: `khongquyen.fix-${P}@example.invalid`,
        passwordHash: 'x'.repeat(60),
        fullName: 'Khong quyen',
        status: USER_STATUS.ACTIVE,
        roleId: idVaiTro(ROLE.EXECUTION),
      },
      select: { id: true },
    });
    await createSession(nguoi.id);

    const lenh = await taoLenh(100, 20_000n, new Date(2026, 0, 11));
    const flow = await prisma.capitalFlow.create({
      data: {
        portfolioId: portfolio.id,
        brokerAccountId: tk.id,
        flowType: 'CONTRIBUTION',
        status: 'CONFIRMED',
        amount: 1_000_000n,
        occurredAt: new Date(2026, 0, 11),
        createdById: thanhVien.id,
      },
      select: { id: true },
    });

    for (const [nhan, chay] of [
      ['xoá lệnh', () => deleteTradeAction(null, fd({ tradeId: lenh.id, reason: 'x' }))],
      [
        'sửa dòng vốn',
        () =>
          updateCapitalFlowAction(
            null,
            fd({ id: flow.id, amount: '2000000', occurredAt: '2026-01-11', reason: 'x' }),
          ),
      ],
      ['xoá dòng vốn', () => deleteCapitalFlowAction(null, fd({ id: flow.id, reason: 'x' }))],
    ] as [string, () => Promise<unknown>][]) {
      let daNem = false;
      try {
        await chay();
      } catch (e) {
        daNem = e instanceof Error && e.name === 'ForbiddenError';
      }
      kiem(daNem, `${nhan} → ForbiddenError`);
    }

    kiem(
      (await prisma.trade.findUnique({ where: { id: lenh.id } })) !== null,
      'lệnh còn nguyên',
    );
    kiem(
      (await prisma.capitalFlow.findUniqueOrThrow({ where: { id: flow.id } })).amount ===
        1_000_000n,
      'dòng vốn còn nguyên số tiền',
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
