/**
 * Danh mục quyền hạn & bản đồ Role → Permission (§3).
 *
 * Đây là NGUỒN SỰ THẬT cho phân quyền. Bảng `permissions` và `role_permissions`
 * trong DB được sinh ra từ file này bởi prisma/seed.ts, nên muốn thêm quyền chỉ
 * cần sửa ở đây rồi chạy lại seed.
 *
 * Quy tắc phân giải quyền (hàm `resolvePermissions` dưới cùng):
 *
 *     DENY của user   >   GRANT của user   >   quyền của Role
 *
 * DENY luôn thắng: đã bị chặn tường minh thì Role có quyền cũng không dùng được.
 * Đây là điều kiện cần để §3 "Member chỉ được thao tác trong phạm vi được phân
 * quyền" có thể cưỡng chế được trong thực tế.
 */

import { ROLE, PERMISSION_EFFECT, type RoleCode, type PermissionEffect } from '@/lib/enums';

// ---------------------------------------------------------------------------
// Danh mục quyền
// ---------------------------------------------------------------------------

export interface PermissionDef {
  /** `module.action`, ví dụ `transaction.approve` */
  code: string;
  module: string;
  action: string;
  name: string;
  nameVi: string;
  description?: string;
}

function p(
  module: string,
  action: string,
  name: string,
  nameVi: string,
  description?: string,
): PermissionDef {
  return { code: `${module}.${action}`, module, action, name, nameVi, description };
}

/**
 * Toàn bộ quyền của hệ thống, nhóm theo module khớp với menu §21.
 *
 * Quy ước hậu tố:
 *   `view`      → chỉ xem phần dữ liệu được phân quyền (team mình, danh mục được gán)
 *   `view_all`  → xem xuyên suốt toàn hệ thống, không giới hạn team/danh mục
 */
