/**
 * BIỂU ĐỒ — SVG render ở SERVER.
 *
 * VÌ SAO KHÔNG DÙNG THƯ VIỆN BIỂU ĐỒ
 *   1. Số liệu tiền tệ là `bigint`. Mọi thư viện biểu đồ đều nhận `number`, nên
 *      phải chuyển đổi ở biên — chính chỗ dễ mất chính xác nhất.
 *   2. Trang là Server Component. SVG dựng ở server không cần hydrate, không cần
 *      JS phía client, và hoạt động cả khi JS bị tắt.
 *   3. Không thêm dependency vào hệ thống quản lý vốn.
 *
 * Tooltip dùng thẻ `<title>` gốc của SVG: trình duyệt tự hiện khi hover, trình
 * đọc màn hình đọc được, và không cần một dòng JavaScript nào.
 *
 * NGUYÊN TẮC HIỂN THỊ (đã kiểm bằng validator, không ước lượng bằng mắt)
 *   - Bảng màu phân loại 8 slot, THỨ TỰ CỐ ĐỊNH, không bao giờ xoay vòng.
 *     Slot thứ 9 không tồn tại: phần dư gộp vào "Khác".
 *   - Donut tối đa 6 phần. Nhiều hơn thì so sánh bằng mắt không còn đáng tin.
 *   - Khe 2px giữa các phần bằng chính màu nền, KHÔNG vẽ viền.
 *   - Lưới và trục là nét LIỀN mảnh. Nét đứt đọc thành "ngưỡng" hoặc "dự phóng".
 *   - Mỗi biểu đồ đều kèm nhãn hoặc bảng số liệu chính xác — ba slot màu dưới
 *     3:1 trên nền sáng nên màu KHÔNG được là kênh thông tin duy nhất.
 *   - Không bao giờ hai trục y. Hai đại lượng khác thang thì chuẩn hoá về 100.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatBps, formatCompactVnd } from '@/lib/money';

/** Số slot màu phân loại. Không có slot thứ 9. */
export const SERIES_SLOTS = 8;

/** Số phần tối đa của donut trước khi gộp "Khác". */
export const DONUT_MAX_SEGMENTS = 6;

/**
 * Màu theo slot, thứ tự cố định.
 *
 * Nhận `index` theo THỰC THỂ (ngành nào, chiến lược nào), không theo thứ hạng —
 * nếu gán theo thứ hạng thì lọc bỏ một chuỗi sẽ sơn lại các chuỗi còn lại, và
 * người đã học "Tài chính màu xanh" bị dẫn sai.
 */
export function seriesColor(index: number): string {
  return `var(--series-${(index % SERIES_SLOTS) + 1})`;
}

// ---------------------------------------------------------------------------
// Donut — phần trên tổng thể
// ---------------------------------------------------------------------------

export interface DonutSlice {
  /** Khoá ổn định của thực thể — dùng để giữ màu không đổi khi lọc. */
  key: string;
  label: string;
  /** Giá trị tuyệt đối (VNĐ). Dùng bigint để không mất chính xác. */
  value: bigint;
  /** Tỷ trọng, basis point. */
  bps: number;
  /** Ghi đè màu; mặc định lấy theo slot. */
  color?: string;
}

interface Arc {
  slice: DonutSlice;
  color: string;
  dash: number;
  offset: number;
}

/**
 * Gộp phần dư thành "Khác" để không bao giờ vượt số slot màu.
 *
 * Giải "quá nhiều chuỗi" bằng cách sinh thêm màu là sai: sắc thứ 9 không phân
 * biệt được với sắc đã có dưới mắt người mù màu.
 */
export function foldSlices(
  slices: readonly DonutSlice[],
  max = DONUT_MAX_SEGMENTS,
): DonutSlice[] {
  if (slices.length <= max) return [...slices];

  const head = slices.slice(0, max - 1);
  const tail = slices.slice(max - 1);

  return [
    ...head,
    {
      key: '__other__',
      label: `Khác (${tail.length})`,
      value: tail.reduce((s, x) => s + x.value, 0n),
      bps: tail.reduce((s, x) => s + x.bps, 0),
    },
  ];
}

