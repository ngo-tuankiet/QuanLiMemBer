/**
 * KIỂM THỬ `resetUserPasswordAction` — đường phục hồi khi người dùng quên mật khẩu.
 *
 * Hệ thống không có hạ tầng email nên không có luồng tự phục vụ; quản trị viên sinh
 * mật khẩu tạm rồi đọc lại cho người dùng. Bài này kiểm cả hai mặt:
 *
 *   - mật khẩu tạm PHẢI dùng đăng nhập được (băm đúng, đủ quy tắc)
 *   - mật khẩu tạm KHÔNG được lọt vào audit log
 *
 * Chạy trên BẢN SAO database. Dùng: npm run test:reset-password
 */

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { resetUserPasswordAction } from '@/admin/actions';
import { verifyPassword } from '@/auth/password';
import { ROLE, USER_STATUS, AUDIT_ACTION } from '@/lib/enums';

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

/** Dòng đầu của `message` là mật khẩu, đứng một mình. */
const layMatKhau = (message?: string): string => (message ?? '').split('\n')[0] ?? '';

async function main(): Promise<void> {
  const vaiTro = await prisma.role.findMany({ select: { id: true, code: true } });
  const idVaiTro = (code: string): string => {
    const r = vaiTro.find((x) => x.code === code);
    if (!r) throw new Error(`thieu vai tro ${code}`);
    return r.id;
  };

  const taoNguoi = (ten: string, roleCode: string) =>
    prisma.user.create({
      data: {
        email: `${ten}.reset-${process.pid}@example.invalid`,
        passwordHash: 'x'.repeat(60),
        fullName: `Kiem thu ${ten}`,
        status: USER_STATUS.ACTIVE,
        roleId: idVaiTro(roleCode),
      },
    });

  const admin = await taoNguoi('admin', ROLE.ADMIN);
  await createSession(admin.id);

  console.log('\n1. Đặt lại cho người khác — đường thành công');
  {
    const u = await taoNguoi('quenmk', ROLE.EXECUTION);
    // Hai phiên đang hoạt động để kiểm việc thu hồi.
    await createSession(u.id);
    await createSession(u.id);
    await createSession(admin.id); // trả cookie về admin

    const soPhienTruoc = await prisma.session.count({
      where: { userId: u.id, revokedAt: null },
    });
    kiem(soPhienTruoc === 2, 'người đó đang có 2 phiên trước khi đặt lại', String(soPhienTruoc));

    const kq = await resetUserPasswordAction(null, fd({ userId: u.id }));
    kiem(kq.ok === true, 'đặt lại được', kq.message);

    const matKhau = layMatKhau(kq.message);
    console.log(`        mật khẩu tạm sinh ra: ${matKhau}`);

    kiem(matKhau.length >= 12, `dài ít nhất 12 ký tự (${matKhau.length})`);
    kiem(/[A-Z]/.test(matKhau), 'có chữ in hoa');
    kiem(/[a-z]/.test(matKhau), 'có chữ thường');
    kiem(/[0-9]/.test(matKhau), 'có số');
    kiem(
      !/[0O1lI5S8B]/.test(matKhau),
      'không có ký tự dễ đọc lẫn (0O 1lI 5S 8B)',
      matKhau,
    );

    const sau = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: { passwordHash: true, mustChangePassword: true },
    });

    /*
     * PHÉP KIỂM QUAN TRỌNG NHẤT: mật khẩu tạm phải đăng nhập được thật.
     *
     * Sinh ra một chuỗi rồi băm sai, hoặc băm chuỗi khác với chuỗi trả về, đều cho
     * kết quả "ok" mà người dùng không vào được — và lúc đó không ai biết lỗi ở đâu.
     */
    kiem(
      await verifyPassword(matKhau, sau.passwordHash),
      'mật khẩu tạm khớp với hash đã lưu — đăng nhập được',
    );
    kiem(sau.mustChangePassword === true, 'mustChangePassword đã bật');

    const conPhien = await prisma.session.count({
      where: { userId: u.id, revokedAt: null },
    });
    kiem(conPhien === 0, 'mọi phiên của người đó bị thu hồi', `còn ${conPhien}`);

    /*
     * MẬT KHẨU KHÔNG ĐƯỢC LỌT VÀO AUDIT LOG.
     *
     * Quét TOÀN BỘ nội dung dòng audit, không chỉ vài cột đã biết: nếu sau này ai
     * thêm mật khẩu vào `note` hay `afterJson`, phép kiểm này phải bắt được.
     */
    const log = await prisma.auditLog.findFirst({
      where: { entityId: u.id, action: AUDIT_ACTION.PASSWORD_RESET },
      orderBy: { occurredAt: 'desc' },
    });
    kiem(log !== null, 'có dòng audit PASSWORD_RESET');
    const toanBoDong = JSON.stringify(log ?? {});
    kiem(
      !toanBoDong.includes(matKhau),
      'audit log KHÔNG chứa mật khẩu tạm',
      toanBoDong.slice(0, 120),
    );
    kiem(
      log?.actorEmail === admin.email,
      'audit ghi đúng ai đặt lại',
      String(log?.actorEmail),
    );
  }

  console.log('\n2. Hai lần gọi phải cho hai mật khẩu khác nhau');
  {
    const a = await taoNguoi('rnd1', ROLE.EXECUTION);
    const b = await taoNguoi('rnd2', ROLE.EXECUTION);
    const m1 = layMatKhau((await resetUserPasswordAction(null, fd({ userId: a.id }))).message);
    const m2 = layMatKhau((await resetUserPasswordAction(null, fd({ userId: b.id }))).message);
    kiem(m1 !== '' && m2 !== '' && m1 !== m2, 'hai mật khẩu khác nhau', `${m1} vs ${m2}`);
  }

  console.log('\n3. Tự đặt lại mật khẩu của mình → từ chối');
  {
    const kq = await resetUserPasswordAction(null, fd({ userId: admin.id }));
    kiem(kq.ok === false, 'bị từ chối');
    console.log(`        thông báo: ${kq.message}`);
    const sau = await prisma.user.findUniqueOrThrow({
      where: { id: admin.id },
      select: { mustChangePassword: true },
    });
    kiem(sau.mustChangePassword === false, 'không tự bật mustChangePassword cho mình');
  }

  console.log('\n4. Đặt lại cho người vai trò ngang mình → từ chối');
  {
    const u = await taoNguoi('adminkhac', ROLE.ADMIN);
    const kq = await resetUserPasswordAction(null, fd({ userId: u.id }));
    kiem(kq.ok === false, 'bị từ chối');
    console.log(`        thông báo: ${kq.message}`);
    const sau = await prisma.user.findUniqueOrThrow({
      where: { id: u.id },
      select: { passwordHash: true, mustChangePassword: true },
    });
    kiem(sau.passwordHash === 'x'.repeat(60), 'mật khẩu KHÔNG bị đổi');
    kiem(sau.mustChangePassword === false, 'mustChangePassword không bị bật');
  }

  console.log('\n5. Không có quyền `user.reset_password` → ForbiddenError');
  {
    const thuong = await taoNguoi('khongquyen', ROLE.SENIOR_MANAGER);
    const nanNhan = await taoNguoi('nannhan', ROLE.EXECUTION);
    await createSession(thuong.id);

    let daNem = false;
    try {
      await resetUserPasswordAction(null, fd({ userId: nanNhan.id }));
    } catch (e) {
      daNem = e instanceof Error && e.name === 'ForbiddenError';
    }
    kiem(daNem, 'ném ForbiddenError trước khi làm gì');
    const sau = await prisma.user.findUniqueOrThrow({
      where: { id: nanNhan.id },
      select: { passwordHash: true },
    });
    kiem(sau.passwordHash === 'x'.repeat(60), 'mật khẩu không bị đổi');
  }

  console.log('\n6. Người dùng không tồn tại → từ chối gọn');
  {
    await createSession(admin.id);
    const kq = await resetUserPasswordAction(null, fd({ userId: 'khong-ton-tai' }));
    kiem(kq.ok === false, 'bị từ chối');
    kiem(kq.message?.includes('Không tìm thấy') === true, 'nói rõ lý do', kq.message);
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