export const PERMISSIONS: readonly PermissionDef[] = [
  // Dashboard
  p('dashboard', 'view', 'View dashboard', 'Xem dashboard'),

  // Portfolio
  p('portfolio', 'view', 'View assigned portfolios', 'Xem danh mục được phân quyền'),
  p('portfolio', 'view_all', 'View all portfolios', 'Xem toàn bộ danh mục'),
  p('portfolio', 'create', 'Create portfolio', 'Tạo danh mục'),
  p('portfolio', 'update', 'Update portfolio', 'Sửa danh mục'),
  p('portfolio', 'delete', 'Delete portfolio', 'Xoá danh mục'),
  p('portfolio', 'manage_access', 'Manage portfolio access', 'Phân quyền truy cập danh mục'),

  // Position (kết quả tính của Portfolio Engine)
  p('position', 'view', 'View assigned positions', 'Xem vị thế được phân quyền'),
  p('position', 'view_all', 'View all positions', 'Xem toàn bộ vị thế'),

  // Transaction
  p('transaction', 'view', 'View own/team transactions', 'Xem giao dịch của mình và của nhóm'),
  p('transaction', 'view_all', 'View all transactions', 'Xem toàn bộ giao dịch'),
  p('transaction', 'create', 'Create transaction', 'Nhập giao dịch'),
  p('transaction', 'update', 'Update transaction', 'Sửa giao dịch'),
  p('transaction', 'delete', 'Delete transaction', 'Xoá giao dịch'),
  p('transaction', 'approve', 'Approve transaction', 'Duyệt giao dịch'),
  p('transaction', 'cancel', 'Cancel transaction', 'Huỷ giao dịch'),

  // Capital / nguồn vốn
  p('capital', 'view', 'View capital of assigned portfolios', 'Xem vốn của danh mục được phân quyền'),
  p('capital', 'view_all', 'View all capital', 'Xem toàn bộ nguồn vốn'),
  p('capital', 'create', 'Record capital flow', 'Ghi nhận nạp/rút vốn'),
  p('capital', 'update', 'Update capital flow', 'Sửa dòng vốn'),
  p('capital', 'delete', 'Delete capital flow', 'Xoá dòng vốn'),
  p('capital', 'approve', 'Approve capital flow', 'Duyệt dòng vốn'),

  // Strategy
  p('strategy', 'view', 'View strategies', 'Xem chiến lược'),
  p('strategy', 'create', 'Create strategy', 'Tạo chiến lược'),
  p('strategy', 'update', 'Update strategy', 'Sửa chiến lược'),
  p('strategy', 'delete', 'Delete strategy', 'Xoá chiến lược'),

  // Market master data
  /*
   * Chỉ còn `stock.view`. Ba quyền create / update / delete đã được bỏ cùng với
   * trang quản lý mã chứng khoán.
   *
   * `stock.view` PHẢI ở lại: form nhập lệnh chọn mã từ master data (§23 "không
   * để dữ liệu nhập trùng — Stock phải có master data"), và trang Market Data
   * cũng đọc danh sách mã. Bảng `stocks` không mất, chỉ mất giao diện sửa nó —
   * thêm mã mới bây giờ là sửa `STOCK_SEED` rồi chạy lại `npm run db:seed`.
   */
  p('stock', 'view', 'View stock master', 'Xem danh mục mã chứng khoán'),
  p('sector', 'view', 'View sectors', 'Xem ngành'),
  p('sector', 'manage', 'Manage sectors & industries', 'Quản lý ngành và phân ngành'),

  // Market data service
  p('market_data', 'view', 'View market data status', 'Xem trạng thái dữ liệu thị trường'),
  p('market_data', 'sync', 'Trigger market data sync', 'Kích hoạt đồng bộ dữ liệu thị trường'),

  /*
   * ĐÃ BỎ: `performance.view` và `performance.view_all`.
   *
   * Trang /performance đã được xoá vì phần lớn nội dung của nó trùng với khối
   * "Portfolio Performance" trên Dashboard. Giữ lại hai quyền này sẽ để lại hai
   * dòng trong Ma trận quyền không mở được thứ gì — đúng loại cấu hình trông như
   * có tác dụng mà thực ra không, giống bẫy `market_data.sync_interval_seconds`.
   *
   * Hiệu suất bây giờ đi theo quyền của nơi hiển thị nó: `dashboard.view` cho
   * khối trên Dashboard, `report.export` cho báo cáo "Hiệu suất theo phiên".
   */

  // Risk
  p('risk', 'view', 'View risk & alerts', 'Xem rủi ro và cảnh báo'),
  p('risk', 'manage_rules', 'Manage risk thresholds', 'Cấu hình ngưỡng rủi ro'),
  p('risk', 'acknowledge_alert', 'Acknowledge alerts', 'Xác nhận cảnh báo'),

  // Organisation
  p('team', 'view', 'View teams', 'Xem nhóm'),
  p('team', 'create', 'Create team', 'Tạo nhóm'),
  p('team', 'update', 'Update team', 'Sửa nhóm'),
  p('team', 'delete', 'Delete team', 'Xoá nhóm'),
  p('department', 'view', 'View departments', 'Xem phòng ban'),
  p('department', 'manage', 'Manage departments', 'Quản lý phòng ban'),
  p(
    'ib',
    'manage',
    'Manage introducing brokers',
    'Quản lý danh mục IB',
    'Khai danh sách IB mà người dùng được chọn khi khai tài khoản chứng khoán. Không có quyền xem riêng: ô chọn IB là một phần của việc khai tài khoản của chính mình, ai khai được tài khoản thì đọc được danh sách IB đang bật.',
  ),

  // Users
  p('user', 'view', 'View users', 'Xem người dùng'),
  p('user', 'create', 'Create user', 'Tạo người dùng'),
  p('user', 'update', 'Update user', 'Sửa người dùng'),
  p('user', 'approve', 'Approve pending registration', 'Duyệt tài khoản chờ'),
  p('user', 'suspend', 'Suspend user', 'Tạm khoá người dùng'),
  p(
    'user',
    'reset_password',
    'Reset another user password',
    'Đặt lại mật khẩu người dùng',
    'Đường phục hồi khi người dùng quên mật khẩu — hệ thống không có email nên không có luồng tự phục vụ. Tách khỏi user.update vì đây là thao tác duy nhất cho phép chiếm quyền truy cập tài khoản của người khác.',
  ),
  p('user', 'delete', 'Delete user', 'Xoá người dùng'),
  p('user', 'assign_role', 'Assign role', 'Gán vai trò'),
  p('user', 'assign_team', 'Assign department & team', 'Gán phòng ban và nhóm'),

  // Permission management
  p('permission', 'view', 'View permission matrix', 'Xem ma trận quyền'),
  p('permission', 'manage', 'Manage permissions', 'Quản lý phân quyền'),

  // Approvals
  p('approval', 'view', 'View approval queue', 'Xem hàng chờ duyệt'),
  /*
   * ĐÃ BỎ `approval.decide`. Nó nằm trong danh mục từ đầu nhưng KHÔNG ĐƯỢC KIỂM Ở
   * ĐÂU CẢ — cổng thật để duyệt một lệnh là `transaction.approve`, dùng ở 6 chỗ.
   *
   * Một quyền không gác gì là cái bẫy: người quản trị cấp nó, tin rằng người kia
   * duyệt được, rồi không hiểu vì sao nút duyệt vẫn không hiện. Đúng chuyện đã xảy
   * ra với vai trò "Quản lý nhóm" khi mới thêm.
   */

  // Reports
  p('report', 'view', 'View reports', 'Xem báo cáo'),
  p('report', 'export', 'Export reports', 'Xuất báo cáo'),

  // Audit
  p('audit', 'view', 'View audit log', 'Xem lịch sử thay đổi'),
  p('audit', 'export', 'Export audit log', 'Xuất lịch sử thay đổi'),

  // Settings
  p('settings', 'view', 'View system settings', 'Xem cấu hình hệ thống'),
  p('settings', 'update', 'Update system settings', 'Sửa cấu hình hệ thống'),
];

