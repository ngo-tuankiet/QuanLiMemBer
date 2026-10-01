'use client';

import { useActionState } from 'react';
import { saveContingencyPlanAction, type ActionResult } from '@/risk/contingency-actions';

const EMPTY: ActionResult = { ok: false };

const inputCls =
  'w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-strong ' +
  'placeholder:text-ink-500 focus:border-accent-500 focus:outline-none';

export interface MucForm {
  muc: 1 | 2 | 3;
  /** Phần trăm dạng chuỗi để điền sẵn: "7", "7,5". Rỗng = chưa đặt. */
  phanTram: string;
  hanhDong: string;
}

const NHAN_MUC: Record<1 | 2 | 3, { dot: string; ten: string; goiY: string }> = {
  1: { dot: '🟡', ten: 'Mức 1', goiY: 'VD: Theo dõi sát, không mua thêm' },
  2: { dot: '🟠', ten: 'Mức 2', goiY: 'VD: Bán 50% vị thế' },
  3: { dot: '🔴', ten: 'Mức 3', goiY: 'VD: Cắt lỗ toàn bộ' },
};

/**
 * FORM KẾ HOẠCH DỰ PHÒNG CỦA MỘT CHIẾN LƯỢC — ba mức, lưu cùng một lần.
 *
 * Mỗi chiến lược một form riêng: lưu kế hoạch Tích sản không được đụng tới kế hoạch
 * của chiến lược khác, và lỗi nhập ở một chiến lược không được chặn việc lưu chiến lược
 * kia.
 */
export function ContingencyForm({
  strategyId,
  isActive,
  levels,
}: {
  strategyId: string;
  isActive: boolean;
  levels: MucForm[];
}) {
  const [state, action, pending] = useActionState(saveContingencyPlanAction, EMPTY);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="strategyId" value={strategyId} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {levels.map((l) => {
          const nhan = NHAN_MUC[l.muc];
          const loi = state.fieldErrors?.[`level${l.muc}`];
          return (
            <div key={l.muc} className="rounded-lg border border-ink-700 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-strong">
                <span aria-hidden>{nhan.dot}</span> {nhan.ten}
              </p>
              <label className="block">
                <span className="mb-1 block text-tiny text-slate-muted">Lỗ từ (% trên giá vốn)</span>
                <span className="flex items-center gap-2">
                  <input
                    name={`level${l.muc}`}
                    defaultValue={l.phanTram}
                    inputMode="decimal"
                    placeholder={l.muc === 1 ? 'VD: 7' : l.muc === 2 ? 'VD: 15' : 'VD: 25'}
                    className={`${inputCls} tabular w-28`}
                  />
                  <span className="text-xs text-slate-muted">%</span>
                </span>
              </label>
              {loi ? <span className="mt-1 block text-tiny text-down-500">{loi.join(' ')}</span> : null}
              <label className="mt-2 block">
                <span className="mb-1 block text-tiny text-slate-muted">Hành động khi chạm mức</span>
                <input
                  name={`action${l.muc}`}
                  defaultValue={l.hanhDong}
                  maxLength={300}
                  placeholder={nhan.goiY}
                  className={inputCls}
                />
              </label>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-slate-soft">
          <input type="checkbox" name="isActive" defaultChecked={isActive} className="size-4" />
          Bật kế hoạch
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-50"
        >
          {pending ? 'Đang lưu và quét lại…' : 'Lưu kế hoạch'}
        </button>
        {state.message ? (
          <span className={`text-xs ${state.ok ? 'text-up-500' : 'text-down-500'}`} role="status">
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
