/**
 * BIỂU TƯỢNG 2D — SVG nét, vẽ tay, không thư viện.
 *
 * VÌ SAO KHÔNG DÙNG BỘ ICON CÓ SẴN
 *   1. Cùng lý do như biểu đồ: không thêm dependency vào hệ thống quản lý vốn chỉ
 *      để có mười bốn hình.
 *   2. Bộ icon nào cũng nặng hơn phần được dùng rất nhiều lần, và cách tránh điều
 *      đó (tree-shaking, sprite, subset) đều là thêm một bước build.
 *   3. Vài biểu tượng ở đây không tồn tại trong bộ chung: "phân bổ đa chiến lược"
 *      hay "ma trận quyền" là khái niệm của riêng đặc tả này.
 *
 * QUY ƯỚC VẼ — giữ đúng để cả bộ trông như một
 *   - Khung 24×24, nét `stroke`, KHÔNG tô `fill`. Icon tô đặc ở cỡ 16px sẽ thành
 *     một khối mực không đọc được hình.
 *   - Độ dày nét 1.75. Mảnh hơn thì mờ trên màn hình thường; dày hơn thì bít.
 *   - `stroke="currentColor"`: icon lấy màu từ chữ bên cạnh, nên tự đúng ở cả hai
 *     chế độ sáng/tối và tự sáng lên khi mục menu đang được chọn. Không hardcode
 *     màu nào.
 *   - `strokeLinecap="round"`, `strokeLinejoin="round"` — đầu nét tròn khớp với
 *     các dấu vẽ trong biểu đồ (xem components/charts.tsx).
 *   - `aria-hidden`: icon ở đây luôn đi kèm nhãn chữ, nên với trình đọc màn hình
 *     nó là trang trí. Đọc thêm "hình biểu đồ cột" trước chữ "Dashboard" chỉ làm
 *     nhiễu.
 *
 * Vẽ trên lưới 24 với lề 3–4px: mọi hình nằm gọn trong 16–18px ở giữa nên khi xếp
 * cạnh nhau trọng lượng thị giác đều nhau, không cái nào trông to hơn cái khác.
 */

export type IconName =
  | 'dashboard'
  | 'portfolio'
  | 'transactions'
  | 'strategies'
  | 'market'
  | 'risk'
  | 'teams'
  | 'members'
  | 'approvals'
  | 'reports'
  | 'audit'
  | 'settings'
  | 'userCheck'
  | 'permissions'
  // --- Dành riêng cho ô KPI: mỗi ô một hình nói đúng đại lượng của nó ---
  | 'trendUp'
  | 'trendDown'
  | 'pie'
  | 'wallet'
  | 'shield';

