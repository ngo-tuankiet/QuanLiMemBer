/**
 * MỘT YÊU CẦU RÚT VỐN CÓ THẬT SỰ TỚI ĐƯỢC NGƯỜI DUYỆT KHÔNG?
 *
 * Người dùng báo: đã gửi yêu cầu rút, thẻ tài khoản hiện "chờ duyệt rút …", nhưng cấp
 * trên không thấy đề xuất nào trong hàng chờ.
 *
 * Câu hỏi là "AI NHÌN THẤY GÌ", nên bài này KẾT XUẤT TRANG /approvals THẬT dưới danh
 * nghĩa từng người duyệt, thay vì gọi lại truy vấn. Trang mới là nơi `dataScope` và bộ
 * lọc nhóm gặp nhau — viết lại bộ lọc trong bài kiểm thì bài kiểm sẽ đúng theo cách
 * hiểu của tôi chứ không theo cách sản phẩm chạy.
 *
 * Chạy trên BẢN SAO: npm run test:withdraw-reaches-approver
 */

import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import bcrypt from 'bcryptjs';

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { withdrawCapitalAction } from '@/accounts/actions';
import { ROLE, USER_STATUS, CAPITAL_FLOW_TYPE, CAPITAL_FLOW_STATUS } from '@/lib/enums';
import Page from '../app/(app)/approvals/page';

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

async function xemApprovals(userId: string): Promise<string> {
  await createSession(userId);
  const el = await (Page as unknown as () => Promise<ReactElement>)();
  return renderToStaticMarkup(el);
}

