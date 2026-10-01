/**
 * MỘT YÊU CẦU RÚT VỐN ĐANG CHỜ — AI THẤY, AI DUYỆT ĐƯỢC, VÀ VÌ SAO KHÔNG.
 *
 * VÌ SAO CẦN CÔNG CỤ NÀY. Người gửi yêu cầu chỉ nhận được một dòng "chờ duyệt rút …"
 * trên thẻ tài khoản. Dòng đó nói yêu cầu ĐÃ ĐƯỢC GHI, chứ không nói nó đã tới TAY AI.
 * Nếu không ai đủ điều kiện quyết định, yêu cầu treo vô thời hạn và không chỗ nào trong
 * giao diện nói ra điều đó — người gửi cứ chờ, người duyệt thì không thấy gì.
 *
 * Ba chốt cùng lúc quyết định "ai duyệt được", và trượt cái nào cũng ra CÙNG một triệu
 * chứng "hàng chờ trống":
 *
 *   1. QUYỀN     `capital.view` để thấy, `capital.approve` để quyết.
 *   2. PHẠM VI   không có `capital.view_all` thì chỉ thấy yêu cầu CÙNG NHÓM mình.
 *                Yêu cầu của người chưa được gán nhóm mang `teamId = NULL`, và NULL
 *                không khớp nhóm nào — chỉ người có `view_all` mới thấy.
 *   3. BỐN MẮT   không ai tự quyết yêu cầu do chính mình gửi, cũng không quyết được
 *                yêu cầu rút từ tài khoản của chính mình (§8).
 *
 * CHỈ ĐỌC, không sửa gì. Chạy: npm run check:withdraw-routing
 */

import { prisma } from '../src/lib/prisma';
import { resolvePermissions, dataScope } from '../src/domain/permissions';
import { formatVnd } from '../src/lib/money';
import type { RoleCode, PermissionEffect } from '../src/lib/enums';

interface NguoiDung {
  id: string;
  hoTen: string;
  email: string;
  vaiTro: string;
  teamId: string | null;
  tenNhom: string;
  quyen: ReadonlySet<string>;
}

async function docNguoiDung(): Promise<NguoiDung[]> {
  const rows = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { fullName: 'asc' },
    select: {
      id: true,
      fullName: true,
      email: true,
      teamId: true,
      team: { select: { nameVi: true } },
      role: { select: { code: true } },
      permissions: {
        select: { effect: true, expiresAt: true, permission: { select: { code: true } } },
      },
    },
  });

  return rows.map((u) => ({
    id: u.id,
    hoTen: u.fullName ?? '(chưa đặt tên)',
    email: u.email,
    vaiTro: u.role?.code ?? '(chưa gán vai trò)',
    teamId: u.teamId,
    tenNhom: u.team?.nameVi ?? '(chưa có nhóm)',
    quyen: resolvePermissions(
      (u.role?.code ?? null) as RoleCode | null,
      u.permissions.map((p) => ({
        permissionCode: p.permission.code,
        effect: p.effect as PermissionEffect,
        expiresAt: p.expiresAt,
      })),
    ),
  }));
}

async function main(): Promise<void> {
  const cho = await prisma.capitalFlow.findMany({
    where: { flowType: 'WITHDRAWAL', status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      amount: true,
      teamId: true,
      createdById: true,
      createdAt: true,
      createdBy: { select: { fullName: true } },
      team: { select: { nameVi: true } },
      brokerAccount: {
        select: { accountNo: true, broker: true, userId: true, user: { select: { fullName: true } } },
      },
    },
  });

  const nguoi = await docNguoiDung();

  console.log('');
  console.log('='.repeat(78));
  console.log(` YÊU CẦU RÚT VỐN ĐANG CHỜ: ${cho.length}   ·   người dùng đang hoạt động: ${nguoi.length}`);
  console.log('='.repeat(78));

  if (cho.length === 0) {
    console.log('\n Không có yêu cầu nào đang chờ trong database này.');
    console.log(' Nếu giao diện vẫn hiện "chờ duyệt rút", nghĩa là trang đang đọc một');
    console.log(' database KHÁC với database mà script này đọc. So lại DATABASE_URL trong .env.\n');
    await prisma.$disconnect();
    return;
  }

  for (const y of cho) {
    const chuTk = y.brokerAccount?.userId ?? null;
    console.log(`\n${'-'.repeat(78)}`);
    console.log(` ${formatVnd(y.amount)}  ·  ${y.brokerAccount?.broker ?? '?'} ${y.brokerAccount?.accountNo ?? '?'}`);
    console.log(` người gửi : ${y.createdBy?.fullName ?? '?'}`);
    console.log(` chủ tài khoản: ${y.brokerAccount?.user.fullName ?? '?'}`);
    console.log(` nhóm của yêu cầu: ${y.team?.nameVi ?? 'KHÔNG CÓ (teamId = NULL)'}`);
    console.log(` gửi lúc   : ${y.createdAt.toISOString().slice(0, 16).replace('T', ' ')}`);
    console.log(`${'-'.repeat(78)}`);

    let soNguoiDuyetDuoc = 0;

    for (const u of nguoi) {
      const pv = dataScope(u.quyen, 'capital');
      const thay = pv === 'ALL' ? true : pv === 'SCOPED' ? u.teamId !== null && u.teamId === y.teamId : false;

      const coQuyenDuyet = u.quyen.has('capital.approve');
      const tuMinh = y.createdById === u.id || chuTk === u.id;
      const duyetDuoc = thay && coQuyenDuyet && !tuMinh;
      if (duyetDuoc) soNguoiDuyetDuoc += 1;

      const lyDo: string[] = [];
      if (pv === 'NONE') lyDo.push('không có capital.view');
      else if (!thay && pv === 'SCOPED') {
        lyDo.push(
          y.teamId === null
            ? 'yêu cầu không thuộc nhóm nào, mà người này chỉ thấy nhóm mình'
            : `khác nhóm (người: ${u.tenNhom})`,
        );
      }
      if (!coQuyenDuyet) lyDo.push('không có capital.approve');
      if (tuMinh) lyDo.push('bốn mắt: yêu cầu của chính mình');

      const trangThai = duyetDuoc ? 'DUYỆT ĐƯỢC' : thay ? 'chỉ thấy  ' : 'không thấy';
      console.log(
        `  ${trangThai}  ${u.hoTen.slice(0, 22).padEnd(22)} ${u.vaiTro.padEnd(18)}` +
          (lyDo.length ? `  ← ${lyDo.join('; ')}` : ''),
      );
    }

    console.log('');
    if (soNguoiDuyetDuoc === 0) {
      console.log('  >>> KHÔNG AI DUYỆT ĐƯỢC YÊU CẦU NÀY. Nó sẽ treo vô thời hạn, và giao diện');
      console.log('      của người gửi vẫn chỉ hiện "chờ duyệt" mà không nói ra điều đó.');
      if (y.teamId === null) {
        console.log('      Cách xử lý: gán NHÓM cho người gửi, hoặc cấp capital.view_all cho');
        console.log('      một người duyệt (vai trò Quản lý cấp cao đã có sẵn quyền này).');
      } else {
        console.log('      Cách xử lý: cấp capital.approve cho một người trong nhóm đó, hoặc');
        console.log('      cấp capital.view_all cho một người duyệt ngoài nhóm.');
      }
    } else {
      console.log(`  ${soNguoiDuyetDuoc} người duyệt được yêu cầu này.`);
    }
  }

  console.log('');
  await prisma.$disconnect();
}

void main();
