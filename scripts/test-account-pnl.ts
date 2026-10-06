/**
 * KIỂM THỬ: BÁO CÁO VỐN & LỢI NHUẬN THEO TÀI KHOẢN (mẫu baocaoChungKhoan_2026.xlsx).
 *
 *   1. "Vốn ròng đến hôm nay" của từng tài khoản = giá trị tài khoản mà hệ thống đang
 *      hiện (Σ vị thế theo giá + tiền mặt, `computeAccountBalances`).
 *   2. Hai kỳ liền nhau nối khớp: vốn ròng cuối tháng 9 = vốn ròng đầu tháng 10.
 *   3. Profit cộng dồn khớp: Profit(9) + Profit(10) = Profit(9→10).
 *   4. Phạm vi theo vai trò qua route thật: thực thi chỉ tài khoản của mình.
 *   5. Ghi được file .xlsx — lưu ra thư mục tạm cho bước soát bằng openpyxl.
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:account-pnl
 */

import { writeFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { ROLE, USER_STATUS } from '@/lib/enums';
import { computeAccountBalances } from '@/domain/portfolio-engine';
import { buildAccountPnl } from '@/reports/account-pnl';
import { ghiAccountPnlXlsx } from '@/reports/account-pnl-xlsx';
import { tradingDayString } from '@/lib/trading-date';
import { GET } from '../app/api/reports/account-pnl/route';

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

const loi = (d: { vonTu: bigint; nop: bigint; rut: bigint; vonDen: bigint }) =>
  d.vonDen - d.vonTu - d.nop + d.rut;

async function main(): Promise<void> {
  const pf = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const homNay = tradingDayString();

  console.log('1. Đến hôm nay = giá trị tài khoản hệ thống đang hiện');
  {
    const bc = await buildAccountPnl(pf.id, '2026-10-01', homNay, {});
    /*
     * TÀI KHOẢN CÓ LỆNH / DÒNG VỐN GHI NGÀY TƯƠNG LAI được so riêng: báo cáo tính "tới hôm
     * nay" nên chưa đếm chúng, còn số dư hệ thống cộng mọi lệnh bất kể ngày. Dữ liệu thật
     * có đúng trường hợp này (V65517, mọi thứ ghi 09/12/2026 — nhiều khả năng 12/09 nhập
     * đảo ngày tháng).
     */
    const bayGio = new Date();
    const tuongLai = new Set(
      [
        ...(await prisma.trade.findMany({ where: { executedAt: { gt: bayGio } }, select: { brokerAccountId: true } })),
        ...(await prisma.capitalFlow.findMany({ where: { occurredAt: { gt: bayGio } }, select: { brokerAccountId: true } })),
      ]
        .map((x) => x.brokerAccountId)
        .filter((x): x is string => x !== null),
    );
    let lech = 0;
    let lechTuongLai = 0;
    const chiTiet: string[] = [];
    for (const d of bc.dong) {
      const owner = await prisma.brokerAccount.findUniqueOrThrow({
        where: { id: d.accountId },
        select: { userId: true },
      });
      const b = (await computeAccountBalances(pf.id, owner.userId)).find((x) => x.accountId === d.accountId)!;
      const heThong = b.positionValue + b.available;
      if (tuongLai.has(d.accountId)) {
        if (heThong !== d.vonDen) lechTuongLai++;
        continue;
      }
      if (heThong !== d.vonDen) {
        lech++;
        if (chiTiet.length < 3) chiTiet.push(`${d.ten} ${d.soTaiKhoan}: ${d.vonDen} vs ${heThong}`);
      }
    }
    kiem(
      lech === 0,
      `${bc.dong.length - tuongLai.size} tài khoản khớp từng đồng`,
      `${lech} lệch: ${chiTiet.join('; ')}`,
    );
    kiem(
      lechTuongLai === tuongLai.size,
      `${tuongLai.size} tài khoản có lệnh ghi ngày tương lai: báo cáo KHÔNG tính trước`,
    );
  }

  console.log('\n2–3. Hai kỳ nối khớp');
  {
    const t9 = await buildAccountPnl(pf.id, '2026-09-01', '2026-09-30', {});
    const t10 = await buildAccountPnl(pf.id, '2026-10-01', homNay, {});
    const ca = await buildAccountPnl(pf.id, '2026-09-01', homNay, {});
    const theoId = (x: typeof t9) => new Map(x.dong.map((d) => [d.accountId, d]));
    const m9 = theoId(t9);
    const m10 = theoId(t10);
    let noi = 0;
    let cong = 0;
    for (const d of ca.dong) {
      const a = m9.get(d.accountId);
      const b = m10.get(d.accountId);
      if (a && b && a.vonDen !== b.vonTu) noi++;
      const p9 = a ? loi(a) : 0n;
      const p10 = b ? loi(b) : 0n;
      if (p9 + p10 !== loi(d)) cong++;
    }
    kiem(noi === 0, 'vốn ròng cuối tháng 9 = đầu tháng 10 (mọi tài khoản)', `${noi} lệch`);
    kiem(cong === 0, 'Profit tháng 9 + tháng 10 = Profit cả khoảng', `${cong} lệch`);
    kiem(t9.dong.length > 0, `tháng 9 có ${t9.dong.length} tài khoản`);
    kiem(t9.vonNguoi.length > 0, `bảng vốn có ${t9.vonNguoi.length} người`);
    const tenTrung = new Set(t9.vonNguoi.map((p) => p.ten)).size === t9.vonNguoi.length;
    kiem(tenTrung, 'tên trong bảng vốn không trùng (SUMIFS theo tên không gộp nhầm)');

    const file = await ghiAccountPnlXlsx(t9, { nguoiXuat: 'kiểm thử', phamVi: 'Toàn bộ tài khoản' });
    kiem(file.sheetName === '2026-Thang9', `tên sheet "${file.sheetName}"`);
    const ra = process.env.ACCOUNT_PNL_OUT;
    if (ra) {
      writeFileSync(ra, file.buffer);
      // Số mong đợi cho bước soát bằng openpyxl.
      writeFileSync(
        `${ra}.json`,
        JSON.stringify({
          rows: t9.dong.map((d) => ({
            ten: d.ten,
            tk: d.soTaiKhoan,
            G: Number(d.vonTu),
            H: Number(d.nop),
            I: Number(d.rut),
            J: Number(d.vonDen),
          })),
          people: t9.vonNguoi.map((p) => ({ ten: p.ten, O: Number(p.vonBanDau) })),
        }),
      );
    }
  }

  console.log('\n4. Phạm vi theo vai trò — qua route thật');
  {
    const tai = async (userId: string, q: string) => {
      await createSession(userId);
      return GET(new NextRequest(`http://localhost/api/reports/account-pnl?${q}`));
    };
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
      select: { id: true },
    });
    const r = await tai(admin.id, 'thang=2026-09');
    kiem(r.status === 200, 'admin tải được', String(r.status));
    kiem(
      (r.headers.get('content-disposition') ?? '').includes('baocaoChungKhoan_2026-Thang9.xlsx'),
      'tên file đúng mẫu',
      r.headers.get('content-disposition') ?? '',
    );
    kiem((await tai(admin.id, 'thang=2026-13')).status === 400, 'tháng sai → 400');
    kiem((await tai(admin.id, 'from=2026-09-30&to=2026-09-01')).status === 400, 'từ sau đến → 400');

    const nk = await prisma.auditLog.count({ where: { entityId: 'account-pnl' } });
    kiem(nk >= 1, 'mỗi lần xuất ghi nhật ký');

    const thucThi = await prisma.user.findFirstOrThrow({
      where: { role: { code: ROLE.EXECUTION }, status: USER_STATUS.ACTIVE },
      select: { id: true },
    });
    kiem((await tai(thucThi.id, 'thang=2026-09')).status === 403, 'người thực thi (không có report.export) → 403');

    // Phạm vi SELF / TEAM ở tầng dữ liệu.
    const ql = await prisma.user.findFirst({
      where: { role: { code: ROLE.TEAM_MANAGER }, status: USER_STATUS.ACTIVE, teamId: { not: null } },
      select: { id: true, teamId: true },
    });
    const tkCuaToi = await buildAccountPnl(pf.id, '2026-09-01', '2026-09-30', { userId: thucThi.id });
    const soTk = await prisma.brokerAccount.count({ where: { userId: thucThi.id } });
    kiem(
      tkCuaToi.dong.every((d) => d.userId === thucThi.id) && tkCuaToi.dong.length <= soTk,
      `SELF: chỉ ${tkCuaToi.dong.length} tài khoản của chính mình`,
    );
    if (ql) {
      const nhom = await buildAccountPnl(pf.id, '2026-09-01', '2026-09-30', { teamId: ql.teamId });
      const ids = new Set(
        (await prisma.user.findMany({ where: { teamId: ql.teamId }, select: { id: true } })).map((u) => u.id),
      );
      kiem(nhom.dong.every((d) => ids.has(d.userId)), `TEAM: ${nhom.dong.length} tài khoản, đều trong nhóm`);
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