async function taoNguoi(
  email: string,
  hoTen: string,
  roleCode: string,
  teamId: string | null,
): Promise<string> {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const dept = await prisma.department.findFirstOrThrow({ select: { id: true } });
  const u = await prisma.user.upsert({
    where: { email },
    update: { roleId: role.id, teamId, status: USER_STATUS.ACTIVE, mustChangePassword: false },
    create: {
      email,
      fullName: hoTen,
      passwordHash: await bcrypt.hash('KhongDungToi@2026', 10),
      status: USER_STATUS.ACTIVE,
      roleId: role.id,
      departmentId: dept.id,
      teamId,
      approvedAt: new Date(),
      mustChangePassword: false,
    },
    select: { id: true },
  });
  return u.id;
}

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  const nhomA = await prisma.team.findFirstOrThrow({ select: { id: true, nameVi: true } });
  const nhomB = await prisma.team.findFirstOrThrow({
    where: { id: { not: nhomA.id } },
    select: { id: true, nameVi: true },
  });

  console.log(`\nNhóm A = ${nhomA.nameVi} · Nhóm B = ${nhomB.nameVi}\n`);

  /*
   * HAI NGƯỜI XIN RÚT, khác nhau đúng một điểm: có nhóm hay không.
   * Đó là biến duy nhất cần cô lập.
   */
  const xinCoNhom = await taoNguoi('xin.conhom@test.local', 'Người Xin Có Nhóm', ROLE.MEMBER, nhomA.id);
  const xinKhongNhom = await taoNguoi('xin.khongnhom@test.local', 'Người Xin Không Nhóm', ROLE.MEMBER, null);

  // Ba người duyệt: cấp cao (view_all), trưởng nhóm A, trưởng nhóm B.
  const capCao = await taoNguoi('duyet.capcao@test.local', 'Quản Lý Cấp Cao', ROLE.SENIOR_MANAGER, null);
  const truongA = await taoNguoi('duyet.truonga@test.local', 'Trưởng Nhóm A', ROLE.TEAM_MANAGER, nhomA.id);
  const truongB = await taoNguoi('duyet.truongb@test.local', 'Trưởng Nhóm B', ROLE.TEAM_MANAGER, nhomB.id);

  // Mỗi người xin một tài khoản, nạp vốn rồi xin rút.
  const soTien = 100_000_000n;
  for (const [i, uid] of [xinCoNhom, xinKhongNhom].entries()) {
    const acc = await prisma.brokerAccount.create({
      data: { userId: uid, broker: 'SSI', accountNo: `WD00000${i}` },
      select: { id: true },
    });
    await prisma.capitalFlow.create({
      data: {
        portfolioId: portfolio.id,
        brokerAccountId: acc.id,
        flowType: CAPITAL_FLOW_TYPE.CONTRIBUTION,
        status: CAPITAL_FLOW_STATUS.CONFIRMED,
        amount: soTien,
        occurredAt: new Date(),
        createdById: uid,
      },
    });

    await createSession(uid);
    const f = new FormData();
    f.append('brokerAccountId', acc.id);
    f.append('amount', String(soTien / 2n));
    f.append('occurredAt', new Date().toISOString().slice(0, 10));
    f.append('note', 'kiểm thử');
    const kq = await withdrawCapitalAction(null, f);
    kiem(kq.ok, `người ${i === 0 ? 'CÓ nhóm' : 'KHÔNG nhóm'} gửi được yêu cầu rút`, kq.message ?? '');
  }

  const cho = await prisma.capitalFlow.findMany({
    where: { flowType: CAPITAL_FLOW_TYPE.WITHDRAWAL, status: CAPITAL_FLOW_STATUS.PENDING },
    select: { amount: true, teamId: true, createdBy: { select: { fullName: true } } },
  });
  console.log('\n  Yêu cầu đang chờ trong database:');
  for (const c of cho) {
    console.log(`    ${c.createdBy?.fullName} · teamId = ${c.teamId ?? 'NULL'}`);
  }

  console.log('\nAI NHÌN THẤY GÌ TRÊN /approvals\n');
  for (const [ten, uid] of [
    ['Quản lý cấp cao (view_all)', capCao],
    ['Trưởng nhóm A (cùng nhóm người xin)', truongA],
    ['Trưởng nhóm B (khác nhóm)', truongB],
  ] as const) {
    const html = await xemApprovals(uid);
    const thayCoNhom = html.includes('Người Xin Có Nhóm');
    const thayKhongNhom = html.includes('Người Xin Không Nhóm');
    console.log(
      `  ${ten.padEnd(38)} người-có-nhóm=${thayCoNhom ? 'THẤY' : 'không'} · ` +
        `người-không-nhóm=${thayKhongNhom ? 'THẤY' : 'không'}`,
    );
  }

  console.log('');
  const htmlCapCao = await xemApprovals(capCao);
  kiem(
    htmlCapCao.includes('Người Xin Có Nhóm') && htmlCapCao.includes('Người Xin Không Nhóm'),
    'Cấp cao (view_all) thấy CẢ HAI yêu cầu',
  );

  const htmlTruongA = await xemApprovals(truongA);
  kiem(htmlTruongA.includes('Người Xin Có Nhóm'), 'Trưởng nhóm A thấy yêu cầu của nhóm mình');
  /*
   * KHẲNG ĐỊNH NÀY GHI LẠI HÀNH VI HIỆN TẠI, KHÔNG PHẢI HÀNH VI MONG MUỐN.
   *
   * Yêu cầu của người chưa được gán nhóm mang `teamId = NULL`, và NULL không khớp
   * nhóm nào — nên mọi người duyệt ở phạm vi nhóm đều không thấy. Chỉ người có
   * `capital.view_all` mới thấy. Nếu tổ chức không có ai như vậy rảnh để quyết
   * (hoặc người duy nhất có lại chính là người gửi — chốt bốn mắt), yêu cầu treo vô
   * thời hạn và KHÔNG chỗ nào trong giao diện nói ra.
   *
   * Để bài kiểm XANH ở đây là cố ý: một bài kiểm đỏ thường trực sẽ dạy người đọc bỏ
   * qua màu đỏ. Khi lỗ hổng được vá, đảo khẳng định này lại thành `includes`.
   * Công cụ `npm run check:withdraw-routing` nói ra tình trạng này trên dữ liệu thật.
   */
  kiem(
    !htmlTruongA.includes('Người Xin Không Nhóm'),
    'GHI NHẬN LỖ HỔNG: trưởng nhóm KHÔNG thấy yêu cầu của người chưa có nhóm',
  );

  const htmlTruongB = await xemApprovals(truongB);
  kiem(
    !htmlTruongB.includes('Người Xin Có Nhóm'),
    'Trưởng nhóm B KHÔNG thấy yêu cầu của nhóm khác (đúng thiết kế)',
  );

  console.log('\n' + '!'.repeat(76));
  console.log(' LỖ HỔNG ĐÃ ĐO ĐƯỢC, CHƯA VÁ:');
  console.log(' Yêu cầu rút của người CHƯA ĐƯỢC GÁN NHÓM chỉ tới được người có');
  console.log(' capital.view_all. Không có ai như vậy thì nó treo vô hình — người gửi');
  console.log(' vẫn thấy "chờ duyệt", hàng chờ của mọi người duyệt khác thì trống.');
  console.log(' Chẩn đoán trên dữ liệu thật: npm run check:withdraw-routing');
  console.log('!'.repeat(76));

  console.log('\n' + '='.repeat(76));
  console.log(` KẾT QUẢ: ${dat} đạt · ${truot} sai`);
  console.log('='.repeat(76) + '\n');

  await prisma.$disconnect();
  process.exit(truot === 0 ? 0 : 1);
}

void main();
