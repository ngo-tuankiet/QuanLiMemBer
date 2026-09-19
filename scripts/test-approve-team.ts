/**
 * KIỂM THỬ: gán nhóm KHÁC phòng ban khi duyệt tài khoản.
 *
 * Trường hợp thật đã chặn trước đây: Quản lý cấp cao thuộc phòng "Ban lãnh đạo" vẫn
 * giao dịch dưới nhóm "Cá nhân". Phòng "Ban lãnh đạo" không có nhóm nào — đúng thiết
 * kế, vì nhóm là đơn vị GIAO DỊCH chứ không phải đơn vị TỔ CHỨC. Chốt cũ đòi
 * `team.departmentId === user.departmentId` nên người đó không thể được gán nhóm nào.
 *
 * Gọi ĐÚNG `approveUserAction` và `assignUserAction` mà ứng dụng gọi, trên BẢN SAO
 * database — duyệt ai với vai trò nào là quyết định nghiệp vụ, bài kiểm thử không được
 * đụng vào dữ liệu thật.
 *
 * Dùng: npm run test:approve-team
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { approveUserAction, assignUserAction } from '@/admin/actions';
import { ROLE, USER_STATUS } from '@/lib/enums';

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

function fd(cap: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(cap)) f.set(k, v);
  return f;
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  await createSession(admin.id);

  const banLanhDao = await prisma.department.findFirstOrThrow({
    where: { code: 'SENIOR_MANAGEMENT' },
    select: { id: true, nameVi: true },
  });
  const nhomCaNhan = await prisma.team.findFirstOrThrow({
    where: { code: 'CA_NHAN' },
    select: { id: true, nameVi: true, departmentId: true },
  });

  const soNhomCuaBanLanhDao = await prisma.team.count({
    where: { departmentId: banLanhDao.id },
  });

  console.log(`Nền: phòng "${banLanhDao.nameVi}" có ${soNhomCuaBanLanhDao} nhóm`);
  console.log(
    `      nhóm "${nhomCaNhan.nameVi}" thuộc phòng khác: ${nhomCaNhan.departmentId !== banLanhDao.id}`,
  );
  kiem(soNhomCuaBanLanhDao === 0, 'Ban lãnh đạo thật sự không có nhóm nào (đúng thiết kế)');
  kiem(
    nhomCaNhan.departmentId !== banLanhDao.id,
    'Nhóm "Cá nhân" thuộc phòng ban KHÁC — đúng tình huống cần kiểm',
  );

  const taoChoDuyet = (ten: string) =>
    prisma.user.create({
      data: {
        email: `${ten}.approve-team@example.invalid`,
        passwordHash: 'x'.repeat(60),
        fullName: `Kiem thu ${ten}`,
        status: USER_STATUS.PENDING,
      },
      select: { id: true },
    });

  console.log('\n1. Duyệt: Quản lý cấp cao · Ban lãnh đạo · nhóm Cá nhân');
  {
    const u = await taoChoDuyet('qlcc');
    const kq = await approveUserAction(
      null,
      fd({
        userId: u.id,
        roleCode: ROLE.SENIOR_MANAGER,
        departmentId: banLanhDao.id,
        teamId: nhomCaNhan.id,
      }),
    );

    kiem(kq.ok === true, 'duyệt được (trước đây bị từ chối)', JSON.stringify(kq));

    const sau = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: {
        status: true,
        role: { select: { code: true } },
        department: { select: { code: true } },
        team: { select: { code: true } },
      },
    });
    kiem(sau.status === USER_STATUS.ACTIVE, 'tài khoản đã kích hoạt');
    kiem(sau.role?.code === ROLE.SENIOR_MANAGER, 'vai trò đúng', String(sau.role?.code));
    kiem(sau.department?.code === 'SENIOR_MANAGEMENT', 'phòng ban đúng', String(sau.department?.code));
    kiem(sau.team?.code === 'CA_NHAN', 'NHÓM đúng — điểm chính của bài kiểm thử', String(sau.team?.code));
  }

  console.log('\n2. Vẫn duyệt được khi KHÔNG chọn nhóm');
  {
    const u = await taoChoDuyet('khongnhom');
    const kq = await approveUserAction(
      null,
      fd({ userId: u.id, roleCode: ROLE.SENIOR_MANAGER, departmentId: banLanhDao.id }),
    );
    kiem(kq.ok === true, 'duyệt được', JSON.stringify(kq));
    const sau = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: { teamId: true },
    });
    kiem(sau.teamId === null, 'không thuộc nhóm nào');
  }

  console.log('\n3. Nhóm không tồn tại → từ chối (id đến từ form, không được tin)');
  {
    const u = await taoChoDuyet('nhombia');
    const kq = await approveUserAction(
      null,
      fd({
        userId: u.id,
        roleCode: ROLE.SENIOR_MANAGER,
        departmentId: banLanhDao.id,
        teamId: 'id-khong-ton-tai',
      }),
    );
    kiem(kq.ok === false, 'bị từ chối');
    kiem(kq.fieldErrors?.teamId !== undefined, 'lỗi gắn vào đúng ô teamId');
    const sau = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: { status: true },
    });
    kiem(sau.status === USER_STATUS.PENDING, 'vẫn ở trạng thái chờ, không bị kích hoạt nửa vời');
  }

  console.log('\n4. Nhóm đã ngừng hoạt động → từ chối');
  {
    const nhomTat = await prisma.team.create({
      data: {
        code: `TAT_${process.pid}`,
        name: 'Disabled team',
        nameVi: 'Nhóm đã tắt',
        departmentId: nhomCaNhan.departmentId,
        isActive: false,
      },
      select: { id: true },
    });
    const u = await taoChoDuyet('nhomtat');
    const kq = await approveUserAction(
      null,
      fd({
        userId: u.id,
        roleCode: ROLE.SENIOR_MANAGER,
        departmentId: banLanhDao.id,
        teamId: nhomTat.id,
      }),
    );
    kiem(kq.ok === false, 'bị từ chối');
    kiem(
      kq.fieldErrors?.teamId?.[0]?.includes('ngừng hoạt động') === true,
      'nói rõ lý do là nhóm đã tắt',
      JSON.stringify(kq.fieldErrors),
    );
  }

  console.log('\n5. Đổi nhóm sau khi đã duyệt (trang chi tiết) — cũng phải cho phép khác phòng ban');
  {
    const nhomKhac = await prisma.team.findFirstOrThrow({
      where: { code: 'CAU_LONG' },
      select: { id: true, code: true },
    });
    const u = await prisma.user.findFirstOrThrow({
      where: { email: 'qlcc.approve-team@example.invalid' },
      select: { id: true },
    });

    const kq = await assignUserAction(
      null,
      fd({
        userId: u.id,
        roleCode: ROLE.SENIOR_MANAGER,
        departmentId: banLanhDao.id,
        teamId: nhomKhac.id,
      }),
    );
    kiem(kq.ok === true, 'đổi được sang nhóm khác phòng ban', JSON.stringify(kq));

    const sau = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: { team: { select: { code: true } } },
    });
    kiem(sau.team?.code === 'CAU_LONG', 'nhóm đã đổi', String(sau.team?.code));
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
