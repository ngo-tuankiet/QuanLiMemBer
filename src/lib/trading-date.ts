/**
 * CHUẨN HOÁ NGÀY GIAO DỊCH.
 *
 * Mọi cột `tradingDate` và `snapshotDate` trong hệ thống PHẢI đi qua đây.
 *
 * VÌ SAO CẦN FILE NÀY
 * `market_quotes`, `price_history`, `market_index_history` và `portfolio_snapshots`
 * đều có khoá unique theo (đối tượng, ngày). Nhưng `DateTime` lưu một *thời điểm*,
 * không lưu một *ngày*. Nếu hai nơi ghi cùng một ngày giao dịch với giờ khác nhau
 * — ví dụ seed ghi 15:00 giờ Việt Nam (08:00Z) còn service ghi 00:00Z — thì:
 *
 *   - khoá unique KHÔNG chặn được, database có hai dòng cho cùng một ngày;
 *   - phép tính lấy "dòng đầu/cuối trong khoảng" chọn sai dòng;
 *   - và không có lỗi nào được ném ra. Số liệu chỉ đơn giản là sai.
 *
 * Đây là lỗi đã thực sự xảy ra: Alpha trên Dashboard hiển thị theo dữ liệu seed cũ
 * thay vì dữ liệu VN-Index thật, vì dòng seed 08:00Z sắp sau dòng thật 00:00Z.
 *
 * CÁCH CHUẨN HOÁ
 * Ngày giao dịch được xác định theo **múi giờ Việt Nam (ICT, UTC+7)**, rồi lưu
 * thành nửa đêm UTC của ngày đó. Không dùng giờ địa phương của server: một server
 * ở UTC lúc 18:00 ngày 24 đang là 01:00 ngày 25 tại Việt Nam — phiên giao dịch của
 * ngày 25.
 */

/** Lệch múi giờ Việt Nam so với UTC, tính bằng phút. ICT = UTC+7, không có DST. */
const ICT_OFFSET_MINUTES = 7 * 60;

/**
 * Ngày giao dịch (theo giờ Việt Nam) của một thời điểm, dạng `YYYY-MM-DD`.
 *
 * Không dùng `toLocaleDateString` với timeZone vì nó phụ thuộc dữ liệu ICU của
 * runtime; phép cộng offset là xác định và không có DST cần xử lý.
 */
export function tradingDayString(instant: Date = new Date()): string {
  const ict = new Date(instant.getTime() + ICT_OFFSET_MINUTES * 60_000);
  return ict.toISOString().slice(0, 10);
}

/**
 * Chuẩn hoá về nửa đêm UTC của ngày giao dịch.
 *
 * Nhận vào `Date` (một thời điểm) hoặc chuỗi `YYYY-MM-DD` (đã là một ngày).
 *
 *   toTradingDate(new Date('2026-08-25T01:00:00+07:00'))  → 2026-08-25T00:00:00Z
 *   toTradingDate(new Date('2026-08-24T15:00:00+07:00'))  → 2026-08-24T00:00:00Z
 *   toTradingDate('2026-08-24')                           → 2026-08-24T00:00:00Z
 */
export function toTradingDate(input: Date | string = new Date()): Date {
  if (typeof input === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(input.trim());
    if (!match) throw new Error(`toTradingDate: chuỗi ngày không hợp lệ "${input}"`);
    return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  }
  return new Date(`${tradingDayString(input)}T00:00:00.000Z`);
}

/** Hiển thị ngày giao dịch theo định dạng Việt Nam, không lệch múi giờ. */
export function formatTradingDate(date: Date): string {
  // Cột đã lưu ở nửa đêm UTC nên đọc phần UTC là đúng ngày, không cần đổi múi giờ.
  const iso = date.toISOString().slice(0, 10);
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Phiên giao dịch HOSE/HNX: 09:00–15:00 ICT, thứ Hai đến thứ Sáu. */
export function isTradingHours(instant: Date = new Date()): boolean {
  const ict = new Date(instant.getTime() + ICT_OFFSET_MINUTES * 60_000);
  const weekday = ict.getUTCDay(); // 0 = Chủ nhật, 6 = thứ Bảy
  if (weekday === 0 || weekday === 6) return false;
  const hour = ict.getUTCHours();
  return hour >= 9 && hour < 15;
}

/**
 * PHIÊN GIAO DỊCH GẦN NHẤT ĐÃ ĐÓNG, theo giờ Việt Nam.
 *
 * Dùng để trả lời "giá đang lưu có phải mới nhất có thể không", thay cho phép đo
 * "bao nhiêu phút đã trôi qua". Hai câu hỏi khác hẳn nhau: 9 giờ sáng thứ Hai, giá
 * đóng cửa thứ Sáu đã 60 tiếng tuổi nhưng vẫn là giá MỚI NHẤT TỒN TẠI.
 *
 * Quy tắc:
 *   thứ Bảy, Chủ nhật     → lùi về thứ Sáu
 *   ngày thường, đã đóng  → chính hôm nay
 *   ngày thường, chưa đóng→ lùi về ngày làm việc trước
 *
 * KHÔNG BIẾT NGÀY LỄ. Hệ thống chưa có lịch nghỉ lễ của HOSE, nên hôm sau một ngày
 * lễ sẽ thấy "chậm 1 phiên" trong đúng một ngày rồi tự hết. Chấp nhận được: cái giá
 * của việc không có lịch lễ là một cảnh báo thừa mỗi vài tháng, còn cái giá của quy
 * tắc cũ là một cảnh báo thừa mỗi đêm và trọn hai ngày cuối tuần.
 */
export function lastClosedSession(now: Date = new Date(), closeHour = 15): Date {
  const ict = new Date(now.getTime() + ICT_OFFSET_MINUTES * 60_000);
  const probe = new Date(ict);

  // Ngày thường mà chưa qua giờ đóng cửa thì phiên hôm nay chưa xong.
  const laNgayThuong = probe.getUTCDay() >= 1 && probe.getUTCDay() <= 5;
  if (!laNgayThuong || probe.getUTCHours() < closeHour) {
    probe.setUTCDate(probe.getUTCDate() - 1);
  }

  // Lùi tiếp qua cuối tuần.
  while (probe.getUTCDay() === 0 || probe.getUTCDay() === 6) {
    probe.setUTCDate(probe.getUTCDate() - 1);
  }

  return toTradingDate(
    `${probe.getUTCFullYear()}-${String(probe.getUTCMonth() + 1).padStart(2, '0')}-${String(probe.getUTCDate()).padStart(2, '0')}`,
  );
}

/** Số phiên (ngày làm việc) giữa hai ngày giao dịch. Âm nếu `from` ở sau `to`. */
export function sessionsBetween(from: Date, to: Date): number {
  const dau = new Date(Math.min(from.getTime(), to.getTime()));
  const cuoi = new Date(Math.max(from.getTime(), to.getTime()));
  let n = 0;
  const d = new Date(dau);
  while (d.getTime() < cuoi.getTime()) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) n += 1;
  }
  return from.getTime() <= to.getTime() ? n : -n;
}

/** Đang trong phiên giao dịch (giờ Việt Nam) hay không. */
export function inTradingSession(
  now: Date = new Date(),
  startHour = 9,
  closeHour = 15,
): boolean {
  const ict = new Date(now.getTime() + ICT_OFFSET_MINUTES * 60_000);
  const thu = ict.getUTCDay();
  if (thu === 0 || thu === 6) return false;
  const gio = ict.getUTCHours();
  return gio >= startHour && gio < closeHour;
}
