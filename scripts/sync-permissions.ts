/**
 * Đưa quyền MỚI trong code vào database đang chạy — CHỈ THÊM, không xoá gì.
 *
 *   npx tsx scripts/sync-permissions.ts          xem trước, không ghi
 *   npx tsx scripts/sync-permissions.ts --apply  ghi vào database
 *
 * VÌ SAO KHÔNG DÙNG SEED. `prisma/seed.ts` xoá sạch `role_permissions` rồi ghi lại, và
 * còn dựng cả dữ liệu mẫu — không chạy được trên database thật. Script này làm phần
 * nhỏ an toàn:
 *
 *   1. Thêm quyền có trong `PERMISSIONS` mà database chưa có.
 *   2. Thêm liên kết Role → Permission có trong `ROLE_PERMISSIONS` mà database thiếu.
 *   3. Cập nhật tên hiển thị (name / nameVi / description) đã đổi trong code.
 *
 * KHÔNG xoá quyền thừa (việc của `prune-permissions.ts`) và KHÔNG xoá liên kết thừa —
 * chỉ in ra để người chạy biết.
 *
 * Quyền thực tế của người dùng tính từ `ROLE_PERMISSIONS` trong code (xem
 * `resolvePermissions`), nên database thiếu dòng thì quyền vẫn đúng. Nhưng thiếu dòng
 * `permissions` thì admin không cấp riêng được quyền đó cho từng người (override trỏ tới
 * `permissionId`), và trang Ma trận quyền hiển thị sai.
 */

import { PrismaClient } from '@prisma/client';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../src/domain/permissions';
import { AUDIT_ACTION, ENTITY_TYPE } from '../src/lib/enums';

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');

  const coSan = new Map(
    (
      await prisma.permission.findMany({
        select: { id: true, code: true, name: true, nameVi: true, description: true },
      })
    ).map((p) => [p.code, p]),
  );
  const vaiTro = new Map(
    (await prisma.role.findMany({ select: { id: true, code: true } })).map((r) => [r.code, r.id]),
  );
  const lienKet = new Set(
    (await prisma.rolePermission.findMany({ select: { roleId: true, permissionId: true } })).map(
      (l) => `${l.roleId}|${l.permissionId}`,
    ),
  );

  const themQuyen = PERMISSIONS.filter((p) => !coSan.has(p.code));
  const doiTen = PERMISSIONS.filter((p) => {
    const r = coSan.get(p.code);
    return r && (r.name !== p.name || r.nameVi !== p.nameVi || (r.description ?? undefined) !== p.description);
  });

  console.log(`Quyền mới: ${themQuyen.length}`);
  for (const p of themQuyen) console.log(`  + ${p.code.padEnd(28)} ${p.nameVi}`);
  console.log(`Đổi tên hiển thị: ${doiTen.length}`);
  for (const p of doiTen) console.log(`  ~ ${p.code.padEnd(28)} "${coSan.get(p.code)!.nameVi}" -> "${p.nameVi}"`);

  // Liên kết còn thiếu — tính theo code, kể cả cho quyền sắp thêm.
  const thieuLienKet: { roleCode: string; code: string }[] = [];
  for (const [roleCode, codes] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = vaiTro.get(roleCode);
    if (!roleId) continue;
    for (const code of codes) {
      const perm = coSan.get(code);
      if (!perm || !lienKet.has(`${roleId}|${perm.id}`)) thieuLienKet.push({ roleCode, code });
    }
  }
  console.log(`Liên kết Role → Permission còn thiếu: ${thieuLienKet.length}`);
  for (const l of thieuLienKet) console.log(`  + ${l.roleCode.padEnd(16)} ${l.code}`);

  if (themQuyen.length + doiTen.length + thieuLienKet.length === 0) {
    console.log('\nDatabase đã khớp với code.');
    return;
  }
  if (!apply) {
    console.log('\nChạy lại với --apply để ghi.\n');
    return;
  }

  const admin = await prisma.user.findFirst({
    where: { role: { code: 'ADMIN' } },
    select: { id: true, email: true, fullName: true },
  });

  await prisma.$transaction(async (tx) => {
    const ids = new Map([...coSan].map(([code, p]) => [code, p.id]));

    for (const p of themQuyen) {
      const row = await tx.permission.create({ data: p, select: { id: true } });
      ids.set(p.code, row.id);
    }
    for (const p of doiTen) {
      await tx.permission.update({
        where: { code: p.code },
        data: { name: p.name, nameVi: p.nameVi, description: p.description ?? null },
      });
    }
    for (const l of thieuLienKet) {
      await tx.rolePermission.create({
        data: { roleId: vaiTro.get(l.roleCode)!, permissionId: ids.get(l.code)! },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId: admin?.id ?? null,
        actorEmail: admin?.email ?? null,
        actorName: admin?.fullName ?? 'CLI',
        actorRole: 'ADMIN',
        action: AUDIT_ACTION.PERMISSION_CHANGE,
        entityType: ENTITY_TYPE.PERMISSION,
        entityId: null,
        entityLabel: 'Đồng bộ danh mục quyền từ code',
        afterJson: JSON.stringify({
          themQuyen: themQuyen.map((p) => p.code),
          doiTen: doiTen.map((p) => p.code),
          themLienKet: thieuLienKet.map((l) => `${l.roleCode}:${l.code}`),
        }),
        note: 'Chỉ thêm — scripts/sync-permissions.ts',
      },
    });
  });

  console.log('\nĐã ghi và lưu Audit Log.\n');
}

main().finally(() => prisma.$disconnect());
