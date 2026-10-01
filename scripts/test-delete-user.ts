/**
 * KIỂM THỬ `deleteUserAction` — gọi ĐÚNG hàm mà ứng dụng gọi.
 *
 * Chạy trên một BẢN SAO của database (DATABASE_URL do lệnh gọi truyền vào), nên
 * `prisma/dev.db` không bị đụng tới. `next/headers` và `next/cache` được trỏ sang
 * shim trong `scripts/_shim/` qua `tsconfig.test.json`.
 *
 * VÌ SAO KHÔNG CHÉP LOGIC VÀO ĐÂY: đầu phiên này `verify-model.ts` từng có công
 * thức Alpha riêng, lệch hẳn so với ứng dụng, mà vẫn "pass" suốt. Bài kiểm thử
 * chép lại logic chỉ kiểm thử bản chép. Ở đây thay môi trường, giữ nguyên code.
 *
 * Dùng: npm run test:delete-user
 */

import { prisma } from '@/lib/prisma';
import { deleteUserAction } from '@/admin/actions';
import { createSession } from '@/auth/session';
import { ROLE, USER_STATUS, BROKER, AUDIT_ACTION, ENTITY_TYPE } from '@/lib/enums';

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
  const duoi = `.test-${process.pid}@example.invalid`;

  const vaiTro = await prisma.role.findMany({ select: { id: true, code: true } });
  const idVaiTro = (code: string): string => {
    const r = vaiTro.find((x) => x.code === code);
    if (!r) throw new Error(`thieu vai tro ${code} trong DB`);
    return r.id;
  };

  const taoNguoi = (ten: string, roleCode: string) =>
    prisma.user.create({
      data: {
        email: `${ten}${duoi}`,
        passwordHash: 'x'.repeat(60),
        fullName: `Kiem thu ${ten}`,
        status: USER_STATUS.ACTIVE,
        roleId: idVaiTro(roleCode),
      },
    });

  // Người thao tác: Admin — có `user.delete` vì Admin nhận ALL_PERMISSION_CODES.
  const admin = await taoNguoi('admin', ROLE.ADMIN);
  await createSession(admin.id); // ghi cookie vào shim → requirePermission đọc được

  console.log('\n1. Đường thành công — tài khoản sạch, chưa phát sinh gì');
  {
    const sach = await taoNguoi('sach', ROLE.MEMBER);
    const truocAudit = await prisma.auditLog.count();

    const kq = await deleteUserAction(null, fd({ userId: sach.id, confirmEmail: sach.email }));

    kiem(kq.ok === true, 'xoá được', kq.message);
    kiem((await prisma.user.count({ where: { id: sach.id } })) === 0, 'bản ghi user đã biến mất');

    const log = await prisma.auditLog.findFirst({
      where: { entityType: ENTITY_TYPE.USER, entityId: sach.id, action: AUDIT_ACTION.DELETE },
      orderBy: { occurredAt: 'desc' },
    });
    kiem(log !== null, 'có dòng audit DELETE');
    kiem((await prisma.auditLog.count()) === truocAudit + 1, 'đúng một dòng audit được thêm');
    kiem(
      log?.actorEmail === admin.email,
      'audit giữ ảnh chụp email người thao tác',
      String(log?.actorEmail),
    );
    kiem(
      log?.entityLabel?.includes(sach.email) === true,
      'audit giữ email người bị xoá',
      String(log?.entityLabel),
    );
  }

  console.log('\n2. Gõ sai email → từ chối');
  {
    const u = await taoNguoi('saiemail', ROLE.MEMBER);
    const kq = await deleteUserAction(
      null,
      fd({ userId: u.id, confirmEmail: 'khong-phai@example.invalid' }),
    );
    kiem(kq.ok === false, 'bị từ chối');
    kiem(kq.fieldErrors?.confirmEmail !== undefined, 'lỗi gắn vào đúng ô confirmEmail');
    kiem((await prisma.user.count({ where: { id: u.id } })) === 1, 'user còn nguyên');
  }

  console.log('\n3. Email đúng nhưng khác hoa/thường → vẫn xoá');
  {
    const u = await taoNguoi('hoathuong', ROLE.MEMBER);
    const kq = await deleteUserAction(
      null,
      fd({ userId: u.id, confirmEmail: `  ${u.email.toUpperCase()}  ` }),
    );
    kiem(kq.ok === true, 'xoá được dù gõ HOA và có khoảng trắng thừa', kq.message);
  }

  console.log('\n4. Tự xoá mình → từ chối');
  {
    const kq = await deleteUserAction(null, fd({ userId: admin.id, confirmEmail: admin.email }));
    kiem(kq.ok === false, 'bị từ chối');
    kiem((await prisma.user.count({ where: { id: admin.id } })) === 1, 'admin còn nguyên');
    console.log(`        thông báo: ${kq.message}`);
  }

  console.log('\n5. Xoá người vai trò ngang mình (Admin xoá Admin) → từ chối');
  {
    const u = await taoNguoi('adminkhac', ROLE.ADMIN);
    const kq = await deleteUserAction(null, fd({ userId: u.id, confirmEmail: u.email }));
    kiem(kq.ok === false, 'bị từ chối');
    kiem((await prisma.user.count({ where: { id: u.id } })) === 1, 'user còn nguyên');
    console.log(`        thông báo: ${kq.message}`);
    await prisma.user.delete({ where: { id: u.id } });
  }

  console.log('\n6. Người đã có tài khoản chứng khoán → từ chối, chỉ sang "Khoá"');
  {
    const u = await taoNguoi('cotaikhoan', ROLE.EXECUTION);
    await prisma.brokerAccount.create({
      data: { userId: u.id, broker: BROKER.SSI, accountNo: `TEST${process.pid}` },
    });

    const kq = await deleteUserAction(null, fd({ userId: u.id, confirmEmail: u.email }));
    kiem(kq.ok === false, 'bị từ chối');
    kiem(kq.message?.includes('tài khoản chứng khoán') === true, 'nói rõ cái gì đang giữ lại');
    kiem(kq.message?.includes('Khoá') === true, 'chỉ sang thao tác "Khoá"');
    kiem((await prisma.user.count({ where: { id: u.id } })) === 1, 'user còn nguyên');
    console.log(`        thông báo: ${kq.message}`);
  }

  console.log('\n7. Người có lệnh thật → từ chối, và database cũng chặn bằng RESTRICT');
  {
    const lenh = await prisma.trade.findFirst({ select: { userId: true } });
    if (!lenh) {
      console.log('  BOQUA database không có lệnh nào để thử');
    } else {
      const chuLenh = await prisma.user.findUniqueOrThrow({ where: { id: lenh.userId } });

      const kq = await deleteUserAction(
        null,
        fd({ userId: chuLenh.id, confirmEmail: chuLenh.email }),
      );
      kiem(kq.ok === false, `từ chối xoá ${chuLenh.email}`);
      console.log(`        thông báo: ${kq.message}`);

      // Chốt cuối: kể cả khi lớp kiểm ở ứng dụng bị bỏ qua, database vẫn phải chặn.
      let dbChan = false;
      try {
        await prisma.user.delete({ where: { id: chuLenh.id } });
      } catch {
        dbChan = true;
      }
      kiem(dbChan, 'RESTRICT của database chặn khi bỏ qua lớp kiểm ứng dụng');
      kiem((await prisma.user.count({ where: { id: chuLenh.id } })) === 1, 'chủ lệnh còn nguyên');
    }
  }

  console.log('\n8. Người không có quyền `user.delete` → ForbiddenError');
  {
    const thuong = await taoNguoi('khongquyen', ROLE.EXECUTION);
    const nanNhan = await taoNguoi('nannhan', ROLE.MEMBER);
    await createSession(thuong.id); // đổi cookie sang người không có quyền

    let daNem = false;
    try {
      await deleteUserAction(null, fd({ userId: nanNhan.id, confirmEmail: nanNhan.email }));
    } catch (e) {
      daNem = e instanceof Error && e.name === 'ForbiddenError';
    }
    kiem(daNem, 'ném ForbiddenError trước khi làm bất cứ việc gì');
    kiem((await prisma.user.count({ where: { id: nanNhan.id } })) === 1, 'nạn nhân còn nguyên');
  }

  console.log('\n9. Phiên đăng nhập bị xoá theo (CASCADE)');
  {
    const u = await taoNguoi('cophien', ROLE.MEMBER);
    await createSession(u.id); // tạo phiên cho u; cookie bị ghi đè, lấy lại ngay sau
    kiem((await prisma.session.count({ where: { userId: u.id } })) >= 1, 'đã có phiên trước khi xoá');

    await createSession(admin.id); // trả cookie về admin
    const kq = await deleteUserAction(null, fd({ userId: u.id, confirmEmail: u.email }));
    kiem(kq.ok === true, 'xoá được', kq.message);
    kiem((await prisma.session.count({ where: { userId: u.id } })) === 0, 'phiên bị xoá theo');
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
