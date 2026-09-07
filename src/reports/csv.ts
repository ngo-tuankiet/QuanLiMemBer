/**
 * Sinh CSV (§20 Reports) — Phase 10.
 *
 * QUY ƯỚC ĐỊNH DẠNG, và lý do của từng quyết định:
 *
 * 1. BOM UTF-8 ở đầu tệp. Excel trên Windows mặc định đọc CSV bằng bảng mã ANSI
 *    của hệ thống; không có BOM thì "Tài chính" thành "TÃ i chÃ­nh". Đây là lỗi
 *    hay gặp nhất khi xuất báo cáo tiếng Việt.
 *
 * 2. Kết thúc dòng CRLF theo RFC 4180 — cũng là thứ Excel trên Windows mong đợi.
 *
 * 3. TIỀN GHI DẠNG SỐ NGUYÊN ĐỒNG, không dấu phân cách nghìn, không thập phân.
 *    Đây là điểm quan trọng nhất: Excel bản tiếng Việt dùng dấu phẩy làm dấu thập
 *    phân, nên "1.234.567,89" và "1,234,567.89" cho ra hai con số khác nhau tuỳ
 *    máy. Số nguyên trần thì không có dấu nào để hiểu sai. Toàn bộ tiền trong hệ
 *    thống vốn đã là số nguyên VNĐ (xem src/lib/money.ts) nên không mất gì cả.
 *
 * 4. Dấu phân cách trường là DẤU PHẨY. Excel VN mặc định chờ dấu chấm phẩy, nên
 *    tệp mở ra có thể dồn vào một cột — nhưng vì (3) đã bỏ hết dấu phẩy khỏi số,
 *    Data → Text to Columns sẽ tách đúng, còn mọi công cụ khác (Google Sheets,
 *    pandas, R) đọc đúng ngay. Chọn dấu chấm phẩy thì được Excel VN nhưng làm
 *    hỏng phần còn lại.
 *
 * 5. Ngày theo ISO `yyyy-MM-dd`. Không dùng `dd/MM/yyyy`: Excel sẽ đọc 03/04/2026
 *    là ngày 4 tháng 3 hoặc 3 tháng 4 tuỳ vùng miền của máy, và không có cách nào
 *    biết bản nào đúng khi mở tệp ở máy khác.
 */

const BOM = '﻿';
const CRLF = '\r\n';

/** Giá trị một ô: đã là chuỗi, hoặc số/bigint, hoặc rỗng. */
export type CsvCell = string | number | bigint | null | undefined;

/**
 * Số hợp lệ — dùng để biết một ô là DỮ LIỆU SỐ hay là chuỗi đáng ngờ.
 *
 * Chấp nhận dấu âm ở đầu và phần thập phân dùng dấu chấm, tức đúng những gì các
 * hàm bên dưới sinh ra: `-235973400`, `-17.91`, `100.00`.
 */
const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Bọc một ô theo RFC 4180.
 *
 * CHỐNG CSV INJECTION. Excel coi ô bắt đầu bằng `=`, `+`, `-`, `@` là công thức,
 * nên một ghi chú hay tên do người dùng nhập có thể trở thành lệnh chạy trên máy
 * người mở tệp. Những ô đó được thêm dấu nháy đơn ở đầu để Excel đọc như chữ.
 *
 * NHƯNG SỐ ÂM KHÔNG ĐƯỢC TÍNH VÀO ĐÓ. `-235973400` bắt đầu bằng `-` mà không
 * phải công thức, nó là một khoản lỗ. Thêm nháy đơn vào đó biến ô thành CHỮ, và
 * lúc đó cột lời/lỗ không cộng được trong Excel — phá đúng lý do cả tệp này ghi
 * tiền bằng số nguyên. Đây là lỗi đã thực sự xảy ra và được phát hiện khi soi
 * tệp xuất ra, không phải một giả định.
 *
 * Vì vậy: ô khớp `NUMERIC` thì để nguyên, còn lại mới bọc.
 */
function cell(value: CsvCell): string {
  if (value === null || value === undefined) return '';

  let text = typeof value === 'string' ? value : value.toString();

  if (!NUMERIC.test(text) && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;

  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: readonly string[], rows: readonly CsvCell[][]): string {
  const lines = [headers.map(cell).join(','), ...rows.map((row) => row.map(cell).join(','))];
  return BOM + lines.join(CRLF) + CRLF;
}

/** Ngày ISO `yyyy-MM-dd` theo giờ UTC — khớp cách lưu `tradingDate`. */
export function csvDate(value: Date | null | undefined): string {
  if (!value) return '';
  return value.toISOString().slice(0, 10);
}

/** Mốc thời gian `yyyy-MM-dd HH:mm:ss`, giờ Việt Nam. */
export function csvDateTime(value: Date | null | undefined): string {
  if (!value) return '';
  /*
   * Đổi sang ICT bằng cách cộng offset rồi lấy phần UTC. Việt Nam không có giờ
   * mùa hè nên offset luôn là +07:00 — cách này đúng ở mọi thời điểm và không phụ
   * thuộc múi giờ của máy chủ, khác với `toLocaleString`.
   */
  const ict = new Date(value.getTime() + 7 * 60 * 60 * 1000);
  return ict.toISOString().slice(0, 19).replace('T', ' ');
}

/** Basis point → chuỗi phần trăm dùng DẤU CHẤM thập phân, ví dụ `12.34`. */
export function csvPercent(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '';
  // Dấu chấm, không dấu phẩy: dấu phẩy là dấu phân cách trường của chính tệp này.
  return (bps / 100).toFixed(2);
}
