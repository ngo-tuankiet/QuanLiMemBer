import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCurrentUser } from '@/auth/guards';
import { logoutAction } from '@/auth/actions';
import { prisma } from '@/lib/prisma';
import { USER_STATUS } from '@/lib/enums';

export const metadata: Metadata = { title: 'Chờ duyệt' };

/**
 * Trang chờ cho user chưa được duyệt, bị từ chối, hoặc bị tạm khoá.
 *
 * Cố tình KHÔNG nằm trong nhóm (app): những người này chưa có quyền nào nên
 * không được thấy sidebar hay bất kỳ dữ liệu nghiệp vụ nào.
 */
export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Đã được duyệt trong lúc đang mở trang này thì cho vào luôn.
  if (user.status === USER_STATUS.ACTIVE) redirect('/dashboard');

  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { rejectedReason: true, createdAt: true },
  });

  const content = {
    [USER_STATUS.PENDING]: {
      dot: 'bg-warn-500',
      title: 'Tài khoản đang chờ duyệt',
      body: 'Quản trị viên cần gán vai trò, phòng ban và nhóm cho bạn trước khi bạn truy cập được hệ thống. Bạn sẽ vào được ngay sau khi được duyệt.',
    },
    [USER_STATUS.REJECTED]: {
      dot: 'bg-down-500',
      title: 'Yêu cầu đăng ký đã bị từ chối',
      body: record?.rejectedReason
        ? `Lý do: ${record.rejectedReason}`
        : 'Liên hệ quản trị viên để biết thêm chi tiết.',
    },
    [USER_STATUS.SUSPENDED]: {
      dot: 'bg-down-500',
      title: 'Tài khoản đang bị tạm khoá',
      body: 'Liên hệ quản trị viên để mở lại quyền truy cập.',
    },
  }[user.status] ?? {
    dot: 'bg-ink-500',
    title: 'Tài khoản chưa sẵn sàng',
    body: 'Liên hệ quản trị viên.',
  };

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-900 p-7">
        <div className="flex items-center gap-2.5">
          <span className={`size-2 animate-pulse rounded-full ${content.dot}`} />
          <p className="text-xs font-semibold tracking-[0.16em] text-slate-muted">
            {user.status}
          </p>
        </div>

        <h1 className="mt-4 text-lg font-semibold text-strong">{content.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-soft">{content.body}</p>

        <dl className="mt-6 space-y-2 border-t border-ink-800 pt-5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-muted">Họ tên</dt>
            <dd className="text-strong">{user.fullName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-muted">Email</dt>
            <dd className="text-strong">{user.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-muted">Ngày đăng ký</dt>
            <dd className="tabular text-strong">
              {record?.createdAt.toLocaleDateString('vi-VN')}
            </dd>
          </div>
        </dl>

        <form action={logoutAction} className="mt-6">
          <button
            type="submit"
            className="w-full rounded-lg border border-ink-600 px-4 py-2 text-sm text-slate-soft transition hover:border-ink-500 hover:text-strong"
          >
            Đăng xuất
          </button>
        </form>
      </div>
    </main>
  );
}
