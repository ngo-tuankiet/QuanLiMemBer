import { Fragment } from 'react';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, PageHeader } from '@/components/ui';
import { PERMISSIONS, ROLE_PERMISSIONS } from '@/domain/permissions';
import { ROLE_LABEL_VI, type RoleCode } from '@/lib/enums';

export const metadata: Metadata = { title: 'Ma trận quyền' };

/**
 * Ma trận Role × Permission (§3).
 *
 * Nguồn dữ liệu là `ROLE_PERMISSIONS` trong src/domain/permissions.ts — tức là
 * CODE, không phải database. Bảng `role_permissions` được seed ghi lại từ chính
 * bản đồ đó, nên trang này hiển thị đúng những gì đang có hiệu lực.
 *
 * Trang chỉ đọc. Muốn đổi quyền của một vai trò thì sửa code rồi chạy lại seed —
 * cách này giữ được lịch sử thay đổi trong git. Muốn ngoại lệ cho một người thì
 * dùng override ở trang chi tiết người dùng.
 */
export default async function PermissionMatrixPage() {
  await requirePagePermission('permission.view');

  const roles = await prisma.role.findMany({
    where: { isActive: true },
    orderBy: { level: 'desc' },
    select: { code: true, level: true, _count: { select: { users: true } } },
  });

  // Đếm số override đang tồn tại, để biết có ngoại lệ nào ngoài ma trận không.
  const overrides = await prisma.userPermission.groupBy({
    by: ['effect'],
    _count: true,
  });

  const modules = [...new Set(PERMISSIONS.map((p) => p.module))];

  return (
    <>
      <PageHeader
        title="Ma trận quyền"
        subtitle={`${PERMISSIONS.length} quyền × ${roles.length} vai trò · nguồn sự thật là src/domain/permissions.ts`}
      />

      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        {overrides.map((o) => (
          <span
            key={o.effect}
            className={`rounded-lg border px-2.5 py-1.5 ${
              o.effect === 'GRANT'
                ? 'border-up-500/30 bg-up-500/5 text-up-500'
                : 'border-down-500/30 bg-down-500/5 text-down-500'
            }`}
          >
            {o._count} override {o.effect} đang áp dụng cho người dùng cụ thể
          </span>
        ))}
        {overrides.length === 0 ? (
          <span className="rounded-lg border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-slate-muted">
            Không có override nào — mọi người đang dùng đúng quyền của vai trò.
          </span>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-ink-900">
              <tr className="border-b border-ink-700 text-left text-xs">
                <th className="px-4 py-3 font-medium text-slate-muted">Quyền</th>
                {roles.map((role) => (
                  <th key={role.code} className="px-3 py-3 text-center font-medium">
                    <span className="block text-strong">
                      {ROLE_LABEL_VI[role.code as RoleCode] ?? role.code}
                    </span>
                    <span className="mt-0.5 block font-mono text-micro text-slate-muted">
                      {role.code}
                    </span>
                    <span className="mt-0.5 block text-micro text-ink-500">
                      {role._count.users} người
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {modules.map((module) => {
                const modulePermissions = PERMISSIONS.filter((p) => p.module === module);
                return (
                  <Fragment key={module}>
                    <tr className="bg-ink-850">
                      <td
                        colSpan={roles.length + 1}
                        className="px-4 py-1.5 font-mono text-tiny font-medium text-accent-400"
                      >
                        {module}
                      </td>
                    </tr>

                    {modulePermissions.map((permission) => (
                      <tr
                        key={permission.code}
                        className="border-b border-ink-800 last:border-0 hover:bg-ink-850/50"
                      >
                        <td className="px-4 py-2">
                          <span className="font-mono text-tiny text-slate-soft">
                            {permission.action}
                          </span>
                          <span className="ml-2 text-xs text-slate-muted">
                            {permission.nameVi}
                          </span>
                        </td>

                        {roles.map((role) => {
                          const has = (
                            ROLE_PERMISSIONS[role.code as RoleCode] ?? []
                          ).includes(permission.code);
                          return (
                            <td key={role.code} className="px-3 py-2 text-center">
                              {has ? (
                                <span className="text-up-500" title="Có quyền">
                                  ●
                                </span>
                              ) : (
                                <span className="text-ink-700" title="Không có quyền">
                                  ○
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-4 max-w-2xl text-xs leading-relaxed text-slate-muted">
        Bảng này chỉ đọc. Quyền của một vai trò được định nghĩa trong code
        (<span className="font-mono">src/domain/permissions.ts</span>) rồi seed ghi vào database —
        nhờ vậy mọi thay đổi phân quyền đều có lịch sử trong git. Ngoại lệ cho từng người được xử lý
        bằng override ở trang chi tiết người dùng, và mọi lần điều chỉnh đều ghi Audit Log.
      </p>
    </>
  );
}
