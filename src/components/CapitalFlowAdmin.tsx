'use client';

import { useActionState, useState } from 'react';
import {
  deleteCapitalFlowAction,
  updateCapitalFlowAction,
  type ActionResult,
} from '@/accounts/actions';
import { MoneyInput } from '@/components/MoneyInput';

const EMPTY: ActionResult = { ok: false };

const inputCls =
  'w-full rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs text-strong ' +
  'placeholder:text-ink-500 focus:border-accent-500 focus:outline-none';
const labelCls = 'mb-1 block text-tiny font-medium text-slate-muted';

export interface DongVon {
  id: string;
  /** CONTRIBUTION | WITHDRAWAL */
  flowType: string;
  status: string;
  /** Chuỗi để không mất độ chính xác của bigint khi qua ranh giới server → client. */
  amount: string;
  /** yyyy-mm-dd, dạng ô `<input type="date">` nhận thẳng. */
  occurredAt: string;
  note: string | null;
}

function Loi({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <span className="mt-1 block text-tiny text-down-500">{errors.join(' · ')}</span>;
}

function KetQua({ state }: { state: ActionResult }) {
  if (!state.message) return null;
  return (
    <p className={`mt-1.5 text-tiny ${state.ok ? 'text-up-500' : 'text-down-500'}`} role="status">
      {state.message}
    </p>
  );
}

/**
 * SỬA MỘT DÒNG NẠP / RÚT — số tiền, ngày, ghi chú.
 *
 * KHÔNG CÓ Ô ĐỔI LOẠI. Nạp và rút ngược dấu nhau, nên một lần bấm nhầm ở ô đó làm
 * sai gấp đôi số tiền thay vì sai một lần. Nhầm loại thì xoá rồi ghi lại — đường ghi
 * bình thường có đủ bộ kiểm (số dư, chốt duyệt với lệnh rút) mà đường sửa này không
 * đi qua.
 */
export function SuaDongVonForm({ flow }: { flow: DongVon }) {
  const [mo, setMo] = useState(false);
  const [state, action, pending] = useActionState(updateCapitalFlowAction, EMPTY);
  const [tien, setTien] = useState(flow.amount);

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className="rounded-md px-2 py-1 text-tiny text-ink-500 transition hover:text-slate-soft"
      >
        Sửa
      </button>
    );
  }

  return (
    <form action={action} className="w-full rounded-lg border border-ink-700 bg-ink-850 p-3">
      <input type="hidden" name="id" value={flow.id} />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="block">
          <span className={labelCls}>Số tiền</span>
          <MoneyInput name="amount" value={tien} onChange={setTien} className={inputCls} />
          <Loi errors={state.fieldErrors?.amount} />
        </label>
        <label className="block">
          <span className={labelCls}>Ngày</span>
          <input
            type="date"
            name="occurredAt"
            defaultValue={flow.occurredAt}
            className={inputCls}
          />
          <Loi errors={state.fieldErrors?.occurredAt} />
        </label>
        <label className="block">
          <span className={labelCls}>Ghi chú</span>
          <input name="note" defaultValue={flow.note ?? ''} className={inputCls} />
        </label>
      </div>

      <label className="mt-2 block">
        <span className={labelCls}>
          Lý do sửa <span className="text-down-500">*</span>
        </span>
        <input
          name="reason"
          required
          placeholder="Thành viên gõ thừa một số 0"
          className={inputCls}
        />
        <Loi errors={state.fieldErrors?.reason} />
      </label>

      <p className="mt-1.5 text-tiny text-ink-500">
        Tiền của danh mục và của nhóm được tính lại ngay — không có bảng nào lưu sẵn số dư.
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

      <KetQua state={state} />
    </form>
  );
}

/**
 * XOÁ HẲN MỘT DÒNG NẠP / RÚT.
 *
 * Hỏi lại NGAY TRONG TRANG, không dùng `confirm()` của trình duyệt: hộp thoại đó tắt
 * được, và một cơ chế xác nhận mà trình duyệt tắt được thì không phải cơ chế xác nhận.
 * Cùng lý do đã ghi ở `SubmitButton`.
 */
export function XoaDongVonForm({ flow }: { flow: DongVon }) {
  const [mo, setMo] = useState(false);
  const [state, action, pending] = useActionState(deleteCapitalFlowAction, EMPTY);

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className="rounded-md px-2 py-1 text-tiny text-ink-500 transition hover:text-down-500"
      >
        Xoá
      </button>
    );
  }

  return (
    <form action={action} className="w-full rounded-lg border border-down-500/30 bg-down-500/5 p-3">
      <input type="hidden" name="id" value={flow.id} />

      <p className="mb-2 text-tiny leading-relaxed text-down-500">
        Dòng này sẽ biến mất khỏi database. <strong className="font-semibold">Không hoàn tác
        được.</strong> Nhật ký chụp lại toàn bộ trước khi xoá — đó là bản ghi duy nhất còn lại.
      </p>

      <label className="block">
        <span className={labelCls}>
          Lý do xoá <span className="text-down-500">*</span>
        </span>
        <input
          name="reason"
          required
          placeholder="Thành viên khai trùng, khoản này không có thật"
          className={inputCls}
        />
        <Loi errors={state.fieldErrors?.reason} />
      </label>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-down-500/90 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-down-500 disabled:bg-down-500/30"
        >
          {pending ? 'Đang xoá…' : 'Xoá hẳn'}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded-lg px-2 py-1.5 text-xs text-slate-muted transition hover:text-strong"
        >
          Thôi
        </button>
      </div>

      <KetQua state={state} />
    </form>
  );
}
