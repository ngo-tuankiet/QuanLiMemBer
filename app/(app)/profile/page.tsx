import Link from 'next/link';
import type { Metadata } from 'next';
import { requireUser } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, PageHeader, RoleBadge, StatusBadge } from '@/components/ui';
import { BrokerAccountsCard } from '@/components/BrokerAccountsCard';

export const metadata: Metadata = { title: 'Tài khoản' };

export default async function ProfilePage() {
  const user = await requireUser();

  const [record, sessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        phone: true,
        employeeCode: true,
        createdAt: true,
        approvedAt: true,
        lastLoginAt: true,
      },
    }),
    prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, lastSeenAt: true, ipAddress: true, userAgent: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Tài khoản của tôi"
        subtitle={user.email}
        actions={
          <Link
            href={`/members/${user.id}`}
            className="rounded-lg border border-ink-700 px-3.5 py-2 text-sm text-slate-soft transition hover:border-accent-500 hover:text-accent-400"
          >
            Xem vị thế &amp; giao dịch của tôi →
          </Link>
        }
      />

      {/*
        THẺ TÀI KHOẢN CHỨNG KHOÁN ĐẶT NGAY ĐẦU TRANG NÀY.

        Đây là chỗ người ta đi tìm khi muốn khai tài khoản của chính mình. Trước đó
        thẻ này chỉ có ở `/members/[id]`, nên muốn dùng thì phải vào Members, tự tìm
        tên mình trong danh sách rồi bấm vào — không ai tìm ra.

        `isSelf` luôn true: trang này chỉ hiện tài khoản của người đang đăng nhập.
      */}
      <BrokerAccountsCard userId={user.id} isSelf className="mb-4" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-strong">Thông tin</h2>
          <dl className="mt-4 space-y-2.5 text-sm">
            <Row label="Họ tên" value={user.fullName} />
            <Row label="Email" value={user.email} />
            <Row label="Số điện thoại" value={record.phone ?? '—'} />
            <Row label="Mã nhân viên" value={record.employeeCode ?? '—'} />
            <Row label="Phòng ban" value={user.departmentNameVi ?? '—'} />
            <Row label="Nhóm" value={user.teamNameVi ?? '—'} />

            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-muted">Vai trò</dt>
              <dd>
                <RoleBadge roleCode={user.roleCode} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-muted">Trạng thái</dt>
              <dd>
                <StatusBadge status={user.status} />
              </dd>
            </div>

            <Row label="Ngày tạo" value={record.createdAt.toLocaleDateString('vi-VN')} />
            <Row
              label="Được duyệt"
              value={record.approvedAt ? record.approvedAt.toLocaleDateString('vi-VN') : '—'}
            />
            <Row
              label="Đăng nhập cuối"
              value={
                record.lastLoginAt
                  ? record.lastLoginAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
                  : 'chưa từng'
              }
            />
          </dl>

          <Link
            href="/change-password"
            className="mt-6 inline-block rounded-lg border border-ink-600 px-3.5 py-2 text-sm text-slate-soft transition hover:border-ink-500 hover:text-strong"
          >
            Đổi mật khẩu
          </Link>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-strong">Phiên đăng nhập đang hoạt động</h2>
          <p className="mt-0.5 text-xs text-slate-muted">
            Phiên được lưu trong database nên quản trị viên thu hồi được ngay lập tức — đó là lý do
            hệ thống không dùng JWT tự chứa.
          </p>

          <ul className="mt-4 space-y-2.5">
            {sessions.map((s) => (
              <li
                key={s.id}
                className={`rounded-lg border px-3 py-2.5 text-xs ${
                  s.id === user.sessionId
                    ? 'border-accent-500/30 bg-accent-500/5'
                    : 'border-ink-700 bg-ink-850'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-soft">
                    {s.ipAddress ?? 'IP không xác định'}
                    {s.id === user.sessionId ? (
                      <span className="ml-2 text-accent-400">· phiên hiện tại</span>
                    ) : null}
                  </span>
                  <span className="tabular text-slate-muted">
                    {s.lastSeenAt.toLocaleString('vi-VN', {
                      timeZone: 'Asia/Ho_Chi_Minh',
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="mt-1 truncate text-tiny text-ink-500" title={s.userAgent ?? ''}>
                  {s.userAgent ?? 'User agent không xác định'}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-muted">{label}</dt>
      <dd className="text-strong">{value}</dd>
    </div>
  );
}
