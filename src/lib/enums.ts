/**
 * Hằng số thay cho `enum` của Prisma.
 *
 * SQLite không hỗ trợ enum nên các cột tương ứng trong schema.prisma là `String`.
 * File này là NGUỒN SỰ THẬT DUY NHẤT cho các giá trị hợp lệ.
 * Khi chuyển sang Postgres, các enum thật sẽ được sinh ra từ chính danh sách này
 * (xem docs/POSTGRES-MIGRATION.md) — không cần sửa code nghiệp vụ.
 */

/** Tiện ích: lấy union type các value của một object hằng. */
type ValueOf<T> = T[keyof T];

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

export const ROLE = {
  ADMIN: 'ADMIN',
  SENIOR_MANAGER: 'SENIOR_MANAGER',
  TEAM_MANAGER: 'TEAM_MANAGER',
  EXECUTION: 'EXECUTION',
  SUPPORTING_EXECUTION: 'SUPPORTING_EXECUTION',
  MEMBER: 'MEMBER',
} as const;
export type RoleCode = ValueOf<typeof ROLE>;

/** Cấp bậc để so sánh thẩm quyền. Số lớn hơn = quyền cao hơn. */
export const ROLE_LEVEL: Record<RoleCode, number> = {
  ADMIN: 100,
  SENIOR_MANAGER: 80,
  TEAM_MANAGER: 60,
  EXECUTION: 50,
  SUPPORTING_EXECUTION: 40,
  MEMBER: 10,
};

/**
 * Nhãn vai trò.
 *
 * KHÔNG dùng chữ "Nhóm" và không trùng tên phòng ban. Vai trò và nhóm là hai
 * thứ khác nhau và nằm cạnh nhau trên cùng một bảng ở trang Members:
 *
 *   Vai trò = ĐƯỢC LÀM GÌ    (quyền hạn, do Admin cấp)
 *   Nhóm    = LÀM VIỆC VỚI AI (Đá Bóng, Cầu Lông, Tài chính, Cá nhân)
 *
 * Trước đây EXECUTION được gắn nhãn "Nhóm thực thi" và cũng có một team tên
 * "Nhóm thực thi", nên cột Vai trò và cột Nhóm in ra cùng một chữ — đọc vào
 * tưởng hệ thống lặp dữ liệu. SENIOR_MANAGER thì trùng tên với phòng ban
 * "Ban lãnh đạo". Cả hai đã được đổi.
 *
 * QUY TẮC CHÍNH XÁC là không TRÙNG TÊN một nhóm hay phòng ban có thật, chứ không
 * phải cấm chữ "nhóm". `TEAM_MANAGER` = "Quản lý nhóm" dùng chữ đó theo nghĩa mô
 * tả và không trùng tên nhóm nào (Đá Bóng, Cầu Lông, Tài chính, Cá nhân).
 */
export const ROLE_LABEL_VI: Record<RoleCode, string> = {
  ADMIN: 'Quản trị hệ thống',
  SENIOR_MANAGER: 'Quản lý cấp cao',
  TEAM_MANAGER: 'Quản lý nhóm',
  EXECUTION: 'Trade',
  SUPPORTING_EXECUTION: 'Hỗ trợ Trade',
  MEMBER: 'Thành viên',
};

export const PERMISSION_EFFECT = {
  GRANT: 'GRANT',
  DENY: 'DENY',
} as const;
export type PermissionEffect = ValueOf<typeof PERMISSION_EFFECT>;

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export const USER_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  REJECTED: 'REJECTED',
} as const;
export type UserStatus = ValueOf<typeof USER_STATUS>;

export const USER_STATUS_LABEL_VI: Record<UserStatus, string> = {
  PENDING: 'Chờ duyệt',
  ACTIVE: 'Đang hoạt động',
  SUSPENDED: 'Tạm khoá',
  REJECTED: 'Đã từ chối',
};

// ---------------------------------------------------------------------------
// Thị trường
// ---------------------------------------------------------------------------

export const EXCHANGE = {
  HOSE: 'HOSE',
  HNX: 'HNX',
  UPCOM: 'UPCOM',
} as const;
export type Exchange = ValueOf<typeof EXCHANGE>;

