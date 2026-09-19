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
  const [khoiLuong, setKhoiLuong] = useState('');
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

  /*
   * ĐỔI MÃ THÌ NẠP LẠI KHỐI LƯỢNG MẶC ĐỊNH = số đang giữ của mã MỚI.
   *
   * Giữ nguyên số của mã trước là cái bẫy tệ nhất có thể đặt ở đây: ô vẫn có số, vẫn
   * trông như đã điền đúng, và tiền cổ tức được tính trên khối lượng của một mã khác.
   * Chỉnh state ngay trong lượt render (không qua effect) nên không có một nhịp nào
   * mà người dùng nhìn thấy số cũ đứng cạnh mã mới.
   */
  const [maDaSoat, setMaDaSoat] = useState(stockId);
  if (stockId !== maDaSoat) {
    setMaDaSoat(stockId);
    setKhoiLuong(chon && chon.quantity > 0 ? String(chon.quantity) : '');
  }

  const soHuong = soNguyen(khoiLuong);
  const tongTien = BigInt(soNguyen(tienMoiCp)) * BigInt(soHuong);
  const themCp = soNguyen(soCpThem);

  /** Nhập nhiều hơn số đang giữ — đúng khi đã bán sau ngày chốt, sai khi gõ nhầm. */
  const vuotSoDangGiu = chon !== null && soHuong > chon.quantity;

  const dienDuoc = chon !== null && soHuong > 0 && (soNguyen(tienMoiCp) > 0 || themCp > 0);

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
            <option value="">— chọn mã —</option>
            {dangGiu.map((h) => (
              <option key={h.stockId} value={h.stockId}>
                {h.symbol} —{' '}
                {h.quantity > 0
                  ? `${h.quantity.toLocaleString('vi-VN')} CP`
                  : 'không còn giữ'}
              </option>
            ))}
          </select>
          {dangGiu.length === 0 ? (
            <span className="mt-1 block text-tiny text-ink-500">
              Tài khoản này chưa mua mã nào.
            </span>
          ) : null}
          <Loi errors={state.fieldErrors?.stockId} />
        </label>

        {/*
          KHỐI LƯỢNG ĐƯỢC HƯỞNG — sửa được, mặc định là số đang giữ.

          Trước đây con số này bị khoá bằng vị thế hiện tại, nên mọi đợt cổ tức có mua
          hoặc bán xen giữa ngày chốt và hôm nay đều tính sai — và sai im lặng, vì kết
          quả vẫn là một con số hợp lý.
        */}
        <label className="block">
          <span className={labelCls}>
            Khối lượng hưởng cổ tức <span className="text-down-500">*</span>
          </span>
          <input
            name="eligibleQuantity"
            inputMode="numeric"
            value={khoiLuong}
            onChange={(e) => setKhoiLuong(e.target.value)}
            disabled={chon === null}
            placeholder={chon ? 'VD: 4.200' : 'chọn mã trước'}
            className={`${inputCls} tabular`}
          />
          <Loi errors={state.fieldErrors?.eligibleQuantity} />
          {chon === null ? null : vuotSoDangGiu ? (
            <span className="mt-1 block text-tiny text-warn-500">
              Lớn hơn số đang giữ ({chon.quantity.toLocaleString('vi-VN')} CP) — chỉ đúng nếu
              bạn đã bán {(soHuong - chon.quantity).toLocaleString('vi-VN')} CP sau ngày chốt
              quyền.
            </span>
          ) : chon.quantity === 0 ? (
            <span className="mt-1 block text-tiny text-warn-500">
              Mã này đã bán hết — điền số cổ phiếu còn nắm tại ngày chốt quyền.
            </span>
          ) : (
            <span className="mt-1 block text-tiny text-ink-500">
              Mặc định là số đang giữ ({chon.quantity.toLocaleString('vi-VN')} CP). Sửa lại nếu
              bạn đã mua/bán sau ngày chốt quyền.
            </span>
          )}
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
          {chon && soNguyen(tienMoiCp) > 0 && soHuong > 0 ? (
            <p className="mt-1 text-tiny text-slate-muted">
              × {soHuong.toLocaleString('vi-VN')} CP ={' '}
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
            /*
              DÒNG NÀY NÓI VỀ VỊ THẾ, NÊN DÙNG SỐ ĐANG GIỮ, không phải số được hưởng.

              Cổ phiếu thưởng cộng vào thứ đang nắm trong tài khoản. Lấy số được hưởng để
              cộng sẽ vẽ ra một vị thế không tồn tại đúng lúc hai con số lệch nhau — tức
              đúng lúc người dùng cần đọc dòng này nhất.
            */
            <p className="mt-1 text-tiny text-slate-muted">
              đang giữ {chon.quantity.toLocaleString('vi-VN')} → {' '}
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
            {chon === null
              ? 'Chọn mã trước.'
              : soHuong === 0
                ? 'Điền khối lượng hưởng cổ tức.'
                : 'Điền ít nhất một trong hai ô cổ tức.'}
          </span>
        ) : null}
      </div>
    </form>
  );
}
