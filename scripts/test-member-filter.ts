/**
 * KIỂM THỬ: BỘ LỌC "THÀNH VIÊN" TRÊN DASHBOARD — theo vai trò.
 *
 *   admin           chọn được mọi người; đã chọn nhóm thì chỉ người của nhóm đó
 *   quản lý nhóm    chỉ người trong nhóm mình; ?userId= người nhóm khác bị bỏ qua
 *   người thực thi  ô bị khoá; ?userId= người khác bị bỏ qua
 *
 * Kết xuất trang thật, dò `<option value="<id>">` và các nhãn phạm vi.
 *
 * Dùng: npm run test:member-filter
 */

import { renderToPipeableStream } from 'react-dom/server';
import type { ReactElement } from 'react';
import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { ROLE, USER_STATUS } from '@/lib/enums';
import DashboardPage from '../app/(app)/dashboard/page';

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

async function mo(viewerId: string, q: Record<string, string>): Promise<string> {
  await createSession(viewerId);
  return ketXuat(
    await (DashboardPage as unknown as (p: { searchParams: Promise<Record<string, string>> }) => Promise<ReactElement>)({
      searchParams: Promise.resolve({ period: 'ALL', ...q }),
    }),
  );
}

const coOption = (html: string, id: string) => html.includes(`<option value="${id}"`);

async function main(): Promise<void> {
  const nguoi = (role: string, them: object = {}) =>
    prisma.user.findFirst({
      where: { role: { code: role }, status: USER_STATUS.ACTIVE, teamId: { not: null }, ...them },
      select: { id: true, fullName: true, teamId: true },
    });
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true },
  });
  const ql = await nguoi(ROLE.TEAM_MANAGER);
  if (!ql) throw new Error('can mot quan ly nhom co nhom');
  const coGiaoDich = { OR: [{ brokerAccounts: { some: {} } }, { tradesExecuted: { some: {} } }] };
  const cungNhom = await nguoi(ROLE.EXECUTION, { teamId: ql.teamId, ...coGiaoDich });
  const khacNhom = await prisma.user.findFirst({
    where: { status: USER_STATUS.ACTIVE, teamId: { not: ql.teamId }, ...coGiaoDich },
    select: { id: true, fullName: true, teamId: true },
  });
  if (!cungNhom || !khacNhom) throw new Error('thieu du lieu nen');
  await prisma.user.updateMany({
    where: { id: { in: [admin.id, ql.id, cungNhom.id] } },
    data: { mustChangePassword: false },
  });

  console.log('1. Admin');
  {
    const tatCa = await mo(admin.id, {});
    kiem(tatCa.includes('Thành viên'), 'có ô "Thành viên"');
    kiem(coOption(tatCa, cungNhom.id) && coOption(tatCa, khacNhom.id), 'danh sách có người của mọi nhóm');

    const chon = await mo(admin.id, { userId: cungNhom.id });
    kiem(chon.includes(`đang lọc: ${cungNhom.fullName}`), `lọc được ${cungNhom.fullName}`);
    kiem(chon.includes('Tiền của người này'), 'ô tiền đổi sang "Tiền của người này"');
    kiem(!chon.includes('Vốn &amp; lãi/lỗ theo nhóm'), 'bỏ khối so sánh giữa các nhóm khi lọc một người');

    const loc = await mo(admin.id, { teamId: ql.teamId!, userId: khacNhom.id });
    kiem(!coOption(loc, khacNhom.id), 'đã chọn nhóm: danh sách chỉ người của nhóm đó');
    kiem(!loc.includes(`đang lọc: ${khacNhom.fullName}`) && !loc.includes(`· ${khacNhom.fullName}`),
      'userId ngoài nhóm đã chọn → bỏ qua');
  }

  console.log('\n2. Quản lý nhóm');
  {
    const html = await mo(ql.id, {});
    kiem(coOption(html, cungNhom.id), 'thấy người cùng nhóm trong danh sách');
    kiem(!coOption(html, khacNhom.id), 'KHÔNG thấy người nhóm khác trong danh sách');
    const chon = await mo(ql.id, { userId: cungNhom.id });
    kiem(chon.includes('Tiền của người này'), 'lọc được người cùng nhóm');
    const vuot = await mo(ql.id, { userId: khacNhom.id });
    kiem(!vuot.includes('Tiền của người này') && !vuot.includes(khacNhom.fullName),
      'sửa URL sang người nhóm khác → bị bỏ qua, không lộ tên');
  }

  console.log('\n3. Người thực thi');
  {
    const html = await mo(cungNhom.id, { userId: ql.id });
    kiem(html.includes('Bạn chỉ xem được số liệu của chính mình'), 'ô Thành viên bị khoá');
    kiem(!coOption(html, ql.id), 'danh sách không có người khác');
    kiem(html.includes('phần của bạn'), 'vẫn là phần của chính mình dù URL truyền người khác');
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
