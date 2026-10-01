import 'server-only';

/**
 * BIỂU PHÍ ÁP CHO MỘT LỆNH — giải một lần, dùng ở mọi nơi.
 *
 * VÌ SAO CẦN MỘT CHỖ. Ba nơi cần đúng con số này và chúng PHẢI khớp nhau:
 *
 *   1. Form nhập lệnh dựng bảng "Giá trị · Phí · Thuế · Tiền thu về" ngay khi gõ.
 *   2. `createTradeAction` tính lại ở server và ghi xuống database.
 *   3. Người dùng đọc hai con số đó cạnh nhau.
 *
 * Lệch nhau thì người dùng thấy "phí 57.600" lúc nhập rồi "phí 76.800" sau khi lưu,
 * và không có gì trên màn hình giải thích vì sao. Nên form KHÔNG tự tính mức, nó nhận
 * mức đã giải sẵn từ server.
 *
 * NULL KHÁC 0. `buyFeeRateBps = null` nghĩa là "IB chưa khai riêng, theo mức chung";
 * `= 0` nghĩa là "IB này miễn phí mua". Gộp hai thứ đó lại thì không bao giờ đổi được
 * mức chung cho những IB chưa khai — mà đó chính là lý do có mức chung.
 *
 * TÀI KHOẢN MỞ TRỰC TIẾP (không IB) dùng toàn bộ mức chung. Đó là một câu trả lời
 * thật, không phải dữ liệu thiếu.
 */

import { prisma } from '@/lib/prisma';
import type { TradeRates } from '@/trading/fee-rates.shared';

export type { TradeRates };

/** Mức chung khi `system_settings` chưa có bản ghi — trùng với SETTING_SEED. */
const MAC_DINH = { fee: 15, tax: 10 } as const;

async function mucChung(): Promise<{ fee: number; tax: number }> {
  const [phi, thue] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: 'trading.default_fee_rate_bps' } }),
    prisma.systemSetting.findUnique({ where: { key: 'trading.sell_tax_rate_bps' } }),
  ]);
  return {
    fee: Number(phi?.value ?? MAC_DINH.fee),
    tax: Number(thue?.value ?? MAC_DINH.tax),
  };
}

function apDung(
  ib: { buyFeeRateBps: number | null; sellFeeRateBps: number | null; sellTaxRateBps: number | null } | null,
  chung: { fee: number; tax: number },
): TradeRates {
  return {
    buyFeeRateBps: ib?.buyFeeRateBps ?? chung.fee,
    sellFeeRateBps: ib?.sellFeeRateBps ?? chung.fee,
    sellTaxRateBps: ib?.sellTaxRateBps ?? chung.tax,
  };
}

/**
 * Biểu phí của MỘT tài khoản chứng khoán, theo IB gắn với nó.
 *
 * Dùng ở `createTradeAction` — nơi con số được ghi xuống database.
 */
export async function ratesForAccount(brokerAccountId: string | null): Promise<TradeRates> {
  const chung = await mucChung();
  if (!brokerAccountId) return apDung(null, chung);

  const acc = await prisma.brokerAccount.findUnique({
    where: { id: brokerAccountId },
    select: {
      ib: { select: { buyFeeRateBps: true, sellFeeRateBps: true, sellTaxRateBps: true } },
    },
  });

  return apDung(acc?.ib ?? null, chung);
}

/**
 * Biểu phí của MỌI tài khoản người dùng chọn được, tra theo id.
 *
 * Dùng ở trang nhập lệnh: ô "Tài khoản thực hiện" đổi thì bảng phí phải đổi theo ngay,
 * mà đổi tài khoản là việc xảy ra ở client — nên gửi sẵn cả bảng thay vì hỏi lại server
 * sau mỗi lần chọn.
 */
export async function ratesByAccount(
  brokerAccountIds: readonly string[],
): Promise<Record<string, TradeRates>> {
  const chung = await mucChung();
  if (brokerAccountIds.length === 0) return {};

  const accs = await prisma.brokerAccount.findMany({
    where: { id: { in: [...brokerAccountIds] } },
    select: {
      id: true,
      ib: { select: { buyFeeRateBps: true, sellFeeRateBps: true, sellTaxRateBps: true } },
    },
  });

  const out: Record<string, TradeRates> = {};
  for (const a of accs) out[a.id] = apDung(a.ib ?? null, chung);
  return out;
}

/** Mức chung, cho nơi chưa chọn tài khoản nào. */
export async function defaultRates(): Promise<TradeRates> {
  return apDung(null, await mucChung());
}
