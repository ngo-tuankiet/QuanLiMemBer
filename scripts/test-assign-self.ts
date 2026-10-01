/**
 * KIỂM: TỰ SỬA TÀI KHOẢN CỦA MÌNH THÌ KHÔNG BỊ ĐÁ RA NGOÀI.
 *
 * LỖI ĐÃ CÓ: `assignUserAction` gọi `revokeAllSessions(userId)` — thu hồi CẢ phiên của
 * chính người đang bấm. Admin đổi nhóm cho bản thân sẽ bị ném ra trang đăng nhập ngay lúc
 * lưu, không kịp thấy thông báo nào. Từ phía họ, việc lưu trông y như thất bại: đó đúng
 * là lỗi người dùng báo lại — "tôi không lưu thay đổi được" — trong khi dữ liệu đã lưu.
 *
 * GIỮ PHIÊN KHÔNG TẠO LỖ HỔNG: `getCurrentUser()` đọc lại vai trò, phòng ban, nhóm và
 * quyền riêng từ database ở MỌI request. Phiên được giữ lập tức chạy theo quyền mới.
 *
 * Kiểm:
 *   1. tự sửa mình → lưu được, dữ liệu đổi, PHIÊN HIỆN TẠI CÒN SỐNG
 *   2. các phiên KHÁC của chính người đó vẫn bị thu hồi
 *   3. sửa người khác → thu hồi TOÀN BỘ phiên của họ (không đổi hành vi cũ)
 *   4. quyền mới có hiệu lực ngay trên phiên được giữ
 *
 * Chạy trên BẢN SAO database. Dùng: npm run test:assign-self
 */

import { prisma } from '@/lib/prisma';
import { createSession, readSession } from '@/auth/session';
import { assignUserAction } from '@/admin/actions';
import { getCurrentUser } from '@/auth/guards';
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

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { email: 'admin@vninvest.local' },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });

  const dept = await prisma.department.findFirstOrThrow({ select: { id: true, nameVi: true } });
  const teams = await prisma.team.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
    select: { id: true, nameVi: true },
  });
  if (teams.length < 2) {
    console.log('  BOQUA: can it nhat 2 nhom de doi qua lai');
    return;
  }

  const f = (userId: string, teamId: string): FormData => {
    const d = new FormData();
    d.set('userId', userId);
    d.set('roleCode', ROLE.ADMIN);
    d.set('departmentId', dept.id);
    d.set('teamId', teamId);
    return d;
  };

  // =========================================================================
  // 1 + 2. Tự sửa mình
  // =========================================================================
  console.log('1. Admin tự đổi nhóm cho chính mình');
  {
    /*
     * Dựng HAI phiên: một phiên "đang dùng" (phiên mới nhất, `readSession` trả về nó) và
     * một phiên cũ đại diện cho thiết bị khác. Không có phiên thứ hai thì phép kiểm "các
     * phiên khác vẫn bị thu hồi" không có gì để chứng minh.
     */
    await prisma.session.deleteMany({ where: { userId: admin.id } });
    await createSession(admin.id); // phiên "thiết bị khác"
    const phienKhac = await prisma.session.findFirstOrThrow({
      where: { userId: admin.id },
      select: { id: true },
    });

    await createSession(admin.id); // phiên đang dùng — cookie trỏ vào cái này
    const dangDung = await readSession();
    kiem(dangDung !== null, 'có phiên đang dùng');
    kiem(
      (await prisma.session.count({ where: { userId: admin.id, revokedAt: null } })) === 2,
      'nền: đúng 2 phiên còn hiệu lực',
    );

    const truocTeam = (
      await prisma.user.findUniqueOrThrow({ where: { id: admin.id }, select: { teamId: true } })
    ).teamId;
    const nhomMoi = teams.find((t) => t.id !== truocTeam) ?? teams[0]!;

    const kq = await assignUserAction(null, f(admin.id, nhomMoi.id));

    kiem(kq.ok === true, `lưu được (đổi sang nhóm ${nhomMoi.nameVi})`, JSON.stringify(kq));

    const sau = await prisma.user.findUniqueOrThrow({
      where: { id: admin.id },
      select: { teamId: true, departmentId: true },
    });
    kiem(sau.teamId === nhomMoi.id, 'nhóm đã đổi trong database');
    kiem(sau.departmentId === dept.id, 'phòng ban đã đổi');

    /*
     * ĐIỀU KIỆN CỐT LÕI: phiên đang dùng còn sống. Trước bản sửa, con số này là 0 và người
     * dùng bị ném ra trang đăng nhập.
     */
    const conSong = await readSession();
    kiem(conSong !== null, 'PHIÊN ĐANG DÙNG CÒN SỐNG — không bị đá ra trang đăng nhập');
    kiem(
      conSong?.sessionId === dangDung?.sessionId,
      'vẫn đúng phiên đó, không phải phiên mới',
    );

    const khacDaThuHoi = await prisma.session.findUniqueOrThrow({
      where: { id: phienKhac.id },
      select: { revokedAt: true },
    });
    kiem(khacDaThuHoi.revokedAt !== null, 'phiên ở thiết bị khác VẪN bị thu hồi');

    kiem(
      (await prisma.session.count({ where: { userId: admin.id, revokedAt: null } })) === 1,
      'còn đúng 1 phiên — phiên đang dùng',
    );
  }

  // =========================================================================
  // 3. Quyền mới có hiệu lực ngay
  // =========================================================================
  console.log('\n2. Quyền đọc lại từ database ở mọi request');
  {
    const u = await getCurrentUser();
    const nhomHienTai = (
      await prisma.user.findUniqueOrThrow({ where: { id: admin.id }, select: { teamId: true } })
    ).teamId;

    kiem(u !== null, 'phiên được giữ vẫn đọc được người dùng');
    kiem(
      u?.teamId === nhomHienTai,
      'getCurrentUser trả về NHÓM MỚI ngay — không cần đăng nhập lại',
      `${u?.teamId} vs ${nhomHienTai}`,
    );
  }

  // =========================================================================
  // 4. Sửa người khác → thu hồi toàn bộ
  // =========================================================================
  console.log('\n3. Sửa người KHÁC → thu hồi toàn bộ phiên của họ');
  {
    const nguoiKhac = await prisma.user.findFirst({
      where: { id: { not: admin.id }, status: USER_STATUS.ACTIVE },
      select: { id: true, fullName: true },
    });

    if (!nguoiKhac) {
      console.log('  BOQUA: chi con tai khoan admin');
    } else {
      await prisma.session.deleteMany({ where: { userId: nguoiKhac.id } });
      await createSession(nguoiKhac.id);
      await createSession(nguoiKhac.id);

      // Quay lại phiên admin để thao tác.
      await createSession(admin.id);

      const truoc = await prisma.session.count({
        where: { userId: nguoiKhac.id, revokedAt: null },
      });
      kiem(truoc === 2, `nền: ${nguoiKhac.fullName} có 2 phiên`);

      const kq = await assignUserAction(null, f(nguoiKhac.id, teams[0]!.id));
      kiem(kq.ok === true, 'lưu được', JSON.stringify(kq));

      kiem(
        (await prisma.session.count({ where: { userId: nguoiKhac.id, revokedAt: null } })) === 0,
        'TOÀN BỘ phiên của người đó bị thu hồi — hành vi cũ giữ nguyên',
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
