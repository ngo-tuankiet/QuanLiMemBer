/**
 * Schema kiểm tra dữ liệu đầu vào (zod).
 *
 * Ràng buộc quan trọng nhất của cả hệ thống nằm ở đây:
 *
 *     Σ allocationBps của một Trade  =  10000 bps  (100%)
 *
 * Không có cơ sở dữ liệu quan hệ nào cưỡng chế được ràng buộc "tổng các dòng con
 * bằng một hằng số" bằng CHECK constraint. Vì vậy nó được bảo vệ ở hai lớp:
 *
 *   Lớp 1 — file này: chặn dữ liệu sai ngay tại biên vào (form, API).
 *   Lớp 2 — createTradeData(): ghi Trade và TradeStrategy trong cùng một
 *           transaction, số tiền phân bổ do allocateAmount() tính, nên
 *           Σ allocationAmount = netAmount tuyệt đối.
 *
 * Ngoài ra `verifyTradeStrategyIntegrity()` (scripts/verify-model.ts) quét lại
 * toàn bộ DB để phát hiện bất kỳ dòng nào lọt qua — dùng như một health check.
 */

import { z } from 'zod';
import {
  BROKER,
  BROKER_OPTIONS,
  TRANSACTION_TYPE,
  TRADE_STATUS,
  USER_STATUS,
  CAPITAL_FLOW_TYPE,
  ROLE,
  type RoleCode,
  tickSize,
  type Exchange,
} from '@/lib/enums';
import { BPS_TOTAL, allocateAmount, netAmount } from '@/lib/money';

// ---------------------------------------------------------------------------
// Kiểu cơ bản
// ---------------------------------------------------------------------------

/** Tiền VNĐ: nhận number/string/bigint từ form rồi chuẩn hoá về bigint không âm. */
export const vndAmount = z
  .union([z.bigint(), z.number().int(), z.string().regex(/^\d+$/)])
  .transform((v) => BigInt(v))
  .refine((v) => v >= 0n, 'Số tiền không được âm');

/** Tỷ lệ theo basis point: 0..10000. */
export const bps = z.number().int().min(0).max(BPS_TOTAL);

const cuid = z.string().min(1, 'Thiếu định danh');

// ---------------------------------------------------------------------------
// Đăng ký & người dùng (§4)
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  email: z.string().email('Email không hợp lệ').toLowerCase().trim(),
  password: z
    .string()
    .min(10, 'Mật khẩu tối thiểu 10 ký tự')
    .regex(/[A-Z]/, 'Mật khẩu phải có chữ in hoa')
    .regex(/[a-z]/, 'Mật khẩu phải có chữ thường')
    .regex(/[0-9]/, 'Mật khẩu phải có số'),
  fullName: z.string().min(2, 'Họ tên quá ngắn').max(120).trim(),
  phone: z
    .string()
    .regex(/^0\d{9}$/, 'Số điện thoại phải gồm 10 số và bắt đầu bằng 0')
    .optional(),
});

/**
 * MỌI mã vai trò, suy thẳng từ `ROLE`.
 *
 * Trước đây danh sách này được gõ tay. TypeScript không bắt được thiếu sót vì đây
 * là một mảng chạy lúc runtime, nên thêm một vai trò mới sẽ lặng lẽ không gán được:
 * ô chọn có nó (đọc từ database) nhưng zod từ chối.
 */
const ROLE_CODES = Object.values(ROLE) as [RoleCode, ...RoleCode[]];

/**
 * Bước Admin duyệt tài khoản (§4).
 * Cố tình KHÔNG có trường strategyId — Strategy thuộc Trade, không thuộc User.
 */
/**
 * Gom lỗi zod theo tên trường để form hiện đúng chỗ.
 *
 * Trước đây mỗi file action tự viết một bản. Đặt ở đây vì nó đi liền với schema —
 * đổi cách đặt tên trường trong schema thì chỗ gom lỗi phải đổi theo.
 */
export function zodErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * MÃ ĐỊNH DANH của phòng ban và nhóm.
 *
 * CHỮ HOA, SỐ VÀ GẠCH DƯỚI — vì `db:seed` dùng chính chuỗi này làm khoá `upsert`
 * (xem `TEAM_SEED` / `DEPARTMENT_SEED` trong `master-data.ts`). Cho phép khoảng
 * trắng hay dấu tiếng Việt ở đây sẽ làm khoá khó gõ lại đúng, và một lần gõ lệch là
 * một bản ghi trùng lặp thay vì một lần cập nhật.
 */
const orgCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Mã phải có ít nhất 2 ký tự')
  .max(30, 'Mã tối đa 30 ký tự')
  .regex(/^[A-Z0-9_]+$/, 'Mã chỉ gồm chữ HOA không dấu, số và gạch dưới');

const orgName = z.string().trim().min(2, 'Tên phải có ít nhất 2 ký tự').max(120, 'Tên quá dài');

/** Một phòng ban. `parentId` để trống = phòng ban gốc. */
export const departmentSchema = z.object({
  code: orgCode,
  name: orgName,
  nameVi: orgName,
  parentId: cuid.optional(),
  sortOrder: z.coerce.number().int().min(0, 'Thứ tự không âm').max(999).default(0),
});

/** Một nhóm. Luôn thuộc đúng một phòng ban; `leaderId` để trống = chưa có trưởng nhóm. */
export const teamSchema = z.object({
  code: orgCode,
  name: orgName,
  nameVi: orgName,
  description: z.string().trim().max(500, 'Mô tả tối đa 500 ký tự').optional(),
  departmentId: cuid,
  leaderId: cuid.optional(),
});

/**
 * Một IB trong danh mục do quản trị khai.
 *
 * `code` dùng chung bộ quy tắc với mã phòng ban/nhóm: chữ HOA không dấu, số và gạch
 * dưới. Nó xuất hiện trong ô chọn ngay trước tên nên phải ngắn và đọc lướt được.
 */
/**
 * Một ô tỷ lệ trong biểu phí của IB: người dùng gõ PHẦN TRĂM, database lưu BPS.
 *
 * VÌ SAO ĐỔI ĐƠN VỊ Ở ĐÂY. Người vận hành đọc biểu phí của sàn bằng phần trăm
 * ("0,15%"), còn hệ thống tính tiền bằng bps để không bao giờ phải nhân số thực
 * (§23). Đổi ở lớp kiểm dữ liệu thì cả form lẫn action đều khỏi tự quy đổi — hai
 * chỗ tự quy đổi là hai chỗ có thể làm tròn khác nhau.
 *
 * RỖNG = "chưa khai riêng, theo mức chung", KHÁC với 0 = "miễn phí". Nên chuỗi rỗng
 * trả về `undefined` chứ không phải 0.
 */
const tyLePhanTram = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v.replace(',', '.')))
  .refine((v) => v === undefined || /^\d+(\.\d{1,2})?$/.test(v), {
    message: 'Nhập theo phần trăm, tối đa 2 số lẻ. Ví dụ 0.15',
  })
  .transform((v) => (v === undefined ? undefined : Math.round(Number(v) * 100)))
  .refine((v) => v === undefined || (v >= 0 && v <= 1000), {
    message: 'Tỷ lệ phải từ 0% đến 10%',
  });

export const introducingBrokerSchema = z.object({
  code: orgCode,
  name: orgName,
  note: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự').optional(),
  sortOrder: z.coerce.number().int().min(0, 'Thứ tự không âm').max(999).default(0),
  buyFeeRateBps: tyLePhanTram,
  sellFeeRateBps: tyLePhanTram,
  sellTaxRateBps: tyLePhanTram,
});

export const approveUserSchema = z.object({
  userId: cuid,
  roleCode: z.enum(ROLE_CODES),
  departmentId: cuid,
  teamId: cuid.optional(),
  employeeCode: z.string().max(30).optional(),
});

export const rejectUserSchema = z.object({
  userId: cuid,
  reason: z.string().min(3, 'Cần nêu lý do từ chối').max(500),
});

