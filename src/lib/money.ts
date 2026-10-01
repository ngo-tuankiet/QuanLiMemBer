/**
 * Tiền tệ & tỷ lệ.
 *
 * QUY ƯỚC BẤT BIẾN CỦA HỆ THỐNG
 * ------------------------------
 * TIỀN  = `bigint`, đơn vị VNĐ NGUYÊN. Không Float, không Decimal, không string.
 *         Lý do: giá cổ phiếu Việt Nam luôn là số nguyên đồng (bước giá 10/50/100đ),
 *         phí và thuế môi giới làm tròn tới đồng. `bigint` cho phép cộng/trừ/nhân
 *         chính xác tuyệt đối và lưu y hệt trên SQLite (INTEGER 64-bit) lẫn
 *         Postgres (BIGINT). Trần 9.22×10^18đ — thừa sức cho mọi quỹ tại VN.
 *
 * TỶ LỆ = `number` nguyên, đơn vị basis point (bps). 10000 bps = 100.00%.
 *         Lý do: 50% + 30% + 20% phải bằng đúng 100%, không được là 99.99999%.
 *
 * MỌI phép chia phải đi qua các hàm trong file này để việc làm tròn là một
 * quyết định tường minh, không phải tai nạn.
 */

// ---------------------------------------------------------------------------
// Hằng số
// ---------------------------------------------------------------------------

/** 100.00% tính theo basis point. */
export const BPS_TOTAL = 10_000;

/** Hệ số nhân khi lưu giá trị chỉ số (VN-Index 1285.43 → 128543). */
export const INDEX_SCALE = 100n;

// ---------------------------------------------------------------------------
// Chuyển đổi bps
// ---------------------------------------------------------------------------

/** 3.36 (%) → 336 (bps). Làm tròn tới bps gần nhất. */
export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

/** 336 (bps) → 3.36 (%). */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/**
 * Tỷ lệ hai số tiền, trả về bps. `part / whole`.
 * whole = 0 → trả 0 (không chia cho 0, không NaN lọt vào dashboard).
 */
export function ratioToBps(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  // Nhân trước chia sau để không mất chữ số; ×10 rồi làm tròn nửa lên.
  const scaled = (part * BigInt(BPS_TOTAL) * 10n) / whole;
  return Number((scaled + (scaled >= 0n ? 5n : -5n)) / 10n);
}

// ---------------------------------------------------------------------------
// Số học giao dịch (§8, §9)
// ---------------------------------------------------------------------------

/** Giá trị gốc của lệnh: khối lượng × giá. Chính xác tuyệt đối. */
export function grossAmount(quantity: number, price: bigint): bigint {
  return BigInt(quantity) * price;
}

/**
 * Tiền THỰC TẾ ra/vào tài khoản.
 *
 *   BUY : chi ra = gross + phí + thuế
 *   SELL: thu về = gross − phí − thuế
 *
 * Đây là con số dùng để phân bổ cho Strategy và để tính số dư tiền, vì nó là
 * dòng tiền thật — không phải giá trị danh nghĩa của lệnh.
 */
export function netAmount(
  transactionType: 'BUY' | 'SELL',
  quantity: number,
  price: bigint,
  fees: bigint = 0n,
  tax: bigint = 0n,
): bigint {
  const gross = grossAmount(quantity, price);
  return transactionType === 'BUY' ? gross + fees + tax : gross - fees - tax;
}

/**
 * Giá vốn của lệnh mua — dùng cho Average Cost (§9).
 * Phí mua được vốn hoá vào giá vốn theo thông lệ kế toán đầu tư.
 */
export function costBasis(quantity: number, price: bigint, fees: bigint = 0n, tax: bigint = 0n): bigint {
  return grossAmount(quantity, price) + fees + tax;
}

/** Phí giao dịch = giá trị × tỷ lệ (bps), làm tròn tới đồng. */
export function calcFee(gross: bigint, feeRateBps: number): bigint {
  return divRound(gross * BigInt(feeRateBps), BigInt(BPS_TOTAL));
}

// ---------------------------------------------------------------------------
// Chia có kiểm soát làm tròn
// ---------------------------------------------------------------------------

/** Chia hai bigint, làm tròn nửa ra xa 0 (half away from zero). */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('divRound: chia cho 0');
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const q = (a * 2n + b) / (b * 2n);
  return negative ? -q : q;
}

