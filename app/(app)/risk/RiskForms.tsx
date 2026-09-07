'use client';

/**
 * Form của trang Risk — Phase 09.
 *
 * Ba form, ba việc: tiếp nhận một cảnh báo, quét lại toàn hệ thống, và sửa một
 * ngưỡng. Tất cả đều đi qua `ActionForm` nên đều có cùng cách hiện lỗi và đều bị
 * vô hiệu trong lúc chờ.
 */

import { ActionForm, FormMessage, SubmitButton } from '@/components/ActionForm';
import { Select } from '@/components/ui';
import {
  acknowledgeAlertAction,
  rescanAction,
  updateRiskRuleAction,
} from '@/risk/actions';
import { SEVERITY_OPTIONS, type Severity } from '@/lib/enums';

export function AcknowledgeButton({ alertId }: { alertId: string }) {
  return (
    <ActionForm action={acknowledgeAlertAction} hidden={{ alertId }} className="shrink-0">
      {(state) => (
        <div className="flex flex-col items-end gap-1">
          <SubmitButton variant="subtle" className="!px-2.5 !py-1 !text-xs">
            Tiếp nhận
          </SubmitButton>
          {state && !state.ok ? (
            <p className="text-tiny text-down-500">{state.message}</p>
          ) : null}
        </div>
      )}
    </ActionForm>
  );
}

/**
 * `rescanAction` không nhận FormData — nó không có tham số nào cả.
 *
 * `ActionForm` vẫn dùng được vì `useActionState` luôn truyền (prev, formData) và
 * action chỉ khai báo tham số đầu; tham số thừa bị bỏ qua như mọi hàm JavaScript.
 */
export function RescanForm() {
  return (
    <ActionForm action={rescanAction}>
      {(state) => (
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton variant="ghost" className="!py-1.5 !text-xs">
            Quét lại ngay
          </SubmitButton>
          {state?.message ? (
            <p
              role={state.ok ? 'status' : 'alert'}
              className={`text-xs ${state.ok ? 'text-up-500' : 'text-down-500'}`}
            >
              {state.message}
            </p>
          ) : null}
        </div>
      )}
    </ActionForm>
  );
}

export function RuleEditor({
  ruleId,
  threshold,
  severity,
  isActive,
  unitHint,
}: {
  ruleId: string;
  threshold: string;
  severity: Severity;
  isActive: boolean;
  /** Nhắc đơn vị của ngưỡng — bps, phút, hoặc số đếm. */
  unitHint: string;
}) {
  return (
    <ActionForm action={updateRiskRuleAction} hidden={{ ruleId }}>
      {(state) => (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-28">
              <label htmlFor={`threshold-${ruleId}`} className="field-label">
                Ngưỡng
              </label>
              <input
                id={`threshold-${ruleId}`}
                name="threshold"
                inputMode="numeric"
                defaultValue={threshold}
                aria-invalid={Boolean(state?.fieldErrors?.threshold)}
                className={`field tabular ${state?.fieldErrors?.threshold ? 'border-down-500' : ''}`}
              />
            </div>

            <div className="w-44">
              <Select
                label="Mức"
                name="severity"
                options={SEVERITY_OPTIONS}
                defaultValue={severity}
              />
            </div>

            <label className="flex items-center gap-2 pb-2.5 text-xs text-slate-soft">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={isActive}
                className="size-3.5 accent-current"
              />
              Đang bật
            </label>

            <div className="pb-1">
              <SubmitButton variant="subtle" className="!py-1.5 !text-xs">
                Lưu
              </SubmitButton>
            </div>
          </div>

          <p className="text-tiny text-slate-muted">{unitHint}</p>

          {state?.fieldErrors?.threshold ? (
            <p className="text-tiny text-down-500">{state.fieldErrors.threshold.join(' ')}</p>
          ) : null}
          <FormMessage state={state} />
        </div>
      )}
    </ActionForm>
  );
}
