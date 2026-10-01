import type { ReactNode } from 'react';
import Link from 'next/link';
import { formatCompactVnd, formatVnd } from '@/lib/money';
import { AvgCost, Change, MoneyCompact, Price, Quantity, Weight } from '@/components/money';

/**
 * GIÁ TRỊ TỪNG TÀI KHOẢN — vị thế và tiền mặt, trên cùng một thanh.
 *
 * VÌ SAO THANH CHỒNG CHỨ KHÔNG PHẢI HAI BIỂU ĐỒ. Câu hỏi là "tài khoản này đang đáng
 * bao nhiêu, và trong đó bao nhiêu là tiền mặt". Hai biểu đồ cạnh nhau buộc người đọc
 * tự cộng; một thanh chồng trả lời cả hai bằng một hình: tổng là chiều dài thanh, phần
 * tiền mặt là đoạn thứ hai.
 *
 * ĐỘ DÀI CHUẨN HOÁ THEO TÀI KHOẢN LỚN NHẤT, không theo tổng. Chuẩn theo tổng thì tài
 * khoản nhỏ co lại thành một vạch không đọc được — mà so sánh giữa các tài khoản mới
 * là việc của biểu đồ này. Con số tuyệt đối vẫn in bên phải nên không mất thông tin.
 *
 * HAI MÀU CỐ ĐỊNH, KHÔNG LẤY THEO SLOT XẾP HẠNG. "Vị thế" và "tiền mặt" là hai LOẠI
 * tài sản, giống nhau ở mọi tài khoản — màu phải nói lên loại, không nói lên thứ hạng.
 * Dùng `seriesColor(i)` ở đây sẽ khiến cùng một thứ đổi màu theo vị trí trong danh sách.
 *
 * MÀU KHÔNG PHẢI KÊNH DUY NHẤT: mỗi thanh có dòng chữ ghi rõ "vị thế X · tiền mặt Y"
 * ngay dưới, và có chú giải ở đầu khối. Người không phân biệt được hai màu vẫn đọc đủ.
 *
 * BẤM VÀO MỘT TÀI KHOẢN THÌ BẢNG VỊ THẾ CỦA NÓ MỞ RA NGAY TẠI CHỖ. Dùng
 * `<details>` của trình duyệt chứ không dùng state: component này là Server
 * Component, và đóng/mở một khối không phải lý do đủ để kéo nó sang client. Được
 * luôn bàn phím (Enter/Space) và trình đọc màn hình mà không phải tự viết.
 *
 * Tài khoản KHÔNG GIỮ MÃ NÀO thì không bấm được — một cú bấm mở ra khoảng trống là
 * một cú bấm lừa người dùng.
 */

/** Một dòng trong bảng vị thế của tài khoản — đã sẵn để hiển thị. */
export interface AccountPositionRow {
  stockId: string;
  symbol: string;
  companyName: string;
  sectorNameVi: string;
  sectorColor: string | null;
  quantity: number;
  avgCostMicro: bigint;
  totalCost: bigint;
  currentPrice: bigint;
  missingPrice: boolean;
  marketValue: bigint;
  unrealizedPnl: bigint;
  returnBps: number;
  realizedPnl: bigint;
  /** Tỷ trọng trong GIÁ TRỊ TÀI KHOẢN (vị thế + tiền mặt) — xem `weightInAccount`. */
  weightBps: number;
  strategies: { strategyId: string; strategyNameVi: string; quantity: number }[];
}

export interface AccountValueRow {
  key: string;
  /** Tên sàn, ví dụ "VPS" hoặc "TCBS (Techcom Securities)". */
  broker: string;
  accountNo: string;
  /** Giá trị vị thế theo giá hiện tại. */
  positionValue: bigint;
  /** Tiền mặt còn lại trong tài khoản. */
  cash: bigint;
  heldSymbols: string[];
  symbolsMissingPrice: string[];
  isActive: boolean;
  /** Vị thế đang mở của tài khoản. Bỏ trống hoặc rỗng = tài khoản không bấm mở được. */
  positions?: readonly AccountPositionRow[];
  /** Tỷ trọng của phần tiền mặt trong giá trị tài khoản — dòng cuối của bảng. */
  cashWeightBps?: number;
}

