/**
 * KIỂM QUẢN LÝ CƠ CẤU TỔ CHỨC — đổi tên nhóm và phòng ban trên giao diện.
 *
 * Trước tính năng này, đổi tên một nhóm phải sửa `master-data.ts` rồi chạy `npm run
 * db:seed` — không phải việc của người vận hành, và không để lại dấu vết kiểm toán nào.
 *
 * Bài này gọi ĐÚNG các server action mà form dùng:
 *
 *   1. đổi tên nhóm → tên đổi, `id` GIỮ NGUYÊN (dữ liệu đã gắn nhóm không đứt)
 *   2. `code` không sửa được — nó là khoá `upsert` của seed
 *   3. mã trùng → từ chối
 *   4. tạo nhóm mới → gắn đúng phòng ban
 *   5. trưởng nhóm phải là người TRONG nhóm
 *   6. đóng nhóm còn thành viên → từ chối; nhóm rỗng → đóng được; mở lại vô điều kiện
 *   7. phòng ban: không tự làm cấp trên của chính nó, không tạo vòng lặp
 *   8. mọi thay đổi ghi Audit Log
 *   9. người không có quyền không sửa được
 *
 * Chạy trên BẢN SAO database. Dùng: npm run test:organization
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { saveDepartmentAction, saveTeamAction, toggleTeamAction } from '@/admin/org-actions';
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

const f = (o: Record<string, string>): FormData => {
  const d = new FormData();
  for (const [k, v] of Object.entries(o)) d.set(k, v);
  return d;
};

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { email: 'admin@vninvest.local' },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });
  await createSession(admin.id);

  const nhomGoc = await prisma.team.findFirstOrThrow({
    orderBy: { code: 'asc' },
    select: { id: true, code: true, nameVi: true, departmentId: true },
  });
  const phongBan = await prisma.department.findMany({
    orderBy: { sortOrder: 'asc' },
    select: { id: true, code: true, nameVi: true, parentId: true },
  });

  console.log(`Nhóm gốc: ${nhomGoc.nameVi} (${nhomGoc.code})\n`);

  // =========================================================================
  // 1 + 2. Đổi tên — id giữ nguyên, code không đổi
  // =========================================================================
  console.log('1. Đổi tên nhóm');
  {
    const truocAudit = await prisma.auditLog.count();

    const kq = await saveTeamAction(
      null,
      f({
        id: nhomGoc.id,
        code: nhomGoc.code,
        name: 'Investment One',
        nameVi: 'Đầu tư 1',
        departmentId: nhomGoc.departmentId,
      }),
    );

    kiem(kq.ok === true, 'lưu được', JSON.stringify(kq));

    const sau = await prisma.team.findUniqueOrThrow({
      where: { id: nhomGoc.id },
      select: { id: true, code: true, nameVi: true, name: true },
    });

    kiem(sau.nameVi === 'Đầu tư 1', `tên đổi thành "${sau.nameVi}"`);
    kiem(sau.name === 'Investment One', 'tên tiếng Anh đổi theo');
    kiem(sau.id === nhomGoc.id, 'ID GIỮ NGUYÊN — lệnh và vốn đã gắn nhóm không đứt');
    kiem(sau.code === nhomGoc.code, 'mã giữ nguyên');
    kiem(
      (await prisma.auditLog.count()) === truocAudit + 1,
      'ghi đúng một dòng Audit Log',
    );

    const log = await prisma.auditLog.findFirst({
      orderBy: { occurredAt: 'desc' },
      select: { entityType: true, action: true, entityLabel: true },
    });
    kiem(
      log?.entityType === 'TEAM' && log.action === 'UPDATE',
      `nhật ký đúng loại: ${log?.entityType}/${log?.action} — ${log?.entityLabel}`,
    );
  }

  // =========================================================================
  // 3. Mã trùng
  // =========================================================================
  console.log('\n2. Mã trùng → từ chối');
  {
    const khac = await prisma.team.findFirst({
      where: { id: { not: nhomGoc.id } },
      select: { id: true, code: true, nameVi: true, departmentId: true },
    });

    if (!khac) {
      console.log('  BOQUA: chi co mot nhom');
    } else {
      const kq = await saveTeamAction(
        null,
        f({
          id: khac.id,
          code: nhomGoc.code, // lấy mã của nhóm kia
          name: khac.nameVi,
          nameVi: khac.nameVi,
          departmentId: khac.departmentId,
        }),
      );
      kiem(kq.ok === false, 'bị từ chối');
      kiem(
        kq.fieldErrors?.code?.[0]?.includes('đã có nhóm khác dùng') === true,
        'thông báo nói rõ mã trùng',
        JSON.stringify(kq.fieldErrors),
      );
    }
  }

  // =========================================================================
  // 4. Tạo nhóm mới
  // =========================================================================
  console.log('\n3. Tạo nhóm mới');
  let nhomMoiId = '';
  {
    const truocSo = await prisma.team.count();
    const kq = await saveTeamAction(
      null,
      f({
        code: 'KIEM_THU',
        name: 'Test Team',
        nameVi: 'Nhóm kiểm thử',
        departmentId: phongBan[0]!.id,
        description: 'Dựng cho bài kiểm',
      }),
    );

    kiem(kq.ok === true, 'tạo được', JSON.stringify(kq));
    kiem((await prisma.team.count()) === truocSo + 1, 'đúng một nhóm được tạo');

    const moi = await prisma.team.findUnique({
      where: { code: 'KIEM_THU' },
      select: { id: true, departmentId: true, isActive: true, nameVi: true },
    });
    nhomMoiId = moi?.id ?? '';
    kiem(moi?.departmentId === phongBan[0]!.id, `gắn đúng phòng ban ${phongBan[0]!.nameVi}`);
    kiem(moi?.isActive === true, 'nhóm mới đang mở');
  }

  // =========================================================================
  // 5. Trưởng nhóm phải là người trong nhóm
  // =========================================================================
  console.log('\n4. Trưởng nhóm phải thuộc nhóm đó');
  {
    // Admin không thuộc nhóm nào sau khi dọn dữ liệu.
    const kq = await saveTeamAction(
      null,
      f({
        id: nhomGoc.id,
        code: nhomGoc.code,
        name: 'Investment One',
        nameVi: 'Đầu tư 1',
        departmentId: nhomGoc.departmentId,
        leaderId: admin.id,
      }),
    );

    kiem(kq.ok === false, 'từ chối gán người ngoài nhóm làm trưởng');
    kiem(
      kq.fieldErrors?.leaderId?.[0]?.includes('không thuộc nhóm này') === true,
      'thông báo nói rõ lý do',
      JSON.stringify(kq.fieldErrors),
    );
    console.log(`        thông báo: ${kq.fieldErrors?.leaderId?.[0]}`);
  }

  // =========================================================================
  // 6. Đóng / mở lại
  // =========================================================================
  console.log('\n5. Đóng và mở lại nhóm');
  {
    // Nhóm mới chưa có ai → đóng được.
    const kq = await toggleTeamAction(null, f({ id: nhomMoiId }));
    kiem(kq.ok === true, 'nhóm rỗng đóng được', JSON.stringify(kq));
    kiem(
      (await prisma.team.findUniqueOrThrow({ where: { id: nhomMoiId }, select: { isActive: true } }))
        .isActive === false,
      'trạng thái đã đóng',
    );

    const mo = await toggleTeamAction(null, f({ id: nhomMoiId }));
    kiem(mo.ok === true, 'mở lại được — không cần điều kiện gì');

    /*
     * Nhóm CÒN THÀNH VIÊN thì không đóng được: người trong nhóm đã đóng vẫn mang `teamId`
     * đó, nên `dataScope` ép họ về một nhóm không còn trên giao diện — họ thấy trang trống
     * mà không có gì giải thích.
     */
    await prisma.user.update({ where: { id: admin.id }, data: { teamId: nhomMoiId } });
    const chan = await toggleTeamAction(null, f({ id: nhomMoiId }));
    kiem(chan.ok === false, 'nhóm còn thành viên KHÔNG đóng được');
    kiem(
      chan.message?.includes('còn 1 thành viên') === true,
      'thông báo nêu số thành viên',
      chan.message,
    );
    console.log(`        thông báo: ${chan.message}`);
    await prisma.user.update({ where: { id: admin.id }, data: { teamId: null } });
  }

  // =========================================================================
  // 7. Phòng ban — vòng lặp cây
  // =========================================================================
  console.log('\n6. Phòng ban không tạo được vòng lặp');
  {
    const goc = phongBan[0]!;
    const tuLam = await saveDepartmentAction(
      null,
      f({
        id: goc.id,
        code: goc.code,
        name: goc.nameVi,
        nameVi: goc.nameVi,
        parentId: goc.id, // chính nó
        sortOrder: '1',
      }),
    );
    kiem(tuLam.ok === false, 'không tự làm cấp trên của chính nó');

    const con = phongBan.find((d) => d.parentId === goc.id);
    if (!con) {
      console.log('  BOQUA: khong co phong ban con de kiem vong lap sau hon');
    } else {
      const vongLap = await saveDepartmentAction(
        null,
        f({
          id: goc.id,
          code: goc.code,
          name: goc.nameVi,
          nameVi: goc.nameVi,
          parentId: con.id, // lấy con làm cha
          sortOrder: '1',
        }),
      );
      kiem(vongLap.ok === false, 'không lấy phòng ban cấp dưới làm cấp trên');
      kiem(
        vongLap.fieldErrors?.parentId?.[0]?.includes('vòng lặp') === true,
        'thông báo nói rõ sẽ tạo vòng lặp',
        JSON.stringify(vongLap.fieldErrors),
      );
    }
  }

  // =========================================================================
  // 8. Đổi tên phòng ban
  // =========================================================================
  console.log('\n7. Đổi tên phòng ban');
  {
    const d = phongBan[0]!;
    const kq = await saveDepartmentAction(
      null,
      f({
        id: d.id,
        code: d.code,
        name: 'Renamed Division',
        nameVi: 'Khối đã đổi tên',
        parentId: d.parentId ?? '',
        sortOrder: '1',
      }),
    );
    kiem(kq.ok === true, 'lưu được', JSON.stringify(kq));

    const sau = await prisma.department.findUniqueOrThrow({
      where: { id: d.id },
      select: { id: true, nameVi: true, code: true },
    });
    kiem(sau.nameVi === 'Khối đã đổi tên', `tên đổi thành "${sau.nameVi}"`);
    kiem(sau.id === d.id && sau.code === d.code, 'ID và mã giữ nguyên');
  }

  // =========================================================================
  // 9. Không có quyền thì không sửa được
  // =========================================================================
  console.log('\n8. Người không có quyền');
  {
    const thuong = await prisma.user.findFirst({
      where: { role: { code: { not: ROLE.ADMIN } }, status: USER_STATUS.ACTIVE },
      select: { id: true, fullName: true },
    });

    if (!thuong) {
      console.log('  BOQUA: chi con tai khoan admin — chua co ai de kiem');
    } else {
      await createSession(thuong.id);
      let biChan = false;
      try {
        const kq = await saveTeamAction(
          null,
          f({ id: nhomGoc.id, code: nhomGoc.code, name: 'X', nameVi: 'X', departmentId: nhomGoc.departmentId }),
        );
        biChan = kq.ok === false;
      } catch {
        biChan = true; // requirePermission ném / chuyển hướng — cũng là bị chặn
      }
      kiem(biChan, `${thuong.fullName} không sửa được nhóm`);
      await createSession(admin.id);
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
