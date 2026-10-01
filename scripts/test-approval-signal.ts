/**
 * NGƯỜI DUYỆT CÓ ĐƯỢC BÁO LÀ CÓ VIỆC KHÔNG?
 *
 * Lỗi đã đo được: một yêu cầu rút vốn 281.907.769 ₫ nằm đúng chỗ, đúng người, nhưng
 * KHÔNG chỗ nào báo. Huy hiệu trên menu chỉ cấp cho `/risk`; thẻ "việc cần làm" trên
 * Dashboard chỉ đếm LỆNH và TÀI KHOẢN NGƯỜI DÙNG chờ duyệt, không đếm rút vốn. Người
 * duyệt chỉ biết nếu tự nhớ mà bấm vào Approvals.
 *
 * Bài này KẾT XUẤT THẬT dưới HAI danh nghĩa khác nhau, vì con số phụ thuộc người xem:
 * người duyệt phải thấy, còn chính người gửi thì không được thấy (chốt bốn mắt) — nếu
 * cả hai cùng thấy hoặc cùng không thấy thì phép kiểm không phân biệt được gì.
 *
 * Chạy trên BẢN SAO: npm run test:approval-signal
 */

import { renderToPipeableStream } from 'react-dom/server';
import type { ReactElement } from 'react';
import bcrypt from 'bcryptjs';

import { prisma } from '@/lib/prisma';
import { createSession } from '@/auth/session';
import { getCurrentUser } from '@/auth/guards';
import { countPendingForUser } from '@/approvals/queue';
import { ROLE, USER_STATUS, CAPITAL_FLOW_TYPE, CAPITAL_FLOW_STATUS } from '@/lib/enums';
import DashboardPage from '../app/(app)/dashboard/page';
import ProfilePage from '../app/(app)/profile/page';

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

type TrangCoQuery = (p: {
  searchParams: Promise<Record<string, string | undefined>>;
}) => Promise<ReactElement>;

/*
 * KẾT XUẤT THEO LUỒNG, không dùng `renderToStaticMarkup`.
 *
 * Trang Profile có ranh giới Suspense; bản đồng bộ ném "A component suspended while
 * responding to synchronous input" thay vì trả HTML. `onAllReady` đợi mọi ranh giới
 * xong rồi mới gom — đúng thứ cần khi muốn đọc HTML hoàn chỉnh.
 */
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

async function xemDashboard(userId: string): Promise<string> {
  await createSession(userId);
  const el = await (DashboardPage as unknown as TrangCoQuery)({
    searchParams: Promise.resolve({}),
  });
  return ketXuat(el);
}

async function xemProfile(userId: string): Promise<string> {
  await createSession(userId);
  const el = await (ProfilePage as unknown as () => Promise<ReactElement>)();
  return ketXuat(el);
}

async function demCho(userId: string) {
  await createSession(userId);
  const u = await getCurrentUser();
  if (!u) throw new Error('không dựng được phiên');
  return countPendingForUser(u);
}

