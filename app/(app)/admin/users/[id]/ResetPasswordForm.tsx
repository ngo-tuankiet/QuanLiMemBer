'use client';

import { useState } from 'react';
import { resetUserPasswordAction } from '@/admin/actions';
import { ActionForm, SubmitButton } from '@/components/ActionForm';

/**
 * ĐẶT LẠI MẬT KHẨU CHO NGƯỜI DÙNG — đường phục hồi duy nhất khi họ quên.
 *
 * Hệ thống không có email nên không có luồng "quên mật khẩu" tự phục vụ. Người dùng
 * liên hệ quản trị viên, quản trị viên bấm ở đây, rồi đọc mật khẩu tạm cho họ.
 *
 * MẬT KHẨU TẠM HIỆN ĐÚNG MỘT LẦN. Nó không được lưu ở đâu — không audit log, không
 * file log — nên tải lại trang là mất hẳn và phải đặt lại lần nữa. Đó là đánh đổi có
 * chủ ý: một mật khẩu còn đọc lại được ở đâu đó thì không còn là mật khẩu.
 *
 * Khối gập lại như `DeleteUserForm`, cùng lý do: thao tác này thu hồi mọi phiên của
 * người đó và buộc họ đổi mật khẩu ở lần đăng nhập tới. Không phải thứ nên nằm sẵn
 * dưới ngón tay khi người ta chỉ vào xem thông tin.
 */
export function ResetPasswordForm({
  userId,
  fullName,
}: {
  userId: string;
  fullName: string;
}) {
  const [moRong, setMoRong] = useState(false);

  if (!moRong) {
    return (
      <button
        type="button"
        onClick={() => setMoRong(true)}
        className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-slate-soft transition hover:border-ink-500 hover:text-strong"
      >
        Đặt lại mật khẩu…
      </button>
    );
  }

  return (
    <ActionForm action={resetUserPasswordAction} hidden={{ userId }} className="space-y-3">
      {(state) => (
        <>
          {/*
            Sau khi thành công, phần quan trọng nhất là chính mật khẩu tạm — nên nó
            được tách khỏi câu thông báo và trình bày để ĐỌC ĐƯỢC: cỡ chữ lớn, đẳng
            khoảng, giãn ký tự. Người quản trị đang đọc nó qua điện thoại cho người
            khác gõ lại.
          */}
          {state?.ok && state.message ? (
            <div className="rounded-lg border border-up-500/30 bg-up-500/5 p-3">
              <p className="text-tiny font-medium tracking-wide text-up-500">
                MẬT KHẨU TẠM CỦA {fullName.toUpperCase()}
              </p>
              {/*
                Dòng đầu của `message` LÀ mật khẩu, đứng một mình — xem chú thích ở
                `resetUserPasswordAction`. `select-all` để bấm một lần là chọn hết,
                không phải kéo chuột qua từng ký tự.
              */}
              <p className="tabular mt-1.5 mb-2 text-lg font-semibold tracking-[0.12em] text-strong select-all">
                {state.message.split('\n')[0]}
              </p>
              <p className="text-tiny leading-relaxed text-slate-muted">
                {state.message.split('\n').slice(1).join(' ')}
              </p>
            </div>
          ) : null}

          {state && !state.ok && state.message ? (
            <p className="text-xs leading-relaxed text-down-500" role="status" aria-live="polite">
              {state.message}
            </p>
          ) : null}

          {!state?.ok ? (
            <>
              <p className="text-xs leading-relaxed text-slate-soft">
                Sinh một mật khẩu tạm cho{' '}
                <span className="font-medium text-strong">{fullName}</span>. Dùng khi họ quên
                mật khẩu — hệ thống không gửi email nên bạn phải đọc lại mật khẩu đó cho họ.
              </p>

              <ul className="space-y-1 text-tiny text-ink-500">
                <li>· Mọi phiên đăng nhập hiện tại của họ bị thu hồi ngay.</li>
                <li>· Lần đăng nhập tới, họ buộc phải đổi sang mật khẩu của riêng mình.</li>
                <li>
                  · Mật khẩu tạm hiện <span className="text-slate-soft">đúng một lần</span> ở
                  đây và không được lưu ở đâu cả — tải lại trang là mất.
                </li>
              </ul>

              <div className="flex items-center gap-2">
                <SubmitButton
                  variant="subtle"
                  className="!text-xs"
                  confirm={`Đặt lại mật khẩu của ${fullName}? Họ sẽ bị đăng xuất khỏi mọi thiết bị.`}
                >
                  Sinh mật khẩu tạm
                </SubmitButton>
                <button
                  type="button"
                  onClick={() => setMoRong(false)}
                  className="rounded-lg px-3 py-2 text-xs text-slate-muted transition hover:text-strong"
                >
                  Huỷ
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setMoRong(false)}
              className="rounded-lg px-3 py-2 text-xs text-slate-muted transition hover:text-strong"
            >
              Đóng
            </button>
          )}
        </>
      )}
    </ActionForm>
  );
}
