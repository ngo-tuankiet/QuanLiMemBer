'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Ranh giới lỗi cho khu vực nội bộ.
 *
 * Xử lý riêng trường hợp thiếu quyền (ForbiddenError từ requirePermission) để
 * hiển thị thông điệp đúng bản chất thay vì "Something went wrong".
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app] lỗi hiển thị:', error);
  }, [error]);

  const forbidden = error.message.startsWith('Thiếu quyền:');

  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="max-w-md text-center">
        <p className="text-xs font-semibold tracking-[0.2em] text-down-500">
          {forbidden ? 'KHÔNG CÓ QUYỀN' : 'LỖI'}
        </p>

        <h1 className="mt-2 text-lg font-semibold text-strong">
          {forbidden ? 'Bạn không có quyền xem nội dung này' : 'Đã xảy ra lỗi'}
        </h1>

        <p className="mt-2 text-sm text-slate-muted">
          {forbidden
            ? 'Liên hệ quản trị viên nếu bạn cho rằng mình cần quyền này.'
            : 'Thao tác không hoàn tất. Thử lại, hoặc quay về Dashboard.'}
        </p>

        {forbidden ? (
          <p className="mt-3 inline-block rounded border border-ink-700 bg-ink-850 px-2 py-1 font-mono text-xs text-slate-muted">
            {error.message.replace('Thiếu quyền: ', '')}
          </p>
        ) : null}

        <div className="mt-6 flex items-center justify-center gap-3">
          {!forbidden ? (
            <button
              onClick={reset}
              className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500"
            >
              Thử lại
            </button>
          ) : null}
          <Link
            href="/dashboard"
            className="rounded-lg border border-ink-600 px-4 py-2 text-sm text-slate-soft hover:border-ink-500 hover:text-strong"
          >
            Về Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
