import type { ReactNode } from 'react';
import { formatCompactVnd, formatVnd } from '@/lib/money';

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
 */

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
          return (
            <li key={r.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2">
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
            </li>
          );
        })}
      </ul>

      {trailing}
    </div>
  );
}
