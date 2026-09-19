/**
 * KIỂM THỬ VỐN THEO CHIẾN LƯỢC — "Phương pháp đang dùng" / trang Chiến lược (§16).
 *
 * PHÉP CŨ SAI THẾ NÀO. Nó làm "Σ allocationAmount lệnh mua − Σ allocationAmount lệnh
 * bán". Nhưng `allocationAmount` của lệnh mua là GIÁ VỐN chi ra, còn của lệnh bán là
 * TIỀN THU VỀ. Hiệu của hai đại lượng khác nhau ấy là lãi/lỗ đã thực hiện, không phải
 * vốn còn lại — nên một chiến lược đã bán hết vẫn hiện 18,41% / ₫23,947M.
 *
 * PHÉP MỚI đi từ khối lượng còn lại, rồi phân bổ giá vốn vị thế theo tỷ trọng đó.
 *
 * Bốn điều cần đúng:
 *
 *   1. BẤT BIẾN: Σ vốn theo chiến lược = Σ giá vốn mọi vị thế đang mở. Đúng ở MỌI phạm
 *      vi (toàn danh mục, từng người). Đây là phép kiểm mạnh nhất — nó ràng con số vào
 *      một đại lượng tính bằng đường hoàn toàn khác.
 *   2. Chiến lược đã bán hết KHÔNG còn trong danh sách.
 *   3. Phép cũ cho kết quả KHÁC — nếu không, bài kiểm này không chứng minh được gì.
 *   4. Trang thật kết xuất ra đúng những con số đó.
 *
 * Chạy trên BẢN SAO database. Dùng: npm run test:strategy-capital
 */

import { renderToPipeableStream } from 'react-dom/server';
import type { ReactElement } from 'react';

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import {
  computePositions,
  computeStrategyAllocation,
  computeStrategyBreakdown,
  computeStrategyHoldings,
  type EngineFilter,
} from '@/domain/portfolio-engine';
import { formatVnd } from '@/lib/money';
import { TRANSACTION_TYPE, countsInPosition, type TradeStatus } from '@/lib/enums';
import MemberPage from '../app/(app)/members/[id]/page';

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

function tr(v: bigint): string {
  return `${(Number(v) / 1_000_000).toFixed(3)}M`;
}

/**
 * Kết xuất một trang ra HTML.
 *
 * DÙNG API STREAM, KHÔNG DÙNG `renderToStaticMarkup`. Bản đồng bộ ném
 * "A component suspended while responding to synchronous input" ngay khi trang chứa
 * một Server Component async lồng bên trong — trang member có đúng như vậy. Lỗi đó là
 * của công cụ đo, không phải của trang: trang chạy bình thường trên server thật.
 *
 * GOM BUFFER RỒI GIẢI MÃ MỘT LẦN. Stream ghi ra `Uint8Array`; `String(chunk)` biến nó
 * thành danh sách số byte ("60,104,101,97,..."), và mọi phép `includes` sau đó đều báo
 * false cho một trang hoàn toàn đúng. Giải mã từng chunk cũng không được: một ký tự
 * tiếng Việt nhiều byte có thể bị cắt qua hai chunk.
 */
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
          on() {},
          once() {},
          emit() {},
          removeListener() {},
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