/**
 * PHÂN BỔ SỐ TIỀN THEO TỶ LỆ — thuật toán largest remainder (Hare quota).
 *
 * Đây là hàm quan trọng nhất của file. Nó bảo đảm ràng buộc §6:
 * tổng các phần phân bổ BẰNG ĐÚNG số tiền gốc, không lệch 1 đồng.
 *
 * Chia thẳng rồi làm tròn từng phần sẽ sai:
 *   253.000.000 × 33.33% ×3 = 252.999.987  → thiếu 13đ, dashboard lệch mãi mãi.
 *
 * Cách làm: lấy phần nguyên trước, rồi rải phần dư cho các mục có phần thập
 * phân lớn nhất — nên sai số tối đa của mỗi mục là 1đ và tổng luôn khớp.
 *
 * @param total  Số tiền cần chia (VNĐ). Có thể âm (lệnh bán ghi âm).
 * @param bpsList Danh sách tỷ lệ (bps). Tổng PHẢI bằng 10000.
 * @returns Danh sách số tiền, cùng thứ tự, Σ = total.
 */
export function allocateAmount(total: bigint, bpsList: readonly number[]): bigint[] {
  const sumBps = bpsList.reduce((s, b) => s + b, 0);
  if (sumBps !== BPS_TOTAL) {
    throw new Error(
      `allocateAmount: tổng tỷ lệ phải bằng ${BPS_TOTAL} bps (100%), đang là ${sumBps} bps`,
    );
  }
  if (bpsList.length === 0) return [];

  const negative = total < 0n;
  const abs = negative ? -total : total;
  const denom = BigInt(BPS_TOTAL);

  // Phần nguyên + phần dư của từng mục
  const floors: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let distributed = 0n;

  for (let i = 0; i < bpsList.length; i++) {
    const numerator = abs * BigInt(bpsList[i]!);
    const floor = numerator / denom;
    floors.push(floor);
    remainders.push({ index: i, remainder: numerator % denom });
    distributed += floor;
  }

  // Rải phần thiếu: ưu tiên phần dư lớn nhất; đồng hạng thì mục đứng trước nhận.
  let leftover = abs - distributed;
  remainders.sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (let k = 0; leftover > 0n; k++, leftover--) {
    const target = remainders[k % remainders.length]!;
    floors[target.index] = floors[target.index]! + 1n;
  }

  return negative ? floors.map((v) => -v) : floors;
}


/**
 * PHÉP NGƯỢC CỦA `allocateAmount`: từ khối lượng suy ra tỷ lệ bps.
 *
 * Dùng cho lệnh BÁN. Người nhập điền KHỐI LƯỢNG cho từng chiến lược — vì điều kiện
 * "không bán quá khối lượng đã mua theo chiến lược đó" là điều kiện về khối lượng,
 * gõ phần trăm thì người nhập phải tự nhẩm 30% của 10.000 có vượt 8.400 hay không.
 * Nhưng `trade_strategies` lưu `allocationBps`, nên phải đổi ở biên.
 *
 * TỔNG PHẢI BẰNG ĐÚNG 10000. Chia thẳng rồi làm tròn từng phần sẽ lệch:
 *
 *   3 chiến lược, mỗi bên 1/3:  3333 + 3333 + 3333 = 9999  → `tradeSchema` từ chối
 *
 * Nên dùng lại đúng thuật toán largest-remainder của `allocateAmount`: lấy phần
 * nguyên trước, rồi rải phần thiếu cho mục có phần dư lớn nhất. Cùng một cách chia ở
 * cả hai chiều thì đổi qua rồi đổi lại không sinh sai số tích luỹ.
 *
 * @param weights Khối lượng từng chiến lược. Phải có ít nhất một phần tử dương.
 * @returns Danh sách bps, cùng thứ tự, Σ = 10000.
 */
