'use client';

import { syncMarketDataAction } from '@/market/actions';
import { ActionForm, SubmitButton } from '@/components/ActionForm';

/**
 * NÚT "CẬP NHẬT GIÁ" — gọi VNStock ngay khi bấm.
 *
 * KHÔNG DÙNG `FormMessage`. Component đó vẽ một khối thông báo cả chiều rộng, hợp
 * với thân form nhưng không hợp ở khe `actions` của `PageHeader` — nó sẽ đẩy tiêu
 * đề trang lệch đi mỗi lần có kết quả. Ở đây thông báo là một dòng chữ nhỏ nằm
 * ngay dưới nút, căn phải theo nút.
 *
 * Lần bấm có thể mất hàng chục giây (nguồn trả chậm). `SubmitButton` tự vô hiệu
 * hoá và hiện trạng thái chờ trong lúc đó, nên không cần khoá thêm ở đây — còn
 * chốt chống chạy trùng thật sự nằm ở server (dòng `RUNNING` trong
 * `market_data_syncs`), vì hai người dùng khác nhau thì hai trình duyệt không biết
 * gì về nhau.
 */
export function SyncPricesButton() {
  return (
    <ActionForm action={syncMarketDataAction}>
      {(state) => (
        <div className="flex flex-col items-end gap-1">
          <SubmitButton>Cập nhật giá</SubmitButton>

          {state?.message ? (
            <p
              className={`max-w-[22rem] text-right text-tiny leading-relaxed ${
                state.ok ? 'text-up-500' : 'text-down-500'
              }`}
              role="status"
              aria-live="polite"
            >
              {state.message}
            </p>
          ) : (
            <p className="text-right text-tiny text-ink-500">
              lấy giá mới nhất từ VNStock · mất vài chục giây
            </p>
          )}
        </div>
      )}
    </ActionForm>
  );
}