/**
 * Bước giá theo sàn (VNĐ). Dùng để validate giá nhập tay ở Phase 04.
 * HOSE: <10k → 10đ ; 10k–49.95k → 50đ ; ≥50k → 100đ.
 * HNX & UPCOM: 100đ cho mọi mức giá.
 */
export function tickSize(exchange: Exchange, price: number): number {
  if (exchange !== EXCHANGE.HOSE) return 100;
  if (price < 10_000) return 10;
  if (price < 50_000) return 50;
  return 100;
}

export const STOCK_STATUS = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DELISTED: 'DELISTED',
  WATCHLIST: 'WATCHLIST',
} as const;
export type StockStatus = ValueOf<typeof STOCK_STATUS>;

// ---------------------------------------------------------------------------
// Danh mục & vốn
// ---------------------------------------------------------------------------

export const PORTFOLIO_STATUS = {
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type PortfolioStatus = ValueOf<typeof PORTFOLIO_STATUS>;

export const ACCESS_LEVEL = {
  VIEW: 'VIEW',
  TRADE: 'TRADE',
  MANAGE: 'MANAGE',
} as const;
export type AccessLevel = ValueOf<typeof ACCESS_LEVEL>;

export const CAPITAL_FLOW_TYPE = {
  CONTRIBUTION: 'CONTRIBUTION',
  WITHDRAWAL: 'WITHDRAWAL',
  DIVIDEND: 'DIVIDEND',
  INTEREST: 'INTEREST',
  OTHER_INCOME: 'OTHER_INCOME',
  OTHER_EXPENSE: 'OTHER_EXPENSE',
} as const;
export type CapitalFlowType = ValueOf<typeof CAPITAL_FLOW_TYPE>;

/**
 * Chiều tác động tới số dư tiền. `CapitalFlow.amount` luôn dương;
 * dấu được suy ra ở đây để không bao giờ có chuyện nhập sai dấu.
 */
export const CAPITAL_FLOW_SIGN: Record<CapitalFlowType, 1 | -1> = {
  CONTRIBUTION: 1,
  WITHDRAWAL: -1,
  DIVIDEND: 1,
  INTEREST: 1,
  OTHER_INCOME: 1,
  OTHER_EXPENSE: -1,
};

/** Dòng tiền có làm thay đổi TỔNG NGUỒN VỐN góp (không chỉ số dư tiền). */
export const CAPITAL_FLOW_AFFECTS_CONTRIBUTED: Record<CapitalFlowType, boolean> = {
  CONTRIBUTION: true,
  WITHDRAWAL: true,
  DIVIDEND: false,
  INTEREST: false,
  OTHER_INCOME: false,
  OTHER_EXPENSE: false,
};

export const CAPITAL_FLOW_LABEL_VI: Record<CapitalFlowType, string> = {
  CONTRIBUTION: 'Nạp vốn',
  WITHDRAWAL: 'Rút vốn',
  DIVIDEND: 'Cổ tức',
  INTEREST: 'Lãi tiền gửi',
  OTHER_INCOME: 'Thu khác',
  OTHER_EXPENSE: 'Chi khác',
};

export const CAPITAL_FLOW_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
} as const;
export type CapitalFlowStatus = ValueOf<typeof CAPITAL_FLOW_STATUS>;

// ---------------------------------------------------------------------------
// Giao dịch
// ---------------------------------------------------------------------------

export const TRANSACTION_TYPE = {
  BUY: 'BUY',
  SELL: 'SELL',
} as const;
export type TransactionType = ValueOf<typeof TRANSACTION_TYPE>;

export const TRANSACTION_TYPE_LABEL_VI: Record<TransactionType, string> = {
  BUY: 'Mua',
  SELL: 'Bán',
};

export const TRADE_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  /**
   * HIỆN KHÔNG ACTION NÀO ĐẶT TRẠNG THÁI NÀY.
   *
   * Duyệt một lệnh chờ đưa nó thẳng sang `EXECUTED` (một nhịp). `APPROVED` tồn
   * tại cho quy trình HAI NHỊP — "đã cho phép" tách khỏi "đã khớp ở sàn" — vốn là
   * mô hình đúng khi việc cho phép và việc khớp xảy ra ở hai thời điểm khác nhau.
   * Muốn dùng nó thì cần thêm một action ghi nhận khớp (`APPROVED → EXECUTED`);
   * chừng nào chưa có, đây là một trạng thái không lệnh nào đi vào được.
   *
   * Giữ lại chứ không xoá vì nó là từ vựng nghiệp vụ của đặc tả, và bảng
   * `TRADE_STATUS_TRANSITIONS` đã mở sẵn đường cho nó.
   */
  APPROVED: 'APPROVED',
  EXECUTED: 'EXECUTED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type TradeStatus = ValueOf<typeof TRADE_STATUS>;

