'use server';

/**
 * GHI NHẬN CỔ TỨC TRÊN MỘT VỊ THẾ ĐANG GIỮ.
 *
 * Một đợt chia có thể trả TIỀN, trả CỔ PHIẾU, hoặc cả hai cùng lúc — nên hai phần đó
 * được ghi trong CÙNG MỘT transaction. Ghi rời rạc thì một nửa thành công là để lại
 * một đợt cổ tức có tiền mà không có cổ phiếu (hoặc ngược lại), và không ai biết nửa
 * còn lại đã mất ở đâu.
 *
 * HAI PHẦN ĐI VÀO HAI BẢNG KHÁC NHAU, vì chúng là hai loại sự kiện khác nhau:
 *
 *   TIỀN MẶT   → `capital_flows` (flowType = DIVIDEND, dấu +1, KHÔNG tính vào vốn góp)
 *                cộng `stockId` để tra ngược được mã nào đã trả.
 *   CỔ PHIẾU   → `trades` — một dòng MUA GIÁ 0, cờ `isStockDividend`.
 *
 * VÌ SAO CỔ PHIẾU LÀ "MUA GIÁ 0" chứ không phải một loại giao dịch mới: xem chú thích
 * của `trades.isStockDividend` trong schema. Tóm tắt: 14 chỗ trong mã nguồn viết
 * `transactionType === BUY ? … : …` với nhánh còn lại ngầm hiểu là bán, nên một loại
 * thứ ba sẽ âm thầm trừ khối lượng. Mua giá 0 thì mọi phép tính sẵn có đều đúng —
 * khối lượng tăng, giá vốn cộng 0, tiền không đổi, giá vốn TB giảm đúng tỷ lệ.
 *
 * KHÔNG ĐI QUA `tradeSchema`: schema đó bắt `price > 0`, đúng cho một lệnh thật. Dòng
 * cổ tức được kiểm bằng bộ quy tắc riêng ngay dưới đây.
 */

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { requirePermission, requestMeta } from '@/auth/guards';
import { dividendSchema, zodErrors } from '@/domain/validation';
import { computeStrategyHoldings } from '@/domain/portfolio-engine';
import { allocateAmount, bpsFromWeights, formatVnd } from '@/lib/money';
import {
  AUDIT_ACTION,
  ENTITY_TYPE,
  CAPITAL_FLOW_TYPE,
  CAPITAL_FLOW_STATUS,
  TRANSACTION_TYPE,
  TRADE_STATUS,
} from '@/lib/enums';

export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

function lamMoi(): void {
  revalidatePath('/portfolio/positions');
  revalidatePath('/portfolio');
  revalidatePath('/transactions');
  revalidatePath('/dashboard');
  revalidatePath('/profile');
}

/** Mã lệnh cho dòng cổ tức cổ phiếu — cùng khuôn với mã lệnh thường. */
async function maTiepTheo(): Promise<string> {
  const nam = new Date().getFullYear();
  const dem = await prisma.trade.count();
  return `CT${nam}${String(dem + 1).padStart(5, '0')}`;
}

