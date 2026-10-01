'use client';

/**
 * Ô sửa một tham số cấu hình — Phase 10.
 *
 * Ba kiểu ô nhập tuỳ `valueType`: chọn true/false cho BOOL, textarea cho JSON,
 * và một dòng cho phần còn lại. Không dùng `<input type="number">` cho INT/BIGINT
 * vì nó cắt ngắn số lớn ở một số trình duyệt và cho phép ký hiệu khoa học
 * ("1e9") — với một ngưỡng tiền tệ thì cả hai đều là mất dữ liệu âm thầm.
 */

import { ActionForm, FormMessage, SubmitButton } from '@/components/ActionForm';
import { updateSettingAction } from '@/settings/actions';
import { SETTING_VALUE_TYPE } from '@/lib/enums';

export function SettingForm({
  settingKey,
  value,
  valueType,
  boundsNote,
}: {
  settingKey: string;
  value: string;
  valueType: string;
  boundsNote: string | null;
}) {
  const isJson = valueType === SETTING_VALUE_TYPE.JSON;
  const isBool = valueType === SETTING_VALUE_TYPE.BOOL;
  const numeric =
    valueType === SETTING_VALUE_TYPE.INT || valueType === SETTING_VALUE_TYPE.BIGINT;

  return (
    <ActionForm action={updateSettingAction} hidden={{ key: settingKey }}>
      {(state) => {
        const errors = state?.fieldErrors?.value;
        const invalid = Boolean(errors?.length);

        return (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-start gap-2">
              {isBool ? (
                <select
                  name="value"
                  defaultValue={value}
                  aria-label={settingKey}
                  className={`field w-40 ${invalid ? 'border-down-500' : ''}`}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : isJson ? (
                <textarea
                  name="value"
                  defaultValue={value}
                  rows={4}
                  aria-label={settingKey}
                  spellCheck={false}
                  className={`field w-full font-mono text-xs ${invalid ? 'border-down-500' : ''}`}
                />
              ) : (
                <input
                  name="value"
                  defaultValue={value}
                  aria-label={settingKey}
                  inputMode={numeric ? 'numeric' : undefined}
                  spellCheck={false}
                  className={`field ${numeric ? 'tabular w-52' : 'w-full sm:w-80'} ${
                    invalid ? 'border-down-500' : ''
                  }`}
                />
              )}

              <SubmitButton variant="subtle" className="!py-2 !text-xs">
                Lưu
              </SubmitButton>
            </div>

            {boundsNote && !invalid ? (
              <p className="text-tiny text-slate-muted">{boundsNote}</p>
            ) : null}
            {invalid ? <p className="text-tiny text-down-500">{errors!.join(' ')}</p> : null}
            <FormMessage state={state} />
          </div>
        );
      }}
    </ActionForm>
  );
}
