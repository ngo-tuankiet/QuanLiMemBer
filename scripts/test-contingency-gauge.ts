/**
 * KIỂM THỬ: THANH MỨC ĐỘ trên trang Kế hoạch dự phòng.
 *
 *   1. Logic thanh với dữ liệu dựng tay: chưa chạm / đã chạm Mức 2 / vượt Mức 3 / không lỗ.
 *   2. Trang thật (bản sao database, phiên admin) kết xuất được, mỗi chiến lược một thanh,
 *      và mã "gần chạm nhất" đúng là mã lỗ sâu nhất mà bộ kiểm cảnh báo cũng thấy.
 *
 * Dùng: npm run test:contingency-gauge
 */

import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
import { writeFileSync } from 'node:fs';
import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { ROLE, USER_STATUS } from '@/lib/enums';
import { computePositions } from '@/domain/portfolio-engine';
import { ContingencyGauge } from '@/components/ContingencyGauge';
import ContingencyPage from '../app/(app)/admin/contingency/page';

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

const chu = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

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
  console.log('1. Logic thanh');
  {
    const ve = (lo: number[], muc: (number | null)[] = [2000, 3000, 4000]) =>
      chu(
        renderToStaticMarkup(
          createElement(ContingencyGauge, {
            mucBps: muc,
            maLo: lo.map((b, i) => ({ symbol: `M${i}X`, loBps: b })),
            soMaDangGiu: Math.max(1, lo.length),
          }),
        ),
      );
    const a = ve([1240, 300]);
    kiem(a.includes('M0X') && a.includes('−12,4%') && a.includes('còn 7,6% tới Mức 1'), 'chưa chạm: còn 7,6% tới Mức 1', a);
    kiem(a.includes('2 mã đang lỗ'), 'đếm số mã đang lỗ');
    const b = ve([3200]);
    kiem(b.includes('đã chạm Mức 2') && b.includes('còn 8% tới Mức 3'), 'đã chạm Mức 2, còn 8% tới Mức 3', b);
    const c = ve([4500]);
    kiem(c.includes('đã chạm Mức 3') && !c.includes('còn'), 'vượt Mức 3', c);
    const d = ve([]);
    kiem(d.includes('Không mã nào đang lỗ'), 'không mã nào lỗ', d);
    const e = ve([900], [null, null, null]);
    kiem(e.includes('chưa đặt mức'), 'chưa đặt kế hoạch: vẫn hiện mã lỗ, ghi "chưa đặt mức"', e);
    const f = ve([1240], [2000, null, 4000]);
    kiem(f.includes('M1 20%') && f.includes('M3 40%') && !f.includes('M2'), 'mức bỏ trống không có vạch', f);
  }

  console.log('\n2. Trang thật (bản sao, admin)');
  {
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
      select: { id: true },
    });
    await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });
    await createSession(admin.id);
    const html = await ketXuat(await (ContingencyPage as unknown as () => Promise<ReactElement>)());
    const so = (html.match(/role="meter"/g) ?? []).length + (html.match(/Không mã nào đang lỗ|Chiến lược chưa giữ mã nào/g) ?? []).length;
    const soCL = await prisma.strategy.count();
    kiem(so === soCL, `mỗi chiến lược một thanh (${so}/${soCL})`);

    const pf = await prisma.portfolio.findFirstOrThrow({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } });
    const cls = await prisma.strategy.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, nameVi: true } });
    let sai = 0;
    for (const s of cls) {
      const vt = (await computePositions({ portfolioId: pf.id, strategyId: s.id })).filter(
        (p) => p.quantity > 0 && !p.missingPrice && p.totalCost > 0n && p.returnBps < 0,
      );
      const sau = vt.sort((x, y) => x.returnBps - y.returnBps)[0];
      if (sau) {
        const nhan = `${sau.symbol}</span> <span class="tabular font-medium text-down-500">−`;
        if (!html.includes(nhan)) sai++;
        console.log(`        ${s.nameVi}: ${sau.symbol} −${(-sau.returnBps / 100).toFixed(1)}%`);
      } else {
        console.log(`        ${s.nameVi}: không mã lỗ`);
      }
    }
    kiem(sai === 0, 'mã trên thanh = mã lỗ sâu nhất của chiến lược', `${sai} sai`);

    const ra = process.env.GAUGE_HTML_OUT;
    if (ra) writeFileSync(ra, html);
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
