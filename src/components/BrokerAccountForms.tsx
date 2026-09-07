'use client';

/**
 * FORM TÀI KHOẢN CHỨNG KHOÁN — chỉ hiện với chính chủ.
 *
 * Trang cha đã quyết ai được thấy form (so `viewer.id` với `person.id`), nhưng đó
 * chỉ là lớp giao diện. Chốt thật nằm trong server action: nó tự đọc danh tính từ
 * phiên và từ chối mọi tài khoản không phải của người gọi. Form này ẩn đi là để
 * người khác không phải nhìn một thứ họ không dùng được, không phải để chặn.
 *
 * BA FORM RIÊNG THAY VÌ MỘT FORM CÓ CHẾ ĐỘ: thêm tài khoản, nạp/rút vốn, và đóng
 * tài khoản là ba việc với ba mức hệ quả khác nhau. Gộp vào một form nhiều nhánh
 * thì cái nhánh nguy hiểm nhất trông y như cái nhánh vô hại nhất.
 */

import { useActionState, useState } from 'react';
import {
  createBrokerAccountAction,
  depositCapitalAction,
  toggleBrokerAccountAction,
  withdrawCapitalAction,
  type ActionResult,
} from '@/accounts/actions';
import { BROKER, BROKER_LABEL_VI, BROKER_OPTIONS, type Broker } from '@/lib/enums';
import { MoneyInput } from '@/components/MoneyInput';

const EMPTY: ActionResult = { ok: false };

/** Một chiến lược chọn được cho vị thế đầu kỳ. */
export interface OpeningStrategy {
  id: string;
  nameVi: string;
}

/** Một IB chọn được. Trang cha chỉ truyền xuống IB đang bật. */
export interface IbOption {
  id: string;
  code: string;
  name: string;
}

/** Một dòng vị thế có sẵn đang được gõ. Giữ dạng chuỗi để không mất số 0 đầu. */
interface OpeningRow {
  symbol: string;
  qty: string;
  price: string;
  at: string;
  /** Chiến lược của CHÍNH mã này. Mỗi mã vào vì một luận điểm khác nhau. */
  strategyId: string;
}

const BLANK_ROW: OpeningRow = { symbol: '', qty: '', price: '', at: '', strategyId: '' };

/** Bỏ mọi ký tự không phải số — người Việt hay gõ 1.000.000 hoặc 1,000,000. */
const digits = (v: string) => v.replace(/[^\d]/g, '');