export const TRADE_STATUS_LABEL_VI: Record<TradeStatus, string> = {
  DRAFT: 'Nháp',
  PENDING_APPROVAL: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  EXECUTED: 'Đã khớp',
  REJECTED: 'Bị từ chối',
  CANCELLED: 'Đã huỷ',
};

/**
 * CHỈ những trạng thái này được tính vào TIỀN, VỊ THẾ và P&L.
 *
 * ĐÂY LÀ NGUỒN SỰ THẬT DUY NHẤT của quy tắc "lệnh được duyệt mới tính vào".
 * `portfolio-engine.ts` đọc hằng số này chứ không tự viết `status: EXECUTED`.
 * Trước đây hằng số này tồn tại nhưng KHÔNG ĐƯỢC DÙNG Ở ĐÂU — quy tắc bị ghim
 * cứng rải rác ở chục chỗ, nên sửa hằng số không đổi gì cả mà vẫn trông như đã
 * đổi. Đúng kiểu sai đã làm nút "Duyệt & ghi nhận khớp" chết từ ngày viết ra:
 * hai chỗ trong cùng codebase nói ngược nhau.
 *
 * VÌ SAO CHỈ `EXECUTED`. Một dòng `trades` ghi lại một lần khớp ĐÃ xảy ra. Tiền
 * chỉ ra/vào tài khoản khi lệnh khớp thật, nên chỉ `EXECUTED` được đụng tới tiền
 * và vị thế. Nháp, chờ duyệt, bị từ chối, đã huỷ đều không.
 *
 * CÁI BẪY — `APPROVED` KHÔNG NẰM TRONG DANH SÁCH NÀY.
 *
 * Nhãn tiếng Việt của nó là "Đã duyệt", nên một lệnh ở trạng thái này ĐỌC như
 * đã được duyệt, nhưng nó không được tính vào tiền, vị thế, P&L, chia theo nhóm
 * hay theo cá nhân — nó biến mất khỏi mọi con số.
 *
 * Hiện KHÔNG TỚI ĐƯỢC trạng thái này: `createTradeAction` ghim cứng `DRAFT` và
 * bỏ qua giá trị `status` từ form, còn `approveTradeAction` chuyển thẳng
 * `PENDING_APPROVAL → EXECUTED` một nhịp. Kiểm trên dữ liệu: 0 dòng `APPROVED`.
 *
 * Nếu sau này mở luồng hai nhịp (duyệt rồi mới ghi nhận khớp) thì phải quyết
 * dứt khoát: hoặc thêm `APPROVED` vào danh sách này, hoặc đổi nhãn của nó thành
 * thứ không đọc thành "đã xong". Để nguyên như bây giờ là để sẵn một lệnh mang
 * chữ "Đã duyệt" mà không xuất hiện trong bất kỳ báo cáo nào.
 */
export const TRADE_STATUSES_COUNTED_IN_POSITION: readonly TradeStatus[] = [
  TRADE_STATUS.EXECUTED,
];

/**
 * Cùng quy tắc, dạng `where.status` của Prisma.
 *
 * Có sẵn ở đây để không nơi nào phải tự viết `{ in: [...] }` — mỗi lần viết lại
 * là một cơ hội để một truy vấn bị bỏ sót khi quy tắc đổi.
 */
export const COUNTED_TRADE_STATUS = { in: [...TRADE_STATUSES_COUNTED_IN_POSITION] };

/** Cùng quy tắc, dạng vị từ — dùng khi lọc trên mảng đã tải về. */
export function countsInPosition(status: TradeStatus): boolean {
  return TRADE_STATUSES_COUNTED_IN_POSITION.includes(status);
}

