'use client';

import { setManualQuoteAction } from '@/market/actions';
import { ActionForm, FormMessage, SubmitButton } from '@/components/ActionForm';
import { Field } from '@/components/ui';

export function ManualQuoteForm() {
  return (
    <ActionForm action={setManualQuoteAction} className="space-y-3">
      {(state) => (
        <>
          <FormMessage state={state} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_14rem_auto] sm:items-end">
            <Field
              label="Mã"
              name="symbol"
              required
              placeholder="MBB"
              errors={state?.fieldErrors?.symbol}
            />
            <Field
              label="Giá (VNĐ)"
              name="price"
              required
              placeholder="26150"
              hint="Số nguyên đồng; dấu chấm/phẩy được bỏ qua"
              errors={state?.fieldErrors?.price}
            />
            <div className="pb-1">
              <SubmitButton>Cập nhật giá</SubmitButton>
            </div>
          </div>
        </>
      )}
    </ActionForm>
  );
}
