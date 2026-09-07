import 'server-only';

/**
 * TỆP TỔNG ĐỂ LƯU TRỮ (§20) — một workbook Excel nhiều sheet.
 *
 * MỤC ĐÍCH LÀ SAO LƯU, không phải để đọc cho vui. Vì vậy tệp gồm hai phần:
 *
 *   SỐ LIỆU     đúng 9 báo cáo đang có ở trang Reports, mỗi cái một sheet.
 *   MASTER DATA mã chứng khoán, ngành, chiến lược, người dùng, nhóm, ngưỡng rủi
 *               ro, cấu hình, danh mục — những bảng mà nếu mất thì số liệu ở
 *               trên trở thành một mớ id không đọc được.
 *
 * Cộng thêm một sheet "Thông tin xuất" ghi ai xuất, lúc nào, khoảng ngày nào, và
 * mỗi sheet bao nhiêu dòng. Không có nó thì mở tệp ra sau một năm không biết nó
 * chụp thời điểm nào.
 *
 * DÙNG LẠI `buildReport()` CHO 9 SHEET SỐ LIỆU, không viết truy vấn mới. Đây là
 * điểm quan trọng nhất của tệp này: nếu tệp tổng có đường tính riêng thì sớm muộn
 * nó sẽ lệch với CSV tải lẻ, và lúc đó không ai biết bản nào đúng. Một nguồn duy
 * nhất, hai định dạng đầu ra.
 *
 * VÌ SAO DÙNG `write-excel-file` MÀ KHÔNG PHẢI `exceljs`: 1,8 MB so với 21,8 MB,
 * một phụ thuộc thay vì chín, và nó CHỈ ghi — đúng việc cần. Bản `xlsx` trên npm
 * đứng ở 0.18.5 đã lâu kèm cảnh báo bảo mật nên bị loại.
 */

import writeXlsxFile, { type Sheet } from 'write-excel-file/node';
import { prisma } from '@/lib/prisma';
import { REPORTS } from '@/reports/catalog';
import { buildReport, type ReportParams } from '@/reports/build';
import type { CsvCell } from '@/reports/csv';
import type { AuthUser } from '@/auth/guards';
import { csvDateTime } from '@/reports/csv';

/** Giới hạn cứng của Excel cho tên sheet. */
const SHEET_NAME_MAX = 31;

/**
 * Ngưỡng an toàn khi đổi `bigint` sang `number` của JavaScript.
 *
 * Trên ngưỡng này phép chuyển mất chính xác ÂM THẦM — đúng thứ tuyệt đối không
 * được xảy ra với số tiền. Vượt ngưỡng thì ghi thành CHỮ: người đọc thấy con số
 * đầy đủ và Excel không cộng được nó, thay vì cộng được một con số sai.
 *
 * 2^53−1 ≈ 9×10¹⁵ đồng, tức chín triệu tỷ — không danh mục nào tới đó, nhưng chốt
 * chặn rẻ hơn là tin vào giả định.
 */
const SAFE_INT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Tên sheet hợp lệ của Excel.
 *
 * Excel từ chối mở tệp nếu tên sheet chứa `\ / ? * [ ] :` hoặc dài hơn 31 ký tự,
 * hoặc hai sheet trùng tên. Cắt và thay ký tự ở đây, rồi thêm hậu tố số khi trùng.
 */
