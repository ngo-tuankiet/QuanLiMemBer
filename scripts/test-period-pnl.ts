/**
 * KIỂM THỬ: Ô "TỔNG LÃI/LỖ" ĐI THEO BỘ LỌC THỜI GIAN.
 *
 * Hai cách tính ĐỘC LẬP phải ra cùng một số:
 *   - `computePeriodPnl` (Dashboard)  — theo vị thế: Δ giá trị vị thế − mua + bán + thu khác
 *   - `buildAccountPnl` (báo cáo tháng) — theo tài sản ròng từng tài khoản: cuối − đầu − nộp + rút
 *
 * So theo TỪNG NGƯỜI. Bỏ người có lệnh/dòng vốn ghi ngày tương lai: báo cáo tháng dừng ở
 * hôm nay, còn vị thế hiện tại thì đã gồm chúng.
 *
 * Dùng: npm run test:period-pnl
 */

import { renderToPipeableStream } from 'react-dom/server';
import type { ReactElement } from 'react';
import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { ROLE, USER_STATUS } from '@/lib/enums';
import { computePeriodPnl, type PeriodCode } from '@/domain/portfolio-engine';
import { buildAccountPnl } from '@/reports/account-pnl';
import { tradingDayString } from '@/lib/trading-date';
import DashboardPage from '../app/(app)/dashboard/page';

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

async function main(): Promise<void> {
  const pf = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const homNay = tradingDayString();
  const bayGio = new Date();

  const nguoiTuongLai = new Set(
    [
      ...(await prisma.trade.findMany({ where: { executedAt: { gt: bayGio } }, select: { userId: true } })).map((x) => x.userId),
      ...(
        await prisma.capitalFlow.findMany({
          where: { occurredAt: { gt: bayGio } },
          select: { brokerAccount: { select: { userId: true } } },
        })
      ).map((x) => x.brokerAccount?.userId ?? ''),
    ].filter(Boolean),
  );

  console.log('1. Khớp báo cáo tháng, theo từng người');
  for (const period of ['1W', '1M', '3M'] as PeriodCode[]) {
    const nguoi = await prisma.user.findMany({
      where: { brokerAccounts: { some: {} }, id: { notIn: [...nguoiTuongLai] } },
      select: { id: true, fullName: true },
    });
    let lech = 0;
    const chiTiet: string[] = [];
    let tuNgay = '';
    for (const u of nguoi) {
      const p = await computePeriodPnl({ portfolioId: pf.id, userId: u.id }, period);
      if (!p) throw new Error('khong co ky');
      tuNgay = p.tuNgay;
      const bc = await buildAccountPnl(pf.id, p.tuNgay, homNay, { userId: u.id });
      const tong = bc.dong.reduce((s, d) => s + (d.vonDen - d.vonTu - d.nop + d.rut), 0n);
      if (tong !== p.pnl && p.thieuGiaDau.length === 0) {
        lech++;
        if (chiTiet.length < 3) chiTiet.push(`${u.fullName}: ${p.pnl} vs ${tong}`);
      }
    }
    kiem(lech === 0, `${period} (từ ${tuNgay}): ${nguoi.length} người khớp từng đồng`, `${lech} lệch: ${chiTiet.join('; ')}`);
  }

  console.log('\n2. Cộng các nhóm = cả danh mục');
  {
    const tong = await computePeriodPnl({ portfolioId: pf.id }, '1M');
    const nhom = await prisma.team.findMany({ select: { id: true } });
    let cong = 0n;
    for (const n of [...nhom.map((x) => x.id), null]) {
      cong += (await computePeriodPnl({ portfolioId: pf.id, teamId: n }, '1M'))!.pnl;
    }
    kiem(cong === tong!.pnl, 'Σ lãi/lỗ trong kỳ các nhóm (kể cả chưa gắn nhóm) = toàn danh mục', `${cong} vs ${tong!.pnl}`);
  }

  console.log('\n3. "Toàn bộ" giữ số cộng dồn; lọc chiến lược bỏ thu khác');
  {
    kiem((await computePeriodPnl({ portfolioId: pf.id }, 'ALL')) === null, 'ALL → null (ô giữ số cộng dồn)');
    const cl = await prisma.strategy.findFirstOrThrow({ select: { id: true } });
    const p = await computePeriodPnl({ portfolioId: pf.id, strategyId: cl.id }, '1M');
    kiem(p !== null && p.boQuaThuKhac && p.thuKhac === 0n, 'lọc chiến lược: báo rõ là không gồm cổ tức/thu khác');
  }

  console.log('\n4. Dashboard thật');
  {
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
      select: { id: true },
    });
    await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });
    await createSession(admin.id);
    const mo = async (period: string) =>
      ketXuat(
        await (DashboardPage as unknown as (p: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>)({
          searchParams: Promise.resolve({ period }),
        }),
      );
    const w = await mo('1W');
    kiem(w.includes('Lãi/lỗ · ') && w.includes('cộng dồn'), '1 tuần: ô đổi thành "Lãi/lỗ · <kỳ>" và giữ số cộng dồn');
    const a = await mo('ALL');
    kiem(a.includes('Tổng lãi/lỗ') && a.includes('trên giá vốn') && !a.includes('cộng dồn'), 'Toàn bộ: như cũ');
  }

  console.log('\n5. Giá đầu kỳ cũ thì báo (bản sao: xoá lịch sử giá sau 10/09)');
  {
    const p0 = await computePeriodPnl({ portfolioId: pf.id }, '1W');
    console.log(`        trước khi xoá: giaDauCu = ${JSON.stringify(p0?.giaDauCu?.ngayCuNhat ?? null)}`);
    await prisma.priceHistory.deleteMany({ where: { tradingDate: { gt: new Date('2026-09-10T00:00:00.000Z') } } });
    const p = await computePeriodPnl({ portfolioId: pf.id }, '1W');
    kiem(
      p !== null && p.giaDauCu !== null && p.giaDauCu.ngayCuNhat <= '2026-09-10' && p.giaDauCu.ma.length > 0,
      `báo giá đầu kỳ cũ: ${p?.giaDauCu?.ma.length ?? 0} mã, cũ nhất ${p?.giaDauCu?.ngayCuNhat ?? '—'}`,
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
