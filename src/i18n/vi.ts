/**
 * BẢN TIẾNG VIỆT — VÀ LÀ BẢN GỐC ĐỊNH NGHĨA KHOÁ.
 *
 * `type Dict = typeof vi`, còn `en.ts` khai `const en: Dict`. Nhờ vậy thiếu một khoá
 * trong bản tiếng Anh là LỖI BIÊN DỊCH, không phải một chuỗi rỗng lặng lẽ hiện lên
 * màn hình người dùng. Câu hỏi "đã dịch hết chưa" trở thành câu `npm run typecheck`
 * trả lời được.
 *
 * KHOÁ ĐẶT THEO NƠI DÙNG, không đặt theo nội dung tiếng Việt. `nav.dashboard` chứ
 * không phải `bangDieuKhien`: nội dung sẽ đổi, còn chỗ dùng thì không.
 *
 * KHÔNG NHÉT CÂU VÀO MỘT KHOÁ RỒI GHÉP CHUỖI. Tiếng Việt và tiếng Anh khác trật tự
 * từ, nên "3 nhóm" ghép từ `${n} ${t.nhom}` sẽ ra "3 group" thay vì "3 groups". Chỗ
 * nào có số thì viết hàm nhận tham số (xem `dashboard.viTheCount`).
 */

/*
 * KHÔNG dùng `as const` ở đây. Nó biến mỗi chuỗi thành một kiểu literal, và khi đó
 * `en` phải mang ĐÚNG chuỗi tiếng Việt mới hợp kiểu — tức là cấm luôn việc dịch.
 * Thứ cần khoá lại là TẬP KHOÁ, không phải nội dung.
 */
