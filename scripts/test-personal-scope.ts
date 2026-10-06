/**
 * KIỂM THỬ: VỊ THẾ VÀ GIAO DỊCH THU HẸP THEO VAI TRÒ.
 *
 * Quyết định của người dùng ("thu hẹp lại, và theo vai trò"):
 *   Người thực thi, Thành viên     chỉ của chính mình
 *   Quản lý nhóm                    cả nhóm mình
 *   Quản lý cấp cao, Admin          tất cả
 *
 * Trước đây `position.view` / `transaction.view` nghĩa là "cả nhóm", nên người thực thi
 * mở trang Giao dịch là thấy lệnh của mọi người trong nhóm.
 *
 * Bài này KẾT XUẤT TRANG THẬT với phiên của từng vai trò và dò id lệnh trong HTML —
 * không chỉ gọi hàm phạm vi: một chỗ quên đổi (bộ đếm trạng thái, trang chi tiết) là lộ
 * dữ liệu dù hàm phạm vi đúng.
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:personal-scope
 */

import { renderToPipeableStream } from 'react-dom/server';
import type { ReactElement } from 'react';
import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { ROLE, USER_STATUS, type RoleCode } from '@/lib/enums';
import { phamViCaNhan, resolvePermissions } from '@/domain/permissions';
import {
  applyPersonalScope,
  computeAccountBalances,
  computeCash,
  computePositions,
  computeStrategyAllocation,
} from '@/domain/portfolio-engine';
import { buildReport, estimateRowCount } from '@/reports/build';
import { formatVnd } from '@/lib/money';
import TransactionsPage from '../app/(app)/transactions/page';
import DashboardPage from '../app/(app)/dashboard/page';
import PortfolioPage from '../app/(app)/portfolio/page';
import AllocationPage from '../app/(app)/portfolio/allocation/page';
import StrategiesPage from '../app/(app)/strategies/page';
import TeamsPage from '../app/(app)/teams/page';
import ReportsPage from '../app/(app)/reports/page';
import MemberPage from '../app/(app)/members/[id]/page';
import TradeDetailPage from '../app/(app)/transactions/[id]/page';
import PositionsPage from '../app/(app)/portfolio/positions/page';

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

function ketXuat(el: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const phan: Buffer[] = [];
    let xong = false;
    const { pipe } = renderToPipeableStream(el, {
      onAllReady() {
        pipe({
          write(c: unknown) {
            phan.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
            return true;
          },
          end() {
            if (!xong) {
              xong = true;
              resolve(Buffer.concat(phan).toString('utf8'));
            }
          },
          on() {}, once() {}, emit() {}, removeListener() {},
        } as never);
      },
      onError(e: unknown) {
        if (!xong) {
          xong = true;
          reject(e);
        }
      },
    });
  });
}

type Trang<P> = (p: P) => Promise<ReactElement>;

/** Mở một trang với phiên của `viewerId`. Trả 'NOT_FOUND' / 'FORBIDDEN' hoặc HTML. */
async function mo<P>(viewerId: string, page: unknown, props: P): Promise<string> {
  await createSession(viewerId);
  try {
    return await ketXuat(await (page as Trang<P>)(props));
  } catch (e) {
    if (e instanceof Error && e.name === 'NotFoundError') return 'NOT_FOUND';
    if (e instanceof Error && e.name === 'ForbiddenPageError') return 'FORBIDDEN';
    throw e;
  }
}

const moDanhSach = (viewerId: string) =>
  mo(viewerId, TransactionsPage, { searchParams: Promise.resolve({}) });
const moChiTiet = (viewerId: string, id: string) =>
  mo(viewerId, TradeDetailPage, { params: Promise.resolve({ id }) });

