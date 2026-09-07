'use server';

/**
 * TÀI KHOẢN CHỨNG KHOÁN CỦA THÀNH VIÊN — thêm tài khoản, nạp và rút vốn.
 *
 * QUYỀN: CHỈ CHÍNH CHỦ. Không dựa vào mã quyền nào, mà dựa vào danh tính —
 * `account.userId === actor.id`. Người quản trị cũng KHÔNG sửa được tài khoản của
 * người khác qua đường này. Đây là lựa chọn có chủ đích của người dùng, và hệ quả
 * cần biết: không có ai soát lại số vốn một thành viên tự khai. Nhật ký kiểm toán
 * là chốt duy nhất, nên mọi thao tác ở đây đều ghi audit.
 *
 * KHÔNG CÓ BƯỚC DUYỆT. Nạp tiền là ghi nhận một việc ĐÃ xảy ra — tiền đã vào tài
 * khoản ở sàn — giống cách một dòng `trades` ghi lại một lần khớp đã xảy ra. Bảng
 * `capital_flows` có sẵn `status`/`approvedById`/`approvedAt` cho luồng hai mắt;
 * chúng để trống ở đây, và bật lên là một thay đổi nhỏ nếu sau này cần.
 *
 * TIỀN NẠP LÀ MỘT DÒNG `capital_flows`, KHÔNG PHẢI MỘT CỘT.
 *
 * Đây là quyết định quan trọng nhất của file này. Mỗi lần nạp tạo một dòng
 * `CONTRIBUTION` trỏ về tài khoản qua `brokerAccountId`. Hệ quả:
 *
 *   - Số dư tiền và Available Cash trên Dashboard TĂNG theo mỗi lần nạp. Đúng như
 *     vậy: tiền vừa vào danh mục thật.
 *   - Tiền của NHÓM cũng tự đúng, vì dòng vốn được gắn `teamId` của người nạp tại
 *     thời điểm nạp (xem chú thích trong `recordFlow`).
 *   - Không có bảng thứ hai nào ghi lại cùng số tiền đó, nên không có gì để lệch.
 *
 * Nếu thay vào đó `broker_accounts` có cột `depositedAmount`, thì "tổng đã nạp" tồn
 * tại ở hai nơi và hai nơi đó sẽ lệch nhau — chỉ là vấn đề thời gian.
 *
 * VÌ SAO CÓ CẢ RÚT VỐN khi người dùng chỉ yêu cầu phần nạp: không có đường rút thì
 * một lần gõ sai số sẽ vĩnh viễn thổi phồng tiền của danh mục, và cách sửa duy nhất
 * là vào database. Rút vốn là bút toán đối ứng đúng nghĩa, không phải xoá dữ liệu.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { requestMeta, requirePermission, requireUser } from '@/auth/guards';
import type { Prisma } from '@prisma/client';
import { brokerAccountSchema, depositSchema, openingStateSchema } from '@/domain/validation';
import { computeAccountBalances } from '@/domain/portfolio-engine';
import { kiemDongTaiKhoan, lyDoChuaDong } from '@/accounts/close-rules';
import { dataScope } from '@/domain/permissions';
import type { AuthUser } from '@/auth/guards';
import { BPS_TOTAL, formatVnd, grossAmount } from '@/lib/money';
import {
  AUDIT_ACTION,
  BROKER,
  BROKER_LABEL_VI,
  CAPITAL_FLOW_STATUS,
  CAPITAL_FLOW_TYPE,
  ENTITY_TYPE,
  PORTFOLIO_STATUS,
  TRADE_STATUS,
  TRANSACTION_TYPE,
  type Broker,
} from '@/lib/enums';

export interface ActionResult {
  ok: boolean;
  message?: string;
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

/**
 * Làm mới mọi trang có con số bị thay đổi.
 *
 * Nạp vốn đổi tiền của danh mục, nên KHÔNG chỉ trang cá nhân: Dashboard đọc
 * `computeCash`, Portfolio đọc phân bổ, Teams đọc vốn theo nhóm, Reports đọc dòng
 * vốn. Thiếu một trang ở đây thì trang đó hiện số cũ mà không có gì báo.
 */
function refresh(userId: string): void {
  revalidatePath(`/members/${userId}`);
  revalidatePath('/members/[id]', 'page');
  revalidatePath('/dashboard');
  revalidatePath('/portfolio');
  revalidatePath('/portfolio/allocation');
  revalidatePath('/teams');
  revalidatePath('/reports');
  revalidatePath('/audit');
}

function brokerLabel(broker: string, other: string | null): string {
  return broker === BROKER.OTHER
    ? (other ?? 'Khác')
    : (BROKER_LABEL_VI[broker as Broker] ?? broker);
}

/** Nhãn dùng trong nhật ký kiểm toán: đủ để đọc lại sau khi bản ghi bị đổi. */
function accountLabel(broker: string, other: string | null, accountNo: string): string {
  return `${brokerLabel(broker, other)} · ${accountNo}`;
}

