/**
 * Đổi một tham số cấu hình hệ thống từ dòng lệnh, có ghi Audit Log.
 *
 *   npx tsx scripts/set-setting.ts market_data.stale_after_minutes 120
 *
 * Vì sao cần script này: cấu hình nằm trong bảng `system_settings` chứ không phải
 * trong `.env` — đó là yêu cầu §19 ("các ngưỡng phải cấu hình được") và để Admin
 * đổi được lúc chạy mà không phải deploy lại. Giao diện Settings là Phase 10, nên
 * trong lúc chờ thì đổi qua đây.
 *
 * Mọi lần đổi đều ghi Audit Log kèm Before/After — cấu hình của hệ thống quản lý
 * vốn cũng phải có dấu vết như dữ liệu giao dịch.
 */

import { PrismaClient } from '@prisma/client';
import { AUDIT_ACTION, ENTITY_TYPE } from '../src/lib/enums';

const prisma = new PrismaClient();

async function main() {
  const [key, value] = process.argv.slice(2);

  if (!key) {
    // Không truyền tham số thì liệt kê toàn bộ cấu hình hiện tại.
    const all = await prisma.systemSetting.findMany({
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
      select: { key: true, value: true, valueType: true, group: true, nameVi: true },
    });

    let currentGroup = '';
    for (const s of all) {
      if (s.group !== currentGroup) {
        currentGroup = s.group;
        console.log(`\n[${currentGroup}]`);
      }
      console.log(`  ${s.key.padEnd(42)} ${s.value.padEnd(24)} ${s.nameVi}`);
    }
    console.log('\nĐổi giá trị:  npx tsx scripts/set-setting.ts <key> <giá trị mới>\n');
    return;
  }

  if (value === undefined) {
    console.error('Thiếu giá trị mới.');
    process.exit(1);
  }

  const before = await prisma.systemSetting.findUnique({ where: { key } });
  if (!before) {
    console.error(`Không có tham số "${key}". Chạy không tham số để xem danh sách.`);
    process.exit(1);
  }

  if (before.valueType === 'INT' || before.valueType === 'BIGINT') {
    if (!/^-?\d+$/.test(value)) {
      console.error(`Tham số "${key}" kiểu ${before.valueType}, cần số nguyên.`);
      process.exit(1);
    }
  }
  if (before.valueType === 'BOOL' && !['true', 'false'].includes(value)) {
    console.error(`Tham số "${key}" kiểu BOOL, cần true hoặc false.`);
    process.exit(1);
  }
  if (!before.isEditable) {
    console.error(`Tham số "${key}" không cho sửa.`);
    process.exit(1);
  }

  if (before.value === value) {
    console.log(`${key} đã là "${value}", không có gì thay đổi.`);
    return;
  }

  const admin = await prisma.user.findFirst({
    where: { role: { code: 'ADMIN' } },
    select: { id: true, email: true, fullName: true },
  });

  const after = await prisma.systemSetting.update({
    where: { key },
    data: { value, updatedById: admin?.id ?? null },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: admin?.id ?? null,
      actorEmail: admin?.email ?? null,
      actorName: admin?.fullName ?? 'CLI',
      actorRole: 'ADMIN',
      action: AUDIT_ACTION.UPDATE,
      entityType: ENTITY_TYPE.SETTING,
      entityId: after.id,
      entityLabel: `${key} — ${after.nameVi}`,
      beforeJson: JSON.stringify({ value: before.value }),
      afterJson: JSON.stringify({ value: after.value }),
      changedFieldsJson: JSON.stringify(['value']),
      note: 'Đổi qua scripts/set-setting.ts',
    },
  });

  console.log(`${key}:  ${before.value}  →  ${after.value}`);
  console.log(`(${after.nameVi})`);
  console.log('Đã ghi Audit Log.');
}

main().finally(() => prisma.$disconnect());
