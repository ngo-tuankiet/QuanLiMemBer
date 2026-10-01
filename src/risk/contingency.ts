/**
 * KẾ HOẠCH DỰ PHÒNG — quy tắc dùng chung, không đụng database.
 *
 * Mỗi chiến lược có tối đa BA MỨC: khi một mã của chiến lược đó lỗ (trên giá vốn bình
 * quân của phần thuộc chiến lược, gộp mọi tài khoản) chạm mức cài đặt thì hệ thống bắn
 * một cảnh báo, kèm hành động đã ghi sẵn cho mức đó.
 *
 * LƯU THÀNH NGƯỠNG RỦI RO, không bảng riêng. Mỗi mức là một dòng `risk_rules` với
 * scope `STRATEGY_POSITION`. Nhờ vậy cảnh báo đi qua đúng đường ống sẵn có — cái chuông
 * trên menu, trang Rủi ro, nút tiếp nhận, tự đóng khi giá hồi — thay vì một hệ thông
 * báo thứ hai phải giữ cho khớp với cái thứ nhất.
 *
 * File thuần: mọi quyết định (mã ngưỡng, mức → độ nghiêm trọng, ai được thấy) ở đây để
 * bài kiểm gọi thẳng được.
 */

import { ROLE, SEVERITY, type Severity } from '@/lib/enums';

export const SO_MUC = 3;
export type MucDuPhong = 1 | 2 | 3;

/**
 * Mức càng sâu càng nghiêm trọng: 🟡 → 🟠 → 🔴.
 *
 * Không dùng INFO cho mức 1: một mã đã lỗ tới mức người quản lý đặt ra là việc cần
 * nhìn, không phải thông tin để đọc cho biết.
 */
export const DO_NGHIEM_TRONG: Record<MucDuPhong, Severity> = {
  1: SEVERITY.WARNING,
  2: SEVERITY.HIGH,
  3: SEVERITY.CRITICAL,
};

/**
 * Mã ngưỡng của một mức — theo ID chiến lược, không theo mã chiến lược.
 *
 * Mã chiến lược sửa được ở trang quản trị; theo nó thì đổi mã là mất liên kết với
 * ngưỡng cũ và sinh ra ba ngưỡng mới, còn cảnh báo cũ treo lại không ai đóng.
 */
export function maNguong(strategyId: string, muc: MucDuPhong): string {
  return `DUPHONG_${strategyId}_M${muc}`;
}

/** Đọc ngược mức từ mã ngưỡng. `null` nếu không phải ngưỡng dự phòng. */
export function mucCuaMaNguong(code: string): MucDuPhong | null {
  const m = /^DUPHONG_.+_M([123])$/.exec(code);
  return m ? (Number(m[1]) as MucDuPhong) : null;
}

export interface MucCaiDat {
  muc: MucDuPhong;
  /** Mức lỗ, bps dương: 700 = lỗ 7%. */
  nguongBps: number;
  hanhDong: string | null;
  ruleId: string;
}

/**
 * CHỈ MỨC SÂU NHẤT ĐÃ CHẠM MỚI BẮN.
 *
 * Một mã lỗ 30% thì đã chạm cả ba mức. Bắn cả ba là ba cảnh báo cho một sự việc, và cái
 * ở trên cùng (mức 1, "theo dõi") lại là cái ít cần làm nhất. Chỉ bắn mức sâu nhất thì
 * khi giá rơi tiếp, cảnh báo mức 1 tự đóng và mức 2 mở — danh sách luôn nói đúng việc
 * cần làm lúc này.
 */
export function mucSauNhatDaCham(
  loBps: number,
  cacMuc: readonly MucCaiDat[],
): MucCaiDat | null {
  let chon: MucCaiDat | null = null;
  for (const m of cacMuc) {
    if (loBps >= m.nguongBps && (chon === null || m.nguongBps > chon.nguongBps)) chon = m;
  }
  return chon;
}

/**
 * Các mức phải TĂNG DẦN: mức 2 lỗ sâu hơn mức 1, mức 3 sâu hơn mức 2.
 *
 * Để trống một mức là được (kế hoạch chỉ hai mức), nhưng những mức đã điền phải đúng
 * thứ tự — ngược thứ tự thì "mức 1" bắn sau "mức 3" và hành động ghi sẵn thành vô nghĩa.
 */
export function kiemThuTuMuc(
  cacMuc: readonly { muc: MucDuPhong; nguongBps: number | null }[],
): string | null {
  const daDien = cacMuc
    .filter((m): m is { muc: MucDuPhong; nguongBps: number } => m.nguongBps !== null)
    .sort((a, b) => a.muc - b.muc);
  for (let i = 1; i < daDien.length; i++) {
    if (daDien[i]!.nguongBps <= daDien[i - 1]!.nguongBps) {
      return `Mức ${daDien[i]!.muc} phải lỗ sâu hơn mức ${daDien[i - 1]!.muc}.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ai được thấy cảnh báo dự phòng
// ---------------------------------------------------------------------------

export interface NguoiXemCanhBao {
  roleCode: string | null;
  teamId: string | null;
}

/**
 * THEO YÊU CẦU: ADMIN VÀ CÁC CẤP QUẢN LÝ.
 *
 *   Admin, Quản lý cấp cao   mọi cảnh báo dự phòng.
 *   Quản lý nhóm             chỉ mã mà NHÓM MÌNH đang giữ trong chiến lược đó.
 *   Người thực thi, thành viên  không thấy — dù họ có quyền xem trang Rủi ro.
 *
 * Danh sách nhóm đang giữ nằm trong `contextJson.teamIds` của cảnh báo, ghi lúc quét.
 * Đọc lại lúc hiển thị chứ không tính lại: cảnh báo nói về thời điểm quét, và đó cũng
 * là thời điểm con số lỗ trong cảnh báo được đo.
 */
export function xemDuocCanhBaoDuPhong(
  nguoi: NguoiXemCanhBao,
  contextJson: string | null,
): boolean {
  if (nguoi.roleCode === ROLE.ADMIN || nguoi.roleCode === ROLE.SENIOR_MANAGER) return true;
  if (nguoi.roleCode !== ROLE.TEAM_MANAGER || !nguoi.teamId) return false;
  try {
    const ctx = JSON.parse(contextJson ?? '{}') as { teamIds?: unknown };
    return Array.isArray(ctx.teamIds) && ctx.teamIds.includes(nguoi.teamId);
  } catch {
    return false;
  }
}
