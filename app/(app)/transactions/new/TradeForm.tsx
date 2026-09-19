'use client';

import { useMemo, useState } from 'react';
import { createTradeAction } from '@/trading/actions';
import { ActionForm, FormMessage, SubmitButton } from '@/components/ActionForm';
import { Field } from '@/components/ui';
import { formatVnd, allocateAmount, bpsFromWeights } from '@/lib/money';
import { MoneyInput } from '@/components/MoneyInput';
import { TRANSACTION_TYPE } from '@/lib/enums';
import type { TradeRates } from '@/trading/fee-rates.shared';

export interface StockOption {
  symbol: string;
  companyName: string;
  exchange: string;
  sectorNameVi: string;
  currentPrice: string | null;
  heldQuantity: number;
}

/** Một tài khoản chứng khoán của chính người đang nhập lệnh, kèm số dư. */
export interface AccountOption {
  id: string;
  label: string;
  accountNo: string;
  /** Tiền còn dùng được ở tài khoản này, dạng chuỗi để giữ nguyên `bigint`. */
  available: string;
}

export interface StrategyOption {
  id: string;
  code: string;
  nameVi: string;
  colorHex: string | null;
}

/** Định dạng số nguyên VNĐ theo kiểu Việt: 253000000 → "253.000.000" */
function fmt(n: number): string {
  return Math.round(n).toLocaleString('vi-VN');
}

/**
 * Form nhập giao dịch (§6, §8).
 *
 * Hai việc trọng yếu mà form này phải làm đúng:
 *
 *   1. **Chặn tại nguồn khi tổng phân bổ ≠ 100%.** Nút gửi bị vô hiệu, và tổng
 *      hiện ngay bên cạnh. Server vẫn kiểm tra lại bằng zod — nhưng để người dùng
 *      bấm gửi rồi mới báo lỗi là thiết kế tệ với form nhập liệu nhiều bước.
 *
 *   2. **Hiện trước số tiền của từng chiến lược.** Người nhập phải thấy
 *      "Value 50% = 126.500.000 ₫" trước khi gửi, không phải đoán.
 *
 * Phép tính xem trước ở đây dùng `number` cho nhanh và chỉ để HIỂN THỊ. Con số
 * ghi vào database do server tính lại bằng `bigint` + thuật toán largest-remainder,
 * nên không có nguy cơ sai số dấu phẩy động lọt vào dữ liệu.
 */
/** Một chiến lược mà người này đang giữ mã đó theo. */
export interface HeldStrategy {
  strategyId: string;
  strategyNameVi: string;
  /** Trần khi bán theo chiến lược này. */
  quantity: number;
}

/** Một mã đang giữ Ở MỘT TÀI KHOẢN. Chỉ những mã ở đây mới bán được qua tài khoản đó. */
export interface HoldingOption {
  stockId: string;
  symbol: string;
  companyName: string;
  quantity: number;
  /** Giá đang lưu — điền sẵn vào ô giá, sửa được. Chuỗi để qua được ranh giới server/client. */
  quotePrice: string;
  byStrategy: HeldStrategy[];
}

/**
 * Chia `soBan` cổ phiếu theo ĐÚNG tỷ trọng đang giữ của từng chiến lược.
 *
 * Đi qua `bpsFromWeights` + `allocateAmount` chứ không chia tay, vì đó đúng là hai
 * phép server sẽ dùng lại: form điền sẵn một bộ số mà chính server từ chối là lỗi tệ
 * nhất có thể có ở đây. Largest-remainder cũng bảo đảm tổng khớp tuyệt đối, không rơi
 * mất một cổ phiếu vì làm tròn.
 *
 * Trả về chuỗi rỗng khi số bán không hợp lệ (0, hoặc vượt cả vị thế) — để ô trống chứ
 * không điền một con số bịa.
 */
function chiaTheoTyTrong(h: HoldingOption, soBan: number): Record<string, string> {
  const out: Record<string, string> = {};
  const tran = h.byStrategy.map((x) => x.quantity);

  if (soBan <= 0 || soBan > h.quantity) {
    for (const x of h.byStrategy) out[x.strategyId] = '';
    return out;
  }

  /*
   * BÁN HẾT THÌ LẤY ĐÚNG TRẦN, không đi qua phép chia.
   *
   * Bán hết là hành động thường gặp nhất, và câu trả lời đúng của nó là hiển nhiên:
   * mỗi chiến lược bán ra đúng số đang giữ. Cho nó đi qua bps rồi quay lại thì phép
   * làm tròn có thể đẩy một dòng LÊN TRÊN trần của chính nó — trần [3, 11, 47, 101,
   * 997, 4.999, 30.011] bán hết 36.168 điền dòng đầu thành 4 trong khi chỉ giữ 3.
   */
  if (soBan === h.quantity) {
    h.byStrategy.forEach((x) => {
      out[x.strategyId] = String(x.quantity);
    });
    return out;
  }

  const bps = bpsFromWeights(tran.map((x) => BigInt(x)));
  const chia = allocateAmount(BigInt(soBan), bps).map((x) => Number(x));

  /*
   * KẸP VÀO TRẦN RỒI DỒN PHẦN THỪA SANG DÒNG CÒN CHỖ.
   *
   * `bpsFromWeights` chỉ là nghịch đảo chính xác của `allocateAmount` khi tỷ trọng
   * biểu diễn được ở độ phân giải 0,01%. Trần [1, 999.999] cho ra 0 bps ở dòng đầu,
   * nên toàn bộ khối lượng dồn vào dòng sau và vượt trần của nó.
   *
   * Chỉ DI CHUYỂN các đơn vị đã chia, không tạo thêm, nên tổng vẫn bằng đúng khối
   * lượng bán. Dồn vào dòng còn nhiều chỗ nhất trước để tỷ trọng lệch ít nhất.
   */
  let thua = 0;
  for (let i = 0; i < chia.length; i++) {
    const t = tran[i] ?? 0;
    if (chia[i]! > t) {
      thua += chia[i]! - t;
      chia[i] = t;
    }
  }

  while (thua > 0) {
    const con = chia
      .map((v, i) => ({ i, cho: (tran[i] ?? 0) - v }))
      .filter((x) => x.cho > 0)
      .sort((a, b) => b.cho - a.cho);

    if (con.length === 0) break; // không thể xảy ra khi soBan <= tổng trần

    const them = Math.min(thua, con[0]!.cho);
    chia[con[0]!.i] = chia[con[0]!.i]! + them;
    thua -= them;
  }

  h.byStrategy.forEach((x, i) => {
    out[x.strategyId] = String(chia[i] ?? 0);
  });

  return out;
}

