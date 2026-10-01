/**
 * MASTER DATA khởi tạo hệ thống.
 *
 * §23 "Không để dữ liệu nhập trùng — Stock, User, Team, Strategy phải có master
 * data". File này là bộ dữ liệu gốc, được nạp bởi prisma/seed.ts. Seed chạy theo
 * kiểu upsert nên có thể chạy lại nhiều lần mà không tạo bản ghi trùng.
 *
 * Danh sách mã chứng khoán ở đây là BỘ KHỞI ĐẦU (các mã thanh khoản cao, VN30 và
 * đại diện từng ngành), không phải toàn bộ thị trường. Phase 07 sẽ đồng bộ đầy đủ
 * danh mục mã từ VNStock (`MarketDataSync.kind = 'STOCK_MASTER'`) và cập nhật lại
 * tên công ty theo dữ liệu chính thức.
 */

import { EXCHANGE, ROLE, ROLE_LEVEL, ROLE_LABEL_VI, type RoleCode, type Exchange } from '@/lib/enums';

// ---------------------------------------------------------------------------
// Vai trò (§3)
// ---------------------------------------------------------------------------

export interface RoleSeed {
  code: RoleCode;
  name: string;
  nameVi: string;
  level: number;
  description: string;
}

export const ROLE_SEED: readonly RoleSeed[] = [
  {
    code: ROLE.ADMIN,
    name: 'Administrator',
    nameVi: ROLE_LABEL_VI.ADMIN,
    level: ROLE_LEVEL.ADMIN,
    description: 'Toàn quyền: quản lý user, duyệt tài khoản, quản lý team, phân quyền, quản lý vốn, xem audit log, cấu hình hệ thống.',
  },
  {
    code: ROLE.SENIOR_MANAGER,
    name: 'Senior Manager',
    nameVi: ROLE_LABEL_VI.SENIOR_MANAGER,
    level: ROLE_LEVEL.SENIOR_MANAGER,
    description: 'Xem toàn bộ vốn, danh mục, hiệu suất, strategy, ngành, nhóm thực thi. Duyệt giao dịch và xem báo cáo.',
  },
  {
    code: ROLE.TEAM_MANAGER,
    name: 'Team Manager',
    nameVi: ROLE_LABEL_VI.TEAM_MANAGER,
    level: ROLE_LEVEL.TEAM_MANAGER,
    description:
      'Quản lý một nhóm: làm mọi việc của Trade, cộng thêm duyệt giao dịch và xem thành viên trong nhóm. Mọi con số bị giới hạn trong phạm vi nhóm của mình.',
  },
  {
    code: ROLE.EXECUTION,
    name: 'Execution',
    nameVi: ROLE_LABEL_VI.EXECUTION,
    level: ROLE_LEVEL.EXECUTION,
    description: 'Nhập giao dịch, xem giao dịch của nhóm, xem danh mục được phân quyền, theo dõi hiệu suất nhóm. Không duyệt được lệnh.',
  },
  {
    code: ROLE.SUPPORTING_EXECUTION,
    name: 'Supporting Execution',
    nameVi: ROLE_LABEL_VI.SUPPORTING_EXECUTION,
    level: ROLE_LEVEL.SUPPORTING_EXECUTION,
    description: 'Quyền hạn thấp hơn Trade: nhập được giao dịch nhưng không sửa.',
  },
  {
    code: ROLE.MEMBER,
    name: 'Member',
    nameVi: ROLE_LABEL_VI.MEMBER,
    level: ROLE_LEVEL.MEMBER,
    description: 'Chỉ thao tác trong phạm vi được Admin/Manager phân quyền riêng.',
  },
];

// ---------------------------------------------------------------------------
// Phòng ban & nhóm (§2)
// ---------------------------------------------------------------------------

export interface DepartmentSeed {
  code: string;
  name: string;
  nameVi: string;
  parentCode: string | null;
  sortOrder: number;
}

export const DEPARTMENT_SEED: readonly DepartmentSeed[] = [
  { code: 'SENIOR_MANAGEMENT', name: 'Senior Management', nameVi: 'Ban lãnh đạo', parentCode: null, sortOrder: 1 },
  { code: 'INVESTMENT_MANAGEMENT', name: 'Investment Management', nameVi: 'Quản lý đầu tư', parentCode: 'SENIOR_MANAGEMENT', sortOrder: 2 },
  { code: 'MEMBERS', name: 'Members', nameVi: 'Thành viên', parentCode: 'SENIOR_MANAGEMENT', sortOrder: 3 },
];

export interface TeamSeed {
  code: string;
  name: string;
  nameVi: string;
  departmentCode: string;
  description: string;
}

/**
 * NHÓM LÀ NHÓM LÀM VIỆC, KHÔNG PHẢI VAI TRÒ.
 *
 * Ba team cũ tên là "Nhóm thực thi", "Nhóm hỗ trợ thực thi", "Quản lý danh mục"
 * — tức là đặt tên theo VAI TRÒ. Hậu quả thấy ngay trên trang Members: cột
 * "Vai trò" và cột "Nhóm" in ra cùng một chữ, đọc vào tưởng dữ liệu bị lặp.
 * Tệ hơn, nó dạy người dùng rằng đổi nhóm là đổi quyền, trong khi hai thứ đó
 * hoàn toàn độc lập trong hệ thống này.
 *
 *   Nhóm    = LÀM VIỆC VỚI AI  → bảng `teams`, đặt ở đây
 *   Vai trò = ĐƯỢC LÀM GÌ      → `ROLE_PERMISSIONS` trong src/domain/permissions.ts
 *
 * Một người trong nhóm Đá Bóng có thể mang vai trò EXECUTION hay MEMBER; đổi
 * nhóm không cấp thêm hay bớt quyền nào.
 *
 * "Cá nhân" LÀ MỘT NHÓM THẬT, không phải chỗ trống. Lý do kỹ thuật: `applyScope()`
 * ép người chỉ có quyền `*.view` (không có `view_all`) về nhóm của họ, và người
 * không thuộc nhóm nào sẽ bị ép về `__no_team__` — tức là không thấy gì cả, kể
 * cả giao dịch của chính mình. Vì vậy người giao dịch một mình phải có một nhóm
 * để đứng, và "Cá nhân" chính là nhóm đó.
 */