async function main(): Promise<void> {
  const portfolio = await prisma.portfolio.findFirstOrThrow({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });
  const nhom = await prisma.team.findFirstOrThrow({ select: { id: true, nameVi: true } });

  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN } },
    select: { id: true, fullName: true },
  });
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });

  // Người gửi: trưởng nhóm, có capital.approve nhưng bị bốn mắt chặn với chính mình.
  const role = await prisma.role.findUniqueOrThrow({ where: { code: ROLE.TEAM_MANAGER } });
  const dept = await prisma.department.findFirstOrThrow({ select: { id: true } });
  const gui = await prisma.user.upsert({
    where: { email: 'nguoigui@test.local' },
    update: { roleId: role.id, teamId: nhom.id },
    create: {
      email: 'nguoigui@test.local',
      fullName: 'Người Gửi Yêu Cầu',
      passwordHash: await bcrypt.hash('KhongDung@2026', 10),
      status: USER_STATUS.ACTIVE,
      roleId: role.id,
      departmentId: dept.id,
      teamId: nhom.id,
      approvedAt: new Date(),
      mustChangePassword: false,
    },
    select: { id: true },
  });

  const acc = await prisma.brokerAccount.create({
    data: { userId: gui.id, broker: 'VPS', accountNo: 'SIGNAL01' },
    select: { id: true },
  });
  const soTien = 281_907_769n;
  await prisma.capitalFlow.create({
    data: {
      portfolioId: portfolio.id,
      brokerAccountId: acc.id,
      flowType: CAPITAL_FLOW_TYPE.CONTRIBUTION,
      status: CAPITAL_FLOW_STATUS.CONFIRMED,
      amount: soTien,
      occurredAt: new Date(),
      createdById: gui.id,
      teamId: nhom.id,
    },
  });
  await prisma.capitalFlow.create({
    data: {
      portfolioId: portfolio.id,
      brokerAccountId: acc.id,
      flowType: CAPITAL_FLOW_TYPE.WITHDRAWAL,
      status: CAPITAL_FLOW_STATUS.PENDING,
      amount: soTien,
      occurredAt: new Date(),
      createdById: gui.id,
      teamId: nhom.id,
    },
  });

  console.log('\nA — Con số trên huy hiệu, theo từng người\n');

  const choAdmin = await demCho(admin.id);
  const choGui = await demCho(gui.id);
  console.log(
    `  ${(admin.fullName ?? 'admin').padEnd(24)} duyệt được=${choAdmin.total} ` +
      `(rút ${choAdmin.withdrawals}) · bị bốn mắt chặn=${choAdmin.blockedByFourEyes}`,
  );
  console.log(
    `  ${'Người Gửi Yêu Cầu'.padEnd(24)} duyệt được=${choGui.total} ` +
      `(rút ${choGui.withdrawals}) · bị bốn mắt chặn=${choGui.blockedByFourEyes}`,
  );

  kiem(choAdmin.withdrawals === 1, 'người duyệt: đếm được yêu cầu rút', `= ${choAdmin.withdrawals}`);
  kiem(
    choGui.total === 0 && choGui.blockedByFourEyes === 1,
    'người GỬI: không đếm việc của chính mình, nhưng biết nó tồn tại',
    `total=${choGui.total} chan=${choGui.blockedByFourEyes}`,
  );

  console.log('\nB — Thẻ "việc cần làm" trên Dashboard\n');

  const dbAdmin = await xemDashboard(admin.id);
  kiem(dbAdmin.includes('yêu cầu rút vốn'), 'người duyệt THẤY thẻ nhắc việc trên Dashboard');
  kiem(
    /1 yêu cầu rút vốn[\s\S]{0,80}đang chờ duyệt/.test(dbAdmin),
    'thẻ nói đúng LOẠI việc và số lượng',
    'không thấy câu “1 yêu cầu rút vốn … đang chờ duyệt”',
  );

  const dbGui = await xemDashboard(gui.id);
  kiem(
    !dbGui.includes('yêu cầu rút vốn đang chờ duyệt'),
    'người GỬI không bị nhắc một việc mình không làm được',
  );

  console.log('\nC — Thẻ tài khoản của người gửi: chờ AI\n');

  const pfGui = await xemProfile(gui.id);
  kiem(pfGui.includes('chờ duyệt rút'), 'vẫn hiện "chờ duyệt rút"');
  kiem(
    pfGui.includes(admin.fullName ?? 'System Administrator'),
    'nói rõ đang chờ AI duyệt',
    'không thấy tên người duyệt',
  );

  /*
   * Trường hợp RỖNG — quan trọng nhất. Hạ quyền của admin xuống để không còn ai
   * duyệt được, rồi xem thẻ có nói ra không. Không có bước này thì phép kiểm trên
   * chỉ chứng minh "có tên thì hiện tên", chưa chứng minh được nó phát hiện ra sự im
   * lặng — mà im lặng mới là lỗi ban đầu.
   */
  const quyenDuyet = await prisma.permission.findUniqueOrThrow({
    where: { code: 'capital.approve' },
    select: { id: true },
  });

  /*
   * CHẶN MỌI NGƯỜI, không chỉ admin.
   *
   * Bản đầu của bài kiểm này chỉ chặn admin rồi khẳng định "không ai duyệt được" —
   * và nó TRƯỢT, vì database còn một trưởng nhóm khác cùng nhóm với yêu cầu, vẫn
   * duyệt được. Bài kiểm khi ấy đang mô tả một tình huống nó chưa thật sự dựng ra.
   */
  const conAi = await prisma.user.findMany({
    where: { status: 'ACTIVE', id: { not: gui.id } },
    select: { id: true },
  });
  for (const u of conAi) {
    await prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: u.id, permissionId: quyenDuyet.id } },
      update: { effect: 'DENY' },
      create: { userId: u.id, permissionId: quyenDuyet.id, effect: 'DENY' },
    });
  }

  const pfRong = await xemProfile(gui.id);
  kiem(
    pfRong.includes('chưa ai duyệt được'),
    'KHÔNG AI duyệt được thì thẻ nói thẳng ra',
    'thẻ vẫn im lặng — đúng lỗi ban đầu',
  );

  console.log('\n' + '='.repeat(76));
  console.log(` KẾT QUẢ: ${dat} đạt · ${truot} sai`);
  console.log('='.repeat(76) + '\n');

  await prisma.$disconnect();
  process.exit(truot === 0 ? 0 : 1);
}

void main();
