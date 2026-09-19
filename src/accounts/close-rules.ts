import 'server-only';

import { prisma } from '@/lib/prisma';
import { computeAccountBalances } from '@/domain/portfolio-engine';
import { formatVnd } from '@/lib/money';
import {
  CAPITAL_FLOW_STATUS,
  CAPITAL_FLOW_TYPE,
  TRADE_STATUS,
  TRANSACTION_TYPE,
} from '@/lib/enums';

/**
 * ĐIỀU KIỆN ĐÓNG TÀI KHOẢN CHỨNG KHOÁN.
 *
 * VÌ SAO Ở FILE RIÊNG, KHÔNG NẰM TRONG `actions.ts`. File đó mở đầu bằng `'use server'`,
 * và một module như vậy CHỈ được export hàm async — Turbopack dừng build với
 * "Server Actions must be async functions" ngay khi thêm `lyDoChuaDong` (hàm thường)
 * vào đó. Đây cũng là chỗ đúng hơn về mặt tổ chức: quy tắc nghiệp vụ dùng được ở cả
 * server action và trang, còn `actions.ts` chỉ nên chứa những việc ghi dữ liệu.
 */

/** Vì sao một tài khoản CHƯA đóng được. */
export interface LyDoChuaDongDuoc {
  /** Số mã còn giữ trong tài khoản. */
  soMaConGiu: number;
  /** Tên các mã còn giữ, để nói rõ phải bán gì. */
  maConGiu: string[];
  /** Tiền còn lại. Khác 0 — kể cả ÂM — là chưa đóng được. */
  tienConLai: bigint;
  /** Số yêu cầu rút đang chờ duyệt. */
  soYeuCauCho: number;
}

/**
 * Tài khoản này đóng được chưa.
 *
 * BA ĐIỀU KIỆN, và mỗi điều kiện ngăn một hậu quả cụ thể:
 *
 *   CÒN MÃ ĐẦU TƯ    cổ phiếu nằm ở tài khoản này. Đóng tài khoản mà vẫn còn vị thế là
 *                    đưa số cổ phiếu đó vào chỗ không bán được: form BÁN chỉ chọn tài
 *                    khoản đang mở, nên vị thế bị kẹt vĩnh viễn trong khi vẫn tính vào
 *                    lãi/lỗ của danh mục.
 *   CÒN TIỀN         tiền vẫn tính vào "Available Cash" của danh mục nhưng không rút ra
 *                    được nữa (`recordFlow` chặn tài khoản đã đóng). Số dư ÂM cũng chặn:
 *                    nó nghĩa là vốn nạp chưa khai đủ, và đóng lại là chốt sổ một tài
 *                    khoản đang sai.
 *   CÒN YÊU CẦU CHỜ  một yêu cầu rút vốn chờ duyệt trên tài khoản đã đóng không ai xử lý
 *                    được: duyệt thì tiền ra từ một tài khoản đã chốt sổ.
 *
 * Dùng ở CẢ HAI đầu — action để chặn, giao diện để nói trước. Cùng một hàm nên hai bên
 * không thể nói hai điều khác nhau.
 */
export async function kiemDongTaiKhoan(
  portfolioId: string,
  userId: string,
  accountId: string,
): Promise<LyDoChuaDongDuoc> {
  const [lenh, soDu, cho] = await Promise.all([
    prisma.trade.findMany({
      where: { brokerAccountId: accountId, portfolioId, status: TRADE_STATUS.EXECUTED },
      select: {
        transactionType: true,
        quantity: true,
        stock: { select: { symbol: true } },
      },
    }),
    computeAccountBalances(portfolioId, userId),
    prisma.capitalFlow.count({
      where: {
        brokerAccountId: accountId,
        flowType: CAPITAL_FLOW_TYPE.WITHDRAWAL,
        status: CAPITAL_FLOW_STATUS.PENDING,
      },
    }),
  ]);

  /*
   * Cộng theo TỪNG MÃ, không cộng tổng khối lượng. Tổng bằng 0 vẫn có thể là "còn 1.000
   * MBB và âm 1.000 VCB" — một trạng thái sai mà tổng gộp che mất.
   */
  const theoMa = new Map<string, number>();
  for (const t of lenh) {
    const dau = t.transactionType === TRANSACTION_TYPE.BUY ? 1 : -1;
    theoMa.set(t.stock.symbol, (theoMa.get(t.stock.symbol) ?? 0) + t.quantity * dau);
  }

  const maConGiu = [...theoMa.entries()]
    .filter(([, q]) => q !== 0)
    .sort((a, b) => b[1] - a[1])
    .map(([sym]) => sym);

  return {
    soMaConGiu: maConGiu.length,
    maConGiu,
    tienConLai: soDu.find((b) => b.accountId === accountId)?.available ?? 0n,
    soYeuCauCho: cho,
  };
}

/** Câu tiếng Việt nói vì sao chưa đóng được, hoặc `null` nếu đóng được. */
export function lyDoChuaDong(ly: LyDoChuaDongDuoc): string | null {
  const phan: string[] = [];

  if (ly.soMaConGiu > 0) {
    phan.push(
      `còn ${ly.soMaConGiu} mã trong tài khoản (${ly.maConGiu.slice(0, 5).join(', ')}` +
        `${ly.maConGiu.length > 5 ? '…' : ''})`,
    );
  }

  if (ly.tienConLai !== 0n) {
    phan.push(
      ly.tienConLai > 0n
        ? `còn ${formatVnd(ly.tienConLai)} tiền`
        : `số dư đang âm ${formatVnd(ly.tienConLai)} — vốn nạp chưa khai đủ`,
    );
  }

  if (ly.soYeuCauCho > 0) {
    phan.push(`còn ${ly.soYeuCauCho} yêu cầu rút vốn chờ duyệt`);
  }

  if (phan.length === 0) return null;

  return (
    `Chưa đóng được: ${phan.join(' · ')}. ` +
    'Bán hết vị thế và rút hết tiền trước khi đóng tài khoản.'
  );
}