export const vi = {
  // -------------------------------------------------------------------------
  // Điều hướng
  // -------------------------------------------------------------------------
  nav: {
    dashboard: 'Bảng điều khiển',
    portfolio: 'Danh mục',
    overview: 'Tổng quan',
    positions: 'Vị thế',
    allocation: 'Phân bổ',
    transactions: 'Giao dịch',
    allTransactions: 'Tất cả giao dịch',
    buy: 'Mua',
    sell: 'Bán',
    dividend: 'Cổ tức',
    strategies: 'Chiến lược',
    market: 'Thị trường',
    sectors: 'Ngành',
    marketData: 'Dữ liệu thị trường',
    risk: 'Rủi ro',
    teams: 'Nhóm',
    members: 'Thành viên',
    approvals: 'Duyệt',
    reports: 'Báo cáo',
    auditLog: 'Nhật ký',
    settings: 'Cài đặt',
    adminSection: 'QUẢN TRỊ',
    organization: 'Cơ cấu tổ chức',
    manageStrategies: 'Quản lý chiến lược',
    usersApprovals: 'Duyệt & Người dùng',
    permissionMatrix: 'Ma trận quyền',
    logout: 'Đăng xuất',
    priceSession: (ngay: string) => `Giá phiên ${ngay}`,
  },

  // -------------------------------------------------------------------------
  // Ô KPI trên Dashboard
  // -------------------------------------------------------------------------
  kpi: {
    portfolioValue: 'Giá trị danh mục',
    portfolioValueSub: 'vị thế + tiền',
    investedCapital: 'Vốn đang đầu tư',
    availableCash: 'Tiền khả dụng',
    teamCash: 'Tiền của nhóm',
    totalPnl: 'Tổng lãi/lỗ',
    alphaVs: (chiSo: string) => `Alpha so với ${chiSo}`,
    ofPortfolio: (pct: string) => `${pct} danh mục`,
    onCost: (pct: string) => `${pct} trên giá vốn`,
    holdingReserve: (tien: string) => `giữ ${tien} quỹ dự phòng`,
    notFiltered: 'không theo bộ lọc',
    noCapitalYet: 'chưa bỏ vốn',
    settled: (tien: string) => `chốt ${tien}`,
    // --- Nhãn khi đang lọc: hai ô đầu đổi ý nghĩa, xem chú thích trong page ---
    positionValue: 'Giá trị vị thế',
    cost: 'Giá vốn',
    notIncludingCash: 'chưa gồm tiền',
    spentOnHeld: 'đã bỏ ra cho phần đang giữ',
    noGrantYet: 'chưa cấp vốn riêng',
    remainingOfGrant: (pct: string) => `còn ${pct} vốn được cấp`,

    // --- Chú thích ⓘ ---
    hintValueFiltered: (pv: string, tienONhom: boolean) =>
      `Chỉ giá trị thị trường của vị thế trong phạm vi đang lọc (${pv}), KHÔNG cộng tiền. ` +
      (tienONhom
        ? 'Tiền của nhóm nằm ở ô bên phải và là con số riêng của nhóm.'
        : 'Tiền nằm ở ô Tiền khả dụng và là của toàn danh mục — lọc theo ngành hay chiến lược không chia được tiền.'),
    hintValueWhole: 'Giá trị thị trường của vị thế cộng số dư tiền (§12). ',
    hintWindow: (n: number, tu: string, den: string, khoang: string) =>
      ` Mức thay đổi dựng lại từ giá đóng cửa ${n} phiên, từ ${tu} đến ${den} — khoảng bạn chọn (${khoang}) có thể dài hơn phần đang có dữ liệu giá.`,
    hintNoStrategySeries:
      ' Không hiện mức thay đổi theo thời gian khi lọc theo chiến lược: chuỗi theo phiên cần nhân tiền theo tỷ lệ phân bổ của từng lệnh (§16) nên chưa dựng được cho một chiến lược riêng. Bỏ bộ lọc chiến lược để xem lại.',
    hintNoSeries: ' Chưa có đủ dữ liệu giá theo phiên để đo mức thay đổi theo thời gian.',

    hintCostFiltered: (pv: string) =>
      `Số tiền đã bỏ ra cho phần vị thế đang giữ trong phạm vi đang lọc (${pv}) — gồm cả phí và thuế. Ô bên trái là giá trị thị trường của cùng phần đó; hiệu của hai ô là lãi/lỗ chưa thực hiện.`,
    hintInvestedWhole: 'Giá trị thị trường của các vị thế đang giữ.',

    hintCash: 'Số dư tiền TRỪ quỹ dự phòng — không phải số dư tiền (§14).',
    hintCashNotFiltered:
      ' Lọc theo ngành hay chiến lược không đổi được con số này: vốn được cấp cho nhóm, không cấp cho ngành.',
    hintTeamNoGrant: (daRut: string) =>
      `Nhóm này CHƯA được cấp dòng vốn riêng nào, nên chưa có "tiền của nhóm" để hiển thị. Nhóm đang dùng quỹ chung, và tới nay đã rút ròng ${daRut} từ đó. Gắn nhóm cho dòng vốn (capital_flows.teamId) để con số này có nghĩa.`,
    hintTeamCash: (cap: string, daDung: string) =>
      `Vốn được cấp riêng cho nhóm trừ đi phần nhóm đã dùng: cấp ${cap}, đã dùng ròng ${daDung}. KHÔNG trừ quỹ dự phòng — đó là khoản của cả danh mục, trừ cho từng nhóm là trừ bốn lần.`,

    hintPnl: 'Lãi/lỗ đã thực hiện cộng chưa thực hiện, tính trên giá vốn đã bỏ ra.',
    hintPnlNoCost:
      ' Chưa giữ vị thế nào nên không có giá vốn để chia — tỷ suất là “—”, không phải 0%.',

    hintAlpha: (khoang: string) =>
      `Hơn/kém thị trường trên CÙNG khoảng ${khoang}. Lãi 5% khi chỉ số tăng 8% là kết quả kém.`,
    hintAlphaNoStrategy:
      'Chưa đo được cho một chiến lược riêng: chuỗi theo phiên cần nhân tiền theo tỷ lệ phân bổ của từng lệnh (§16). Hiện Alpha của toàn danh mục ở đây sẽ bị đọc thành Alpha của chiến lược.',
    alphaNotForStrategy: 'không áp được cho chiến lược riêng',
    alphaSub: (dm: string, ma: string, cs: string) => `danh mục ${dm} · ${ma} ${cs}`,

    // --- Bốn lý do chưa có Alpha ---
    alphaNoPositions: 'chưa có vị thế nào',
    alphaNoPositionsHint:
      'Chưa đo được vì danh mục chưa có vị thế nào để dựng chuỗi theo phiên. ' +
      'Dữ liệu chỉ số không thiếu — nhập lệnh xong con số này sẽ tự hiện.',
    alphaNoPriceHistory: 'thiếu lịch sử giá từ ngày mua',
    alphaNoPriceHistoryHint:
      'Danh mục CÓ vị thế nhưng chưa dựng được chuỗi theo phiên: bảng giá lịch sử ' +
      'chưa có phiên nào kể từ ngày mua. Chạy đồng bộ dữ liệu thị trường để nạp ' +
      'giá của những phiên còn thiếu.',
    alphaNoBenchmark: (ma: string) => `thiếu chuỗi ${ma}`,
    alphaNoBenchmarkHint: (ma: string) =>
      `Chưa đo được vì không có dữ liệu ${ma} trong khoảng này. ` +
      'Chạy đồng bộ dữ liệu thị trường để nạp lịch sử chỉ số.',
    alphaMismatch: 'hai vế lệch khoảng thời gian',
    alphaMismatchHint:
      'Chưa đo được: hiệu suất danh mục và mức tăng chỉ số hiện không cùng một ' +
      'khoảng thời gian, nên hiệu của chúng không có nghĩa.',

    fromSessions: (tu: string, n: number) => `từ ${tu} · ${n} phiên`,
    unsettled: (tien: string) => `chưa ${tien}`,
  },

  // -------------------------------------------------------------------------
  // Bộ lọc trên Dashboard
  // -------------------------------------------------------------------------
  filter: {
    portfolio: 'Danh mục',
    team: 'Nhóm',
    strategy: 'Chiến lược',
    sector: 'Ngành',
    period: 'Thời gian',
    all: 'Tất cả',
  },

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------
  period: {
    '1W': '1 tuần',
    '1M': '1 tháng',
    '3M': '3 tháng',
    '6M': '6 tháng',
    YTD: 'Từ đầu năm',
    ALL: 'Toàn bộ',
  },

  dash: {
    noPortfolio: 'Chưa có danh mục nào',
    noPortfolioHint: 'Chạy npm run db:seed để khởi tạo danh mục mặc định.',
    positionCount: (n: number) => `${n} vị thế`,
    scopeTeam: (ten: string) => `phạm vi nhóm ${ten}`,
    noTeam: 'chưa gán',
    filtering: (ds: string) => `đang lọc: ${ds}`,

    pendingTrades: (n: number) => `${n} giao dịch`,
    pendingWithdrawals: (n: number) => `${n} yêu cầu rút vốn`,
    pendingUsers: (n: number) => `${n} tài khoản`,
    awaitingApproval: 'đang chờ duyệt',
    and: ' và ',
    viewQueue: 'Xem bảng chờ',

    teamPnlTitle: 'Vốn & lãi/lỗ theo nhóm',
    teamPnlSub: 'Mỗi nhóm tính từ đúng chuỗi giao dịch của nhóm đó',
    deployedCapital: 'Vốn đang triển khai',
    pnlOnCost: 'Lãi/lỗ trên giá vốn',
    colTeam: 'Nhóm',
    colRealized: 'Đã chốt',
    colUnrealized: 'Chưa chốt',
    colOrders: 'Lệnh',
    colSymbols: 'Mã',
    unassigned: 'chưa gán',
    unassignedTitle: 'Lệnh chưa được gán nhóm — vẫn tính vào danh mục',
    unassignedNote:
      '“Chưa gán” là lệnh có người thực hiện không thuộc nhóm nào — ví dụ Admin nhập hộ. ' +
      'Cộng cả dòng này thì tổng theo nhóm bằng đúng toàn danh mục. Gán nhóm ở ',
    usersLink: 'Duyệt & Người dùng',

    noPositions: 'Chưa có vị thế nào.',
    noHoldings: 'Chưa giữ mã nào.',
    noTrades: 'Chưa có giao dịch nào.',
    sectorCenter: 'ngành',
    strategyCenter: 'chiến lược',

    sectorExposure: 'Tỷ trọng ngành',
    riskAlerts: 'Rủi ro & Cảnh báo',
    strategyAllocation: 'Phân bổ theo chiến lược',
    top10Title: 'Top 10 mã nắm giữ nhiều nhất',
    colValue: 'Giá trị',

    ibTitle: 'Tài khoản & vốn theo IB',
    ibSub: (n: number) => `${n} tài khoản · vốn nạp ròng đã xác nhận`,
    ibNoPermission: 'Bạn không có quyền xem dữ liệu vốn.',
    ibNoAccounts: 'Chưa có tài khoản chứng khoán nào',
    ibInScope: ' trong phạm vi đang xem',
    ibDeclareAt: '. Thành viên tự khai ở ',
    myAccounts: 'Tài khoản của tôi',
    ibTotalVia: (n: number) => ` qua ${n} đầu mối · nạp trừ rút, chỉ tính dòng vốn đã xác nhận.`,
    ibClosed: (n: number) =>
      ` ${n} tài khoản đã đóng vẫn được tính — lịch sử nạp vốn giữ nguyên.`,
    ibDirect: 'Không qua IB',
    ibOther: (n: number) => `Khác (${n} đầu mối)`,

    noAlerts: 'Không có cảnh báo nào',
    acknowledged: ' · đã tiếp nhận',
    openAlerts: (n: number) => `${n} cảnh báo đang mở`,

    recentActivity: 'Hoạt động gần đây',
    recentTrades: 'Giao dịch gần nhất',
    viewAllTrades: 'Xem tất cả giao dịch',
    colTime: 'Thời gian',
    colType: 'Loại',
    colStock: 'Mã CK',
    colStrategy: 'Chiến lược',
    colStatus: 'Trạng thái',

    topMembers: 'Thành viên lợi nhuận cao nhất',
    topMembersSub: 'Sắp theo lãi/lỗ; mỗi người tính từ chuỗi lệnh của chính họ',
    viewAllMembers: 'Xem tất cả thành viên',
    noMembers: 'Chưa có ai phát sinh giao dịch trong phạm vi đang chọn.',
    moreMembers: (n: number) => `Còn ${n} người nữa — `,
    fullList: 'xem danh sách đầy đủ',
    memberCount: (n: number) => `${n} người`,
    orderCount: (n: number) => `${n} lệnh`,

    teamLocked: (ten: string) =>
      `Bạn chỉ xem được nhóm ${ten} — cần quyền position.view_all để chọn nhóm khác`,
    ibTotalPrefix: 'Tổng ',
    alertAgo: ' · đã ',
    footerNote:
      'Mọi con số trên trang này được tính từ giao dịch, giá thị trường và dòng vốn — ' +
      'không có bảng nào lưu sẵn P&L. Lãi/lỗ đã thực hiện ',
    footerUnrealized: ' · chưa thực hiện ',
  },
  // -------------------------------------------------------------------------
  // Dùng chung
  // -------------------------------------------------------------------------
  page: {
    portfolioOverview: 'Tổng quan danh mục',
    topPositions: 'Vị thế lớn nhất',
    capitalAllocation: 'Phân bổ nguồn vốn',
    lastUpdated: 'Cập nhật lần cuối',
    dataStatus: 'Tình trạng dữ liệu',
    before: 'TRƯỚC',
    after: 'SAU',
    next: 'Sau →',
    prev: '← Trước',
  },

  common: {
    details: 'Chi tiết',
    viewAll: 'Xem tất cả',
    save: 'Lưu',
    cancel: 'Huỷ',
    close: 'Đóng',
    edit: 'Sửa',
    confirm: 'Xác nhận',
    saving: 'Đang lưu…',
    noData: 'Chưa có dữ liệu',
    symbol: 'Mã',
    sector: 'Ngành',
    quantity: 'Khối lượng',
    avgCost: 'Giá vốn TB',
    currentPrice: 'Giá hiện tại',
    cost: 'Giá vốn',
    marketValue: 'Giá trị TT',
    pnl: 'Lãi/lỗ',
    pricePnl: 'Lãi/lỗ giá',
    dividend: 'Cổ tức',
    total: 'Tổng',
    ret: 'Sinh lời',
    retPct: 'Sinh lời %',
    weight: 'Tỷ trọng',
  },
};

/** Hình dạng bắt buộc của mọi bản dịch. Xem chú thích đầu file. */
export type Dict = typeof vi;
