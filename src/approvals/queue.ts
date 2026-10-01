import 'server-only';

/**
 * VIỆC ĐANG CHỜ MÀ **NGƯỜI NÀY** QUYẾT ĐƯỢC.
 *
 * VÌ SAO ĐẾM THEO NGƯỜI, KHÔNG ĐẾM THÔ. Một huy hiệu "3" trên menu là một lời hứa:
 * bấm vào sẽ có 3 việc để làm. Đếm thô toàn hệ thống thì trưởng nhóm Cầu Lông thấy
 * số 3 gồm cả việc của nhóm Đá Bóng, bấm vào thấy trống, và lần sau họ bỏ qua huy
 * hiệu — đúng thói quen khiến một việc thật bị lỡ. Nên con số này đi qua CẢ BA chốt
 * mà nút bấm thật sự đi qua:
 *
 *   1. QUYỀN     `transaction.approve` / `capital.approve`.
 *   2. PHẠM VI   `dataScope` — không có `*.view_all` thì chỉ thấy nhóm mình.
 *   3. BỐN MẮT   không ai tự quyết việc của chính mình (§8) — kể cả việc mình nhập
 *                hộ người khác, và với rút vốn là cả tài khoản của chính mình.
 *
 * Trượt chốt 3 mà vẫn đếm là tệ nhất: người dùng thấy số, mở ra, bấm, rồi bị từ chối
 * bởi một quy tắc họ không gây ra.
 *
 * VÌ SAO Ở ĐÂY CHỨ KHÔNG Ở TRANG. Hai nơi cần con số này — huy hiệu trên menu
 * (`AppShell`, mọi trang) và thẻ "việc cần làm" (`/dashboard`) — và trang `/approvals`
 * cần đúng bộ lọc ấy để liệt kê. Ba nơi tự viết lại thì sớm muộn ba nơi nói ba con số.
 */

import { prisma } from '@/lib/prisma';
import { dataScope, resolvePermissions } from '@/domain/permissions';
import type { AuthUser } from '@/auth/guards';
import { TRADE_STATUS, CAPITAL_FLOW_TYPE, CAPITAL_FLOW_STATUS } from '@/lib/enums';
import type { RoleCode, PermissionEffect } from '@/lib/enums';

export interface PendingWorkload {
  /** Lệnh chờ duyệt mà người này quyết được. */
  trades: number;
  /** Yêu cầu rút vốn chờ duyệt mà người này quyết được. */
  withdrawals: number;
  /**
   * Việc người này THẤY nhưng KHÔNG quyết được vì chốt bốn mắt.
   *
   * Không cộng vào huy hiệu, nhưng cần cho lời giải thích: "1 việc đang chờ người
   * khác duyệt" khác hẳn "không có việc nào".
   */
  blockedByFourEyes: number;
  /** Tổng việc quyết được — con số hiện trên huy hiệu. */
  total: number;
}

const RONG: PendingWorkload = { trades: 0, withdrawals: 0, blockedByFourEyes: 0, total: 0 };

/**
 * @param portfolioId Giới hạn theo danh mục đang xem. Bỏ trống = mọi danh mục.
 *   Truyền vào từ trang nói về một danh mục cụ thể, để con số trên trang đó không
 *   đếm việc của danh mục khác.
 */
