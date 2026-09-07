/**
 * KIỂM THỬ KHỐI "TÀI KHOẢN & VỐN THEO IB" — kết xuất TRANG DASHBOARD THẬT.
 *
 * Vì sao kết xuất cả trang thay vì chỉ gọi `computeIbExposure`: câu hỏi cần trả lời
 * là "ai NHÌN THẤY gì", và câu đó phụ thuộc cả engine, cả `dataScope`, cả `applyScope`,
 * cả nhánh trạng thái rỗng trong JSX. Gọi riêng engine chỉ kiểm được một mắt của
 * chuỗi đó — mà lỗ hổng phạm vi ở `/approvals` đầu phiên này nằm đúng ở mắt trang,
 * không nằm ở engine.
 *
 * Chạy trên BẢN SAO database (xem `run-test-copy.mjs`). Ba shim trong `scripts/_shim/`
 * thay cho request của Next.
 *
 * Dùng: npm run test:dashboard-ib
 */

import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { computeIbExposure } from '@/domain/portfolio-engine';
import { ROLE, USER_STATUS } from '@/lib/enums';
import Page from '../app/(app)/dashboard/page';

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

type PageFn = (p: {
  searchParams: Promise<Record<string, string | undefined>>;
}) => Promise<ReactElement>;

/** Kết xuất trang dashboard dưới danh nghĩa một người dùng, trả về HTML. */
async function xemTrang(
  userId: string,
  query: Record<string, string | undefined> = {},
): Promise<string> {
  await createSession(userId);
  const el = await (Page as unknown as PageFn)({ searchParams: Promise.resolve(query) });
  return renderToStaticMarkup(el);
}

/**
 * Bóc ĐÚNG thẻ IB ra khỏi HTML, cắt theo BIÊN THẺ THẬT.
 *
 * Bản đầu cắt cứng 3000 ký tự tính từ tiêu đề, và cả hai đầu đều sai: thẻ dài 4641
 * ký tự nên hai IB cuối rơi ra ngoài (báo "thiếu IB" cho một thẻ đủ), còn khi thẻ
 * ngắn — trường hợp thiếu quyền — thì lát cắt tràn sang thẻ kế tiếp và bắt được ký
 * hiệu ₫ của thẻ đó (báo "lộ số tiền" cho một thẻ không có số nào).
 *
 * Hai phép kiểm cùng trượt vì cùng một lỗi của công cụ đo, không phải của sản phẩm.
 * `Card` kết xuất đúng một chuỗi class ổn định nên dùng nó làm mốc là đo được thật.
 */
const MOC_THE = 'rounded-xl border border-ink-700 bg-ink-900';

function khoiIb(html: string): string {
  const iTieuDe = html.indexOf('Tài khoản &amp; vốn theo IB');
  if (iTieuDe < 0) return '';

  const dau = html.lastIndexOf(MOC_THE, iTieuDe);
  const sau = html.indexOf(MOC_THE, iTieuDe);

  return html.slice(dau < 0 ? iTieuDe : dau, sau < 0 ? html.length : sau);
}

