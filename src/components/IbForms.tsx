'use client';

/**
 * FORM KHAI DANH MỤC IB — dùng ở trang Cơ cấu tổ chức.
 *
 * Cùng khuôn với `OrgForms.tsx` (phòng ban, nhóm): nút gọn nằm trong bảng, bấm mới mở
 * form ra. Danh mục IB là thứ khai một lần rồi thỉnh thoảng bổ sung, nên một form mở
 * sẵn suốt ngày chỉ chiếm chỗ của cái bảng mà người ta vào đây để đọc.
 */

import { useActionState, useState } from 'react';
import { saveIbAction, toggleIbAction, type ActionResult } from '@/admin/ib-actions';

const EMPTY: ActionResult = { ok: false };

const inputCls =
  'w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-strong ' +
  'placeholder:text-ink-500 focus:border-accent-500 focus:outline-none';
const labelCls = 'mb-1 block text-tiny font-medium text-slate-muted';

export interface IbRow {
  id: string;
  code: string;
  name: string;
  note: string | null;
  sortOrder: number;
  isActive: boolean;
  accountCount: number;
  /** bps; null = chưa khai riêng, theo mức chung. */
  buyFeeRateBps: number | null;
  sellFeeRateBps: number | null;
  sellTaxRateBps: number | null;
}

/** bps → chuỗi phần trăm cho ô nhập. null = để trống. */
function phanTram(bps: number | null): string {
  return bps === null ? '' : String(bps / 100);
}

/*
 * Ô TỶ LỆ: để trống nghĩa là THEO MỨC CHUNG, không phải bằng 0.
 *
 * Nói ra bằng chữ ngay dưới ô, vì một ô trống trong form thường bị đọc là "chưa
 * điền" — ở đây nó là một lựa chọn có nghĩa, và là lựa chọn nên dùng cho hầu hết
 * IB (luật đổi thì sửa một chỗ).
 */
function ORate({
  name,
  nhan,
  giaTri,
  mucChung,
  errors,
}: {
  name: string;
  nhan: string;
  giaTri: string;
  mucChung: string;
  errors?: string[];
}) {
  return (
    <label className="block">
      <span className={labelCls}>{nhan} (%)</span>
      <input
        name={name}
        inputMode="decimal"
        defaultValue={giaTri}
        placeholder={mucChung}
        className={`${inputCls} tabular`}
      />
      <span className="mt-1 block text-tiny text-ink-500">
        để trống = theo mức chung ({mucChung}%)
      </span>
      <Loi errors={errors} />
    </label>
  );
}