function Feedback({ state }: { state: ActionResult }) {
  if (!state.message && !state.fieldErrors) return null;

  const formError = state.fieldErrors?._form?.join(' · ');

  return (
    <p
      className={`mt-2 text-xs ${state.ok ? 'text-up-500' : 'text-down-500'}`}
      role="status"
      aria-live="polite"
    >
      {state.message ?? formError}
    </p>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <span className="mt-1 block text-tiny text-down-500">{errors.join(' · ')}</span>;
}

const inputCls =
  'w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-strong ' +
  'placeholder:text-ink-500 focus:border-accent-500 focus:outline-none';

const labelCls = 'mb-1 block text-tiny font-medium text-slate-muted';

/** Hôm nay ở dạng `yyyy-mm-dd` cho `<input type="date">`. */
function todayInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------------------
// Thêm tài khoản
// ---------------------------------------------------------------------------

export function AddBrokerAccountForm({
  strategies,
  ibs,
}: {
  /** Danh sách chiến lược đang bật, do trang cha truyền xuống. */
  strategies: OpeningStrategy[];
  /** Danh mục IB đang bật. Rỗng = quản trị chưa khai IB nào. */
  ibs: IbOption[];
}) {
  const [state, action, pending] = useActionState(createBrokerAccountAction, EMPTY);
  const [broker, setBroker] = useState<Broker>(BROKER.SSI);
  const [open, setOpen] = useState(false);

  /*
   * KHAI VỊ THẾ CÓ SẴN — mặc định TẮT.
   *
   * Đa số tài khoản thêm vào là tài khoản đang dùng, không phải tài khoản mới mở.
   * Nhưng mở sẵn một bảng trống sẽ làm form dài gấp ba và người mở tài khoản mới
   * phải cuộn qua thứ họ không cần. Bật bằng một ô tích.
   */
  const [hasOpening, setHasOpening] = useState(false);
  const macDinh = strategies[0]?.id ?? '';
  const [rows, setRows] = useState<OpeningRow[]>([{ ...BLANK_ROW, strategyId: macDinh }]);
  const [cash, setCash] = useState('');

  const setRow = (i: number, patch: Partial<OpeningRow>) =>
    setRows((prev) => prev.map((r, j) => (i === j ? { ...r, ...patch } : r)));

  /** Đặt một chiến lược cho MỌI dòng — tiện khi cả lô cùng một luận điểm. */
  const datChoMoiDong = (id: string) =>
    setRows((prev) => prev.map((r) => ({ ...r, strategyId: id })));

  /*
   * VỐN SẼ GHI NHẬN = Σ (khối lượng × giá vốn) + tiền mặt còn.
   *
   * Hiện ngay trên form vì đây là con số làm tăng tiền của cả danh mục. Người khai
   * cần thấy nó TRƯỚC khi bấm lưu, không phải phát hiện ra sau trên Dashboard.
   */
  const costTotal = rows.reduce((sum, r) => {
    const q = Number(digits(r.qty)) || 0;
    const p = Number(digits(r.price)) || 0;
    return sum + q * p;
  }, 0);
  const cashNum = Number(digits(cash)) || 0;
  const grantedTotal = costTotal + cashNum;
  const filledRows = rows.filter((r) => r.symbol.trim().length > 0).length;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs font-medium text-slate-soft transition hover:border-accent-500 hover:text-accent-400"
      >
        + Thêm tài khoản
      </button>
    );
  }

  return (
    <form action={action} className="rounded-xl border border-ink-700 bg-ink-850 p-4">
      <p className="mb-3 text-sm font-medium text-strong">Thêm tài khoản chứng khoán</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className={labelCls}>Sàn</span>
          <select
            name="broker"
            value={broker}
            onChange={(e) => setBroker(e.target.value as Broker)}
            className={inputCls}
          >
            {BROKER_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {BROKER_LABEL_VI[b]}
              </option>
            ))}
          </select>
        </label>

        {/*
          Ô tên sàn chỉ hiện khi chọn "Khác". Hiện sẵn một ô luôn trống bên cạnh ô
          chọn làm người dùng tưởng phải điền cả hai.
        */}
        {broker === BROKER.OTHER ? (
          <label className="block">
            <span className={labelCls}>Tên sàn</span>
            <input name="brokerOther" className={inputCls} placeholder="Tên công ty chứng khoán" />
            <FieldError errors={state.fieldErrors?.brokerOther} />
          </label>
        ) : null}

        <label className="block">
          <span className={labelCls}>Số tài khoản</span>
          <input
            name="accountNo"
            required
            className={`${inputCls} font-mono`}
            placeholder="VD: 0123456789"
          />
          <FieldError errors={state.fieldErrors?.accountNo} />
        </label>

        {/*
          CHỌN IB, KHÔNG GÕ IB.

          Ô này từng là input tự do. Hệ quả: "Bùi Hải", "bùi hải" và "Bui Hai" cùng
          tồn tại, rồi trên Dashboard một IB tách thành ba dòng mỗi dòng một phần vốn.
          Danh mục do quản trị khai ở Cơ cấu tổ chức; ở đây chỉ chọn.

          "Mở trực tiếp" là một lựa chọn THẬT chứ không phải ô trống bị bỏ quên — hệ
          thống gộp nhóm này thành một dòng riêng trên Dashboard, nên nó được nói ra
          bằng chữ thay vì để người dùng đoán ý nghĩa của việc không chọn gì.
        */}
        <label className="block">
          <span className={labelCls}>Dưới IB nào</span>
          <select name="ibId" defaultValue="" className={inputCls}>
            <option value="">— Mở trực tiếp, không qua IB —</option>
            {ibs.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} · {x.name}
              </option>
            ))}
          </select>
          <FieldError errors={state.fieldErrors?.ibId} />
          {ibs.length === 0 ? (
            <span className="mt-1 block text-tiny text-ink-500">
              Chưa có IB nào trong danh mục — quản trị khai ở Cơ cấu tổ chức. Tạm thời
              chỉ khai được tài khoản mở trực tiếp.
            </span>
          ) : null}
        </label>

        <label className="block">
          <span className={labelCls}>Ghi chú</span>
          <input name="note" className={inputCls} placeholder="Không bắt buộc" />
        </label>
      </div>

      {/*
        HAI ĐƯỜNG VÀO KHÁC NHAU CHO HAI TÌNH HUỐNG KHÁC NHAU.

          Tài khoản MỚI MỞ, chưa có gì  → tạo xong, bấm "Nạp vốn" trên dòng của nó.
          Tài khoản ĐANG DÙNG, đã có vị thế → tích ô dưới đây và khai luôn.

        Không gộp làm một: khai số dư đầu kỳ ghi ra nhiều lệnh MUA và một khoản vốn,
        còn nạp vốn chỉ ghi một dòng tiền. Hai việc khác hẳn nhau về hệ quả.
      */}
      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5">
        <input
          type="checkbox"
          checked={hasOpening}
          onChange={(e) => setHasOpening(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          <span className="block text-xs font-medium text-strong">
            Tài khoản này đã có sẵn vị thế từ trước
          </span>
          <span className="block text-tiny text-ink-500">
            Khai mã, khối lượng, giá vốn, ngày mua và tiền mặt còn lại. Các con số này được
            ghi thẳng vào hệ thống chung — vị thế, lãi/lỗ, tỷ trọng ngành đều tính từ chúng.
          </span>
        </span>
      </label>

      {hasOpening ? (
        <div className="mt-3 rounded-lg border border-ink-700 p-3">
          <input type="hidden" name="openingCount" value={rows.length} />

          {/*
            Ô này KHÔNG còn là "chiến lược cho cả lô" — nó chỉ điền nhanh vào mọi dòng.

            Chiến lược thật nằm ở từng dòng trong bảng: một tài khoản đang dùng thì mỗi
            mã vào vì một luận điểm khác nhau, gán chung một chiến lược cho cả tài khoản
            làm lãi/lỗ theo chiến lược sai ngay từ ngày đầu. Nhưng khi cả lô thật sự
            cùng một phương pháp thì bấm một lần vẫn nhanh hơn sửa từng dòng.
          */}
          <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
            <label className="block">
              <span className={labelCls}>Đặt chiến lược cho mọi dòng</span>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) datChoMoiDong(e.target.value);
                }}
                className={inputCls}
                aria-label="Đặt một chiến lược cho mọi dòng"
              >
                <option value="">— chọn để áp cho mọi dòng —</option>
                {strategies.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.nameVi}
                  </option>
                ))}
              </select>
            </label>
            <p className="max-w-sm text-tiny text-ink-500">
              Mỗi mã có chiến lược riêng ở cột cuối. Ô bên trái chỉ để điền nhanh cùng một
              chiến lược cho mọi dòng khi cả lô cùng một phương pháp.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-xs">
              <thead>
                <tr className="text-left text-slate-muted">
                  <th className="pb-1.5 font-medium">Mã</th>
                  <th className="pb-1.5 font-medium">Khối lượng</th>
                  <th className="pb-1.5 font-medium">Giá vốn / cp</th>
                  <th className="pb-1.5 font-medium">Ngày mua</th>
                  <th className="pb-1.5 font-medium">Chiến lược</th>
                  <th className="pb-1.5 text-right font-medium">Thành tiền</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const line = (Number(digits(r.qty)) || 0) * (Number(digits(r.price)) || 0);
                  return (
                    <tr key={i}>
                      <td className="py-1 pr-2">
                        <input
                          name={`opening_${i}_symbol`}
                          value={r.symbol}
                          onChange={(e) => setRow(i, { symbol: e.target.value.toUpperCase() })}
                          placeholder="MBB"
                          className={`${inputCls} w-20 font-mono`}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        {/*
                          Khối lượng cũng dùng `MoneyInput` dù không phải tiền: nó gửi
                          lên số thuần, và đó là điều BẮT BUỘC ở đây. Khối lượng đi qua
                          `z.coerce.number()`, nên "10.000" sẽ được đọc thành 10 — sai
                          một nghìn lần, không lỗi nào được ném ra.
                        */}
                        <MoneyInput
                          name={`opening_${i}_qty`}
                          value={r.qty}
                          onChange={(v) => setRow(i, { qty: v })}
                          placeholder="1.000"
                          className={`${inputCls} tabular w-24`}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <MoneyInput
                          name={`opening_${i}_price`}
                          value={r.price}
                          onChange={(v) => setRow(i, { price: v })}
                          placeholder="25.000"
                          className={`${inputCls} tabular w-28`}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="date"
                          name={`opening_${i}_at`}
                          value={r.at}
                          onChange={(e) => setRow(i, { at: e.target.value })}
                          className={`${inputCls} w-36`}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <select
                          name={`opening_${i}_strategyId`}
                          value={r.strategyId}
                          onChange={(e) => setRow(i, { strategyId: e.target.value })}
                          className={`${inputCls} w-40`}
                          aria-label={`Chiến lược cho ${r.symbol || `dòng ${i + 1}`}`}
                        >
                          {strategies.map((st) => (
                            <option key={st.id} value={st.id}>
                              {st.nameVi}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="tabular py-1 text-right text-slate-soft">
                        {line > 0 ? line.toLocaleString('vi-VN') : '—'}
                      </td>
                      <td className="py-1 pl-2 text-right">
                        {rows.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                            className="text-ink-500 transition hover:text-down-500"
                            aria-label="Xoá dòng"
                          >
                            ✕
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            /*
             * Dòng mới kế thừa chiến lược của dòng cuối, không rơi về mặc định. Người
             * khai thường nhập vài mã liền nhau cùng một luận điểm; kế thừa thì họ chỉ
             * đổi ở dòng nào thật sự khác.
             */
            onClick={() =>
              setRows((prev) => [
                ...prev,
                { ...BLANK_ROW, strategyId: prev[prev.length - 1]?.strategyId ?? macDinh },
              ])
            }
            className="mt-2 text-tiny text-accent-400 transition hover:underline"
          >
            + Thêm dòng
          </button>

          <div className="mt-3 flex flex-wrap items-end gap-4 border-t border-ink-800 pt-3">
            <label className="block">
              <span className={labelCls}>Tiền mặt còn trong tài khoản</span>
              <MoneyInput
                name="openingCash"
                value={cash}
                onChange={setCash}
                placeholder="0"
                className={`${inputCls} tabular w-44`}
              />
              <FieldError errors={state.fieldErrors?.cashRemaining} />
            </label>

            {/*
              TỔNG VỐN SẼ GHI NHẬN — hiện ra trước khi bấm lưu.

              Người khai chỉ nhập "tiền mặt còn", nhưng con số vào hệ thống là giá vốn
              các vị thế CỘNG tiền mặt. Không nói ra thì họ sẽ ngạc nhiên khi thấy tiền
              của danh mục tăng nhiều hơn số họ gõ.
            */}
            <div className="tabular rounded-lg border border-ink-700 bg-ink-900 px-3 py-2">
              <span className="block text-tiny text-slate-muted">Vốn sẽ ghi nhận vào hệ thống</span>
              <span className="block text-sm font-medium text-strong">
                {grantedTotal.toLocaleString('vi-VN')} ₫
              </span>
              <span className="block text-tiny text-ink-500">
                = giá vốn {costTotal.toLocaleString('vi-VN')} + tiền mặt{' '}
                {cashNum.toLocaleString('vi-VN')}
              </span>
            </div>

            <p className="max-w-xs text-tiny text-ink-500">
              {filledRows} vị thế sẽ được ghi thành {filledRows} lệnh MUA đã khớp, đúng ngày bạn
              nhập. Số dư tiền của tài khoản sau đó bằng đúng phần tiền mặt còn.
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-tiny text-ink-500">
          Tạo tài khoản xong rồi bấm <span className="text-slate-soft">Nạp vốn</span> trên dòng
          của nó để ghi nhận tiền — nạp vốn làm tăng số dư tiền của danh mục nên nó là một
          thao tác riêng.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-60"
        >
          {pending ? 'Đang lưu…' : 'Lưu tài khoản'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-3 py-2 text-sm text-slate-muted transition hover:text-strong"
        >
          Huỷ
        </button>
      </div>

      <Feedback state={state} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Nạp / rút vốn
// ---------------------------------------------------------------------------

export function CapitalFlowForm({
  accountId,
  label,
  available,
}: {
  accountId: string;
  label: string;
  /**
   * Tiền CÒN LẠI trong tài khoản = vốn ròng đã nạp − chi mua + thu bán.
   *
   * Không phải "vốn ròng đã nạp" ở cột bên: tài khoản nạp 100 triệu rồi mua hết 100
   * triệu cổ phiếu thì vốn ròng vẫn 100 triệu nhưng tiền còn lại bằng 0. Trần khi rút
   * là con số này.
   *
   * Chuỗi để `bigint` qua được ranh giới server/client.
   */
  available: string;
}) {
  const [mode, setMode] = useState<'none' | 'DEPOSIT' | 'WITHDRAW'>('none');
  const [amount, setAmount] = useState('');
  const [state, action, pending] = useActionState(
    mode === 'WITHDRAW' ? withdrawCapitalAction : depositCapitalAction,
    EMPTY,
  );

  if (mode === 'none') {
    return (
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setMode('DEPOSIT')}
          className="rounded-md border border-up-500/40 px-2 py-1 text-tiny font-medium text-up-500 transition hover:bg-up-500/10"
        >
          Nạp vốn
        </button>
        <button
          type="button"
          onClick={() => setMode('WITHDRAW')}
          className="rounded-md border border-ink-700 px-2 py-1 text-tiny text-slate-muted transition hover:border-down-500/40 hover:text-down-500"
        >
          Rút
        </button>
      </span>
    );
  }

  const withdrawing = mode === 'WITHDRAW';

  /*
   * CHẶN Ở CẢ HAI ĐẦU. Chốt thật nằm trong `recordFlow` — form nào cũng gửi được
   * FormData bất kỳ. Phần này chỉ để người dùng biết TRƯỚC khi bấm, thay vì gõ xong
   * rồi nhận một câu từ chối.
   */
  const conLai = Number(available) || 0;
  const soTien = Number(String(amount).replace(/[.,\s]/g, '')) || 0;
  const vuotSoDu = withdrawing && soTien > conLai;
  const hetTien = withdrawing && conLai <= 0;

  return (
    <form action={action} className="w-full">
      <input type="hidden" name="brokerAccountId" value={accountId} />

      <p className="mb-2 text-tiny text-slate-muted">
        {withdrawing ? 'Rút vốn khỏi' : 'Nạp vốn vào'}{' '}
        <span className="font-mono text-strong">{label}</span>
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className={labelCls}>Số tiền (VNĐ)</span>
          <MoneyInput
            name="amount"
            value={amount}
            onChange={setAmount}
            required
            className={`${inputCls} tabular w-44 ${
              vuotSoDu || hetTien ? 'border-down-500' : ''
            }`}
            placeholder="500.000.000"
          />
          {withdrawing ? (
            <span className="mt-1 block text-tiny">
              {hetTien ? (
                <span className="text-down-500">
                  Không còn tiền để rút ({conLai.toLocaleString('vi-VN')} ₫)
                </span>
              ) : vuotSoDu ? (
                <span className="text-down-500">
                  Chỉ còn {conLai.toLocaleString('vi-VN')} ₫ — không rút được nhiều hơn
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setAmount(String(conLai))}
                  className="text-accent-400 transition hover:underline"
                >
                  Còn rút được {conLai.toLocaleString('vi-VN')} ₫ — rút hết
                </button>
              )}
            </span>
          ) : null}
          <FieldError errors={state.fieldErrors?.amount} />
        </label>

        <label className="block">
          <span className={labelCls}>Ngày</span>
          <input
            type="date"
            name="occurredAt"
            required
            defaultValue={todayInput()}
            className={`${inputCls} w-36`}
          />
          <FieldError errors={state.fieldErrors?.occurredAt} />
        </label>

        <label className="block min-w-40 flex-1">
          <span className={labelCls}>Ghi chú</span>
          <input name="note" className={inputCls} placeholder="Không bắt buộc" />
        </label>

        <button
          type="submit"
          disabled={pending || vuotSoDu || hetTien}
          className={`rounded-lg px-3 py-2 text-sm font-medium text-white transition disabled:opacity-60 ${
            withdrawing ? 'bg-down-500 hover:brightness-110' : 'bg-up-500 hover:brightness-110'
          }`}
        >
          {pending ? 'Đang ghi…' : withdrawing ? 'Ghi nhận rút' : 'Ghi nhận nạp'}
        </button>
        <button
          type="button"
          onClick={() => setMode('none')}
          className="rounded-lg px-2 py-2 text-sm text-slate-muted transition hover:text-strong"
        >
          Huỷ
        </button>
      </div>

      <p className="mt-2 text-tiny text-ink-500">
        {withdrawing
          ? 'Rút vốn GIẢM số dư tiền của danh mục, nên phải được cấp quản lý nhóm trở lên chấp nhận — số dư chỉ đổi sau khi có người đồng ý. Dùng cả khi cần sửa một lần nạp đã gõ sai.'
          : 'Nạp vốn TĂNG số dư tiền của danh mục và tiền của nhóm bạn. Ghi nhận ngay, không qua duyệt.'}
      </p>

      <Feedback state={state} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Đóng / mở lại tài khoản
// ---------------------------------------------------------------------------

export function ToggleAccountButton({
  accountId,
  isActive,
  blockedReason,
}: {
  accountId: string;
  isActive: boolean;
  /**
   * Vì sao CHƯA đóng được, do trang tính sẵn bằng `kiemDongTaiKhoan`. `null` = đóng
   * được.
   *
   * NÓI TRƯỚC, KHÔNG ĐỂ BẤM RỒI MỚI BIẾT. Chốt thật nằm trong
   * `toggleBrokerAccountAction` — nút này chỉ nói cùng một điều, sớm hơn. Hai bên gọi
   * cùng một hàm nên không thể nói khác nhau.
   */
  blockedReason?: string | null;
}) {
  const [state, action, pending] = useActionState(toggleBrokerAccountAction, EMPTY);

  const bịChan = isActive && Boolean(blockedReason);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={accountId} />
      <button
        type="submit"
        disabled={pending || bịChan}
        title={
          bịChan
            ? (blockedReason ?? undefined)
            : isActive
              ? 'Đóng tài khoản. Chỉ đóng được khi không còn mã nào và không còn tiền. Lịch sử nạp/rút vẫn giữ nguyên.'
              : 'Mở lại tài khoản'
        }
        className={`rounded-md px-2 py-1 text-tiny transition disabled:opacity-60 ${
          bịChan
            ? 'cursor-not-allowed text-ink-600'
            : 'text-ink-500 hover:text-slate-soft'
        }`}
      >
        {pending ? '…' : isActive ? 'Đóng TK' : 'Mở lại'}
      </button>

      {/*
        Lý do hiện NGAY CẠNH nút, không chỉ nằm trong `title`: tooltip không thấy được
        trên thiết bị chạm, và đây đúng là thông tin người dùng cần để hành động.
      */}
      {bịChan ? (
        <span className="ml-1 block max-w-56 text-tiny leading-relaxed text-ink-500">
          {blockedReason}
        </span>
      ) : null}

      {state.message && !state.ok ? (
        <span className="ml-2 text-tiny text-down-500">{state.message}</span>
      ) : null}
    </form>
  );
}
