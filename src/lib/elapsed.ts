/**
 * Khoảng thời gian đã trôi qua, viết bằng tiếng Việt.
 *
 * VÌ SAO CẦN: với một cảnh báo rủi ro thì câu hỏi đầu tiên không phải "bắt đầu
 * lúc mấy giờ" mà "đã bao lâu rồi". "14:32 hôm qua" buộc người đọc tự trừ; "22
 * giờ" trả lời ngay. Thời điểm tuyệt đối vẫn hiện, nhưng ở vai trò phụ.
 *
 * Không dùng `Intl.RelativeTimeFormat`: nó cho ra "22 giờ trước" — đúng ngữ pháp
 * nhưng ở đây ta cần độ DÀI của một khoảng đang tiếp diễn ("đã tồn tại 22 giờ"),
 * không phải một mốc trong quá khứ.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function elapsedVi(from: Date, now: Date = new Date()): string {
  const ms = now.getTime() - from.getTime();

  // Lệch âm xảy ra thật khi đồng hồ máy chạy lệch hoặc dữ liệu tới từ tương lai.
  if (ms < 0) return 'vừa xong';
  if (ms < MINUTE) return 'dưới 1 phút';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} phút`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} giờ`;

  const days = Math.floor(ms / DAY);
  if (days < 30) return `${days} ngày`;

  const months = Math.floor(days / 30);
  return months < 12 ? `${months} tháng` : `${Math.floor(months / 12)} năm`;
}

/** Ngày giờ tuyệt đối, định dạng Việt Nam — dùng kèm `elapsedVi` làm thông tin phụ. */
export function absoluteVi(value: Date): string {
  return value.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
