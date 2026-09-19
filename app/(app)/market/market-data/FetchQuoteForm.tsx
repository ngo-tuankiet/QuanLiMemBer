'use client';

import { fetchQuoteForSymbolAction } from '@/market/actions';
import { ActionForm, FormMessage, SubmitButton } from '@/components/ActionForm';
import { Field } from '@/components/ui';

/**
 * Lấy giá cho MỘT mã từ VNStock.
 *
 * Thay cho form nhập giá thủ công cũ. Chỗ đứng trên trang giữ nguyên — người dùng
 * vẫn tìm nó ở ngay dưới danh sách mã thiếu giá — nhưng thao tác đổi: gõ mã rồi để
 * hệ thống đi hỏi nguồn, thay vì gõ luôn con số.
 *
 * MỘT Ô THAY VÌ HAI. Ô "Giá" cũ biến mất chính là điểm của thay đổi này: không còn
 * đường nào để một con số không đối chiếu được lọt vào bảng giá.
 */
export function FetchQuoteForm() {
  return (
    <ActionForm action={fetchQuoteForSymbolAction} className="space-y-3">
      {(state) => (
        <>
          <FormMessage state={state} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_auto] sm:items-end">
            <Field
              label="Mã"
              name="symbol"
              required
              placeholder="MBB"
              hint="Mã phải có sẵn trong danh mục chuẩn"
              errors={state?.fieldErrors?.symbol}
            />
            <div className="pb-1">
              <SubmitButton>Lấy giá từ VNStock</SubmitButton>
            </div>
          </div>
        </>
      )}
    </ActionForm>
  );
}
