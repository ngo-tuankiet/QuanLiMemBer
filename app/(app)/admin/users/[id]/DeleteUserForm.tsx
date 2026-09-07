'use client';

import { useState } from 'react';
import { deleteUserAction } from '@/admin/actions';
import { ActionForm, SubmitButton } from '@/components/ActionForm';

/**
 * XOÁ TÀI KHOẢN — đặt ở TRANG CHI TIẾT, không đặt trong bảng danh sách.
 *
 * Bảng người dùng có hai mươi dòng và nút "Khoá" nằm sát lề phải. Thêm một nút xoá
 * cạnh đó là dựng sẵn một cú bấm nhầm không hoàn nguyên được. Ở trang chi tiết, người
 * xoá đã phải chủ động mở đúng một người, và tên người đó chiếm cả đầu trang.
 *
 * BA LỚP CHẶN, mỗi lớp chặn một kiểu sai khác nhau:
 *
 *   1. Khối này gập lại  → không nhìn thấy thì không bấm nhầm
 *   2. Gõ lại email      → buộc mắt đọc đúng người mình đang xoá
 *   3. Chốt ở server     → quyền, không tự xoá mình, không xoá người vai trò cao hơn,
 *                          và từ chối nếu người đó còn lịch sử giao dịch
 *
 * Lớp 3 là lớp duy nhất thật sự bảo vệ được; hai lớp đầu chỉ để giảm sai sót của người
 * đang thao tác. Cả ba đều cần.
 */
export function DeleteUserForm({
  userId,
  email,
  fullName,
}: {
  userId: string;
  email: string;
  fullName: string;
}) {
  const [moRong, setMoRong] = useState(false);

  if (!moRong) {
    return (
      <button
        type="button"
        onClick={() => setMoRong(true)}
        className="rounded-lg border border-down-500/40 px-3 py-1.5 text-xs font-medium text-down-500 transition hover:bg-down-500/10"
      >
        Xoá tài khoản này…
      </button>
    );
  }

  return (
    <ActionForm action={deleteUserAction} hidden={{ userId }}>
      {(state) => (
        <>
          <p className="text-xs leading-relaxed text-slate-soft">
            Xoá <span className="font-medium text-strong">{fullName}</span> khỏi hệ thống. Việc này{' '}
            <span className="text-down-500">không hoàn nguyên được</span>.
          </p>

          <ul className="mt-2 space-y-1 text-tiny text-ink-500">
            <li>· Phiên đăng nhập, quyền riêng và quyền truy cập danh mục bị xoá theo.</li>
            <li>
              · Nhật ký kiểm toán <span className="text-slate-soft">được giữ lại</span> — mỗi dòng
              đã lưu sẵn ảnh chụp tên và email nên vẫn đọc được sau khi xoá.
            </li>
            <li>
              · Nếu người này đã có lệnh, dòng vốn hay tài khoản chứng khoán, hệ thống sẽ{' '}
              <span className="text-slate-soft">từ chối</span> — lúc đó dùng “Khoá” thay thế.
            </li>
          </ul>

          <label className="mt-3 block">
            <span className="mb-1 block text-tiny font-medium text-slate-muted">
              Gõ lại email để xác nhận: <span className="font-mono text-slate-soft">{email}</span>
            </span>
            <input
              name="confirmEmail"
              required
              autoComplete="off"
              placeholder={email}
              className="w-full rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 font-mono text-sm text-strong placeholder:text-ink-500 focus:border-down-500 focus:outline-none"
            />
            {state?.fieldErrors?.confirmEmail ? (
              <span className="mt-1 block text-tiny text-down-500">
                {state.fieldErrors!.confirmEmail!.join(' · ')}
              </span>
            ) : null}
          </label>

          <div className="mt-3 flex items-center gap-2">
            <SubmitButton variant="danger" className="!text-xs">
              Xoá vĩnh viễn
            </SubmitButton>
            <button
              type="button"
              onClick={() => setMoRong(false)}
              className="rounded-lg px-3 py-2 text-xs text-slate-muted transition hover:text-strong"
            >
              Huỷ
            </button>
          </div>

          {state?.message ? (
            <p
              className={`mt-2 text-xs leading-relaxed ${state?.ok ? 'text-up-500' : 'text-down-500'}`}
              role="status"
              aria-live="polite"
            >
              {state?.message}
            </p>
          ) : null}
        </>
      )}
    </ActionForm>
  );
}
