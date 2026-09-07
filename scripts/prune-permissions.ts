/**
 * Xoá các quyền đã bị loại khỏi code.
 *
 *   npx tsx scripts/prune-permissions.ts          xem trước, không xoá
 *   npx tsx scripts/prune-permissions.ts --apply  thực hiện xoá
 *
 * VÌ SAO SEED KHÔNG LÀM ĐƯỢC VIỆC NÀY. `prisma/seed.ts` xoá sạch rồi ghi lại
 * `role_permissions`, nên bản đồ Role → Permission trong code luôn là sự thật.
 * Nhưng bảng `permissions` thì chỉ được upsert: một quyền bị bỏ khỏi
 * `PERMISSIONS` vẫn nằm lại trong database mãi mãi, và vẫn hiện trên trang Ma
 * trận quyền như thể còn tác dụng.
 *
 * Tệ hơn: các override trong `user_permissions` trỏ tới quyền đó cũng sống sót.
 * Admin thấy một dòng GRANT/DENY cho `performance.view` và tin rằng nó đang mở
 * hay chặn thứ gì, trong khi không dòng code nào còn đọc quyền đó. Đây đúng loại
 * bẫy đã gặp với `market_data.sync_interval_seconds` — cấu hình trông như có tác
 * dụng mà thực ra không.
 *
 * Chạy sau khi bỏ một quyền khỏi `PERMISSIONS` trong src/domain/permissions.ts.
 */

import { PrismaClient } from '@prisma/client';
import { ALL_PERMISSION_CODES } from '../src/domain/permissions';
import { AUDIT_ACTION, ENTITY_TYPE } from '../src/lib/enums';

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');
  const known = new Set<string>(ALL_PERMISSION_CODES);

  const orphans = (
    await prisma.permission.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        nameVi: true,
        _count: { select: { rolePermissions: true, userPermissions: true } },
      },
    })
  ).filter((p) => !known.has(p.code));

  if (orphans.length === 0) {
    console.log('Không có quyền mồ côi. Database khớp với code.');
    return;
  }

  console.log(`${orphans.length} quyền không còn trong code:\n`);
  for (const p of orphans) {
    console.log(
      `  ${p.code.padEnd(28)} ${p.nameVi.padEnd(34)} ` +
        `role=${p._count.rolePermissions} user=${p._count.userPermissions}`,
    );
  }

  const overrides = orphans.reduce((s, p) => s + p._count.userPermissions, 0);
  if (overrides > 0) {
    console.log(
      `\n${overrides} override trong user_permissions sẽ mất theo. ` +
        'Chúng đang không có tác dụng gì vì không code nào đọc các quyền này.',
    );
  }

  if (!apply) {
    console.log('\nChạy lại với --apply để xoá.\n');
    return;
  }

  const admin = await prisma.user.findFirst({
    where: { role: { code: 'ADMIN' } },
    select: { id: true, email: true, fullName: true },
  });

  const ids = orphans.map((p) => p.id);

  await prisma.$transaction(async (tx) => {
    for (const p of orphans) {
      await tx.auditLog.create({
        data: {
          actorUserId: admin?.id ?? null,
          actorEmail: admin?.email ?? null,
          actorName: admin?.fullName ?? 'CLI',
          actorRole: 'ADMIN',
          action: AUDIT_ACTION.PERMISSION_CHANGE,
          entityType: ENTITY_TYPE.PERMISSION,
          entityId: p.id,
          entityLabel: `${p.code} · ${p.nameVi}`,
          beforeJson: JSON.stringify({
            code: p.code,
            rolePermissions: p._count.rolePermissions,
            userPermissions: p._count.userPermissions,
          }),
          note: 'Quyền đã bị loại khỏi code — dọn bằng scripts/prune-permissions.ts',
        },
      });
    }

    /*
     * Xoá tường minh các bản ghi phụ thuộc trước.
     *
     * Không dựa vào onDelete của schema: nếu một ngày nào đó quan hệ được đổi
     * sang Restrict thì chỗ này phải nổ ra lỗi, chứ không được xoá một nửa.
     */
    await tx.rolePermission.deleteMany({ where: { permissionId: { in: ids } } });
    await tx.userPermission.deleteMany({ where: { permissionId: { in: ids } } });
    const { count } = await tx.permission.deleteMany({ where: { id: { in: ids } } });

    console.log(`\nĐã xoá ${count} quyền và ghi Audit Log.\n`);
  });
}

main().finally(() => prisma.$disconnect());