export const updateUserStatusSchema = z.object({
  userId: cuid,
  status: z.enum([USER_STATUS.ACTIVE, USER_STATUS.SUSPENDED]),
  reason: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

/*
 * ĐÃ BỎ: `stockSchema`.
 *
 * Nó chỉ phục vụ ba action thêm / sửa / đổi trạng thái mã chứng khoán, và cả ba
 * đã bị bỏ cùng với trang quản lý mã. Mã chứng khoán bây giờ chỉ vào hệ thống
 * qua `STOCK_SEED` (src/data/master-data.ts), nơi dữ liệu đã ở dạng đúng nên
 * không cần lớp kiểm tra đầu vào của người dùng.
 *
 * §23 "Stock phải có master data" KHÔNG bị ảnh hưởng: form nhập lệnh vẫn chọn mã
 * từ bảng `stocks`, chỉ khác là bảng đó không sửa được qua giao diện nữa.
 */

export const strategySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z_]{3,40}$/, 'Mã chiến lược chỉ gồm chữ in hoa và dấu gạch dưới'),
  name: z.string().min(2).max(100).trim(),
  nameVi: z.string().min(2).max(100).trim(),
  description: z.string().max(1000).optional(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Màu phải ở dạng #RRGGBB').optional(),

  /**
   * Thứ tự hiển thị, và cũng là SLOT MÀU dự phòng.
   *
   * `seriesColor(sortOrder - 1)` là màu dùng khi `colorHex` để trống. Vì vậy đổi thứ tự
   * của một chiến lược cũng đổi màu của nó trên mọi biểu đồ — điều người sửa cần biết,
   * nên nó là một trường nhập được chứ không phải một con số ẩn.
   */
  sortOrder: z.coerce.number().int().min(0, 'Thứ tự không âm').max(999).default(0),

  /**
   * Hạn mức tỷ trọng tối đa, đơn vị basis point (4000 = 40%).
   *
   * Form nhập bằng PHẦN TRĂM vì người dùng nghĩ bằng phần trăm; phép đổi nằm ở action,
   * ngay tại biên nhập liệu, để nó chỉ xuất hiện đúng một chỗ.
   */
  maxAllocationBps: bps.optional(),
});

// ---------------------------------------------------------------------------
// Vốn (§14)
// ---------------------------------------------------------------------------

export const capitalFlowSchema = z.object({
  portfolioId: cuid,
  flowType: z.enum([
    CAPITAL_FLOW_TYPE.CONTRIBUTION,
    CAPITAL_FLOW_TYPE.WITHDRAWAL,
    CAPITAL_FLOW_TYPE.DIVIDEND,
    CAPITAL_FLOW_TYPE.INTEREST,
    CAPITAL_FLOW_TYPE.OTHER_INCOME,
    CAPITAL_FLOW_TYPE.OTHER_EXPENSE,
  ]),
  amount: vndAmount.refine((v) => v > 0n, 'Số tiền phải lớn hơn 0'),
  occurredAt: z.coerce.date(),
  /**
   * Nhóm được cấp riêng phần vốn này. Bỏ trống = quỹ chung.
   *
   * Không bắt buộc và sẽ không bắt buộc: cổ tức và lãi tiền gửi về danh mục chứ
   * không về nhóm nào.
   */
  teamId: cuid.optional(),
  reference: z.string().max(100).optional(),
  note: z.string().max(1000).optional(),
});

// ---------------------------------------------------------------------------
// Tài khoản chứng khoán của thành viên
// ---------------------------------------------------------------------------

/**
 * `broker` kiểm bằng `refine` thay vì `z.enum`.
 *
 * `z.enum` cần một tuple, còn `BROKER_OPTIONS` là mảng readonly — chuyển kiểu qua
 * lại để vừa `z.enum` sẽ làm mất luôn chỗ dựa của TypeScript. Cách này giữ danh
 * sách sàn ở đúng một nơi (`enums.ts`) và vẫn báo lỗi rõ ràng.
 */
export const brokerAccountSchema = z
  .object({
    broker: z
      .string()
      .refine((v) => (BROKER_OPTIONS as readonly string[]).includes(v), 'Sàn không hợp lệ'),
    brokerOther: z.string().trim().min(2).max(60).optional(),
    /*
     * Số tài khoản giữ NGUYÊN định dạng sàn cấp, chỉ chuẩn hoá phần hoa/thường.
     * Mỗi sàn một kiểu (số thuần, có chữ đầu, có dấu chấm), nên không ép một khuôn.
     */
    accountNo: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9.-]{4,32}$/, 'Số tài khoản chỉ gồm chữ, số, dấu chấm và gạch ngang (4–32 ký tự)'),
    /*
     * IB CHỌN TỪ DANH MỤC, KHÔNG TỰ GÕ.
     *
     * Ở đây chỉ kiểm được "có phải một định danh không". Việc IB đó CÓ THẬT và ĐANG
     * BẬT thì zod không biết — phải hỏi database, nên chốt đó nằm trong action. Bỏ
     * trống là hợp lệ và có nghĩa: mở trực tiếp, không qua IB.
     */
    ibId: cuid.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.broker !== BROKER.OTHER || Boolean(d.brokerOther), {
    message: 'Chọn “Khác” thì phải điền tên sàn',
    path: ['brokerOther'],
  });

