/**
 * KIỂM CHÉO: các trang tự tổng hợp tiền có khớp engine không?
 *
 * `audit-formulas.ts` chứng minh engine tự nhất quán. File này hỏi câu khác: những
 * chỗ KHÔNG dùng engine mà tự cộng lấy — trang Teams, Strategies, chi tiết cá nhân,
 * báo cáo — có ra cùng con số không.
 *
 * Đây là loại lỗi tệ nhất của hệ thống này: hai bản cài đặt của cùng một phép tính,
 * lệch nhau vài phần trăm, và không có gì trên màn hình báo rằng chúng lệch.
 *
 * Chạy: npx tsx scripts/audit-pages.ts
 */

import { PrismaClient } from '@prisma/client';
import {
  computeAccountBalances,
  computeCash,
  computeMemberPerformance,
  computePortfolioSummary,
  computePositions,
  computeStrategyAllocation,
  computeStrategyHoldings,
  computeTeamPerformance,
} from '@/domain/portfolio-engine';
import { COUNTED_TRADE_STATUS, TRANSACTION_TYPE } from '@/lib/enums';

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const fails: string[] = [];

function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    pass += 1;
    console.log(`  OK    ${label}${detail ? '  — ' + detail : ''}`);
  } else {
    fail += 1;
    fails.push(label + (detail ? ' — ' + detail : ''));
    console.log(`  SAI   ${label}${detail ? '  — ' + detail : ''}`);
  }
}
const eq = (a: bigint, b: bigint, l: string) =>
  check(a === b, l, a === b ? String(a) : `${a} vs ${b} (lệch ${a - b})`);

function header(t: string): void {
  console.log('\n' + '─'.repeat(88));
  console.log(' ' + t);
  console.log('─'.repeat(88));
}