/** Chuyển trạng thái hợp lệ — cưỡng chế ở Phase 04, ngăn "sửa lụi" trạng thái. */
export const TRADE_STATUS_TRANSITIONS: Record<TradeStatus, readonly TradeStatus[]> = {
  DRAFT: [TRADE_STATUS.PENDING_APPROVAL, TRADE_STATUS.EXECUTED, TRADE_STATUS.CANCELLED],

  /*
   * `EXECUTED` ở đây là bước duyệt MỘT NHỊP — và nó từng bị thiếu.
   *
   * LỖI ĐÃ XẢY RA: `approveTradeAction` chuyển thẳng sang `EXECUTED` (xem chú
   * thích của nó), nhưng danh sách này chỉ cho `APPROVED | REJECTED | CANCELLED`.
   * Hai chỗ trong cùng một codebase nói ngược nhau, nên nút "Duyệt & ghi nhận
   * khớp" luôn báo "Không thể chuyển trạng thái PENDING_APPROVAL → EXECUTED" —
   * tức là KHÔNG DUYỆT ĐƯỢC LỆNH NÀO, kể từ ngày viết ra.
   *
   * VÌ SAO SỬA BẢNG NÀY chứ không sửa action: trong mô hình hiện tại, một dòng
   * `trades` ghi lại một lần khớp ĐÃ xảy ra (vì vậy `DRAFT → EXECUTED` cũng được
   * cho phép — lệnh dưới ngưỡng phải duyệt thì ghi nhận trực tiếp). Duyệt ở đây là
   * xác nhận bản ghi đó có hiệu lực, nên duyệt xong là vào vị thế. Đổi action
   * thành `APPROVED` sẽ tệ hơn: KHÔNG có action nào đưa `APPROVED → EXECUTED`,
   * nên mọi lệnh vừa duyệt sẽ mắc kẹt và không bao giờ được tính vào danh mục.
   *
   * `APPROVED` vẫn ở lại trong danh sách này để đường hai nhịp còn mở, nhưng hiện
   * KHÔNG action nào đặt trạng thái đó — xem chú thích của `TRADE_STATUS.APPROVED`.
   */
  PENDING_APPROVAL: [
    TRADE_STATUS.EXECUTED,
    TRADE_STATUS.APPROVED,
    TRADE_STATUS.REJECTED,
    TRADE_STATUS.CANCELLED,
  ],

  APPROVED: [TRADE_STATUS.EXECUTED, TRADE_STATUS.CANCELLED],
  EXECUTED: [TRADE_STATUS.CANCELLED],
  REJECTED: [],
  CANCELLED: [],
};

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

export const STRATEGY = {
  VALUE: 'VALUE',
  SIGNAL: 'SIGNAL',
  ACCUMULATION: 'ACCUMULATION',
  SECTOR_ROTATION: 'SECTOR_ROTATION',
  OTHER: 'OTHER',
} as const;
export type StrategyCode = ValueOf<typeof STRATEGY>;

// ---------------------------------------------------------------------------
// Dữ liệu thị trường
// ---------------------------------------------------------------------------

export const MARKET_DATA_SOURCE = {
  VNSTOCK: 'VNSTOCK',
  MANUAL: 'MANUAL',
  SEED: 'SEED',
} as const;
export type MarketDataSource = ValueOf<typeof MARKET_DATA_SOURCE>;

export const SYNC_KIND = {
  QUOTE: 'QUOTE',
  HISTORY: 'HISTORY',
  INDEX: 'INDEX',
  STOCK_MASTER: 'STOCK_MASTER',
} as const;
export type SyncKind = ValueOf<typeof SYNC_KIND>;

export const SYNC_STATUS = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  PARTIAL: 'PARTIAL',
  FAILED: 'FAILED',
} as const;
export type SyncStatus = ValueOf<typeof SYNC_STATUS>;

export const SYNC_TRIGGER = {
  CRON: 'CRON',
  MANUAL: 'MANUAL',
  STARTUP: 'STARTUP',
} as const;
export type SyncTrigger = ValueOf<typeof SYNC_TRIGGER>;

export const MARKET_INDEX = {
  VNINDEX: 'VNINDEX',
  VN30: 'VN30',
  HNXINDEX: 'HNXINDEX',
  UPCOMINDEX: 'UPCOMINDEX',
} as const;
export type MarketIndexCode = ValueOf<typeof MARKET_INDEX>;

