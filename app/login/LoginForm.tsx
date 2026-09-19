'use client';

import { loginAction } from '@/auth/actions';
import { ActionForm, FormMessage, SubmitButton } from '@/components/ActionForm';
import { Field } from '@/components/ui';

export function LoginForm() {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      {(state) => (
        <>
          <FormMessage state={state} />

          <Field
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="username"
            placeholder="ten@vninvest.local"
            errors={state?.fieldErrors?.email}
          />

          <Field
            label="Mật khẩu"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            errors={state?.fieldErrors?.password}
          />

          <SubmitButton className="w-full">Đăng nhập</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
