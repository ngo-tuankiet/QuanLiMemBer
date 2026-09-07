/**
 * KIỂM PHẠM VI QUYỀN CỦA BÁO CÁO — trưởng nhóm không được xuất dữ liệu nhóm khác.
 *
 * LỖ HỔNG ĐÃ CÓ: `ReportParams` không mang phạm vi nhóm, và API route chỉ hỏi "có quyền
 * `report.export` không" chứ không hỏi "được xuất PHẦN NÀO". Trưởng nhóm bị `applyScope`
 * ép về nhóm mình ở MỌI trang, nhưng bấm Tải về thì nhận vị thế, giao dịch và dòng vốn
 * của cả bốn nhóm. Đường vòng này còn tệ hơn lỗ hổng ở `/approvals` vì nó XUẤT RA TỆP —
 * dữ liệu rời khỏi hệ thống.
 *
 * Bài này DỰNG DỮ LIỆU HAI NHÓM rồi so ba phạm vi:
 *
 *   ADMIN (view_all)     → thấy cả hai nhóm
 *   TEAM_MANAGER nhóm A  → CHỈ thấy nhóm A
 *   phạm vi NONE         → không thấy gì (sentinel `__no_access__`)
 *
 * Điều kiện làm bài kiểm có nghĩa: hai nhóm phải có mã CHỨNG KHOÁN KHÁC NHAU, để "không
 * thấy nhóm B" kiểm được bằng sự vắng mặt của một mã cụ thể chứ không bằng một con số.
 *
 * Chạy trên BẢN SAO database. Dùng: npm run test:report-scope
 */

import { prisma } from '@/lib/prisma';
import { buildReport, type ReportParams } from '@/reports/build';
import { applyScope } from '@/domain/portfolio-engine';
import { dataScope } from '@/domain/permissions';
import { ROLE_PERMISSIONS } from '@/domain/permissions';
import { ROLE } from '@/lib/enums';

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

