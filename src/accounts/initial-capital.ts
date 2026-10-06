import 'server-only';

/**
 * VỐN BAN ĐẦU THỰC TẾ — đưa khoản lỗ đã chốt TRƯỚC KHI VÀO HỆ THỐNG trở lại sổ.
 *
 * VẤN ĐỀ. Tài khoản có sẵn vị thế khi vào hệ thống được ghi một dòng "Vốn đầu kỳ" bằng
 * giá vốn các vị thế đang giữ + tiền mặt còn lại (xem `writeOpeningState` trong
 * actions.ts). Con số đó đúng cho tiền và vị thế, nhưng khoản lỗ đã chốt trước đó biến
 * mất: vốn ban đầu thấp hơn thật, và "lãi/lỗ đã chốt" bằng 0.
 *
 * CÁCH GHI (người dùng chọn): nhập VỐN BAN ĐẦU THỰC TẾ cho từng tài khoản; hệ thống tính
 *
 *   lỗ đã chốt trước = vốn ban đầu thực tế − vốn đầu kỳ (giá vốn + tiền mặt lúc vào)
 *
 * rồi ghi MỘT CẶP dòng vốn cùng `reference = VBD:<tài khoản>`:
 *
 *   CONTRIBUTION  +L   vốn ban đầu lên đúng số thật
 *   PRIOR_LOSS    −L   tiền mặt trở về như cũ (khớp sao kê sàn)
 *
 * Engine cộng −L vào lãi/lỗ đã chốt (`computePriorRealized`). Kết quả khớp:
 * vốn ban đầu + đã chốt + chưa chốt = giá trị hiện tại.
 *
 * Dùng GIÁ VỐN lúc vào chứ không phải giá thị trường hôm nay — quyết định của người dùng:
 * phần lỗ chưa chốt của mã đang giữ đã được tính riêng, dùng giá thị trường là đếm hai lần.
 */

import { prisma } from '@/lib/prisma';
import { CAPITAL_FLOW_STATUS, CAPITAL_FLOW_TYPE } from '@/lib/enums';

/** Tiền tố `reference` của cặp dòng. Một tài khoản có đúng một cặp. */
export const TIEN_TO_VON_BAN_DAU = 'VBD:';

export function maVonBanDau(accountId: string): string {
  return `${TIEN_TO_VON_BAN_DAU}${accountId}`;
}

/**
 * Dòng "Vốn đầu kỳ" nhận ra qua ghi chú — cột riêng không có. Dữ liệu thật có hai cách
 * viết ("Vốn đầu kỳ" và "Vốn đầu kỳ: giá vốn các vị thế có sẵn + tiền mặt còn lại"),
 * cả hai cùng tiền tố.
 */
export const TIEN_TO_DAU_KY = 'Vốn đầu kỳ';

/** Điều kiện Prisma: KHÔNG phải dòng của cặp vốn ban đầu. `reference` null cũng tính. */
export const khongPhaiCapVonBanDau = {
  OR: [{ reference: null }, { NOT: { reference: { startsWith: TIEN_TO_VON_BAN_DAU } } }],
};

export function laCapVonBanDau(reference: string | null | undefined): boolean {
  return (reference ?? '').startsWith(TIEN_TO_VON_BAN_DAU);
}

export interface VonBanDauTaiKhoan {
  accountId: string;
  /** Dòng "Vốn đầu kỳ" — null khi tài khoản mở mới trong hệ thống (không có gì "trước"). */
  dauKy: {
    id: string;
    amount: bigint;
    occurredAt: Date;
    portfolioId: string;
    teamId: string | null;
  } | null;
  /** Có HƠN MỘT dòng đầu kỳ — không biết lấy dòng nào làm mốc, nên không cho ghi. */
  nhieuDauKy: boolean;
  /** Khoản lỗ đã ghi (≥ 0). 0 = chưa ghi. */
  loTruoc: bigint;
  /** Vốn ban đầu thực tế = đầu kỳ + lỗ đã ghi. null khi không có đầu kỳ. */
  vonThucTe: bigint | null;
}

/** Trạng thái vốn ban đầu của các tài khoản. */
export async function docVonBanDau(
  accountIds: readonly string[],
): Promise<Map<string, VonBanDauTaiKhoan>> {
  if (accountIds.length === 0) return new Map();

  const [dauKy, cap] = await Promise.all([
    prisma.capitalFlow.findMany({
      where: {
        brokerAccountId: { in: [...accountIds] },
        flowType: CAPITAL_FLOW_TYPE.CONTRIBUTION,
        status: CAPITAL_FLOW_STATUS.CONFIRMED,
        note: { startsWith: TIEN_TO_DAU_KY },
        ...khongPhaiCapVonBanDau,
      },
      select: {
        id: true,
        brokerAccountId: true,
        amount: true,
        occurredAt: true,
        portfolioId: true,
        teamId: true,
      },
    }),
    prisma.capitalFlow.findMany({
      where: {
        reference: { in: accountIds.map(maVonBanDau) },
        flowType: CAPITAL_FLOW_TYPE.PRIOR_LOSS,
        status: CAPITAL_FLOW_STATUS.CONFIRMED,
      },
      select: { brokerAccountId: true, amount: true },
    }),
  ]);

  const ra = new Map<string, VonBanDauTaiKhoan>();
  for (const id of accountIds) {
    const cuaTk = dauKy.filter((d) => d.brokerAccountId === id);
    const lo = cap.filter((c) => c.brokerAccountId === id).reduce((s, c) => s + c.amount, 0n);
    const dk = cuaTk.length === 1 ? cuaTk[0]! : null;
    ra.set(id, {
      accountId: id,
      dauKy: dk
        ? {
            id: dk.id,
            amount: dk.amount,
            occurredAt: dk.occurredAt,
            portfolioId: dk.portfolioId,
            teamId: dk.teamId,
          }
        : null,
      nhieuDauKy: cuaTk.length > 1,
      loTruoc: lo,
      vonThucTe: dk ? dk.amount + lo : null,
    });
  }
  return ra;
}