/** Tra cứu nhanh theo code. */
export const PERMISSION_BY_CODE: ReadonlyMap<string, PermissionDef> = new Map(
  PERMISSIONS.map((perm) => [perm.code, perm]),
);

export const ALL_PERMISSION_CODES: readonly string[] = PERMISSIONS.map((perm) => perm.code);

// ---------------------------------------------------------------------------
// Bản đồ Role → Permission  (§3)
// ---------------------------------------------------------------------------

/** Ban lãnh đạo: xem xuyên suốt toàn hệ thống + duyệt, nhưng KHÔNG tự nhập lệnh. */
const SENIOR_MANAGER_PERMISSIONS: readonly string[] = [
  'dashboard.view',
  'portfolio.view', 'portfolio.view_all',
  'position.view', 'position.view_all',
  'transaction.view', 'transaction.view_all', 'transaction.approve',
  'capital.view', 'capital.view_all', 'capital.approve',
  'strategy.view',
  'stock.view', 'sector.view',
  'market_data.view',
  'risk.view', 'risk.acknowledge_alert',
  'team.view', 'department.view',
  'user.view',
  'approval.view',
  'report.view', 'report.export',
  'audit.view',
];

/**
 * QUẢN LÝ NHÓM: làm mọi việc của Trade, cộng thêm DUYỆT và xem người trong nhóm.
 *
 * KHÔNG có bất kỳ quyền `*.view_all` nào — đó là điểm phân biệt với Quản lý cấp
 * cao. Người này quản MỘT nhóm, nên `dataScope()` trả về SCOPED và mọi con số bị
 * ép về nhóm của họ (xem `applyScope`). Cấp `view_all` ở đây sẽ cho họ thấy vốn và
 * lãi/lỗ của cả ba nhóm còn lại.
 *
 * `transaction.approve` là lý do vai trò này tồn tại: trưởng nhóm duyệt lệnh của
 * nhóm mình. Nguyên tắc bốn mắt (§8) vẫn chặn tự duyệt lệnh do chính mình nhập, và
 * hàng chờ duyệt chỉ hiện lệnh trong nhóm họ (xem `/approvals`).
 *
 * `capital.approve` cũng ở đây: RÚT VỐN phải được cấp quản lý nhóm trở lên chấp
 * nhận. Trước đây quyền này chỉ có ở Quản lý cấp cao, nên một yêu cầu rút vốn của
 * nhóm phải chờ tới cấp trên nhóm — trong khi người biết rõ nhất tiền của nhóm đang
 * dùng vào việc gì chính là trưởng nhóm. Bốn mắt vẫn áp: không ai tự duyệt lệnh rút
 * của chính mình.
 *
 * Kèm theo `transaction.approve` là một hệ quả cần biết: lệnh do CHÍNH họ nhập, nếu
 * dưới ngưỡng duyệt, sẽ được ghi thẳng `EXECUTED` không qua ai. Đó là đúng — người
 * duyệt của nhóm không thể tự chờ chính mình duyệt.
 */
const TEAM_MANAGER_PERMISSIONS: readonly string[] = [
  'dashboard.view',
  'portfolio.view',
  'position.view',
  'transaction.view', 'transaction.create', 'transaction.update',
  'capital.view',
  'strategy.view',
  'stock.view', 'sector.view',
  'market_data.view',
  'risk.view', 'risk.acknowledge_alert',
  'team.view', 'department.view',
  'user.view',
  'transaction.approve', 'capital.approve',
  'approval.view',
  'report.view', 'report.export',
];

/** Nhóm thực thi: nhập và sửa lệnh của nhóm mình, xem trong phạm vi được gán. */
const EXECUTION_PERMISSIONS: readonly string[] = [
  'dashboard.view',
  'portfolio.view',
  'position.view',
  'transaction.view', 'transaction.create', 'transaction.update',
  'capital.view',
  'strategy.view',
  'stock.view', 'sector.view',
  'market_data.view',
  'risk.view',
  'team.view',
  'report.view',
];

/** Nhóm hỗ trợ thực thi: quyền thấp hơn Execution — nhập được nhưng KHÔNG sửa. */
const SUPPORTING_EXECUTION_PERMISSIONS: readonly string[] = [
  'dashboard.view',
  'portfolio.view',
  'position.view',
  'transaction.view', 'transaction.create',
  'strategy.view',
  'stock.view', 'sector.view',
  'market_data.view',
  'risk.view',
];