/** PHÉP CŨ, giữ lại nguyên vẹn để chứng minh bài kiểm phân biệt được hai phép. */
async function phepCu(filter: EngineFilter): Promise<Map<string, bigint>> {
  const rows = await prisma.tradeStrategy.findMany({
    where: {
      trade: {
        portfolioId: filter.portfolioId,
        ...(filter.userId ? { userId: filter.userId } : {}),
      },
    },
    select: {
      allocationAmount: true,
      trade: { select: { transactionType: true, status: true } },
      strategy: { select: { nameVi: true } },
    },
  });

  const ra = new Map<string, bigint>();
  for (const r of rows) {
    if (!countsInPosition(r.trade.status as TradeStatus)) continue;
    const dau = r.trade.transactionType === TRANSACTION_TYPE.BUY ? 1n : -1n;
    ra.set(r.strategy.nameVi, (ra.get(r.strategy.nameVi) ?? 0n) + r.allocationAmount * dau);
  }
  return ra;
}

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  const nguoi = await prisma.user.findMany({
    where: { tradesExecuted: { some: { portfolioId: portfolio.id } } },
    select: { id: true, fullName: true },
  });

  // =========================================================================
  // 1. BẤT BIẾN: Σ vốn theo chiến lược = Σ giá vốn vị thế đang mở
  // =========================================================================
  console.log('1. Bất biến tổng — mọi phạm vi');

  const phamVi: { ten: string; filter: EngineFilter }[] = [
    { ten: 'toàn danh mục', filter: { portfolioId: portfolio.id } },
    ...nguoi.map((n) => ({ ten: n.fullName, filter: { portfolioId: portfolio.id, userId: n.id } })),
  ];

  for (const pv of phamVi) {
    const [phanBo, viThe] = await Promise.all([
      computeStrategyAllocation(pv.filter),
      computePositions(pv.filter),
    ]);

    const tongCL = phanBo.reduce((s, x) => s + x.netCapital, 0n);
    const tongViThe = viThe.filter((p) => p.quantity > 0).reduce((s, p) => s + p.totalCost, 0n);

    kiem(
      tongCL === tongViThe,
      `${pv.ten}: Σ chiến lược = Σ giá vốn vị thế (${formatVnd(tongViThe)})`,
      `chiến lược ${tr(tongCL)} vs vị thế ${tr(tongViThe)} — lệch ${tr(tongCL - tongViThe)}`,
    );
  }

  // =========================================================================
  // 2. Chiến lược đã bán hết không còn trong danh sách
  // =========================================================================
  console.log('\n2. Chiến lược đã thoát sạch phải rời danh sách');

  let daKiem = 0;

  for (const n of nguoi) {
    const filter: EngineFilter = { portfolioId: portfolio.id, userId: n.id };
    const phanBo = await computeStrategyAllocation(filter);
    const kho = await computeStrategyHoldings(portfolio.id, n.id);

    // Khối lượng còn lại theo chiến lược, cộng qua mọi mã.
    const klConLai = new Map<string, number>();
    for (const h of kho) {
      for (const x of h.byStrategy) {
        klConLai.set(x.strategyNameVi, (klConLai.get(x.strategyNameVi) ?? 0) + x.quantity);
      }
    }

    /*
     * Chiến lược người này TỪNG dùng nhưng nay không còn cổ phiếu nào. Đây mới là ca
     * cần kiểm: nếu không ai có ca này thì phép kiểm luôn xanh mà không chứng minh gì,
     * nên có đếm `daKiem` ở dưới.
     */
    const tungDung = await prisma.tradeStrategy.findMany({
      where: { trade: { userId: n.id, portfolioId: portfolio.id } },
      select: { strategy: { select: { nameVi: true } } },
      distinct: ['strategyId'],
    });

    for (const t of tungDung) {
      const ten = t.strategy.nameVi;
      const con = klConLai.get(ten) ?? 0;
      if (con > 0) continue;

      daKiem++;
      const hien = phanBo.find((x) => x.nameVi === ten);
      kiem(
        hien === undefined,
        `${n.fullName}: "${ten}" còn ${con} CP nên không được hiện`,
        hien ? `vẫn hiện ${tr(hien.netCapital)}` : '',
      );
    }
  }

  if (daKiem === 0) {
    console.log('  BOQUA: khong ai co chien luoc da thoat sach — phep kiem nay khong chay');
  } else {
    console.log(`  ${daKiem} ca thật`);
  }

  // =========================================================================
  // 3. Phép cũ cho kết quả KHÁC — bài kiểm phải phân biệt được
  // =========================================================================
  console.log('\n3. Phép cũ khác phép mới — chứng minh bài kiểm có tác dụng');

  let soLech = 0;

  for (const pv of phamVi) {
    const moi = await computeStrategyAllocation(pv.filter);
    const cu = await phepCu(pv.filter);

    const tenCL = new Set([...moi.map((x) => x.nameVi), ...cu.keys()]);
    const lech: string[] = [];

    for (const ten of tenCL) {
      const vMoi = moi.find((x) => x.nameVi === ten)?.netCapital ?? 0n;
      const vCu = cu.get(ten) ?? 0n;
      if (vMoi !== vCu) lech.push(`${ten}: cũ ${tr(vCu)} → mới ${tr(vMoi)}`);
    }

    if (lech.length > 0) {
      soLech++;
      console.log(`  ${pv.ten}: ${lech.length} chiến lược lệch`);
      for (const l of lech) console.log(`      ${l}`);
    }
  }

  /*
   * KHÔNG PHÂN BIỆT ĐƯỢC ≠ SAI.
   *
   * Phép này tồn tại để chứng minh bài kiểm có răng: nếu công thức cũ và mới cho ra
   * cùng kết quả thì mọi phép ở trên chẳng chứng minh điều gì. Nhưng khi danh mục
   * chưa có lệnh nào, HAI công thức đều ra 0 — và đó là sự thật về dữ liệu, không
   * phải lỗi của sản phẩm.
   *
   * Báo TRUOT ở đây thì bộ kiểm đỏ vĩnh viễn cho tới khi có dữ liệu thật, và người
   * đọc sẽ quen với việc "có mấy dòng đỏ nhưng không sao" — đúng thói quen làm người
   * ta bỏ qua một dòng đỏ thật.
   */
  if (soLech === 0) {
    const coLenh = await prisma.trade.count({ where: { portfolioId: portfolio.id } });
    if (coLenh === 0) {
      console.log('  BOQUA: danh mục chưa có lệnh nào — hai công thức đều ra 0, không phân biệt được');
    } else {
      kiem(false, 'hai phép cho kết quả khác nhau trên dữ liệu thật', 'không phạm vi nào lệch');
    }
  } else {
    kiem(true, 'hai phép cho kết quả khác nhau trên dữ liệu thật');
  }

  // =========================================================================
  // 4. Trang thật kết xuất ra đúng con số đó
  // =========================================================================
  console.log('\n4. Trang /members/[id] kết xuất đúng');

  type PageFn = (p: { params: Promise<{ id: string }> }) => Promise<ReactElement>;

  for (const n of nguoi) {
    const filter: EngineFilter = { portfolioId: portfolio.id, userId: n.id };
    const phanBo = await computeStrategyAllocation(filter);

    let html = '';
    try {
      await createSession(n.id);
      html = await ketXuat(
        await (MemberPage as unknown as PageFn)({ params: Promise.resolve({ id: n.id }) }),
      );
    } catch (e) {
      const s = String(e);

      /*
       * BA TRẠNG THÁI KHÔNG PHẢI LỖI — người này không xem được trang member của
       * chính mình, và mỗi lý do là một chốt đúng thiết kế:
       *
       *   mustChangePassword  → /change-password trước khi làm gì khác
       *   thiếu user.view     → 403; trader không có quyền xem trang thành viên
       *   bị treo tài khoản   → /pending?suspended=1
       *
       * Bản đầu của bài kiểm báo trượt cả ba, tức là báo lỗi cho ba chốt bảo mật đang
       * hoạt động đúng.
       */
      if (s.includes('/change-password')) {
        console.log(`  BOQUA ${n.fullName}: phải đổi mật khẩu trước`);
        continue;
      }
      if (s.includes('FORBIDDEN')) {
        console.log(`  BOQUA ${n.fullName}: thiếu quyền user.view — không xem được trang này`);
        continue;
      }
      if (s.includes('/pending')) {
        console.log(`  BOQUA ${n.fullName}: tài khoản đang bị treo`);
        continue;
      }

      kiem(false, `${n.fullName}: trang kết xuất được`, s.slice(0, 160));
      continue;
    }

    const i = html.indexOf('Phương pháp đang dùng');
    kiem(i >= 0, `${n.fullName}: thẻ có mặt`);
    if (i < 0) continue;

    /*
     * Cắt theo BIÊN THẺ THẬT — thẻ kế tiếp là "Vị thế đang giữ". Cắt cứng theo số ký
     * tự thì lát cắt tràn sang thẻ sau và bắt được tên chiến lược của bảng giao dịch
     * bên dưới, báo trượt cho một thẻ hoàn toàn đúng.
     */
    const j = html.indexOf('Vị thế đang giữ', i);
    const the = html.slice(i, j > i ? j : html.length);

    for (const r of phanBo) {
      kiem(the.includes(r.nameVi), `${n.fullName}: thẻ nêu "${r.nameVi}"`);
    }

    // Chiến lược đã thoát sạch không được xuất hiện trong thẻ.
    const kho = await computeStrategyHoldings(portfolio.id, n.id);
    const conCP = new Set<string>();
    for (const h of kho) for (const x of h.byStrategy) if (x.quantity > 0) conCP.add(x.strategyNameVi);

    const tungDung = await prisma.tradeStrategy.findMany({
      where: { trade: { userId: n.id, portfolioId: portfolio.id } },
      select: { strategy: { select: { nameVi: true } } },
      distinct: ['strategyId'],
    });

    for (const t of tungDung) {
      if (conCP.has(t.strategy.nameVi)) continue;
      kiem(
        !the.includes(t.strategy.nameVi),
        `${n.fullName}: thẻ KHÔNG nêu "${t.strategy.nameVi}" (đã bán hết)`,
      );
    }

    console.log(
      `        ${phanBo.map((r) => `${r.nameVi} ${tr(r.netCapital)}`).join(' · ') || '(trống)'}`,
    );
  }

  // =========================================================================
  // 5. Thẻ và danh sách mã trên trang Chiến lược phải khớp nhau
  // =========================================================================
  console.log('\n5. Trang Chiến lược: tổng thẻ = Σ danh sách mã');

  /*
   * Trang Chiến lược hiện HAI con số cạnh nhau: tổng vốn của chiến lược, và danh sách
   * từng mã kèm số tiền. Trước đây tổng lấy từ engine còn danh sách trang tự tính
   * bằng phép cũ, nên hai con số trên cùng một thẻ không cộng lại được với nhau.
   */
  for (const pv of phamVi) {
    const [phanBo, chiTiet] = await Promise.all([
      computeStrategyAllocation(pv.filter),
      computeStrategyBreakdown(pv.filter),
    ]);

    for (const cl of phanBo) {
      const b = chiTiet.get(cl.strategyId);
      const tongMa = b?.symbols.reduce((t, x) => t + x.netCapital, 0n) ?? 0n;

      kiem(
        tongMa === cl.netCapital,
        `${pv.ten} · ${cl.nameVi}: Σ ${b?.symbols.length ?? 0} mã = tổng thẻ (${tr(cl.netCapital)})`,
        `Σ mã ${tr(tongMa)} vs thẻ ${tr(cl.netCapital)}`,
      );

      kiem(
        b?.total === cl.netCapital,
        `${pv.ten} · ${cl.nameVi}: trường total khớp`,
        `${tr(b?.total ?? 0n)} vs ${tr(cl.netCapital)}`,
      );

      // Mã đã bán hết không được nằm trong danh sách.
      const rong = b?.symbols.filter((x) => x.quantity <= 0) ?? [];
      kiem(
        rong.length === 0,
        `${pv.ten} · ${cl.nameVi}: không mã nào 0 CP trong danh sách`,
        rong.map((x) => x.symbol).join(
),
      );
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
