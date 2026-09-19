/**
 * Xoá các tham số cấu hình đã bị loại khỏi code.
 *
 * `prisma/seed.ts` cố tình KHÔNG ghi đè `system_settings.value` để giữ lại cấu hình
 * Admin đã sửa. Mặt trái: một tham số bị bỏ khỏi code vẫn nằm lại trong database
 * mãi mãi, và hiện trên giao diện Settings như thể còn tác dụng.
 *
 * Script này dọn phần dư đó. Chạy sau khi bỏ một tham số khỏi `SETTING_SEED`.
 *
 *   npx tsx scripts/prune-settings.ts          xem trước, không xoá
 *   npx tsx scripts/prune-settings.ts --apply  thực hiện xoá
 */

import { PrismaClient } from '@prisma/client';
import { SETTING_SEED } from '../src/data/master-data';
import { AUDIT_ACTION, ENTITY_TYPE } from '../src/lib/enums';

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');
  const known = new Set(SETTING_SEED.map((s) => s.key));

  const orphans = (
    await prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
      select: { id: true, key: true, value: true, nameVi: true },
    })
  ).filter((s) => !known.has(s.key));

  if (orphans.length === 0) {
    console.log('Không có tham số mồ côi. Database khớp với code.');
    return;
  }

  console.log(`${orphans.length} tham số không còn trong code:\n`);
  for (const s of orphans) {
    console.log(`  ${s.key.padEnd(42)} = ${s.value.padEnd(20)} ${s.nameVi}`);
  }

  if (!apply) {
    console.log('\nChạy lại với --apply để xoá.\n');
    return;
  }

  const admin = await prisma.user.findFirst({
    where: { role: { code: 'ADMIN' } },
    select: { id: true, email: true, fullName: true },
  });

  for (const s of orphans) {
    await prisma.auditLog.create({
      data: {
        actorUserId: admin?.id ?? null,
        actorEmail: admin?.email ?? null,
        actorName: admin?.fullName ?? 'CLI',
        actorRole: 'ADMIN',
        action: AUDIT_ACTION.DELETE,
        entityType: ENTITY_TYPE.SETTING,
        entityId: s.id,
        entityLabel: s.key,
        beforeJson: JSON.stringify({ key: s.key, value: s.value }),
        note: 'Tham số đã bị loại khỏi code — dọn bằng scripts/prune-settings.ts',
      },
    });
  }

  const { count } = await prisma.systemSetting.deleteMany({
    where: { key: { in: orphans.map((s) => s.key) } },
  });

  console.log(`\nĐã xoá ${count} tham số và ghi Audit Log.\n`);
}

main().finally(() => prisma.$disconnect());