export function bpsFromWeights(weights: readonly bigint[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0n);
  if (total <= 0n) {
    throw new Error('bpsFromWeights: tổng khối lượng phải lớn hơn 0');
  }
  if (weights.some((w) => w < 0n)) {
    throw new Error('bpsFromWeights: khối lượng không được âm');
  }

  const denom = BigInt(BPS_TOTAL);
  const floors: number[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let distributed = 0;

  for (let i = 0; i < weights.length; i++) {
    const numerator = weights[i]! * denom;
    const floor = numerator / total;
    floors.push(Number(floor));
    remainders.push({ index: i, remainder: numerator % total });
    distributed += Number(floor);
  }

  // Rải phần thiếu: phần dư lớn nhất nhận trước; đồng hạng thì mục đứng trước nhận.
  let leftover = BPS_TOTAL - distributed;
  remainders.sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (let i = 0; leftover > 0; i = (i + 1) % remainders.length) {
    const idx = remainders[i]!.index;
    floors[idx] = floors[idx]! + 1;
    leftover -= 1;
  }

  return floors;
}

// ---------------------------------------------------------------------------
// Hiệu suất (§9, §13)
// ---------------------------------------------------------------------------

/** Lợi nhuận chưa thực hiện: (giá hiện tại − giá vốn TB) × khối lượng. */
export function unrealizedPnl(quantity: number, avgCostMicro: bigint, currentPrice: bigint): bigint {
  // avgCost lưu ở đơn vị micro-đồng (×1e6) để giữ phần thập phân, xem avgCostMicro().
  const marketMicro = BigInt(quantity) * currentPrice * MICRO;
  const costMicro = BigInt(quantity) * avgCostMicro;
  return divRound(marketMicro - costMicro, MICRO);
}

/**
 * Hệ số cho giá vốn trung bình.
 *
 * Average Cost là giá trị TÍNH TOÁN, không lưu DB. Nhưng nó gần như luôn là số
 * thập phân (2.530.000.000đ / 100.000cp = 25.300đ, nhưng thêm phí thì thành
 * 25.303,17đ). Ta biểu diễn nó bằng bigint ở đơn vị micro-đồng (1đ = 1e6) để
 * vẫn dùng số nguyên chính xác thay vì float.
 */
export const MICRO = 1_000_000n;

/** Giá vốn trung bình theo micro-đồng: tổng giá vốn / khối lượng. */
export function avgCostMicro(totalCost: bigint, quantity: number): bigint {
  if (quantity === 0) return 0n;
  return divRound(totalCost * MICRO, BigInt(quantity));
}

/** micro-đồng → đồng (làm tròn), để hiển thị. */
export function microToVnd(micro: bigint): bigint {
  return divRound(micro, MICRO);
}

// ---------------------------------------------------------------------------
// Định dạng hiển thị
// ---------------------------------------------------------------------------

const VN_GROUP = new Intl.NumberFormat('vi-VN');

/** 253000000n → "253.000.000" */
export function formatNumber(value: bigint | number): string {
  return VN_GROUP.format(value as bigint);
}

/** 253000000n → "253.000.000 ₫" */
export function formatVnd(value: bigint): string {
  return `${VN_GROUP.format(value)} ₫`;
}

/**
 * Dạng gọn theo đặc tả (§12): 10485000000n → "₫10.485B".
 * B = tỷ (billion), M = triệu (million), K = nghìn.
 */
export function formatCompactVnd(value: bigint, fractionDigits = 3): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const sign = negative ? '-' : '';

  const units: [bigint, string][] = [
    [1_000_000_000_000n, 'T'],
    [1_000_000_000n, 'B'],
    [1_000_000n, 'M'],
    [1_000n, 'K'],
  ];

  for (const [divisor, suffix] of units) {
    if (abs >= divisor) {
      const scaled = Number((abs * 1000n) / divisor) / 1000;
      return `${sign}₫${scaled.toFixed(fractionDigits).replace(/\.?0+$/, '')}${suffix}`;
    }
  }
  return `${sign}₫${abs.toString()}`;
}

/** Dạng gọn kiểu Việt: 10485000000n → "10,485 tỷ". */
export function formatCompactVnd_vi(value: bigint, fractionDigits = 3): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const sign = negative ? '-' : '';

  const units: [bigint, string][] = [
    [1_000_000_000_000n, 'nghìn tỷ'],
    [1_000_000_000n, 'tỷ'],
    [1_000_000n, 'triệu'],
    [1_000n, 'nghìn'],
  ];

  for (const [divisor, label] of units) {
    if (abs >= divisor) {
      const scaled = Number((abs * 1000n) / divisor) / 1000;
      const text = scaled.toFixed(fractionDigits).replace(/\.?0+$/, '').replace('.', ',');
      return `${sign}${text} ${label}`;
    }
  }
  return `${sign}${abs.toString()} ₫`;
}

/** 336 → "+3.36%" ; -210 → "-2.10%" */
export function formatBps(bps: number, withSign = true): string {
  const sign = withSign && bps > 0 ? '+' : '';
  return `${sign}${bpsToPercent(bps).toFixed(2)}%`;
}

/** Giá trị chỉ số: 128543n → "1.285,43" */
export function formatIndexValue(scaled: bigint): string {
  const whole = scaled / INDEX_SCALE;
  const frac = (scaled < 0n ? -scaled : scaled) % INDEX_SCALE;
  return `${VN_GROUP.format(whole)},${frac.toString().padStart(2, '0')}`;
}