async function main(): Promise<void> {
  console.log('\n1. Vai trò → phạm vi');
  {
    const mong: [RoleCode, string][] = [
      [ROLE.EXECUTION, 'SELF'],
      [ROLE.MEMBER, 'SELF'],
      [ROLE.TEAM_MANAGER, 'TEAM'],
      [ROLE.SENIOR_MANAGER, 'ALL'],
      [ROLE.ADMIN, 'ALL'],
    ];
    for (const [role, pv] of mong) {
      const q = resolvePermissions(role);
      kiem(phamViCaNhan(q, 'position') === pv, `${role} xem vị thế: ${pv}`, phamViCaNhan(q, 'position'));
      kiem(phamViCaNhan(q, 'transaction') === pv, `${role} xem giao dịch: ${pv}`, phamViCaNhan(q, 'transaction'));
    }
    kiem(phamViCaNhan(new Set(), 'position') === 'NONE', 'không quyền nào → NONE');
    for (const [role, pv] of mong) {
      const q = resolvePermissions(role);
      kiem(phamViCaNhan(q, 'portfolio') === pv, `${role} xem danh mục: ${pv}`, phamViCaNhan(q, 'portfolio'));
    }
    kiem(phamViCaNhan(resolvePermissions(ROLE.EXECUTION), 'capital') === 'SELF', 'người thực thi xem vốn: SELF');
    kiem(phamViCaNhan(resolvePermissions(ROLE.TEAM_MANAGER), 'capital') === 'TEAM', 'quản lý nhóm xem vốn: TEAM');
    kiem(phamViCaNhan(resolvePermissions(ROLE.SENIOR_MANAGER), 'capital') === 'ALL', 'quản lý cấp cao xem vốn: ALL');
  }

  console.log('\n2. applyPersonalScope ghi đè bộ lọc từ URL');
  {
    const nguoi = { id: 'toi', teamId: 'nhom-a' };
    kiem(applyPersonalScope({ userId: 'nguoi-khac' }, 'SELF', nguoi).userId === 'toi', 'SELF: userId người khác bị ghi đè');
    kiem(applyPersonalScope({ teamId: 'nhom-b' }, 'TEAM', nguoi).teamId === 'nhom-a', 'TEAM: teamId nhóm khác bị ghi đè');
    kiem(applyPersonalScope({ teamId: 'nhom-b' }, 'ALL', nguoi).teamId === 'nhom-b', 'ALL: giữ bộ lọc');
    kiem(
      applyPersonalScope({}, 'TEAM', { id: 'x', teamId: null }).teamId === '__no_team__',
      'TEAM mà không có nhóm → không thấy gì',
    );
  }

  // --- Chọn người thật trong bản sao -------------------------------------------------
  const thucThiCoLenh = await prisma.user.findMany({
    where: { role: { code: ROLE.EXECUTION }, status: USER_STATUS.ACTIVE, teamId: { not: null } },
    select: { id: true, fullName: true, teamId: true, _count: { select: { tradesExecuted: true } } },
  });
  // Người thực thi có lệnh, trong nhóm có người khác cũng có lệnh.
  let thucThi: (typeof thucThiCoLenh)[number] | undefined;
  let lenhDongDoi: { id: string; userId: string } | null = null;
  for (const u of thucThiCoLenh.filter((x) => x._count.tradesExecuted > 0)) {
    lenhDongDoi = await prisma.trade.findFirst({
      where: { teamId: u.teamId, userId: { not: u.id }, createdById: { not: u.id } },
      orderBy: { executedAt: 'desc' },
      select: { id: true, userId: true },
    });
    if (lenhDongDoi) {
      thucThi = u;
      break;
    }
  }
  if (!thucThi || !lenhDongDoi) throw new Error('can mot nguoi thuc thi co lenh, cung nhom voi nguoi khac co lenh');

  const quanLyNhom = await prisma.user.findFirst({
    where: { role: { code: ROLE.TEAM_MANAGER }, status: USER_STATUS.ACTIVE, teamId: thucThi.teamId },
    select: { id: true },
  });
  const lenhNhomKhac = await prisma.trade.findFirst({
    where: { teamId: { not: thucThi.teamId } },
    select: { id: true },
  });
  const capCao = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.SENIOR_MANAGER }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });

  const lenhCuaToi = await prisma.trade.findFirstOrThrow({
    where: { userId: thucThi.id },
    orderBy: { executedAt: 'desc' },
    select: { id: true },
  });

  /*
   * LỆNH NHẬP HỘ: người thực thi nhập cho người khác thực hiện. Dữ liệu thật có thể không
   * có trường hợp này, nên dựng trên bản sao bằng cách đổi người nhập của lệnh đồng đội
   * sang người thực thi — rồi kiểm cả hai chiều.
   */
  const lenhNhapHo = await prisma.trade.findFirstOrThrow({
    where: { teamId: thucThi.teamId, userId: { not: thucThi.id }, id: { not: lenhDongDoi.id } },
    select: { id: true },
  });
  await prisma.trade.update({ where: { id: lenhNhapHo.id }, data: { createdById: thucThi.id } });

  await prisma.user.updateMany({
    where: { id: { in: [thucThi.id, quanLyNhom?.id ?? '', capCao.id, admin.id] } },
    data: { mustChangePassword: false },
  });

  console.log(`\n3. Trang Giao dịch — người thực thi (${thucThi.fullName})`);
  {
    const html = await moDanhSach(thucThi.id);
    kiem(html.includes(`/transactions/${lenhCuaToi.id}`), 'thấy lệnh của chính mình');
    kiem(!html.includes(`/transactions/${lenhDongDoi.id}`), 'KHÔNG thấy lệnh của đồng đội');
    kiem(html.includes(`/transactions/${lenhNhapHo.id}`), 'thấy lệnh mình nhập hộ người khác');
    if (lenhNhomKhac) kiem(!html.includes(`/transactions/${lenhNhomKhac.id}`), 'KHÔNG thấy lệnh nhóm khác');
    kiem(html.includes('giao dịch của bạn'), 'tiêu đề nói rõ "của bạn"');

    const tuDem = await prisma.trade.count({
      where: { OR: [{ userId: thucThi.id }, { createdById: thucThi.id }] },
    });
    kiem(html.includes(`${tuDem.toLocaleString('vi-VN')} giao dịch của bạn`), `đếm đúng ${tuDem} lệnh`);
  }

  console.log('\n4. Trang chi tiết giao dịch');
  {
    kiem((await moChiTiet(thucThi.id, lenhCuaToi.id)) !== 'NOT_FOUND', 'người thực thi mở được lệnh của mình');
    kiem((await moChiTiet(thucThi.id, lenhNhapHo.id)) !== 'NOT_FOUND', 'người thực thi mở được lệnh mình nhập hộ');
    kiem(
      (await moChiTiet(thucThi.id, lenhDongDoi.id)) === 'NOT_FOUND',
      'người thực thi mở lệnh đồng đội bằng URL → 404',
    );
    if (quanLyNhom) {
      kiem((await moChiTiet(quanLyNhom.id, lenhDongDoi.id)) !== 'NOT_FOUND', 'quản lý nhóm mở được lệnh trong nhóm');
      if (lenhNhomKhac) {
        kiem((await moChiTiet(quanLyNhom.id, lenhNhomKhac.id)) === 'NOT_FOUND', 'quản lý nhóm mở lệnh nhóm khác → 404');
      }
    }
    if (lenhNhomKhac) {
      kiem((await moChiTiet(capCao.id, lenhNhomKhac.id)) !== 'NOT_FOUND', 'quản lý cấp cao mở được mọi lệnh');
      kiem((await moChiTiet(admin.id, lenhNhomKhac.id)) !== 'NOT_FOUND', 'admin mở được mọi lệnh');
    }
  }

  console.log('\n5. Trang Giao dịch — quản lý nhóm, cấp cao');
  if (quanLyNhom) {
    const html = await moDanhSach(quanLyNhom.id);
    const lenhNhom = await prisma.trade.findMany({
      where: { teamId: thucThi.teamId },
      orderBy: [{ executedAt: 'desc' }, { code: 'desc' }],
      take: 30,
      select: { id: true },
    });
    kiem(lenhNhom.every((l) => html.includes(`/transactions/${l.id}`)), 'quản lý nhóm thấy trang đầu lệnh của cả nhóm');
    if (lenhNhomKhac) kiem(!html.includes(`/transactions/${lenhNhomKhac.id}`), 'quản lý nhóm KHÔNG thấy nhóm khác');
  }
  {
    const tong = await prisma.trade.count();
    const html = await moDanhSach(capCao.id);
    kiem(html.includes(`${tong.toLocaleString('vi-VN')} giao dịch trên toàn hệ thống`), `quản lý cấp cao thấy cả ${tong} lệnh`);
  }

  console.log('\n6. Trang Vị thế');
  {
    const portfolio = await prisma.portfolio.findFirstOrThrow({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    const cuaToi = (await computePositions({ portfolioId: portfolio.id, userId: thucThi.id })).filter(
      (p) => p.quantity > 0,
    );
    const cuaNhom = (await computePositions({ portfolioId: portfolio.id, teamId: thucThi.teamId! })).filter(
      (p) => p.quantity > 0,
    );
    const html = await mo(thucThi.id, PositionsPage, { searchParams: Promise.resolve({}) });
    kiem(html.includes(`${cuaToi.length} vị thế đang giữ`), `người thực thi thấy ${cuaToi.length} vị thế của mình`);
    kiem(html.includes('của bạn'), 'tiêu đề nói rõ "của bạn"');
    const maChiNhomCo = cuaNhom.filter((p) => !cuaToi.some((q) => q.symbol === p.symbol)).map((p) => p.symbol);
    kiem(
      maChiNhomCo.every((m) => !html.includes(`/transactions?symbol=${m}"`)),
      `KHÔNG thấy ${maChiNhomCo.length} mã chỉ đồng đội giữ`,
      maChiNhomCo.filter((m) => html.includes(`/transactions?symbol=${m}"`)).join(','),
    );

    if (quanLyNhom) {
      const htmlQl = await mo(quanLyNhom.id, PositionsPage, { searchParams: Promise.resolve({}) });
      kiem(htmlQl.includes(`${cuaNhom.length} vị thế đang giữ`), `quản lý nhóm thấy ${cuaNhom.length} vị thế của cả nhóm`);
    }
  }

  const pid = (
    await prisma.portfolio.findFirstOrThrow({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
  ).id;
  const khong = { searchParams: Promise.resolve({}) };
  const dongDoi = await prisma.user.findUniqueOrThrow({
    where: { id: lenhDongDoi.userId },
    select: { fullName: true },
  });

  console.log('\n7. Tiền của MỘT NGƯỜI — khớp trang cá nhân, cộng lại bằng danh mục');
  {
    const coTk = await prisma.user.findMany({
      where: { brokerAccounts: { some: {} } },
      select: { id: true },
    });
    let lech = 0;
    let tongNguoi = 0n;
    for (const u of coTk) {
      const tien = await computeCash(pid, { userId: u.id });
      const tk = await computeAccountBalances(pid, u.id);
      const soDu = tk.reduce((a, x) => a + x.available, 0n);
      const cap = tk.reduce((a, x) => a + x.granted, 0n);
      if (tien.cashBalance !== soDu || tien.contributedCapital + tien.otherFlows !== cap) lech++;
      if (tien.scope !== 'USER' || tien.reserveAmount !== 0n) lech++;
      tongNguoi += tien.cashBalance;
    }
    kiem(lech === 0, `tiền từng người (${coTk.length} người) = Σ số dư tài khoản trên trang cá nhân`, `${lech} lệch`);
    const dm = await computeCash(pid);
    kiem(tongNguoi === dm.cashBalance, 'Σ tiền từng người = tiền cả danh mục', `${tongNguoi} vs ${dm.cashBalance}`);
  }

  console.log(`\n8. Dashboard — người thực thi (${thucThi.fullName})`);
  {
    const html = await mo(thucThi.id, DashboardPage, khong);
    kiem(html.includes('phần của bạn'), 'phụ đề nói rõ "phần của bạn"');
    kiem(!html.includes(dongDoi.fullName), `KHÔNG thấy tên đồng đội (${dongDoi.fullName})`);
    kiem(!html.includes(`/transactions/${lenhDongDoi.id}`), 'KHÔNG thấy lệnh gần đây của đồng đội');
    const tien = await computeCash(pid, { userId: thucThi.id });
    const dm = await computeCash(pid);
    kiem(tien.contributedCapital !== dm.contributedCapital, '(vốn của mình khác vốn danh mục — phép thử dưới có nghĩa)');
    kiem(!html.includes(formatVnd(dm.contributedCapital)), 'KHÔNG hiện vốn góp của cả danh mục');

    const htmlCc = await mo(capCao.id, DashboardPage, khong);
    kiem(!htmlCc.includes('phần của bạn'), 'quản lý cấp cao: không bị thu hẹp');
    if (quanLyNhom) {
      const htmlQl = await mo(quanLyNhom.id, DashboardPage, khong);
      kiem(htmlQl.includes('phạm vi nhóm'), 'quản lý nhóm: phạm vi nhóm');
    }
  }

  console.log('\n9. Danh mục, Phân bổ');
  {
    const cuaToi = (await computePositions({ portfolioId: pid, userId: thucThi.id })).filter((p) => p.quantity > 0);
    const html = await mo(thucThi.id, PortfolioPage, khong);
    kiem(html.includes(`${cuaToi.length} vị thế đang giữ · phần của bạn`), `Danh mục: ${cuaToi.length} vị thế của mình`);
    const htmlPb = await mo(thucThi.id, AllocationPage, {});
    kiem(htmlPb.includes('phần của bạn'), 'Phân bổ: phần của bạn');
    const htmlCc = await mo(capCao.id, PortfolioPage, khong);
    kiem(!htmlCc.includes('phần của bạn'), 'quản lý cấp cao: Danh mục không bị thu hẹp');
  }

  console.log('\n10. Chiến lược');
  {
    const cuaToi = await computeStrategyAllocation({ portfolioId: pid, userId: thucThi.id });
    const tong = cuaToi.reduce((a, x) => a + x.netCapital, 0n);
    const html = await mo(thucThi.id, StrategiesPage, {});
    kiem(html.includes(`vốn ròng đang triển khai ${formatVnd(tong)}`), `vốn ròng = của mình (${formatVnd(tong)})`);
    kiem(html.includes('phần của bạn'), 'phụ đề nói rõ "phần của bạn"');
    if (quanLyNhom) {
      const cuaNhom = await computeStrategyAllocation({ portfolioId: pid, teamId: thucThi.teamId });
      const tongNhom = cuaNhom.reduce((a, x) => a + x.netCapital, 0n);
      const htmlQl = await mo(quanLyNhom.id, StrategiesPage, {});
      kiem(htmlQl.includes(`vốn ròng đang triển khai ${formatVnd(tongNhom)}`), 'quản lý nhóm: vốn ròng của cả nhóm');
    }
  }

  console.log('\n11. Nhóm');
  {
    const html = await mo(thucThi.id, TeamsPage, {});
    kiem(html.includes('số tiền chỉ hiện phần của chính bạn'), 'phụ đề nói rõ phạm vi');
    kiem(!html.includes('Giao dịch của nhóm →'), 'không có số liệu / lối vào cấp nhóm');
    kiem(html.includes(dongDoi.fullName), 'vẫn thấy đồng đội trong cơ cấu nhóm');
    if (quanLyNhom) {
      const htmlQl = await mo(quanLyNhom.id, TeamsPage, {});
      kiem(htmlQl.includes('Giao dịch của nhóm →'), 'quản lý nhóm vẫn thấy số liệu nhóm');
    }
  }

  console.log('\n12. Báo cáo');
  {
    const soLenh = await prisma.trade.count({ where: { portfolioId: pid, userId: thucThi.id } });
    kiem(
      (await estimateRowCount('transactions', pid, { userId: thucThi.id })) === soLenh,
      `số dòng ước tính = ${soLenh} lệnh của mình`,
    );
    const lenh = await buildReport('transactions', { portfolioId: pid, period: 'YTD', userId: thucThi.id });
    kiem(lenh.rows.length === soLenh, 'CSV giao dịch chỉ gồm lệnh của mình');
    const soDong = await prisma.capitalFlow.count({
      where: { portfolioId: pid, brokerAccount: { userId: thucThi.id } },
    });
    const von = await buildReport('capital-flows', { portfolioId: pid, period: 'YTD', userId: thucThi.id });
    kiem(von.rows.length === soDong, `CSV dòng vốn chỉ gồm ${soDong} dòng của tài khoản mình`);
    const html = await mo(thucThi.id, ReportsPage, {});
    kiem(html.includes('phần của bạn'), 'trang Báo cáo nói rõ "phần của bạn"');
  }

  console.log('\n13. "Giá trị từng tài khoản" trên trang thành viên — theo vai trò');
  {
    const KHOI = 'Giá trị từng tài khoản';
    const coTk = await prisma.brokerAccount.count({ where: { userId: thucThi.id } });
    if (coTk === 0) {
      console.log('  BOQUA: người thực thi chưa có tài khoản chứng khoán');
    } else {
      const trang = (viewerId: string) =>
        mo(viewerId, MemberPage, { params: Promise.resolve({ id: thucThi.id }) });

      kiem((await trang(thucThi.id)).includes(KHOI), 'chính chủ thấy');
      if (quanLyNhom) kiem((await trang(quanLyNhom.id)).includes(KHOI), 'quản lý cùng nhóm thấy');
      kiem((await trang(capCao.id)).includes(KHOI), 'quản lý cấp cao thấy');
      kiem((await trang(admin.id)).includes(KHOI), 'admin thấy');

      const qlNhomKhac = await prisma.user.findFirst({
        where: {
          role: { code: ROLE.TEAM_MANAGER },
          status: USER_STATUS.ACTIVE,
          teamId: { not: thucThi.teamId },
        },
        select: { id: true },
      });
      if (qlNhomKhac) {
        await prisma.user.update({ where: { id: qlNhomKhac.id }, data: { mustChangePassword: false } });
        kiem((await trang(qlNhomKhac.id)) === 'FORBIDDEN', 'quản lý NHÓM KHÁC không mở được trang');
      }
      const dongDoiTT = await prisma.user.findFirst({
        where: {
          role: { code: ROLE.EXECUTION },
          status: USER_STATUS.ACTIVE,
          teamId: thucThi.teamId,
          id: { not: thucThi.id },
        },
        select: { id: true },
      });
      if (dongDoiTT) {
        await prisma.user.update({ where: { id: dongDoiTT.id }, data: { mustChangePassword: false } });
        kiem((await trang(dongDoiTT.id)) === 'FORBIDDEN', 'người thực thi cùng nhóm không mở được trang');
      }
      // Chỉ XEM: người khác không có form nạp/rút trên tài khoản của chủ.
      kiem(!(await trang(capCao.id)).includes('Nạp / rút tiền'), 'người xem không có cột nạp/rút');
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