export type BrokerAccountInput = z.infer<typeof brokerAccountSchema>;

/**
 * MỘT VỊ THẾ CÓ SẴN khi đưa tài khoản vào hệ thống.
 *
 * GIÁ VỐN LÀ BẮT BUỘC dù người dùng không nhắc tới nó. Không có giá vốn thì không có
 * lãi/lỗ: `unrealizedPnl = giá trị thị trường − giá vốn`, và toàn bộ engine đứng trên
 * phép trừ đó. Lấy giá hiện tại làm giá vốn sẽ cho mọi vị thế cũ lãi/lỗ đúng bằng 0 —
 * một con số trông bình thường nhưng sai, đúng loại lỗi tệ nhất.
 *
 * CHIẾN LƯỢC THEO TỪNG MÃ, không theo cả lô. Bản đầu chỉ có một `strategyId` áp cho
 * mọi dòng, với lý do "vị thế cũ thường không nhớ mua theo phương pháp nào". Lý do đó
 * đúng với MỘT lô mua cùng lúc, nhưng một tài khoản đang dùng thì mỗi mã vào vì một
 * luận điểm khác nhau — gán chung một chiến lược cho cả tài khoản làm mọi con số
 * lãi/lỗ theo chiến lược sai ngay từ ngày đầu, và §23 không lưu sẵn gì để sửa lại sau
 * ngoài việc mở từng lệnh ra chỉnh.
 *
 * Vẫn giữ ergonomics cũ ở tầng form: một ô chọn đặt nhanh cho mọi dòng, rồi sửa dòng
 * nào cần. Ở tầng dữ liệu thì mỗi dòng mang chiến lược của chính nó.
 */
export const openingPositionSchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,10}$/, 'Mã chứng khoán gồm 3–10 chữ/số'),
  quantity: z.coerce.number().int().positive('Khối lượng phải lớn hơn 0'),
  costPrice: vndAmount.refine((v) => v > 0n, 'Giá vốn phải lớn hơn 0'),
  purchasedAt: z.coerce.date(),
  strategyId: cuid,
});

/**
 * TOÀN BỘ TRẠNG THÁI ĐẦU KỲ của một tài khoản mới đưa vào hệ thống.
 *
 * `cashRemaining` là tiền mặt CÒN LẠI trong tài khoản, không phải tổng vốn đã đưa vào.
 * Vốn đưa vào được suy ra:
 *
 *   vốn đã đưa vào = Σ (khối lượng × giá vốn) + tiền mặt còn
 *
 * Phải như vậy vì các vị thế có sẵn được ghi thành lệnh MUA, và lệnh mua trừ tiền của
 * tài khoản. Nếu chỉ ghi nhận đúng phần tiền mặt còn thì số dư tài khoản sẽ âm đúng
 * bằng giá vốn của những vị thế đó.
 *
 * CHIẾN LƯỢC NẰM TRONG TỪNG DÒNG, không nằm ở mức lô — xem `openingPositionSchema`.
 *
 * Mỗi dòng một chiến lược. §6 cho phép một lệnh chia cho nhiều chiến lược, nhưng ô
 * nhập ở đây giữ một chiến lược mỗi mã: người khai vị thế cũ đang nhớ lại quá khứ,
 * bắt họ chia tỷ lệ cho một lần mua từ hai năm trước chỉ ra những con số bịa. Chia
 * nhiều chiến lược làm được sau, ở form sửa lệnh.
 */
export const openingStateSchema = z.object({
  cashRemaining: vndAmount.refine((v) => v >= 0n, 'Tiền mặt không được âm'),
  positions: z.array(openingPositionSchema).min(1).max(50),
});

export type OpeningPositionInput = z.infer<typeof openingPositionSchema>;

/** Một lần nạp hoặc rút vốn cho một tài khoản. Chiều tiền do action quyết định. */
export const depositSchema = z.object({
  brokerAccountId: cuid,
  amount: vndAmount.refine((v) => v > 0n, 'Số tiền phải lớn hơn 0'),
  occurredAt: z.coerce.date(),
  note: z.string().trim().max(500).optional(),
});