/** Chỉ số dùng làm benchmark mặc định khi tính Alpha (§13). */
export const DEFAULT_BENCHMARK: MarketIndexCode = MARKET_INDEX.VNINDEX;

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export const RISK_SCOPE = {
  STOCK: 'STOCK',
  SECTOR: 'SECTOR',
  STRATEGY: 'STRATEGY',
  PORTFOLIO: 'PORTFOLIO',
  MARKET_DATA: 'MARKET_DATA',
  APPROVAL: 'APPROVAL',
} as const;
export type RiskScope = ValueOf<typeof RISK_SCOPE>;

export const RISK_METRIC = {
  WEIGHT_BPS: 'WEIGHT_BPS',
  PNL_BPS: 'PNL_BPS',
  CASH_BPS: 'CASH_BPS',
  DATA_DELAY_MINUTES: 'DATA_DELAY_MINUTES',
  PENDING_COUNT: 'PENDING_COUNT',
  MISSING_PRICE_COUNT: 'MISSING_PRICE_COUNT',
} as const;
export type RiskMetric = ValueOf<typeof RISK_METRIC>;

export const RISK_SCOPE_LABEL_VI: Record<RiskScope, string> = {
  STOCK: 'Mã chứng khoán',
  SECTOR: 'Ngành',
  STRATEGY: 'Chiến lược',
  PORTFOLIO: 'Danh mục',
  MARKET_DATA: 'Dữ liệu thị trường',
  APPROVAL: 'Hàng chờ duyệt',
};

export const RISK_METRIC_LABEL_VI: Record<RiskMetric, string> = {
  WEIGHT_BPS: 'Tỷ trọng',
  PNL_BPS: 'Lời/lỗ',
  CASH_BPS: 'Tiền khả dụng',
  DATA_DELAY_MINUTES: 'Độ trễ dữ liệu',
  PENDING_COUNT: 'Số lệnh chờ duyệt',
  MISSING_PRICE_COUNT: 'Số mã thiếu giá',
};

/**
 * Đơn vị của `threshold` và `measuredValue` — khác nhau theo metric.
 *
 * Cùng một cột `BigInt` mang ba loại đơn vị hoàn toàn khác: basis point, phút,
 * và số đếm. Không có bảng này thì giao diện sẽ in "1000" cho ngưỡng 10% và
 * người đọc không có cách nào biết đó là 1000 gì.
 */
export const RISK_METRIC_UNIT: Record<RiskMetric, 'BPS' | 'MINUTES' | 'COUNT'> = {
  WEIGHT_BPS: 'BPS',
  PNL_BPS: 'BPS',
  CASH_BPS: 'BPS',
  DATA_DELAY_MINUTES: 'MINUTES',
  PENDING_COUNT: 'COUNT',
  MISSING_PRICE_COUNT: 'COUNT',
};

export const COMPARATOR = {
  GT: 'GT',
  GTE: 'GTE',
  LT: 'LT',
  LTE: 'LTE',
} as const;
export type Comparator = ValueOf<typeof COMPARATOR>;

export const COMPARATOR_SYMBOL: Record<Comparator, string> = {
  GT: '>',
  GTE: '≥',
  LT: '<',
  LTE: '≤',
};

export function compareThreshold(
  measured: bigint,
  comparator: Comparator,
  threshold: bigint,
): boolean {
  switch (comparator) {
    case COMPARATOR.GT:
      return measured > threshold;
    case COMPARATOR.GTE:
      return measured >= threshold;
    case COMPARATOR.LT:
      return measured < threshold;
    case COMPARATOR.LTE:
      return measured <= threshold;
  }
}

export const SEVERITY = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type Severity = ValueOf<typeof SEVERITY>;

/** Đèn hiển thị trên Dashboard (§19). */
export const SEVERITY_DOT: Record<Severity, string> = {
  INFO: '🟢',
  WARNING: '🟡',
  HIGH: '🟠',
  CRITICAL: '🔴',
};

/**
 * Thứ tự nghiêm trọng để SẮP XẾP — số lớn hơn nghĩa là gấp hơn.
 *
 * Không dùng thứ tự chữ cái: theo bảng chữ cái thì CRITICAL đứng trước INFO
 * nhưng WARNING lại đứng sau HIGH, tức là danh sách trông "có sắp xếp" mà thứ tự
 * sai — kiểu lỗi rất khó nhìn ra bằng mắt.
 */