const MAU_VI_THE = 'var(--series-1)';
const MAU_TIEN = 'var(--series-3)';

function ChuGiai({ mau, chu }: { mau: string; chu: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: mau }} aria-hidden />
      <span className="text-tiny text-slate-muted">{chu}</span>
    </span>
  );
}

export function AccountValueBars({
  rows,
  trailing,
}: {
  rows: readonly AccountValueRow[];
  /** Nội dung phụ đặt dưới cùng, ví dụ dòng ghi chú của thẻ cha. */
  trailing?: ReactNode;
}) {
  if (rows.length === 0) return null;

  const tongMoiTk = rows.map((r) => r.positionValue + r.cash);
  /*
   * `1n` làm sàn để không chia cho 0 khi mọi tài khoản đều rỗng. Không dùng nó làm
   * chiều rộng tối thiểu — xem chú thích về "₫0 thì không vẽ gì" bên dưới.
   */
  const lonNhat = tongMoiTk.reduce((m, v) => (v > m ? v : m), 1n);

  const tongViThe = rows.reduce((s, r) => s + r.positionValue, 0n);
  const tongTien = rows.reduce((s, r) => s + r.cash, 0n);

  /** Phần trăm chiều rộng của một đoạn, so với tài khoản lớn nhất. */
  const phanTram = (v: bigint): number => {
    if (v <= 0n) return 0;
    // Nhân 10.000 trước khi chia để giữ 2 số lẻ mà vẫn ở trong bigint.
    return Number((v * 10_000n) / lonNhat) / 100;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-4">
          <ChuGiai mau={MAU_VI_THE} chu="giá trị vị thế" />
          <ChuGiai mau={MAU_TIEN} chu="tiền mặt" />
        </div>
        <p className="tabular text-tiny text-slate-muted">
          tổng {formatCompactVnd(tongViThe + tongTien)}
          {' · '}
          vị thế {formatCompactVnd(tongViThe)}
          {' · '}
          tiền mặt {formatCompactVnd(tongTien)}
        </p>
      </div>

      <ul className="space-y-3">
        {rows.map((r) => {
          const tong = r.positionValue + r.cash;
          const moDuoc = (r.positions?.length ?? 0) > 0;

          const dau = (
            <>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2">
                  {moDuoc ? <MuiTen /> : null}
                  <span className="truncate text-sm text-slate-soft">{r.broker}</span>
                  <span className="truncate font-mono text-micro text-ink-500">{r.accountNo}</span>
                  {!r.isActive ? (
                    <span className="shrink-0 rounded border border-ink-700 px-1.5 py-px text-micro text-slate-muted">
                      đã đóng
                    </span>
                  ) : null}
                </span>
                <span className="tabular shrink-0 text-sm text-strong">{formatVnd(tong)}</span>
              </div>

              {/*
                BẰNG 0 THÌ KHÔNG VẼ GÌ — cùng quy tắc với `RankedBars`. Một sàn tối
                thiểu áp cho mọi giá trị sẽ biến ₫0 thành một vạch nhìn thấy được, và
                người đọc hiểu thành "có một ít" trong khi sự thật là không có đồng nào.
              */}
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full"
                  style={{ width: `${phanTram(r.positionValue)}%`, backgroundColor: MAU_VI_THE }}
                />
                {/* 2px nền chen giữa hai đoạn để chúng không dính thành một khối. */}
                {r.positionValue > 0n && r.cash > 0n ? (
                  <div className="h-full w-0.5 shrink-0 bg-ink-900" />
                ) : null}
                <div
                  className="h-full"
                  style={{ width: `${phanTram(r.cash)}%`, backgroundColor: MAU_TIEN }}
                />
              </div>

              <p className="mt-1 text-tiny text-slate-muted">
                <span className="tabular">vị thế {formatVnd(r.positionValue)}</span>
                {r.heldSymbols.length > 0 ? (
                  <span className="text-ink-500">
                    {' '}
                    ({r.heldSymbols.length} mã: {r.heldSymbols.join(', ')})
                  </span>
                ) : (
                  <span className="text-ink-500"> (không giữ mã nào)</span>
                )}
                {' · '}
                <span className="tabular">tiền mặt {formatVnd(r.cash)}</span>
              </p>

              {/*
                MÃ THIẾU GIÁ PHẢI NÓI RA. Nó đóng góp 0 đồng vào thanh, nên thanh ngắn
                hơn sự thật. Im lặng ở đây nghĩa là người đọc thấy một con số thấp mà
                không có cách nào biết vì sao.
              */}
              {r.symbolsMissingPrice.length > 0 ? (
                <p className="mt-0.5 text-tiny text-warn-500">
                  {r.symbolsMissingPrice.length} mã chưa có giá ({r.symbolsMissingPrice.join(', ')})
                  {' — '}
                  phần giá trị này chưa được tính vào thanh
                </p>
              ) : null}
            </>
          );

          if (!moDuoc) return <li key={r.key}>{dau}</li>;

          return (
            <li key={r.key}>
              <details className="group/tk">
                {/*
                  `list-none` + `[&::-webkit-details-marker]:hidden` bỏ tam giác mặc
                  định của trình duyệt — nó đứng ở đầu dòng và đẩy lệch cả khối
                  thanh. Mũi tên riêng nằm ngay trước tên sàn, xoay khi mở.
                */}
                <summary
                  className="-mx-2 cursor-pointer list-none rounded-lg px-2 py-1.5 transition hover:bg-ink-850/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 [&::-webkit-details-marker]:hidden"
                  title="Bấm để xem vị thế của tài khoản này"
                >
                  {dau}
                </summary>
                <BangViThe row={r} />
              </details>
            </li>
          );
        })}
      </ul>

      {trailing}
    </div>
  );
}

