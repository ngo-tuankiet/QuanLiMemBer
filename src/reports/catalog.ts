/**
 * Danh mục báo cáo xuất được (§20) — Phase 10.
 *
 * MODULE THƯỜNG, dùng chung cho cả trang Reports (để liệt kê) và route xuất tệp
 * (để tra cứu). Một danh sách duy nhất, nên không thể có báo cáo hiện trên giao
 * diện mà route không biết, hoặc ngược lại.
 *
 * `code` đi thẳng vào URL và vào tên tệp tải về, nên chỉ dùng chữ thường và dấu
 * gạch nối.
 */

export type ReportParam = 'portfolio' | 'dateRange' | 'period' | 'auditFilter';

export interface ReportDef {
  code: string;
  nameVi: string;
  description: string;
  /** Quyền tối thiểu để XUẤT báo cáo này. */
  permission: string;
  /** Tham số báo cáo nhận qua query string. */
  params: readonly ReportParam[];
  /** Cột sẽ có trong tệp — hiện trên giao diện để biết trước khi tải. */
  columns: readonly string[];
}

export const REPORTS: readonly ReportDef[] = [
  {
    code: 'positions',
    nameVi: 'Vị thế hiện tại',
    description:
      'Toàn bộ mã đang giữ kèm giá vốn trung bình, giá thị trường, lời/lỗ chưa thực hiện ' +
      'và tỷ trọng. Tính từ giao dịch, không đọc số P&L lưu sẵn (§23).',
    permission: 'report.export',
    params: ['portfolio'],
    columns: [
      'symbol',
      'company',
      'sector',
      'quantity',
      'avg_cost_vnd',
      'price_vnd',
      'cost_vnd',
      'market_value_vnd',
      'unrealized_pnl_vnd',
      'realized_pnl_vnd',
      'return_pct',
      'weight_pct',
      'price_trading_date',
      'is_stale',
    ],
  },
  {
    code: 'transactions',
    nameVi: 'Giao dịch',
    description:
      'Sổ giao dịch đầy đủ: khối lượng, giá, phí, thuế, tiền ròng, trạng thái, người thực ' +
      'hiện và người duyệt. Một dòng một lệnh.',
    permission: 'report.export',
    params: ['portfolio', 'dateRange'],
    columns: [
      'code',
      'executed_at',
      'type',
      'symbol',
      'quantity',
      'price_vnd',
      'gross_vnd',
      'fees_vnd',
      'tax_vnd',
      'net_vnd',
      'status',
      'executor',
      'team',
      'approved_by',
      'strategies',
    ],
  },
  {
    code: 'trade-strategies',
    nameVi: 'Phân bổ đa chiến lược',
    description:
      'Một dòng cho mỗi cặp (lệnh × chiến lược) — đây là bản ghi gốc của §6. Cột ' +
      'allocation_amount_vnd của cùng một lệnh cộng lại đúng bằng tiền ròng của lệnh đó.',
    permission: 'report.export',
    params: ['portfolio', 'dateRange'],
    columns: [
      'trade_code',
      'executed_at',
      'symbol',
      'type',
      'strategy_code',
      'strategy',
      'allocation_pct',
      'allocation_amount_vnd',
      'trade_net_vnd',
    ],
  },
  {
    code: 'sector-allocation',
    nameVi: 'Tỷ trọng ngành',
    description: 'Giá trị thị trường, giá vốn, lời/lỗ và tỷ trọng theo từng ngành (§15).',
    permission: 'report.export',
    params: ['portfolio'],
    columns: [
      'sector_code',
      'sector',
      'symbols',
      'symbol_count',
      'cost_vnd',
      'market_value_vnd',
      'unrealized_pnl_vnd',
      'weight_pct',
    ],
  },
  {
    code: 'strategy-allocation',
    nameVi: 'Phân bổ chiến lược',
    description:
      'Vốn ròng đang triển khai theo từng chiến lược, kèm hạn mức cấu hình và cờ vượt ' +
      'hạn mức (§16).',
    permission: 'report.export',
    params: ['portfolio'],
    columns: [
      'strategy_code',
      'strategy',
      'net_capital_vnd',
      'weight_pct',
      'trade_count',
      'max_allocation_pct',
      'over_limit',
    ],
  },
  {
    code: 'capital-flows',
    nameVi: 'Dòng vốn',
    description: 'Nạp, rút, cổ tức, lãi và các khoản thu chi khác của danh mục.',
    permission: 'report.export',
    params: ['portfolio', 'dateRange'],
    columns: [
      'occurred_at',
      'flow_type',
      'amount_vnd',
      'status',
      'reference',
      'created_by',
      'approved_by',
      'note',
    ],
  },
  {
    code: 'performance-series',
    nameVi: 'Hiệu suất theo phiên',
    description:
      'Giá trị danh mục từng phiên, quy về mốc 100 ở đầu kỳ, kèm chỉ số tham chiếu để ' +
      'tính Alpha (§13).',
    permission: 'report.export',
    params: ['portfolio', 'period'],
    columns: [
      'trading_date',
      'portfolio_value_vnd',
      'portfolio_index',
      'benchmark_index',
      'benchmark_code',
    ],
  },
  {
    code: 'risk-alerts',
    nameVi: 'Cảnh báo rủi ro',
    description:
      'Toàn bộ cảnh báo — đang mở, đã tiếp nhận và đã hết — kèm số đo, ngưỡng và người ' +
      'tiếp nhận (§19).',
    permission: 'report.export',
    params: ['dateRange'],
    columns: [
      'triggered_at',
      'severity',
      'status',
      'rule_code',
      'scope',
      'metric',
      'target',
      'portfolio',
      'measured',
      'threshold',
      'title',
      'message',
      'acknowledged_by',
      'acknowledged_at',
      'resolved_at',
    ],
  },
  {
    code: 'audit-log',
    nameVi: 'Lịch sử thay đổi',
    description:
      'Audit Log dạng bảng: ai, lúc nào, làm gì, trên đối tượng nào, và những field nào ' +
      'đã đổi. Before/After ở dạng JSON nguyên bản (§20).',
    // Audit Log có quyền xuất RIÊNG, không dùng `report.export`: nó chứa dấu vết
    // hành vi của từng người, nên phải cấp riêng chứ không đi kèm gói báo cáo.
    permission: 'audit.export',
    params: ['dateRange', 'auditFilter'],
    columns: [
      'occurred_at',
      'action',
      'entity_type',
      'entity_id',
      'entity_label',
      'actor_name',
      'actor_email',
      'actor_role',
      'changed_fields',
      'before_json',
      'after_json',
      'note',
      'ip_address',
    ],
  },
];

export const REPORT_BY_CODE: ReadonlyMap<string, ReportDef> = new Map(
  REPORTS.map((r) => [r.code, r]),
);
