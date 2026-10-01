'use client';

import { registerAction } from '@/auth/actions';
import { ActionForm, FormMessage, SubmitButton } from '@/components/ActionForm';
import { Field } from '@/components/ui';

export function RegisterForm() {
  return (
    <ActionForm action={registerAction} className="space-y-4">
      {(state) => (
        <>
          <FormMessage state={state} />

          <Field
            label="Họ và tên"
            name="fullName"
            required
            autoComplete="name"
            placeholder="Nguyễn Văn A"
            errors={state?.fieldErrors?.fullName}
          />

          <Field
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="username"
            errors={state?.fieldErrors?.email}
          />

          <Field
            label="Số điện thoại"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="0901234567"
            hint="Không bắt buộc"
            errors={state?.fieldErrors?.phone}
          />

          <Field
            label="Mật khẩu"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            hint="Tối thiểu 10 ký tự, có chữ in hoa, chữ thường và số"
            errors={state?.fieldErrors?.password}
          />

          <Field
            label="Nhập lại mật khẩu"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            errors={state?.fieldErrors?.confirmPassword}
          />

          <SubmitButton className="w-full">Tạo tài khoản</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
