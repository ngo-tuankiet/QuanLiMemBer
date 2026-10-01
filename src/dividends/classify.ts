/**
 * PHÂN LOẠI SỰ KIỆN QUYỀN CỦA VNSTOCK.
 *
 * VCI trả về hai mã sự kiện trong nhóm "DIVIDEND":
 *
 *   DIV  cổ tức tiền mặt — có sẵn `value_per_share` (VNĐ/CP).
 *   ISS  "phát hành cổ phiếu" — và đây là chỗ cần cẩn thận. Cùng một mã ISS gộp NĂM
 *        việc khác hẳn nhau, đo được trên 37 mã đang giao dịch:
 *
 *          Stock dividend      cổ tức bằng cổ phiếu     → cổ đông NHẬN cổ phiếu
 *          Bonus Issue         cổ phiếu thưởng           → cổ đông NHẬN cổ phiếu
 *          Rights issue        quyền mua                 → phải NỘP TIỀN mới nhận
 *          ESOP / CBCNV        phát hành cho nhân viên   → cổ đông KHÔNG nhận gì
 *          Private placement   phát hành riêng lẻ        → cổ đông KHÔNG nhận gì
 *
 *        Nhận mọi ISS thì danh sách chờ sẽ có "FPT phát hành cho CBCNV 0,5%", và một
 *        người bấm "ghi nhận" là tự cộng cho mình cổ phiếu không có thật.
 *
 * PHÂN LOẠI THEO TIÊU ĐỀ TIẾNG ANH TRƯỚC. Tiêu đề tiếng Việt có dấu và viết hoa không
 * đều ("Trả Cổ tức bằng Cổ phiếu"); tiêu đề tiếng Anh ngắn và đều hơn. Tiếng Việt là
 * lớp đỡ khi nguồn bỏ trống tiếng Anh.
 *
 * KHÔNG KHỚP MẪU NÀO THÌ TRẢ `null` — bỏ, không đoán. Một loại phát hành mới mà nguồn
 * đặt tên khác đi sẽ không hiện trong danh sách, và đó là chiều sai an toàn: thiếu một
 * lời nhắc, chứ không bịa ra cổ phiếu. `scripts/test-corporate-events.ts` canh bộ mẫu.
 *
 * File thuần — không import gì — để bài kiểm gọi thẳng được.
 */

import type { CorporateEventKind } from '@/lib/enums';

/** Những trường của VCI mà phân loại cần tới. */
export interface SuKienNguon {
  event_code?: string | null;
  event_title_en?: string | null;
  event_title_vi?: string | null;
}

export function phanLoaiSuKien(e: SuKienNguon): CorporateEventKind | null {
  const ma = (e.event_code ?? '').trim().toUpperCase();
  if (ma === 'DIV') return 'CASH_DIVIDEND';
  if (ma !== 'ISS') return null;

  const en = (e.event_title_en ?? '').toLowerCase();
  const vi = (e.event_title_vi ?? '').toLowerCase();

  /*
   * THỨ TỰ KIỂM QUAN TRỌNG: loại "không nhận gì" đứng TRƯỚC. Một tiêu đề kiểu "Bonus
   * shares for employees" chứa cả "bonus" lẫn "employee"; kiểm "bonus" trước thì nó
   * thành cổ phiếu thưởng cho cổ đông.
   */
  if (/esop|employee|staff|private placement/.test(en)) return null;
  if (/cbcnv|người lao động|riêng lẻ/.test(vi)) return null;

  if (/stock dividend/.test(en) || /cổ tức bằng cổ phiếu/.test(vi)) return 'STOCK_DIVIDEND';
  if (/bonus/.test(en) || /cổ phiếu thưởng/.test(vi)) return 'BONUS_SHARES';
  if (/rights? issue/.test(en) || /quyền mua/.test(vi)) return 'RIGHTS_ISSUE';

  return null;
}

/** Hệ số của `ratioE9` — tỷ lệ lưu dạng số nguyên, xem chú thích cột trong schema. */
export const RATIO_SCALE = 1_000_000_000n;

/**
 * Tỷ lệ dạng số thực của nguồn → số nguyên × 1e9.
 *
 * Làm tròn qua chuỗi thập phân chứ không nhân float: `0.2604104 * 1e9` trong JS ra
 * `260410399.99999997`, và `Math.floor` của nó thiếu mất một đơn vị — đúng loại sai
 * số làm lệch một cổ phiếu ở ranh giới làm tròn.
 */
export function tyLeSangE9(ratio: number | null | undefined): bigint | null {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio) || ratio <= 0) return null;
  const [nguyen = '0', le = ''] = ratio.toFixed(9).split('.');
  return BigInt(nguyen) * RATIO_SCALE + BigInt(le.padEnd(9, '0').slice(0, 9));
}

/**
 * Số cổ phiếu nhận được (hoặc được quyền mua) trên một khối lượng.
 *
 * LÀM TRÒN XUỐNG: doanh nghiệp Việt Nam huỷ phần lẻ cổ phiếu phát sinh, không làm tròn
 * lên. Giữ 1 VPB với tỷ lệ 26% là nhận 0 cổ phiếu — và mục đó không được hiện ra.
 */
export function soCoPhieuNhan(khoiLuong: number, ratioE9: bigint): number {
  if (khoiLuong <= 0 || ratioE9 <= 0n) return 0;
  return Number((BigInt(khoiLuong) * ratioE9) / RATIO_SCALE);
}