export const SEVERITY_RANK: Record<Severity, number> = {
  INFO: 1,
  WARNING: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export const SEVERITY_LABEL_VI: Record<Severity, string> = {
  INFO: 'Thông tin',
  WARNING: 'Cảnh báo',
  HIGH: 'Nghiêm trọng',
  CRITICAL: 'Rất nghiêm trọng',
};

export const ALERT_STATUS = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
} as const;
export type AlertStatus = ValueOf<typeof ALERT_STATUS>;

export const ALERT_STATUS_LABEL_VI: Record<AlertStatus, string> = {
  OPEN: 'Đang mở',
  ACKNOWLEDGED: 'Đã tiếp nhận',
  RESOLVED: 'Đã hết',
};

/** Ai khởi động lượt quét — xem model `RiskScanRun`. */
export const SCAN_TRIGGER = {
  /** Bộ hẹn giờ bên ngoài gọi vào /api/risk/scan. */
  SCHEDULE: 'SCHEDULE',
  /** Người dùng bấm "Quét lại". */
  MANUAL: 'MANUAL',
  /** Quét lười khi mở trang, chỉ chạy nếu lượt gần nhất đã cũ. */
  LAZY: 'LAZY',
} as const;
export type ScanTrigger = ValueOf<typeof SCAN_TRIGGER>;

export const SCAN_STATUS = {
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;
export type ScanStatus = ValueOf<typeof SCAN_STATUS>;

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export const APPROVAL_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type ApprovalStatus = ValueOf<typeof APPROVAL_STATUS>;

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Công ty chứng khoán (sàn)
// ---------------------------------------------------------------------------

/**
 * SÀN LÀ MASTER DATA DẠNG CODE, không phải một bảng.
 *
 * Cùng lý do như `STOCK_SEED` (§9 docs/DATA-MODEL): danh sách công ty chứng khoán
 * ở Việt Nam là hữu hạn và đổi rất chậm. Để nó thành bảng sửa qua giao diện thì
 * sớm muộn sẽ có cả "SSI" lẫn "ssi" lẫn "SSI " trong dữ liệu, và mỗi cái thành
 * một sàn riêng khi gộp số.
 *
 * `OTHER` tồn tại vì danh sách này không thể đủ. Khi chọn `OTHER`, tên sàn thật
 * BẮT BUỘC phải điền vào `brokerOther` — xem `brokerAccountSchema`.
 */
export const BROKER = {
  SSI: 'SSI',
  VPS: 'VPS',
  TCBS: 'TCBS',
  VPBANKS: 'VPBANKS',
  VIETCAP: 'VIETCAP',
  VNDIRECT: 'VNDIRECT',
  MBS: 'MBS',
  HSC: 'HSC',
  BSC: 'BSC',
  KIS: 'KIS',
  MIRAE: 'MIRAE',
  ACBS: 'ACBS',
  OTHER: 'OTHER',
} as const;
export type Broker = ValueOf<typeof BROKER>;

/** Tên hiển thị. Giữ đúng cách mỗi công ty tự viết tên mình. */
export const BROKER_LABEL_VI: Record<Broker, string> = {
  SSI: 'SSI',
  VPS: 'VPS',
  TCBS: 'TCBS (Techcom Securities)',
  VPBANKS: 'VPBankS',
  VIETCAP: 'Vietcap',
  VNDIRECT: 'VNDIRECT',
  MBS: 'MBS',
  HSC: 'HSC',
  BSC: 'BSC',
  KIS: 'KIS',
  MIRAE: 'Mirae Asset',
  ACBS: 'ACBS',
  OTHER: 'Khác',
};

/** Thứ tự hiển thị trong ô chọn. `OTHER` luôn nằm cuối. */
export const BROKER_OPTIONS: readonly Broker[] = [
  BROKER.SSI,
  BROKER.VPS,
  BROKER.TCBS,
  BROKER.VPBANKS,
  BROKER.VIETCAP,
  BROKER.VNDIRECT,
  BROKER.MBS,
  BROKER.HSC,
  BROKER.BSC,
  BROKER.KIS,
  BROKER.MIRAE,
  BROKER.ACBS,
  BROKER.OTHER,
];

export const AUDIT_ACTION = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  CANCEL: 'CANCEL',
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  LOGIN_FAILED: 'LOGIN_FAILED',
  EXPORT: 'EXPORT',
  PERMISSION_CHANGE: 'PERMISSION_CHANGE',
  /**
   * Quản trị viên đặt lại mật khẩu cho người khác.
   *
   * Tách riêng khỏi `UPDATE` vì đây là thao tác duy nhất cho phép một người chiếm
   * được quyền truy cập tài khoản của người khác. Ai soát nhật ký phải lọc ra được
   * nó mà không phải đọc từng dòng UPDATE.
   */
  PASSWORD_RESET: 'PASSWORD_RESET',
  SYNC: 'SYNC',
} as const;
export type AuditAction = ValueOf<typeof AUDIT_ACTION>;