// ---------------------------------------------------------------------------
// Tài khoản
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Khai số dư đầu kỳ cho tài khoản đã có sẵn vị thế
// ---------------------------------------------------------------------------

/**
 * Đọc các dòng vị thế đầu kỳ từ `FormData`.
 *
 * Tên trường dạng `opening_<i>_symbol|qty|price|at|strategyId`, cùng lối đặt tên với
 * `alloc_<id>` ở form nhập lệnh. Trả về `null` khi người dùng không khai gì — khai số
 * dư đầu kỳ là TUỲ CHỌN, tài khoản mở mới hoàn toàn thì không có gì để khai.
 *
 * CHIẾN LƯỢC ĐỌC THEO TỪNG DÒNG. `openingStrategyId` chỉ còn là giá trị dự phòng cho
 * dòng không gửi lên chiến lược nào — form luôn gửi, nhưng một form cũ đang mở trong
 * tab khác lúc triển khai bản mới thì không, và mất chiến lược của cả tài khoản vì
 * chuyện đó thì không đáng.
 */
function readOpening(formData: FormData): unknown | null {
  const count = Number(formData.get('openingCount') ?? 0);
  if (!Number.isFinite(count) || count <= 0) return null;

  const duPhong = String(formData.get('openingStrategyId') ?? '');

  const positions = [];
  for (let i = 0; i < count; i += 1) {
    const symbol = String(formData.get(`opening_${i}_symbol`) ?? '').trim();
    // Dòng trống là dòng người dùng thêm ra rồi bỏ đó — bỏ qua, không báo lỗi.
    if (!symbol) continue;
    positions.push({
      symbol,
      quantity: formData.get(`opening_${i}_qty`),
      costPrice: formData.get(`opening_${i}_price`),
      purchasedAt: formData.get(`opening_${i}_at`),
      strategyId: String(formData.get(`opening_${i}_strategyId`) ?? '') || duPhong,
    });
  }

  if (positions.length === 0) return null;

  return {
    cashRemaining: formData.get('openingCash') ?? '0',
    positions,
  };
}

/**
 * Ghi trạng thái đầu kỳ: các vị thế có sẵn + tiền mặt còn lại.
 *
 * VỊ THẾ CÓ SẴN ĐƯỢC GHI THÀNH LỆNH MUA, không phải một bảng "vị thế ban đầu" riêng.
 * Đó là cách duy nhất để chúng chảy vào mọi con số của hệ thống: vị thế, giá vốn bình
 * quân, lãi/lỗ, tỷ trọng ngành, phân bổ chiến lược, hiệu suất theo phiên. Một bảng
 * riêng sẽ phải được cộng thêm ở từng chỗ, và chỗ nào quên cộng thì im lặng sai.
 *
 * VỐN GHI NHẬN = Σ giá vốn + tiền mặt còn. Xem chú thích `openingStateSchema` để biết
 * vì sao không phải chỉ mỗi phần tiền mặt.
 *
 * KHÔNG QUA BƯỚC DUYỆT và ghi thẳng `EXECUTED`: đây là những lệnh đã khớp từ trước khi
 * hệ thống tồn tại. Bắt chúng chờ duyệt là bắt duyệt lại quá khứ.
 *
 * TẤT CẢ TRONG MỘT TRANSACTION cùng với việc tạo tài khoản. Nửa chừng thất bại sẽ để
 * lại một tài khoản có vị thế mà không có vốn — số dư âm, và không ai biết vì sao.
 */