export function Donut({
  slices,
  size = 168,
  thickness = 22,
  centerLabel,
  centerValue,
}: {
  slices: readonly DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  // Khe 2px giữa các phần. Chỉ tạo khe khi có nhiều hơn một phần — một phần duy
  // nhất mà cắt khe sẽ thành vòng bị hở vô nghĩa.
  const gap = slices.length > 1 ? 2 : 0;

  const arcs: Arc[] = [];
  let cursor = 0;

  slices.forEach((slice, i) => {
    const fraction = Math.max(0, slice.bps) / 10_000;
    const length = fraction * circumference;
    // Không để khe ăn hết phần quá nhỏ.
    const dash = Math.max(0.5, length - gap);

    arcs.push({
      slice,
      color: slice.color ?? seriesColor(i),
      dash,
      offset: -cursor,
    });
    cursor += length;
  });

  const total = slices.reduce((s, x) => s + x.value, 0n);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="chart-svg donut"
      style={{ maxWidth: size }}
      role="img"
      aria-label={`Biểu đồ tròn: ${slices.map((s) => `${s.label} ${formatBps(s.bps, false)}`).join(', ')}`}
    >
      {/* Vành nền — cho thấy tổng thể ngay cả khi dữ liệu rỗng */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--ink-800)"
        strokeWidth={thickness}
      />

      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {arcs.map((arc) => (
          <circle
            key={arc.slice.key}
            className="donut-segment"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={thickness}
            strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
            strokeDashoffset={arc.offset}
            strokeLinecap="butt"
          >
            {/*
              PHẢI là MỘT chuỗi duy nhất.

              React yêu cầu `children` của <title> là một string, không phải mảng
              node. Viết `{a}: {b} · {c}` trong JSX tạo ra mảng 6 phần tử — React
              BỎ QUA nó khi render ở server nhưng vẫn render ở client, gây lệch
              hydration mà thông báo lỗi không hề nhắc tới <title>.
            */}
            <title>{`${arc.slice.label}: ${formatCompactVnd(arc.slice.value)} · ${formatBps(arc.slice.bps, false)}`}</title>
          </circle>
        ))}
      </g>

      {/* Số ở tâm: chữ số tỷ lệ, không dùng đẳng khoảng cho số lớn đứng một mình */}
      {centerValue ? (
        <text
          x={size / 2}
          y={size / 2 - 2}
          textAnchor="middle"
          className="hero-figure"
          style={{ fill: 'var(--fg-strong)', fontSize: 18, fontWeight: 600 }}
        >
          {centerValue}
        </text>
      ) : null}
      {centerLabel ? (
        <text
          x={size / 2}
          y={size / 2 + (centerValue ? 15 : 4)}
          textAnchor="middle"
          /*
            Cỡ chữ đặt bằng LỚP, không bằng `style` inline.
            Đây là hai chữ 10px cuối cùng còn lại của app sau đợt sửa di động, và
            chúng ở lại vì `style` inline thì không @media nào với tới được. Dùng
            `text-micro` để chúng lên 12px ở khổ hẹp như mọi chữ nhỏ khác — lỗ giữa
            donut 148px rộng khoảng 104px nên thêm 2px vẫn dư chỗ.
          */
          className="text-micro"
          style={{ fill: 'var(--fg-muted)' }}
        >
          {centerLabel}
        </text>
      ) : null}

      {total === 0n ? (
        <text
          x={size / 2}
          y={size / 2 + 30}
          textAnchor="middle"
          className="text-micro"
          style={{ fill: 'var(--ink-500)' }}
        >
          chưa có dữ liệu
        </text>
      ) : null}
    </svg>
  );
}

/**
 * Chú giải kèm SỐ LIỆU CHÍNH XÁC.
 *
 * Bắt buộc đi cùng mọi donut, không phải trang trí: ba slot màu nằm dưới 3:1 trên
 * nền sáng nên màu không thể là kênh thông tin duy nhất. Đây cũng chính là "bảng
 * số liệu" mà tiêu chí tiếp cận yêu cầu.
 */
