import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, PageHeader, RoleBadge, StatusBadge } from '@/components/ui';
import { PERMISSIONS, ROLE_PERMISSIONS, resolvePermissions } from '@/domain/permissions';
import { ROLE_LABEL_VI, ROLE_LEVEL, PERMISSION_EFFECT, type RoleCode } from '@/lib/enums';
import { AssignForm, RevokeSessionsForm } from './AssignForm';
import { PermissionEditor, type PermissionRowData } from './PermissionEditor';
import { DeleteUserForm } from './DeleteUserForm';
import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata: Metadata = { title: 'Chi tiết người dùng' };

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requirePagePermission('user.view');
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      role: { select: { code: true, nameVi: true, level: true } },
      department: { select: { id: true, nameVi: true } },
      team: { select: { id: true, nameVi: true } },
      approvedBy: { select: { fullName: true, email: true } },
      permissions: { include: { permission: { select: { code: true } } } },
      _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } },
    },
  });

  if (!user) notFound();

  const [roles, departments, teams, recentLogs] = await Promise.all([
    prisma.role.findMany({ where: { isActive: true }, orderBy: { level: 'desc' } }),
    prisma.department.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.team.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.auditLog.findMany({
      where: { entityId: id },
      orderBy: { occurredAt: 'desc' },
      take: 12,
      select: { id: true, occurredAt: true, action: true, actorName: true, note: true },
    }),
  ]);

  // Người đang xem không được thao tác lên vai trò cao hơn mình.
  const outranksActor = (user.role?.level ?? 0) > actor.roleLevel;
  const canAssign = actor.permissions.has('user.assign_role') && !outranksActor;
  const canManagePermissions = actor.permissions.has('permission.manage') && !outranksActor;

  // Dựng bảng quyền: theo Role / override / hiệu lực cuối cùng.
  const roleCode = (user.role?.code ?? null) as RoleCode | null;
  const rolePermissions = new Set(roleCode ? ROLE_PERMISSIONS[roleCode] ?? [] : []);
  const overrideByCode = new Map(
    user.permissions.map((p) => [p.permission.code, p.effect as 'GRANT' | 'DENY']),
  );

  const effective = resolvePermissions(
    roleCode,
    user.permissions.map((p) => ({
      permissionCode: p.permission.code,
      effect: p.effect as 'GRANT' | 'DENY',
      expiresAt: p.expiresAt,
    })),
  );

  const permissionRows: PermissionRowData[] = PERMISSIONS.map((p) => ({
    code: p.code,
    module: p.module,
    nameVi: p.nameVi,
    fromRole: rolePermissions.has(p.code),
    override: overrideByCode.get(p.code) ?? null,
    effective: effective.has(p.code),
  }));

  const grantCount = [...overrideByCode.values()].filter((e) => e === PERMISSION_EFFECT.GRANT).length;
  const denyCount = [...overrideByCode.values()].filter((e) => e === PERMISSION_EFFECT.DENY).length;

  return (
    <>
      <div className="mb-4">
        <Link href="/admin/users" className="text-xs text-slate-muted hover:text-slate-soft">
          ← Duyệt &amp; Người dùng
        </Link>
      </div>

      <PageHeader
        title={user.fullName}
        subtitle={user.email}
        actions={
          <>
            <RoleBadge roleCode={user.role?.code ?? null} />
            <StatusBadge status={user.status} />
          </>
        }
      />

      {outranksActor ? (
        <p className="mb-5 rounded-lg border border-warn-500/30 bg-warn-500/5 px-3 py-2.5 text-xs text-warn-500">
          Tài khoản này có vai trò cao hơn bạn ({ROLE_LABEL_VI[user.role!.code as RoleCode]}), nên
          bạn chỉ được xem, không được thay đổi.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* -------------------------------------------------------------- */}
        {/* Cột trái: tổ chức, phiên, nhật ký                              */}
        {/* -------------------------------------------------------------- */}
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-strong">Vai trò &amp; tổ chức</h2>
            <AssignForm
              userId={user.id}
              roles={roles
                .filter((r) => ROLE_LEVEL[r.code as RoleCode] <= actor.roleLevel)
                .map((r) => ({ value: r.code, label: ROLE_LABEL_VI[r.code as RoleCode] ?? r.code }))}
              departments={departments.map((d) => ({ id: d.id, label: d.nameVi }))}
              teams={teams.map((t) => ({
                id: t.id,
                label: t.nameVi,
                departmentId: t.departmentId,
                departmentLabel:
                  departments.find((d) => d.id === t.departmentId)?.nameVi ??
                  'Không rõ phòng ban',
              }))}
              current={{
                roleCode: user.role?.code ?? null,
                departmentId: user.departmentId,
                teamId: user.teamId,
              }}
              disabled={!canAssign}
              laChinhMinh={user.id === actor.id}
            />
          </Card>

          {/*
            ĐẶT LẠI MẬT KHẨU — đường phục hồi duy nhất khi người dùng quên.

            Đặt NGAY TRÊN khối "Phiên đăng nhập" vì hai thứ đi liền nhau: đặt lại mật
            khẩu cũng thu hồi mọi phiên, nên người quản trị thấy được hệ quả ngay dưới
            chỗ vừa bấm.

            Không hiện với chính mình: đổi mật khẩu của mình đi qua /change-password,
            nơi phải nhập mật khẩu hiện tại. Cho phép ở đây sẽ tạo một đường đổi mật
            khẩu KHÔNG cần biết mật khẩu cũ — ai chiếm được phiên của một quản trị viên
            sẽ chiếm hẳn tài khoản. Server cũng chặn, đây chỉ là lớp giao diện.
          */}
          {actor.permissions.has('user.reset_password') && user.id !== actor.id ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-strong">Mật khẩu</h2>
              <p className="mt-0.5 mb-3 text-xs text-slate-muted">
                Hệ thống không gửi email, nên không có luồng “quên mật khẩu” tự phục vụ.
                Người dùng quên mật khẩu thì bạn sinh mật khẩu tạm ở đây rồi đọc lại cho
                họ.
              </p>
              <ResetPasswordForm userId={user.id} fullName={user.fullName} />
            </Card>
          ) : null}

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-strong">Phiên đăng nhập</h2>
            <p className="mb-3 text-xs text-slate-muted">
              {user._count.sessions} phiên đang hoạt động. Thu hồi có hiệu lực ngay lập tức vì phiên
              được lưu trong database.
            </p>
            <RevokeSessionsForm
              userId={user.id}
              sessionCount={user._count.sessions}
              disabled={outranksActor || !actor.permissions.has('user.update')}
            />
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-strong">Hồ sơ</h2>
            <dl className="mt-3 space-y-2 text-xs">
              <Row label="Mã nhân viên" value={user.employeeCode ?? '—'} />
              <Row label="Số điện thoại" value={user.phone ?? '—'} />
              <Row label="Ngày đăng ký" value={user.createdAt.toLocaleDateString('vi-VN')} />
              <Row
                label="Người duyệt"
                value={user.approvedBy ? user.approvedBy.fullName : '—'}
              />
              <Row
                label="Đăng nhập cuối"
                value={user.lastLoginAt ? user.lastLoginAt.toLocaleString('vi-VN') : 'chưa từng'}
              />
              <Row
                label="Buộc đổi mật khẩu"
                value={user.mustChangePassword ? 'có' : 'không'}
              />
              {user.rejectedReason ? (
                <Row label="Lý do từ chối" value={user.rejectedReason} />
              ) : null}
            </dl>
          </Card>

          {/*
            VÙNG NGUY HIỂM — đặt CUỐI cột trái, sau mọi thông tin.

            Người mở trang này thường để xem hoặc gán quyền. Đặt nút xoá ở trên đầu
            sẽ khiến nó nằm trong đường mắt của mọi lần vào trang. Ở đây, muốn thấy
            nó phải cuộn xuống — và lúc đó là đã có ý định.

            Không hiện với chính mình: server cũng chặn, nhưng hiện ra một nút chắc
            chắn báo lỗi là một lời hứa suông.
          */}
          {actor.permissions.has('user.delete') && user.id !== actor.id ? (
            <Card className="border-down-500/25 p-5">
              <h2 className="text-sm font-semibold text-down-500">Vùng nguy hiểm</h2>
              <p className="mt-0.5 mb-3 text-xs text-slate-muted">
                Với người đã nghỉ việc, dùng <span className="text-slate-soft">Khoá</span> —
                nó thu hồi mọi phiên đăng nhập ngay và giữ nguyên lịch sử. Xoá chỉ dành cho
                tài khoản tạo sai, chưa phát sinh gì.
              </p>
              <DeleteUserForm
                userId={user.id}
                email={user.email}
                fullName={user.fullName}
              />
            </Card>
          ) : null}

          {actor.permissions.has('audit.view') && recentLogs.length > 0 ? (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-strong">Nhật ký gần đây</h2>
              <ul className="space-y-2">
                {recentLogs.map((log) => (
                  <li key={log.id} className="text-xs">
                    <div className="flex items-baseline gap-2">
                      <span className="tabular shrink-0 text-slate-muted">
                        {log.occurredAt.toLocaleString('vi-VN', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="font-mono text-micro text-accent-400">{log.action}</span>
                      <span className="text-slate-soft">{log.actorName ?? '—'}</span>
                    </div>
                    {log.note ? <p className="mt-0.5 text-ink-500">{log.note}</p> : null}
                  </li>
                ))}
              </ul>
              <Link
                href="/audit"
                className="mt-3 inline-block text-xs text-accent-400 hover:text-accent-500"
              >
                Xem toàn bộ Audit Log →
              </Link>
            </Card>
          ) : null}
        </div>

        {/* -------------------------------------------------------------- */}
        {/* Cột phải: ma trận quyền                                        */}
        {/* -------------------------------------------------------------- */}
        <Card className="p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-strong">Quyền hạn</h2>
            <p className="mt-0.5 text-xs text-slate-muted">
              {effective.size} quyền có hiệu lực · {grantCount} cấp thêm · {denyCount} bị chặn.
              Thứ tự phân giải: <span className="text-down-500">DENY</span> &gt;{' '}
              <span className="text-up-500">GRANT</span> &gt; vai trò.
            </p>
          </div>

          <PermissionEditor
            userId={user.id}
            rows={permissionRows}
            disabled={!canManagePermissions}
            laChinhMinh={user.id === actor.id}
          />
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-slate-muted">{label}</dt>
      <dd className="text-right text-slate-soft">{value}</dd>
    </div>
  );
}