/**
 * Thành viên: chỉ đọc ở mức tối thiểu.
 * Mọi quyền thao tác phải do Admin/Manager cấp thêm qua bảng `user_permissions`.
 */
const MEMBER_PERMISSIONS: readonly string[] = [
  'dashboard.view',
  'portfolio.view',
  'position.view',
  'transaction.view',
  'strategy.view',
  'stock.view',
  'market_data.view',
];

export const ROLE_PERMISSIONS: Record<RoleCode, readonly string[]> = {
  // Admin có toàn quyền — lấy trực tiếp từ danh mục để không bao giờ bị bỏ sót
  // khi thêm quyền mới.
  [ROLE.ADMIN]: ALL_PERMISSION_CODES,
  [ROLE.SENIOR_MANAGER]: SENIOR_MANAGER_PERMISSIONS,
  [ROLE.TEAM_MANAGER]: TEAM_MANAGER_PERMISSIONS,
  [ROLE.EXECUTION]: EXECUTION_PERMISSIONS,
  [ROLE.SUPPORTING_EXECUTION]: SUPPORTING_EXECUTION_PERMISSIONS,
  [ROLE.MEMBER]: MEMBER_PERMISSIONS,
};

// ---------------------------------------------------------------------------
// Phân giải quyền
// ---------------------------------------------------------------------------

export interface UserPermissionOverride {
  permissionCode: string;
  effect: PermissionEffect;
  expiresAt?: Date | null;
}

/**
 * Tính tập quyền hiệu lực của một user.
 *
 * @param roleCode  Role của user, null nếu còn PENDING (chưa được gán) → không quyền.
 * @param overrides Các dòng `user_permissions` của user.
 * @param now       Mốc thời gian để loại các override đã hết hạn.
 */
export function resolvePermissions(
  roleCode: RoleCode | null | undefined,
  overrides: readonly UserPermissionOverride[] = [],
  now: Date = new Date(),
): ReadonlySet<string> {
  // User chưa được duyệt/gán role thì không có quyền nào.
  const effective = new Set<string>(roleCode ? ROLE_PERMISSIONS[roleCode] ?? [] : []);

  const active = overrides.filter((o) => !o.expiresAt || o.expiresAt > now);

  for (const o of active) {
    if (o.effect === PERMISSION_EFFECT.GRANT) effective.add(o.permissionCode);
  }
  // DENY xử lý sau cùng để luôn thắng GRANT.
  for (const o of active) {
    if (o.effect === PERMISSION_EFFECT.DENY) effective.delete(o.permissionCode);
  }

  return effective;
}

/** Kiểm tra một quyền. */
export function can(permissions: ReadonlySet<string>, code: string): boolean {
  return permissions.has(code);
}

/** Có ÍT NHẤT MỘT trong các quyền. */
export function canAny(permissions: ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.some((c) => permissions.has(c));
}

/** Có TẤT CẢ các quyền. */
export function canAll(permissions: ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.every((c) => permissions.has(c));
}

/**
 * Phạm vi dữ liệu được xem của một module.
 * `ALL` → không lọc ; `SCOPED` → lọc theo team + danh mục được gán ; `NONE` → chặn.
 */
export type DataScope = 'ALL' | 'SCOPED' | 'NONE';

/**
 * Phạm vi dữ liệu của một module.
 *
 * `position` KHÔNG chỉ dùng cho trang Positions. Nó là quyền chuẩn cho MỌI chỗ
 * hiển thị vị thế hoặc P&L, kể cả khi đã gộp lại:
 *
 *   - phân rã vốn / lãi-lỗ theo nhóm trên Dashboard
 *   - dashboard thu nhỏ của từng nhóm ở trang Teams
 *
 * Lý do không thêm một quyền `team.view_all` riêng: con số ở những chỗ đó LÀ vị
 * thế và P&L, chỉ gộp theo nhóm. Hai quyền cho cùng một dữ liệu là hai nguồn sự
 * thật có thể đặt lệch nhau — và điều đó đã xảy ra thật: khối "theo nhóm" trên
 * Dashboard từng dùng phạm vi `portfolio`, nên DENY `position.view_all` cho một
 * người thì trang Teams ẩn đúng mà Dashboard vẫn in đủ tiền của cả bốn nhóm.
 */
export function dataScope(
  permissions: ReadonlySet<string>,
  module: 'portfolio' | 'position' | 'transaction' | 'capital',
): DataScope {
  if (permissions.has(`${module}.view_all`)) return 'ALL';
  if (permissions.has(`${module}.view`)) return 'SCOPED';
  return 'NONE';
}
