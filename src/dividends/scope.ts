/**
 * AI THẤY, AI GHI HỘ ĐƯỢC mục cổ tức của ai.
 *
 * Theo yêu cầu của người dùng:
 *
 *   cá nhân              thấy và ghi mục của CHÍNH MÌNH
 *   quản lý nhóm         thấy và ghi hộ mục của THÀNH VIÊN CÙNG NHÓM
 *   quản lý cấp cao, admin  thấy và ghi hộ mục của MỌI NGƯỜI
 *
 * "MỌI NGƯỜI" ĐI THEO QUYỀN, KHÔNG THEO TÊN VAI TRÒ: ai có `transaction.view_all` thì
 * xem được mọi giao dịch, nên xem mọi mục cổ tức là cùng một phạm vi. Hai quyền cho
 * cùng một dữ liệu là hai nguồn sự thật — đúng bài học đã ghi ở `dataScope`.
 *
 * "CÙNG NHÓM" ĐI THEO VAI TRÒ TEAM_MANAGER + `users.teamId`. Cột `teams.leaderId` có
 * trong schema nhưng hiện để trống ở cả năm nhóm, nên dựa vào nó là không ai được
 * xem gì.
 *
 * File thuần: nhận dữ liệu vào, trả quyết định ra — để bài kiểm dựng được mọi ca.
 */

import { ROLE } from '@/lib/enums';

export type PhamViCoTuc =
  | { loai: 'ALL'; userId: string }
  | { loai: 'TEAM'; userId: string; teamId: string }
  | { loai: 'SELF'; userId: string };

export interface NguoiXem {
  id: string;
  roleCode: string | null;
  teamId: string | null;
  permissions: ReadonlySet<string>;
}

export function phamViCoTuc(u: NguoiXem): PhamViCoTuc {
  if (u.permissions.has('transaction.view_all')) return { loai: 'ALL', userId: u.id };
  if (u.roleCode === ROLE.TEAM_MANAGER && u.teamId) {
    return { loai: 'TEAM', userId: u.id, teamId: u.teamId };
  }
  return { loai: 'SELF', userId: u.id };
}

/** Điều kiện Prisma trên `users` cho phạm vi này. */
export function dieuKienChuTaiKhoan(pv: PhamViCoTuc) {
  if (pv.loai === 'ALL') return {};
  if (pv.loai === 'TEAM') return { OR: [{ id: pv.userId }, { teamId: pv.teamId }] };
  return { id: pv.userId };
}

/** Chủ tài khoản này có nằm trong phạm vi của người xem không. */
export function trongPhamVi(pv: PhamViCoTuc, chu: { id: string; teamId: string | null }): boolean {
  if (pv.loai === 'ALL') return true;
  if (chu.id === pv.userId) return true;
  return pv.loai === 'TEAM' && chu.teamId === pv.teamId;
}

/**
 * Người này có ghi được (hoặc bỏ qua được) mục của tài khoản đó không.
 *
 * CHÍNH CHỦ cần `transaction.create` — quy tắc có sẵn của form cổ tức, không nới.
 *
 * GHI HỘ chỉ cần nằm trong phạm vi quản lý, KHÔNG cần `transaction.create`: quản lý
 * cấp cao không có quyền đó (họ không tự đặt lệnh), nhưng người dùng đã quyết định họ
 * được ghi hộ cổ tức. Cổ tức không phải một quyết định đầu tư — nó là việc doanh
 * nghiệp đã làm, và ghi vào chỉ là cho sổ sách khớp sao kê.
 */
export function ghiDuoc(u: NguoiXem, chu: { id: string; teamId: string | null }): boolean {
  if (chu.id === u.id) return u.permissions.has('transaction.create');
  const pv = phamViCoTuc(u);
  return pv.loai !== 'SELF' && trongPhamVi(pv, chu);
}
