'use client';

import { useActionState, useState } from 'react';
import { setInitialCapitalAction, type ActionResult } from '@/accounts/actions';
import { MoneyInput } from '@/components/MoneyInput';

const EMPTY: ActionResult = { ok: false };

const inputCls =
  'w-full rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs text-strong ' +
  'placeholder:text-ink-500 focus:border-accent-500 focus:outline-none';
const labelCls = 'mb-1 block text-tiny font-medium text-slate-muted';

function vnd(x: bigint): string {
  return `${x.toLocaleString('vi-VN')} ₫`;
}

/**
 * Ô "VỐN BAN ĐẦU THỰC TẾ" của một tài khoản — xem src/accounts/initial-capital.ts.
 *
 * Người nhập gõ số tiền đã thật sự bỏ vào lúc đầu; ô bên dưới tính ngay khoản lỗ đã chốt
 * trước khi vào hệ thống = vốn thực tế − vốn đầu kỳ, để họ thấy con số sẽ được ghi
 * TRƯỚC khi bấm lưu. Để trống rồi lưu là bỏ khoản đã ghi.
 */
export function InitialCapitalForm({
  accountId,
  label,
  dauKy,
  vonThucTe,
  daGhi,
}: {
  accountId: string;
  label: string;
  /** Vốn đầu kỳ (giá vốn + tiền mặt lúc vào), chuỗi số VNĐ. */
  dauKy: string;
  /** Vốn ban đầu thực tế đang ghi, chuỗi số VNĐ. */
  vonThucTe: string;
  /** Đã có khoản lỗ được ghi chưa. */
  daGhi: boolean;
}) {
  const [mo, setMo] = useState(false);
  const [state, action, pending] = useActionState(setInitialCapitalAction, EMPTY);
  const [tien, setTien] = useState(daGhi ? vonThucTe : '');

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className="rounded-md border border-ink-700 px-2 py-1 text-tiny text-slate-soft transition hover:border-accent-500 hover:text-strong"
      >
        {daGhi ? 'Sửa' : 'Nhập vốn ban đầu'}
      </button>
    );
  }

  const so = tien.replace(/\D/g, '');
  const lo = so === '' ? 0n : BigInt(so) - BigInt(dauKy);

  return (
    <form action={action} className="mt-2 w-full rounded-lg border border-ink-700 bg-ink-850 p-3">
      <input type="hidden" name="accountId" value={accountId} />
      <p className="mb-2 text-tiny text-slate-muted">{label}</p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className={labelCls}>Vốn ban đầu thực tế</span>
          <MoneyInput name="amount" value={tien} onChange={setTien} className={inputCls} />
          {state.fieldErrors?.amount ? (
            <span className="mt-1 block text-tiny text-down-500">
              {state.fieldErrors.amount.join(' · ')}
            </span>
          ) : null}
        </label>
        <div className="text-tiny leading-relaxed text-slate-muted">
          <span className="block">Vốn đầu kỳ (giá vốn + tiền mặt lúc vào): {vnd(BigInt(dauKy))}</span>
          {so === '' ? (
            <span className="block">Để trống rồi lưu = bỏ khoản lỗ đã ghi.</span>
          ) : lo < 0n ? (
            <span className="block text-down-500">
              Thấp hơn vốn đầu kỳ — hiện chỉ ghi được khoản lỗ.
            </span>
          ) : (
            <span className="block">
              Lỗ đã chốt trước khi vào hệ thống:{' '}
              <span className="tabular font-medium text-down-500">{vnd(-lo)}</span>
            </span>
          )}
        </div>
      </div>

      <label className="mt-2 block">
        <span className={labelCls}>
          Lý do / nguồn số liệu <span className="text-down-500">*</span>
        </span>
        <input
          name="reason"
          required
          placeholder="Theo sao kê sàn từ ngày mở tài khoản"
          className={inputCls}
        />
        {state.fieldErrors?.reason ? (
          <span className="mt-1 block text-tiny text-down-500">
            {state.fieldErrors.reason.join(' · ')}
          </span>
        ) : null}
      </label>

      <p className="mt-1.5 text-tiny text-ink-500">
        Tiền mặt và vị thế không đổi. Vốn ban đầu tăng đúng bằng khoản lỗ, và khoản đó hiện ở
        &quot;Lãi/lỗ đã chốt&quot;.
      </p>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-500 disabled:bg-accent-600/40"
        >
          {pending ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded-lg px-2 py-1.5 text-xs text-slate-muted transition hover:text-strong"
        >
          Huỷ
        </button>
      </div>

      {state.message ? (
        <p className={`mt-1.5 text-tiny ${state.ok ? 'text-up-500' : 'text-down-500'}`} role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
