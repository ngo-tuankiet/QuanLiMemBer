'use client';

/**
 * GHI NHẬN CỔ TỨC trên một vị thế đang giữ.
 *
 * MỘT ĐỢT, HAI PHẦN, MỘT FORM. Doanh nghiệp Việt Nam thường công bố một đợt chia gồm
 * cả tiền mặt lẫn cổ phiếu ("10% tiền mặt và 5% cổ phiếu"). Bắt người dùng nhập hai
 * lần là mời họ quên một nửa, và hai bản ghi rời rạc thì không còn biết chúng thuộc
 * cùng một đợt. Cả hai ô đều không bắt buộc, nhưng phải điền ít nhất một.
 *
 * NHẬP TIỀN TRÊN MỖI CỔ PHIẾU, KHÔNG NHẬP TỔNG. Thông báo của doanh nghiệp viết dưới
 * dạng "1.000 đồng/cp"; bắt người dùng tự nhân với số cổ phiếu đang nắm là mời một lỗi
 * số học vào dữ liệu tài chính. Form nhân sẵn và hiện ra để họ đối chiếu trước khi lưu.
 */

import { useActionState, useState } from 'react';
import { recordDividendAction, type ActionResult } from '@/trading/dividend-actions';
import { MoneyInput } from '@/components/MoneyInput';

const EMPTY: ActionResult = { ok: false };

const inputCls =
  'w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-strong ' +
  'placeholder:text-ink-500 focus:border-accent-500 focus:outline-none';
const labelCls = 'mb-1 block text-tiny font-medium text-slate-muted';

export interface DividendAccount {
  id: string;
  label: string;
}

export interface DividendHolding {
  stockId: string;
  symbol: string;
  companyName: string;
  quantity: number;
}

function Loi({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <span className="mt-1 block text-tiny text-down-500">{errors.join(' · ')}</span>;
}

const soNguyen = (v: string) => Number(v.replace(/[^\d]/g, '')) || 0;

export function DividendForm({
  portfolioId,
  accounts,
  holdingsByAccount,
}: {
  portfolioId: string;
  accounts: DividendAccount[];
  /** Mã đang giữ ở từng tài khoản — cổ tức chỉ trả trên thứ đang nắm. */
  holdingsByAccount: Record<string, DividendHolding[]>;
}) {
  const [state, action, pending] = useActionState(recordDividendAction, EMPTY);

  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [stockId, setStockId] = useState('');
  const [tienMoiCp, setTienMoiCp] = useState('');
  const [soCpThem, setSoCpThem] = useState('');

  const dangGiu = holdingsByAccount[accountId] ?? [];

  /*
   * ĐỔI TÀI KHOẢN THÌ BỎ MÃ KHÔNG CÒN GIỮ ĐƯỢC — cùng lý do và cùng cách làm với form
   * nhập lệnh: không xoá thì state giữ một mã tài khoản mới không có, `<select>` rơi
   * về mục trống nhưng giá trị gửi đi vẫn là mã cũ.
   */
  const [tkDaSoat, setTkDaSoat] = useState(accountId);
  if (accountId !== tkDaSoat) {
    setTkDaSoat(accountId);
    if (!dangGiu.some((h) => h.stockId === stockId)) setStockId('');
  }

  const chon = dangGiu.find((h) => h.stockId === stockId) ?? null;
  const tongTien = chon ? BigInt(soNguyen(tienMoiCp)) * BigInt(chon.quantity) : 0n;
  const themCp = soNguyen(soCpThem);

  const dienDuoc = chon !== null && (soNguyen(tienMoiCp) > 0 || themCp > 0);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="portfolioId" value={portfolioId} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={labelCls}>
            Tài khoản <span className="text-down-500">*</span>
          </span>
          <select
            name="brokerAccountId"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={inputCls}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <Loi errors={state.fieldErrors?.brokerAccountId} />
        </label>

        <label className="block">
          <span className={labelCls}>
            Mã cổ phiếu <span className="text-down-500">*</span>
          </span>
          <select
            name="stockId"
            value={stockId}
            onChange={(e) => setStockId(e.target.value)}
            className={inputCls}
          >
            <option value="">— chọn mã đang giữ —</option>
            {dangGiu.map((h) => (
              <option key={h.stockId} value={h.stockId}>
                {h.symbol} — {h.quantity.toLocaleString('vi-VN')} CP
              </option>
            ))}
          </select>
          {dangGiu.length === 0 ? (
            <span className="mt-1 block text-tiny text-ink-500">
              Tài khoản này chưa giữ mã nào — cổ tức chỉ trả trên vị thế đang nắm.
            </span>
          ) : null}
          <Loi errors={state.fieldErrors?.stockId} />
        </label>

        <label className="block">
          <span className={labelCls}>
            Ngày chia <span className="text-down-500">*</span>
          </span>
          <input
            name="occurredAt"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            className={inputCls}
          />
          <Loi errors={state.fieldErrors?.occurredAt} />
        </label>

        <label className="block">
          <span className={labelCls}>Ghi chú</span>
          <input name="note" placeholder="Không bắt buộc" className={inputCls} />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-ink-800 pt-4 sm:grid-cols-2">
        <div>
          <span className={labelCls}>Cổ tức TIỀN MẶT — đồng trên mỗi cổ phiếu</span>
          <MoneyInput
            name="cashPerShare"
            value={tienMoiCp}
            onChange={setTienMoiCp}
            placeholder="VD: 1.000"
            className={inputCls}
          />
          <Loi errors={state.fieldErrors?.cashPerShare} />
          {chon && soNguyen(tienMoiCp) > 0 ? (
            <p className="mt-1 text-tiny text-slate-muted">
              × {chon.quantity.toLocaleString('vi-VN')} CP ={' '}
              <span className="tabular text-up-500">
                {tongTien.toLocaleString('vi-VN')} ₫
              </span>
            </p>
          ) : (
            <p className="mt-1 text-tiny text-ink-500">Bỏ trống nếu đợt này không trả tiền.</p>
          )}
        </div>

        <div>
          <span className={labelCls}>Cổ tức BẰNG CỔ PHIẾU — số cổ phiếu nhận thêm</span>
          <input
            name="shareQuantity"
            inputMode="numeric"
            value={soCpThem}
            onChange={(e) => setSoCpThem(e.target.value)}
            placeholder="VD: 400"
            className={`${inputCls} tabular`}
          />
          <Loi errors={state.fieldErrors?.shareQuantity} />
          {chon && themCp > 0 ? (
            <p className="mt-1 text-tiny text-slate-muted">
              {chon.quantity.toLocaleString('vi-VN')} → {' '}
              <span className="tabular text-strong">
                {(chon.quantity + themCp).toLocaleString('vi-VN')} CP
              </span>{' '}
              — giá vốn không đổi nên giá vốn TB giảm theo
            </p>
          ) : (
            <p className="mt-1 text-tiny text-ink-500">
              Bỏ trống nếu đợt này không chia cổ phiếu.
            </p>
          )}
        </div>
      </div>

      {state.message ? (
        <p
          className={`text-xs ${state.ok ? 'text-up-500' : 'text-down-500'}`}
          role="status"
          aria-live="polite"
        >
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !dienDuoc}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-50"
        >
          {pending ? 'Đang ghi…' : 'Ghi nhận cổ tức'}
        </button>
        {!dienDuoc ? (
          <span className="text-tiny text-ink-500">
            Chọn mã và điền ít nhất một trong hai ô cổ tức.
          </span>
        ) : null}
      </div>
    </form>
  );
}
