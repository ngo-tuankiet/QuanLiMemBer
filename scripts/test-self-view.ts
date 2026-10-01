/**
 * KIỂM THỬ: MỌI THÀNH VIÊN XEM ĐƯỢC VỊ THẾ & GIAO DỊCH CỦA CHÍNH MÌNH.
 *
 * Lỗi đã xảy ra thật: nút "Xem vị thế & giao dịch của tôi" trên trang Tài khoản dẫn
 * tới `/members/<chính mình>`, và trang đó đòi `user.view` — quyền mà Người thực thi
 * (12 người) và vai trò Thành viên không có. Họ bấm vào trang nói về chính họ và gặp 403.
 *
 * Bài này KẾT XUẤT TRANG THẬT với từng vai trò, không chỉ gọi hàm kiểm quyền: trang có
 * thể qua được cổng rồi vẫn ném lỗi ở giữa, và người dùng thấy lỗi đó y như 403.
 *
 * Canh cả chiều ngược lại: nới cho "chính mình" không được thành nới cho "người khác".
 *
 * Chạy trên BẢN SAO database.
 *
 * Dùng: npm run test:self-view
 */

import { renderToPipeableStream } from 'react-dom/server';
import type { ReactElement } from 'react';
import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { ROLE, USER_STATUS } from '@/lib/enums';
import MemberPage from '../app/(app)/members/[id]/page';

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

function ketXuat(el: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const phan: Buffer[] = [];
    let xong = false;
    const { pipe } = renderToPipeableStream(el, {
      onAllReady() {
        pipe({
          write(c: unknown) {
            phan.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
            return true;
          },
          end() {
            if (!xong) {
              xong = true;
              resolve(Buffer.concat(phan).toString('utf8'));
            }
          },
          on() {}, once() {}, emit() {}, removeListener() {},
        } as never);
      },
      onError(e: unknown) {
        if (!xong) {
          xong = true;
          reject(e);
        }
      },
    });
  });
}

type TrangThanhVien = (p: { params: Promise<{ id: string }> }) => Promise<ReactElement>;

/** Mở `/members/<id>` với phiên của `viewerId`. Trả 'FORBIDDEN' hoặc HTML. */
async function mo(viewerId: string, id: string): Promise<string> {
  await createSession(viewerId);
  try {
    const el = await (MemberPage as unknown as TrangThanhVien)({ params: Promise.resolve({ id }) });
    return await ketXuat(el);
  } catch (e) {
    if (e instanceof Error && e.name === 'ForbiddenPageError') return 'FORBIDDEN';
    throw e;
  }
}

async function main(): Promise<void> {
  const nguoi = (role: string) =>
    prisma.user.findFirst({
      where: { role: { code: role }, status: USER_STATUS.ACTIVE, teamId: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, fullName: true, teamId: true },
    });

  const thucThi = await nguoi(ROLE.EXECUTION);
  const quanLy = await nguoi(ROLE.TEAM_MANAGER);
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  if (!thucThi || !quanLy) throw new Error('can it nhat mot nguoi thuc thi va mot quan ly nhom co nhom');

  // Người mở trang không bị ép đổi mật khẩu — guard sẽ đá về trang đổi mật khẩu trước.
  await prisma.user.updateMany({
    where: { id: { in: [thucThi.id, quanLy.id, admin.id] } },
    data: { mustChangePassword: false },
  });

  // Vai trò Thành viên: dữ liệu thật chưa có ai, nên dựng một người.
  const vaiTroTV = await prisma.role.findFirstOrThrow({ where: { code: ROLE.MEMBER }, select: { id: true } });
  const thanhVien = await prisma.user.create({
    data: {
      email: `self-view-${process.pid}@example.com`,
      passwordHash: 'x',
      fullName: `Thanh vien ${process.pid}`,
      status: USER_STATUS.ACTIVE,
      roleId: vaiTroTV.id,
      teamId: thucThi.teamId,
    },
    select: { id: true, fullName: true },
  });

  const cungNhom = await prisma.user.findFirst({
    where: { teamId: thucThi.teamId, id: { notIn: [thucThi.id, thanhVien.id] }, status: USER_STATUS.ACTIVE },
    select: { id: true, fullName: true },
  });
  const khacNhom = await prisma.user.findFirst({
    where: { teamId: { not: quanLy.teamId }, status: USER_STATUS.ACTIVE },
    select: { id: true, fullName: true },
  });

  console.log('\n1. Xem CHÍNH MÌNH — mọi vai trò');
  {
    const a = await mo(thucThi.id, thucThi.id);
    kiem(a !== 'FORBIDDEN', `người thực thi (${thucThi.fullName}) mở được trang của mình`);
    kiem(a.includes(thucThi.fullName), 'trang kết xuất đầy đủ, có tên người đó');

    const b = await mo(thanhVien.id, thanhVien.id);
    kiem(b !== 'FORBIDDEN', 'vai trò Thành viên mở được trang của mình');
    kiem(b.includes(thanhVien.fullName), 'trang kết xuất đầy đủ');

    const c = await mo(quanLy.id, quanLy.id);
    kiem(c !== 'FORBIDDEN', 'quản lý nhóm mở được trang của mình');
  }

  console.log('\n2. Xem NGƯỜI KHÁC — không được nới theo');
  {
    if (cungNhom) {
      kiem(
        (await mo(thucThi.id, cungNhom.id)) === 'FORBIDDEN',
        'người thực thi KHÔNG mở được trang của người cùng nhóm (không có user.view)',
      );
      kiem(
        (await mo(thanhVien.id, cungNhom.id)) === 'FORBIDDEN',
        'vai trò Thành viên KHÔNG mở được trang người khác',
      );
    }
    const cungNhomQL = await prisma.user.findFirst({
      where: { teamId: quanLy.teamId, id: { not: quanLy.id }, status: USER_STATUS.ACTIVE },
      select: { id: true },
    });
    if (cungNhomQL) {
      kiem((await mo(quanLy.id, cungNhomQL.id)) !== 'FORBIDDEN', 'quản lý nhóm vẫn xem được người cùng nhóm');
    }
    if (khacNhom) {
      kiem((await mo(quanLy.id, khacNhom.id)) === 'FORBIDDEN', 'quản lý nhóm vẫn KHÔNG xem được người nhóm khác');
    }
    kiem((await mo(admin.id, thucThi.id)) !== 'FORBIDDEN', 'admin xem được mọi người');
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