export const TEAM_SEED: readonly TeamSeed[] = [
  {
    code: 'DA_BONG',
    name: 'Da Bong',
    nameVi: 'Đá Bóng',
    departmentCode: 'INVESTMENT_MANAGEMENT',
    description: 'Nhóm giao dịch Đá Bóng.',
  },
  {
    code: 'CAU_LONG',
    name: 'Cau Long',
    nameVi: 'Cầu Lông',
    departmentCode: 'INVESTMENT_MANAGEMENT',
    description: 'Nhóm giao dịch Cầu Lông.',
  },
  {
    code: 'TAI_CHINH',
    name: 'Finance',
    nameVi: 'Tài chính',
    departmentCode: 'INVESTMENT_MANAGEMENT',
    // Trùng tên với ngành "Tài chính" (§15) nhưng khác miền hoàn toàn: đây là
    // nhóm người, kia là nhóm cổ phiếu. Mã `TAI_CHINH` vs `FINANCIALS` nên
    // không thể lẫn ở tầng dữ liệu.
    description: 'Nhóm giao dịch Tài chính.',
  },
  {
    code: 'CA_NHAN',
    name: 'Individual',
    nameVi: 'Cá nhân',
    departmentCode: 'INVESTMENT_MANAGEMENT',
    description: 'Người giao dịch độc lập, không thuộc nhóm nào ở trên.',
  },
];

// ---------------------------------------------------------------------------
// Chiến lược đầu tư (§5)
// ---------------------------------------------------------------------------

export interface StrategySeed {
  code: string;
  name: string;
  nameVi: string;
  description: string;
  colorHex: string;
  sortOrder: number;
}

export const STRATEGY_SEED: readonly StrategySeed[] = [
  {
    code: 'VALUE',
    name: 'Value',
    nameVi: 'Định giá rẻ',
    description: 'Mua cổ phiếu đang giao dịch dưới giá trị nội tại.',
    colorHex: '#2563eb',
    sortOrder: 1,
  },
  {
    code: 'SIGNAL',
    name: 'Signal',
    nameVi: 'Tín hiệu Xanh/Đỏ',
    description: 'Vào/ra theo tín hiệu chỉ báo kỹ thuật.',
    colorHex: '#16a34a',
    sortOrder: 2,
  },
  {
    code: 'ACCUMULATION',
    name: 'Accumulation',
    nameVi: 'Tích sản',
    description: 'Tích luỹ dài hạn, mua đều theo thời gian.',
    colorHex: '#9333ea',
    sortOrder: 3,
  },
  {
    code: 'SECTOR_ROTATION',
    name: 'Sector Rotation',
    nameVi: 'Sóng ngành',
    description: 'Luân chuyển vốn theo chu kỳ ngành.',
    colorHex: '#ea580c',
    sortOrder: 4,
  },
  {
    code: 'OTHER',
    name: 'Other',
    nameVi: 'Khác',
    description: 'Các trường hợp không thuộc bốn chiến lược trên.',
    colorHex: '#64748b',
    sortOrder: 5,
  },
];

// ---------------------------------------------------------------------------
// Ngành & phân ngành (§7, §15)
// ---------------------------------------------------------------------------

export interface SectorSeed {
  code: string;
  name: string;
  nameVi: string;
  colorHex: string;
  sortOrder: number;
  industries: { code: string; name: string; nameVi: string }[];
}

