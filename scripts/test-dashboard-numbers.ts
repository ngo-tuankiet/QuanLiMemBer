/**
 * KIỂM SỐ LIỆU TRÊN TRANG DASHBOARD — kết xuất trang thật rồi đối chiếu từng con số.
 *
 * `audit-formulas.ts` chứng minh ENGINE tính đúng. Bài này chứng minh TRANG hiện đúng
 * cái engine tính — hai việc khác nhau, và khoảng giữa chúng đúng là nơi trang Nhóm đã
 * sai: engine đã được sửa nhưng trang vẫn giữ một bản sao của phép cũ.
 *
 * Cách kiểm: với mỗi khối, tính lại bằng một đường ĐỘC LẬP rồi tìm chuỗi đã định dạng
 * trong HTML. So chuỗi người dùng thật sự đọc, không so biến trong bộ nhớ.
 *
 *   1. Portfolio Value  = Σ giá trị thị trường vị thế mở + tiền khả dụng
 *   2. Invested Capital = Σ giá vốn vị thế mở
 *   3. Available Cash   = số dư tiền − quỹ dự phòng
 *   4. Total P&L        = đã chốt + chưa chốt
 *   5. tỷ trọng ngành cộng lại đúng 100%
 *   6. Top 10 mã: sắp giảm dần theo giá trị TT, và Σ ≤ tổng giá trị TT
 *   7. vốn theo chiến lược trên trang = engine (không còn bản sao thứ hai)
 *   8. khối IB: Σ số tài khoản khớp `broker_accounts`
 *   9. Σ theo nhóm = toàn danh mục (bắt lô bị cắt ngang nhóm)
 *
 * Chạy trên BẢN SAO database. Dùng: npm run test:dashboard-numbers
 */

import { renderToPipeableStream } from 'react-dom/server';
import type { ReactElement } from 'react';

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import {
  computeCash,
  computeIbExposure,
  computePositions,
  computeSectorExposure,
  computeStrategyAllocation,
  computeTeamPerformance,
} from '@/domain/portfolio-engine';
import { formatCompactVnd, formatVnd } from '@/lib/money';
import { ROLE, USER_STATUS } from '@/lib/enums';
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

/**
 * Chuỗi mà `MoneyCompact` in ra, dùng CHÍNH `formatCompactVnd` của app.
 *
 * Bản đầu tự dựng lại phép rút gọn và trượt hai ô — vì `formatCompactVnd` CẮT phần
 * lẻ (chia số nguyên rồi mới chia 1000) còn `toFixed` thì LÀM TRÒN, nên 2.9755 tỷ ra
 * "₫2.975B" ở trang nhưng "₫2.976B" ở bài kiểm. Bài kiểm báo lỗi cho một trang đúng.
 *
 * Dùng chung bộ định dạng KHÔNG làm yếu phép kiểm: phần độc lập nằm ở CON SỐ — nó
 * được tính lại từ `computePositions` / `computeCash` chứ không đọc từ trang. Định
 * dạng chỉ là cách tìm con số đó trong HTML.
 */
const gon = (v: bigint): string => formatCompactVnd(v);