function Loi({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <span className="mt-1 block text-tiny text-down-500">{errors.join(' · ')}</span>;
}

function KetQua({ state }: { state: ActionResult }) {
  if (!state.message) return null;
  return (
    <p className={`mt-2 text-xs ${state.ok ? 'text-up-500' : 'text-down-500'}`} role="status">
      {state.message}
    </p>
  );
}

export function IbForm({
  ib,
  mucChungPhi,
  mucChungThue,
}: {
  ib?: IbRow;
  /** Mức chung hiện hành, dạng phần trăm — hiện làm gợi ý trong ô trống. */
  mucChungPhi: string;
  mucChungThue: string;
}) {
  const [mo, setMo] = useState(false);
  const [state, action, pending] = useActionState(saveIbAction, EMPTY);

  const moi = ib === undefined;

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
        {moi ? '+ Thêm IB' : 'Sửa'}
      </button>
    );
  }

  return (
    <form action={action} className="w-full rounded-lg border border-ink-700 bg-ink-850 p-4">
      {ib ? <input type="hidden" name="id" value={ib.id} /> : null}

      <p className="mb-3 text-xs font-medium text-strong">
        {moi ? 'IB mới' : `Sửa IB ${ib!.code}`}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/*
          MÃ CHỈ NHẬP ĐƯỢC KHI TẠO MỚI — giống mã phòng ban và mã nhóm. Đây là thứ người
          vận hành dùng để gọi tên IB giữa các bảng biểu ngoài hệ thống; đổi nó thì các
          bảng ấy trỏ vào một mã không còn ai nhận ra. Server cũng chặn, ô này khoá lại
          chỉ để khỏi mất công gõ.
        */}
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
            defaultValue={ib?.code}
            readOnly={!moi}
            placeholder="BUI_HAI"
            className={`${inputCls} font-mono ${moi ? '' : 'cursor-not-allowed text-slate-muted'}`}
          />
          <Loi errors={state.fieldErrors?.code} />
        </label>

        <label className="block">
          <span className={labelCls}>
            Tên IB <span className="text-down-500">*</span>
          </span>
          <input
            name="name"
            required
            defaultValue={ib?.name}
            placeholder="Bùi Hải"
            className={inputCls}
          />
          <Loi errors={state.fieldErrors?.name} />
        </label>

        <label className="block sm:col-span-2">
          <span className={labelCls}>Ghi chú</span>
          <input
            name="note"
            defaultValue={ib?.note ?? ''}
            placeholder="Sàn phụ trách, số điện thoại… — không bắt buộc"
            className={inputCls}
          />
          <Loi errors={state.fieldErrors?.note} />
        </label>

        <label className="block">
          <span className={labelCls}>Thứ tự hiển thị</span>
          <input
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={ib?.sortOrder ?? 0}
            className={`${inputCls} tabular w-28`}
          />
          <Loi errors={state.fieldErrors?.sortOrder} />
        </label>
      </div>

      <div className="mt-4 border-t border-ink-800 pt-3">
        <p className="mb-2 text-tiny font-medium text-strong">Biểu phí của IB này</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ORate
            name="buyFeeRateBps"
            nhan="Phí MUA"
            giaTri={phanTram(ib?.buyFeeRateBps ?? null)}
            mucChung={mucChungPhi}
            errors={state.fieldErrors?.buyFeeRateBps}
          />
          <ORate
            name="sellFeeRateBps"
            nhan="Phí BÁN"
            giaTri={phanTram(ib?.sellFeeRateBps ?? null)}
            mucChung={mucChungPhi}
            errors={state.fieldErrors?.sellFeeRateBps}
          />
          <ORate
            name="sellTaxRateBps"
            nhan="Thuế BÁN"
            giaTri={phanTram(ib?.sellTaxRateBps ?? null)}
            mucChung={mucChungThue}
            errors={state.fieldErrors?.sellTaxRateBps}
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-60"
        >
          {pending ? 'Đang lưu…' : moi ? 'Tạo IB' : 'Lưu'}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded-lg px-2 py-2 text-sm text-slate-muted transition hover:text-strong"
        >
          Đóng
        </button>
      </div>

      <KetQua state={state} />
    </form>
  );
}

/**
 * Bật / tắt một IB.
 *
 * KHÁC "ĐÓNG NHÓM": tắt IB KHÔNG bị chặn bởi số tài khoản đang gắn. Đóng một nhóm còn
 * người là để lại người không có nhóm — một trạng thái hỏng. Còn tắt một IB chỉ có
 * nghĩa "không khai mới theo IB này nữa"; tài khoản cũ vẫn trỏ đúng vào nó và vẫn hiện
 * đủ trong số liệu theo IB. Nút vẫn nói ra số tài khoản đang gắn để người bấm biết
 * mình đang động vào cái gì.
 */
export function ToggleIbButton({ ib }: { ib: IbRow }) {
  const [state, action, pending] = useActionState(toggleIbAction, EMPTY);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={ib.id} />
      <button
        type="submit"
        disabled={pending}
        title={
          ib.isActive
            ? ib.accountCount
              ? `Ngừng dùng. ${ib.accountCount} tài khoản đang gắn IB này vẫn giữ nguyên.`
              : 'Ngừng dùng — IB này sẽ không còn trong ô chọn khi khai tài khoản.'
            : 'Dùng lại IB này'
        }
        className="rounded-md px-2 py-1 text-tiny text-ink-500 transition hover:text-slate-soft disabled:opacity-60"
      >
        {pending ? '…' : ib.isActive ? 'Ngừng dùng' : 'Dùng lại'}
      </button>
      {state.message && !state.ok ? (
        <span className="ml-2 text-tiny text-down-500">{state.message}</span>
      ) : null}
    </form>
  );
}