async function writeOpeningState(
  tx: Prisma.TransactionClient,
  actor: AuthUser,
  accountId: string,
  input: {
    cashRemaining: bigint;
    positions: {
      symbol: string;
      quantity: number;
      costPrice: bigint;
      purchasedAt: Date;
      strategyId: string;
    }[];
  },
  portfolioId: string,
  startSeq: number,
  year: number,
): Promise<{ tradeCodes: string[]; granted: bigint }> {
  const symbols = [...new Set(input.positions.map((p) => p.symbol))];

  const stocks = await tx.stock.findMany({
    where: { symbol: { in: symbols } },
    select: { id: true, symbol: true },
  });
  const stockBySymbol = new Map(stocks.map((s) => [s.symbol, s.id]));

  const missing = symbols.filter((s) => !stockBySymbol.has(s));
  if (missing.length > 0) {
    /*
     * §23: mã chứng khoán phải có trong master data. Không tự tạo mã mới ở đây — một
     * mã gõ sai sẽ thành một "công ty" mới không có ngành, không có giá, và nó sẽ nằm
     * lại trong mọi báo cáo.
     */
    throw new Error(
      `Không có mã ${missing.join(', ')} trong danh mục mã chứng khoán của hệ thống.`,
    );
  }

  /*
   * Kiểm MỌI chiến lược được dùng, trong MỘT truy vấn.
   *
   * Kiểm từng dòng bên trong vòng lặp ghi lệnh cũng đúng, nhưng nó ghi xong vài lệnh
   * rồi mới ném lỗi ở dòng thứ tư. Transaction sẽ cuộn lại nên dữ liệu vẫn sạch — chỉ
   * là người dùng nhận một thông báo về "chiến lược không hợp lệ" mà không biết dòng
   * nào, nên kiểm hết trước rồi nêu đúng tên chiến lược sai.
   */
  const strategyIds = [...new Set(input.positions.map((p) => p.strategyId))];

  const strategies = await tx.strategy.findMany({
    where: { id: { in: strategyIds } },
    select: { id: true, isActive: true, nameVi: true },
  });

  const dungDuoc = new Set(strategies.filter((x) => x.isActive).map((x) => x.id));
  const sai = strategyIds.filter((id) => !dungDuoc.has(id));

  if (sai.length > 0) {
    const maSai = input.positions
      .filter((p) => sai.includes(p.strategyId))
      .map((p) => p.symbol);
    throw new Error(
      `Chiến lược không hợp lệ cho mã ${[...new Set(maSai)].join(', ')}.`,
    );
  }

  let granted = input.cashRemaining;
  const tradeCodes: string[] = [];
  let seq = startSeq;

  for (const pos of input.positions) {
    const cost = grossAmount(pos.quantity, pos.costPrice);
    granted += cost;

    seq += 1;
    const code = `TXN-${year}-${String(seq).padStart(6, '0')}`;
    tradeCodes.push(code);

    const trade = await tx.trade.create({
      data: {
        code,
        portfolioId,
        stockId: stockBySymbol.get(pos.symbol)!,
        transactionType: TRANSACTION_TYPE.BUY,
        quantity: pos.quantity,
        price: pos.costPrice,
        /*
         * Phí và thuế bằng 0 vì người khai chỉ biết GIÁ VỐN — con số đã gồm phí rồi.
         * Cộng thêm một khoản phí ước lượng sẽ làm giá vốn cao hơn thực tế và lãi/lỗ
         * thấp hơn thực tế.
         */
        fees: 0n,
        tax: 0n,
        executedAt: pos.purchasedAt,
        status: TRADE_STATUS.EXECUTED,
        userId: actor.id,
        teamId: actor.teamId ?? null,
        brokerAccountId: accountId,
        executionNote: 'Vị thế có sẵn, khai khi đưa tài khoản vào hệ thống',
        createdById: actor.id,
        approvedById: actor.id,
        approvedAt: new Date(),
      },
    });

    /*
     * 100% cho chiến lược CỦA CHÍNH DÒNG ĐÓ. Mỗi mã một chiến lược riêng — mã nào vào
     * vì luận điểm nào thì lãi/lỗ theo chiến lược mới đúng ngay từ đầu.
     */
    await tx.tradeStrategy.create({
      data: {
        tradeId: trade.id,
        strategyId: pos.strategyId,
        allocationBps: BPS_TOTAL,
        allocationAmount: cost,
      },
    });
  }

  await tx.capitalFlow.create({
    data: {
      portfolioId,
      brokerAccountId: accountId,
      teamId: actor.teamId ?? null,
      flowType: CAPITAL_FLOW_TYPE.CONTRIBUTION,
      amount: granted,
      occurredAt: input.positions.reduce(
        (earliest, p) => (p.purchasedAt < earliest ? p.purchasedAt : earliest),
        input.positions[0]!.purchasedAt,
      ),
      note: 'Vốn đầu kỳ: giá vốn các vị thế có sẵn + tiền mặt còn lại',
      status: 'CONFIRMED',
      createdById: actor.id,
    },
  });

  return { tradeCodes, granted };
}

/**
 * IB được chọn có thật và đang bật không.
 *
 * VÌ SAO PHẢI KIỂM Ở ĐÂY. Ô chọn trên giao diện chỉ liệt kê IB đang bật, nhưng form
 * gửi tay được: `ibId` là một chuỗi trong `FormData`, không phải một lời hứa. Không
 * kiểm thì một `ibId` bịa sẽ bị Prisma từ chối bằng lỗi khoá ngoại — người dùng nhận
 * một câu tiếng Anh khó hiểu thay vì "IB không còn trong danh mục".
 *
 * IB ĐÃ TẮT CŨNG BỊ TỪ CHỐI. Tắt một IB nghĩa là "không khai mới theo IB này nữa";
 * tài khoản đã gắn thì vẫn giữ nguyên (xem chú thích `isActive` trong schema).
 *
 * Trả về `null` khi hợp lệ, hoặc `ActionResult` lỗi để gọi thẳng `return`.
 */
async function kiemIb(ibId: string | undefined): Promise<ActionResult | null> {
  if (!ibId) return null;

  const ib = await prisma.introducingBroker.findUnique({
    where: { id: ibId },
    select: { isActive: true },
  });

  if (!ib) {
    return { ok: false, fieldErrors: { ibId: ['IB không còn trong danh mục. Chọn lại.'] } };
  }
  if (!ib.isActive) {
    return { ok: false, fieldErrors: { ibId: ['IB này đã ngừng dùng. Chọn IB khác.'] } };
  }
  return null;
}

