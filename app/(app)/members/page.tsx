import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { getDict } from '@/i18n';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader, RoleBadge, StatusBadge } from '@/components/ui';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.nav.members };
}

/**
 * Danh sách thành viên (§21 menu Members).
 *
 * Chỉ đọc. Mọi thao tác thay đổi nằm ở /admin/users và cần quyền cao hơn.
 */
export default async function MembersPage() {
  const viewer = await requirePagePermission('user.view');
  const { t } = await getDict();

  const users = await prisma.user.findMany({
    orderBy: [{ status: 'asc' }, { fullName: 'asc' }],
    include: {
      role: { select: { code: true, level: true } },
      department: { select: { nameVi: true } },
      team: { select: { nameVi: true } },
    },
  });

  const canManage = viewer.permissions.has('user.approve');

  return (
    <>
      <PageHeader
        title={t.nav.members}
        subtitle={`${users.length} người dùng trong hệ thống`}
        actions={
          canManage ? (
            <Link
              href="/admin/users"
              className="rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-500"
            >
              Quản lý người dùng
            </Link>
          ) : null
        }
      />

      <Card className="overflow-hidden">
        {users.length === 0 ? (
          <EmptyState title="Chưa có người dùng nào" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-left text-xs text-slate-muted">
                  <Th>Họ tên</Th>
                  <Th>Email</Th>
                  <Th>Vai trò</Th>
                  <Th>Phòng ban</Th>
                  <Th>Nhóm</Th>
                  <Th>Mã NV</Th>
                  <Th>Trạng thái</Th>
                  <Th className="text-right">Đăng nhập cuối</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-ink-800 last:border-0 hover:bg-ink-850/60"
                  >
                    <Td>
                      {/*
                        Link sang chi tiết cá nhân. Trang đó tự chốt phạm vi xem —
                        URL gõ tay được nên không dựa vào việc ở đây có hiện link.
                      */}
                      <Link
                        href={`/members/${u.id}`}
                        className="font-medium text-strong transition hover:text-accent-400"
                      >
                        {u.fullName}
                      </Link>
                      {u.id === viewer.id ? (
                        <span className="ml-2 rounded bg-accent-600/15 px-1.5 py-px text-micro text-accent-400">
                          bạn
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-slate-muted">{u.email}</Td>
                    <Td>
                      <RoleBadge roleCode={u.role?.code ?? null} />
                    </Td>
                    <Td className="text-slate-muted">{u.department?.nameVi ?? '—'}</Td>
                    <Td className="text-slate-muted">{u.team?.nameVi ?? '—'}</Td>
                    <Td className="tabular text-slate-muted">{u.employeeCode ?? '—'}</Td>
                    <Td>
                      <StatusBadge status={u.status} />
                    </Td>
                    <Td className="tabular text-right text-xs text-slate-muted">
                      {u.lastLoginAt
                        ? u.lastLoginAt.toLocaleString('vi-VN', {
                            timeZone: 'Asia/Ho_Chi_Minh',
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'chưa từng'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-xs text-slate-muted">
        Bấm vào tên để xem chi tiết: mã đang giữ, khối lượng, giá vốn, giá mua/bán từng lệnh
        và chiến lược của lệnh đó. Theo §4, người dùng không được gán Strategy — Strategy chỉ
        tồn tại ở từng giao dịch.
      </p>
    </>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 ${className}`}>{children}</td>;
}