export const SECTOR_SEED: readonly SectorSeed[] = [
  {
    code: 'FINANCIALS',
    name: 'Financials',
    nameVi: 'Tài chính',
    colorHex: '#1d4ed8',
    sortOrder: 1,
    industries: [
      { code: 'BANKS', name: 'Banks', nameVi: 'Ngân hàng' },
      { code: 'SECURITIES', name: 'Securities', nameVi: 'Chứng khoán' },
      { code: 'INSURANCE', name: 'Insurance', nameVi: 'Bảo hiểm' },
      { code: 'FINANCIAL_SERVICES', name: 'Financial Services', nameVi: 'Dịch vụ tài chính khác' },
    ],
  },
  {
    code: 'REAL_ESTATE',
    name: 'Real Estate',
    nameVi: 'Bất động sản',
    colorHex: '#c2410c',
    sortOrder: 2,
    industries: [
      { code: 'RESIDENTIAL_RE', name: 'Residential Real Estate', nameVi: 'Bất động sản dân cư' },
      { code: 'INDUSTRIAL_RE', name: 'Industrial Real Estate', nameVi: 'Bất động sản khu công nghiệp' },
      { code: 'RE_SERVICES', name: 'Real Estate Services', nameVi: 'Dịch vụ bất động sản' },
    ],
  },
  {
    code: 'MATERIALS',
    name: 'Materials',
    nameVi: 'Nguyên vật liệu',
    colorHex: '#78716c',
    sortOrder: 3,
    industries: [
      { code: 'STEEL', name: 'Steel', nameVi: 'Thép' },
      { code: 'CHEMICALS', name: 'Chemicals & Fertilizers', nameVi: 'Hoá chất và phân bón' },
      { code: 'PLASTICS', name: 'Plastics', nameVi: 'Nhựa' },
      { code: 'CEMENT', name: 'Cement & Building Materials', nameVi: 'Xi măng và vật liệu xây dựng' },
      { code: 'RUBBER', name: 'Rubber', nameVi: 'Cao su' },
    ],
  },
  {
    code: 'ENERGY',
    name: 'Energy',
    nameVi: 'Năng lượng',
    colorHex: '#0f766e',
    sortOrder: 4,
    industries: [
      { code: 'OIL_GAS', name: 'Oil & Gas', nameVi: 'Dầu khí' },
      { code: 'OIL_GAS_SERVICES', name: 'Oil & Gas Services', nameVi: 'Dịch vụ dầu khí' },
    ],
  },
  {
    code: 'INFORMATION_TECHNOLOGY',
    name: 'Information Technology',
    nameVi: 'Công nghệ thông tin',
    colorHex: '#0891b2',
    sortOrder: 5,
    industries: [
      { code: 'SOFTWARE_IT', name: 'Software & IT Services', nameVi: 'Phần mềm và dịch vụ CNTT' },
      { code: 'TECH_HARDWARE', name: 'Technology Hardware', nameVi: 'Thiết bị công nghệ' },
    ],
  },
  {
    code: 'INDUSTRIALS',
    name: 'Industrials',
    nameVi: 'Công nghiệp',
    colorHex: '#4d7c0f',
    sortOrder: 6,
    industries: [
      { code: 'CONSTRUCTION', name: 'Construction & Engineering', nameVi: 'Xây dựng và kỹ thuật' },
      { code: 'AVIATION', name: 'Aviation', nameVi: 'Hàng không' },
      { code: 'LOGISTICS', name: 'Transportation & Logistics', nameVi: 'Vận tải và logistics' },
      { code: 'INDUSTRIAL_MACHINERY', name: 'Industrial Machinery', nameVi: 'Máy móc công nghiệp' },
    ],
  },
  {
    code: 'CONSUMER_STAPLES',
    name: 'Consumer Staples',
    nameVi: 'Hàng tiêu dùng thiết yếu',
    colorHex: '#a16207',
    sortOrder: 7,
    industries: [
      { code: 'FOOD_BEVERAGE', name: 'Food & Beverage', nameVi: 'Thực phẩm và đồ uống' },
      { code: 'AGRICULTURE', name: 'Agriculture & Fishery', nameVi: 'Nông nghiệp và thuỷ sản' },
    ],
  },
  {
    code: 'CONSUMER_DISCRETIONARY',
    name: 'Consumer Discretionary',
    nameVi: 'Hàng tiêu dùng không thiết yếu',
    colorHex: '#be185d',
    sortOrder: 8,
    industries: [
      { code: 'RETAIL', name: 'Retail', nameVi: 'Bán lẻ' },
      { code: 'TEXTILES', name: 'Textiles & Apparel', nameVi: 'Dệt may' },
      { code: 'HOSPITALITY', name: 'Hotels & Leisure', nameVi: 'Khách sạn và giải trí' },
    ],
  },
  {
    code: 'UTILITIES',
    name: 'Utilities',
    nameVi: 'Tiện ích công cộng',
    colorHex: '#0369a1',
    sortOrder: 9,
    industries: [
      { code: 'POWER', name: 'Electric Power', nameVi: 'Điện' },
      { code: 'WATER', name: 'Water & Environment', nameVi: 'Nước và môi trường' },
    ],
  },
  {
    code: 'HEALTH_CARE',
    name: 'Health Care',
    nameVi: 'Chăm sóc sức khoẻ',
    colorHex: '#15803d',
    sortOrder: 10,
    industries: [
      { code: 'PHARMACEUTICALS', name: 'Pharmaceuticals', nameVi: 'Dược phẩm' },
      { code: 'MEDICAL_SERVICES', name: 'Medical Services & Equipment', nameVi: 'Dịch vụ và thiết bị y tế' },
    ],
  },
  {
    code: 'COMMUNICATION_SERVICES',
    name: 'Communication Services',
    nameVi: 'Dịch vụ truyền thông',
    colorHex: '#7c3aed',
    sortOrder: 11,
    industries: [
      { code: 'TELECOM', name: 'Telecommunications', nameVi: 'Viễn thông' },
      { code: 'MEDIA', name: 'Media & Entertainment', nameVi: 'Truyền thông và giải trí' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Danh mục mã chuẩn (§7)
// ---------------------------------------------------------------------------

export interface StockSeed {
  symbol: string;
  companyName: string;
  exchange: Exchange;
  sectorCode: string;
  industryCode: string;
}

const s = (
  symbol: string,
  companyName: string,
  exchange: Exchange,
  sectorCode: string,
  industryCode: string,
): StockSeed => ({ symbol, companyName, exchange, sectorCode, industryCode });

/**
 * RỔ CHỈ SỐ — danh sách, KHÔNG phải cờ trên từng dòng mã.
 *
 * Trước đây `isVn30` là tham số thứ sáu của `s()`, rải trên 29 dòng nằm cách nhau
 * cả trăm dòng. Rổ VN30 thay đổi mỗi kỳ cơ cấu, mà sửa 29 chỗ rải rác thì lần nào
 * cũng sót — và đã sót thật: khi đối chiếu với rổ thật lấy từ VNStock, danh sách cũ
 * **lệch 11 mã** (thừa TPB BVH BCM PLX POW, thiếu BSR LPB MCH TCX VIB VPL). Không ai
 * phát hiện vì một cờ sai trông y hệt một cờ đúng.
 *
 * Tư cách thành viên là thuộc tính của RỔ, không phải của công ty. Để thành danh
 * sách thì mỗi kỳ cơ cấu chỉ phải thay đúng một chỗ, và đối chiếu với nguồn là một
 * phép so hai mảng — xem `npm run check:index`.
 *
 * Hai danh sách dưới đây lấy từ `Listing().symbols_by_group()` của VNStock.
 */
export const VN30_SEED: readonly string[] = [
  'ACB',
  'BID',
  'BSR',
  'CTG',
  'FPT',
  'GAS',
  'GVR',
  'HDB',
  'HPG',
  'LPB',
  'MBB',
  'MCH',
  'MSN',
  'MWG',
  'SAB',
  'SHB',
  'SSB',
  'SSI',
  'STB',
  'TCB',
  'TCX',
  'VCB',
  'VHM',
  'VIB',
  'VIC',
  'VJC',
  'VNM',
  'VPB',
  'VPL',
  'VRE',
];

export const VN100_SEED: readonly string[] = [
  'ACB',
  'ANV',
  'BAF',
  'BCM',
  'BID',
  'BMP',
  'BSI',
  'BSR',
  'BVH',
  'BWE',
  'CII',
  'CMG',
  'CTD',
  'CTG',
  'CTR',
  'CTS',
  'DBC',
  'DCM',
  'DGW',
  'DIG',
  'DPM',
  'DSE',
  'DXG',
  'EIB',
  'EVF',
  'FPT',
  'FRT',
  'FTS',
  'GAS',
  'GEE',
  'GEX',
  'GMD',
  'GVR',
  'HAG',
  'HCM',
  'HDB',
  'HDG',
  'HHV',
  'HPG',
  'HSG',
  'HT1',
  'KBC',
  'KDC',
  'KDH',
  'KOS',
  'LPB',
  'MBB',
  'MCH',
  'MSB',
  'MSN',
  'MWG',
  'NAB',
  'NKG',
  'NLG',
  'NT2',
  'NVL',
  'OCB',
  'PAN',
  'PC1',
  'PDR',
  'PHR',
  'PLX',
  'PNJ',
  'POW',
  'PVD',
  'PVT',
  'REE',
  'SAB',
  'SBT',
  'SHB',
  'SIP',
  'SJS',
  'SSB',
  'SSI',
  'STB',
  'TAL',
  'TCB',
  'TCH',
  'TCX',
  'TPB',
  'VCB',
  'VCG',
  'VCI',
  'VCK',
  'VGC',
  'VHC',
  'VHM',
  'VIB',
  'VIC',
  'VIX',
  'VJC',
  'VND',
  'VNM',
  'VPB',
  'VPI',
  'VPL',
  'VPX',
  'VRE',
  'VSC',
  'VTP',
];

export const STOCK_SEED: readonly StockSeed[] = [
  // --- Ngân hàng ---------------------------------------------------------
  s('VCB', 'Ngân hàng TMCP Ngoại thương Việt Nam', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('BID', 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('CTG', 'Ngân hàng TMCP Công thương Việt Nam', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('TCB', 'Ngân hàng TMCP Kỹ thương Việt Nam', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('MBB', 'Ngân hàng TMCP Quân đội', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('VPB', 'Ngân hàng TMCP Việt Nam Thịnh Vượng', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('ACB', 'Ngân hàng TMCP Á Châu', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('HDB', 'Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('STB', 'Ngân hàng TMCP Sài Gòn Thương Tín', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('TPB', 'Ngân hàng TMCP Tiên Phong', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('VIB', 'Ngân hàng TMCP Quốc tế Việt Nam', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('SHB', 'Ngân hàng TMCP Sài Gòn - Hà Nội', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('SSB', 'Ngân hàng TMCP Đông Nam Á', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('LPB', 'Ngân hàng TMCP Lộc Phát Việt Nam', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('EIB', 'Ngân hàng TMCP Xuất Nhập khẩu Việt Nam', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('MSB', 'Ngân hàng TMCP Hàng hải Việt Nam', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('OCB', 'Ngân hàng TMCP Phương Đông', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),
  s('NAB', 'Ngân hàng TMCP Nam Á', EXCHANGE.HOSE, 'FINANCIALS', 'BANKS'),

  // --- Chứng khoán & bảo hiểm --------------------------------------------
  s('SSI', 'Công ty Cổ phần Chứng khoán SSI', EXCHANGE.HOSE, 'FINANCIALS', 'SECURITIES'),
  s('VND', 'Công ty Cổ phần Chứng khoán VNDIRECT', EXCHANGE.HOSE, 'FINANCIALS', 'SECURITIES'),
  s('VCI', 'Công ty Cổ phần Chứng khoán Vietcap', EXCHANGE.HOSE, 'FINANCIALS', 'SECURITIES'),
  s('HCM', 'Công ty Cổ phần Chứng khoán Thành phố Hồ Chí Minh', EXCHANGE.HOSE, 'FINANCIALS', 'SECURITIES'),
  s('SHS', 'Công ty Cổ phần Chứng khoán Sài Gòn - Hà Nội', EXCHANGE.HNX, 'FINANCIALS', 'SECURITIES'),
  s('BSI', 'Công ty Cổ phần Chứng khoán BIDV', EXCHANGE.HOSE, 'FINANCIALS', 'SECURITIES'),
  s('CTS', 'Công ty Cổ phần Chứng khoán Vietinbank', EXCHANGE.HOSE, 'FINANCIALS', 'SECURITIES'),
  s('DSE', 'Công ty Cổ phần Chứng khoán DNSE', EXCHANGE.HOSE, 'FINANCIALS', 'SECURITIES'),
  s('FTS', 'Công ty Cổ phần Chứng khoán FPT', EXCHANGE.HOSE, 'FINANCIALS', 'SECURITIES'),
  s('TCX', 'Công ty Cổ phần Chứng khoán Kỹ Thương', EXCHANGE.HOSE, 'FINANCIALS', 'SECURITIES'),
  s('VCK', 'Công ty Cổ phần Chứng Khoán VPS', EXCHANGE.HOSE, 'FINANCIALS', 'SECURITIES'),
  s('VIX', 'Công ty Cổ phần Chứng khoán VIX', EXCHANGE.HOSE, 'FINANCIALS', 'SECURITIES'),
  s('VPX', 'Công ty Cổ phần Chứng khoán VPBank', EXCHANGE.HOSE, 'FINANCIALS', 'SECURITIES'),
  s('BVH', 'Tập đoàn Bảo Việt', EXCHANGE.HOSE, 'FINANCIALS', 'INSURANCE'),
  s('EVF', 'Công ty Tài chính Tổng hợp Cổ phần Điện Lực', EXCHANGE.HOSE, 'FINANCIALS', 'FINANCIAL_SERVICES'),

  // --- Bất động sản -------------------------------------------------------
  s('VIC', 'Tập đoàn Vingroup - Công ty Cổ phần', EXCHANGE.HOSE, 'REAL_ESTATE', 'RESIDENTIAL_RE'),
  s('VHM', 'Công ty Cổ phần Vinhomes', EXCHANGE.HOSE, 'REAL_ESTATE', 'RESIDENTIAL_RE'),
  s('VRE', 'Công ty Cổ phần Vincom Retail', EXCHANGE.HOSE, 'REAL_ESTATE', 'RE_SERVICES'),
  s('NVL', 'Công ty Cổ phần Tập đoàn Đầu tư Địa ốc No Va', EXCHANGE.HOSE, 'REAL_ESTATE', 'RESIDENTIAL_RE'),
  s('KDH', 'Công ty Cổ phần Đầu tư và Kinh doanh Nhà Khang Điền', EXCHANGE.HOSE, 'REAL_ESTATE', 'RESIDENTIAL_RE'),
  s('PDR', 'Công ty Cổ phần Phát triển Bất động sản Phát Đạt', EXCHANGE.HOSE, 'REAL_ESTATE', 'RESIDENTIAL_RE'),
  s('DXG', 'Công ty Cổ phần Tập đoàn Đất Xanh', EXCHANGE.HOSE, 'REAL_ESTATE', 'RE_SERVICES'),
  s('NLG', 'Công ty Cổ phần Đầu tư Nam Long', EXCHANGE.HOSE, 'REAL_ESTATE', 'RESIDENTIAL_RE'),
  s('DIG', 'Tổng Công ty Cổ phần Đầu tư Phát triển Xây dựng', EXCHANGE.HOSE, 'REAL_ESTATE', 'RESIDENTIAL_RE'),
  s('HDG', 'Công ty Cổ phần Tập đoàn Hà Đô', EXCHANGE.HOSE, 'REAL_ESTATE', 'RESIDENTIAL_RE'),
  s('KOS', 'Công ty Cổ phần KOSY', EXCHANGE.HOSE, 'REAL_ESTATE', 'RESIDENTIAL_RE'),
  s('SJS', 'Công ty Cổ phần SJ Group', EXCHANGE.HOSE, 'REAL_ESTATE', 'RESIDENTIAL_RE'),
  s('TAL', 'Công Ty Cổ Phần Đầu Tư Bất Động Sản Taseco', EXCHANGE.HOSE, 'REAL_ESTATE', 'RESIDENTIAL_RE'),
  s('TCH', 'Công ty Cổ phần Đầu tư Dịch vụ Tài chính Hoàng Huy', EXCHANGE.HOSE, 'REAL_ESTATE', 'RESIDENTIAL_RE'),
  s('VPI', 'Công ty Cổ phần Phát triển Bất động sản Văn Phú', EXCHANGE.HOSE, 'REAL_ESTATE', 'RESIDENTIAL_RE'),
  s('BCM', 'Tổng Công ty Đầu tư và Phát triển Công nghiệp - CTCP', EXCHANGE.HOSE, 'REAL_ESTATE', 'INDUSTRIAL_RE'),
  s('KBC', 'Tổng Công ty Phát triển Đô thị Kinh Bắc - CTCP', EXCHANGE.HOSE, 'REAL_ESTATE', 'INDUSTRIAL_RE'),
  s('IDC', 'Tổng Công ty IDICO - CTCP', EXCHANGE.HNX, 'REAL_ESTATE', 'INDUSTRIAL_RE'),
  s('SZC', 'Công ty Cổ phần Sonadezi Châu Đức', EXCHANGE.HOSE, 'REAL_ESTATE', 'INDUSTRIAL_RE'),
  s('SIP', 'Công ty Cổ phần Đầu tư Sài Gòn VRG', EXCHANGE.HOSE, 'REAL_ESTATE', 'INDUSTRIAL_RE'),

  // --- Nguyên vật liệu ----------------------------------------------------
  s('HPG', 'Công ty Cổ phần Tập đoàn Hòa Phát', EXCHANGE.HOSE, 'MATERIALS', 'STEEL'),
  s('HSG', 'Công ty Cổ phần Tập đoàn Hoa Sen', EXCHANGE.HOSE, 'MATERIALS', 'STEEL'),
  s('NKG', 'Công ty Cổ phần Thép Nam Kim', EXCHANGE.HOSE, 'MATERIALS', 'STEEL'),
  s('DGC', 'Công ty Cổ phần Tập đoàn Hóa chất Đức Giang', EXCHANGE.HOSE, 'MATERIALS', 'CHEMICALS'),
  s('DCM', 'Công ty Cổ phần Phân bón Dầu khí Cà Mau', EXCHANGE.HOSE, 'MATERIALS', 'CHEMICALS'),
  s('DPM', 'Tổng Công ty Phân bón và Hóa chất Dầu khí - CTCP', EXCHANGE.HOSE, 'MATERIALS', 'CHEMICALS'),
  s('BMP', 'Công ty Cổ phần Nhựa Bình Minh', EXCHANGE.HOSE, 'MATERIALS', 'PLASTICS'),
  s('AAA', 'Công ty Cổ phần Nhựa An Phát Xanh', EXCHANGE.HOSE, 'MATERIALS', 'PLASTICS'),
  s('HT1', 'Công ty Cổ phần Xi măng Vicem Hà Tiên', EXCHANGE.HOSE, 'MATERIALS', 'CEMENT'),
  s('VGC', 'Tổng Công ty Viglacera - Công ty Cổ phần', EXCHANGE.HOSE, 'MATERIALS', 'CEMENT'),
  s('GVR', 'Tập đoàn Công nghiệp Cao su Việt Nam - CTCP', EXCHANGE.HOSE, 'MATERIALS', 'RUBBER'),
  s('PHR', 'Công ty Cổ phần Cao su Phước Hòa', EXCHANGE.HOSE, 'MATERIALS', 'RUBBER'),

  // --- Năng lượng ---------------------------------------------------------
  s('GAS', 'Tổng Công ty Khí Việt Nam - CTCP', EXCHANGE.HOSE, 'ENERGY', 'OIL_GAS'),
  s('PLX', 'Tập đoàn Xăng dầu Việt Nam', EXCHANGE.HOSE, 'ENERGY', 'OIL_GAS'),
  s('BSR', 'Công ty Cổ phần Lọc hóa dầu Bình Sơn', EXCHANGE.HOSE, 'ENERGY', 'OIL_GAS'),
  s('PVS', 'Tổng Công ty Cổ phần Dịch vụ Kỹ thuật Dầu khí Việt Nam', EXCHANGE.HNX, 'ENERGY', 'OIL_GAS_SERVICES'),
  s('PVD', 'Tổng Công ty Cổ phần Khoan và Dịch vụ Khoan Dầu khí', EXCHANGE.HOSE, 'ENERGY', 'OIL_GAS_SERVICES'),

  // --- Công nghệ thông tin -----------------------------------------------
  s('FPT', 'Công ty Cổ phần FPT', EXCHANGE.HOSE, 'INFORMATION_TECHNOLOGY', 'SOFTWARE_IT'),
  s('CMG', 'Công ty Cổ phần Tập đoàn Công nghệ CMC', EXCHANGE.HOSE, 'INFORMATION_TECHNOLOGY', 'SOFTWARE_IT'),
  s('ELC', 'Công ty Cổ phần Công nghệ - Viễn thông Elcom', EXCHANGE.HOSE, 'INFORMATION_TECHNOLOGY', 'TECH_HARDWARE'),

  // --- Công nghiệp --------------------------------------------------------
  s('REE', 'Công ty Cổ phần Cơ điện lạnh', EXCHANGE.HOSE, 'INDUSTRIALS', 'INDUSTRIAL_MACHINERY'),
  s('GEE', 'Công ty Cổ phần Điện lực Gelex', EXCHANGE.HOSE, 'INDUSTRIALS', 'INDUSTRIAL_MACHINERY'),
  s('GEX', 'Công ty Cổ phần Tập đoàn Gelex', EXCHANGE.HOSE, 'INDUSTRIALS', 'INDUSTRIAL_MACHINERY'),
  s('CTD', 'Công ty Cổ phần Xây dựng Coteccons', EXCHANGE.HOSE, 'INDUSTRIALS', 'CONSTRUCTION'),
  s('VCG', 'Tổng Công ty Cổ phần Xuất nhập khẩu và Xây dựng Việt Nam', EXCHANGE.HOSE, 'INDUSTRIALS', 'CONSTRUCTION'),
  s('PC1', 'Công ty Cổ phần Tập đoàn PC1', EXCHANGE.HOSE, 'INDUSTRIALS', 'CONSTRUCTION'),
  s('CII', 'Công ty Cổ phần Đầu tư Hạ tầng Kỹ thuật Thành phố Hồ Chí Minh', EXCHANGE.HOSE, 'INDUSTRIALS', 'CONSTRUCTION'),
  s('HHV', 'Công ty Cổ phần Đầu tư Hạ tầng Giao thông Đèo Cả', EXCHANGE.HOSE, 'INDUSTRIALS', 'CONSTRUCTION'),
  s('VJC', 'Công ty Cổ phần Hàng không Vietjet', EXCHANGE.HOSE, 'INDUSTRIALS', 'AVIATION'),
  s('HVN', 'Tổng Công ty Hàng không Việt Nam - CTCP', EXCHANGE.HOSE, 'INDUSTRIALS', 'AVIATION'),
  s('ACV', 'Tổng Công ty Cảng hàng không Việt Nam - CTCP', EXCHANGE.UPCOM, 'INDUSTRIALS', 'AVIATION'),
  s('GMD', 'Công ty Cổ phần Gemadept', EXCHANGE.HOSE, 'INDUSTRIALS', 'LOGISTICS'),
  s('HAH', 'Công ty Cổ phần Vận tải và Xếp dỡ Hải An', EXCHANGE.HOSE, 'INDUSTRIALS', 'LOGISTICS'),
  s('VTP', 'Tổng Công ty Cổ phần Bưu chính Viettel', EXCHANGE.HOSE, 'INDUSTRIALS', 'LOGISTICS'),
  s('PVT', 'Tổng Công ty Cổ phần Vận tải Dầu khí', EXCHANGE.HOSE, 'INDUSTRIALS', 'LOGISTICS'),
  s('VSC', 'Công ty Cổ phần Container Việt Nam', EXCHANGE.HOSE, 'INDUSTRIALS', 'LOGISTICS'),

  // --- Hàng tiêu dùng thiết yếu ------------------------------------------
  s('VNM', 'Công ty Cổ phần Sữa Việt Nam', EXCHANGE.HOSE, 'CONSUMER_STAPLES', 'FOOD_BEVERAGE'),
  s('MSN', 'Công ty Cổ phần Tập đoàn Masan', EXCHANGE.HOSE, 'CONSUMER_STAPLES', 'FOOD_BEVERAGE'),
  s('SAB', 'Tổng Công ty Cổ phần Bia - Rượu - Nước giải khát Sài Gòn', EXCHANGE.HOSE, 'CONSUMER_STAPLES', 'FOOD_BEVERAGE'),
  s('KDC', 'Công ty Cổ phần Tập đoàn KIDO', EXCHANGE.HOSE, 'CONSUMER_STAPLES', 'FOOD_BEVERAGE'),
  s('QNS', 'Công ty Cổ phần Đường Quảng Ngãi', EXCHANGE.UPCOM, 'CONSUMER_STAPLES', 'FOOD_BEVERAGE'),
  s('MCH', 'Công ty Cổ phần Hàng Tiêu Dùng MaSan', EXCHANGE.HOSE, 'CONSUMER_STAPLES', 'FOOD_BEVERAGE'),
  s('PAN', 'Công ty Cổ phần Tập đoàn PAN', EXCHANGE.HOSE, 'CONSUMER_STAPLES', 'FOOD_BEVERAGE'),
  s('SBT', 'Công ty Cổ phần Thành Thành Công - Biên Hòa', EXCHANGE.HOSE, 'CONSUMER_STAPLES', 'FOOD_BEVERAGE'),
  s('VHC', 'Công ty Cổ phần Vĩnh Hoàn', EXCHANGE.HOSE, 'CONSUMER_STAPLES', 'AGRICULTURE'),
  s('ANV', 'Công ty Cổ phần Nam Việt', EXCHANGE.HOSE, 'CONSUMER_STAPLES', 'AGRICULTURE'),
  s('BAF', 'Công ty Cổ phần Nông nghiệp BAF Việt Nam', EXCHANGE.HOSE, 'CONSUMER_STAPLES', 'AGRICULTURE'),
  s('DBC', 'Công ty Cổ phần Tập đoàn Dabaco Việt Nam', EXCHANGE.HOSE, 'CONSUMER_STAPLES', 'AGRICULTURE'),
  s('HAG', 'Công ty Cổ phần Hoàng Anh Gia Lai', EXCHANGE.HOSE, 'CONSUMER_STAPLES', 'AGRICULTURE'),

  // --- Hàng tiêu dùng không thiết yếu ------------------------------------
  s('MWG', 'Công ty Cổ phần Đầu tư Thế giới Di động', EXCHANGE.HOSE, 'CONSUMER_DISCRETIONARY', 'RETAIL'),
  s('PNJ', 'Công ty Cổ phần Vàng bạc Đá quý Phú Nhuận', EXCHANGE.HOSE, 'CONSUMER_DISCRETIONARY', 'RETAIL'),
  s('FRT', 'Công ty Cổ phần Bán lẻ Kỹ thuật số FPT', EXCHANGE.HOSE, 'CONSUMER_DISCRETIONARY', 'RETAIL'),
  s('DGW', 'Công ty Cổ phần Thế Giới Số', EXCHANGE.HOSE, 'CONSUMER_DISCRETIONARY', 'RETAIL'),
  s('MSH', 'Công ty Cổ phần May Sông Hồng', EXCHANGE.HOSE, 'CONSUMER_DISCRETIONARY', 'TEXTILES'),
  s('VPL', 'Công ty Cổ phần Vinpearl', EXCHANGE.HOSE, 'CONSUMER_DISCRETIONARY', 'HOSPITALITY'),

  // --- Tiện ích -----------------------------------------------------------
  s('POW', 'Tổng Công ty Điện lực Dầu khí Việt Nam - CTCP', EXCHANGE.HOSE, 'UTILITIES', 'POWER'),
  s('NT2', 'Công ty Cổ phần Điện lực Dầu khí Nhơn Trạch 2', EXCHANGE.HOSE, 'UTILITIES', 'POWER'),
  s('GEG', 'Công ty Cổ phần Điện Gia Lai', EXCHANGE.HOSE, 'UTILITIES', 'POWER'),
  s('BWE', 'Công ty Cổ phần Nước - Môi trường Bình Dương', EXCHANGE.HOSE, 'UTILITIES', 'WATER'),

  // --- Chăm sóc sức khoẻ --------------------------------------------------
  s('DHG', 'Công ty Cổ phần Dược Hậu Giang', EXCHANGE.HOSE, 'HEALTH_CARE', 'PHARMACEUTICALS'),
  s('IMP', 'Công ty Cổ phần Dược phẩm Imexpharm', EXCHANGE.HOSE, 'HEALTH_CARE', 'PHARMACEUTICALS'),
  s('DBD', 'Công ty Cổ phần Dược - Trang thiết bị Y tế Bình Định', EXCHANGE.HOSE, 'HEALTH_CARE', 'MEDICAL_SERVICES'),

  // --- Dịch vụ truyền thông ----------------------------------------------
  s('CTR', 'Tổng Công ty Cổ phần Công trình Viettel', EXCHANGE.HOSE, 'COMMUNICATION_SERVICES', 'TELECOM'),
  s('VGI', 'Tổng Công ty Cổ phần Đầu tư Quốc tế Viettel', EXCHANGE.UPCOM, 'COMMUNICATION_SERVICES', 'TELECOM'),
];

// ---------------------------------------------------------------------------
// Ngưỡng rủi ro mặc định (§19)
// ---------------------------------------------------------------------------

export interface RiskRuleSeed {
  code: string;
  name: string;
  nameVi: string;
  scope: string;
  metric: string;
  comparator: string;
  /** Đơn vị theo `metric`: bps, phút, hoặc số đếm */
  threshold: number;
  severity: string;
  description: string;
}

export const RISK_RULE_SEED: readonly RiskRuleSeed[] = [
  {
    code: 'STOCK_CONCENTRATION_10',
    name: 'Single stock weight above 10%',
    nameVi: 'Một mã vượt 10% tỷ trọng danh mục',
    scope: 'STOCK',
    metric: 'WEIGHT_BPS',
    comparator: 'GT',
    threshold: 1_000,
    severity: 'HIGH',
    description: 'Cảnh báo tập trung vào một mã. Ví dụ trong đặc tả: MBB concentration > 10%.',
  },
  {
    code: 'SECTOR_CONCENTRATION_20',
    name: 'Sector exposure above 20%',
    nameVi: 'Một ngành vượt 20% tỷ trọng danh mục',
    scope: 'SECTOR',
    metric: 'WEIGHT_BPS',
    comparator: 'GT',
    threshold: 2_000,
    severity: 'WARNING',
    description: 'Cảnh báo tập trung ngành. Ví dụ trong đặc tả: Banking exposure > 20%.',
  },
  {
    code: 'STRATEGY_CONCENTRATION_40',
    name: 'Strategy allocation above 40%',
    nameVi: 'Một chiến lược vượt 40% tổng phân bổ',
    scope: 'STRATEGY',
    metric: 'WEIGHT_BPS',
    comparator: 'GT',
    threshold: 4_000,
    severity: 'WARNING',
    description: 'Danh mục phụ thuộc quá nhiều vào một chiến lược.',
  },
  {
    code: 'PORTFOLIO_DRAWDOWN_10',
    name: 'Portfolio P&L below -10%',
    nameVi: 'Hiệu suất danh mục giảm quá 10%',
    scope: 'PORTFOLIO',
    metric: 'PNL_BPS',
    comparator: 'LT',
    threshold: -1_000,
    severity: 'CRITICAL',
    description: 'Tổng lời/lỗ của danh mục giảm sâu hơn ngưỡng cho phép.',
  },
  {
    code: 'CASH_BELOW_5',
    name: 'Available cash below 5%',
    nameVi: 'Tiền khả dụng dưới 5% tổng vốn',
    scope: 'PORTFOLIO',
    metric: 'CASH_BPS',
    comparator: 'LT',
    threshold: 500,
    severity: 'WARNING',
    description: 'Không còn dư địa để giải ngân hoặc chịu áp lực rút vốn.',
  },
  {
    code: 'MARKET_DATA_DELAY_15',
    name: 'Market data older than 15 minutes',
    nameVi: 'Dữ liệu thị trường trễ hơn 15 phút',
    scope: 'MARKET_DATA',
    metric: 'DATA_DELAY_MINUTES',
    comparator: 'GT',
    threshold: 15,
    severity: 'HIGH',
    description: 'Nguồn từ VNStock bị trễ hoặc lỗi — Dashboard phải hiện "Market Data Delayed" (§10).',
  },
  {
    code: 'PENDING_APPROVAL_5',
    name: 'More than 5 trades awaiting approval',
    nameVi: 'Có hơn 5 giao dịch đang chờ duyệt',
    scope: 'APPROVAL',
    metric: 'PENDING_COUNT',
    comparator: 'GT',
    threshold: 5,
    severity: 'INFO',
    description: 'Hàng chờ duyệt đang tồn đọng.',
  },
  {
    /*
     * Ngưỡng này khác các ngưỡng trên: nó không đo rủi ro thị trường mà đo CHÍNH
     * ĐỘ TIN CỦA SỐ LIỆU. Một mã đang giữ mà thiếu giá làm Portfolio Value nhỏ
     * hơn thực tế, nên mọi tỷ trọng và mọi ngưỡng tập trung tính từ đó đều lệch.
     *
     * Ngưỡng là 0 với so sánh GT: chỉ cần MỘT mã thiếu giá là đã phải báo. Đây
     * không phải chuyện mức độ — số liệu sai thì sai, không có mức chấp nhận được.
     */
    code: 'MISSING_PRICE_ANY',
    name: 'Held position without a market price',
    nameVi: 'Có mã đang giữ nhưng chưa có giá',
    scope: 'PORTFOLIO',
    metric: 'MISSING_PRICE_COUNT',
    comparator: 'GT',
    threshold: 0,
    severity: 'HIGH',
    description:
      'Vị thế thiếu giá làm Portfolio Value thấp hơn thực tế và mọi tỷ trọng bị lệch theo.',
  },
];

// ---------------------------------------------------------------------------
// Cấu hình hệ thống (§21 Settings)
// ---------------------------------------------------------------------------

export interface SettingSeed {
  key: string;
  value: string;
  valueType: string;
  group: string;
  name: string;
  nameVi: string;
  description: string;
}

export const SETTING_SEED: readonly SettingSeed[] = [
  {
    key: 'trading.default_fee_rate_bps',
    value: '15',
    valueType: 'INT',
    group: 'TRADING',
    name: 'Default brokerage fee rate (bps)',
    nameVi: 'Tỷ lệ phí giao dịch mặc định (bps)',
    description: '15 bps = 0,15% giá trị giao dịch. Dùng để gợi ý phí khi nhập lệnh.',
  },
  {
    key: 'trading.sell_tax_rate_bps',
    value: '10',
    valueType: 'INT',
    group: 'TRADING',
    name: 'Sell transaction tax rate (bps)',
    nameVi: 'Tỷ lệ thuế khi bán (bps)',
    description: '10 bps = 0,10% giá trị bán theo quy định thuế TNCN hiện hành.',
  },
  {
    key: 'trading.require_approval_above_vnd',
    value: '1000000000',
    valueType: 'BIGINT',
    group: 'TRADING',
    name: 'Approval threshold (VND)',
    nameVi: 'Ngưỡng giá trị phải duyệt (VNĐ)',
    description: 'Giao dịch có giá trị vượt ngưỡng này bắt buộc qua bước duyệt.',
  },
  {
    key: 'trading.lot_size',
    value: '100',
    valueType: 'INT',
    group: 'TRADING',
    name: 'Standard lot size',
    nameVi: 'Lô giao dịch chuẩn',
    description: 'Khối lượng lô chẵn trên HOSE. Lệnh lô lẻ sẽ được cảnh báo, không chặn.',
  },
  /*
   * HAI NGƯỠNG, HAI VIỆC KHÁC NHAU — và thứ tự giữa chúng là một bất biến.
   *
   *   refresh_after_minutes = 120   khi nào ĐI LẤY giá mới
   *   stale_after_minutes   = 150   khi nào BÁO ĐỘNG là giá đã cũ
   *
   * Nếu hai số bằng nhau thì đúng lúc trước mỗi lần làm mới, chỉ báo lại nhảy sang
   * "Market Data trễ" — báo động nổ theo nhịp bình thường của hệ thống, và mất luôn
   * khả năng phân biệt "đang chờ tới lượt" với "tiến trình lấy giá đã chết". Báo
   * động nổ thường xuyên là báo động bị bỏ qua.
   *
   * 30 phút chênh lệch = một lượt làm mới bị bỏ lỡ hẳn thì mới báo. Đổi số nào thì
   * `npm run audit:pages` cũng kiểm lại bất biến này, không dựa vào việc ai đó nhớ.
   */
  {
    key: 'market_data.refresh_after_minutes',
    value: '120',
    valueType: 'INT',
    group: 'MARKET_DATA',
    name: 'Refresh quotes after (minutes)',
    nameVi: 'Tự lấy giá mới sau (phút)',
    description:
      'Giá cũ hơn mốc này thì tiến trình nền đi lấy mới. Tính từ lần đồng bộ THÀNH ' +
      'CÔNG gần nhất, bất kể do tiến trình nền hay do người bấm nút "Cập nhật giá" — ' +
      'nên vừa bấm tay xong thì lượt tự động kế tiếp được đẩy lùi, không gọi nguồn ' +
      'hai lần cho cùng một khoảng thời gian. Không áp dụng cho lượt chốt phiên: giá ' +
      'đóng cửa luôn được lấy, dù vừa có lượt trước đó ít phút.',
  },
  {
    key: 'market_data.stale_after_minutes',
    value: '150',
    valueType: 'INT',
    group: 'MARKET_DATA',
    name: 'Mark quotes stale after (minutes)',
    nameVi: 'Đánh dấu giá cũ sau (phút)',
    description:
      'Quá mốc này thì Dashboard hiện "Market Data Delayed". PHẢI đặt cao hơn ' +
      'market_data.refresh_after_minutes, nếu không mỗi khoảng nghỉ giữa hai lần lấy ' +
      'giá đều bị báo trễ. Đánh đổi: đặt càng cao thì tiến trình chết càng lâu mới bị ' +
      'phát hiện.',
  },
  /*
   * ĐÃ BỎ: `market_data.sync_interval_seconds`.
   *
   * Chu kỳ đồng bộ là chuyện TRIỂN KHAI, không phải quy tắc nghiệp vụ — nó thuộc
   * tiến trình Python và được đặt bằng `MARKET_DATA_INTERVAL_SECONDS` trong `.env`.
   *
   * Trước đây tham số này tồn tại ở cả hai nơi nhưng KHÔNG dòng code nào đọc bản
   * trong database. Người sửa nó qua giao diện sẽ thấy không có gì thay đổi — đúng
   * kiểu bẫy tệ nhất: cấu hình trông như có tác dụng mà thực ra không.
   *
   * Nguyên tắc từ đây: mỗi tham số CHỈ có một nơi.
   *   - Quy tắc nghiệp vụ (ngưỡng rủi ro, phí, ngưỡng trễ) → `system_settings`.
   *   - Tham số triển khai (địa chỉ, chu kỳ, kích thước lô)  → `.env`.
   *
   * VÌ SAO `refresh_after_minutes` Ở TRÊN KHÔNG LẶP LẠI CÁI BẪY ĐÓ.
   *
   * Nó không phải "chu kỳ chạy" mà là "giá được phép cũ tới mức nào" — cùng loại
   * với ngưỡng báo trễ, tức là quy tắc nghiệp vụ. Và nó thật sự CÓ tác dụng: tiến
   * trình Python không giữ bản riêng, nó đọc số này từ chính app qua
   * `GET /api/market-data/ingest` (cùng request đã dùng để hỏi danh sách mã, nên
   * không thêm lượt gọi nào). Sửa ở Settings là đổi hành vi ngay ở lượt kế tiếp.
   *
   * `MARKET_DATA_INTERVAL_SECONDS` trong `.env` vẫn còn nhưng đổi nghĩa: nó là chu
   * kỳ tiến trình THỨC DẬY để hỏi "đã cũ chưa", không phải chu kỳ gọi nguồn giá.
   */
  {
    key: 'market_data.benchmark_index',
    value: 'VNINDEX',
    valueType: 'STRING',
    group: 'MARKET_DATA',
    name: 'Benchmark index',
    nameVi: 'Chỉ số tham chiếu',
    description: 'Chỉ số dùng để tính Alpha ở phần Portfolio Performance (§13).',
  },
  /*
   * ĐÃ BỎ: `risk.max_stock_weight_bps` và `risk.max_sector_weight_bps`.
   *
   * Hai tham số này trùng với `STOCK_CONCENTRATION_10` và
   * `SECTOR_CONCENTRATION_20` trong bảng `risk_rules` — cùng một ngưỡng nằm ở
   * hai nơi. Từ Phase 09, Risk Engine là nơi DUY NHẤT đo tỷ trọng, và nó đọc
   * `risk_rules`. Nếu giữ lại bản trong `system_settings` thì Admin sửa nó qua
   * giao diện Settings sẽ thấy cảnh báo không đổi — lặp lại đúng cái bẫy đã gặp
   * với `market_data.sync_interval_seconds` ở trên.
   *
   * `risk_rules` được chọn làm nơi duy nhất vì nó mang đủ thông tin: ngưỡng, mức
   * nghiêm trọng, phép so sánh, bật/tắt, và ghi đè theo từng danh mục hoặc từng
   * mã. `system_settings` chỉ giữ được một con số. Sửa ngưỡng ở trang Risk.
   */
  {
    key: 'general.timezone',
    value: 'Asia/Ho_Chi_Minh',
    valueType: 'STRING',
    group: 'GENERAL',
    name: 'Timezone',
    nameVi: 'Múi giờ',
    description: 'Múi giờ dùng để chốt ngày giao dịch và ảnh chụp cuối ngày.',
  },
  {
    key: 'general.base_currency',
    value: 'VND',
    valueType: 'STRING',
    group: 'GENERAL',
    name: 'Base currency',
    nameVi: 'Đơn vị tiền tệ',
    description: 'Mọi số tiền lưu dưới dạng số nguyên VNĐ.',
  },
];