// ---------------------------------------------------------------------------
// GIAO DỊCH ĐA CHIẾN LƯỢC (§6) — phần cốt lõi
// ---------------------------------------------------------------------------

export const strategyAllocationSchema = z.object({
  strategyId: cuid,
  allocationBps: bps.refine((v) => v > 0, 'Tỷ lệ phân bổ phải lớn hơn 0'),
  note: z.string().max(500).optional(),
});

export type StrategyAllocationInput = z.infer<typeof strategyAllocationSchema>;

/**
 * MỘT ĐỢT CHIA CỔ TỨC trên một vị thế đang giữ.
 *
 * Hai phần đều KHÔNG BẮT BUỘC, nhưng phải có ít nhất một — chốt đó nằm ở action vì
 * nó cần biết cả hai ô cùng lúc sau khi đã ép kiểu. Ở đây chỉ lo từng ô một.
 *
 * `cashPerShare` là tiền TRÊN MỖI CỔ PHIẾU, không phải tổng. Người dùng đọc thông
 * báo của doanh nghiệp dưới dạng "1.000 đồng/cp", còn tổng thì phụ thuộc số cổ
 * phiếu đang nắm — bắt họ tự nhân là mời một lỗi số học vào dữ liệu tài chính.
 */
export const dividendSchema = z.object({
  portfolioId: cuid,
  brokerAccountId: cuid,
  stockId: cuid,
  occurredAt: z.coerce.date(),
  /** Tiền trên mỗi cổ phiếu. Bỏ trống = đợt này không trả tiền. */
  cashPerShare: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v.replace(/[.,\s]/g, '')))
    .refine((v) => v === undefined || /^\d+$/.test(v), {
      message: 'Tiền trên mỗi cổ phiếu phải là số nguyên dương',
    })
    .transform((v) => (v === undefined ? undefined : BigInt(v)))
    .refine((v) => v === undefined || v > 0n, {
      message: 'Bỏ trống nếu đợt này không trả tiền, đừng điền 0',
    }),
  /** Số cổ phiếu nhận thêm. Bỏ trống = đợt này không chia cổ phiếu. */
  shareQuantity: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : v.replace(/[.,\s]/g, '')))
    .refine((v) => v === undefined || /^\d+$/.test(v), {
      message: 'Số cổ phiếu phải là số nguyên dương',
    })
    .transform((v) => (v === undefined ? undefined : Number(v)))
    .refine((v) => v === undefined || (v > 0 && v <= 1_000_000_000), {
      message: 'Bỏ trống nếu đợt này không chia cổ phiếu, đừng điền 0',
    }),
  note: z.string().trim().max(500, 'Ghi chú tối đa 500 ký tự').optional(),
});

export const tradeSchema = z
  .object({
    portfolioId: cuid,
    stockId: cuid,
    transactionType: z.enum([TRANSACTION_TYPE.BUY, TRANSACTION_TYPE.SELL]),
    quantity: z
      .number()
      .int('Khối lượng phải là số nguyên')
      .positive('Khối lượng phải lớn hơn 0')
      .max(1_000_000_000, 'Khối lượng vượt ngưỡng hợp lý'),
    price: vndAmount.refine((v) => v > 0n, 'Giá phải lớn hơn 0'),
    fees: vndAmount.default(0n),
    tax: vndAmount.default(0n),
    executedAt: z.coerce.date(),
    userId: cuid,
    teamId: cuid.optional(),
    /**
     * Tài khoản chứng khoán thực hiện lệnh — BẮT BUỘC.
     *
     * Không có tài khoản thì không có chỗ để tiền ra/vào, và số dư từng tài khoản
     * không tính được. Cột ở database là nullable vì các lệnh CŨ không mang thông
     * tin này; ràng buộc bắt buộc đặt ở đây, nơi chỉ lệnh MỚI đi qua.
     */
    brokerAccountId: cuid.describe('Tài khoản chứng khoán'),
    status: z
      .enum([
        TRADE_STATUS.DRAFT,
        TRADE_STATUS.PENDING_APPROVAL,
        TRADE_STATUS.APPROVED,
        TRADE_STATUS.EXECUTED,
      ])
      .default(TRADE_STATUS.DRAFT),
    orderId: z.string().max(60).optional(),
    broker: z.string().max(60).optional(),
    executionNote: z.string().max(1000).optional(),
    investmentThesis: z.string().max(4000).optional(),

    /** Phân bổ chiến lược — bắt buộc, tổng phải đủ 100%. */
    strategies: z
      .array(strategyAllocationSchema)
      .min(1, 'Giao dịch phải được phân bổ cho ít nhất một chiến lược'),
  })
  // --- RÀNG BUỘC 1: tổng phân bổ = 100% -----------------------------------
  .refine(
    (t) => t.strategies.reduce((sum, s) => sum + s.allocationBps, 0) === BPS_TOTAL,
    (t) => {
      const total = t.strategies.reduce((sum, s) => sum + s.allocationBps, 0);
      return {
        path: ['strategies'],
        message:
          `Tổng tỷ lệ phân bổ chiến lược phải bằng 100%, ` +
          `hiện tại là ${(total / 100).toFixed(2)}%`,
      };
    },
  )
  // --- RÀNG BUỘC 2: không trùng chiến lược --------------------------------
  .refine(
    (t) => new Set(t.strategies.map((s) => s.strategyId)).size === t.strategies.length,
    { path: ['strategies'], message: 'Một chiến lược chỉ được xuất hiện một lần trong giao dịch' },
  )
  // --- RÀNG BUỘC 3: ngày khớp không ở tương lai ---------------------------
  .refine((t) => t.executedAt.getTime() <= Date.now() + 60_000, {
    path: ['executedAt'],
    message: 'Thời điểm khớp lệnh không được ở tương lai',
  });

