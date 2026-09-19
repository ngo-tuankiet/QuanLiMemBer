/**
 * Hiển thị tiền và tỷ lệ.
 *
 * Mọi số tiền và tỷ lệ trên UI phải đi qua các component này, vì:
 *
 *   1. Font đẳng khoảng (`tabular`) để các chữ số thẳng cột — bắt buộc với bảng
 *      số liệu tài chính, nếu không mắt không so sánh được độ lớn.
 *   2. Màu theo quy ước bảng giá Việt Nam: **xanh tăng, đỏ giảm**. Ngược với quy
 *      ước kế toán phương Tây, và người dùng ở đây đọc theo quy ước sàn.
 *   3. bigint không tự render được — phải chuyển qua formatter.
 */

import {
  formatBps,
  formatCompactVnd,
  formatNumber,
  formatVnd,
  microToVnd,
} from '@/lib/money';

/** Số tiền đầy đủ: "253.000.000 ₫" */
export function Money({
  value,
  className = '',
  signed = false,
}: {
  value: bigint;
  className?: string;
  signed?: boolean;
}) {
  const tone = signed ? toneOf(value) : '';
  return (
    <span className={`tabular ${tone} ${className}`}>
      {signed && value > 0n ? '+' : ''}
      {formatVnd(value)}
    </span>
  );
}

/** Dạng gọn theo §12: "₫10.485B" */
export function MoneyCompact({
  value,
  className = '',
  signed = false,
}: {
  value: bigint;
  className?: string;
  signed?: boolean;
}) {
  const tone = signed ? toneOf(value) : '';
  return (
    <span className={`tabular ${tone} ${className}`}>
      {signed && value > 0n ? '+' : ''}
      {formatCompactVnd(value)}
    </span>
  );
}

/** Giá cổ phiếu, không có ký hiệu tiền tệ: "25.300" */
export function Price({ value, className = '' }: { value: bigint; className?: string }) {
  return <span className={`tabular ${className}`}>{formatNumber(value)}</span>;
}

/** Giá vốn trung bình lưu ở micro-đồng. */
export function AvgCost({ micro, className = '' }: { micro: bigint; className?: string }) {
  return <span className={`tabular ${className}`}>{formatNumber(microToVnd(micro))}</span>;
}

/** Khối lượng: "42.000" */
export function Quantity({ value, className = '' }: { value: number; className?: string }) {
  return <span className={`tabular ${className}`}>{value.toLocaleString('vi-VN')}</span>;
}

/** Tỷ lệ có dấu và màu: "+3.36%" xanh, "-2.10%" đỏ */
export function Change({ bps, className = '' }: { bps: number; className?: string }) {
  return (
    <span className={`tabular ${toneOfBps(bps)} ${className}`}>{formatBps(bps)}</span>
  );
}

/** Tỷ trọng — không có dấu, không tô màu: "12.80%" */
export function Weight({ bps, className = '' }: { bps: number; className?: string }) {
  return <span className={`tabular ${className}`}>{formatBps(bps, false)}</span>;
}

/** Thanh tỷ trọng nằm ngang, dùng cho Sector Exposure và Strategy Allocation. */
export function WeightBar({
  bps,
  color,
  className = '',
}: {
  bps: number;
  color?: string | null;
  className?: string;
}) {
  // Chuẩn hoá theo 100% để thanh không vượt khung khi làm tròn lên 100.01%.
  const pct = Math.min(100, Math.max(0, bps / 100));
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-ink-800 ${className}`}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: color ?? 'var(--color-accent-500)' }}
      />
    </div>
  );
}

function toneOf(value: bigint): string {
  if (value > 0n) return 'text-up-500';
  if (value < 0n) return 'text-down-500';
  return 'text-slate-muted';
}

function toneOfBps(bps: number): string {
  if (bps > 0) return 'text-up-500';
  if (bps < 0) return 'text-down-500';
  return 'text-slate-muted';
}