async function main(): Promise<void> {
  const p = await prisma.portfolio.findFirstOrThrow({
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const pid = p.id;
  const summary = await computePortfolioSummary({ portfolioId: pid });
  const cash = await computeCash(pid);

  // =========================================================================
  header('1 — Trang Teams: gộp qua trade_strategies vs engine');
  // =========================================================================
  {
    /*
     * Trang Teams gộp `tradeStrategy` để có cả hai phép chia (theo người, theo nhóm)
     * trong một lượt. Nó cộng `allocationAmount` — một đường KHÁC hẳn engine, vốn
     * cộng `netAmount` của từng lệnh.
     */
    const rows = await prisma.tradeStrategy.findMany({
      where: { trade: { status: COUNTED_TRADE_STATUS, portfolioId: pid } },
      select: {
        allocationAmount: true,
        trade: { select: { transactionType: true, teamId: true } },
      },
    });

    const theoNhom = new Map<string, bigint>();
    for (const r of rows) {
      const k = r.trade.teamId ?? '';
      const dau = r.trade.transactionType === TRANSACTION_TYPE.BUY ? 1n : -1n;
      theoNhom.set(k, (theoNhom.get(k) ?? 0n) + dau * r.allocationAmount);
    }

    const teams = await computeTeamPerformance(pid);
    let lech = 0;
    for (const t of teams) {
      const qua = theoNhom.get(t.teamId) ?? 0n;
      if (qua !== t.netCapital) {
        lech += 1;
        console.log(`        ${t.nameVi}: trang ${qua} vs engine ${t.netCapital}`);
      }
    }
    check(
      lech === 0,
      'Vốn ròng theo nhóm: gộp allocationAmount = engine cộng netAmount',
      `${teams.length} nhóm`,
    );

    const tong = [...theoNhom.values()].reduce((a, b) => a + b, 0n);
    eq(tong, cash.spentOnBuys - cash.receivedFromSells, 'Tổng qua trade_strategies = chi − thu');
  }

  // =========================================================================
  header('2 — Vốn theo chiến lược: đối chiếu bằng đường độc lập');
  // =========================================================================
  /*
   * PHÉP KIỂM CŨ Ở ĐÂY ĐÃ SAI, VÀ SAI THEO KIỂU KHÓ THẤY NHẤT: nó dựng lại CÔNG THỨC
   * CŨ rồi bắt engine khớp với chính công thức đó.
   *
   * Công thức cũ là "Σ allocationAmount lệnh mua − Σ allocationAmount lệnh bán". Nhưng
   * `allocationAmount` của lệnh mua là GIÁ VỐN chi ra, còn của lệnh bán là TIỀN THU VỀ
   * — hiệu của hai đại lượng khác nhau là lãi/lỗ đã thực hiện, không phải vốn còn lại.
   * Một chiến lược đã bán hết lỗ vẫn hiện còn vốn (đo được: 18,41% cho một chiến lược
   * giữ 0 cổ phiếu).
   *
   * Sau khi `computeStrategyAllocation` được sửa sang "giá vốn phần còn giữ", phép kiểm
   * này bắt đầu báo đỏ cho một engine ĐÃ ĐÚNG. Một phép kiểm như vậy còn tệ hơn không
   * có: người đọc quen dần với "có mấy dòng đỏ nhưng không sao", rồi bỏ qua luôn dòng
   * đỏ thật.
   *
   * BA PHÉP THAY THẾ, mỗi phép đi một đường khác với `computeStrategyAllocation`:
   *
   *   a) Σ vốn theo chiến lược = Σ giá vốn vị thế đang mở — ràng vào `computePositions`
   *   b) chiến lược nào còn vốn thì phải còn cổ phiếu — ràng vào `computeStrategyHoldings`
   *   c) và ngược lại: còn cổ phiếu thì phải còn vốn
   *
   * ĐO ĐƯỢC PHÉP NÀO THẬT SỰ BẮT ĐƯỢC LỖI CŨ, thay vì đoán:
   *
   *   (a) BẮT ĐƯỢC — công thức cũ cho 8.240.610.981 ₫ trong khi giá vốn vị thế mở là
   *       8.234.754.281 ₫; lệch đúng bằng lãi/lỗ đã chốt.
   *   (b) ở mức DANH MỤC thì KHÔNG bắt được: gộp cả danh mục lại thì chiến lược nào
   *       cũng còn cổ phiếu, nên điều kiện không bao giờ vi phạm. Một phép kiểm không
   *       thể trượt là một phép kiểm vô nghĩa.
   *
   * Vì vậy (b) chạy ở mức TỪNG NGƯỜI — đúng phạm vi lỗi cũ hiện ra: "Định giá rẻ" của
   * System Administrator từng báo còn 23.947.250 ₫ vốn trong khi giữ 0 cổ phiếu. Ở phạm
   * vi đó phép kiểm có răng.
   */
  {
    const viThe = await computePositions({ portfolioId: pid });
    const giaVonMo = viThe
      .filter((x) => x.quantity > 0)
      .reduce((t, x) => t + x.totalCost, 0n);
    const tongCL = summary.strategyAllocation.reduce((t, x) => t + x.netCapital, 0n);

    eq(tongCL, giaVonMo, 'Σ vốn theo chiến lược = Σ giá vốn vị thế đang mở');

    /*
     * Khối lượng còn lại theo chiến lược, dựng qua `computeStrategyHoldings` — hàm này
     * đi từ `trade_strategies` + `allocateAmount` theo TỪNG NGƯỜI, không dùng lại
     * `computeStrategyAllocation`. Hai đường khác nhau nên chúng kiểm được nhau.
     */
    const nguoi = await prisma.user.findMany({
      where: { tradesExecuted: { some: { portfolioId: pid } } },
      select: { id: true, fullName: true },
    });

    const klTheoCL = new Map<string, number>();
    for (const u of nguoi) {
      for (const h of await computeStrategyHoldings(pid, u.id)) {
        for (const x of h.byStrategy) {
          klTheoCL.set(x.strategyId, (klTheoCL.get(x.strategyId) ?? 0) + x.quantity);
        }
      }
    }

    /*
     * (b) CHẠY THEO TỪNG NGƯỜI. Xem chú thích đầu khối: ở mức danh mục điều kiện này
     * không bao giờ vi phạm, nên chạy ở đó là tự ru ngủ.
     */
    let viPham = 0;
    let soCap = 0;

    for (const u of nguoi) {
      const vonNguoi = await computeStrategyAllocation({ portfolioId: pid, userId: u.id });

      const klNguoi = new Map<string, number>();
      for (const h of await computeStrategyHoldings(pid, u.id)) {
        for (const x of h.byStrategy) {
          klNguoi.set(x.strategyId, (klNguoi.get(x.strategyId) ?? 0) + x.quantity);
        }
      }

      for (const x of vonNguoi) {
        soCap += 1;
        if (x.netCapital !== 0n && (klNguoi.get(x.strategyId) ?? 0) <= 0) {
          viPham += 1;
          console.log(
            `        ${u.fullName} · ${x.nameVi}: còn vốn ${x.netCapital} nhưng giữ ` +
              `${klNguoi.get(x.strategyId) ?? 0} CP`,
          );
        }
      }
    }

    check(
      viPham === 0,
      'Chiến lược còn vốn thì phải còn cổ phiếu — đo theo TỪNG NGƯỜI',
      `${soCap} cặp (người × chiến lược)`,
    );

    const daHien = new Set(summary.strategyAllocation.map((x) => x.strategyId));
    const coCPKhongCoVon = [...klTheoCL.entries()].filter(
      ([id, kl]) => kl > 0 && !daHien.has(id),
    );
    check(
      coCPKhongCoVon.length === 0,
      'Chiến lược còn cổ phiếu thì phải còn vốn (chiều ngược lại)',
      `${klTheoCL.size} chiến lược có vị thế`,
    );
  }

  // =========================================================================
  header('3 — Trang chi tiết cá nhân: KPI tự tính vs engine');
  // =========================================================================
  {
    const users = await prisma.user.findMany({ select: { id: true, fullName: true } });
    const members = await computeMemberPerformance(pid);
    let lech = 0;

    for (const u of users) {
      // Đúng cách trang /members/[id] làm: computePositions với userId rồi tự cộng
      const pos = await computePositions({ portfolioId: pid, userId: u.id });
      const open = pos.filter((x) => x.quantity > 0);
      const mv = open.reduce((s, x) => s + x.marketValue, 0n);
      const cost = open.reduce((s, x) => s + x.totalCost, 0n);
      const unre = open.reduce((s, x) => s + x.unrealizedPnl, 0n);
      const real = pos.reduce((s, x) => s + x.realizedPnl, 0n);

      const m = members.find((x) => x.userId === u.id);
      if (!m) {
        // Người không có lệnh nào thì không nằm trong danh sách — vị thế phải rỗng
        if (open.length > 0 || real !== 0n) {
          lech += 1;
          console.log(`        ${u.fullName}: có vị thế nhưng vắng trong computeMemberPerformance`);
        }
        continue;
      }
      if (m.marketValue !== mv || m.investedCost !== cost || m.totalPnl !== real + unre) {
        lech += 1;
        console.log(
          `        ${u.fullName}: trang(${mv}/${cost}/${real + unre}) vs engine(${m.marketValue}/${m.investedCost}/${m.totalPnl})`,
        );
      }
    }
    check(lech === 0, 'KPI cá nhân: trang tự cộng = computeMemberPerformance', `${users.length} người`);
  }

  // =========================================================================
  header('4 — Báo cáo: dữ liệu xuất ra vs engine');
  // =========================================================================
  {
    const { buildReport } = await import('@/reports/build');

    const posRep = await buildReport('positions', { portfolioId: pid, period: 'YTD' });
    const iMv = posRep.headers.findIndex((h: string) => /market_value/.test(h));
    const iCost = posRep.headers.findIndex((h: string) => /^cost_vnd/.test(h));
    const tongMv = posRep.rows.reduce(
      (s: bigint, r: unknown[]) => s + BigInt(String(r[iMv] ?? '0')),
      0n,
    );
    const tongCost = posRep.rows.reduce(
      (s: bigint, r: unknown[]) => s + BigInt(String(r[iCost] ?? '0')),
      0n,
    );
    eq(tongMv, summary.investedValue, 'Báo cáo Positions: Σ giá trị TT = engine');
    eq(tongCost, summary.investedCost, 'Báo cáo Positions: Σ giá vốn = engine');

    const cfRep = await buildReport('capital-flows', { portfolioId: pid, period: 'YTD' });
    check(cfRep.rows.length > 0, `Báo cáo Capital Flows dựng được (${cfRep.rows.length} dòng)`);
  }

  // =========================================================================
  header('5 — verify-model.ts: có còn dùng công thức Alpha cũ không?');
  // =========================================================================
  {
    const fs = await import('node:fs');
    const src = fs.readFileSync('scripts/verify-model.ts', 'utf8');
    const dungChuoi = /computePerformanceSeries|portfolioIndex/.test(src);
    check(
      dungChuoi,
      'verify-model dùng chuỗi theo phiên (cùng công thức với engine)',
      dungChuoi ? '' : 'ĐANG dùng công thức cũ: lãi/lỗ toàn thời gian trừ chỉ số theo khoảng',
    );
  }

  // =========================================================================
  header('6 — Tính hợp lý của dữ liệu hiện có');
  // =========================================================================
  {
    // Vị thế âm là không thể — bán nhiều hơn mua
    const pos = await computePositions({ portfolioId: pid });
    const am = pos.filter((x) => x.quantity < 0);
    check(am.length === 0, 'Không mã nào có khối lượng âm', am.map((x) => x.symbol).join(', '));

    // Giá vốn âm là không thể
    const costAm = pos.filter((x) => x.totalCost < 0n);
    check(costAm.length === 0, 'Không mã nào có giá vốn âm');

    // Số dư tiền âm nghĩa là chi nhiều hơn vốn nạp
    check(
      cash.cashBalance >= 0n,
      'Số dư tiền không âm',
      (Number(cash.cashBalance) / 1e6).toFixed(3) + ' tr',
    );

    // Available âm nghĩa là đã tiêu vào quỹ dự phòng
    check(
      cash.availableCash >= 0n,
      'Tiền khả dụng không âm (chưa tiêu vào quỹ dự phòng)',
      (Number(cash.availableCash) / 1e6).toFixed(3) + ' tr',
    );

    // Mã thiếu giá làm mọi con số phía sau kém tin cậy
    const thieu = pos.filter((x) => x.quantity > 0 && x.missingPrice);
    check(thieu.length === 0, 'Mọi mã đang giữ đều có giá', thieu.map((x) => x.symbol).join(', '));

    // Giá cũ
    const cu = pos.filter((x) => x.quantity > 0 && x.isStale);
    check(cu.length === 0, 'Không mã nào dùng giá đã cũ', cu.map((x) => x.symbol).join(', '));

    // Lệnh chưa gắn tài khoản — tiền của chúng không thuộc tài khoản nào
    const chuaGan = await prisma.trade.count({
      where: { portfolioId: pid, status: COUNTED_TRADE_STATUS, brokerAccountId: null },
    });
    check(
      chuaGan === 0,
      'Mọi lệnh đều gắn tài khoản chứng khoán',
      chuaGan > 0 ? `${chuaGan} lệnh chưa gắn — số dư tài khoản không cộng lại bằng danh mục` : '',
    );

    // Dòng vốn chưa gắn nhóm — tiền của nhóm sẽ thiếu
    const flowChuaNhom = await prisma.capitalFlow.count({
      where: { portfolioId: pid, status: 'CONFIRMED', teamId: null },
    });
    check(
      flowChuaNhom === 0,
      'Mọi dòng vốn đều gắn nhóm',
      flowChuaNhom > 0 ? `${flowChuaNhom} dòng ở quỹ chung — nhóm chưa được cấp vốn riêng` : '',
    );

    // portfolio_snapshots trống → hiệu suất dựa vào chuỗi dựng lại
    const snap = await prisma.portfolioSnapshot.count({ where: { portfolioId: pid } });
    check(
      snap >= 2,
      'Có ảnh chụp cuối ngày (time-weighted return đúng chuẩn)',
      snap < 2 ? `${snap} dòng — đang dùng chuỗi dựng lại từ price_history` : '',
    );
  }

  // =========================================================================
  header('7 — Luồng duyệt lệnh: quyền, bốn mắt, phạm vi');
  // =========================================================================
  {
    const roles = await prisma.role.findMany({
      select: {
        code: true,
        rolePermissions: { select: { permission: { select: { code: true } } } },
      },
    });
    const co = (r: (typeof roles)[number], code: string) =>
      r.rolePermissions.some((x) => x.permission.code === code);

    // Ai thấy hàng chờ thì phải quyết được, và ngược lại — lệch là bẫy
    const lech = roles.filter(
      (r) => co(r, 'approval.view') !== co(r, 'transaction.approve'),
    );
    check(
      lech.length === 0,
      'Vai trò thấy hàng chờ duyệt cũng quyết định được (và ngược lại)',
      lech.map((r) => r.code).join(', '),
    );

    /*
     * QUYỀN BẪY: khai trong danh mục, CẤP cho một vai trò, mà không nơi nào kiểm.
     *
     * Phân biệt hai loại, vì chúng khác hẳn nhau về hậu quả:
     *
     *   BẪY      cấp cho vai trò ngoài ADMIN → người quản trị tin rằng người kia làm
     *            được việc đó, rồi không hiểu vì sao nút không hiện. Đúng chuyện đã
     *            xảy ra với `approval.decide` và vai trò "Quản lý nhóm".
     *   DÀNH SẴN chỉ ADMIN có → tính năng chưa dựng. Vô hại, chỉ cần biết.
     *
     * Quét TOÀN BỘ `src/` và `app/`: bản đầu chỉ đọc vài file nên báo nhầm
     * `stock.view` là chết, trong khi nó được dùng ở `src/components/AppShell.tsx`.
     */
    const fs = await import('node:fs');
    const path = await import('node:path');
    const docHet = (thuMuc: string): string => {
      let out = '';
      for (const e of fs.readdirSync(thuMuc, { withFileTypes: true })) {
        const p2 = path.join(thuMuc, e.name);
        if (e.isDirectory()) out += docHet(p2);
        /*
          BỎ QUA CHÍNH FILE KHAI BÁO.

          `src/domain/permissions.ts` liệt kê mọi mã quyền trong danh sách của từng
          vai trò, nên quét cả nó thì mã nào cũng "được dùng" — kể cả
          `approval.decide`, đúng thứ mà phép kiểm này sinh ra để bắt. Bản đầu của
          chính phép kiểm này mắc lỗi đó và báo xanh một cách vô nghĩa.
        */
        else if (/\.(ts|tsx)$/.test(e.name) && !p2.replace(/\\/g, '/').endsWith('src/domain/permissions.ts'))
          out += fs.readFileSync(p2, 'utf8');
      }
      return out;
    };
    const tatCa = docHet('src') + docHet('app');

    const dbPerms = await prisma.permission.findMany({
      select: {
        code: true,
        rolePermissions: { select: { role: { select: { code: true } } } },
      },
    });

    const khongKiem = dbPerms.filter((x) => !tatCa.includes(x.code));
    const bay = khongKiem.filter((x) =>
      x.rolePermissions.some((r) => r.role.code !== 'ADMIN'),
    );
    const danhSan = khongKiem.filter(
      (x) => !x.rolePermissions.some((r) => r.role.code !== 'ADMIN'),
    );

    check(
      bay.length === 0,
      'Không quyền nào được CẤP cho vai trò mà lại không gác gì',
      bay.length
        ? bay.map((x) => x.code).join(', ')
        : `${dbPerms.length} quyền · ${danhSan.length} dành sẵn cho tính năng chưa dựng`,
    );

    if (danhSan.length > 0) {
      console.log(
        `        (dành sẵn, chỉ ADMIN có: ${danhSan.map((x) => x.code).join(', ')})`,
      );
    }

    // Vai trò SCOPED không được có view_all nào
    const scopedRoles = roles.filter(
      (r) => co(r, 'approval.view') && !co(r, 'transaction.view_all'),
    );
    for (const r of scopedRoles) {
      const viewAll = r.rolePermissions
        .map((x) => x.permission.code)
        .filter((c) => c.endsWith('.view_all'));
      check(
        viewAll.length === 0,
        `Vai trò ${r.code} có phạm vi hẹp thì không mang quyền view_all nào`,
        viewAll.join(', '),
      );
    }
  }

  // =========================================================================
  header('8 — Luồng tiền: rút quá số dư, và huỷ lệnh đã khớp');
  // =========================================================================
  {
    // Rút vốn quá số dư tài khoản → số dư âm
    const am: string[] = [];
    const users = await prisma.user.findMany({ select: { id: true } });
    for (const u of users) {
      for (const b of await computeAccountBalances(pid, u.id)) {
        if (b.available < 0n) am.push(`${b.broker} ${b.accountNo} (${b.available})`);
      }
    }
    check(
      am.length === 0,
      'Không tài khoản nào có số dư âm',
      am.length ? am.join(' · ') + ' — rút/mua vượt vốn đã cấp' : '',
    );

    // Lệnh đã huỷ vẫn nằm trong bảng nhưng KHÔNG được tính vào tiền/vị thế
    const huy = await prisma.trade.count({ where: { portfolioId: pid, status: 'CANCELLED' } });
    const huyDuocTinh = (COUNTED_TRADE_STATUS.in as readonly string[]).includes("CANCELLED");
    check(
      !huyDuocTinh,
      `${huy} lệnh đã huỷ — CANCELLED không nằm trong COUNTED_TRADE_STATUS`,
      huyDuocTinh ? 'lệnh huỷ đang được tính vào tiền và vị thế' : '',
    );

    // Lệnh bán nhiều hơn số đang giữ sẽ tạo vị thế âm — đã kiểm ở phần 6
    const banQua = (await computePositions({ portfolioId: pid })).filter((x) => x.quantity < 0);
    check(banQua.length === 0, 'Không có lệnh bán vượt số đang giữ');
  }

  // =========================================================================
  header('9 — Luồng nhập lệnh: bắt buộc tài khoản, và tài khoản phải của mình');
  // =========================================================================
  {
    const lenhCoTK = await prisma.trade.findMany({
      where: { portfolioId: pid, brokerAccountId: { not: null } },
      select: { code: true, userId: true, brokerAccount: { select: { userId: true } } },
    });
    const saiChu = lenhCoTK.filter((t) => t.brokerAccount!.userId !== t.userId);
    check(
      saiChu.length === 0,
      'Mọi lệnh có tài khoản đều dùng tài khoản CỦA CHÍNH người thực hiện',
      saiChu.map((t) => t.code).join(', '),
    );

    const tkDong = await prisma.trade.count({
      where: {
        portfolioId: pid,
        brokerAccount: { isActive: false },
        status: COUNTED_TRADE_STATUS,
      },
    });
    check(tkDong === 0, 'Không lệnh nào ghi qua tài khoản đã đóng', tkDong ? `${tkDong} lệnh` : '');
  }

  // =========================================================================
  header('10 — Hai ngưỡng dữ liệu thị trường: làm mới phải xảy ra TRƯỚC báo động');
  // =========================================================================
  {
    /*
     * BẤT BIẾN: refresh_after_minutes < stale_after_minutes.
     *
     * Hai số này bằng nhau thì đúng lúc trước mỗi lần làm mới, chỉ báo trên thanh
     * đầu nhảy sang "Market Data trễ" — báo động nổ theo nhịp bình thường của hệ
     * thống, và mất khả năng phân biệt "đang chờ tới lượt" với "tiến trình lấy giá
     * đã chết". Báo động nổ thường xuyên là báo động bị bỏ qua.
     *
     * Kiểm ở đây thay vì tin vào việc ai đó nhớ: cả hai đều sửa được ở trang
     * Settings lúc đang chạy, nên không có gì chặn người ta đặt chúng bằng nhau.
     */
    const doc = async (key: string, mac: number) => {
      const r = await prisma.systemSetting.findUnique({ where: { key } });
      return { co: r !== null, giaTri: Number(r?.value ?? mac) };
    };
    const lamMoi = await doc('market_data.refresh_after_minutes', 120);
    const baoDong = await doc('market_data.stale_after_minutes', 150);

    check(lamMoi.co, 'Có cấu hình market_data.refresh_after_minutes');
    check(baoDong.co, 'Có cấu hình market_data.stale_after_minutes');

    const dungThuTu = lamMoi.giaTri < baoDong.giaTri;
    check(
      dungThuTu,
      'Làm mới xảy ra TRƯỚC khi báo trễ',
      `làm mới ${lamMoi.giaTri} phút · báo động ${baoDong.giaTri} phút` +
        (dungThuTu
          ? ` (biên ${baoDong.giaTri - lamMoi.giaTri} phút)`
          : ' — báo động sẽ nổ mỗi chu kỳ, không còn nghĩa'),
    );

    /*
     * Biên quá hẹp cũng vô dụng: một lượt gọi nguồn chậm vài phút là báo động nổ
     * oan. Lấy 10 phút làm mức tối thiểu — đủ cho một lượt bị chậm.
     */
    const bien = baoDong.giaTri - lamMoi.giaTri;
    check(bien >= 10, 'Biên giữa hai ngưỡng đủ rộng (từ 10 phút)', `${bien} phút`);
  }

  console.log('\n' + '='.repeat(88));
  console.log(` KẾT QUẢ: ${pass} đạt · ${fail} cần xem lại`);
  if (fail > 0) {
    console.log('\n Cần xem lại:');
    for (const f of fails) console.log('   • ' + f);
  }
  console.log('='.repeat(88));

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\nLỖI KHI CHẠY:', e);
  await prisma.$disconnect();
  process.exit(1);
});