export async function createBrokerAccountAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();

  const parsed = brokerAccountSchema.safeParse({
    broker: formData.get('broker'),
    brokerOther: String(formData.get('brokerOther') ?? '') || undefined,
    accountNo: formData.get('accountNo'),
    ibId: String(formData.get('ibId') ?? '') || undefined,
    note: String(formData.get('note') ?? '') || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: 'Kiểm tra lại thông tin tài khoản.',
      fieldErrors: zodErrors(parsed.error),
    };
  }

  const input = parsed.data;

  const ibHong = await kiemIb(input.ibId);
  if (ibHong) return ibHong;

  /*
   * Kiểm trùng TRƯỚC khi ghi để trả về câu tiếng Việt, thay vì để ràng buộc unique
   * ném ra lỗi Prisma. Vẫn có ràng buộc ở database làm chốt cuối — hai người bấm
   * cùng lúc thì chỉ một người qua.
   */
  const existing = await prisma.brokerAccount.findUnique({
    where: { broker_accountNo: { broker: input.broker, accountNo: input.accountNo } },
    select: { userId: true },
  });

  if (existing) {
    return {
      ok: false,
      fieldErrors: {
        accountNo: [
          existing.userId === actor.id
            ? 'Bạn đã khai tài khoản này rồi.'
            : 'Số tài khoản này đã được người khác khai. Vốn nạp vào nó sẽ bị đếm hai lần nếu khai trùng.',
        ],
      },
    };
  }

  /*
   * SỐ DƯ ĐẦU KỲ — tuỳ chọn. Tài khoản mở mới hoàn toàn thì không có gì để khai.
   */
  const rawOpening = readOpening(formData);
  let opening: ReturnType<typeof openingStateSchema.parse> | null = null;

  if (rawOpening !== null) {
    const parsedOpening = openingStateSchema.safeParse(rawOpening);
    if (!parsedOpening.success) {
      return {
        ok: false,
        message: 'Kiểm tra lại phần vị thế có sẵn.',
        fieldErrors: zodErrors(parsedOpening.error),
      };
    }
    opening = parsedOpening.data;
  }

  let portfolioId: string | null = null;
  if (opening) {
    const portfolio = await prisma.portfolio.findFirst({
      where: { status: PORTFOLIO_STATUS.ACTIVE },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!portfolio) return { ok: false, message: 'Chưa có danh mục nào đang hoạt động.' };
    portfolioId = portfolio.id;
  }

  /*
   * Số thứ tự mã lệnh tính TRƯỚC transaction rồi tự tăng trong vòng lặp.
   *
   * `nextTradeCode()` của module trading đọc mã lớn nhất mỗi lần gọi; gọi nó N lần
   * trong một transaction sẽ trả về CÙNG một mã N lần, vì những dòng vừa ghi chưa
   * commit nên chính nó không thấy.
   */
  const year = new Date().getFullYear();
  let startSeq = 0;
  if (opening) {
    const prefix = `TXN-${year}-`;
    const last = await prisma.trade.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    startSeq = last ? Number(last.code.slice(prefix.length)) : 0;
  }

  const meta = await requestMeta();

  let created;
  let openingResult: { tradeCodes: string[]; granted: bigint } | null = null;

  try {
    /*
     * MỘT TRANSACTION cho cả tài khoản, các lệnh, và dòng vốn. Nửa chừng thất bại sẽ
     * để lại một tài khoản có vị thế mà không có vốn — số dư âm và không ai biết vì sao.
     */
    const result = await prisma.$transaction(async (tx) => {
      const acc = await tx.brokerAccount.create({
        data: {
          userId: actor.id,
          broker: input.broker,
          brokerOther: input.broker === BROKER.OTHER ? (input.brokerOther ?? null) : null,
          accountNo: input.accountNo,
          ibId: input.ibId ?? null,
          note: input.note ?? null,
        },
      });

      const op =
        opening && portfolioId
          ? await writeOpeningState(tx, actor, acc.id, opening, portfolioId, startSeq, year)
          : null;

      return { acc, op };
    });

    created = result.acc;
    openingResult = result.op;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Không lưu được tài khoản.',
    };
  }

  await writeAudit({
    actor,
    action: AUDIT_ACTION.CREATE,
    entityType: ENTITY_TYPE.BROKER_ACCOUNT,
    entityId: created.id,
    entityLabel: accountLabel(created.broker, created.brokerOther, created.accountNo),
    after: created,
    note: openingResult
      ? `Khai số dư đầu kỳ: ${openingResult.tradeCodes.length} vị thế, vốn ghi nhận ${openingResult.granted}`
      : undefined,
    ...meta,
  });

  refresh(actor.id);

  const label = accountLabel(created.broker, created.brokerOther, created.accountNo);
  return {
    ok: true,
    message: openingResult
      ? `Đã thêm ${label} kèm ${openingResult.tradeCodes.length} vị thế có sẵn. Vốn ghi nhận: giá vốn các vị thế + tiền mặt còn lại.`
      : `Đã thêm tài khoản ${label}.`,
  };
}

