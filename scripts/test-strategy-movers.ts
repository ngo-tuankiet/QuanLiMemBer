/**
 * KIỂM THỬ HAI BIỂU ĐỒ "3 MÃ LÃI / LỖ NHIỀU NHẤT THEO CHIẾN LƯỢC" trên Dashboard.
 *
 * Canh bốn điều:
 *
 *   1. Gộp tên: IOPTIMA 01/02/03 → IOPTIMA; một chiến lược đứng một mình giữ tên.
 *   2. Con số của một chiến lược KHÔNG GỘP bằng đúng bảng Vị thế lọc theo chiến lược
 *      đó — cùng `computePositions`, nên lệch là có ai đó viết lại phép tính.
 *   3. Nhóm GỘP tính lại tỷ suất từ TỔNG tiền, không lấy trung bình các tỷ suất.
 *   4. Chỉ mã đang lãi ở biểu đồ lãi, chỉ mã đang lỗ ở biểu đồ lỗ, tối đa 3, đúng thứ tự.
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:strategy-movers
 */

import { prisma } from '@/lib/prisma';
import { computePositions } from '@/domain/portfolio-engine';
import { computeStrategyMovers, gocTen, nhomChienLuoc, SO_MA_MOI_PHIA } from '@/domain/strategy-movers';
import { ratioToBps } from '@/lib/money';
import { mauChienLuoc } from '@/components/charts';
import { PORTFOLIO_STATUS } from '@/lib/enums';

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
  console.log('\n1. Gộp tên chiến lược');
  {
    const g = nhomChienLuoc(['IOPTIMA 01', 'IOPTIMA 02', 'IOPTIMA 03', 'Tích sản', 'Top 10', 'Khác']);
    kiem(g.get('IOPTIMA 01')?.label === 'IOPTIMA', 'IOPTIMA 01 → IOPTIMA');
    kiem(g.get('IOPTIMA 03')?.key === g.get('IOPTIMA 02')?.key, 'IOPTIMA 02 và 03 cùng một nhóm');
    kiem(g.get('Tích sản')?.label === 'Tích sản', 'tên không có số giữ nguyên');
    /*
     * ĐỐI CHỨNG cho luật "≥ 2 cùng gốc": `gocTen` của "Top 10" đúng là "Top", nhưng
     * không có chiến lược "Top …" nào khác nên KHÔNG được gộp.
     */
    kiem(gocTen('Top 10') === 'Top', 'đối chứng: gốc tên của "Top 10" là "Top"');
    kiem(g.get('Top 10')?.label === 'Top 10', 'nhưng đứng một mình thì giữ nguyên "Top 10"');
  }

  const pf = await prisma.portfolio.findFirstOrThrow({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    select: { id: true },
  });
  const filter = { portfolioId: pf.id };
  const movers = await computeStrategyMovers(filter);
  const strategies = await prisma.strategy.findMany({ select: { id: true, nameVi: true } });

  console.log('\n2. Chiến lược không gộp = bảng Vị thế lọc theo chiến lược đó');
  {
    let soSanh = 0;
    const lech: string[] = [];
    for (const n of movers.filter((m) => m.members.length === 1)) {
      const s = strategies.find((x) => x.nameVi === n.members[0]);
      if (!s) continue;
      const vt = await computePositions({ ...filter, strategyId: s.id });
      for (const m of [...n.gainers, ...n.losers]) {
        const p = vt.find((x) => x.stockId === m.stockId);
        soSanh++;
        if (!p || p.returnBps !== m.returnBps || p.unrealizedPnl !== m.unrealizedPnl) {
          lech.push(`${n.label}/${m.symbol}: ${m.returnBps} vs ${p?.returnBps}`);
        }
      }
    }
    kiem(soSanh > 0, 'có cột để so — phép kiểm dưới không xanh rỗng', String(soSanh));
    kiem(lech.length === 0, 'mọi cột khớp tỷ suất và tiền lãi/lỗ của bảng Vị thế', lech.join(' | '));
  }

  console.log('\n3. Nhóm gộp tính tỷ suất từ TỔNG tiền');
  {
    const gop = movers.find((n) => n.members.length > 1);
    if (!gop) {
      console.log('        (dữ liệu không có nhóm gộp — bỏ qua)');
    } else {
      const ids = strategies.filter((s) => gop.members.includes(s.nameVi)).map((s) => s.id);
      const tungCL = await Promise.all(ids.map((id) => computePositions({ ...filter, strategyId: id })));
      const lech: string[] = [];
      for (const m of [...gop.gainers, ...gop.losers]) {
        const lat = tungCL.flatMap((ds) => ds.filter((p) => p.stockId === m.stockId && p.quantity > 0 && !p.missingPrice));
        const von = lat.reduce((s, p) => s + p.totalCost, 0n);
        const lai = lat.reduce((s, p) => s + p.unrealizedPnl, 0n);
        if (von !== m.totalCost || ratioToBps(lai, von) !== m.returnBps) {
          lech.push(`${m.symbol}: ${m.returnBps} vs ${ratioToBps(lai, von)}`);
        }
      }
      kiem(lech.length === 0, `${gop.label}: tỷ suất = Σ lãi/lỗ ÷ Σ giá vốn qua ${gop.members.length} chiến lược`, lech.join(' | '));
    }
  }

  console.log('\n4. Dấu, số lượng và thứ tự');
  {
    const sai: string[] = [];
    for (const n of movers) {
      if (n.gainers.length > SO_MA_MOI_PHIA || n.losers.length > SO_MA_MOI_PHIA) sai.push(`${n.label}: quá 3`);
      if (n.gainers.some((m) => m.returnBps <= 0)) sai.push(`${n.label}: có mã không lãi ở biểu đồ lãi`);
      if (n.losers.some((m) => m.returnBps >= 0)) sai.push(`${n.label}: có mã không lỗ ở biểu đồ lỗ`);
      for (let i = 1; i < n.gainers.length; i++) {
        if (n.gainers[i]!.returnBps > n.gainers[i - 1]!.returnBps) sai.push(`${n.label}: lãi sai thứ tự`);
      }
      for (let i = 1; i < n.losers.length; i++) {
        if (n.losers[i]!.returnBps < n.losers[i - 1]!.returnBps) sai.push(`${n.label}: lỗ sai thứ tự`);
      }
    }
    kiem(movers.length > 0, 'có nhóm để kiểm', String(movers.length));
    kiem(sai.length === 0, 'tối đa 3 mã, đúng dấu, lãi giảm dần, lỗ sâu nhất trước', sai.join(' | '));
  }

  console.log('\n5. Lọc một chiến lược thì chỉ còn nó, và vẫn mang nhãn của họ');
  {
    const io = strategies.find((s) => s.nameVi === 'IOPTIMA 01');
    if (!io) {
      console.log('        (không có IOPTIMA 01 — bỏ qua)');
    } else {
      const loc = await computeStrategyMovers({ ...filter, strategyId: io.id });
      kiem(loc.length <= 1, 'chỉ còn tối đa một nhóm', String(loc.length));
      kiem(loc.every((n) => n.label === 'IOPTIMA' && n.members.join() === 'IOPTIMA 01'), 'nhãn "IOPTIMA", chỉ gồm IOPTIMA 01', JSON.stringify(loc.map((n) => [n.label, n.members])));
    }
  }

  console.log('\n6. Màu theo cài đặt của chiến lược');
  {
    kiem(mauChienLuoc('#9333ea', 2) === '#9333ea', 'có màu cài → dùng đúng màu đó');
    kiem(mauChienLuoc(null, 2) === 'var(--series-3)', 'để trống → slot theo thứ tự');
    /*
     * Màu đi thẳng vào `style`. Một chuỗi lạ trong database không được thành CSS tuỳ ý.
     */
    kiem(mauChienLuoc('red;background:url(x)', 0) === 'var(--series-1)', 'chuỗi không phải #RRGGBB → bỏ, dùng slot');

    const cl = await prisma.strategy.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { nameVi: true, colorHex: true },
    });
    const lech: string[] = [];
    for (const n of movers) {
      const dau = cl.find((s) => n.members.includes(s.nameVi));
      if ((dau?.colorHex ?? null) !== n.colorHex) lech.push(`${n.label}: ${n.colorHex} vs ${dau?.colorHex}`);
    }
    kiem(lech.length === 0, 'mỗi nhóm mang màu cài của thành viên đứng đầu', lech.join(' | '));
    const io = movers.find((n) => n.label === 'IOPTIMA');
    if (io) {
      const io01 = cl.find((s) => s.nameVi === 'IOPTIMA 01');
      kiem(io.colorHex === (io01?.colorHex ?? null), 'nhóm IOPTIMA mang màu của IOPTIMA 01', `${io.colorHex}`);
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