export async function countPendingForUser(
  user: AuthUser,
  portfolioId?: string,
): Promise<PendingWorkload> {
  const coTrade = user.permissions.has('transaction.approve');
  const coCapital = user.permissions.has('capital.approve');
  if (!coTrade && !coCapital) return RONG;

  const loc = portfolioId ? { portfolioId } : {};

  /*
   * Phạm vi của LỆNH và của VỐN hỏi riêng: một vai trò được xem lệnh mọi nhóm nhưng
   * chỉ xem vốn nhóm mình là cấu hình hợp lệ. Dùng chung một biến là đếm nhầm.
   */
  const pvTrade = dataScope(user.permissions, 'transaction');
  const pvCapital = dataScope(user.permissions, 'capital');

  /*
   * `teamId: null` KHÔNG khớp khi lọc theo nhóm — một việc chưa gắn nhóm sẽ không
   * ai ở phạm vi hẹp thấy. Đó là hành vi của trang `/approvals`, và con số này phải
   * nói đúng thứ trang đó liệt kê, kể cả khi thứ đó chưa lý tưởng.
   */
  const nhom = (pv: 'ALL' | 'SCOPED' | 'NONE') =>
    pv === 'ALL' ? {} : { teamId: user.teamId ?? '__no_team__' };

  const [lenh, rut] = await Promise.all([
    coTrade && pvTrade !== 'NONE'
      ? prisma.trade.findMany({
          where: { status: TRADE_STATUS.PENDING_APPROVAL, ...nhom(pvTrade), ...loc },
          select: { createdById: true, userId: true },
        })
      : Promise.resolve([]),

    coCapital && pvCapital !== 'NONE'
      ? prisma.capitalFlow.findMany({
          where: {
            flowType: CAPITAL_FLOW_TYPE.WITHDRAWAL,
            status: CAPITAL_FLOW_STATUS.PENDING,
            ...nhom(pvCapital),
            ...loc,
          },
          select: { createdById: true, brokerAccount: { select: { userId: true } } },
        })
      : Promise.resolve([]),
  ]);

  // Cùng phép so sánh với `approveTradeAction` và `quyetDinhRut`.
  const lenhCuaMinh = (t: { createdById: string | null; userId: string | null }) =>
    t.createdById === user.id || t.userId === user.id;
  const rutCuaMinh = (f: {
    createdById: string | null;
    brokerAccount: { userId: string } | null;
  }) => f.createdById === user.id || f.brokerAccount?.userId === user.id;

  const trades = lenh.filter((t) => !lenhCuaMinh(t)).length;
  const withdrawals = rut.filter((f) => !rutCuaMinh(f)).length;
  const blockedByFourEyes =
    lenh.filter(lenhCuaMinh).length + rut.filter(rutCuaMinh).length;

  return { trades, withdrawals, blockedByFourEyes, total: trades + withdrawals };
}

/**
 * AI DUYỆT ĐƯỢC TỪNG YÊU CẦU RÚT VỐN NÀY.
 *
 * VÌ SAO CẦN. Người gửi chỉ thấy "chờ duyệt rút …" — một câu nói rằng yêu cầu ĐÃ
 * ĐƯỢC GHI, chứ không nói nó đã tới tay ai. Nếu không ai đủ điều kiện quyết định,
 * yêu cầu treo vô thời hạn và người gửi cứ chờ. Danh sách này biến "chờ duyệt"
 * thành "chờ ai duyệt", và quan trọng nhất là để lộ ra trường hợp RỖNG.
 *
 * Quét toàn bộ người đang hoạt động một lần rồi lọc trong bộ nhớ: số người dùng
 * của hệ thống này tính bằng chục, còn hỏi database cho từng yêu cầu thì mỗi dòng
 * trên thẻ tài khoản đẻ ra một truy vấn.
 */
export async function whoCanApproveWithdrawals(
  flows: readonly {
    id: string;
    teamId: string | null;
    createdById: string | null;
    brokerAccountUserId: string | null;
  }[],
): Promise<Map<string, string[]>> {
  const ketQua = new Map<string, string[]>();
  if (flows.length === 0) return ketQua;

  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      fullName: true,
      teamId: true,
      role: { select: { code: true } },
      permissions: {
        select: { effect: true, expiresAt: true, permission: { select: { code: true } } },
      },
    },
  });

  const nguoi = users.map((u) => {
    const quyen = resolvePermissions(
      (u.role?.code ?? null) as RoleCode | null,
      u.permissions.map((p) => ({
        permissionCode: p.permission.code,
        effect: p.effect as PermissionEffect,
        expiresAt: p.expiresAt,
      })),
    );
    return {
      id: u.id,
      ten: u.fullName ?? '(chưa đặt tên)',
      teamId: u.teamId,
      quyet: quyen.has('capital.approve'),
      phamVi: dataScope(quyen, 'capital'),
    };
  });

  for (const f of flows) {
    const duyetDuoc = nguoi
      .filter((u) => {
        if (!u.quyet) return false;
        if (u.phamVi === 'NONE') return false;
        if (u.phamVi === 'SCOPED' && (u.teamId === null || u.teamId !== f.teamId)) return false;
        // Bốn mắt — cùng phép so sánh với `quyetDinhRut`.
        if (f.createdById === u.id || f.brokerAccountUserId === u.id) return false;
        return true;
      })
      .map((u) => u.ten);
    ketQua.set(f.id, duyetDuoc);
  }

  return ketQua;
}