export async function updateBrokerAccountAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const id = String(formData.get('id') ?? '');

  const before = await prisma.brokerAccount.findUnique({ where: { id } });
  if (!before) return { ok: false, message: 'Không tìm thấy tài khoản.' };
  if (before.userId !== actor.id) {
    return { ok: false, message: 'Chỉ chủ tài khoản được sửa tài khoản này.' };
  }

  const parsed = brokerAccountSchema.safeParse({
    broker: formData.get('broker'),
    brokerOther: String(formData.get('brokerOther') ?? '') || undefined,
    accountNo: formData.get('accountNo'),
    ibId: String(formData.get('ibId') ?? '') || undefined,
    note: String(formData.get('note') ?? '') || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: 'Kiểm tra lại thông tin tài khoản.',
      fieldErrors: zodErrors(parsed.error),
    };
  }

  const input = parsed.data;

  const ibHong = await kiemIb(input.ibId);
  if (ibHong) return ibHong;

  if (input.broker !== before.broker || input.accountNo !== before.accountNo) {
    const clash = await prisma.brokerAccount.findUnique({
      where: { broker_accountNo: { broker: input.broker, accountNo: input.accountNo } },
      select: { id: true },
    });
    if (clash && clash.id !== id) {
      return { ok: false, fieldErrors: { accountNo: ['Số tài khoản này đã được khai.'] } };
    }
  }

  const meta = await requestMeta();

  const after = await prisma.brokerAccount.update({
    where: { id },
    data: {
      broker: input.broker,
      brokerOther: input.broker === BROKER.OTHER ? (input.brokerOther ?? null) : null,
      accountNo: input.accountNo,
      ibId: input.ibId ?? null,
      note: input.note ?? null,
    },
  });

  await writeAudit({
    actor,
    action: AUDIT_ACTION.UPDATE,
    entityType: ENTITY_TYPE.BROKER_ACCOUNT,
    entityId: id,
    entityLabel: accountLabel(after.broker, after.brokerOther, after.accountNo),
    before,
    after,
    ...meta,
  });

  refresh(actor.id);
  return { ok: true, message: 'Đã cập nhật tài khoản.' };
}

/**
 * Đóng / mở lại tài khoản. KHÔNG xoá.
 *
 * Xoá tài khoản sẽ làm mồ côi những dòng `capital_flows` trỏ về nó (khoá ngoại
 * `SET NULL`), và lúc đó tiền vẫn nằm trong danh mục nhưng không còn biết nó ở đâu.
 * Đóng tài khoản giữ nguyên toàn bộ lịch sử.
 *
 * ĐÓNG CÓ ĐIỀU KIỆN, MỞ LẠI THÌ KHÔNG. Xem `kiemDongTaiKhoan` để biết ba điều kiện và
 * vì sao. Mở lại không cần điều kiện gì: nó chỉ đưa tài khoản về trạng thái dùng được,
 * không chốt sổ thứ gì.
 */