/**
 * Bộ khối lượng này có LƯU ĐƯỢC không.
 *
 * `trade_strategies` lưu tỷ lệ bps, không lưu khối lượng, và độ phân giải bps là
 * 0,01% — nên một chiến lược chiếm 1 trên 1.000.000 cổ phiếu làm tròn về 0 bps và
 * biến mất. Server từ chối đúng trường hợp đó (thà từ chối còn hơn lưu một tỷ lệ
 * không biểu diễn được con số đã nhập).
 *
 * Chạy LẠI đúng phép kiểm đó ở client để form nói trước, thay vì để người bán bấm
 * Ghi lệnh rồi mới biết. Cùng hai hàm, cùng một kết luận.
 */
function luuDuoc(khoiLuong: number[], soBan: number): boolean {
  const guiDi = khoiLuong.filter((v) => v > 0);
  if (guiDi.length === 0) return false;

  const bps = bpsFromWeights(guiDi.map((x) => BigInt(x)));
  const dungLai = allocateAmount(BigInt(soBan), bps);
  return guiDi.every((v, i) => dungLai[i] === BigInt(v));
}

export function TradeForm({
  portfolioId,
  portfolioName,
  stocks,
  holdingsByAccount,
  accounts,
  strategies,
  ratesByAccount,
  defaultRates,
  approvalThreshold,
  canExecuteDirectly,
}: {
  portfolioId: string;
  portfolioName: string;
  stocks: StockOption[];
  /**
   * Vị thế theo TỪNG TÀI KHOẢN — khoá là `brokerAccountId`.
   *
   * Thị trường Việt Nam không có bán khống nên tab BÁN chỉ chọn được trong danh sách
   * này, không gõ tự do như tab MUA. Trần theo từng chiến lược cũng lấy từ đây.
   *
   * VÌ SAO THEO TÀI KHOẢN CHỨ KHÔNG THEO NGƯỜI. Cổ phiếu nằm ở một tài khoản cụ thể.
   * Gộp theo người thì chọn tài khoản VPBankS vẫn thấy MBB đang nằm ở tài khoản SSI,
   * bán được, và tài khoản VPBankS thành âm 5.000 MBB. Đã xảy ra thật.
   *
   * Truyền sẵn cả bản đồ chứ không gọi lại server mỗi lần đổi tài khoản: người dùng
   * có vài tài khoản, và đổi tài khoản rồi chờ mạng để biết mình giữ gì là chậm một
   * cách không cần thiết.
   */
  holdingsByAccount: Record<string, HoldingOption[]>;
  /** Chỉ tài khoản ĐANG MỞ của chính người nhập. Trang cha chặn khi mảng rỗng. */
  accounts: AccountOption[];
  strategies: StrategyOption[];
  /** Biểu phí của từng tài khoản, tra theo id — xem chú thích ở trang cha. */
  ratesByAccount: Record<string, TradeRates>;
  /** Mức chung, dùng khi chưa chọn tài khoản nào. */
  defaultRates: TradeRates;
  approvalThreshold: string;
  canExecuteDirectly: boolean;
}) {
  const [type, setType] = useState<'BUY' | 'SELL'>(TRANSACTION_TYPE.BUY);
  const [symbol, setSymbol] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  /** Khối lượng bán theo từng chiến lược. Chỉ dùng ở tab BÁN. */
  const [sellQty, setSellQty] = useState<Record<string, string>>({});

  const laBan = type === TRANSACTION_TYPE.SELL;

  /*
   * Mặc định chọn tài khoản đầu tiên thay vì để trống.
   *
   * Người chỉ có một tài khoản — đa số — không phải bấm thêm một lần nào. Và ô bắt
   * buộc mà để trống sẵn thì lỗi "chưa chọn tài khoản" chỉ hiện ra sau khi bấm Lưu.
   */
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');

  const account = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );

  /*
   * BÁN ĐƯỢC GÌ PHỤ THUỘC TÀI KHOẢN ĐANG CHỌN, không phụ thuộc người đăng nhập.
   * Đổi tài khoản là đổi luôn danh sách mã bán được và trần từng chiến lược.
   */
  const holdings = useMemo(
    () => holdingsByAccount[accountId] ?? [],
    [holdingsByAccount, accountId],
  );

  const holding = holdings.find((h) => h.symbol === symbol) ?? null;

  /** Tổng số mã người này đang giữ ở CÁC tài khoản khác — để nói "có ở chỗ khác". */
  const oTaiKhoanKhac = useMemo(() => {
    const ma = new Set<string>();
    for (const [id, ds] of Object.entries(holdingsByAccount)) {
      if (id === accountId) continue;
      for (const h of ds) if (h.quantity > 0) ma.add(h.symbol);
    }
    return ma;
  }, [holdingsByAccount, accountId]);

  /*
   * ĐỔI TÀI KHOẢN THÌ BỎ MÃ KHÔNG CÒN GIỮ ĐƯỢC.
   *
   * Không xoá thì ô mã giữ lại một mã tài khoản mới không có, `<select>` rơi về mục
   * trống nhưng state vẫn là mã cũ — hai bên lệch nhau và form gửi đi một mã người
   * dùng không còn nhìn thấy.
   */
  const khoaTK = laBan ? accountId : '';
  const [tkDaSoat, setTkDaSoat] = useState('');

  if (khoaTK !== tkDaSoat) {
    setTkDaSoat(khoaTK);
    if (khoaTK !== '') {
      setSymbol((truoc) =>
        truoc === '' || (holdingsByAccount[khoaTK] ?? []).some((h) => h.symbol === truoc)
          ? truoc
          : '',
      );
    }
  }

  const stock = useMemo(
    () => stocks.find((s) => s.symbol === symbol.trim().toUpperCase()) ?? null,
    [stocks, symbol],
  );

  const qty = Number(quantity.replace(/[.,\s]/g, '')) || 0;
  const px = Number(price.replace(/[.,\s]/g, '')) || 0;

  const gross = qty * px;
  /*
   * MỨC PHÍ THEO TÀI KHOẢN ĐANG CHỌN.
   *
   * Chưa chọn tài khoản thì dùng mức chung — bảng vẫn dựng được, và con số sẽ đổi
   * ngay khi chọn. Thà hiện mức chung còn hơn để trống một bảng người dùng đang
   * nhìn vào để quyết định.
   */
  const rate = ratesByAccount[accountId] ?? defaultRates;
  const feeRateBps = laBan ? rate.sellFeeRateBps : rate.buyFeeRateBps;
  const taxRateBps = rate.sellTaxRateBps;

  const fees = Math.round((gross * feeRateBps) / 10_000);
  const tax = laBan ? Math.round((gross * taxRateBps) / 10_000) : 0;
  // BUY: tiền chi ra = gross + phí + thuế. SELL: tiền thu về = gross − phí − thuế.
  const net = type === TRANSACTION_TYPE.BUY ? gross + fees + tax : gross - fees - tax;

  /*
   * SỐ DƯ TÀI KHOẢN SAU LỆNH — mua thì trừ, bán thì cộng.
   *
   * Tính bằng `Number` chứ không `bigint` vì chỉ để HIỂN THỊ và so sánh; mọi con số
   * ghi xuống database vẫn đi qua `bigint` ở server. VNĐ nguyên trong khoảng vài
   * nghìn tỷ vẫn nằm gọn dưới `Number.MAX_SAFE_INTEGER`.
   */
  const availableNow = account ? Number(account.available) : 0;

  /** Số dư âm = vốn nạp chưa khai đủ cho tài khoản này. Không phải lỗi tính tiền. */
  const soDuAm = account !== null && availableNow < 0;
  const availableAfter =
    type === TRANSACTION_TYPE.BUY ? availableNow - net : availableNow + net;

  /*
   * THIẾU TIỀN THÌ CẢNH BÁO, KHÔNG CHẶN.
   *
   * Một dòng `trades` ghi lại một lần khớp ĐÃ xảy ra. Chặn ghi vì con số tiền của
   * hệ thống nói không đủ nghĩa là không ghi được một việc có thật — và tiền có thể
   * thiếu chỉ vì vốn nạp chưa được khai, hoặc vì lệnh dùng đòn bẩy ký quỹ. Cảnh báo
   * để người nhập nhìn lại, rồi vẫn cho ghi.
   */
  const shortOfCash = type === TRANSACTION_TYPE.BUY && net > 0 && availableAfter < 0;

  // Tổng phân bổ theo basis point, tính bằng số nguyên để 33.34 + 33.33 + 33.33
  // ra đúng 10000 chứ không phải 9999.999.
  const totalBps = Object.values(allocations).reduce((sum, v) => {
    const p = Number(String(v).replace(',', '.'));
    return sum + (Number.isFinite(p) && p > 0 ? Math.round(p * 100) : 0);
  }, 0);

  const active = strategies.filter((s) => {
    const p = Number(String(allocations[s.id] ?? '').replace(',', '.'));
    return Number.isFinite(p) && p > 0;
  });

  const allocationValid = totalBps === 10_000;

  // =========================================================================
  // LỆNH BÁN
  // =========================================================================
  /*
   * BÁN CHIA THEO KHỐI LƯỢNG, MUA CHIA THEO PHẦN TRĂM.
   *
   * Điều kiện phải thoả khi bán là điều kiện về khối lượng: "không bán quá số đã
   * mua theo chiến lược đó". Nếu ô nhập là phần trăm thì người bán phải tự nhẩm 30%
   * của 10.000 có vượt trần 8.400 hay không, và nhẩm sai thì bị server từ chối sau
   * khi đã điền xong cả form. Nhập thẳng khối lượng thì trần hiện ngay cạnh ô.
   */
  const sellRows = holding?.byStrategy ?? [];

  const soBan = (id: string): number =>
    Number(String(sellQty[id] ?? '').replace(/[.,\s]/g, '')) || 0;

  const tongBan = sellRows.reduce((t, r) => t + soBan(r.strategyId), 0);
  const vuotTran = sellRows.filter((r) => soBan(r.strategyId) > r.quantity);

  const overSell = type === TRANSACTION_TYPE.SELL && holding !== null && qty > holding.quantity;

  /*
   * "Chia đủ" nghĩa là tổng khối lượng theo chiến lược bằng ĐÚNG khối lượng bán —
   * cùng một điều kiện server kiểm. Đúng 100% ở tab MUA và đúng tổng ở tab BÁN là
   * hai cách nói của một việc: mỗi cổ phiếu phải thuộc về một chiến lược nào đó.
   */
  /*
   * Phép "lưu được" chỉ có nghĩa khi tổng đã khớp — nó dựng lại theo `qty`, nên chạy
   * lúc tổng còn lệch sẽ báo sai và làm người bán đi sửa nhầm chỗ.
   */
  const tongKhop = holding !== null && qty > 0 && tongBan === qty;
  const chiaLuuDuoc =
    !tongKhop ||
    vuotTran.length > 0 ||
    luuDuoc(sellRows.map((r) => soBan(r.strategyId)), qty);

  const sellValid = tongKhop && vuotTran.length === 0 && chiaLuuDuoc;

  /*
   * ĐIỀN SẴN GIÁ HIỆN TẠI KHI CHỌN MÃ.
   *
   * Chỉ chạy lúc ĐỔI MÃ, không chạy lại sau đó — nên người bán sửa giá xong mà chạm
   * vào khối lượng thì giá vừa sửa không bị giá thị trường ghi đè.
   */
  const khoaGia = type === TRANSACTION_TYPE.SELL && holding ? holding.stockId : '';
  const [giaDaDien, setGiaDaDien] = useState('');

  if (khoaGia !== giaDaDien) {
    setGiaDaDien(khoaGia);
    if (khoaGia !== '') {
      const g = holdings.find((h) => h.stockId === khoaGia)?.quotePrice ?? '0';
      if (g !== '0') setPrice(g);
    }
  }

  /*
   * ĐIỀN SẴN KHỐI LƯỢNG THEO ĐÚNG TỶ TRỌNG ĐANG GIỮ.
   *
   * Bán 10.000 trên vị thế 42.000 chia 21.000/12.600/8.400 → điền sẵn 5.000/3.000/
   * 2.000. Dùng `bpsFromWeights` + `allocateAmount` chứ không chia tay để phần dư đi
   * theo đúng largest-remainder, tổng luôn khớp tuyệt đối khối lượng bán — không bao
   * giờ điền sẵn một bộ số mà chính server sẽ từ chối.
   *
   * Khoá là (mã, khối lượng): sửa một dòng không làm khối chia chạy lại nên số vừa
   * sửa được giữ; đổi khối lượng bán thì chia lại, vì tổng buộc phải bằng số mới.
   */
  const khoaChia =
    type === TRANSACTION_TYPE.SELL && holding ? `${holding.stockId}|${qty}` : '';
  const [chiaDaDien, setChiaDaDien] = useState('');

  if (khoaChia !== chiaDaDien) {
    setChiaDaDien(khoaChia);
    if (khoaChia !== '') {
      const [stockId, rawQty] = khoaChia.split('|');
      const h = holdings.find((x) => x.stockId === stockId);
      if (h) setSellQty(chiaTheoTyTrong(h, Number(rawQty) || 0));
    }
  }

  const willNeedApproval =
    !canExecuteDirectly || (approvalThreshold !== '0' && net >= Number(approvalThreshold));

  const ready =
    Boolean(stock) &&
    qty > 0 &&
    px > 0 &&
    !overSell &&
    (type === TRANSACTION_TYPE.SELL ? sellValid : allocationValid);

  function setBan(id: string, value: string): void {
    setSellQty((prev) => ({ ...prev, [id]: value }));
  }

  function setAlloc(id: string, value: string): void {
    setAllocations((prev) => ({ ...prev, [id]: value }));
  }

  /** Chia đều cho các chiến lược đang có giá trị — phần dư dồn vào mục đầu. */
  function splitEvenly(): void {
    const ids = active.length > 0 ? active.map((s) => s.id) : [];
    if (ids.length === 0) return;

    const base = Math.floor(10_000 / ids.length);
    const remainder = 10_000 - base * ids.length;

    const next: Record<string, string> = {};
    ids.forEach((id, i) => {
      const bps = base + (i === 0 ? remainder : 0);
      next[id] = String(bps / 100);
    });
    setAllocations(next);
  }

  return (
    <ActionForm
      action={createTradeAction}
      hidden={{ portfolioId, transactionType: type }}
      className="space-y-5"
    >
      {(state) => (
        <>
          <FormMessage state={state} />

          {/* ---------------------------------------------------------- */}
          {/* Mua / Bán                                                  */}
          {/* ---------------------------------------------------------- */}
          <div className="flex gap-2">
            {([TRANSACTION_TYPE.BUY, TRANSACTION_TYPE.SELL] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                aria-pressed={type === t}
                className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${
                  type === t
                    ? t === TRANSACTION_TYPE.BUY
                      ? 'border-up-500 bg-up-500/15 text-up-500'
                      : 'border-down-500 bg-down-500/15 text-down-500'
                    : 'border-ink-700 text-slate-muted hover:border-ink-600 hover:text-slate-soft'
                }`}
              >
                {t === TRANSACTION_TYPE.BUY ? 'MUA' : 'BÁN'}
              </button>
            ))}
          </div>

          {/* ---------------------------------------------------------- */}
          {/* Tài khoản thực hiện                                        */}
          {/* ---------------------------------------------------------- */}
          {/*
            ĐẶT NGAY SAU MUA/BÁN, trước cả mã chứng khoán: tiền nằm ở tài khoản nào
            quyết định lệnh có thực hiện được không, nên nó phải được nhìn thấy
            trước khi gõ khối lượng chứ không phải sau.
          */}
          <div>
            <label htmlFor="brokerAccountId" className="field-label">
              Tài khoản thực hiện <span className="ml-1 text-down-500">*</span>
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <select
                id="brokerAccountId"
                name="brokerAccountId"
                required
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="field-input"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>

              <div
                className={`tabular rounded-lg border px-3 py-2 text-right ${
                  soDuAm ? 'border-warn-500/40 bg-warn-500/10' : 'border-ink-700 bg-ink-900'
                }`}
              >
                <span className="block text-tiny text-slate-muted">Tiền còn ở tài khoản</span>
                <span
                  className={`block text-sm font-medium ${soDuAm ? 'text-warn-500' : 'text-strong'}`}
                >
                  {account ? formatVnd(BigInt(account.available)) : '—'}
                </span>
              </div>
            </div>

            {/*
              SỐ DƯ ÂM KHÔNG PHẢI CHUYỆN TIỀN, MÀ LÀ CHUYỆN VỐN CHƯA KHAI.

              Tài khoản chứng khoán thật không bao giờ âm tiền. Con số âm ở đây luôn có
              một nghĩa: hệ thống thấy các lệnh MUA đi qua tài khoản này nhưng chưa thấy
              tiền vào từ đâu — thường vì lệnh có trước khi tài khoản được đưa vào hệ
              thống, hoặc vốn nạp được ghi ở mức danh mục thay vì mức tài khoản.

              In một con số âm trần thì người dùng đọc thành "hệ thống tính sai tiền của
              tôi". Nói ra lý do thì họ biết phải làm gì. Không CHẶN — xem `shortOfCash`:
              một lệnh đã khớp là việc có thật.
            */}
            {soDuAm ? (
              <p className="mt-1.5 text-tiny leading-relaxed text-warn-500">
                Số âm nghĩa là <span className="text-slate-soft">vốn nạp chưa được khai đủ</span>{' '}
                cho tài khoản này, không phải tài khoản đang nợ tiền: hệ thống thấy các lệnh
                MUA đi qua đây nhưng chưa thấy tiền vào từ đâu. Vào{' '}
                <span className="font-mono text-slate-soft">Tài khoản của tôi</span> bấm{' '}
                <span className="font-mono text-slate-soft">Nạp vốn</span> để ghi nhận. Vẫn
                nhập được lệnh bình thường.
              </p>
            ) : null}

            {/* Còn lại sau lệnh — chỉ hiện khi đã đủ thông tin để tính */}
            {account && net > 0 ? (
              <p
                className={
                  'tabular mt-1.5 text-tiny ' +
                  (shortOfCash ? 'text-down-500' : 'text-ink-500')
                }
              >
                {type === TRANSACTION_TYPE.BUY ? "Sau lệnh còn " : "Sau lệnh có "}
                <span className={shortOfCash ? "font-semibold" : "text-slate-soft"}>
                  {formatVnd(BigInt(Math.round(availableAfter)))}
                </span>
                {shortOfCash
                  ? " — vượt quá tiền đang có ở tài khoản này. Vẫn ghi được (lệnh có thể dùng ký quỹ, hoặc vốn nạp chưa khai), nhưng hãy kiểm tra lại."
                  : null}
              </p>
            ) : null}
          </div>

          {/* ---------------------------------------------------------- */}
          {/* Mã, khối lượng, giá                                        */}
          {/* ---------------------------------------------------------- */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="symbol" className="field-label">
                Mã chứng khoán <span className="ml-1 text-down-500">*</span>
              </label>
              {/*
                BÁN THÌ CHỌN, KHÔNG GÕ.

                Thị trường Việt Nam không có bán khống: lệnh bán luôn là đóng một phần
                vị thế đang có. Ô gõ tự do mời người dùng gõ một mã họ không giữ, rồi
                server từ chối — trong khi tập hợp bán được là hữu hạn và đã biết, nên
                nó là một danh sách chọn. Tab MUA vẫn gõ tự do trong 117 mã chuẩn.
              */}
              {laBan ? (
                <select
                  id="symbol"
                  name="symbol"
                  required
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className={`field font-mono ${holding ? 'border-up-500/40' : ''}`}
                >
                  <option value="">— Chọn mã đang giữ —</option>
                  {holdings.map((h) => (
                    <option key={h.stockId} value={h.symbol}>
                      {h.symbol} — {h.quantity.toLocaleString('vi-VN')} CP
                    </option>
                  ))}
                </select>
              ) : null}

              {!laBan ? (
                <input
                id="symbol"
                name="symbol"
                list="stock-options"
                required
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="MBB"
                autoComplete="off"
                className={`field font-mono ${
                  symbol && !stock ? 'border-down-500' : stock ? 'border-up-500/40' : ''
                }`}
                />
              ) : null}

              {!laBan ? (
              <datalist id="stock-options">
                {stocks.map((s) => (
                  <option key={s.symbol} value={s.symbol}>
                    {s.companyName}
                  </option>
                ))}
              </datalist>
              ) : null}

              {laBan && holdings.length === 0 ? (
                <p className="mt-1 text-xs text-warn-500">
                  Tài khoản này chưa giữ mã nào
                  {oTaiKhoanKhac.size > 0
                    ? ` — bạn có ${oTaiKhoanKhac.size} mã ở tài khoản khác`
                    : ''}
                  .
                </p>
              ) : laBan && !holding ? (
                <p className="mt-1 text-xs text-slate-muted">
                  {holdings.length} mã ở tài khoản này
                </p>
              ) : laBan && holding ? (
                <p className="mt-1 truncate text-xs text-slate-muted" title={holding.companyName}>
                  {holding.companyName}
                </p>
              ) : symbol && !stock ? (
                <p className="mt-1 text-xs text-down-500">
                  Mã không có trong danh mục chuẩn (§7).
                </p>
              ) : stock ? (
                <p className="mt-1 truncate text-xs text-slate-muted" title={stock.companyName}>
                  {stock.companyName}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-muted">Chọn từ danh mục chuẩn</p>
              )}
              {state?.fieldErrors?.symbol ? (
                <p className="mt-1 text-xs text-down-500">
                  {state.fieldErrors.symbol.join(' ')}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="quantity" className="field-label">
                Khối lượng <span className="ml-1 text-down-500">*</span>
              </label>
              {/*
                DẤU CHẤM NGĂN NGHÌN — xem `MoneyInput`.

                An toàn ở đây vì `createTradeAction` đã lọc dấu ngăn trước khi parse
                (`replace(/[.,\s]/g, '')`), và `MoneyInput` còn gửi lên số thuần qua ô
                ẩn. Hai lớp, cùng một hướng: server không bao giờ thấy dấu chấm.
              */}
              <MoneyInput
                id="quantity"
                name="quantity"
                required
                value={quantity}
                onChange={setQuantity}
                placeholder="40.000"
                className={`field tabular ${overSell ? 'border-down-500' : ''}`}
              />
              {/*
                "Đang giữ" ở đây là số CỦA NGƯỜI ĐANG NHẬP, không phải của cả danh mục.
                Cả danh mục có 52.000 MBB nhưng 42.000 nằm ở tài khoản người khác —
                hiện con số danh mục là mời người dùng bán số cổ phiếu không có trong
                tài khoản mình, rồi bị server từ chối.
              */}
              {laBan && holding ? (
                <p
                  className={`mt-1 text-xs ${overSell ? 'text-down-500' : 'text-slate-muted'}`}
                >
                  Bạn đang giữ {fmt(holding.quantity)} CP
                  {overSell ? ' — bán quá số đang giữ' : ''}
                </p>
              ) : (
                <p className="mt-1 text-xs text-slate-muted">Lô chẵn 100 CP trên HOSE</p>
              )}
              {state?.fieldErrors?.quantity ? (
                <p className="mt-1 text-xs text-down-500">
                  {state.fieldErrors.quantity.join(' ')}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="price" className="field-label">
                Giá (VNĐ) <span className="ml-1 text-down-500">*</span>
              </label>
              <MoneyInput
                id="price"
                name="price"
                required
                value={price}
                onChange={setPrice}
                placeholder="25.300"
                className="field tabular"
              />
              {stock?.currentPrice ? (
                <button
                  type="button"
                  onClick={() => setPrice(stock.currentPrice!)}
                  className="mt-1 text-xs text-accent-400 hover:text-accent-500"
                >
                  Giá hiện tại {Number(stock.currentPrice).toLocaleString('vi-VN')} — dùng giá này
                </button>
              ) : (
                <p className="mt-1 text-xs text-slate-muted">Số nguyên đồng</p>
              )}
              {state?.fieldErrors?.price ? (
                <p className="mt-1 text-xs text-down-500">{state.fieldErrors.price.join(' ')}</p>
              ) : null}
            </div>
          </div>

          {/* ---------------------------------------------------------- */}
          {/* Xem trước số tiền                                          */}
          {/* ---------------------------------------------------------- */}
          <div className="rounded-lg border border-ink-700 bg-ink-850 p-4">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-muted">Giá trị</dt>
                <dd className="tabular text-strong">{fmt(gross)} ₫</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-muted">Phí ({feeRateBps / 100}%)</dt>
                <dd className="tabular text-slate-soft">{fmt(fees)} ₫</dd>
              </div>
              {type === TRANSACTION_TYPE.SELL ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-muted">Thuế ({taxRateBps / 100}%)</dt>
                  <dd className="tabular text-slate-soft">{fmt(tax)} ₫</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-3 border-t border-ink-700 pt-2 sm:col-span-2">
                <dt className="font-medium text-strong">
                  {type === TRANSACTION_TYPE.BUY ? 'Tiền chi ra' : 'Tiền thu về'}
                </dt>
                <dd
                  className={`tabular font-semibold ${
                    type === TRANSACTION_TYPE.BUY ? 'text-down-500' : 'text-up-500'
                  }`}
                >
                  {fmt(net)} ₫
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-tiny text-ink-500">
              Phí và thuế để trống sẽ tự tính theo cấu hình hệ thống. Số tiền phân bổ do server tính
              lại bằng số nguyên, không dùng số thực.
            </p>
          </div>

          {/* ---------------------------------------------------------- */}
          {/* PHÂN BỔ CHIẾN LƯỢC — phần cốt lõi §6                       */}
          {/* ---------------------------------------------------------- */}

          {/*
            BÁN: mỗi chiến lược một dòng KHỐI LƯỢNG, có trần riêng.

            Trần từng dòng là số cổ phiếu người này đã mua theo chiến lược đó — dựng
            lại từ `trade_strategies` của các lệnh mua, không phải một con số lưu sẵn
            (§23). Bán 1.100 theo một chiến lược chỉ mua 1.000 làm chiến lược đó lỗ ảo
            và chiến lược thật lãi ảo, nên trần hiện ngay cạnh ô nhập thay vì để người
            bán phát hiện lúc bấm Ghi lệnh.
          */}
          {laBan ? (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-strong">
                    Bán theo chiến lược nào
                  </h3>
                  <p className="text-xs text-slate-muted">
                    Điền sẵn theo đúng tỷ trọng đang giữ — sửa được từng dòng. Tổng phải
                    bằng khối lượng bán{qty > 0 ? ` (${fmt(qty)} CP)` : ''}.
                  </p>
                </div>

                {holding && qty > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSellQty(chiaTheoTyTrong(holding, qty))}
                    className="rounded-md border border-ink-700 px-2.5 py-1 text-xs text-slate-muted hover:border-ink-600 hover:text-slate-soft"
                  >
                    Chia lại theo tỷ trọng
                  </button>
                ) : null}
              </div>

              {!holding ? (
                <p className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-4 text-center text-xs text-slate-muted">
                  Chọn mã đang giữ ở trên để xem các chiến lược đã mua theo.
                </p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-ink-700">
                  {sellRows.map((r) => {
                    const cl = strategies.find((x) => x.id === r.strategyId);
                    const n = soBan(r.strategyId);
                    const vuot = n > r.quantity;

                    return (
                      <div
                        key={r.strategyId}
                        className="flex items-center gap-3 border-b border-ink-800 px-3 py-2 last:border-0"
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: cl?.colorHex ?? 'var(--color-ink-500)' }}
                        />

                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-soft">
                            {r.strategyNameVi}
                          </span>
                          <span className="tabular text-micro text-ink-500">
                            đang giữ {fmt(r.quantity)} CP
                          </span>
                        </div>

                        <span className="tabular w-28 shrink-0 text-right text-xs text-slate-muted">
                          {n > 0 && px > 0 ? `${fmt(n * px)} ₫` : ''}
                        </span>

                        <div className="w-28 shrink-0">
                          <input
                            name={`qty_${r.strategyId}`}
                            inputMode="numeric"
                            value={sellQty[r.strategyId] ?? ''}
                            onChange={(e) => setBan(r.strategyId, e.target.value)}
                            placeholder="0"
                            aria-label={`Khối lượng bán theo ${r.strategyNameVi}, tối đa ${r.quantity}`}
                            className={`field tabular !py-1.5 text-right ${
                              vuot ? 'border-down-500' : ''
                            }`}
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() => setBan(r.strategyId, String(r.quantity))}
                          className="shrink-0 text-micro text-accent-400 hover:text-accent-500"
                          title={`Bán hết ${fmt(r.quantity)} CP theo chiến lược này`}
                        >
                          tối đa
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Vì sao chưa ghi được — nói đúng một điều đang thiếu, không nói cả bốn. */}
              {holding && vuotTran.length > 0 ? (
                <p className="mt-2 text-xs text-down-500">
                  Vượt trần: {vuotTran.map((r) => `${r.strategyNameVi} (tối đa ${fmt(r.quantity)})`).join(', ')}.
                </p>
              ) : holding && qty === 0 ? (
                <p className="mt-2 text-xs text-slate-muted">Điền khối lượng bán ở trên.</p>
              ) : holding && tongBan !== qty ? (
                <p className="mt-2 text-xs text-warn-500">
                  Đang chia {fmt(tongBan)} CP, phải bằng đúng {fmt(qty)} CP —{' '}
                  {tongBan < qty
                    ? `còn thiếu ${fmt(qty - tongBan)}.`
                    : `vượt ${fmt(tongBan - qty)}.`}
                </p>
              ) : !chiaLuuDuoc ? (
                <p className="mt-2 text-xs text-down-500">
                  Có dòng quá nhỏ so với tổng để lưu chính xác (dưới 0,01%). Làm tròn dòng
                  đó lên, hoặc tách thành hai lệnh riêng.
                </p>
              ) : holding ? (
                <p className="mt-2 text-xs text-up-500">
                  Chia đủ {fmt(qty)} CP theo {sellRows.filter((r) => soBan(r.strategyId) > 0).length} chiến lược.
                </p>
              ) : null}

              {state?.fieldErrors?.strategies ? (
                <p className="mt-2 text-xs text-down-500">
                  {state.fieldErrors.strategies.join(' ')}
                </p>
              ) : null}
            </div>
          ) : (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-strong">Phân bổ chiến lược</h3>
                <p className="text-xs text-slate-muted">
                  Một giao dịch có thể thuộc nhiều chiến lược. Tổng phải bằng đúng 100%.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {active.length > 1 ? (
                  <button
                    type="button"
                    onClick={splitEvenly}
                    className="rounded-md border border-ink-600 px-2 py-1 text-tiny text-slate-muted transition hover:border-ink-500 hover:text-strong"
                  >
                    Chia đều
                  </button>
                ) : null}

                <span
                  className={`tabular rounded-md border px-2.5 py-1 text-sm font-semibold ${
                    totalBps === 10_000
                      ? 'border-up-500/40 bg-up-500/10 text-up-500'
                      : totalBps > 10_000
                        ? 'border-down-500/40 bg-down-500/10 text-down-500'
                        : 'border-warn-500/40 bg-warn-500/10 text-warn-500'
                  }`}
                >
                  {(totalBps / 100).toFixed(2)}%
                </span>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-ink-700">
              {strategies.map((s) => {
                const raw = allocations[s.id] ?? '';
                const p = Number(String(raw).replace(',', '.'));
                const bps = Number.isFinite(p) && p > 0 ? Math.round(p * 100) : 0;
                const amount = Math.round((net * bps) / 10_000);

                return (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 border-b border-ink-800 px-3 py-2 last:border-0"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: s.colorHex ?? 'var(--color-ink-500)' }}
                    />

                    <div className="min-w-0 flex-1">
                      <span className="text-sm text-slate-soft">{s.nameVi}</span>
                      <span className="ml-2 font-mono text-micro text-ink-500">{s.code}</span>
                    </div>

                    <span className="tabular w-32 shrink-0 text-right text-xs text-slate-muted">
                      {bps > 0 ? `${fmt(amount)} ₫` : ''}
                    </span>

                    <div className="flex w-24 shrink-0 items-center gap-1">
                      <input
                        name={`alloc_${s.id}`}
                        inputMode="decimal"
                        value={raw}
                        onChange={(e) => setAlloc(s.id, e.target.value)}
                        placeholder="0"
                        aria-label={`Tỷ lệ phân bổ cho ${s.nameVi}`}
                        className="field tabular !py-1.5 text-right"
                      />
                      <span className="text-xs text-slate-muted">%</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {totalBps !== 10_000 ? (
              <p className="mt-2 text-xs text-warn-500">
                {totalBps === 0
                  ? 'Chưa phân bổ chiến lược nào.'
                  : totalBps < 10_000
                    ? `Còn thiếu ${((10_000 - totalBps) / 100).toFixed(2)}%.`
                    : `Vượt ${((totalBps - 10_000) / 100).toFixed(2)}%.`}
              </p>
            ) : (
              <p className="mt-2 text-xs text-up-500">
                Tổng đúng 100% — {active.length} chiến lược.
              </p>
            )}

            {state?.fieldErrors?.strategies ? (
              <p className="mt-2 text-xs text-down-500">
                {state.fieldErrors.strategies.join(' ')}
              </p>
            ) : null}
          </div>
          )}

          {/* ---------------------------------------------------------- */}
          {/* Thông tin thực thi                                         */}
          {/* ---------------------------------------------------------- */}
          <details className="rounded-lg border border-ink-700 bg-ink-850">
            <summary className="cursor-pointer px-4 py-2.5 text-sm text-slate-soft">
              Thông tin thực thi và luận điểm đầu tư
            </summary>
            <div className="space-y-3 border-t border-ink-700 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Phí (để trống = tự tính)"
                  name="fees"
                  placeholder={String(fees)}
                  errors={state?.fieldErrors?.fees}
                />
                <Field
                  label="Thuế (để trống = tự tính)"
                  name="tax"
                  placeholder={String(tax)}
                  errors={state?.fieldErrors?.tax}
                />
                <Field label="Mã lệnh môi giới" name="orderId" placeholder="ORD-77123" />
                <Field label="Công ty chứng khoán" name="broker" placeholder="SSI" />
              </div>

              <div>
                <label htmlFor="executionNote" className="field-label">
                  Ghi chú thực thi
                </label>
                <textarea id="executionNote" name="executionNote" rows={2} className="field" />
              </div>

              <div>
                <label htmlFor="investmentThesis" className="field-label">
                  Luận điểm đầu tư
                </label>
                <textarea
                  id="investmentThesis"
                  name="investmentThesis"
                  rows={3}
                  placeholder="Vì sao mua/bán ở mức giá này…"
                  className="field"
                />
              </div>
            </div>
          </details>

          {/* ---------------------------------------------------------- */}
          {/* Thời điểm khớp & gửi                                       */}
          {/* ---------------------------------------------------------- */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="executedAt" className="field-label">
                Thời điểm khớp <span className="ml-1 text-down-500">*</span>
              </label>
              <input
                id="executedAt"
                name="executedAt"
                type="datetime-local"
                required
                className="field"
              />
              {state?.fieldErrors?.executedAt ? (
                <p className="mt-1 text-xs text-down-500">
                  {state.fieldErrors.executedAt.join(' ')}
                </p>
              ) : null}
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 pb-2.5 text-xs text-slate-soft">
                <input
                  type="checkbox"
                  name="submitForApproval"
                  disabled={!canExecuteDirectly}
                  defaultChecked={!canExecuteDirectly}
                  className="accent-accent-500"
                />
                Gửi duyệt thay vì ghi nhận đã khớp
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-ink-800 pt-4">
            <SubmitButton className={ready ? '' : 'pointer-events-none opacity-40'}>
              {willNeedApproval ? 'Tạo và gửi duyệt' : 'Ghi nhận giao dịch'}
            </SubmitButton>

            <span className="text-xs text-slate-muted">
              Danh mục: <span className="text-slate-soft">{portfolioName}</span>
            </span>

            {!ready ? (
              <span className="text-xs text-warn-500">
                {!stock
                  ? 'Chọn mã hợp lệ'
                  : qty <= 0
                    ? 'Nhập khối lượng'
                    : px <= 0
                      ? 'Nhập giá'
                      : overSell
                        ? 'Khối lượng bán vượt số đang giữ'
                        : 'Tổng phân bổ phải bằng 100%'}
              </span>
            ) : null}
          </div>
        </>
      )}
    </ActionForm>
  );
}