/** Những tên IB xuất hiện trong khối. */
function tenIbHienRa(html: string): string[] {
  const khoi = khoiIb(html);
  const ten = ['Mỹ', 'Bùi Hải', 'Khang', 'a Hậu', 'TamCk', 'Không qua IB'];
  return ten.filter((t) => khoi.includes(t));
}

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({ select: { id: true } });

  const vaiTro = await prisma.role.findMany({ select: { id: true, code: true } });
  const idVaiTro = (code: string): string => {
    const r = vaiTro.find((x) => x.code === code);
    if (!r) throw new Error(`thieu vai tro ${code}`);
    return r.id;
  };

  const taoNguoi = (ten: string, roleCode: string, teamId: string | null) =>
    prisma.user.create({
      data: {
        email: `${ten}.ibtest@example.invalid`,
        passwordHash: 'x'.repeat(60),
        fullName: `Kiem thu ${ten}`,
        status: USER_STATUS.ACTIVE,
        roleId: idVaiTro(roleCode),
        teamId,
      },
    });

  // Nhóm nào đang có tài khoản chứng khoán — lấy từ dữ liệu, không gõ cứng tên nhóm.
  const nhomCoTk = await prisma.brokerAccount.findMany({
    select: { user: { select: { teamId: true, team: { select: { nameVi: true } } } } },
  });
  const teamIdCoTk = [...new Set(nhomCoTk.map((a) => a.user.teamId).filter((x): x is string => !!x))];
  if (teamIdCoTk.length === 0) throw new Error('khong nhom nao co tai khoan chung khoan');
  const teamA = teamIdCoTk[0]!;
  const tenTeamA = nhomCoTk.find((a) => a.user.teamId === teamA)?.user.team?.nameVi ?? '?';

  const teamKhac = await prisma.team.findFirstOrThrow({
    where: { id: { notIn: teamIdCoTk }, isActive: true },
    select: { id: true, nameVi: true },
  });

  const toanBo = await computeIbExposure(portfolio.id);
  const cuaTeamA = await computeIbExposure(portfolio.id, { onlyTeamId: teamA });
  console.log(
    `Nen: toan bo ${toanBo.length} IB / ${toanBo.reduce((n, x) => n + x.accountCount, 0)} tk; ` +
      `nhom "${tenTeamA}" ${cuaTeamA.length} IB / ${cuaTeamA.reduce((n, x) => n + x.accountCount, 0)} tk`,
  );

  console.log('\n1. ADMIN (capital.view_all) — thấy toàn bộ');
  {
    const admin = await prisma.user.findFirstOrThrow({
      where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
      select: { id: true },
    });
    const html = await xemTrang(admin.id);
    const khoi = khoiIb(html);

    kiem(khoi !== '', 'khối IB có mặt');
    kiem(
      khoi.includes(`${toanBo.reduce((n, x) => n + x.accountCount, 0)} tài khoản`),
      'phụ đề in đúng tổng số tài khoản',
    );
    kiem(tenIbHienRa(html).length === toanBo.length, 'hiện đủ mọi IB', tenIbHienRa(html).join(', '));
    kiem(!khoi.includes('không có quyền'), 'không hiện thông báo thiếu quyền');
    kiem(!html.includes('Phân bổ theo ngành'), 'thẻ "Phân bổ theo ngành" cũ đã bỏ hẳn');
  }

  console.log('\n2. QUẢN LÝ NHÓM có tài khoản (capital.view, SCOPED) — chỉ thấy nhóm mình');
  {
    const tm = await taoNguoi('quanlynhom', ROLE.TEAM_MANAGER, teamA);
    const html = await xemTrang(tm.id);
    const hien = tenIbHienRa(html);

    kiem(khoiIb(html) !== '', 'khối IB có mặt');
    kiem(hien.length === cuaTeamA.length, `chỉ hiện ${cuaTeamA.length} IB của nhóm mình`, hien.join(', '));
    for (const x of cuaTeamA) {
      const nhan = x.isDirect ? 'Không qua IB' : x.label;
      kiem(hien.includes(nhan), `có IB "${nhan}" của nhóm mình`);
    }
    const ngoai = toanBo.filter((x) => !cuaTeamA.some((y) => y.key === x.key));
    for (const x of ngoai) {
      const nhan = x.isDirect ? 'Không qua IB' : x.label;
      kiem(!hien.includes(nhan), `KHÔNG lộ IB "${nhan}" của nhóm khác`);
    }
  }

  console.log('\n3. Sửa query string sang nhóm khác — vẫn không lộ (applyScope ép sau cùng)');
  {
    const tm = await prisma.user.findFirstOrThrow({
      where: { email: 'quanlynhom.ibtest@example.invalid' },
      select: { id: true },
    });
    const html = await xemTrang(tm.id, { teamId: teamKhac.id });
    const hien = tenIbHienRa(html);

    kiem(
      hien.length === cuaTeamA.length && cuaTeamA.every((x) => hien.includes(x.isDirect ? 'Không qua IB' : x.label)),
      `?teamId=${teamKhac.nameVi} vẫn chỉ ra nhóm của mình`,
      hien.join(', '),
    );
  }

  console.log('\n4. THÀNH VIÊN (không có capital.view) — không được xem số tiền');
  {
    const tv = await taoNguoi('thanhvien', ROLE.MEMBER, teamA);
    const html = await xemTrang(tv.id);
    const khoi = khoiIb(html);

    kiem(khoi !== '', 'khối vẫn có mặt (không biến mất không lời giải thích)');
    kiem(khoi.includes('Bạn không có quyền xem dữ liệu vốn'), 'nói rõ là thiếu quyền');
    kiem(tenIbHienRa(html).length === 0, 'không tên IB nào lọt ra', tenIbHienRa(html).join(', '));
    kiem(!khoi.includes('₫'), 'không con số tiền nào lọt ra');
  }

  console.log('\n5. HỖ TRỢ TRADE (cũng không có capital.view) — như trên');
  {
    const ht = await taoNguoi('hotrotrade', ROLE.SUPPORTING_EXECUTION, teamA);
    const html = await xemTrang(ht.id);
    kiem(khoiIb(html).includes('Bạn không có quyền xem dữ liệu vốn'), 'nói rõ là thiếu quyền');
    kiem(tenIbHienRa(html).length === 0, 'không tên IB nào lọt ra');
  }

  console.log('\n6. Nhóm không có tài khoản nào — trạng thái rỗng đúng nghĩa');
  {
    const tm2 = await taoNguoi('nhomrong', ROLE.TEAM_MANAGER, teamKhac.id);
    const html = await xemTrang(tm2.id);
    const khoi = khoiIb(html);

    kiem(
      khoi.includes('Chưa có tài khoản chứng khoán nào'),
      'nói "chưa có tài khoản", KHÔNG nói thiếu quyền',
    );
    kiem(!khoi.includes('không có quyền'), 'không lẫn sang thông báo thiếu quyền');
    kiem(tenIbHienRa(html).length === 0, 'không tên IB nào lọt ra');
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
