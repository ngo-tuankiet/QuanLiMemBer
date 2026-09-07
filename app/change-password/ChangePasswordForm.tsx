'use client';

import { changePasswordAction } from '@/auth/actions';
import { ActionForm, FormMessage, SubmitButton } from '@/components/ActionForm';
import { Field } from '@/components/ui';

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction} className="space-y-4">
      {(state) => (
        <>
          <FormMessage state={state} />

          <Field
            label="Mật khẩu hiện tại"
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            errors={state?.fieldErrors?.currentPassword}
          />

          <Field
            label="Mật khẩu mới"
            name="newPassword"
            type="password"
            required
            autoComplete="new-password"
            hint="Tối thiểu 10 ký tự, có chữ in hoa, chữ thường và số"
            errors={state?.fieldErrors?.newPassword}
          />

          <Field
            label="Nhập lại mật khẩu mới"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            errors={state?.fieldErrors?.confirmPassword}
          />

          <SubmitButton className="w-full">Đổi mật khẩu</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
