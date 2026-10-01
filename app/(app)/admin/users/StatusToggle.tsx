'use client';

import { setUserStatusAction } from '@/admin/actions';
import { ActionForm, SubmitButton } from '@/components/ActionForm';
import { USER_STATUS } from '@/lib/enums';

/** Nút khoá / mở khoá nhanh trong bảng danh sách. */
export function StatusToggle({ userId, status }: { userId: string; status: string }) {
  const suspending = status === USER_STATUS.ACTIVE;

  return (
    <ActionForm
      action={setUserStatusAction}
      hidden={{
        userId,
        status: suspending ? USER_STATUS.SUSPENDED : USER_STATUS.ACTIVE,
      }}
    >
      {(state) => (
        <>
          <SubmitButton
            variant={suspending ? 'danger' : 'subtle'}
            className="!px-2.5 !py-1 !text-xs"
            confirm={
              suspending
                ? 'Khoá tài khoản này? Toàn bộ phiên đăng nhập của họ sẽ bị thu hồi ngay.'
                : undefined
            }
          >
            {suspending ? 'Khoá' : 'Mở khoá'}
          </SubmitButton>
          {state && !state.ok && state.message ? (
            <span className="ml-2 text-xs text-down-500">{state.message}</span>
          ) : null}
        </>
      )}
    </ActionForm>
  );
}
