'use server';

/**
 * Server Action cho giao dịch (§6, §8) — Phase 04 & 05.
 *
 * ĐÂY LÀ ĐƯỜNG GHI DUY NHẤT vào `trades` và `trade_strategies`. Mọi ràng buộc cốt
 * lõi được cưỡng chế ở đây:
 *
 *   1. Σ allocationBps = 10000 — qua `tradeSchema` (zod).
 *   2. Σ allocationAmount = netAmount tuyệt đối — qua `buildTradeStrategyRows()`
 *      dùng thuật toán largest-remainder.
 *   3. Trade và các dòng phân bổ ghi trong CÙNG một transaction — không bao giờ
 *      tồn tại một Trade thiếu phân bổ.
 *   4. Mọi thay đổi ghi Audit Log Before/After (§20). Sửa khối lượng hay giá thì
 *      phân bổ được TÍNH LẠI, nếu không tổng sẽ lệch so với giá trị lệnh.
 *   5. Optimistic locking qua `version` — hai người sửa cùng lúc thì người sau bị
 *      từ chối thay vì âm thầm ghi đè.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { dataScope } from '@/domain/permissions';
import { writeAudit } from '@/lib/audit';
import { requirePermission, requestMeta, type AuthUser } from '@/auth/guards';
import { tradeSchema, buildTradeStrategyRows } from '@/domain/validation';
import { ratesForAccount } from '@/trading/fee-rates';
import {
  allocateAmount,
  bpsFromWeights,
  calcFee,
  grossAmount,
  netAmount,
  formatVnd,
} from '@/lib/money';
import { computeStrategyHoldings } from '@/domain/portfolio-engine';
import {
  AUDIT_ACTION,
  ENTITY_TYPE,
  TRADE_STATUS,
  TRADE_STATUS_TRANSITIONS,
  TRANSACTION_TYPE,
  APPROVAL_STATUS,
  type TradeStatus,
} from '@/lib/enums';

export interface ActionResult {
  ok: boolean;
  message?: string;
  tradeId?: string;
  fieldErrors?: Record<string, string[]>;
}

function zodErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function refresh(tradeId?: string): void {
  revalidatePath('/transactions');
  revalidatePath('/portfolio');
  revalidatePath('/portfolio/positions');
  revalidatePath('/portfolio/allocation');
  revalidatePath('/strategies');
  revalidatePath('/approvals');
  revalidatePath('/dashboard');
  revalidatePath('/audit');

  /*
   * Hai trang này cũng đọc số liệu suy từ giao dịch, nên phải nằm trong danh sách.
   * Thiếu chúng thì duyệt một lệnh xong, Dashboard cập nhật ngay mà trang Teams và
   * trang chi tiết cá nhân vẫn hiện số cũ — kiểu lệch khiến người dùng không biết
   * tin trang nào.
   */
  revalidatePath('/teams');
  revalidatePath('/members');
  // Dạng có tham số: revalidate MỌI trang chi tiết cá nhân, không chỉ một id.
  revalidatePath('/members/[id]', 'page');

  if (tradeId) revalidatePath(`/transactions/${tradeId}`);
}

/** Nhãn dễ đọc cho Audit Log: "BUY MBB 40.000 @ 25.300". */
function tradeLabel(
  type: string,
  symbol: string,
  quantity: number,
  price: bigint,
): string {
  return `${type} ${symbol} ${quantity.toLocaleString('vi-VN')} @ ${price.toLocaleString('vi-VN')}`;
}

/**
 * Đọc danh sách phân bổ chiến lược từ FormData.
 *
 * Form gửi lên dạng `alloc_<strategyId> = <phần trăm>`. Người dùng nhập phần trăm
 * (50, 30, 20) còn hệ thống lưu basis point, nên phải nhân 100 — và nhân bằng số
 * nguyên để "33.34" thành đúng 3334 bps chứ không phải 3333.9999.
 */
/**
 * Đọc KHỐI LƯỢNG theo từng chiến lược — chỉ dùng cho lệnh BÁN.
 *
 * Form gửi `qty_<strategyId> = <khối lượng>`. Bán thì nhập khối lượng chứ không
 * nhập phần trăm, vì điều kiện chặn là điều kiện về KHỐI LƯỢNG: "không bán quá số
 * đã mua theo chiến lược đó". Gõ phần trăm thì người nhập phải tự nhẩm 30% của
 * 10.000 có vượt 8.400 hay không — và nhẩm sai thì server từ chối sau khi đã điền
 * xong cả form.
 */
function readSellQuantities(formData: FormData): { strategyId: string; quantity: number }[] {
  const out: { strategyId: string; quantity: number }[] = [];

  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith('qty_')) continue;
    const value = String(raw).trim().replace(/[.,\s]/g, '');
    if (value === '') continue;

    const quantity = Number(value);
    if (!Number.isInteger(quantity) || quantity <= 0) continue;

    out.push({ strategyId: key.slice('qty_'.length), quantity });
  }

  return out;
}