export function DonutLegend({
  slices,
  className = '',
}: {
  slices: readonly DonutSlice[];
  className?: string;
}) {
  return (
    <ul className={`space-y-1.5 ${className}`}>
      {slices.map((slice, i) => (
        <li key={slice.key} className="flex items-baseline gap-2 text-xs">
          <span
            className="mt-1 size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: slice.color ?? seriesColor(i) }}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-slate-soft" title={slice.label}>
            {slice.label}
          </span>
          <span className="tabular shrink-0 text-slate-muted">{formatBps(slice.bps, false)}</span>
          <span className="tabular shrink-0 text-strong">
            {formatCompactVnd(slice.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Line chart — diễn biến theo thời gian, hai chuỗi chuẩn hoá về 100
// ---------------------------------------------------------------------------

export interface LinePoint {
  /** Nhãn trục x, ví dụ "24/08". */
  label: string
  /** Giá trị đã chuẩn hoá (100 = mốc đầu kỳ). */
  values: (number | null)[];
}

export interface LineSeries {
  key: string;
  label: string;
  color: string;
}

/**
 * Biểu đồ đường cho §13 — hiệu suất danh mục so với VN-Index.
 *
 * KHÔNG BAO GIỜ hai trục y. Danh mục tính bằng tỷ đồng, chỉ số tính bằng điểm —
 * hai thang hoàn toàn khác nhau. Đặt hai thang cạnh nhau là tự bịa ra một mối
 * tương quan không có trong dữ liệu. Cách đúng: **chuẩn hoá cả hai về 100 tại
 * mốc đầu kỳ**, rồi vẽ trên MỘT trục.
 *
 * HIỆN KHÔNG TRANG NÀO DÙNG, và đó là chủ ý — không phải sót.
 *
 * Khối biểu đồ đường trên Dashboard đã được thay bằng vốn/lãi-lỗ theo nhóm; Alpha
 * ở lại dưới dạng một ô số. Component vẫn được giữ vì đây là MODULE THÀNH PHẦN,
 * không phải cấu hình: một biểu đồ không được dùng tới thì không nói dối ai cả.
 * Khác hẳn một quyền hay một tham số bị bỏ rơi — hai thứ đó vẫn hiện trên giao
 * diện và khiến người dùng tin rằng chúng đang có tác dụng, nên chúng phải bị
 * xoá (xem scripts/prune-permissions.ts và prune-settings.ts).
 *
 * Báo cáo CSV "Hiệu suất theo phiên" vẫn sinh ra đúng dữ liệu mà hàm này vẽ, nên
 * dựng lại một biểu đồ chuỗi thời gian chỉ là gọi lại component này.
 */
export function LineChart({
  points,
  series,
  height = 220,
  width = 720,
}: {
  points: readonly LinePoint[];
  series: readonly LineSeries[];
  height?: number;
  width?: number;
}) {
  // Chừa chỗ cho nhãn trục — nếu không, thẻ sẽ sinh thanh cuộn dọc bé xíu.
  const padding = { top: 16, right: 56, bottom: 26, left: 44 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const all = points.flatMap((p) => p.values.filter((v): v is number => v !== null));
  if (points.length < 2 || all.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-slate-muted">
        Chưa đủ dữ liệu để vẽ biểu đồ (cần ít nhất 2 phiên).
      </div>
    );
  }

  // Thang bao quanh 100 để đường mốc luôn nằm trong khung.
  const rawMin = Math.min(...all, 100);
  const rawMax = Math.max(...all, 100);
  const span = Math.max(1, rawMax - rawMin);
  const pad = span * 0.12;
  const min = rawMin - pad;
  const max = rawMax + pad;

  const x = (i: number) =>
    padding.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => padding.top + plotH - ((v - min) / (max - min)) * plotH;

  // 4 mốc trục y, trong đó luôn có 100 (mốc "không đổi").
  const ticks = [min + (max - min) * 0.1, 100, max - (max - min) * 0.1].sort((a, b) => a - b);

  /** Nhãn trục x thưa: đầu, giữa, cuối. Nhãn dày sẽ chồng nhau. */
  const xLabelIndexes = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);

  /*
   * Điểm cuối của từng chuỗi, kèm vị trí nhãn ĐÃ TÁCH NHAU.
   *
   * Hai chuỗi kết thúc ở giá trị gần nhau (ví dụ 102,05 và 101,86) sẽ có nhãn đè
   * lên nhau thành một khối chữ không đọc được. Ở đây các nhãn được đẩy ra xa
   * nhau tối thiểu `MIN_LABEL_GAP` px, giữ nguyên thứ tự trên/dưới theo giá trị
   * thật để nhãn không bị gán sai đường.
   */
  const MIN_LABEL_GAP = 13;

  const endpoints = series.map((_, si) => {
    const index = points.reduce(
      (found, p, i) => (p.values[si] !== null && p.values[si] !== undefined ? i : found),
      -1,
    );
    if (index < 0) return null;
    const value = points[index]!.values[si]!;
    return { index, value, labelY: y(value) };
  });

  // Sắp theo toạ độ y rồi đẩy dần xuống nếu quá sát nhau.
  const ordered = endpoints
    .map((e, si) => ({ e, si }))
    .filter((x): x is { e: NonNullable<typeof x.e>; si: number } => x.e !== null)
    .sort((a, b) => a.e.labelY - b.e.labelY);

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]!.e;
    const cur = ordered[i]!.e;
    if (cur.labelY - prev.labelY < MIN_LABEL_GAP) {
      cur.labelY = prev.labelY + MIN_LABEL_GAP;
    }
  }

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label={`Biểu đồ đường so sánh ${series.map((s) => s.label).join(' và ')}, chuẩn hoá về 100 tại đầu kỳ`}
      >
        {/* Lưới ngang — nét liền mảnh, lùi về sau */}
        <g className="chart-grid">
          {ticks.map((t) => (
            <line key={t} x1={padding.left} x2={width - padding.right} y1={y(t)} y2={y(t)} />
          ))}
        </g>

        {/* Đường mốc 100 — đậm hơn lưới vì nó có nghĩa: "không tăng không giảm" */}
        <line
          className="chart-axis"
          x1={padding.left}
          x2={width - padding.right}
          y1={y(100)}
          y2={y(100)}
        />

        {/* Nhãn trục y */}
        {ticks.map((t) => (
          <text
            key={`ly-${t}`}
            x={padding.left - 8}
            y={y(t) + 3.5}
            textAnchor="end"
            className="chart-label"
          >
            {t === 100 ? '100' : t.toFixed(0)}
          </text>
        ))}

        {/* Nhãn trục x */}
        {points.map((p, i) =>
          xLabelIndexes.has(i) ? (
            <text
              key={`lx-${p.label}-${i}`}
              x={x(i)}
              y={height - 8}
              textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
              className="chart-label"
            >
              {p.label}
            </text>
          ) : null,
        )}

        {/* Các đường */}
        {series.map((s, si) => {
          const path = points
            .map((p, i) => {
              const v = p.values[si];
              if (v === null || v === undefined) return null;
              return `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
            })
            .filter(Boolean)
            .join(' ');

          const end = endpoints[si];

          return (
            <g key={s.key}>
              <path className="chart-line" d={path} stroke={s.color} />

              {/* Nhãn trực tiếp ở CUỐI đường — chọn lọc, không ghi số ở mọi điểm.
                  `labelY` đã được đẩy tách nhau nếu hai đường kết thúc quá gần. */}
              {end ? (
                <>
                  <circle
                    className="chart-dot"
                    cx={x(end.index)}
                    cy={y(end.value)}
                    r={4.5}
                    fill={s.color}
                  />
                  <text
                    x={x(end.index) + 9}
                    y={end.labelY + 3.5}
                    className="chart-label"
                    style={{ fill: s.color, fontWeight: 600 }}
                  >
                    {end.value.toFixed(1)}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}

        {/* Vùng hover cho từng phiên — rộng hơn dấu vẽ, không bắt nhắm chính xác */}
        {points.map((p, i) => {
          const bandW = plotW / Math.max(1, points.length - 1);
          return (
            <rect
              key={`hit-${i}`}
              className="chart-hit"
              x={x(i) - bandW / 2}
              y={padding.top}
              width={bandW}
              height={plotH}
              tabIndex={0}
            >
              {/* Một chuỗi duy nhất — xem chú thích ở <title> của Donut. */}
              <title>
                {p.label +
                  series
                    .map((s, si) =>
                      p.values[si] !== null && p.values[si] !== undefined
                        ? ` · ${s.label} ${p.values[si]!.toFixed(1)}`
                        : '',
                    )
                    .join('')}
              </title>
            </rect>
          );
        })}
      </svg>

      {/* Chú giải — luôn có khi từ 2 chuỗi trở lên, để danh tính không chỉ dựa vào màu */}
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-2">
            <span
              className="h-0.5 w-4 rounded-full"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="text-slate-soft">{s.label}</span>
          </span>
        ))}
        <span className="text-ink-500">
          Cả hai chuẩn hoá về 100 tại đầu kỳ — một trục duy nhất, không so hai thang khác nhau.
        </span>
      </figcaption>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — diễn biến nhỏ đặt trong ô KPI
// ---------------------------------------------------------------------------

/**
 * Đường nhỏ trong ô KPI. Không trục, không nhãn — nó chỉ trả lời "đang đi lên
 * hay đi xuống", còn con số chính xác đã nằm ngay bên cạnh.
 */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  positive,
  area = false,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  positive?: boolean;
  /**
   * Tô vùng dưới đường.
   *
   * Chỉ dùng khi đại lượng có MỐC 0 CÓ NGHĨA và luôn dương — giá trị danh mục
   * chẳng hạn. Với chuỗi có thể âm (lãi/lỗ) thì vùng tô nói sai: nó gợi ý "diện
   * tích tích luỹ" trong khi thang y ở đây bị cắt theo min/max, không bắt đầu từ 0.
   */
  area?: boolean;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const color = positive === undefined
    ? 'var(--accent)'
    : positive
      ? 'var(--up)'
      : 'var(--down)';

  const path = values
    .map((v, i) => {
      const px = (i / (values.length - 1)) * (width - 4) + 2;
      const py = height - 3 - ((v - min) / span) * (height - 6);
      return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');

  const areaPath = area
    ? `${path} L${(width - 2).toFixed(1)},${height} L2,${height} Z`
    : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="chart-svg"
      style={{ maxWidth: width }}
      aria-hidden
    >
      {areaPath ? (
        // Vùng tô dùng chính màu đường ở độ mờ thấp, KHÔNG dùng gradient: gradient
        // trong một hình 28px cao chỉ tạo dải răng cưa mà không thêm thông tin.
        <path d={areaPath} fill={color} fillOpacity={0.14} stroke="none" />
      ) : null}
      <path d={path} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Thanh ngang xếp hạng — dạng đúng cho việc SO SÁNH độ lớn
// ---------------------------------------------------------------------------

export interface RankedBar {
  key: string;
  label: string;
  value: bigint;
  /**
   * TỶ TRỌNG THẬT (phần trên tổng thể), không phải tỷ lệ so với mục lớn nhất.
   *
   * Con số này được IN RA cho người đọc, còn ĐỘ DÀI thanh thì component tự
   * chuẩn hoá theo mục lớn nhất để dùng hết chiều rộng. Hai việc khác nhau, và
   * đó là lý do phải nói rõ ở đây: truyền vào tỷ lệ so với mục lớn nhất sẽ
   * khiến mục đầu bảng luôn in "100.00%" — người đọc hiểu thành "chiếm toàn bộ
   * danh mục". Lỗi này đã xảy ra thật.
   */
  bps: number;
  color?: string;
  /** Thông tin phụ hiển thị bên phải, ví dụ mức sinh lời. */
  trailing?: ReactNode;
}

/**
 * Thanh ngang cho danh sách xếp hạng.
 *
 * Donut trả lời "phần trên tổng thể ở mức nhìn tổng quan"; khi cần SO SÁNH các
 * giá trị gần nhau thì thanh ngang mới đọc được — mắt so chiều dài chính xác hơn
 * nhiều so với so diện tích cung tròn. Dùng dạng ngang vì tên ngành tiếng Việt dài.
 */
export function RankedBars({ items }: { items: readonly RankedBar[] }) {
  const maxBps = Math.max(1, ...items.map((i) => i.bps));

  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={item.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2 shrink-0 rounded-sm"
                style={{ backgroundColor: item.color ?? seriesColor(i) }}
                aria-hidden
              />
              <span className="truncate text-sm text-slate-soft" title={item.label}>
                {item.label}
              </span>
            </span>
            <span className="flex shrink-0 items-baseline gap-3">
              {item.trailing}
              <span className="tabular text-xs text-slate-muted">
                {formatBps(item.bps, false)}
              </span>
              <span className="tabular w-20 text-right text-sm text-strong">
                {formatCompactVnd(item.value)}
              </span>
            </span>
          </div>

          {/* Đầu thanh bo 4px, neo vào đường gốc bên trái */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
            <div
              className="h-full rounded-full"
              style={{
                /*
                 * BẰNG 0 THÌ KHÔNG VẼ GÌ. `Math.max(1, …)` áp cho mọi giá trị sẽ
                 * biến ₫0 thành một vạch màu nhìn thấy được — người đọc hiểu thành
                 * "có một ít", trong khi sự thật là không có đồng nào. Chuyện này
                 * xảy ra thật ngay khi khối IB lên trang: hai tài khoản mới khai
                 * chưa nạp vốn đều hiện một vạch.
                 *
                 * Sàn 1% vẫn giữ cho giá trị KHÁC 0 nhưng quá nhỏ — ở đó vạch mảnh
                 * là đúng, vì có thật.
                 */
                width: item.bps === 0 ? 0 : `${Math.max(1, (item.bps / maxBps) * 100)}%`,
                backgroundColor: item.color ?? seriesColor(i),
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Thanh HAI CHIỀU — dạng đúng cho dữ liệu có cả dấu âm và dấu dương
// ---------------------------------------------------------------------------

export interface DivergingBar {
  key: string;
  label: string;
  /** Có thể âm. Đây là điểm khác biệt so với `RankedBars`. */
  value: bigint;
  /**
   * Tỷ suất kèm theo, bps — hoặc `null` khi KHÔNG ĐỊNH NGHĨA ĐƯỢC.
   *
   * `null` in ra dấu "—", không in "0,00%". Chuyện này xảy ra thật: một người
   * đã bán hết mọi mã có giá vốn đang giữ bằng 0, nên tỷ suất là phép chia cho
   * 0. In "+0,00%" cho người vừa chốt lãi 100 triệu là nói sai hẳn, và cái sai
   * đó trông y như một con số thật nên không ai kiểm lại.
   */
  bps: number | null;
  /** Thông tin phụ bên phải nhãn, ví dụ số lệnh. */
  meta?: ReactNode;
  /** Có thì nhãn thành liên kết drill-down (§23). */
  href?: string;
}

/**
 * Thanh hai chiều quanh một đường gốc ở GIỮA.
 *
 * VÌ SAO KHÔNG DÙNG `RankedBars` CHO LÃI/LỖ: thanh xếp hạng neo mọi thanh vào lề
 * trái, nên một khoản lỗ và một khoản lãi cùng độ lớn vẽ ra y như nhau và chỉ
 * khác màu. Dấu của con số là thông tin quan trọng nhất ở đây, nên nó phải nằm ở
 * HÌNH DẠNG — bên nào của đường gốc — chứ không chỉ ở màu. Người mù màu đỏ/xanh
 * vẫn đọc đúng ngay.
 *
 * MÀU: dùng bộ màu TRẠNG THÁI `--up` / `--down` theo quy ước bảng giá Việt Nam,
 * không dùng slot màu chuỗi dữ liệu. Lãi/lỗ là cực tính, không phải phân loại —
 * và hai màu này mang đúng một nghĩa đó ở mọi nơi trong app.
 *
 * Thang đối xứng theo giá trị tuyệt đối lớn nhất: nửa trái và nửa phải luôn cùng
 * tỷ lệ, nên so sánh một khoản lỗ với một khoản lãi là so trực tiếp được.
 */
export function DivergingBars({ items }: { items: readonly DivergingBar[] }) {
  const maxAbs = items.reduce((m, i) => {
    const abs = i.value < 0n ? -i.value : i.value;
    return abs > m ? abs : m;
  }, 1n);

  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const negative = item.value < 0n;
        const abs = negative ? -item.value : item.value;
        // Phần trăm của NỬA thang, nên tối đa 50% toàn bộ chiều rộng.
        const width = Number((abs * 5000n) / maxAbs) / 100;

        return (
          <li key={item.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                {item.href ? (
                  <Link
                    href={item.href}
                    className="truncate text-sm font-medium text-strong transition hover:text-accent-400"
                    title={item.label}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="truncate text-sm text-slate-soft" title={item.label}>
                    {item.label}
                  </span>
                )}
                {item.meta}
              </span>
              <span className="flex shrink-0 items-baseline gap-3">
                <span
                  className={
                    item.bps === null
                      ? 'tabular text-xs text-ink-500'
                      : `tabular text-xs ${negative ? 'text-down-500' : 'text-up-500'}`
                  }
                  title={item.bps === null ? 'Đã chốt hết vị thế — không có giá vốn để tính tỷ suất' : undefined}
                >
                  {item.bps === null ? '—' : formatBps(item.bps)}
                </span>
                <span
                  className={`tabular w-24 text-right text-sm font-medium ${
                    negative ? 'text-down-500' : 'text-up-500'
                  }`}
                >
                  {formatCompactVnd(item.value)}
                </span>
              </span>
            </div>

            {/* Đường gốc ở chính giữa; đầu thanh bo 4px ở phía xa đường gốc */}
            <div className="relative h-1.5 w-full rounded-full bg-ink-800">
              <span
                className="absolute inset-y-[-2px] left-1/2 w-px bg-ink-600"
                aria-hidden
              />
              <span
                className={`absolute top-0 h-full ${
                  negative ? 'rounded-l-full bg-down-500' : 'rounded-r-full bg-up-500'
                }`}
                style={
                  negative
                    ? { right: '50%', width: `${Math.max(0.4, width)}%` }
                    : { left: '50%', width: `${Math.max(0.4, width)}%` }
                }
                aria-hidden
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