export async function toggleBrokerAccountAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const id = String(formData.get('id') ?? '');

  const before = await prisma.brokerAccount.findUnique({ where: { id } });
  if (!before) return { ok: false, message: 'Không tìm thấy tài khoản.' };
  if (before.userId !== actor.id) {
    return { ok: false, message: 'Chỉ chủ tài khoản được đổi trạng thái tài khoản này.' };
  }

  /*
   * Chỉ kiểm khi ĐANG ĐÓNG. Mở lại một tài khoản còn tiền là chuyện bình thường — đó
   * chính là cách sửa một tài khoản bị đóng nhầm.
   */
  if (before.isActive) {
    const portfolio = await prisma.portfolio.findFirst({
      where: { status: PORTFOLIO_STATUS.ACTIVE },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (portfolio) {
      const ly = await kiemDongTaiKhoan(portfolio.id, actor.id, id);
      const loi = lyDoChuaDong(ly);
      if (loi) return { ok: false, message: loi };
    }
  }

  const meta = await requestMeta();
  const after = await prisma.brokerAccount.update({
    where: { id },
    data: { isActive: !before.isActive },
  });

  await writeAudit({
    actor,
    action: AUDIT_ACTION.UPDATE,
    entityType: ENTITY_TYPE.BROKER_ACCOUNT,
    entityId: id,
    entityLabel: accountLabel(after.broker, after.brokerOther, after.accountNo),
    before,
    after,
    note: after.isActive ? 'Mở lại tài khoản' : 'Đóng tài khoản',
    ...meta,
  });

  refresh(actor.id);
  return { ok: true, message: after.isActive ? 'Đã mở lại tài khoản.' : 'Đã đóng tài khoản.' };
}

// ---------------------------------------------------------------------------
// Nạp / rút vốn
// ---------------------------------------------------------------------------

/**
 * Rút bấy nhiêu có vượt tiền còn lại không. Trả câu tiếng Việt, hoặc `null` nếu được.
 *
 * HAI CON SỐ DỄ LẪN. Trần là TIỀN CÒN LẠI, không phải vốn ròng đã nạp:
 *
 *     vốn ròng đã nạp = Σ nạp − Σ rút
 *     tiền còn lại    = vốn ròng − Σ chi mua + Σ thu bán
 *
 * Lấy con số đầu làm trần thì một tài khoản nạp 100 triệu, mua hết 100 triệu cổ phiếu
 * vẫn "rút được" 100 triệu — trong khi tiền còn lại bằng 0.
 *
 * TRỪ CẢ CÁC YÊU CẦU ĐANG CHỜ DUYỆT. Nếu không, hai yêu cầu 200 triệu trên một tài
 * khoản còn 300 triệu đều qua được lúc gửi, rồi cả hai được duyệt và số dư âm 100
 * triệu. Chốt lúc duyệt cũng gọi lại hàm này (loại trừ chính yêu cầu đang xét), nên
 * yêu cầu thứ hai bị chặn ở đúng thời điểm nó thành tiền thật.
 */
async function kiemTranRut(
  portfolioId: string,
  userId: string,
  accountId: string,
  amount: bigint,
  boQuaFlowId?: string,
): Promise<string | null> {
  const soDu = (await computeAccountBalances(portfolioId, userId)).find(
    (b) => b.accountId === accountId,
  );
  const conLai = soDu?.available ?? 0n;

  const dangCho = await prisma.capitalFlow.findMany({
    where: {
      brokerAccountId: accountId,
      flowType: CAPITAL_FLOW_TYPE.WITHDRAWAL,
      status: CAPITAL_FLOW_STATUS.PENDING,
      ...(boQuaFlowId ? { id: { not: boQuaFlowId } } : {}),
    },
    select: { amount: true },
  });

  const treo = dangCho.reduce((t, f) => t + f.amount, 0n);
  const rutDuoc = conLai - treo;

  if (rutDuoc <= 0n) {
    return (
      `Tài khoản không còn tiền để rút (còn ${formatVnd(conLai)}` +
      (treo > 0n ? `, đang chờ duyệt ${formatVnd(treo)}` : '') +
      ').' +
      (conLai < 0n ? ' Số dư đang âm vì vốn nạp chưa khai đủ.' : '')
    );
  }

  if (amount > rutDuoc) {
    return (
      `Chỉ rút được ${formatVnd(rutDuoc)}, không rút được ${formatVnd(amount)}` +
      (treo > 0n ? ` (còn ${formatVnd(conLai)}, đang chờ duyệt ${formatVnd(treo)})` : '') +
      '.'
    );
  }

  return null;
}

async function recordFlow(
  formData: FormData,
  kind: 'DEPOSIT' | 'WITHDRAW',
): Promise<ActionResult> {
  const actor = await requireUser();

  const parsed = depositSchema.safeParse({
    brokerAccountId: formData.get('brokerAccountId'),
    amount: formData.get('amount'),
    occurredAt: formData.get('occurredAt'),
    note: String(formData.get('note') ?? '') || undefined,
  });

  if (!parsed.success) {
    return { ok: false, message: 'Kiểm tra lại số tiền và ngày.', fieldErrors: zodErrors(parsed.error) };
  }

  const input = parsed.data;

  const account = await prisma.brokerAccount.findUnique({
    where: { id: input.brokerAccountId },
    select: { id: true, userId: true, broker: true, brokerOther: true, accountNo: true, isActive: true },
  });

  if (!account) return { ok: false, message: 'Không tìm thấy tài khoản.' };
  if (account.userId !== actor.id) {
    return { ok: false, message: 'Chỉ chủ tài khoản được ghi nhận vốn cho tài khoản này.' };
  }
  if (!account.isActive) {
    return { ok: false, message: 'Tài khoản đã đóng. Mở lại trước khi ghi nhận vốn.' };
  }

  const portfolio = await prisma.portfolio.findFirst({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!portfolio) return { ok: false, message: 'Chưa có danh mục nào đang hoạt động.' };

  /*
   * KHÔNG RÚT QUÁ SỐ TIỀN CÒN LẠI.
   *
   * Đây là chốt CHẶN, không phải cảnh báo — khác hẳn với chốt thiếu tiền khi MUA. Hai
   * việc khác nhau về bản chất:
   *
   *   lệnh MUA   ghi lại một lần khớp ĐÃ xảy ra ở sàn. Chặn ghi vì con số của hệ
   *              thống nói không đủ nghĩa là không ghi được một việc có thật — tiền có
   *              thể thiếu chỉ vì vốn nạp chưa khai, hoặc vì lệnh dùng ký quỹ.
   *   RÚT VỐN    người dùng đang khai một con số, ngay lúc này, và con số đó không có
   *              thật: tài khoản chứng khoán không rút ra được nhiều hơn số dư. Cho qua
   *              thì số dư âm, và số dư âm lan vào tiền của cả danh mục.
   *
   * Đo bằng `computeAccountBalances` — CÙNG hàm mà form hiển thị "Tiền còn ở tài khoản",
   * nên con số trong thông báo lỗi đúng bằng con số người dùng đang nhìn thấy.
   */
  if (kind === 'WITHDRAW') {
    const loi = await kiemTranRut(portfolio.id, actor.id, account.id, input.amount);
    if (loi) return { ok: false, fieldErrors: { amount: [loi] } };
  }

  const meta = await requestMeta();

  const created = await prisma.capitalFlow.create({
    data: {
      portfolioId: portfolio.id,
      brokerAccountId: account.id,
      /*
       * GẮN NHÓM TẠI THỜI ĐIỂM NẠP, không suy ra lúc đọc.
       *
       * Nhờ vậy tiền của nhóm tự đúng mà `computeCash` không phải join qua
       * `broker_accounts → users → teams`. Và khi người này chuyển nhóm sau đó,
       * khoản vốn cũ vẫn thuộc nhóm cũ — cùng nguyên tắc với `trades.teamId`:
       * lịch sử không đổi theo hiện tại.
       */
      teamId: actor.teamId ?? null,
      flowType:
        kind === 'DEPOSIT' ? CAPITAL_FLOW_TYPE.CONTRIBUTION : CAPITAL_FLOW_TYPE.WITHDRAWAL,
      amount: input.amount,
      occurredAt: input.occurredAt,
      note: input.note ?? null,
      /*
       * NẠP GHI THẲNG, RÚT PHẢI CHỜ DUYỆT.
       *
       * Nạp vốn làm TĂNG tiền: khai sai thì thấy ngay ở số dư và sửa được, không ai
       * mất gì. Rút vốn làm tiền RA KHỎI hệ thống, nên cần cấp quản lý nhóm trở lên
       * chấp nhận — cùng nguyên tắc bốn mắt với duyệt lệnh (§8).
       *
       * `PENDING` không đụng tới mọi con số: `computeAccountBalances`, `computeCash`
       * và các engine khác đều lọc `status: CONFIRMED`. Nhờ vậy một yêu cầu rút đang
       * chờ không làm số dư giảm trước khi có ai đồng ý.
       */
      status:
        kind === 'DEPOSIT' ? CAPITAL_FLOW_STATUS.CONFIRMED : CAPITAL_FLOW_STATUS.PENDING,
      createdById: actor.id,
    },
  });

  await writeAudit({
    actor,
    action: AUDIT_ACTION.CREATE,
    entityType: ENTITY_TYPE.CAPITAL_FLOW,
    entityId: created.id,
    entityLabel: accountLabel(account.broker, account.brokerOther, account.accountNo),
    after: created,
    note: kind === 'DEPOSIT' ? 'Nạp vốn vào tài khoản' : 'Rút vốn khỏi tài khoản',
    ...meta,
  });

  refresh(actor.id);
  return {
    ok: true,
    message:
      kind === 'DEPOSIT'
        ? 'Đã ghi nhận nạp vốn.'
        : 'Đã gửi yêu cầu rút vốn. Chờ cấp quản lý nhóm trở lên chấp nhận — số dư chưa đổi.',
  };
}

export async function depositCapitalAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  return recordFlow(formData, 'DEPOSIT');
}

export async function withdrawCapitalAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  return recordFlow(formData, 'WITHDRAW');
}