function readAllocations(formData: FormData): { strategyId: string; allocationBps: number }[] {
  const out: { strategyId: string; allocationBps: number }[] = [];

  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith('alloc_')) continue;
    const value = String(raw).trim().replace(',', '.');
    if (value === '') continue;

    const percent = Number(value);
    if (!Number.isFinite(percent) || percent <= 0) continue;

    out.push({
      strategyId: key.slice('alloc_'.length),
      allocationBps: Math.round(percent * 100),
    });
  }

  return out;
}

/** Chỉ cho phép các bước chuyển trạng thái đã khai báo, chống "sửa lụi" trạng thái. */
function assertTransition(from: TradeStatus, to: TradeStatus): void {
  const allowed = TRADE_STATUS_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(`Không thể chuyển trạng thái ${from} → ${to}.`);
  }
}

/** Sinh mã giao dịch dạng TXN-<năm>-<số thứ tự 6 chữ số>. */
async function nextTradeCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `TXN-${year}-`;

  const last = await prisma.trade.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });

  const lastSeq = last ? Number(last.code.slice(prefix.length)) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Tạo giao dịch
// ---------------------------------------------------------------------------

export async function createTradeAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('transaction.create');

  const symbol = String(formData.get('symbol') ?? '').trim().toUpperCase();
  const portfolioId = String(formData.get('portfolioId') ?? '');
  const transactionType = String(formData.get('transactionType') ?? '');
  const submitForApproval = formData.get('submitForApproval') === 'on';

  /*
   * Đọc sớm vì nhánh BÁN cần nó TRƯỚC khi parse: trần khi bán đo theo tài khoản, nên
   * không biết tài khoản thì chưa tính được trần. Tính hợp lệ của chính tài khoản
   * (có tồn tại, có phải của người gọi, có đang mở) vẫn do phần sau kiểm.
   */
  const brokerAccountId = String(formData.get('brokerAccountId') ?? '');

  // Người dùng gõ giá và khối lượng theo thói quen bảng giá: "25.300", "40,000".
  const quantity = Number(String(formData.get('quantity') ?? '').replace(/[.,\s]/g, ''));
  const rawPrice = String(formData.get('price') ?? '').replace(/[.,\s]/g, '');

  if (!symbol) return { ok: false, fieldErrors: { symbol: ['Chọn mã chứng khoán.'] } };
  if (!/^\d+$/.test(rawPrice)) return { ok: false, fieldErrors: { price: ['Giá không hợp lệ.'] } };

  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: { id: true, symbol: true, status: true, exchange: true },
  });

  // §7: không cho nhập mã tự do.
  if (!stock) {
    return {
      ok: false,
      fieldErrors: { symbol: [`Mã ${symbol} không có trong danh mục chuẩn.`] },
    };
  }
  if (stock.status === 'DELISTED') {
    return { ok: false, fieldErrors: { symbol: [`${symbol} đã huỷ niêm yết, không thể giao dịch.`] } };
  }

  const price = BigInt(rawPrice);
  const laBan = transactionType === TRANSACTION_TYPE.SELL;

  /*
   * PHÂN BỔ CHIẾN LƯỢC: MUA và BÁN nhập theo hai cách khác nhau.
   *
   *   MUA  người nhập tự quyết luận điểm → gõ PHẦN TRĂM, tổng phải đủ 100%
   *   BÁN  chỉ bán được thứ đã mua → gõ KHỐI LƯỢNG từng chiến lược, mỗi dòng
   *        chặn ở đúng số đã mua theo chiến lược đó
   *
   * Thị trường Việt Nam không có bán khống, nên lệnh bán luôn là đóng một phần vị
   * thế đã có. Quy nó về đúng chiến lược đã mua là điều kiện để lãi/lỗ theo chiến
   * lược trên Dashboard còn đúng — gán bừa một chiến lược cho lệnh bán sẽ làm chiến
   * lược đó lỗ ảo và chiến lược thật lãi ảo.
   */
  let strategies: { strategyId: string; allocationBps: number }[];

  if (laBan) {
    /*
     * THỨ TỰ KIỂM: "có giữ mã này không" TRƯỚC "đã chia theo chiến lược chưa".
     *
     * Kiểm ngược lại thì người chọn một mã mình không giữ sẽ nhận thông báo "điền
     * khối lượng cho ít nhất một chiến lược" — và đi tìm những dòng chiến lược không
     * tồn tại, vì mã đó không có dòng nào cả. Câu đúng phải là "bạn không giữ VCB".
     *
     * TRẦN ĐO THEO TÀI KHOẢN, không theo người.
     *
     * Cổ phiếu nằm ở một tài khoản chứng khoán cụ thể và lệnh bán đi qua đúng tài
     * khoản đó. Đo theo người thì MBB giữ ở tài khoản SSI vẫn bán được khi đang chọn
     * tài khoản VPBankS — và lệnh bán đó tạo ra vị thế ÂM ở VPBankS. Đã xảy ra thật
     * trước khi có chốt này.
     */
    if (!brokerAccountId) {
      return {
        ok: false,
        fieldErrors: { brokerAccountId: ['Chọn tài khoản chứng khoán đang giữ mã này.'] },
      };
    }

    const kho = await computeStrategyHoldings(portfolioId, actor.id, brokerAccountId);
    const cuaMa = kho.find((h) => h.stockId === stock.id);

    if (!cuaMa || cuaMa.quantity <= 0) {
      /*
       * Nói rõ mã đó có ở TÀI KHOẢN KHÁC hay không có ở đâu cả — hai việc cần hai
       * hành động khác nhau: đổi tài khoản, hay đừng bán mã này.
       */
      const khoCaNguoi = await computeStrategyHoldings(portfolioId, actor.id);
      const oChoKhac = khoCaNguoi.find((h) => h.stockId === stock.id);

      return {
        ok: false,
        fieldErrors: {
          symbol: [
            oChoKhac && oChoKhac.quantity > 0
              ? `Tài khoản này không giữ ${stock.symbol}. Bạn có ` +
                `${oChoKhac.quantity.toLocaleString('vi-VN')} ${stock.symbol} ở tài khoản khác — ` +
                'chọn đúng tài khoản đang giữ.'
              : `Bạn không giữ ${stock.symbol} nào. Chỉ bán được mã đang có trong tài khoản của mình.`,
          ],
        },
      };
    }

    const nhap = readSellQuantities(formData);
    if (nhap.length === 0) {
      return {
        ok: false,
        fieldErrors: {
          strategies: [
            `Chia ${quantity.toLocaleString('vi-VN')} ${stock.symbol} cho các chiến lược ` +
              `bên dưới — bạn đang giữ mã này theo ${cuaMa.byStrategy.length} chiến lược.`,
          ],
        },
      };
    }

    const tranTheoCL = new Map(cuaMa.byStrategy.map((x) => [x.strategyId, x]));
    const loi: string[] = [];

    for (const d of nhap) {
      const tran = tranTheoCL.get(d.strategyId);
      if (!tran) {
        loi.push(`Có dòng phân bổ cho chiến lược bạn chưa mua ${stock.symbol} theo.`);
        continue;
      }
      if (d.quantity > tran.quantity) {
        loi.push(
          `${tran.strategyNameVi}: chỉ giữ ${tran.quantity.toLocaleString('vi-VN')} ` +
            `${stock.symbol} theo chiến lược này, không bán được ${d.quantity.toLocaleString('vi-VN')}.`,
        );
      }
    }

    const tongNhap = nhap.reduce((t, d) => t + d.quantity, 0);
    if (tongNhap !== quantity) {
      loi.push(
        `Tổng khối lượng chia theo chiến lược là ${tongNhap.toLocaleString('vi-VN')}, ` +
          `phải bằng đúng khối lượng bán ${quantity.toLocaleString('vi-VN')}.`,
      );
    }

    if (loi.length > 0) return { ok: false, fieldErrors: { strategies: loi } };

    const bps = bpsFromWeights(nhap.map((d) => BigInt(d.quantity)));

    /*
     * ĐỔI QUA RỒI ĐỔI LẠI PHẢI KHỚP TUYỆT ĐỐI.
     *
     * `trade_strategies` lưu tỷ lệ bps, không lưu khối lượng. Độ phân giải của bps
     * là 0,01% — nên một chiến lược chiếm 1 trên 100.000 cổ phiếu làm tròn về 0 bps
     * và biến mất. Nếu để lọt, khối lượng theo chiến lược sẽ trôi dần mỗi lần bán và
     * mức trần lần sau sai theo, không ai truy được vì sao.
     *
     * Phép kiểm chính là phép đổi ngược: nếu `allocateAmount` không dựng lại được
     * đúng những con số vừa nhập thì từ chối, thay vì lưu một tỷ lệ không biểu diễn
     * được con số đó.
     */
    const dungLai = allocateAmount(BigInt(quantity), bps);
    const lech = nhap.findIndex((d, i) => dungLai[i] !== BigInt(d.quantity));
    if (lech >= 0) {
      const ten = tranTheoCL.get(nhap[lech]!.strategyId)?.strategyNameVi ?? 'chiến lược';
      return {
        ok: false,
        fieldErrors: {
          strategies: [
            `${ten}: khối lượng ${nhap[lech]!.quantity.toLocaleString('vi-VN')} quá nhỏ so với ` +
              `tổng ${quantity.toLocaleString('vi-VN')} để lưu chính xác (dưới 0,01%). ` +
              'Tách thành lệnh riêng hoặc làm tròn lên.',
          ],
        },
      };
    }

    strategies = nhap.map((d, i) => ({ strategyId: d.strategyId, allocationBps: bps[i]! }));
  } else {
    strategies = readAllocations(formData);
  }

  /*
   * Phí và thuế: lấy BIỂU PHÍ CỦA IB gắn với tài khoản thực hiện, nếu người dùng để
   * trống hai ô đó.
   *
   * Giải ở server chứ không tin con số form gửi lên: form có tính sẵn để hiện bảng
   * "Tiền thu về", nhưng đó là tiện ích hiển thị, và `fees`/`tax` trong `FormData`
   * thì gửi tay được. Người dùng VẪN được tự điền hai ô đó — phí thật của sàn có thể
   * lệch vài đồng so với công thức — nhưng khi để trống thì mức áp là mức của IB.
   */
  const rates = await ratesForAccount(brokerAccountId);

  const gross = grossAmount(quantity || 0, price);
  const rawFees = String(formData.get('fees') ?? '').replace(/[.,\s]/g, '');
  const rawTax = String(formData.get('tax') ?? '').replace(/[.,\s]/g, '');

  const laBanRa = transactionType === TRANSACTION_TYPE.SELL;

  const fees = /^\d+$/.test(rawFees)
    ? BigInt(rawFees)
    : calcFee(gross, laBanRa ? rates.sellFeeRateBps : rates.buyFeeRateBps);
  const tax = /^\d+$/.test(rawTax)
    ? BigInt(rawTax)
    : laBanRa
      ? calcFee(gross, rates.sellTaxRateBps)
      : 0n;

  const parsed = tradeSchema.safeParse({
    portfolioId,
    stockId: stock.id,
    transactionType,
    quantity,
    price,
    fees,
    tax,
    executedAt: new Date(String(formData.get('executedAt') ?? '')),
    userId: actor.id,
    teamId: actor.teamId ?? undefined,
    brokerAccountId: String(formData.get('brokerAccountId') ?? '') || undefined,
    status: TRADE_STATUS.DRAFT,
    orderId: String(formData.get('orderId') ?? '') || undefined,
    broker: String(formData.get('broker') ?? '') || undefined,
    executionNote: String(formData.get('executionNote') ?? '') || undefined,
    investmentThesis: String(formData.get('investmentThesis') ?? '') || undefined,
    strategies,
  });

  if (!parsed.success) {
    /*
     * Thiếu tài khoản là lỗi hay gặp nhất ở đây và thông báo mặc định của zod
     * ("Thiếu định danh") không nói được người dùng phải làm gì.
     */
    const missingAccount = parsed.error.issues.some(
      (i) => i.path[0] === 'brokerAccountId',
    );
    return {
      ok: false,
      message: missingAccount
        ? 'Chọn tài khoản chứng khoán thực hiện lệnh. Chưa có tài khoản nào thì khai ở trang Tài khoản của tôi trước.'
        : 'Kiểm tra lại thông tin giao dịch.',
      fieldErrors: zodErrors(parsed.error),
    };
  }

  /*
   * TÀI KHOẢN PHẢI LÀ CỦA CHÍNH NGƯỜI ĐẶT LỆNH VÀ ĐANG MỞ.
   *
   * Chốt ở server, không dựa vào việc ô chọn chỉ liệt kê tài khoản của họ — id là
   * một trường ẩn, sửa được. Nếu thiếu bước này thì một người ghi được lệnh trừ
   * tiền từ tài khoản của người khác.
   */
  const account = await prisma.brokerAccount.findUnique({
    where: { id: parsed.data.brokerAccountId },
    select: { id: true, userId: true, isActive: true, broker: true, accountNo: true },
  });

  if (!account || account.userId !== actor.id) {
    return {
      ok: false,
      fieldErrors: { brokerAccountId: ['Tài khoản này không phải của bạn.'] },
    };
  }

  if (!account.isActive) {
    return {
      ok: false,
      fieldErrors: { brokerAccountId: ['Tài khoản đã đóng. Mở lại trước khi nhập lệnh qua nó.'] },
    };
  }

  const input = parsed.data;

  try {
    /*
     * Bán quá số đang giữ là lỗi nghiệp vụ nghiêm trọng — chặn ngay tại đây.
     *
     * Đo theo ĐÚNG TÀI KHOẢN của lệnh, không theo người và càng không theo cả danh
     * mục. Hai mức rộng hơn đều đã cho qua những lệnh không nên qua: mức danh mục cho
     * bán 52.000 MBB khi tài khoản chỉ có 10.000; mức người cho bán MBB của tài khoản
     * SSI qua tài khoản VPBankS và làm VPBankS âm.
     *
     * Phần trần theo từng chiến lược ở trên đã chặt hơn, nhưng chốt này vẫn giữ: nó
     * bắt cả trường hợp dữ liệu cũ không có phân bổ chiến lược.
     */
    if (input.transactionType === TRANSACTION_TYPE.SELL) {
      const held = await heldQuantity(
        input.portfolioId,
        input.stockId,
        actor.id,
        input.brokerAccountId,
      );
      if (input.quantity > held) {
        return {
          ok: false,
          fieldErrors: {
            quantity: [
              `Chỉ đang giữ ${held.toLocaleString('vi-VN')} ${stock.symbol}, không thể bán ${input.quantity.toLocaleString('vi-VN')}.`,
            ],
          },
        };
      }
    }

    const { netAmount: net, rows } = buildTradeStrategyRows(input);

    // Vượt ngưỡng giá trị thì bắt buộc qua bước duyệt, dù người nhập không chọn.
    const thresholdSetting = await prisma.systemSetting.findUnique({
      where: { key: 'trading.require_approval_above_vnd' },
    });
    const threshold = BigInt(thresholdSetting?.value ?? '0');
    const mustApprove = threshold > 0n && net >= threshold;

    const canExecuteDirectly = actor.permissions.has('transaction.approve');
    const status: TradeStatus =
      mustApprove || submitForApproval
        ? TRADE_STATUS.PENDING_APPROVAL
        : canExecuteDirectly
          ? TRADE_STATUS.EXECUTED
          : TRADE_STATUS.PENDING_APPROVAL;

    const code = await nextTradeCode();
    const meta = await requestMeta();

    const trade = await prisma.$transaction(async (tx) => {
      const created = await tx.trade.create({
        data: {
          code,
          portfolioId: input.portfolioId,
          stockId: input.stockId,
          transactionType: input.transactionType,
          quantity: input.quantity,
          price: input.price,
          fees: input.fees,
          tax: input.tax,
          executedAt: input.executedAt,
          status,
          userId: input.userId,
          teamId: input.teamId ?? null,
          brokerAccountId: input.brokerAccountId,
          orderId: input.orderId ?? null,
          broker: input.broker ?? null,
          executionNote: input.executionNote ?? null,
          investmentThesis: input.investmentThesis ?? null,
          createdById: actor.id,
        },
      });

      // Ghi cùng transaction: không bao giờ có Trade thiếu phân bổ chiến lược.
      await tx.tradeStrategy.createMany({
        data: rows.map((r) => ({ tradeId: created.id, ...r })),
      });

      if (status === TRADE_STATUS.PENDING_APPROVAL) {
        await tx.approvalRequest.create({
          data: {
            entityType: ENTITY_TYPE.TRADE,
            entityId: created.id,
            action: 'CREATE',
            requestedById: actor.id,
            reason: mustApprove
              ? `Giá trị ${formatVnd(net)} vượt ngưỡng duyệt ${formatVnd(threshold)}.`
              : 'Người nhập chủ động gửi duyệt.',
          },
        });
      }

      await writeAudit({
        tx,
        actor,
        action: AUDIT_ACTION.CREATE,
        entityType: ENTITY_TYPE.TRADE,
        entityId: created.id,
        entityLabel: tradeLabel(input.transactionType, stock.symbol, input.quantity, input.price),
        after: {
          code: created.code,
          symbol: stock.symbol,
          transactionType: input.transactionType,
          quantity: input.quantity,
          price: input.price,
          fees: input.fees,
          tax: input.tax,
          netAmount: net,
          status,
          strategies: rows.map((r) => ({ bps: r.allocationBps, amount: r.allocationAmount })),
        },
        note:
          status === TRADE_STATUS.PENDING_APPROVAL
            ? mustApprove
              ? `Tự động chuyển chờ duyệt: vượt ngưỡng ${formatVnd(threshold)}.`
              : 'Gửi duyệt theo yêu cầu của người nhập.'
            : 'Ghi nhận đã khớp.',
        ...meta,
      });

      return created;
    });

    refresh(trade.id);
    return {
      ok: true,
      tradeId: trade.id,
      message:
        status === TRADE_STATUS.EXECUTED
          ? `Đã ghi nhận ${trade.code} — ${formatVnd(net)}.`
          : `Đã tạo ${trade.code} và gửi duyệt — ${formatVnd(net)}.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Tạo giao dịch thất bại.' };
  }
}

/** Khối lượng đang giữ của một mã trong danh mục (chỉ tính lệnh đã khớp). */
/**
 * Khối lượng đang giữ, thu hẹp dần: cả danh mục → một người → một tài khoản.
 *
 * VÌ SAO PHẢI XUỐNG TỚI TÀI KHOẢN. Cổ phiếu nằm ở một tài khoản chứng khoán cụ thể
 * và lệnh bán đi qua đúng tài khoản đó. Hai mức rộng hơn đều đã cho qua lệnh sai:
 *
 *   cả danh mục  MBB có 52.000, nhưng 42.000 ở tài khoản người khác → một người bán
 *                được 52.000 khi tài khoản họ chỉ có 10.000.
 *   một người    MBB 10.000 nằm ở tài khoản SSI → bán được qua tài khoản VPBankS,
 *                làm VPBankS âm 5.000 MBB. Đã xảy ra thật.
 *
 * Bỏ trống tham số nào thì nới rộng tới mức đó. Mức danh mục vẫn dùng cho chỗ chỉ
 * cần biết tổng, ví dụ kiểm một lệnh cũ có làm vị thế toàn danh mục âm hay không.
 */
async function heldQuantity(
  portfolioId: string,
  stockId: string,
  userId?: string,
  brokerAccountId?: string,
): Promise<number> {
  const trades = await prisma.trade.findMany({
    where: {
      portfolioId,
      stockId,
      status: TRADE_STATUS.EXECUTED,
      ...(userId ? { userId } : {}),
      ...(brokerAccountId ? { brokerAccountId } : {}),
    },
    select: { transactionType: true, quantity: true },
  });
  return trades.reduce(
    (sum, t) => sum + (t.transactionType === TRANSACTION_TYPE.BUY ? t.quantity : -t.quantity),
    0,
  );
}

// ---------------------------------------------------------------------------
// Sửa giao dịch
// ---------------------------------------------------------------------------

/**
 * Sửa khối lượng / giá / phí / thuế.
 *
 * ĐIỂM QUAN TRỌNG: khi số tiền thay đổi, **phân bổ chiến lược phải được tính lại**
 * theo tỷ lệ cũ. Nếu chỉ sửa trade mà để nguyên `allocationAmount` thì
 * Σ allocationAmount ≠ netAmount, và Strategy Allocation ở §16 sẽ sai vĩnh viễn.
 */
export async function updateTradeAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('transaction.update');

  const tradeId = String(formData.get('tradeId') ?? '');
  const expectedVersion = Number(formData.get('version') ?? '0');
  const reason = String(formData.get('reason') ?? '').trim();

  const quantity = Number(String(formData.get('quantity') ?? '').replace(/[.,\s]/g, ''));
  const rawPrice = String(formData.get('price') ?? '').replace(/[.,\s]/g, '');
  const rawFees = String(formData.get('fees') ?? '').replace(/[.,\s]/g, '');
  const rawTax = String(formData.get('tax') ?? '').replace(/[.,\s]/g, '');

  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, fieldErrors: { quantity: ['Khối lượng phải là số nguyên dương.'] } };
  }
  if (!/^\d+$/.test(rawPrice) || rawPrice === '0') {
    return { ok: false, fieldErrors: { price: ['Giá phải là số nguyên dương.'] } };
  }
  if (!reason) {
    return {
      ok: false,
      fieldErrors: { reason: ['Bắt buộc nêu lý do sửa — lý do được ghi vào Audit Log.'] },
    };
  }

  try {
    const before = await prisma.trade.findUniqueOrThrow({
      where: { id: tradeId },
      include: {
        stock: { select: { symbol: true } },
        strategies: { orderBy: { allocationBps: 'desc' } },
      },
    });

    if (before.status === TRADE_STATUS.CANCELLED || before.status === TRADE_STATUS.REJECTED) {
      return { ok: false, message: `Không sửa được giao dịch ở trạng thái ${before.status}.` };
    }

    // Optimistic locking: chống hai người sửa cùng lúc làm mất thay đổi của nhau.
    if (before.version !== expectedVersion) {
      return {
        ok: false,
        message: `Giao dịch đã được người khác sửa (phiên bản ${before.version}, bạn đang xem ${expectedVersion}). Tải lại trang rồi thử lại.`,
      };
    }

    const price = BigInt(rawPrice);
    const fees = /^\d+$/.test(rawFees) ? BigInt(rawFees) : before.fees;
    const tax = /^\d+$/.test(rawTax) ? BigInt(rawTax) : before.tax;

    // Bán quá số đang giữ — loại trừ chính lệnh này khỏi phép tính.
    if (before.transactionType === TRANSACTION_TYPE.SELL && before.status === TRADE_STATUS.EXECUTED) {
      const held = (await heldQuantity(before.portfolioId, before.stockId)) + before.quantity;
      if (quantity > held) {
        return {
          ok: false,
          fieldErrors: {
            quantity: [`Chỉ đang giữ ${held.toLocaleString('vi-VN')} ${before.stock.symbol}.`],
          },
        };
      }
    }

    const newNet = netAmount(
      before.transactionType as 'BUY' | 'SELL',
      quantity,
      price,
      fees,
      tax,
    );

    // Giữ nguyên TỶ LỆ, tính lại SỐ TIỀN — đây là điểm dễ bỏ sót nhất khi sửa lệnh.
    const bpsList = before.strategies.map((s) => s.allocationBps);
    const newAmounts = allocateAmount(newNet, bpsList);

    const meta = await requestMeta();

    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.trade.update({
        where: { id: tradeId, version: expectedVersion },
        data: {
          quantity,
          price,
          fees,
          tax,
          updatedById: actor.id,
          version: { increment: 1 },
        },
      });

      for (let i = 0; i < before.strategies.length; i++) {
        await tx.tradeStrategy.update({
          where: { id: before.strategies[i]!.id },
          data: { allocationAmount: newAmounts[i]! },
        });
      }

      await writeAudit({
        tx,
        actor,
        action: AUDIT_ACTION.UPDATE,
        entityType: ENTITY_TYPE.TRADE,
        entityId: tradeId,
        entityLabel: tradeLabel(
          before.transactionType,
          before.stock.symbol,
          before.quantity,
          before.price,
        ),
        before: {
          quantity: before.quantity,
          price: before.price,
          fees: before.fees,
          tax: before.tax,
          netAmount: netAmount(
            before.transactionType as 'BUY' | 'SELL',
            before.quantity,
            before.price,
            before.fees,
            before.tax,
          ),
          version: before.version,
        },
        after: {
          quantity: updated.quantity,
          price: updated.price,
          fees: updated.fees,
          tax: updated.tax,
          netAmount: newNet,
          version: updated.version,
        },
        note: `Lý do: ${reason}. Phân bổ chiến lược đã được tính lại theo tỷ lệ cũ.`,
        ...meta,
      });

      return updated;
    });

    refresh(tradeId);
    return { ok: true, message: `Đã cập nhật ${after.code} (phiên bản ${after.version}).` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Sửa giao dịch thất bại.' };
  }
}

// ---------------------------------------------------------------------------
// Chuyển trạng thái: duyệt / từ chối / khớp / huỷ
// ---------------------------------------------------------------------------

/**
 * Người có phạm vi SCOPED chỉ được quyết định trên lệnh của NHÓM MÌNH.
 *
 * Chốt ở server chứ không dựa vào việc hàng chờ duyệt đã lọc sẵn: `tradeId` là một
 * trường ẩn trong form, sửa được. Thiếu bước này thì một trưởng nhóm duyệt được
 * lệnh của nhóm khác chỉ bằng cách đổi id.
 *
 * Trả về câu lỗi, hoặc `null` khi hợp lệ.
 */
function ngoaiPhamVi(actor: AuthUser, teamId: string | null): string | null {
  if (dataScope(actor.permissions, 'transaction') === 'ALL') return null;
  if (actor.teamId && teamId === actor.teamId) return null;
  return 'Bạn chỉ được quyết định trên giao dịch của nhóm mình.';
}

async function changeStatus(
  actor: AuthUser,
  tradeId: string,
  to: TradeStatus,
  opts: { comment?: string; auditAction: string },
): Promise<ActionResult> {
  const before = await prisma.trade.findUniqueOrThrow({
    where: { id: tradeId },
    include: { stock: { select: { symbol: true } } },
  });

  assertTransition(before.status as TradeStatus, to);

  const meta = await requestMeta();
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.trade.update({
      where: { id: tradeId },
      data: {
        status: to,
        ...(to === TRADE_STATUS.APPROVED || to === TRADE_STATUS.EXECUTED
          ? { approvedById: actor.id, approvedAt: now }
          : {}),
        ...(to === TRADE_STATUS.CANCELLED ? { cancelledById: actor.id, cancelledAt: now } : {}),
        version: { increment: 1 },
      },
    });

    // Đóng đề nghị duyệt tương ứng, nếu có.
    if (to !== TRADE_STATUS.PENDING_APPROVAL) {
      await tx.approvalRequest.updateMany({
        where: {
          entityType: ENTITY_TYPE.TRADE,
          entityId: tradeId,
          status: APPROVAL_STATUS.PENDING,
        },
        data: {
          status:
            to === TRADE_STATUS.REJECTED
              ? APPROVAL_STATUS.REJECTED
              : to === TRADE_STATUS.CANCELLED
                ? APPROVAL_STATUS.CANCELLED
                : APPROVAL_STATUS.APPROVED,
          decidedById: actor.id,
          decidedAt: now,
          comment: opts.comment ?? null,
        },
      });
    }

    await writeAudit({
      tx,
      actor,
      action: opts.auditAction,
      entityType: ENTITY_TYPE.TRADE,
      entityId: tradeId,
      entityLabel: tradeLabel(
        before.transactionType,
        before.stock.symbol,
        before.quantity,
        before.price,
      ),
      before: { status: before.status },
      after: { status: to },
      note: opts.comment ? `Ý kiến: ${opts.comment}` : null,
      ...meta,
    });
  });

  refresh(tradeId);
  return { ok: true, message: `${before.code}: ${before.status} → ${to}.` };
}

export async function approveTradeAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('transaction.approve');
  const tradeId = String(formData.get('tradeId') ?? '');
  const comment = String(formData.get('comment') ?? '').trim() || undefined;

  try {
    const trade = await prisma.trade.findUniqueOrThrow({
      where: { id: tradeId },
      select: { createdById: true, userId: true, status: true, teamId: true },
    });

    // Không tự duyệt lệnh của chính mình — nguyên tắc bốn mắt của quản lý vốn.
    if (trade.createdById === actor.id || trade.userId === actor.id) {
      return {
        ok: false,
        message: 'Không thể tự duyệt giao dịch do chính bạn nhập. Cần người khác duyệt.',
      };
    }

    const loiPhamVi = ngoaiPhamVi(actor, trade.teamId);
    if (loiPhamVi) return { ok: false, message: loiPhamVi };

    // Duyệt là đồng ý cho lệnh có hiệu lực → đưa thẳng sang EXECUTED.
    return await changeStatus(actor, tradeId, TRADE_STATUS.EXECUTED, {
      comment,
      auditAction: AUDIT_ACTION.APPROVE,
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Duyệt thất bại.' };
  }
}

export async function rejectTradeAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('transaction.approve');
  const tradeId = String(formData.get('tradeId') ?? '');
  const comment = String(formData.get('comment') ?? '').trim();

  const truoc = await prisma.trade.findUnique({
    where: { id: tradeId },
    select: { teamId: true },
  });
  if (truoc) {
    const loi = ngoaiPhamVi(actor, truoc.teamId);
    if (loi) return { ok: false, message: loi };
  }

  if (!comment) {
    return { ok: false, fieldErrors: { comment: ['Bắt buộc nêu lý do từ chối.'] } };
  }

  try {
    return await changeStatus(actor, tradeId, TRADE_STATUS.REJECTED, {
      comment,
      auditAction: AUDIT_ACTION.REJECT,
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Từ chối thất bại.' };
  }
}

export async function submitTradeAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('transaction.create');
  const tradeId = String(formData.get('tradeId') ?? '');

  try {
    const trade = await prisma.trade.findUniqueOrThrow({
      where: { id: tradeId },
      select: { id: true, status: true, createdById: true },
    });

    if (trade.createdById !== actor.id && !actor.permissions.has('transaction.update')) {
      return { ok: false, message: 'Chỉ người nhập mới gửi duyệt được lệnh này.' };
    }

    const result = await changeStatus(actor, tradeId, TRADE_STATUS.PENDING_APPROVAL, {
      auditAction: AUDIT_ACTION.UPDATE,
    });

    await prisma.approvalRequest.create({
      data: {
        entityType: ENTITY_TYPE.TRADE,
        entityId: tradeId,
        action: 'CREATE',
        requestedById: actor.id,
        reason: 'Gửi duyệt từ trạng thái nháp.',
      },
    });

    refresh(tradeId);
    return result;
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Gửi duyệt thất bại.' };
  }
}

/**
 * Huỷ giao dịch.
 *
 * KHÔNG xoá bản ghi. Huỷ một lệnh đã khớp làm thay đổi vị thế và P&L, nên bắt buộc
 * có lý do và có quyền riêng — nhưng dấu vết vẫn còn nguyên trong `trades` và
 * Audit Log.
 */
export async function cancelTradeAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('transaction.cancel');
  const tradeId = String(formData.get('tradeId') ?? '');
  const comment = String(formData.get('comment') ?? '').trim();

  if (!comment) {
    return { ok: false, fieldErrors: { comment: ['Bắt buộc nêu lý do huỷ.'] } };
  }

  try {
    const trade = await prisma.trade.findUniqueOrThrow({
      where: { id: tradeId },
      select: { status: true, transactionType: true, quantity: true, stockId: true, portfolioId: true },
    });

    // Huỷ một lệnh MUA đã khớp có thể làm vị thế âm nếu đã bán bớt.
    if (trade.status === TRADE_STATUS.EXECUTED && trade.transactionType === TRANSACTION_TYPE.BUY) {
      const held = await heldQuantity(trade.portfolioId, trade.stockId);
      if (held - trade.quantity < 0) {
        return {
          ok: false,
          message: `Không huỷ được: sau khi huỷ, vị thế sẽ âm ${(held - trade.quantity).toLocaleString('vi-VN')}. Huỷ các lệnh bán liên quan trước.`,
        };
      }
    }

    return await changeStatus(actor, tradeId, TRADE_STATUS.CANCELLED, {
      comment,
      auditAction: AUDIT_ACTION.CANCEL,
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Huỷ thất bại.' };
  }
}