async function main(): Promise<void> {
  const pf = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  const admin = await prisma.user.findFirstOrThrow({
    where: { email: 'admin@vninvest.local' },
    select: { id: true },
  });

  const nhom = await prisma.team.findMany({ orderBy: { code: 'asc' }, select: { id: true, nameVi: true } });
  if (nhom.length < 2) {
    console.log('  BOQUA: can it nhat 2 nhom');
    return;
  }
  const [nhomA, nhomB] = [nhom[0]!, nhom[1]!];

  const ma = await prisma.stock.findMany({
    where: { symbol: { in: ['FPT', 'VNM'] } },
    orderBy: { symbol: 'asc' },
    select: { id: true, symbol: true },
  });
  if (ma.length < 2) {
    console.log('  BOQUA: khong tim thay du 2 ma');
    return;
  }
  const [maA, maB] = [ma[0]!, ma[1]!];

  /*
   * NỀN: mỗi nhóm một mã riêng, cộng một dòng vốn riêng. Ghi thẳng bằng `prisma` vì đây
   * là NỀN — thứ đang kiểm là báo cáo, không phải đường nhập lệnh.
   */
  const chienLuoc = await prisma.strategy.findFirstOrThrow({ select: { id: true } });

  const dungLenh = async (teamId: string, stockId: string, code: string) => {
    const lenh = await prisma.trade.create({
      data: {
        code,
        portfolioId: pf.id,
        stockId,
        teamId,
        transactionType: 'BUY',
        quantity: 1_000,
        price: 50_000n,
        fees: 0n,
        tax: 0n,
        executedAt: new Date(),
        status: 'EXECUTED',
        userId: admin.id,
        createdById: admin.id,
      },
    });

    /*
     * PHẢI CÓ DÒNG PHÂN BỔ CHIẾN LƯỢC.
     *
     * Bản đầu của bài kiểm bỏ qua bước này, nên báo cáo `trade-strategies` rỗng bất kể
     * phạm vi — và phép "KHÔNG lộ mã của nhóm khác" cho báo cáo đó ĐẠT MỘT CÁCH RỖNG
     * TUẾCH: không có gì để lộ thì không lộ gì cả.
     *
     * Phép kiểm kiểu đó xanh vĩnh viễn, kể cả khi lỗ hổng quay lại. Nó chỉ lộ ra vì
     * phép đi kèm — "vẫn thấy mã của nhóm mình" — trượt.
     */
    await prisma.tradeStrategy.create({
      data: {
        tradeId: lenh.id,
        strategyId: chienLuoc.id,
        allocationBps: 10_000,
        allocationAmount: 50_000_000n,
      },
    });

    await prisma.capitalFlow.create({
      data: {
        portfolioId: pf.id,
        teamId,
        flowType: 'CONTRIBUTION',
        amount: 100_000_000n,
        occurredAt: new Date(),
        status: 'CONFIRMED',
        createdById: admin.id,
        note: `Nền cho bài kiểm phạm vi — ${code}`,
      },
    });
  };

  await dungLenh(nhomA.id, maA.id, 'TXN-SCOPE-A');
  await dungLenh(nhomB.id, maB.id, 'TXN-SCOPE-B');

  console.log(`Nền: ${nhomA.nameVi} giữ ${maA.symbol} · ${nhomB.nameVi} giữ ${maB.symbol}\n`);

  /** Dựng một báo cáo rồi trả về toàn bộ nội dung dạng chuỗi để tìm mã. */
  const noiDung = async (code: string, teamId: string | null | undefined): Promise<string> => {
    const p: ReportParams = { portfolioId: pf.id, period: 'ALL', teamId } as ReportParams;
    const kq = await buildReport(code, p);
    return kq.rows.map((r) => r.map((c) => String(c ?? '')).join('|')).join('\n');
  };

  const BAO_CAO = ['positions', 'transactions', 'trade-strategies', 'sector-allocation', 'capital-flows'];

  // =========================================================================
  // 1. Không lọc (view_all) → thấy cả hai
  // =========================================================================
  console.log('1. Phạm vi ALL — thấy cả hai nhóm');
  for (const bc of ['positions', 'transactions']) {
    const s = await noiDung(bc, undefined);
    kiem(s.includes(maA.symbol) && s.includes(maB.symbol), `${bc}: có cả ${maA.symbol} và ${maB.symbol}`);
  }

  // =========================================================================
  // 2. Lọc theo nhóm A → CHỈ thấy nhóm A
  // =========================================================================
  console.log(`\n2. Phạm vi nhóm ${nhomA.nameVi} — KHÔNG được lộ ${maB.symbol}`);
  for (const bc of BAO_CAO) {
    const s = await noiDung(bc, nhomA.id);
    const coA = s.includes(maA.symbol);
    const coB = s.includes(maB.symbol);

    if (bc === 'capital-flows') {
      // Dòng vốn không nêu mã — kiểm bằng số dòng thay vì bằng ký hiệu mã.
      const soDong = s.split('\n').filter((x) => x.trim() !== '').length;
      kiem(soDong === 1, `${bc}: chỉ 1 dòng vốn của nhóm này`, `${soDong} dòng`);
      continue;
    }

    kiem(coA, `${bc}: vẫn thấy ${maA.symbol} của nhóm mình`);
    kiem(!coB, `${bc}: KHÔNG lộ ${maB.symbol} của nhóm khác`, s.slice(0, 100));
  }

  // =========================================================================
  // 3. Phạm vi NONE → không thấy gì
  // =========================================================================
  console.log('\n3. Phạm vi NONE — hỏng theo hướng an toàn');
  {
    const sentinel = applyScope({ portfolioId: pf.id }, 'NONE', null).teamId;
    kiem(sentinel === '__no_access__', `applyScope trả sentinel: ${sentinel}`);

    for (const bc of ['positions', 'transactions']) {
      const s = await noiDung(bc, sentinel);
      kiem(s.trim() === '', `${bc}: rỗng, không rò một dòng nào`, s.slice(0, 80));
    }
  }

  // =========================================================================
  // 4. Ma trận quyền — đúng vai trò nào bị siết
  // =========================================================================
  console.log('\n4. Vai trò nào bị siết');
  {
    const tm = ROLE_PERMISSIONS[ROLE.TEAM_MANAGER] as readonly string[];
    const sm = ROLE_PERMISSIONS[ROLE.SENIOR_MANAGER] as readonly string[];

    kiem(tm.includes('report.export'), 'TEAM_MANAGER có report.export');
    kiem(!tm.includes('portfolio.view_all'), 'TEAM_MANAGER KHÔNG có portfolio.view_all — nên phải bị siết');
    kiem(sm.includes('portfolio.view_all'), 'SENIOR_MANAGER có view_all — không bị siết');

    const quyenTM = new Set(tm);
    kiem(
      dataScope(quyenTM, 'portfolio') === 'SCOPED',
      "dataScope(TEAM_MANAGER, 'portfolio') = SCOPED",
      dataScope(quyenTM, 'portfolio'),
    );
  }

  // =========================================================================
  // 5. Chứng minh bài kiểm bắt được lỗi cũ
  // =========================================================================
  console.log('\n5. Chứng minh bài kiểm bắt được lỗi cũ');
  {
    /*
     * Lỗi cũ = KHÔNG truyền `teamId`. Dựng lại đúng trạng thái đó: nếu bỏ phạm vi thì
     * báo cáo của "trưởng nhóm A" vẫn chứa mã của nhóm B — và phép kiểm ở mục 2 sẽ trượt.
     */
    const cu = await noiDung('positions', undefined);
    kiem(
      cu.includes(maB.symbol),
      `bỏ phạm vi thì ${maB.symbol} của nhóm khác LỌT VÀO — mục 2 có răng thật`,
    );
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
