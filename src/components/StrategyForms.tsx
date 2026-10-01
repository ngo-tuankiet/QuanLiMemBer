'use client';

import { useActionState, useState } from 'react';
import {
  saveStrategyAction,
  toggleStrategyAction,
  type ActionResult,
} from '@/admin/strategy-actions';

const EMPTY: ActionResult = { ok: false };

const inputCls =
  'w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-strong ' +
  'placeholder:text-ink-500 focus:border-accent-500 focus:outline-none';
const labelCls = 'mb-1 block text-tiny font-medium text-slate-muted';

export interface StrategyRow {
  id: string;
  code: string;
  name: string;
  nameVi: string;
  description: string | null;
  colorHex: string | null;
  sortOrder: number;
  isActive: boolean;
  maxAllocationBps: number | null;
  /** Giá vốn đang nằm trong chiến lược này. Chuỗi để `bigint` qua được ranh giới server/client. */
  netCapital: string;
  tradeCount: number;
}

function Loi({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <span className="mt-1 block text-tiny text-down-500">{errors.join(' · ')}</span>;
}

export function StrategyForm({ strategy }: { strategy?: StrategyRow }) {
  const [mo, setMo] = useState(false);
  const [state, action, pending] = useActionState(saveStrategyAction, EMPTY);

  const moi = strategy === undefined;

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className={
          moi
            ? 'rounded-lg border border-accent-500/40 px-3 py-1.5 text-xs font-medium text-accent-400 transition hover:bg-accent-500/10'
            : 'rounded-md px-2 py-1 text-tiny text-ink-500 transition hover:text-slate-soft'
        }
      >
        {moi ? '+ Thêm chiến lược' : 'Sửa'}
      </button>
    );
  }

  return (
    <form action={action} className="w-full rounded-lg border border-ink-700 bg-ink-850 p-4">
      {strategy ? <input type="hidden" name="id" value={strategy.id} /> : null}

      <p className="mb-3 text-xs font-medium text-strong">
        {moi ? 'Chiến lược mới' : `Sửa chiến lược ${strategy!.nameVi}`}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelCls}>
            Mã{' '}
            {moi ? (
              <span className="text-down-500">*</span>
            ) : (
              <span className="text-ink-500">(không sửa được)</span>
            )}
          </span>
          <input
            name="code"
            required
            defaultValue={strategy?.code}
            readOnly={!moi}
            placeholder="GIA_TRI"
            className={`${inputCls} font-mono ${moi ? '' : 'cursor-not-allowed text-slate-muted'}`}
          />
          <Loi errors={state.fieldErrors?.code} />
        </label>

        <label className="block">
          <span className={labelCls}>
            Tên hiển thị <span className="text-down-500">*</span>
          </span>
          <input
            name="nameVi"
            required
            defaultValue={strategy?.nameVi}
            placeholder="Định giá rẻ"
            className={inputCls}
          />
          <Loi errors={state.fieldErrors?.nameVi} />
        </label>

        <label className="block">
          <span className={labelCls}>
            Tên tiếng Anh <span className="text-down-500">*</span>
          </span>
          <input
            name="name"
            required
            defaultValue={strategy?.name}
            placeholder="Value"
            className={inputCls}
          />
          <Loi errors={state.fieldErrors?.name} />
        </label>

        {/*
          HẠN MỨC NHẬP BẰNG PHẦN TRĂM. Database lưu basis point (4000 = 40%); phép đổi nằm
          ở server action. Để trống = không đặt hạn mức, trang Chiến lược sẽ không cảnh báo
          vượt trần cho chiến lược này.
        */}
        <label className="block">
          <span className={labelCls}>Hạn mức tỷ trọng tối đa (%)</span>
          <input
            name="maxAllocationPercent"
            inputMode="decimal"
            defaultValue={
              strategy?.maxAllocationBps != null ? String(strategy.maxAllocationBps / 100) : ''
            }
            placeholder="Để trống = không giới hạn"
            className={`${inputCls} tabular`}
          />
          <Loi errors={state.fieldErrors?.maxAllocationBps} />
        </label>

        <label className="block">
          <span className={labelCls}>Màu trên biểu đồ</span>
          <span className="flex items-center gap-2">
            <input
              name="colorHex"
              type="color"
              defaultValue={strategy?.colorHex ?? '#2563eb'}
              className="h-9 w-14 cursor-pointer rounded border border-ink-700 bg-ink-900"
            />
            <span className="text-tiny text-ink-500">để mặc định thì lấy theo thứ tự</span>
          </span>
          <Loi errors={state.fieldErrors?.colorHex} />
        </label>

        <label className="block">
          <span className={labelCls}>Thứ tự hiển thị</span>
          <input
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={strategy?.sortOrder ?? 0}
            className={`${inputCls} tabular w-28`}
          />
          <Loi errors={state.fieldErrors?.sortOrder} />
        </label>

        <label className="block sm:col-span-2">
          <span className={labelCls}>Mô tả</span>
          <input
            name="description"
            defaultValue={strategy?.description ?? ''}
            placeholder="Luận điểm của chiến lược này"
            className={inputCls}
          />
          <Loi errors={state.fieldErrors?.description} />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-60"
        >
          {pending ? 'Đang lưu…' : moi ? 'Tạo chiến lược' : 'Lưu'}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded-lg px-2 py-2 text-sm text-slate-muted transition hover:text-strong"
        >
          Đóng
        </button>
      </div>

      {state.message ? (
        <p className={`mt-2 text-xs ${state.ok ? 'text-up-500' : 'text-down-500'}`} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function ToggleStrategyButton({
  strategyId,
  isActive,
  blockedReason,
}: {
  strategyId: string;
  isActive: boolean;
  /**
   * Vì sao CHƯA đóng được, do trang tính sẵn. `null` = đóng được.
   *
   * Chốt thật nằm trong `toggleStrategyAction`; đây chỉ nói trước cùng một điều.
   */
  blockedReason?: string | null;
}) {
  const [state, action, pending] = useActionState(toggleStrategyAction, EMPTY);
  const biChan = isActive && Boolean(blockedReason);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={strategyId} />
      <button
        type="submit"
        disabled={pending || biChan}
        title={
          biChan
            ? (blockedReason ?? undefined)
            : isActive
              ? 'Đóng chiến lược. Lịch sử phân bổ của các lệnh cũ vẫn giữ nguyên.'
              : 'Mở lại chiến lược'
        }
        className={`rounded-md px-2 py-1 text-tiny transition disabled:opacity-60 ${
          biChan ? 'cursor-not-allowed text-ink-600' : 'text-ink-500 hover:text-slate-soft'
        }`}
      >
        {pending ? '…' : isActive ? 'Đóng' : 'Mở lại'}
      </button>

      {biChan ? (
        <span className="mt-1 block max-w-72 text-tiny leading-relaxed text-ink-500">
          {blockedReason}
        </span>
      ) : null}

      {state.message && !state.ok ? (
        <span className="ml-2 text-tiny text-down-500">{state.message}</span>
      ) : null}
    </form>
  );
}