function Svg({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-[18px] shrink-0 ${className}`}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Bốn ô — tổng quan nhiều khối cùng lúc. */
const dashboard = (
  <>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </>
);

/** Cặp — danh mục tài sản. */
const portfolio = (
  <>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
    <path d="M3 12h18" />
  </>
);

/** Hai mũi tên ngược chiều — mua và bán. */
const transactions = (
  <>
    <path d="M7 4v16" />
    <path d="M4 7l3-3 3 3" />
    <path d="M17 20V4" />
    <path d="M20 17l-3 3-3-3" />
  </>
);

/**
 * Vòng đồng tâm có tâm ngắm — chiến lược.
 *
 * Không dùng biểu tượng bóng đèn hay ngọn cờ: chiến lược ở đây là PHÂN BỔ VỐN có
 * chủ đích, không phải một ý tưởng. Vòng đồng tâm nói đúng nghĩa "nhắm vào đâu".
 */
const strategies = (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" />
  </>
);

/** Nến giá — thị trường. */
const market = (
  <>
    <path d="M6.5 4v3.5M6.5 16.5V20" />
    <rect x="4.5" y="7.5" width="4" height="9" rx="1" />
    <path d="M17.5 4v6.5M17.5 17.5V20" />
    <rect x="15.5" y="10.5" width="4" height="7" rx="1" />
  </>
);

/** Khiên có dấu chấm than — rủi ro cần để ý, không phải rủi ro đã xảy ra. */
const risk = (
  <>
    <path d="M12 3.5l7 2.5v6c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V6l7-2.5Z" />
    <path d="M12 9v3.5" />
    <path d="M12 15.5h.01" />
  </>
);

/** Ba người — nhóm. */
const teams = (
  <>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16.5 6.2a3 3 0 0 1 0 5.6" />
    <path d="M18 14.8c1.7.7 2.9 2.3 2.9 4.7" />
  </>
);

/** Một người — thành viên. */
const members = (
  <>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.3 3.1-6 7-6s7 2.7 7 6" />
  </>
);

/** Kẹp giấy có dấu tích — hàng chờ duyệt. */
const approvals = (
  <>
    <path d="M9 4.5H7.5A1.5 1.5 0 0 0 6 6v13a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V6a1.5 1.5 0 0 0-1.5-1.5H15" />
    <rect x="9" y="3" width="6" height="3.5" rx="1" />
    <path d="M9.5 13l2 2 3.5-4" />
  </>
);

/** Trang có cột số — báo cáo. */
const reports = (
  <>
    <path d="M6 3.5h8L18.5 8v12.5A1 1 0 0 1 17.5 21H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
    <path d="M13.5 3.5V8h5" />
    <path d="M8.5 16.5V13M12 16.5v-5.5M15.5 16.5v-2" />
  </>
);

/** Danh sách kèm đồng hồ — nhật ký theo thời gian. */
const audit = (
  <>
    <path d="M4.5 6h9M4.5 10.5h6M4.5 15h5" />
    <circle cx="16.5" cy="15" r="4.5" />
    <path d="M16.5 13.2V15l1.4 1" />
  </>
);

/** Ba thanh trượt — cấu hình. Rõ hơn bánh răng ở cỡ nhỏ. */
const settings = (
  <>
    <path d="M4 7h16M4 12h16M4 17h16" />
    <circle cx="9" cy="7" r="1.9" />
    <circle cx="15.5" cy="12" r="1.9" />
    <circle cx="7.5" cy="17" r="1.9" />
  </>
);

/** Người kèm dấu tích — duyệt tài khoản. */
const userCheck = (
  <>
    <circle cx="10" cy="8" r="3.5" />
    <path d="M3.5 20c0-3.3 2.9-6 6.5-6 1 0 2 .2 2.8.6" />
    <path d="M15 17l1.8 1.8L21 14.5" />
  </>
);

/** Lưới có ô đánh dấu — ma trận quyền. */
const permissions = (
  <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
    <path d="M3.5 9.5h17M3.5 15h17M9.5 3.5v17" />
    <path d="M12.6 12.4l1.2 1.2 2.3-2.4" />
  </>
);

/*
 * NĂM HÌNH DÀNH RIÊNG CHO Ô KPI.
 *
 * Ô KPI cần hình nói đúng ĐẠI LƯỢNG, không phải hình của mục menu tương ứng. Trước
 * đây "Total P&L" dùng lại icon khiên của menu Risk — đọc thành "rủi ro" thay vì
 * "lời lỗ". Mỗi ô một hình riêng thì mắt nhận ra ô nào chỉ bằng hình, không phải
 * đọc nhãn.
 */

/** Đường đi lên — giá trị đang tăng. */
const trendUp = (
  <>
    <path d="M3.5 16.5l5-5 3.5 3.5 6-6.5" />
    <path d="M14.5 8h4v4" />
  </>
);

/** Đường đi xuống — dùng cho Alpha âm và các đại lượng có thể xấu. */
const trendDown = (
  <>
    <path d="M3.5 7.5l5 5 3.5-3.5 6 6.5" />
    <path d="M14.5 16h4v-4" />
  </>
);

/** Bánh có một phần tách ra — phần trên tổng thể. */
const pie = (
  <>
    <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12V3.5Z" />
    <path d="M14.5 2.6A9.4 9.4 0 0 1 21.4 9.5H14.5V2.6Z" />
  </>
);

/** Ví — tiền khả dụng. */
const wallet = (
  <>
    <rect x="3" y="6" width="18" height="13" rx="2.5" />
    <path d="M3 10.5h18" />
    <path d="M16.5 15h1.5" />
  </>
);

/** Khiên trơn — vốn được bảo toàn. Khác icon Risk vì không có dấu chấm than. */
const shield = <path d="M12 3.5l7 2.5v6c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5V6l7-2.5Z" />;

const GLYPHS: Record<IconName, React.ReactNode> = {
  dashboard,
  portfolio,
  transactions,
  strategies,
  market,
  risk,
  teams,
  members,
  approvals,
  reports,
  audit,
  settings,
  userCheck,
  permissions,
  trendUp,
  trendDown,
  pie,
  wallet,
  shield,
};

/**
 * Một biểu tượng theo tên.
 *
 * Truyền TÊN chứ không truyền sẵn phần tử JSX: bảng menu nằm ở Server Component
 * còn `NavItem` là Client Component, và một chuỗi thì luôn đi qua ranh giới đó an
 * toàn. Tránh phải suy nghĩ về việc React serialize phần tử ra sao mỗi lần đọc
 * lại đoạn code này.
 */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <Svg className={className}>{GLYPHS[name]}</Svg>;
}