export type TradeInput = z.infer<typeof tradeSchema>;

/**
 * Biến dữ liệu đã validate thành đúng những gì cần ghi vào DB.
 *
 * Đây là nơi duy nhất được phép tạo dòng TradeStrategy: nó gọi allocateAmount()
 * nên Σ allocationAmount = netAmount TUYỆT ĐỐI, không lệch 1 đồng do làm tròn.
 */
export function buildTradeStrategyRows(input: TradeInput): {
  netAmount: bigint;
  rows: { strategyId: string; allocationBps: number; allocationAmount: bigint; note?: string }[];
} {
  const net = netAmount(input.transactionType, input.quantity, input.price, input.fees, input.tax);
  const amounts = allocateAmount(net, input.strategies.map((s) => s.allocationBps));

  return {
    netAmount: net,
    rows: input.strategies.map((s, i) => ({
      strategyId: s.strategyId,
      allocationBps: s.allocationBps,
      allocationAmount: amounts[i]!,
      note: s.note,
    })),
  };
}

/** Kiểm tra giá có đúng bước giá của sàn (§ bước giá HOSE/HNX/UPCOM). */
export function validateTickSize(exchange: Exchange, price: bigint): boolean {
  const p = Number(price);
  return p % tickSize(exchange, p) === 0;
}

// ---------------------------------------------------------------------------
// Rủi ro & cấu hình
// ---------------------------------------------------------------------------

export const riskRuleSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{3,60}$/),
  name: z.string().min(3).max(150),
  nameVi: z.string().min(3).max(150),
  scope: z.enum(['STOCK', 'SECTOR', 'STRATEGY', 'PORTFOLIO', 'MARKET_DATA', 'APPROVAL']),
  metric: z.enum(['WEIGHT_BPS', 'PNL_BPS', 'CASH_BPS', 'DATA_DELAY_MINUTES', 'PENDING_COUNT']),
  comparator: z.enum(['GT', 'GTE', 'LT', 'LTE']),
  threshold: z.union([z.bigint(), z.number().int(), z.string().regex(/^-?\d+$/)]).transform((v) => BigInt(v)),
  severity: z.enum(['INFO', 'WARNING', 'HIGH', 'CRITICAL']),
  targetRef: z.string().max(60).optional(),
  portfolioId: cuid.optional(),
  description: z.string().max(1000).optional(),
  isActive: z.boolean().default(true),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

/** Bộ lọc global của Dashboard Tầng 1 (§11) — dùng chung cho mọi component. */
export const dashboardFilterSchema = z.object({
  portfolioId: cuid.optional(),
  teamId: cuid.optional(),
  strategyId: cuid.optional(),
  sectorId: cuid.optional(),
  period: z.enum(['1W', '1M', '3M', '6M', 'YTD', 'ALL']).default('YTD'),
});

export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;
