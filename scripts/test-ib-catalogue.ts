/**
 * KIỂM THỬ DANH MỤC IB — quản trị khai, người dùng chỉ được chọn.
 *
 * Điều cần chứng minh KHÔNG phải là "form có ô select". Form chỉ là giao diện; `ibId`
 * đi lên server trong một `FormData` và ai cũng gửi tay được. Cái phải chứng minh là
 * SERVER từ chối mọi giá trị không nằm trong danh mục — kể cả khi giao diện bị bỏ qua
 * hoàn toàn.
 *
 * Chạy trên BẢN SAO database: `npm run test:ib-catalogue`.
 */

import { prisma } from '../src/lib/prisma';
import { createBrokerAccountAction } from '../src/accounts/actions';
import { saveIbAction, toggleIbAction } from '../src/admin/ib-actions';
import { createSession } from '../src/auth/session';
import { BROKER } from '../src/lib/enums';

let pass = 0;
let fail = 0;

function kiem(dieuKien: boolean, nhan: string, chiTiet = ''): void {
  if (dieuKien) pass += 1;
  else fail += 1;
  console.log(`  ${dieuKien ? 'OK  ' : 'LỖI '} ${nhan}${chiTiet ? '  — ' + chiTiet : ''}`);
}

function fd(cap: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(cap)) f.append(k, v);
  return f;
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirst({
    where: { role: { code: 'ADMIN' } },
    select: { id: true, email: true },
  });
  if (!admin) throw new Error('Không tìm thấy tài khoản ADMIN trong bản sao.');

  /*
   * GỠ CỜ ĐỔI MẬT KHẨU TRƯỚC KHI TẠO PHIÊN.
   *
   * Trên một database vừa seed, admin mang `mustChangePassword = true`, và mọi
   * server action đều chuyển hướng sang /change-password — bài kiểm chết ngay ở
   * lời gọi đầu tiên với một lỗi NEXT_REDIRECT khó đọc, chứ không phải vì sản phẩm
   * sai. Cùng cách xử lý như test-organization.ts và test-reports.ts.
   *
   * Chạy trên BẢN SAO nên không đụng gì tới mật khẩu thật.
   */
  await prisma.user.update({
    where: { id: admin.id },
    data: { mustChangePassword: false },
  });

  await createSession(admin.id);
  console.log(`\nĐóng vai: ${admin.email}\n`);

  // -------------------------------------------------------------------------
  console.log('A — Quản trị khai danh mục');
  // -------------------------------------------------------------------------
  const r1 = await saveIbAction(null, fd({ code: 'BUI_HAI', name: 'Bùi Hải', sortOrder: '1' }));
  kiem(r1.ok, 'thêm được IB mới', r1.message ?? '');

  const r2 = await saveIbAction(null, fd({ code: 'BUI_HAI', name: 'Bùi Hải hai', sortOrder: '2' }));
  kiem(!r2.ok, 'mã trùng bị từ chối', r2.fieldErrors?.code?.join(' ') ?? '');

  const r3 = await saveIbAction(null, fd({ code: 'x', name: 'Tên hợp lệ', sortOrder: '0' }));
  kiem(!r3.ok, 'mã sai định dạng bị từ chối', r3.fieldErrors?.code?.join(' ') ?? '');

  await saveIbAction(null, fd({ code: 'NGUYEN_MINH', name: 'Nguyễn Minh', sortOrder: '2' }));

  const ibBuiHai = await prisma.introducingBroker.findUniqueOrThrow({ where: { code: 'BUI_HAI' } });
  const ibNguyenMinh = await prisma.introducingBroker.findUniqueOrThrow({
    where: { code: 'NGUYEN_MINH' },
  });

  // -------------------------------------------------------------------------
  console.log('\nB — Khai tài khoản: chỉ IB trong danh mục mới qua');
  // -------------------------------------------------------------------------
  const chung = { broker: BROKER.SSI, note: '' };

  const tkHopLe = await createBrokerAccountAction(
    null,
    fd({ ...chung, accountNo: 'TEST0001', ibId: ibBuiHai.id }),
  );
  kiem(tkHopLe.ok, 'khai được tài khoản với IB có trong danh mục', tkHopLe.message ?? '');

  /*
   * Đây là phép kiểm quan trọng nhất của file: bỏ qua giao diện, gửi thẳng một `ibId`
   * bịa. Nếu chốt chỉ nằm ở ô select thì dòng này sẽ LỌT.
   */
  const tkBia = await createBrokerAccountAction(
    null,
    fd({ ...chung, accountNo: 'TEST0002', ibId: 'cmbiadatkhongcothat0000' }),
  );
  kiem(!tkBia.ok, 'ibId bịa bị từ chối', tkBia.fieldErrors?.ibId?.join(' ') ?? '');

  const tkTrucTiep = await createBrokerAccountAction(
    null,
    fd({ ...chung, accountNo: 'TEST0003', ibId: '' }),
  );
  kiem(tkTrucTiep.ok, 'bỏ trống = mở trực tiếp, vẫn hợp lệ', tkTrucTiep.message ?? '');

  // -------------------------------------------------------------------------
  console.log('\nC — IB ngừng dùng');
  // -------------------------------------------------------------------------
  const tat = await toggleIbAction(null, fd({ id: ibNguyenMinh.id }));
  kiem(tat.ok, 'tắt được IB', tat.message ?? '');

  const tkIbTat = await createBrokerAccountAction(
    null,
    fd({ ...chung, accountNo: 'TEST0004', ibId: ibNguyenMinh.id }),
  );
  kiem(!tkIbTat.ok, 'IB đã tắt không khai mới được', tkIbTat.fieldErrors?.ibId?.join(' ') ?? '');

  const conNguyen = await prisma.brokerAccount.count({ where: { ibId: ibBuiHai.id } });
  kiem(conNguyen === 1, 'tài khoản đã gắn IB vẫn còn nguyên sau khi tắt IB khác');

  // -------------------------------------------------------------------------
  console.log('\nD — Đổi tên IB thì mọi chỗ đổi theo, không còn bản sao tên');
  // -------------------------------------------------------------------------
  await saveIbAction(null, fd({ id: ibBuiHai.id, code: 'BUI_HAI', name: 'Bùi Hải (VPS)', sortOrder: '1' }));

  const tk = await prisma.brokerAccount.findFirst({
    where: { accountNo: 'TEST0001' },
    select: { ib: { select: { name: true } } },
  });
  kiem(tk?.ib?.name === 'Bùi Hải (VPS)', 'tài khoản đọc ra tên MỚI', tk?.ib?.name ?? '(không có)');

  /*
   * Không cột nào trong `broker_accounts` còn giữ chuỗi tên IB — nếu có, đổi tên sẽ
   * để lại tên cũ nằm đâu đó và hai nơi lệch nhau. Hỏi thẳng lược đồ SQLite.
   */
  const cot = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM pragma_table_info('broker_accounts')",
  );
  const tenCot = cot.map((c) => c.name);
  kiem(!tenCot.includes('ibName'), 'không còn cột ibName trong broker_accounts', tenCot.join(', '));

  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(76));
  console.log(` KẾT QUẢ: ${pass} đạt · ${fail} sai`);
  console.log('='.repeat(76) + '\n');

  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

void main();