function sheetName(raw: string, used: Set<string>): string {
  let name = raw.replace(/[\\/?*[\]:]/g, '-').slice(0, SHEET_NAME_MAX).trim();
  if (name.length === 0) name = 'Sheet';

  if (used.has(name)) {
    let n = 2;
    // Chừa chỗ cho hậu tố để tổng độ dài không vượt 31.
    const base = name.slice(0, SHEET_NAME_MAX - 3);
    while (used.has(`${base} ${n}`)) n += 1;
    name = `${base} ${n}`;
  }

  used.add(name);
  return name;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

type XlsxCell = { value: string | number | Date | null; type?: unknown; format?: string } | null;

/**
 * Ô CSV → ô Excel CÓ KIỂU.
 *
 * Đây là điểm khác biệt thật giữa hai định dạng. CSV thì mọi thứ là chữ; Excel
 * phân biệt số, ngày và chữ, và chỉ ô SỐ mới cộng được. Một cột "tiền" ở dạng chữ
 * là cột không dùng được — kéo SUM ra 0.
 *
 * Định dạng số suy từ TÊN CỘT, vì các builder đã theo một quy ước sẵn:
 * `*_vnd` là tiền, `*_pct` là phần trăm, `*_at` và `*date*` là thời điểm.
 */
function toCell(value: CsvCell, header: string): XlsxCell {
  if (value === null || value === undefined) return null;

  const money = header.endsWith('_vnd');
  const percent = header.endsWith('_pct');

  if (typeof value === 'bigint') {
    if (value > SAFE_INT || value < -SAFE_INT) {
      return { value: value.toString(), type: String };
    }
    return { value: Number(value), type: Number, format: money ? '#,##0' : '0' };
  }

  if (typeof value === 'number') {
    return { value, type: Number, format: money ? '#,##0' : percent ? '0.00' : undefined };
  }

  /*
   * Bỏ dấu nháy đơn mà `toCsv()` thêm vào để chống CSV injection.
   *
   * Ở CSV, ô bắt đầu bằng `=` bị Excel coi là công thức nên phải thêm nháy. Ở đây
   * ta ghi ô với `type: String` tường minh, nên Excel lưu nó là chuỗi và không
   * bao giờ diễn giải thành công thức — dấu nháy trở thành rác hiện ra trước mắt
   * người đọc.
   */
  const text = value.startsWith("'") ? value.slice(1) : value;

  if (ISO_DATETIME.test(text)) {
    // Chuỗi từ `csvDateTime()` đã là giờ Việt Nam; đọc dạng UTC để Excel không
    // dịch múi giờ thêm một lần nữa.
    return { value: new Date(`${text.replace(' ', 'T')}Z`), type: Date, format: 'dd/mm/yyyy hh:mm' };
  }
  if (ISO_DATE.test(text)) {
    return { value: new Date(`${text}T00:00:00Z`), type: Date, format: 'dd/mm/yyyy' };
  }
  if (NUMERIC.test(text)) {
    return {
      value: Number(text),
      type: Number,
      format: money ? '#,##0' : percent ? '0.00' : undefined,
    };
  }

  return { value: text, type: String };
}

/** Hàng tiêu đề: in đậm, có nền, và được ghim khi cuộn. */
function headerRow(headers: readonly string[]) {
  return headers.map((h) => ({
    value: h,
    type: String,
    fontWeight: 'bold' as const,
    backgroundColor: '#EFF2F6',
    align: 'left' as const,
  }));
}

function toSheet(name: string, headers: readonly string[], rows: readonly CsvCell[][]) {
  return {
    sheet: name,
    // Ghim hàng tiêu đề: bảng vài nghìn dòng mà không ghim thì cuộn xuống là mất
    // tên cột, và người đọc phải đếm cột bằng tay.
    stickyRowsCount: 1,
    columns: headers.map((h) => ({ width: Math.min(34, Math.max(11, h.length + 4)) })),
    data: [headerRow(headers), ...rows.map((r) => r.map((c, i) => toCell(c, headers[i] ?? '')))],
  };
}

// ---------------------------------------------------------------------------
// Master data — phần làm cho tệp này KHÔI PHỤC ĐƯỢC
// ---------------------------------------------------------------------------

interface RawSheet {
  name: string;
  headers: readonly string[];
  rows: CsvCell[][];
}

/**
 * Các bảng master data.
 *
 * Không lọc theo khoảng ngày: đây là danh mục dùng chung, không phải sự kiện theo
 * thời gian. Xuất một tệp "tháng 3" mà thiếu bảng mã chứng khoán thì phần số liệu
 * tháng 3 không giải mã được.
 */
async function masterDataSheets(): Promise<RawSheet[]> {
  const [stocks, sectors, strategies, users, teams, departments, riskRules, settings, portfolios] =
    await Promise.all([
      prisma.stock.findMany({
        orderBy: { symbol: 'asc' },
        select: {
          symbol: true,
          companyName: true,
          companyNameVi: true,
          exchange: true,
          status: true,
          isVn30: true,
          listedShares: true,
          sector: { select: { code: true, nameVi: true } },
          industry: { select: { code: true, nameVi: true } },
        },
      }),
      prisma.sector.findMany({
        orderBy: { sortOrder: 'asc' },
        select: {
          code: true,
          name: true,
          nameVi: true,
          sortOrder: true,
          colorHex: true,
          industries: { select: { code: true, nameVi: true }, orderBy: { code: 'asc' } },
        },
      }),
      prisma.strategy.findMany({
        orderBy: { sortOrder: 'asc' },
        select: {
          code: true,
          name: true,
          nameVi: true,
          description: true,
          sortOrder: true,
          maxAllocationBps: true,
          isActive: true,
        },
      }),
      prisma.user.findMany({
        orderBy: { fullName: 'asc' },
        select: {
          email: true,
          fullName: true,
          employeeCode: true,
          status: true,
          mustChangePassword: true,
          lastLoginAt: true,
          createdAt: true,
          role: { select: { code: true } },
          department: { select: { code: true } },
          team: { select: { code: true } },
        },
      }),
      prisma.team.findMany({
        orderBy: { code: 'asc' },
        select: {
          code: true,
          name: true,
          nameVi: true,
          description: true,
          isActive: true,
          department: { select: { code: true } },
          leader: { select: { email: true } },
          _count: { select: { members: true } },
        },
      }),
      prisma.department.findMany({
        orderBy: { sortOrder: 'asc' },
        select: {
          code: true,
          name: true,
          nameVi: true,
          sortOrder: true,
          isActive: true,
          parent: { select: { code: true } },
        },
      }),
      prisma.riskRule.findMany({
        orderBy: { code: 'asc' },
        select: {
          code: true,
          nameVi: true,
          scope: true,
          metric: true,
          comparator: true,
          threshold: true,
          severity: true,
          targetRef: true,
          isActive: true,
          description: true,
          portfolio: { select: { code: true } },
        },
      }),
      prisma.systemSetting.findMany({
        orderBy: { key: 'asc' },
        select: {
          key: true,
          value: true,
          valueType: true,
          group: true,
          nameVi: true,
          isEditable: true,
          isSecret: true,
          updatedAt: true,
        },
      }),
      prisma.portfolio.findMany({
        orderBy: { code: 'asc' },
        select: {
          code: true,
          nameVi: true,
          name: true,
          status: true,
          baseCurrency: true,
          reserveAmount: true,
          inceptionDate: true,
          ownerTeam: { select: { code: true } },
        },
      }),
    ]);

  return [
    {
      name: 'MD Mã chứng khoán',
      headers: [
        'symbol', 'company', 'company_vi', 'exchange', 'sector_code', 'sector',
        'industry_code', 'industry', 'listed_shares', 'is_vn30', 'status',
      ],
      rows: stocks.map((s) => [
        s.symbol, s.companyName, s.companyNameVi ?? '', s.exchange,
        s.sector.code, s.sector.nameVi,
        s.industry?.code ?? '', s.industry?.nameVi ?? '',
        s.listedShares, s.isVn30 ? 'YES' : 'NO', s.status,
      ]),
    },
    {
      name: 'MD Ngành',
      headers: ['code', 'name', 'name_vi', 'sort_order', 'color', 'industries'],
      rows: sectors.map((s) => [
        s.code, s.name, s.nameVi, s.sortOrder, s.colorHex ?? '',
        s.industries.map((i) => `${i.code}=${i.nameVi}`).join(' | '),
      ]),
    },
    {
      name: 'MD Chiến lược',
      headers: ['code', 'name', 'name_vi', 'sort_order', 'max_allocation_pct', 'is_active', 'description'],
      rows: strategies.map((s) => [
        s.code, s.name, s.nameVi, s.sortOrder,
        s.maxAllocationBps === null ? '' : (s.maxAllocationBps / 100).toFixed(2),
        s.isActive ? 'YES' : 'NO', s.description ?? '',
      ]),
    },
    {
      name: 'MD Người dùng',
      headers: [
        'email', 'full_name', 'employee_code', 'role', 'department_code', 'team_code',
        'status', 'must_change_password', 'last_login_at', 'created_at',
      ],
      rows: users.map((u) => [
        u.email, u.fullName, u.employeeCode ?? '', u.role?.code ?? '',
        u.department?.code ?? '', u.team?.code ?? '', u.status,
        u.mustChangePassword ? 'YES' : 'NO',
        csvDateTime(u.lastLoginAt), csvDateTime(u.createdAt),
      ]),
    },
    {
      name: 'MD Nhóm',
      headers: ['code', 'name', 'name_vi', 'department_code', 'leader_email', 'member_count', 'is_active', 'description'],
      rows: teams.map((t) => [
        t.code, t.name, t.nameVi, t.department.code, t.leader?.email ?? '',
        t._count.members, t.isActive ? 'YES' : 'NO', t.description ?? '',
      ]),
    },
    {
      name: 'MD Phòng ban',
      headers: ['code', 'name', 'name_vi', 'parent_code', 'sort_order', 'is_active'],
      rows: departments.map((d) => [
        d.code, d.name, d.nameVi, d.parent?.code ?? '', d.sortOrder, d.isActive ? 'YES' : 'NO',
      ]),
    },
    {
      name: 'MD Ngưỡng rủi ro',
      headers: [
        'code', 'name_vi', 'scope', 'metric', 'comparator', 'threshold', 'severity',
        'target_ref', 'portfolio_code', 'is_active', 'description',
      ],
      rows: riskRules.map((r) => [
        r.code, r.nameVi, r.scope, r.metric, r.comparator, r.threshold, r.severity,
        r.targetRef ?? '', r.portfolio?.code ?? '', r.isActive ? 'YES' : 'NO', r.description ?? '',
      ]),
    },
    {
      name: 'MD Cấu hình',
      headers: ['key', 'value', 'value_type', 'group', 'name_vi', 'is_editable', 'updated_at'],
      rows: settings.map((s) => [
        s.key,
        // Tôn trọng cờ `isSecret` ngay cả trong tệp sao lưu. Hiện không tham số
        // nào được đánh dấu như vậy — bí mật thật nằm trong `.env` và không bao
        // giờ đi qua database — nhưng nếu sau này có thì nó không được rời hệ
        // thống qua đường này.
        s.isSecret ? '(đã che)' : s.value,
        s.valueType, s.group, s.nameVi, s.isEditable ? 'YES' : 'NO',
        csvDateTime(s.updatedAt),
      ]),
    },
    {
      name: 'MD Danh mục',
      headers: ['code', 'name_vi', 'name', 'status', 'currency', 'reserve_vnd', 'owner_team_code', 'inception_date'],
      rows: portfolios.map((p) => [
        p.code, p.nameVi ?? '', p.name, p.status, p.baseCurrency, p.reserveAmount,
        p.ownerTeam?.code ?? '', p.inceptionDate.toISOString().slice(0, 10),
      ]),
    },
  ];
}

// ---------------------------------------------------------------------------
// Dựng workbook
// ---------------------------------------------------------------------------

export interface ArchiveResult {
  buffer: Buffer;
  filename: string;
  /** Số dòng theo từng sheet — dùng để ghi Audit Log. */
  rowCounts: Record<string, number>;
  totalRows: number;
}

export async function buildArchive(options: {
  actor: AuthUser;
  params: ReportParams;
  portfolioCode: string;
  from?: string;
  to?: string;
  /** false thì bỏ sheet Audit Log — người xuất không có quyền `audit.export`. */
  includeAudit: boolean;
}): Promise<ArchiveResult> {
  const { actor, params, portfolioCode, includeAudit } = options;
  const startedAt = new Date();

  /*
   * Chín sheet số liệu, dựng từ ĐÚNG các builder mà bản CSV dùng. Tuần tự chứ
   * không song song: mỗi builder là hàng loạt truy vấn, chạy song song chín cái
   * sẽ nghẽn connection pool của SQLite.
   */
  const dataSheets: RawSheet[] = [];
  for (const report of REPORTS) {
    if (report.code === 'audit-log' && !includeAudit) continue;
    const data = await buildReport(report.code, params);
    dataSheets.push({ name: report.nameVi, headers: data.headers, rows: data.rows });
  }

  const master = await masterDataSheets();

  const rowCounts: Record<string, number> = {};
  for (const s of [...dataSheets, ...master]) rowCounts[s.name] = s.rows.length;
  const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);

  /*
   * Sheet đầu tiên là THÔNG TIN XUẤT, không phải số liệu.
   *
   * Mở một tệp sao lưu sau một năm, câu hỏi đầu tiên là "cái này chụp lúc nào,
   * ai xuất, gồm khoảng nào". Để người đọc phải đi tìm câu trả lời đó trong tên
   * tệp là cách chắc chắn để họ đoán sai.
   */
  const infoSheet: RawSheet = {
    name: 'Thông tin xuất',
    headers: ['muc', 'gia_tri'],
    rows: [
      ['Thời điểm xuất', csvDateTime(startedAt)],
      ['Người xuất', `${actor.fullName} <${actor.email}>`],
      ['Vai trò', actor.roleNameVi ?? actor.roleCode ?? ''],
      ['Danh mục', portfolioCode],
      ['Từ ngày', options.from ?? '(toàn bộ)'],
      ['Đến ngày', options.to ?? '(toàn bộ)'],
      ['Kỳ hiệu suất', params.period],
      ['Số sheet số liệu', dataSheets.length],
      ['Số sheet master data', master.length],
      ['Tổng số dòng', totalRows],
      [
        'Audit Log',
        includeAudit ? 'có' : 'không xuất — người xuất thiếu quyền audit.export',
      ],
      ['', ''],
      ['Ghi chú', 'Tiền là số nguyên VNĐ. Tỷ lệ là phần trăm (0–100), không phải basis point.'],
      ['', 'Sheet có tiền tố "MD" là master data — danh mục dùng chung, không lọc theo ngày.'],
      ['', 'Vị thế và tỷ trọng là ẢNH CHỤP lúc xuất, không lọc theo khoảng ngày.'],
      ['', 'Giao dịch, dòng vốn, cảnh báo và audit log được lọc theo khoảng ngày ở trên.'],
    ],
  };

  const used = new Set<string>();
  const sheets: Sheet<Buffer>[] = [infoSheet, ...dataSheets, ...master].map((s) =>
    toSheet(sheetName(s.name, used), s.headers, s.rows),
  ) as unknown as Sheet<Buffer>[];

  const buffer = await writeXlsxFile(sheets).toBuffer();

  /*
   * Tên tệp mang mã danh mục và khoảng ngày. Ba tệp lưu trữ trong cùng một thư
   * mục phải phân biệt được mà không cần mở ra.
   */
  const stamp = startedAt.toISOString().slice(0, 10);
  const range =
    options.from || options.to
      ? `_${options.from ?? 'dau'}_den_${options.to ?? stamp}`
      : '_toanbo';

  return {
    buffer,
    filename: `luutru_${portfolioCode}${range}_xuat${stamp}.xlsx`,
    rowCounts,
    totalRows,
  };
}
