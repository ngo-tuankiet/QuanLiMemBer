/**
 * THANH MỨC ĐỘ của kế hoạch dự phòng — mã lỗ sâu nhất của chiến lược đang ở đâu so với
 * ba mức đã đặt.
 *
 * Chỉ MỘT mã: mã lỗ sâu nhất là mã gần chạm (hoặc đã chạm) mức nhất — câu người đặt kế
 * hoạch cần trả lời là "mã nào sắp kích hoạt, còn cách bao xa". Các mã lỗ khác nằm trong
 * chú thích khi rê chuột.
 *
 * Lỗ đo đúng như bộ kiểm tra cảnh báo (`evaluateContingencyRules`): trên giá vốn bình
 * quân phần vị thế thuộc chiến lược, gộp mọi tài khoản, bỏ mã chưa có giá.
 *
 * Màu ba mức trùng ba chấm 🟡🟠🔴 của form ngay bên dưới.
 */

export interface MaLo {
  symbol: string;
  /** Mức lỗ, bps dương (1240 = lỗ 12,4%). */
  loBps: number;
}

const MAU_MUC = ['#EAB308', '#F97316', '#DC2626'] as const;

function pt(bps: number): string {
  return `${(bps / 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
}

export function ContingencyGauge({
  mucBps,
  maLo,
  soMaDangGiu,
}: {
  /** Ngưỡng Mức 1..3 (bps), `null` = mức chưa đặt. */
  mucBps: readonly (number | null)[];
  /** Các mã ĐANG lỗ, sâu nhất trước. */
  maLo: readonly MaLo[];
  /** Số mã đang giữ (có giá) trong chiến lược — để câu "không mã nào lỗ" có ngữ cảnh. */
  soMaDangGiu: number;
}) {
  const muc = mucBps
    .map((b, i) => (b !== null && b > 0 ? { i, b } : null))
    .filter((x): x is { i: number; b: number } => x !== null);
  const sauNhat = maLo[0] ?? null;

  if (soMaDangGiu === 0) {
    return <p className="text-tiny text-ink-500">Chiến lược chưa giữ mã nào.</p>;
  }
  if (!sauNhat) {
    return (
      <p className="text-tiny text-slate-muted">
        Không mã nào đang lỗ · {soMaDangGiu} mã đang giữ
      </p>
    );
  }

  const daCham = muc.filter((m) => sauNhat.loBps >= m.b);
  const ke = muc.find((m) => sauNhat.loBps < m.b) ?? null;
  const mucDat = daCham.length > 0 ? daCham[daCham.length - 1]! : null;

  const nguongCao = muc.length > 0 ? muc[muc.length - 1]!.b : 0;
  // Thang chừa 15% khoảng trống sau mức cao nhất, và luôn chứa được mã đang lỗ.
  const dinh = Math.max(nguongCao * 1.15, sauNhat.loBps * 1.08, 500);
  const viTri = (bps: number) => `${Math.min(100, (bps / dinh) * 100)}%`;

  const mauDay = mucDat ? MAU_MUC[mucDat.i]! : 'var(--color-slate-muted, #8a94a6)';
  const khac = maLo.slice(1, 6);
  const title =
    `Lỗ trên giá vốn bình quân phần thuộc chiến lược. ` +
    (khac.length > 0 ? `Mã lỗ tiếp theo: ${khac.map((m) => `${m.symbol} −${pt(m.loBps)}`).join(', ')}` : '');

  return (
    <div className="min-w-0" title={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-tiny">
        <span className="text-slate-muted">
          Gần chạm mức nhất:{' '}
          <span className="font-mono font-semibold text-strong">{sauNhat.symbol}</span>{' '}
          <span className="tabular font-medium text-down-500">−{pt(sauNhat.loBps)}</span>
          {maLo.length > 1 ? <span className="text-ink-500"> · {maLo.length} mã đang lỗ</span> : null}
        </span>
        <span className="tabular text-slate-soft">
          {muc.length === 0
            ? 'chưa đặt mức'
            : ke
              ? `${mucDat ? `đã chạm Mức ${mucDat.i + 1} · ` : ''}còn ${pt(ke.b - sauNhat.loBps)} tới Mức ${ke.i + 1}`
              : `đã chạm Mức ${mucDat!.i + 1}`}
        </span>
      </div>

      <div
        className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-ink-800"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={Math.round(dinh)}
        aria-valuenow={sauNhat.loBps}
        aria-label={`${sauNhat.symbol} lỗ ${pt(sauNhat.loBps)}`}
      >
        {/* Vùng của từng mức, tô nhạt — thấy ngay mã đang ở vùng nào. */}
        {muc.map((m, k) => {
          const het = muc[k + 1]?.b ?? dinh;
          return (
            <span
              key={m.i}
              className="absolute inset-y-0"
              style={{
                left: viTri(m.b),
                width: `calc(${viTri(het)} - ${viTri(m.b)})`,
                backgroundColor: MAU_MUC[m.i],
                opacity: 0.18,
              }}
              aria-hidden
            />
          );
        })}
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: viTri(sauNhat.loBps), backgroundColor: mauDay }}
          aria-hidden
        />
        {/* Vạch ngưỡng, khe 2px màu nền để tách khỏi phần đã tô. */}
        {muc.map((m) => (
          <span
            key={`v${m.i}`}
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-ink-900"
            style={{ left: viTri(m.b) }}
            aria-hidden
          />
        ))}
      </div>

      {muc.length > 0 ? (
        <div className="relative mt-0.5 h-3.5 text-micro">
          {muc.map((m) => (
            <span
              key={`n${m.i}`}
              className="tabular absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: viTri(m.b), color: MAU_MUC[m.i] }}
            >
              M{m.i + 1} {pt(m.b)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