export async function recordDividendAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('transaction.create');

  const parsed = dividendSchema.safeParse({
    portfolioId: formData.get('portfolioId'),
    brokerAccountId: formData.get('brokerAccountId'),
    stockId: formData.get('stockId'),
    occurredAt: formData.get('occurredAt'),
    eligibleQuantity: String(formData.get('eligibleQuantity') ?? ''),
    cashPerShare: String(formData.get('cashPerShare') ?? '') || undefined,
    shareQuantity: String(formData.get('shareQuantity') ?? '') || undefined,
    note: String(formData.get('note') ?? '') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: 'Kiểm tra lại thông tin.', fieldErrors: zodErrors(parsed.error) };
  }

  const input = parsed.data;

  const account = await prisma.brokerAccount.findUnique({
    where: { id: input.brokerAccountId },
    select: { id: true, userId: true, isActive: true, accountNo: true, broker: true },
  });
  if (!account) return { ok: false, message: 'Không tìm thấy tài khoản.' };
  if (account.userId !== actor.id) {
    return { ok: false, message: 'Chỉ chủ tài khoản được ghi cổ tức cho tài khoản này.' };
  }
  if (!account.isActive) {
    return { ok: false, message: 'Tài khoản đã đóng.' };
  }

  /*
   * PHẢI ĐANG GIỮ MÃ ĐÓ Ở CHÍNH TÀI KHOẢN NÀY.
   *
   * Cổ tức trả theo số cổ phiếu đang nắm tại ngày chốt, và cổ phiếu nằm ở một tài
   * khoản cụ thể. Không kiểm thì ghi được cổ tức cho một mã tài khoản không hề có —
   * đúng lớp lỗi mà chốt "bán theo tài khoản" đã phải sửa.
   */
  const dangGiu = await computeStrategyHoldings(input.portfolioId, actor.id, account.id);
  const viThe = dangGiu.find((h) => h.stockId === input.stockId && h.quantity > 0) ?? null;

  /*
   * MÃ ĐÃ BÁN HẾT VẪN GHI ĐƯỢC CỔ TỨC.
   *
   * Bán sạch sau ngày chốt quyền thì tiền cổ tức vẫn về, nhưng `computeStrategyHoldings`
   * đã bỏ mã đó khỏi danh sách (nó lọc `tong <= 0`). Chặn ở đây là ép người dùng mất
   * một khoản tiền có thật trên sổ.
   *
   * ĐIỀU KIỆN VẪN CÒN, chỉ nới từ "đang giữ" thành "từng giữ Ở CHÍNH TÀI KHOẢN NÀY".
   * Bỏ hẳn điều kiện thì ghi được cổ tức cho một mã tài khoản chưa từng mua — một
   * khoản tiền từ hư không, và nó vào thẳng số dư.
   */
  const tungGiu = viThe
    ? null
    : await prisma.trade.findFirst({
        where: {
          brokerAccountId: account.id,
          stockId: input.stockId,
          userId: actor.id,
          status: TRADE_STATUS.EXECUTED,
        },
        select: { stock: { select: { symbol: true } } },
      });

  if (!viThe && !tungGiu) {
    return {
      ok: false,
      fieldErrors: {
        stockId: ['Tài khoản này chưa từng giữ mã đó, nên không có cơ sở để nhận cổ tức.'],
      },
    };
  }

  const maCK = viThe?.symbol ?? tungGiu!.stock.symbol;
  const soDangGiu = viThe?.quantity ?? 0;

  /*
   * TIỀN TÍNH TRÊN SỐ ĐƯỢC HƯỞNG, KHÔNG PHẢI SỐ ĐANG GIỮ.
   *
   * Không đặt trần bằng số đang giữ: vượt trần là chuyện bình thường khi đã bán sau
   * ngày chốt. Form cảnh báo khi vượt; ở đây chỉ ghi lại cả hai con số vào nhật ký để
   * sau này đối chiếu được.
   */
  const soCoPhieu = BigInt(input.eligibleQuantity);
  const tienMat = input.cashPerShare !== undefined ? input.cashPerShare * soCoPhieu : 0n;
  const themCP = input.shareQuantity ?? 0;

  if (tienMat === 0n && themCP === 0) {
    return {
      ok: false,
      fieldErrors: {
        cashPerShare: ['Điền ít nhất một trong hai: cổ tức tiền mặt hoặc số cổ phiếu nhận thêm.'],
      },
    };
  }

  /*
   * TỶ TRỌNG ĐỂ CHIA CỔ PHIẾU THƯỞNG.
   *
   * Còn giữ  → chia theo đúng tỷ trọng các chiến lược đang nắm.
   * Đã bán hết → không còn tỷ trọng nào để đọc, nên lấy tỷ trọng của chính những lệnh
   *              MUA mã đó trong tài khoản này. Đó là câu trả lời gần nhất cho "cổ
   *              phiếu này vào vì luận điểm nào", và nó vẫn là dữ liệu thật của người
   *              dùng chứ không phải một chiến lược mặc định do hệ thống chọn hộ.
   */
  let trongSoCL: { strategyId: string; quantity: number }[] =
    viThe?.byStrategy.map((x) => ({ strategyId: x.strategyId, quantity: x.quantity })) ?? [];

  if (themCP > 0 && trongSoCL.length === 0) {
    const lenhMua = await prisma.trade.findMany({
      where: {
        brokerAccountId: account.id,
        stockId: input.stockId,
        userId: actor.id,
        status: TRADE_STATUS.EXECUTED,
        transactionType: TRANSACTION_TYPE.BUY,
      },
      select: { quantity: true, strategies: { select: { strategyId: true, allocationBps: true } } },
    });

    const gop = new Map<string, number>();
    for (const t of lenhMua) {
      if (t.strategies.length === 0) continue;
      const phan = allocateAmount(
        BigInt(t.quantity),
        t.strategies.map((x) => x.allocationBps),
      );
      t.strategies.forEach((x, i) => {
        gop.set(x.strategyId, (gop.get(x.strategyId) ?? 0) + Number(phan[i] ?? 0n));
      });
    }

    trongSoCL = [...gop.entries()]
      .filter(([, q]) => q > 0)
      .map(([strategyId, quantity]) => ({ strategyId, quantity }))
      .sort((a, b) => b.quantity - a.quantity);
  }

  /*
   * KHÔNG GHI MỘT LỆNH KHÔNG CÓ CHIẾN LƯỢC NÀO.
   *
   * Xảy ra với lệnh cũ có trước khi `tradeSchema` bắt buộc phân bổ. Tạo lệnh cổ phiếu
   * thưởng rỗng chiến lược sẽ làm phần "vốn theo chiến lược" thiếu đúng số cổ phiếu
   * vừa nhận — thiếu âm thầm, vì bảng vị thế tổng vẫn đúng. Thà từ chối và nói rõ.
   */
  if (themCP > 0 && trongSoCL.length === 0) {
    return {
      ok: false,
      fieldErrors: {
        shareQuantity: [
          `Không có lệnh nào của ${maCK} trong tài khoản này khai chiến lược, nên không biết ` +
            'chia cổ phiếu thưởng vào đâu. Ghi phần cổ tức tiền mặt trước, phần cổ phiếu cần sửa dữ liệu lệnh cũ.',
        ],
      },
    };
  }

  const meta = await requestMeta();

  const ketQua = await prisma.$transaction(async (tx) => {
    let flowId: string | null = null;
    let tradeId: string | null = null;

    if (tienMat > 0n) {
      const f = await tx.capitalFlow.create({
        data: {
          portfolioId: input.portfolioId,
          brokerAccountId: account.id,
          stockId: input.stockId,
          flowType: CAPITAL_FLOW_TYPE.DIVIDEND,
          status: CAPITAL_FLOW_STATUS.CONFIRMED,
          amount: tienMat,
          occurredAt: input.occurredAt,
          createdById: actor.id,
          /*
           * `teamId` để trống: cổ tức về danh mục chứ không về nhóm nào — cùng quy
           * ước đã ghi trong chú thích cột `capital_flows.teamId`.
           */
          note: input.note ?? `Cổ tức tiền mặt ${maCK}`,
        },
        select: { id: true },
      });
      flowId = f.id;
    }

    if (themCP > 0) {
      const t = await tx.trade.create({
        data: {
          code: await maTiepTheo(),
          portfolioId: input.portfolioId,
          stockId: input.stockId,
          brokerAccountId: account.id,
          userId: actor.id,
          createdById: actor.id,
          transactionType: TRANSACTION_TYPE.BUY,
          status: TRADE_STATUS.EXECUTED,
          isStockDividend: true,
          quantity: themCP,
          price: 0n,
          fees: 0n,
          tax: 0n,
          executedAt: input.occurredAt,
          teamId: actor.teamId ?? null,
          executionNote: input.note ?? `Cổ tức bằng cổ phiếu ${maCK}`,
        },
        select: { id: true },
      });
      tradeId = t.id;

      /*
       * CHIA SỐ CỔ PHIẾU THƯỞNG THEO ĐÚNG TỶ TRỌNG ĐANG GIỮ của từng chiến lược.
       *
       * Cổ phiếu thưởng rơi vào các chiến lược theo đúng tỷ lệ chúng đang nắm — không
       * có chiến lược nào "mua thêm". Dùng `bpsFromWeights` + `allocateAmount` như mọi
       * chỗ chia khác để tổng luôn khớp tuyệt đối, không rơi cổ phiếu nào.
       *
       * Thiếu bước này thì dòng cổ tức không có `trade_strategies`, và phần "vốn theo
       * chiến lược" sẽ thiếu đúng số cổ phiếu vừa nhận.
       */
      const trongSo = trongSoCL.map((x) => BigInt(x.quantity));
      const bps = bpsFromWeights(trongSo);
      /*
       * BẢNG `trade_strategies` KHÔNG LƯU KHỐI LƯỢNG — khối lượng của mỗi chiến lược
       * được suy lại từ `allocationBps` bằng đúng `allocateAmount` (xem
       * `computeStrategyHoldings`). Nên ở đây chỉ cần ghi bps.
       *
       * Vẫn gọi `allocateAmount` một lần để KIỂM rằng bộ bps vừa dựng chia hết số cổ
       * phiếu thưởng. Nếu sau này thuật toán chia đổi, chỗ này hỏng ngay và ồn ào,
       * thay vì để khối lượng suy ra lệch âm thầm so với số đã ghi.
       */
      const chia = allocateAmount(BigInt(themCP), bps);
      if (chia.reduce((s, v) => s + v, 0n) !== BigInt(themCP)) {
        throw new Error('Chia cổ phiếu thưởng theo chiến lược không khớp tổng');
      }

      await tx.tradeStrategy.createMany({
        data: trongSoCL.map((x, i) => ({
          tradeId: t.id,
          strategyId: x.strategyId,
          allocationBps: bps[i] ?? 0,
          // Cổ phiếu thưởng không tốn tiền, nên phần vốn phân bổ là 0.
          allocationAmount: 0n,
        })),
      });
    }

    return { flowId, tradeId };
  });

  await writeAudit({
    actor,
    action: AUDIT_ACTION.CREATE,
    entityType: ENTITY_TYPE.CAPITAL_FLOW,
    entityId: ketQua.flowId ?? ketQua.tradeId ?? '',
    entityLabel: `Cổ tức ${maCK}`,
    after: {
      symbol: maCK,
      accountNo: account.accountNo,
      /*
       * GHI CẢ HAI CON SỐ. Số được hưởng là căn cứ tính tiền; số đang giữ là bối cảnh
       * lúc ghi. Chỉ lưu một con số thì sau này không ai kiểm lại được vì sao khoản
       * tiền đó lớn hơn vị thế.
       */
      soCoPhieuDuocHuong: input.eligibleQuantity,
      soCoPhieuDangGiu: soDangGiu,
      tienMat: tienMat.toString(),
      coPhieuNhanThem: themCP,
    },
    ...meta,
  });

  lamMoi();

  const phan = [
    tienMat > 0n ? `${formatVnd(tienMat)} tiền mặt` : null,
    themCP > 0 ? `${themCP.toLocaleString('vi-VN')} cổ phiếu` : null,
  ].filter(Boolean);

  return {
    ok: true,
    message: `Đã ghi cổ tức ${maCK} trên ${input.eligibleQuantity.toLocaleString('vi-VN')} CP: ${phan.join(' và ')}.`,
  };
}