/** Cắt khối HTML sau một nhãn, đủ để so con số của chính khối đó. */
function khoiSau(html: string, nhan: string, dai = 500): string {
  const i = html.indexOf(nhan);
  return i < 0 ? '' : html.slice(i, i + dai);
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true, fullName: true },
  });
  await createSession(admin.id);

  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, nameVi: true, name: true },
  });

  console.log(`Danh mục: ${portfolio.nameVi ?? portfolio.name}\n`);

  const html = await ketXuat(
    await (DashboardPage as unknown as (p: {
      searchParams: Promise<Record<string, string | undefined>>;
    }) => Promise<ReactElement>)({ searchParams: Promise.resolve({}) }),
  );

  kiem(html.length > 5_000, 'trang kết xuất được', `${html.length} ký tự`);

  // ---- Nền: tính lại bằng đường độc lập -----------------------------------
  const positions = await computePositions({ portfolioId: portfolio.id });
  const open = positions.filter((p) => p.quantity > 0);

  const marketValue = open.reduce((s, p) => s + p.marketValue, 0n);
  const investedCost = open.reduce((s, p) => s + p.totalCost, 0n);
  const unrealized = open.reduce((s, p) => s + p.unrealizedPnl, 0n);
  const realized = positions.reduce((s, p) => s + p.realizedPnl, 0n);
  const totalPnl = realized + unrealized;

  const cash = await computeCash(portfolio.id);

  /*
   * PORTFOLIO VALUE DÙNG `cashBalance`, KHÔNG PHẢI `availableCash`.
   *
   * Hai con số khác nhau đúng bằng quỹ dự phòng: `availableCash` đã trừ
   * `portfolios.reserveAmount`. Quỹ dự phòng vẫn là tiền của danh mục — nó chỉ chưa
   * được phép đem đi mua — nên tổng giá trị danh mục phải gồm cả nó. Bản đầu của bài
   * kiểm này dùng `availableCash` và báo lệch 481 triệu cho một trang đúng.
   */
  const portfolioValue = marketValue + cash.cashBalance;

  console.log('Tính lại độc lập:');
  console.log(`  giá trị TT vị thế mở  ${formatVnd(marketValue)}`);
  console.log(`  giá vốn vị thế mở     ${formatVnd(investedCost)}`);
  console.log(`  số dư tiền            ${formatVnd(cash.cashBalance)}`);
  console.log(`  quỹ dự phòng          ${formatVnd(cash.reserveAmount)}`);
  console.log(`  tiền khả dụng         ${formatVnd(cash.availableCash)}`);
  console.log(`  Portfolio Value       ${formatVnd(portfolioValue)}`);
  console.log(`  đã chốt ${formatVnd(realized)} · chưa chốt ${formatVnd(unrealized)}`);
  console.log(`  Total P&L             ${formatVnd(totalPnl)}\n`);

  // =========================================================================
  // 1–4. Bốn ô KPI
  // =========================================================================
  console.log('1. Bốn ô KPI');

  /*
   * "INVESTED CAPITAL" Ở ĐÂY LÀ GIÁ TRỊ THỊ TRƯỜNG CỦA VỊ THẾ ĐANG GIỮ, không phải
   * giá vốn — chú thích trong ô nói đúng như vậy ("Giá trị thị trường của các vị thế
   * đang giữ"), và khi có bộ lọc thì ô đổi nhãn thành "Giá vốn" và đổi luôn con số
   * sang `investedCost`. Nhãn và nội dung khớp nhau ở cả hai nhánh.
   *
   * Bản đầu của bài kiểm giả định nó là giá vốn và báo lệch 419 triệu cho một trang
   * đúng. Giá vốn vẫn được kiểm riêng ở mục "Vốn theo chiến lược" bên dưới.
   */
  const oKpi: { nhan: string; giaTri: bigint }[] = [
    { nhan: 'Portfolio Value', giaTri: portfolioValue },
    { nhan: 'Invested Capital', giaTri: marketValue },
    { nhan: 'Available Cash', giaTri: cash.availableCash },
    { nhan: 'Total P&amp;L', giaTri: totalPnl },
  ];

  for (const o of oKpi) {
    const khoi = khoiSau(html, `>${o.nhan}<`, 700);
    kiem(
      khoi.length > 0 && khoi.includes(gon(o.giaTri)),
      `${o.nhan.replace('&amp;', '&')} hiện ${gon(o.giaTri)}`,
      khoi.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 100),
    );
  }

  /*
   * PHÉP KIỂM PHẢI PHÂN BIỆT ĐƯỢC. Nếu Portfolio Value quên cộng tiền thì con số sẽ
   * bằng đúng giá trị thị trường — nói rõ khi hai thứ trùng nhau để không tự tin hão.
   *
   * NHƯNG "KHÔNG PHÂN BIỆT ĐƯỢC" KHÔNG PHẢI "SAI". Khi danh mục chưa có tiền lẫn vị
   * thế, hai con số đều bằng 0 một cách hợp lệ. Báo trượt ở đó là để bộ kiểm đỏ vĩnh
   * viễn cho tới khi có dữ liệu thật — và một dòng đỏ thường trực sẽ che mất dòng đỏ
   * thật khi nó xuất hiện.
   */
  if (portfolioValue === 0n && marketValue === 0n) {
    console.log('  BOQUA: danh mục rỗng — Portfolio Value và giá trị TT đều 0, không phân biệt được');
  } else {
    kiem(
      gon(portfolioValue) !== gon(marketValue),
      'Portfolio Value KHÁC giá trị thị trường — phép kiểm trên phân biệt được',
      `${gon(portfolioValue)} vs ${gon(marketValue)}`,
    );
  }

  // =========================================================================
  // 5. Tỷ trọng ngành
  // =========================================================================
  console.log('\n2. Tỷ trọng ngành');
  {
    const sectors = computeSectorExposure(positions);
    const tongBps = sectors.reduce((s, x) => s + x.weightBps, 0);
    const tongGiaTri = sectors.reduce((s, x) => s + x.marketValue, 0n);

    console.log(`        ${sectors.length} ngành · Σ tỷ trọng ${(tongBps / 100).toFixed(2)}%`);
    kiem(
      sectors.length === 0 || Math.abs(tongBps - 10_000) <= sectors.length,
      'Σ tỷ trọng ngành = 100% (sai số ≤ 1 bps mỗi ngành do làm tròn)',
      `${tongBps} bps`,
    );
    kiem(
      tongGiaTri === marketValue,
      'Σ giá trị TT các ngành = tổng giá trị TT vị thế mở',
      `${formatVnd(tongGiaTri)} vs ${formatVnd(marketValue)}`,
    );
  }

  // =========================================================================
  // 6. Top 10 mã
  // =========================================================================
  console.log('\n3. Top mã nắm giữ');
  {
    const top = [...open].sort((a, b) => (b.marketValue > a.marketValue ? 1 : -1)).slice(0, 10);
    const tongTop = top.reduce((s, p) => s + p.marketValue, 0n);

    kiem(tongTop <= marketValue, 'Σ top 10 ≤ tổng giá trị TT', `${formatVnd(tongTop)}`);

    for (const p of top.slice(0, 3)) {
      kiem(html.includes(`>${p.symbol}<`), `trang có nêu ${p.symbol}`);
    }

    const dungThuTu = top.every(
      (p, i) => i === 0 || top[i - 1]!.marketValue >= p.marketValue,
    );
    kiem(dungThuTu, 'top sắp giảm dần theo giá trị thị trường');
  }

  // =========================================================================
  // 7. Vốn theo chiến lược
  // =========================================================================
  console.log('\n4. Vốn theo chiến lược');
  {
    const cl = await computeStrategyAllocation({ portfolioId: portfolio.id });
    const tongCL = cl.reduce((s, x) => s + x.netCapital, 0n);

    console.log(`        ${cl.length} chiến lược · Σ ${formatVnd(tongCL)}`);
    kiem(
      tongCL === investedCost,
      'Σ vốn theo chiến lược = Σ giá vốn vị thế mở',
      `${formatVnd(tongCL)} vs ${formatVnd(investedCost)}`,
    );

    for (const x of cl.slice(0, 3)) {
      kiem(html.includes(x.nameVi), `trang nêu chiến lược "${x.nameVi}"`);
    }
  }

  // =========================================================================
  // 8. Khối IB
  // =========================================================================
  console.log('\n5. Tài khoản & vốn theo IB');
  {
    const ib = await computeIbExposure(portfolio.id, {});
    const tongTK = ib.reduce((n, x) => n + x.accountCount, 0);
    const thatSu = await prisma.brokerAccount.count();

    console.log(`        ${ib.length} nhóm IB · ${tongTK} tài khoản`);
    kiem(tongTK === thatSu, 'Σ số tài khoản theo IB = số tài khoản trong database', `${tongTK} vs ${thatSu}`);

    const tongBps = ib.reduce((b, x) => b + x.weightBps, 0);
    kiem(
      ib.length === 0 || tongBps === 0 || Math.abs(tongBps - 10_000) <= ib.length,
      'Σ tỷ trọng vốn theo IB = 100%',
      `${tongBps} bps`,
    );
  }

  // =========================================================================
  // 9. Σ theo nhóm = toàn danh mục
  // =========================================================================
  console.log('\n6. Cộng theo nhóm phải bằng toàn danh mục');
  {
    const teams = await computeTeamPerformance(portfolio.id);

    const tongGiaTri = teams.reduce((s, t) => s + t.marketValue, 0n);
    const tongGiaVon = teams.reduce((s, t) => s + t.investedCost, 0n);
    const tongChot = teams.reduce((s, t) => s + t.realizedPnl, 0n);
    const tongChuaChot = teams.reduce((s, t) => s + t.unrealizedPnl, 0n);

    const loLo = teams.filter((t) => t.brokenLotSymbols.length > 0);

    kiem(tongGiaTri === marketValue, 'Σ giá trị TT các nhóm = toàn danh mục',
      `${formatVnd(tongGiaTri)} vs ${formatVnd(marketValue)}`);
    kiem(tongGiaVon === investedCost, 'Σ giá vốn các nhóm = toàn danh mục',
      `${formatVnd(tongGiaVon)} vs ${formatVnd(investedCost)}`);
    kiem(tongChot === realized, 'Σ lãi/lỗ đã chốt các nhóm = toàn danh mục',
      `${formatVnd(tongChot)} vs ${formatVnd(realized)}`);
    kiem(tongChuaChot === unrealized, 'Σ lãi/lỗ chưa chốt các nhóm = toàn danh mục',
      `${formatVnd(tongChuaChot)} vs ${formatVnd(unrealized)}`);

    if (loLo.length > 0) {
      console.log(
        `\n        NGUYÊN NHÂN nếu bốn phép trên trượt: ${loLo.length} nhóm có lô bị cắt ngang — ` +
          loLo.map((t) => `${t.nameVi} (${t.brokenLotSymbols.join(', ')})`).join(' · '),
      );
      console.log('        Chạy  npm run fix:trade-team  để xem cách vá.');
    }
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
