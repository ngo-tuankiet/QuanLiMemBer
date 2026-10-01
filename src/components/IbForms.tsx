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
import { BROKER, BROKER_LABEL_VI, BROKER_OPTIONS, type Broker } from '@/lib/enums';

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
  /** Công ty chứng khoán IB này làm việc. Quyết định tài khoản nào gắn được vào. */
  broker: Broker;
  brokerOther: string | null;
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
  const [san, setSan] = useState<Broker>(ib?.broker ?? BROKER.SSI);

  const moi = ib === undefined;

  /*
   * Ô SÀN KHÔNG CÒN BỊ KHOÁ.
   *
   * Bản trước khoá cứng khi IB đã có tài khoản. Nó chặn luôn ca cần sửa nhất: khi
   * chính cột sàn bị điền sai, mọi IB có tài khoản đều mắc kẹt — sàn sai, không sửa
   * được, và cũng không chuyển tài khoản đi đâu được vì ô chọn IB đã lọc theo đúng
   * cái sàn sai đó.
   *
   * Server vẫn chặn khi sàn mới KHÔNG khớp với tài khoản đang gắn, và nói rõ tài
   * khoản nào cản. Ở đây chỉ nhắc trước để người dùng không phải thử rồi mới biết.
   */
  const soTaiKhoan = moi ? 0 : ib!.accountCount;

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

        {/*
          SÀN — THỨ QUYẾT ĐỊNH IB NÀY NHẬN ĐƯỢC TÀI KHOẢN NÀO.

          Một IB làm việc cho đúng một công ty chứng khoán. Ô chọn IB ở form khai tài
          khoản lọc theo chính trường này, nên khai sai sàn ở đây thì IB đó biến mất
          khỏi ô chọn của đúng những tài khoản đáng lẽ thuộc về nó.
        */}
        <label className="block">
          <span className={labelCls}>
            Công ty chứng khoán <span className="text-down-500">*</span>
          </span>
          <select
            name="broker"
            value={san}
            onChange={(e) => setSan(e.target.value as Broker)}
            className={inputCls}
          >
            {BROKER_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {BROKER_LABEL_VI[b]}
              </option>
            ))}
          </select>
          {/*
            NHẮC TRƯỚC ĐIỀU KIỆN, thay vì khoá ô rồi để người dùng đoán.

            Sửa được hay không phụ thuộc vào các tài khoản đang gắn, mà form không có
            dữ liệu đó — nên nó chỉ nói điều kiện. Server mới là chỗ đối chiếu và nêu
            tên tài khoản nào cản.
          */}
          {soTaiKhoan > 0 ? (
            <span className="mt-1 block text-tiny text-ink-500">
              IB này đang gắn {soTaiKhoan} tài khoản — chỉ đổi được sang sàn mà cả{' '}
              {soTaiKhoan} tài khoản đó đang mở.
            </span>
          ) : null}
          <Loi errors={state.fieldErrors?.broker} />
        </label>

        {san === BROKER.OTHER ? (
          <label className="block">
            <span className={labelCls}>
              Tên công ty chứng khoán <span className="text-down-500">*</span>
            </span>
            <input
              name="brokerOther"
              defaultValue={ib?.brokerOther ?? ''}
              placeholder="Tên công ty"
              className={inputCls}
            />
            <Loi errors={state.fieldErrors?.brokerOther} />
          </label>
        ) : null}

        <label className="block sm:col-span-2">
          <span className={labelCls}>Ghi chú</span>
          <input
            name="note"
            defaultValue={ib?.note ?? ''}
            placeholder="Số điện thoại, đầu mối liên hệ… — không bắt buộc"
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
