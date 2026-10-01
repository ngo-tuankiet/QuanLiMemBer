/**
 * KIỂM THỬ KẾ HOẠCH DỰ PHÒNG — ba mức lỗ theo chiến lược, cảnh báo tới admin và quản lý.
 *
 * Dựng một chiến lược riêng, mua một mã ở giá 100, rồi cho giá rơi qua từng mức:
 *
 *   85  (lỗ 15%)  → đúng MỘT cảnh báo, ở mức 2 — không phải ba cảnh báo cho ba mức
 *   75  (lỗ 25%)  → nâng lên mức 3, cảnh báo mức 2 tự đóng
 *   98  (lỗ 2%)   → dưới mức 1, mọi cảnh báo tự đóng
 *
 * Kèm: ai thấy (admin, quản lý cấp cao, quản lý đúng nhóm — không ai khác), các phép kiểm
 * khi lưu kế hoạch, và hai lỗ đã bịt (sửa lẻ một mức qua form ngưỡng thường; tiếp nhận
 * cảnh báo của nhóm khác).
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:contingency
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { saveContingencyPlanAction } from '@/risk/contingency-actions';
import { acknowledgeAlertAction, updateRiskRuleAction } from '@/risk/actions';
import { countOpenAlertsBySeverity, listOpenAlerts, runRiskScan } from '@/risk/scan';
import {
  kiemThuTuMuc,
  maNguong,
  mucCuaMaNguong,
  mucSauNhatDaCham,
  xemDuocCanhBaoDuPhong,
} from '@/risk/contingency';
import { toTradingDate } from '@/lib/trading-date';
import { PORTFOLIO_STATUS, ROLE, USER_STATUS } from '@/lib/enums';

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

function form(v: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, x] of Object.entries(v)) fd.set(k, x);
  return fd;
}

async function main(): Promise<void> {
  console.log('\n1. Quy tắc thuần');
  {
    const cacMuc = [
      { muc: 1 as const, nguongBps: 500, hanhDong: 'theo dõi', ruleId: 'a' },
      { muc: 2 as const, nguongBps: 1000, hanhDong: 'bán 50%', ruleId: 'b' },
      { muc: 3 as const, nguongBps: 2000, hanhDong: 'cắt lỗ', ruleId: 'c' },
    ];
    kiem(mucSauNhatDaCham(300, cacMuc) === null, 'lỗ 3% → chưa chạm mức nào');
    kiem(mucSauNhatDaCham(500, cacMuc)?.muc === 1, 'lỗ đúng 5% → mức 1 (chạm là tính)');
    kiem(mucSauNhatDaCham(1500, cacMuc)?.muc === 2, 'lỗ 15% → mức 2, không phải mức 1');
    kiem(mucSauNhatDaCham(3000, cacMuc)?.muc === 3, 'lỗ 30% → mức 3');
    kiem(
      mucSauNhatDaCham(1500, [cacMuc[0]!, cacMuc[2]!])?.muc === 1,
      'kế hoạch bỏ trống mức 2: lỗ 15% → vẫn là mức 1',
    );

    kiem(kiemThuTuMuc([{ muc: 1, nguongBps: 500 }, { muc: 2, nguongBps: 1000 }, { muc: 3, nguongBps: null }]) === null, 'hai mức tăng dần, mức 3 trống → hợp lệ');
    kiem(kiemThuTuMuc([{ muc: 1, nguongBps: 1000 }, { muc: 2, nguongBps: 500 }, { muc: 3, nguongBps: null }]) !== null, 'mức 2 nông hơn mức 1 → từ chối');
    kiem(kiemThuTuMuc([{ muc: 1, nguongBps: 1000 }, { muc: 2, nguongBps: 1000 }, { muc: 3, nguongBps: null }]) !== null, 'hai mức bằng nhau → từ chối');

    kiem(mucCuaMaNguong(maNguong('abc', 2)) === 2, 'đọc ngược mức từ mã ngưỡng');
    kiem(mucCuaMaNguong('STOCK_CONCENTRATION_10') === null, 'mã ngưỡng thường → không phải dự phòng');

    const ctx = JSON.stringify({ teamIds: ['T1'] });
    kiem(xemDuocCanhBaoDuPhong({ roleCode: ROLE.ADMIN, teamId: null }, ctx), 'admin thấy');
    kiem(xemDuocCanhBaoDuPhong({ roleCode: ROLE.SENIOR_MANAGER, teamId: null }, ctx), 'quản lý cấp cao thấy');
    kiem(xemDuocCanhBaoDuPhong({ roleCode: ROLE.TEAM_MANAGER, teamId: 'T1' }, ctx), 'quản lý nhóm đang giữ mã → thấy');
    kiem(!xemDuocCanhBaoDuPhong({ roleCode: ROLE.TEAM_MANAGER, teamId: 'T2' }, ctx), 'quản lý nhóm khác → không thấy');
    kiem(!xemDuocCanhBaoDuPhong({ roleCode: ROLE.EXECUTION, teamId: 'T1' }, ctx), 'người thực thi cùng nhóm → không thấy');
  }

  // -------------------------------------------------------------------------
  // Dữ liệu dựng riêng
  // -------------------------------------------------------------------------
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    select: { id: true },
  });
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  const phong = await prisma.department.findFirstOrThrow({ select: { id: true } });
  const nhom = (m: string) =>
    prisma.team.create({ data: { code: `${m}_${P}`, name: m, nameVi: m, departmentId: phong.id }, select: { id: true } });
  const nhomA = await nhom('DP_A');
  const nhomB = await nhom('DP_B');
  const vaiTro = async (c: string) => (await prisma.role.findFirstOrThrow({ where: { code: c }, select: { id: true } })).id;
  let n = 0;
  const nguoi = async (role: string, teamId: string | null) => {
    n += 1;
    return prisma.user.create({
      data: { email: `dp-${P}-${n}@example.com`, passwordHash: 'x', fullName: `DP ${n}`, status: USER_STATUS.ACTIVE, roleId: await vaiTro(role), teamId },
      select: { id: true, teamId: true, role: { select: { code: true } } },
    });
  };
  const thucThiA = await nguoi(ROLE.EXECUTION, nhomA.id);
  const qlA = await nguoi(ROLE.TEAM_MANAGER, nhomA.id);
  const qlB = await nguoi(ROLE.TEAM_MANAGER, nhomB.id);
  const capCao = await nguoi(ROLE.SENIOR_MANAGER, null);
  const xem = (u: { id: string; teamId: string | null; role: { code: string } | null }) => ({ roleCode: u.role?.code ?? null, teamId: u.teamId });

  const chienLuoc = await prisma.strategy.create({
    data: { code: `DP_${P}`.replace(/\d/g, 'X'), name: `DP test ${P}`, nameVi: `Kiểm dự phòng ${P}`, isActive: true },
    select: { id: true, nameVi: true },
  });
  const ma = await prisma.stock.findFirstOrThrow({
    where: { status: 'ACTIVE', trades: { none: {} } },
    select: { id: true, symbol: true },
  });
  const tk = await prisma.brokerAccount.create({
    data: { userId: thucThiA.id, broker: 'SSI', accountNo: `DP${P}`, isActive: true },
    select: { id: true },
  });
  await prisma.trade.create({
    data: {
      code: `DP${P}1`,
      portfolioId: portfolio.id,
      stockId: ma.id,
      brokerAccountId: tk.id,
      userId: thucThiA.id,
      createdById: thucThiA.id,
      teamId: nhomA.id,
      transactionType: 'BUY',
      status: 'EXECUTED',
      quantity: 1000,
      price: 100_000n,
      fees: 0n,
      tax: 0n,
      executedAt: new Date('2026-09-01T10:00:00+07:00'),
      strategies: { create: [{ strategyId: chienLuoc.id, allocationBps: 10_000, allocationAmount: 100_000_000n }] },
    },
  });

  const datGia = (gia: bigint) =>
    prisma.marketQuote.upsert({
      where: { stockId: ma.id },
      create: { stockId: ma.id, price: gia, tradingDate: toTradingDate(), fetchedAt: new Date() },
      update: { price: gia, fetchedAt: new Date(), isStale: false },
    });

  /** Cảnh báo dự phòng còn mở của mã này trong chiến lược này. */
  const moCuaMa = () =>
    prisma.riskAlert.findMany({
      where: {
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        targetRef: ma.symbol,
        rule: { targetRef: chienLuoc.id },
      },
      select: { id: true, severity: true, message: true, contextJson: true, rule: { select: { code: true } } },
    });

  console.log(`\n2. Lưu kế hoạch (${chienLuoc.nameVi}, mã ${ma.symbol})`);
  await createSession(admin.id);
  {
    const sai = await saveContingencyPlanAction(null, form({ strategyId: chienLuoc.id, isActive: 'on', level1: '10', level2: '5' }));
    kiem(!sai.ok && (sai.message ?? '').includes('sâu hơn'), 'mức 2 nông hơn mức 1 → từ chối', JSON.stringify(sai));

    const rong = await saveContingencyPlanAction(null, form({ strategyId: chienLuoc.id, isActive: 'on' }));
    kiem(!rong.ok, 'bật kế hoạch mà không có mức nào → từ chối');

    const thieu = await saveContingencyPlanAction(null, form({ strategyId: chienLuoc.id, isActive: 'on', level1: '5', action2: 'bán 50%' }));
    kiem(!thieu.ok && !!thieu.fieldErrors?.level2, 'có hành động mà thiếu % → từ chối đúng ô');

    kiem((await prisma.riskRule.count({ where: { targetRef: chienLuoc.id } })) === 0, 'các lần bị từ chối không ghi ngưỡng nào');

    await datGia(100_000n);
    const ok = await saveContingencyPlanAction(
      null,
      form({ strategyId: chienLuoc.id, isActive: 'on', level1: '-5', action1: 'Theo dõi', level2: '10', action2: 'Bán 50%', level3: '20', action3: 'Cắt lỗ toàn bộ' }),
    );
    kiem(ok.ok, 'kế hoạch hợp lệ → lưu được', JSON.stringify(ok));
    const nguong = await prisma.riskRule.findMany({
      where: { targetRef: chienLuoc.id },
      orderBy: { code: 'asc' },
      select: { threshold: true, severity: true, isActive: true, description: true },
    });
    kiem(nguong.length === 3, 'ba ngưỡng được tạo', String(nguong.length));
    kiem(nguong[0]?.threshold === 500n, '"-5" được hiểu là lỗ 5% (500 bps)', String(nguong[0]?.threshold));
    kiem(nguong.map((x) => x.severity).join() === 'WARNING,HIGH,CRITICAL', 'mức 1/2/3 → 🟡/🟠/🔴', nguong.map((x) => x.severity).join());
    kiem(nguong[1]?.description === 'Bán 50%', 'hành động được lưu theo mức');
  }

  console.log('\n3. Giá rơi qua từng mức');
  {
    await datGia(85_000n);
    await runRiskScan({ trigger: 'MANUAL', actorId: admin.id });
    let mo = await moCuaMa();
    kiem(mo.length === 1, 'lỗ 15% → đúng MỘT cảnh báo, không phải hai', String(mo.length));
    kiem(mucCuaMaNguong(mo[0]?.rule.code ?? '') === 2 && mo[0]?.severity === 'HIGH', 'cảnh báo ở mức 2 (🟠)', `${mo[0]?.rule.code} ${mo[0]?.severity}`);
    kiem((mo[0]?.message ?? '').includes('Kế hoạch: Bán 50%'), 'thông báo kèm hành động của mức 2', mo[0]?.message);
    kiem((JSON.parse(mo[0]?.contextJson ?? '{}') as { teamIds?: string[] }).teamIds?.includes(nhomA.id) ?? false, 'ghi nhận nhóm đang giữ mã');
    const mucHai = mo[0]?.id;

    await datGia(75_000n);
    await runRiskScan({ trigger: 'MANUAL', actorId: admin.id });
    mo = await moCuaMa();
    kiem(mo.length === 1 && mucCuaMaNguong(mo[0]!.rule.code) === 3, 'lỗ 25% → nâng lên mức 3', mo.map((x) => x.rule.code).join());
    kiem(
      (await prisma.riskAlert.findUnique({ where: { id: mucHai! }, select: { status: true } }))?.status === 'RESOLVED',
      'cảnh báo mức 2 tự đóng khi nâng mức',
    );

    await datGia(98_000n);
    await runRiskScan({ trigger: 'MANUAL', actorId: admin.id });
    kiem((await moCuaMa()).length === 0, 'giá hồi, lỗ 2% → mọi cảnh báo tự đóng');

    // Để lại một cảnh báo mở cho các mục sau.
    await datGia(85_000n);
    await runRiskScan({ trigger: 'MANUAL', actorId: admin.id });
  }

  console.log('\n4. Ai thấy');
  {
    const thay = async (u: Parameters<typeof xem>[0]) =>
      (await listOpenAlerts(xem(u), 500)).some((a) => a.targetRef === ma.symbol && a.ruleScope === 'STRATEGY_POSITION');
    const nguoiAdmin = await prisma.user.findUniqueOrThrow({ where: { id: admin.id }, select: { id: true, teamId: true, role: { select: { code: true } } } });

    kiem(await thay(nguoiAdmin), 'admin thấy trên danh sách');
    kiem(await thay(capCao), 'quản lý cấp cao thấy');
    kiem(await thay(qlA), 'quản lý nhóm A (nhóm đang giữ) thấy');
    kiem(!(await thay(qlB)), 'quản lý nhóm B KHÔNG thấy');
    kiem(!(await thay(thucThiA)), 'người thực thi đang giữ mã KHÔNG thấy (đúng yêu cầu)');

    const demAdmin = await countOpenAlertsBySeverity(xem(nguoiAdmin));
    const demThucThi = await countOpenAlertsBySeverity(xem(thucThiA));
    kiem(demAdmin.HIGH - demThucThi.HIGH >= 1, 'số trên chuông cũng lọc: admin đếm nhiều hơn người thực thi', `${demAdmin.HIGH} vs ${demThucThi.HIGH}`);
  }

  console.log('\n5. Hai lỗ đã bịt');
  {
    const r = await prisma.riskRule.findFirstOrThrow({ where: { code: maNguong(chienLuoc.id, 1) }, select: { id: true } });
    const sua = await updateRiskRuleAction(null, form({ ruleId: r.id, threshold: '5000', severity: 'INFO', isActive: 'on' }));
    kiem(!sua.ok && (sua.message ?? '').includes('Kế hoạch dự phòng'), 'form ngưỡng thường không sửa được một mức dự phòng', JSON.stringify(sua));

    const alert = (await moCuaMa())[0]!;
    await createSession(qlB.id);
    const tiepNhanSai = await acknowledgeAlertAction(null, form({ alertId: alert.id }));
    kiem(!tiepNhanSai.ok, 'quản lý nhóm B không tiếp nhận được cảnh báo của nhóm A');
    await createSession(qlA.id);
    const tiepNhan = await acknowledgeAlertAction(null, form({ alertId: alert.id }));
    kiem(tiepNhan.ok, 'quản lý nhóm A tiếp nhận được', JSON.stringify(tiepNhan));
  }

  console.log('\n6. Xoá một mức, rồi tắt cả kế hoạch');
  {
    await createSession(admin.id);
    await saveContingencyPlanAction(
      null,
      form({ strategyId: chienLuoc.id, isActive: 'on', level1: '5', action1: 'Theo dõi', level3: '20', action3: 'Cắt lỗ' }),
    );
    const m2 = await prisma.riskRule.findFirstOrThrow({ where: { code: maNguong(chienLuoc.id, 2) }, select: { threshold: true, isActive: true } });
    kiem(!m2.isActive && m2.threshold === 0n, 'mức 2 bị xoá → tắt và ngưỡng về 0 (form không điền lại)');
    const mo = await moCuaMa();
    kiem(mo.length === 1 && mucCuaMaNguong(mo[0]!.rule.code) === 1, 'lỗ 15% không còn mức 2 → cảnh báo về mức 1', mo.map((x) => x.rule.code).join());

    await saveContingencyPlanAction(
      null,
      form({ strategyId: chienLuoc.id, level1: '5', action1: 'Theo dõi', level3: '20', action3: 'Cắt lỗ' }),
    );
    kiem((await moCuaMa()).length === 0, 'tắt kế hoạch → cảnh báo của nó đóng ngay');
    const con = await prisma.riskRule.findFirstOrThrow({ where: { code: maNguong(chienLuoc.id, 1) }, select: { threshold: true, isActive: true } });
    kiem(!con.isActive && con.threshold === 500n, 'tắt kế hoạch vẫn giữ con số của các mức để bật lại');
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
