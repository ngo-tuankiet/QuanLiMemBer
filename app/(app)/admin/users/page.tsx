import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader, RoleBadge, StatusBadge } from '@/components/ui';
import { ROLE_LABEL_VI, ROLE_LEVEL, USER_STATUS, type RoleCode } from '@/lib/enums';
import { ApproveForm } from './ApproveForm';
import { StatusToggle } from './StatusToggle';

export const metadata: Metadata = { title: 'Duyệt & Người dùng' };

/**
 * Hàng chờ duyệt và quản lý người dùng (§3, §4).
 *
 * Chú ý phần lọc vai trò: người đang xem chỉ được gán vai trò KHÔNG cao hơn vai
 * trò của chính mình. Điều này được kiểm tra lại ở server action
 * (`assertCanAssignRole`) — lọc ở đây chỉ để giao diện không đưa ra lựa chọn sai.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requirePagePermission('user.approve');
  const params = await searchParams;

  const [pending, others, roles, departments, teams] = await Promise.all([
    prisma.user.findMany({
      where: { status: USER_STATUS.PENDING },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, fullName: true, phone: true, createdAt: true },
    }),
    prisma.user.findMany({
      where: { status: { not: USER_STATUS.PENDING } },
      orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
      include: {
        role: { select: { code: true, level: true } },
        department: { select: { nameVi: true } },
        team: { select: { nameVi: true } },
        // Chỉ đếm phiên CÒN HIỆU LỰC. Nếu đếm cả phiên đã thu hồi/hết hạn thì
        // con số này vô nghĩa và gây hiểu sai là người dùng vẫn đang đăng nhập.
        _count: {
          select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } },
        },
      },
    }),
    prisma.role.findMany({ where: { isActive: true }, orderBy: { level: 'desc' } }),
    prisma.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.team.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ]);

  // Không đưa ra lựa chọn vai trò cao hơn chính mình.
  const assignableRoles = roles
    .filter((r) => ROLE_LEVEL[r.code as RoleCode] <= actor.roleLevel)
    .map((r) => ({ value: r.code, label: `${ROLE_LABEL_VI[r.code as RoleCode] ?? r.code}` }));

  const departmentOptions = departments.map((d) => ({ id: d.id, label: d.nameVi }));
  /*
    `departmentLabel` để form nhóm các nhóm theo phòng ban trong dropdown.

    Nhóm KHÔNG còn bị lọc theo phòng ban đang chọn (xem chú thích trong
    ApproveForm), nên phải thấy được nhóm nào thuộc phòng ban nào — thiếu nhãn
    này thì danh sách chỉ là bốn cái tên rời rạc.
  */
  const teamOptions = teams.map((t) => ({
    id: t.id,
    label: t.nameVi,
    departmentId: t.departmentId,
    departmentLabel:
      departments.find((d) => d.id === t.departmentId)?.nameVi ?? 'Không rõ phòng ban',
  }));

  const showOnlyPending = params.status === USER_STATUS.PENDING;

  return (
    <>
      <PageHeader
        title="Duyệt & Người dùng"
        subtitle={`${pending.length} chờ duyệt · ${others.length} đã xử lý`}
        actions={
          <Link
            href={showOnlyPending ? '/admin/users' : '/admin/users?status=PENDING'}
            className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-slate-soft transition hover:border-ink-500 hover:text-strong"
          >
            {showOnlyPending ? 'Xem tất cả' : 'Chỉ xem hàng chờ'}
          </Link>
        }
      />

      {/* ------------------------------------------------------------------ */}
      {/* Hàng chờ duyệt                                                      */}
      {/* ------------------------------------------------------------------ */}
      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-strong">
          Hàng chờ duyệt
          {pending.length > 0 ? (
            <span className="rounded-full bg-warn-500/15 px-2 py-0.5 text-xs text-warn-500">
              {pending.length}
            </span>
          ) : null}
        </h2>

        {pending.length === 0 ? (
          <Card>
            <EmptyState
              title="Không có tài khoản nào chờ duyệt"
              hint="Tài khoản mới đăng ký sẽ xuất hiện ở đây."
            />
          </Card>
        ) : (
          <div className="space-y-4">
            {pending.map((u) => (
              <Card key={u.id} className="p-5">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-800 pb-3">
                  <div>
                    <p className="font-medium text-strong">{u.fullName}</p>
                    <p className="mt-0.5 text-xs text-slate-muted">
                      {u.email}
                      {u.phone ? ` · ${u.phone}` : ''}
                    </p>
                  </div>
                  <p className="tabular text-xs text-slate-muted">
                    đăng ký {u.createdAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
                  </p>
                </div>

                <ApproveForm
                  userId={u.id}
                  roles={assignableRoles}
                  departments={departmentOptions}
                  teams={teamOptions}
                />
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Người dùng đã xử lý                                                 */}
      {/* ------------------------------------------------------------------ */}
      {!showOnlyPending ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-strong">Người dùng</h2>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-700 text-left text-xs text-slate-muted">
                    <th className="px-4 py-2.5 font-medium">Họ tên</th>
                    <th className="px-4 py-2.5 font-medium">Vai trò</th>
                    <th className="px-4 py-2.5 font-medium">Phòng ban / Nhóm</th>
                    <th className="px-4 py-2.5 font-medium">Phiên</th>
                    <th className="px-4 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-4 py-2.5 text-right font-medium">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {others.map((u) => {
                    // Không cho thao tác lên người có vai trò cao hơn mình.
                    const outranksActor = (u.role?.level ?? 0) > actor.roleLevel;
                    const isSelf = u.id === actor.id;

                    return (
                      <tr
                        key={u.id}
                        className="border-b border-ink-800 last:border-0 hover:bg-ink-850/60"
                      >
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-strong">{u.fullName}</span>
                          {isSelf ? (
                            <span className="ml-2 rounded bg-accent-600/15 px-1.5 py-px text-micro text-accent-400">
                              bạn
                            </span>
                          ) : null}
                          <span className="block text-xs text-slate-muted">{u.email}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <RoleBadge roleCode={u.role?.code ?? null} />
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-muted">
                          {u.department?.nameVi ?? '—'}
                          {u.team ? <span className="block">{u.team.nameVi}</span> : null}
                        </td>
                        <td className="tabular px-4 py-2.5 text-xs text-slate-muted">
                          {u._count.sessions}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={u.status} />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/admin/users/${u.id}`}
                              className="rounded-md border border-ink-600 px-2.5 py-1 text-xs text-slate-soft transition hover:border-ink-500 hover:text-strong"
                            >
                              Chi tiết
                            </Link>
                            {!isSelf && !outranksActor && u.status !== USER_STATUS.REJECTED ? (
                              <StatusToggle userId={u.id} status={u.status} />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      ) : null}
    </>
  );
}