/** Mũi tên báo "bấm mở được". Xoay 90° khi khối đang mở. */
function MuiTen() {
  return (
    <svg
      viewBox="0 0 12 12"
      className="size-2.5 shrink-0 self-center text-slate-muted transition-transform group-open/tk:rotate-90"
      aria-hidden
    >
      <path
        d="M4 2l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * BẢNG VỊ THẾ CỦA MỘT TÀI KHOẢN.
 *
 * DÒNG "TIỀN MẶT" NẰM TRONG BẢNG để cột Tỷ trọng cộng lại đủ 100%. Bỏ nó đi thì một
 * tài khoản giữ 2 mã với 60% tiền mặt hiện hai tỷ trọng cộng lại 40%, và người đọc
 * phải tự đoán 60% còn lại ở đâu.
 *
 * DÒNG TỔNG DÙNG ĐÚNG CON SỐ CỦA THANH PHÍA TRÊN (`positionValue + cash`), không
 * cộng lại từ các dòng. Σ các dòng phải bằng nó — `scripts/test-account-positions.ts`
 * canh điều đó — nên trên màn hình không có chỗ cho hai tổng lệch nhau.
 *
 * GIÁ VỐN LÀ CỦA RIÊNG TÀI KHOẢN NÀY. Cùng một mã nằm ở hai tài khoản có hai giá vốn
 * khác nhau, và đó là đúng: mỗi tài khoản mua ở giá của nó.
 */
function BangViThe({ row }: { row: AccountValueRow }) {
  const ds = row.positions ?? [];
  const tongVon = ds.reduce((t, p) => t + p.totalCost, 0n);
  const tongLai = ds.reduce((t, p) => (p.missingPrice ? t : t + p.unrealizedPnl), 0n);

  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-ink-700">
      <table className="w-full min-w-[56rem] text-sm">
        <caption className="sr-only">
          Vị thế đang giữ ở tài khoản {row.broker} {row.accountNo}
        </caption>
        <thead>
          <tr className="border-b border-ink-700 text-left text-xs text-slate-muted">
            <th className="px-3 py-2 font-medium">Mã</th>
            <th className="px-3 py-2 text-right font-medium">Khối lượng</th>
            <th className="px-3 py-2 text-right font-medium">Giá vốn TB</th>
            <th className="px-3 py-2 text-right font-medium">Tổng giá vốn</th>
            <th className="px-3 py-2 text-right font-medium">Giá hiện tại</th>
            <th className="px-3 py-2 text-right font-medium">Giá trị TT</th>
            <th className="px-3 py-2 text-right font-medium">Lãi/lỗ chưa chốt</th>
            <th className="px-3 py-2 text-right font-medium">Đã chốt</th>
            <th className="px-3 py-2 text-right font-medium">Tỷ trọng</th>
            <th className="px-3 py-2 font-medium">Chiến lược</th>
          </tr>
        </thead>

        <tbody>
          {ds.map((p) => (
            <tr key={p.stockId} className="border-b border-ink-800 hover:bg-ink-850/60">
              <td className="px-3 py-2">
                <Link
                  href={`/transactions?symbol=${p.symbol}`}
                  className="font-mono font-semibold text-strong hover:text-accent-400"
                  title={p.companyName}
                >
                  {p.symbol}
                </Link>
                <span className="mt-0.5 flex items-center gap-1.5 text-tiny text-slate-muted">
                  <span
                    className="size-1.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: p.sectorColor ?? 'var(--ink-500)' }}
                    aria-hidden
                  />
                  {p.sectorNameVi}
                </span>
              </td>
              <td className="px-3 py-2 text-right">
                <Quantity value={p.quantity} className="text-slate-soft" />
              </td>
              <td className="px-3 py-2 text-right">
                <AvgCost micro={p.avgCostMicro} className="text-slate-soft" />
              </td>
              <td className="px-3 py-2 text-right">
                <MoneyCompact value={p.totalCost} className="text-slate-soft" />
              </td>
              <td className="px-3 py-2 text-right">
                {p.missingPrice ? (
                  <span className="text-xs text-warn-500">thiếu giá</span>
                ) : (
                  <Price value={p.currentPrice} className="text-strong" />
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <MoneyCompact value={p.marketValue} className="text-strong" />
              </td>
              <td className="px-3 py-2 text-right">
                {/*
                  THIẾU GIÁ THÌ KHÔNG CÓ LÃI/LỖ ĐỂ HIỆN. Giá trị thị trường khi đó là 0,
                  nên phép trừ cho ra "lỗ đúng bằng toàn bộ giá vốn" — một khoản lỗ
                  không có thật, tô đỏ và trông y như thật.
                */}
                {p.missingPrice ? (
                  <span className="text-xs text-ink-500">—</span>
                ) : (
                  <span className="flex flex-col items-end">
                    <MoneyCompact value={p.unrealizedPnl} signed />
                    <Change bps={p.returnBps} className="text-tiny" />
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                {p.realizedPnl !== 0n ? (
                  <MoneyCompact value={p.realizedPnl} signed />
                ) : (
                  <span className="text-xs text-ink-500">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <Weight bps={p.weightBps} className="text-slate-soft" />
              </td>
              <td className="px-3 py-2">
                {p.strategies.length === 0 ? (
                  <span className="text-xs text-warn-500">chưa gán</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {p.strategies.map((c) => (
                      <span
                        key={c.strategyId}
                        className="rounded border border-ink-700 px-1.5 py-px text-tiny text-slate-soft"
                      >
                        {c.strategyNameVi}
                        {/* Một chiến lược thì khối lượng trùng cột bên trái — khỏi lặp. */}
                        {p.strategies.length > 1 ? (
                          <span className="tabular text-slate-muted">
                            {' '}
                            {c.quantity.toLocaleString('vi-VN')}
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          ))}

          <tr className="border-b border-ink-800">
            <td className="px-3 py-2 text-xs text-slate-soft" colSpan={5}>
              Tiền mặt
            </td>
            <td className="px-3 py-2 text-right">
              <MoneyCompact value={row.cash} className="text-strong" />
            </td>
            <td colSpan={2} />
            <td className="px-3 py-2 text-right">
              {row.cashWeightBps !== undefined && row.cash > 0n ? (
                <Weight bps={row.cashWeightBps} className="text-slate-soft" />
              ) : (
                <span className="text-xs text-ink-500">—</span>
              )}
            </td>
            <td />
          </tr>
        </tbody>

        <tfoot>
          <tr className="text-xs font-medium text-strong">
            <td className="px-3 py-2" colSpan={3}>
              Tổng · {ds.length} mã
            </td>
            <td className="px-3 py-2 text-right">
              <MoneyCompact value={tongVon} />
            </td>
            <td />
            <td className="px-3 py-2 text-right">
              <MoneyCompact value={row.positionValue + row.cash} />
            </td>
            <td className="px-3 py-2 text-right">
              <MoneyCompact value={tongLai} signed />
            </td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