// ---------------------------------------------------------------------------
// Duyệt yêu cầu rút vốn
// ---------------------------------------------------------------------------

/**
 * Người này có được quyết định trên yêu cầu của nhóm đó không.
 *
 * Quản lý cấp cao và admin có `capital.view_all` → quyết được mọi nhóm. Quản lý nhóm
 * chỉ quyết trong nhóm mình, cùng cách `ngoaiPhamVi` chặn ở duyệt lệnh.
 */
function ngoaiPhamVi(actor: AuthUser, teamId: string | null): string | null {
  if (dataScope(actor.permissions, 'capital') === 'ALL') return null;
  if (actor.teamId && teamId === actor.teamId) return null;
  return 'Bạn chỉ được quyết định trên yêu cầu rút vốn của nhóm mình.';
}

/** Đọc và kiểm một yêu cầu rút vốn đang chờ. */
async function layYeuCauCho(flowId: string) {
  return prisma.capitalFlow.findUnique({
    where: { id: flowId },
    select: {
      id: true,
      portfolioId: true,
      brokerAccountId: true,
      teamId: true,
      flowType: true,
      status: true,
      amount: true,
      createdById: true,
      brokerAccount: {
        select: { id: true, userId: true, broker: true, brokerOther: true, accountNo: true },
      },
    },
  });
}

