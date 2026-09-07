'use client';

import {
  approveTradeAction,
  rejectTradeAction,
  cancelTradeAction,
  submitTradeAction,
  updateTradeAction,
} from '@/trading/actions';
import { ActionForm, FormMessage, SubmitButton } from '@/components/ActionForm';
import { Field } from '@/components/ui';

/**
 * Các hành động trên một giao dịch.
 *
 * Mỗi hành động là một form riêng để trạng thái "đang xử lý" và lỗi không lẫn vào
 * nhau. Hành động khó hoàn tác đều có bước xác nhận, và những hành động ảnh hưởng
 * tới P&L (huỷ, từ chối, sửa) bắt buộc nhập lý do — lý do được ghi vào Audit Log.
 */

export function ApproveRejectForms({ tradeId }: { tradeId: string }) {
  return (
    <div className="space-y-3">
      <ActionForm action={approveTradeAction} hidden={{ tradeId }} className="space-y-2">
        {(state) => (
          <>
            <FormMessage state={state} />
            <div>
              <label htmlFor="comment" className="field-label">
                Ý kiến duyệt
              </label>
              <input id="comment" name="comment" placeholder="Không bắt buộc" className="field" />
            </div>
            <SubmitButton confirm="Duyệt giao dịch này? Lệnh sẽ được ghi nhận là đã khớp và ảnh hưởng ngay tới vị thế.">
              Duyệt &amp; ghi nhận khớp
            </SubmitButton>
          </>
        )}
      </ActionForm>

      <details className="rounded-lg border border-ink-700 bg-ink-850">
        <summary className="cursor-pointer px-3 py-2 text-xs text-slate-muted hover:text-slate-soft">
          Từ chối giao dịch
        </summary>
        <div className="border-t border-ink-700 p-3">
          <ActionForm action={rejectTradeAction} hidden={{ tradeId }} className="space-y-2.5">
            {(state) => (
              <>
                <FormMessage state={state} />
                <Field
                  label="Lý do từ chối"
                  name="comment"
                  required
                  placeholder="Vượt hạn mức ngành"
                  errors={state?.fieldErrors?.comment}
                />
                <SubmitButton variant="danger" confirm="Từ chối giao dịch này?">
                  Từ chối
                </SubmitButton>
              </>
            )}
          </ActionForm>
        </div>
      </details>
    </div>
  );
}

export function SubmitForApprovalForm({ tradeId }: { tradeId: string }) {
  return (
    <ActionForm action={submitTradeAction} hidden={{ tradeId }} className="space-y-2">
      {(state) => (
        <>
          <FormMessage state={state} />
          <SubmitButton>Gửi duyệt</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function CancelTradeForm({
  tradeId,
  isExecuted,
}: {
  tradeId: string;
  isExecuted: boolean;
}) {
  return (
    <details className="rounded-lg border border-ink-700 bg-ink-850">
      <summary className="cursor-pointer px-3 py-2 text-xs text-slate-muted hover:text-down-500">
        Huỷ giao dịch
      </summary>
      <div className="border-t border-ink-700 p-3">
        {isExecuted ? (
          <p className="mb-2.5 rounded border border-warn-500/30 bg-warn-500/5 px-2.5 py-2 text-tiny leading-relaxed text-warn-500">
            Lệnh này đã khớp. Huỷ sẽ làm thay đổi vị thế, giá vốn và P&amp;L của danh mục. Bản ghi
            không bị xoá — trạng thái chuyển sang Đã huỷ và dấu vết còn nguyên trong Audit Log.
          </p>
        ) : null}

        <ActionForm action={cancelTradeAction} hidden={{ tradeId }} className="space-y-2.5">
          {(state) => (
            <>
              <FormMessage state={state} />
              <Field
                label="Lý do huỷ"
                name="comment"
                required
                placeholder="Nhập sai khối lượng"
                errors={state?.fieldErrors?.comment}
              />
              <SubmitButton
                variant="danger"
                confirm={
                  isExecuted
                    ? 'Huỷ lệnh ĐÃ KHỚP này? Vị thế và P&L sẽ thay đổi ngay.'
                    : 'Huỷ giao dịch này?'
                }
              >
                Huỷ giao dịch
              </SubmitButton>
            </>
          )}
        </ActionForm>
      </div>
    </details>
  );
}

/**
 * Sửa khối lượng / giá / phí / thuế.
 *
 * `version` được gửi kèm để chống hai người sửa cùng lúc: người ghi sau sẽ bị từ
 * chối kèm thông báo, thay vì âm thầm ghi đè thay đổi của người trước.
 */
export function EditTradeForm({
  tradeId,
  version,
  quantity,
  price,
  fees,
  tax,
}: {
  tradeId: string;
  version: number;
  quantity: number;
  price: string;
  fees: string;
  tax: string;
}) {
  return (
    <details className="rounded-lg border border-ink-700 bg-ink-850">
      <summary className="cursor-pointer px-3 py-2 text-xs text-slate-muted hover:text-slate-soft">
        Sửa giao dịch
      </summary>
      <div className="border-t border-ink-700 p-3">
        <p className="mb-3 text-tiny leading-relaxed text-slate-muted">
          Tỷ lệ phân bổ chiến lược được giữ nguyên, còn số tiền phân bổ sẽ được tính lại theo giá
          trị mới — nếu không, tổng phân bổ sẽ lệch so với giá trị lệnh.
        </p>

        <ActionForm
          action={updateTradeAction}
          hidden={{ tradeId, version: String(version) }}
          className="space-y-2.5"
        >
          {(state) => (
            <>
              <FormMessage state={state} />

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Field
                  label="Khối lượng"
                  name="quantity"
                  required
                  defaultValue={String(quantity)}
                  errors={state?.fieldErrors?.quantity}
                />
                <Field
                  label="Giá"
                  name="price"
                  required
                  defaultValue={price}
                  errors={state?.fieldErrors?.price}
                />
                <Field label="Phí" name="fees" defaultValue={fees} />
                <Field label="Thuế" name="tax" defaultValue={tax} />
              </div>

              <Field
                label="Lý do sửa"
                name="reason"
                required
                placeholder="Môi giới xác nhận lại khối lượng khớp"
                hint="Được ghi vào Audit Log kèm Before/After"
                errors={state?.fieldErrors?.reason}
              />

              <SubmitButton confirm="Lưu thay đổi? Vị thế và P&L sẽ được tính lại.">
                Lưu thay đổi
              </SubmitButton>
            </>
          )}
        </ActionForm>
      </div>
    </details>
  );
}
