/**
 * GẮN LỆNH MUA 10.000 MBB CỦA ADMIN VÀO TÀI KHOẢN SSI · 12345.
 *
 * VÌ SAO CẦN. Lệnh mua này là dữ liệu mồi, không gắn tài khoản nào. Lệnh bán 5.000 MBB
 * sau đó lại ghi vào SSI · 12345, nên khi tính vị thế theo tài khoản thì SSI âm 5.000
 * MBB — bán thứ tài khoản đó chưa từng giữ. Người dùng xác nhận lô 10.000 MBB đó thuộc
 * SSI · 12345, nên gắn nó về đúng chỗ: SSI thành +10.000 − 5.000 = 5.000 MBB.
 *
 * PHẠM VI HẸP LẠI ĐÚNG MỘT LỆNH. 14 lệnh cũ khác cũng không gắn tài khoản nhưng người
 * dùng quyết định để nguyên — chỉ chủ tài khoản biết cổ phiếu của mình nằm ở đâu, và
 * đoán hộ là ghi sai lịch sử giao dịch. Script này vì thế:
 *
 *   - chỉ tìm lệnh BUY MBB của admin đang KHÔNG gắn tài khoản
 *   - dừng nếu tìm thấy không đúng một lệnh
 *   - in vị thế trước và sau để đối chiếu
 *
 * Dùng: npm run fix:mbb-account   (sao lưu prisma/dev.db trước)
 */

import { prisma } from '@/lib/prisma';
import { ROLE, USER_STATUS, TRANSACTION_TYPE } from '@/lib/enums';

const BROKER_CAN_GAN = 'SSI';
const SO_TK_CAN_GAN = '12345';
const MA = 'MBB';

/** Vị thế MA theo từng tài khoản của một người, kể cả nhóm chưa gắn tài khoản. */
async function viThe(userId: string): Promise<Map<string, number>> {
  const lenh = await prisma.trade.findMany({
    where: { userId, status: 'EXECUTED', stock: { symbol: MA } },
    select: { transactionType: true, quantity: true, brokerAccountId: true },
  });

  const ra = new Map<string, number>();
  for (const t of lenh) {
    const k = t.brokerAccountId ?? '(chưa gắn tài khoản)';
    const dau = t.transactionType === TRANSACTION_TYPE.BUY ? 1 : -1;
    ra.set(k, (ra.get(k) ?? 0) + t.quantity * dau);
  }
  return ra;
}

async function main(): Promise<void> {
  const admin = await prisma.user.findFirstOrThrow({
    where: { role: { code: ROLE.ADMIN }, status: USER_STATUS.ACTIVE },
    select: { id: true, fullName: true },
  });

  const tk = await prisma.brokerAccount.findFirstOrThrow({
    where: { userId: admin.id, broker: BROKER_CAN_GAN, accountNo: SO_TK_CAN_GAN },
    select: { id: true, broker: true, accountNo: true },
  });

  const ten = new Map<string, string>([[tk.id, `${tk.broker} ${tk.accountNo}`]]);
  const inRa = (m: Map<string, number>): void => {
    for (const [k, v] of m) console.log(`    ${ten.get(k) ?? k}: ${v.toLocaleString('vi-VN')} ${MA}`);
  };

  console.log(`${admin.fullName} — vị thế ${MA} TRƯỚC:`);
  inRa(await viThe(admin.id));

  const canGan = await prisma.trade.findMany({
    where: {
      userId: admin.id,
      status: 'EXECUTED',
      transactionType: TRANSACTION_TYPE.BUY,
      brokerAccountId: null,
      stock: { symbol: MA },
    },
    select: { id: true, code: true, quantity: true },
  });

  if (canGan.length !== 1) {
    console.error(
      `\nDừng: tìm thấy ${canGan.length} lệnh mua ${MA} chưa gắn tài khoản, cần đúng 1.\n` +
        'Dữ liệu đã khác lúc viết script này — xem lại trước khi sửa.',
    );
    process.exitCode = 1;
    return;
  }

  const lenh = canGan[0]!;
  console.log(
    `\nGắn ${lenh.code} (mua ${lenh.quantity.toLocaleString('vi-VN')} ${MA}) ` +
      `→ ${tk.broker} ${tk.accountNo}`,
  );

  await prisma.trade.update({
    where: { id: lenh.id },
    data: { brokerAccountId: tk.id },
  });

  console.log(`\nVị thế ${MA} SAU:`);
  const sau = await viThe(admin.id);
  inRa(sau);

  const am = [...sau.entries()].filter(([, v]) => v < 0);
  if (am.length > 0) {
    console.error(`\nVẫn còn vị thế âm: ${am.map(([k, v]) => `${ten.get(k) ?? k}=${v}`).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nKhông còn vị thế âm.');
  }
}

main()
  .catch((e) => {
    console.error('LOI:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