async function quyetDinhRut(
  formData: FormData,
  quyet: 'APPROVE' | 'REJECT',
): Promise<ActionResult> {
  const actor = await requirePermission('capital.approve');
  const flowId = String(formData.get('flowId') ?? '');
  const comment = String(formData.get('comment') ?? '').trim() || undefined;

  const flow = await layYeuCauCho(flowId);
  if (!flow) return { ok: false, message: 'Không tìm thấy yêu cầu rút vốn.' };

  if (flow.flowType !== CAPITAL_FLOW_TYPE.WITHDRAWAL) {
    return { ok: false, message: 'Dòng vốn này không phải yêu cầu rút.' };
  }
  if (flow.status !== CAPITAL_FLOW_STATUS.PENDING) {
    return {
      ok: false,
      message:
        flow.status === CAPITAL_FLOW_STATUS.CONFIRMED
          ? 'Yêu cầu này đã được chấp nhận trước đó.'
          : 'Yêu cầu này đã bị từ chối trước đó.',
    };
  }

  /*
   * BỐN MẮT (§8): không ai tự duyệt yêu cầu rút của chính mình.
   *
   * Chặn cả người GỬI yêu cầu và CHỦ tài khoản — hai người này có thể khác nhau, và
   * cả hai đều là người hưởng lợi từ khoản tiền ra. Trưởng nhóm muốn rút vốn của mình
   * thì cần một người khác có quyền duyệt: quản lý cấp cao, admin, hoặc trưởng nhóm
   * khác trong phạm vi.
   */
  if (flow.createdById === actor.id || flow.brokerAccount?.userId === actor.id) {
    return {
      ok: false,
      message: 'Không thể tự quyết định yêu cầu rút vốn của chính bạn. Cần người khác duyệt.',
    };
  }

  const loiPhamVi = ngoaiPhamVi(actor, flow.teamId);
  if (loiPhamVi) return { ok: false, message: loiPhamVi };

  if (quyet === 'APPROVE') {
    /*
     * KIỂM LẠI TRẦN Ở ĐÚNG THỜI ĐIỂM DUYỆT.
     *
     * Giữa lúc gửi yêu cầu và lúc duyệt, tiền trong tài khoản có thể đã đi mua cổ
     * phiếu. Tin vào phép kiểm lúc gửi là cho phép một yêu cầu hợp lệ hôm qua thành
     * số dư âm hôm nay. Loại trừ chính yêu cầu đang xét để nó không tự chặn mình.
     */
    if (flow.brokerAccountId && flow.brokerAccount) {
      const loi = await kiemTranRut(
        flow.portfolioId,
        flow.brokerAccount.userId,
        flow.brokerAccountId,
        flow.amount,
        flow.id,
      );
      if (loi) {
        return {
          ok: false,
          message: `Không duyệt được: ${loi} Số dư đã đổi từ lúc gửi yêu cầu.`,
        };
      }
    }
  }

  const meta = await requestMeta();

  const sau = await prisma.capitalFlow.update({
    where: { id: flow.id },
    data: {
      status:
        quyet === 'APPROVE' ? CAPITAL_FLOW_STATUS.CONFIRMED : CAPITAL_FLOW_STATUS.CANCELLED,
      approvedById: actor.id,
      approvedAt: new Date(),
    },
  });

  await writeAudit({
    actor,
    action: quyet === 'APPROVE' ? AUDIT_ACTION.APPROVE : AUDIT_ACTION.REJECT,
    entityType: ENTITY_TYPE.CAPITAL_FLOW,
    entityId: flow.id,
    entityLabel: flow.brokerAccount
      ? accountLabel(
          flow.brokerAccount.broker,
          flow.brokerAccount.brokerOther,
          flow.brokerAccount.accountNo,
        )
      : 'Rút vốn',
    before: flow,
    after: sau,
    /*
     * Ghi chú của người duyệt gộp vào `note` — `AuditInput` không có trường riêng cho
     * nó, và nhật ký cần biết vì sao chứ không chỉ biết ai.
     */
    note:
      (quyet === 'APPROVE' ? 'Chấp nhận yêu cầu rút vốn' : 'Từ chối yêu cầu rút vốn') +
      (comment ? ` — ${comment}` : ''),
    ...meta,
  });

  if (flow.brokerAccount) refresh(flow.brokerAccount.userId);
  revalidatePath('/approvals');

  return {
    ok: true,
    message:
      quyet === 'APPROVE'
        ? `Đã chấp nhận rút ${formatVnd(flow.amount)}.`
        : 'Đã từ chối yêu cầu rút vốn.',
  };
}

export async function approveWithdrawalAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  return quyetDinhRut(formData, 'APPROVE');
}

export async function rejectWithdrawalAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  return quyetDinhRut(formData, 'REJECT');
}