export const ENTITY_TYPE = {
  USER: 'USER',
  ROLE: 'ROLE',
  PERMISSION: 'PERMISSION',
  DEPARTMENT: 'DEPARTMENT',
  TEAM: 'TEAM',
  STOCK: 'STOCK',
  SECTOR: 'SECTOR',
  INDUSTRY: 'INDUSTRY',
  PORTFOLIO: 'PORTFOLIO',
  CAPITAL_FLOW: 'CAPITAL_FLOW',
  TRADE: 'TRADE',
  TRADE_STRATEGY: 'TRADE_STRATEGY',
  STRATEGY: 'STRATEGY',
  RISK_RULE: 'RISK_RULE',
  RISK_ALERT: 'RISK_ALERT',
  APPROVAL_REQUEST: 'APPROVAL_REQUEST',
  SETTING: 'SETTING',
  MARKET_DATA: 'MARKET_DATA',
  BROKER_ACCOUNT: 'BROKER_ACCOUNT',
  INTRODUCING_BROKER: 'INTRODUCING_BROKER',
  /** Lần xuất báo cáo — dữ liệu ra khỏi hệ thống, không phải một bản ghi bị sửa. */
  REPORT: 'REPORT',
} as const;
export type EntityType = ValueOf<typeof ENTITY_TYPE>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SETTING_VALUE_TYPE = {
  STRING: 'STRING',
  INT: 'INT',
  BIGINT: 'BIGINT',
  BOOL: 'BOOL',
  JSON: 'JSON',
} as const;
export type SettingValueType = ValueOf<typeof SETTING_VALUE_TYPE>;

export const SETTING_GROUP = {
  GENERAL: 'GENERAL',
  TRADING: 'TRADING',
  MARKET_DATA: 'MARKET_DATA',
  RISK: 'RISK',
} as const;
export type SettingGroup = ValueOf<typeof SETTING_GROUP>;

/*
 * ĐÃ BỎ: `EXCHANGE_OPTIONS`. Nó chỉ dùng cho form thêm/sửa mã chứng khoán, và
 * form đó đã bị bỏ cùng với trang quản lý mã.
 */

/**
 * Lựa chọn mức nghiêm trọng cho form cấu hình ngưỡng rủi ro.
 *
 * PHẢI nằm ở module thường, KHÔNG được ở file `'use server'`. Next.js chỉ cho
 * export hàm async từ module server action; một `const` mảng export từ đó sẽ tới
 * client dưới dạng server-reference, và mọi lời gọi `.map()` trên nó đều nổ
 * "options.map is not a function" — lỗi rất khó truy vì file vẫn biên dịch bình
 * thường. Đây là bài học từ một lỗi thật, giữ lại ở đây vì mọi danh sách lựa chọn
 * mới đều phải tuân theo.
 */
export const SEVERITY_OPTIONS: readonly { value: Severity; label: string }[] = [
  { value: SEVERITY.INFO, label: `${SEVERITY_DOT.INFO} ${SEVERITY_LABEL_VI.INFO}` },
  { value: SEVERITY.WARNING, label: `${SEVERITY_DOT.WARNING} ${SEVERITY_LABEL_VI.WARNING}` },
  { value: SEVERITY.HIGH, label: `${SEVERITY_DOT.HIGH} ${SEVERITY_LABEL_VI.HIGH}` },
  { value: SEVERITY.CRITICAL, label: `${SEVERITY_DOT.CRITICAL} ${SEVERITY_LABEL_VI.CRITICAL}` },
];
