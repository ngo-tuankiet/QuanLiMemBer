import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, requestMeta } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { dataScope } from '@/domain/permissions';
import { applyScope } from '@/domain/portfolio-engine';
import { writeAudit } from '@/lib/audit';
import { REPORT_BY_CODE } from '@/reports/catalog';
import { buildReport, type ReportParams } from '@/reports/build';
import { toCsv } from '@/reports/csv';
import { AUDIT_ACTION, ENTITY_TYPE, PORTFOLIO_STATUS } from '@/lib/enums';
import type { PeriodCode } from '@/domain/portfolio-engine';

/**
 * XUẤT BÁO CÁO CSV (§20 `report.export`) — Phase 10.
 *
 * Là ROUTE HANDLER, không phải Server Action. Trình duyệt cần một phản hồi có
 * `Content-Disposition: attachment` để bật hộp thoại tải tệp; Server Action trả
 * về giá trị JavaScript nên không làm được việc đó mà không phải dựng blob rồi
 * tự tạo link trong client — thêm một lớp không cần thiết vào giữa.
 *
 * XÁC THỰC BẰNG PHIÊN ĐĂNG NHẬP, không bằng shared secret: đây là người dùng
 * thật bấm tải, khác hoàn toàn với /api/market-data/ingest và /api/risk/scan.
 *
 * MỖI LẦN XUẤT ĐỀU GHI AUDIT LOG. Xuất báo cáo là mang dữ liệu ra khỏi hệ thống,
 * nên nó là hành động cần theo dõi đúng như sửa dữ liệu — có khi hơn. Nhật ký ghi
 * lại ai xuất, báo cáo nào, tham số gì, và ra bao nhiêu dòng.
 */

export const dynamic = 'force-dynamic';

/** `yyyy-MM-dd` từ query string; trả undefined nếu thiếu hoặc sai định dạng. */
function parseDate(raw: string | null, endOfDay = false): Date | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const PERIODS = new Set<PeriodCode>(['1W', '1M', '3M', '6M', 'YTD', 'ALL']);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ report: string }> },
) {
  const { report: code } = await context.params;
  const definition = REPORT_BY_CODE.get(code);

  if (!definition) {
    return NextResponse.json({ ok: false, error: 'Báo cáo không tồn tại.' }, { status: 404 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Chưa đăng nhập.' }, { status: 401 });
  }

  /*
   * Kiểm quyền TẠI ĐÂY, không dựa vào việc giao diện có hiện nút tải hay không.
   * URL này gõ tay được, nên nút bị ẩn không phải một lớp bảo vệ.
   *
   * Không dùng `requirePermission()` vì hàm đó ném `ForbiddenError` để trang hiển
   * thị bắt; ở một endpoint tải tệp thì 403 kèm thông báo rõ ràng hữu ích hơn.
   */
  if (!user.permissions.has(definition.permission)) {
    return NextResponse.json(
      { ok: false, error: `Cần quyền ${definition.permission} để xuất báo cáo này.` },
      { status: 403 },
    );
  }

  const search = request.nextUrl.searchParams;

  const portfolio = search.get('portfolioId')
    ? await prisma.portfolio.findUnique({
        where: { id: search.get('portfolioId')! },
        select: { id: true, code: true },
      })
    : await prisma.portfolio.findFirst({
        where: { status: PORTFOLIO_STATUS.ACTIVE },
        orderBy: { createdAt: 'asc' },
        select: { id: true, code: true },
      });

  if (!portfolio) {
    return NextResponse.json({ ok: false, error: 'Không có danh mục nào.' }, { status: 404 });
  }

  const periodRaw = (search.get('period') ?? 'YTD') as PeriodCode;

  /*
   * ÉP PHẠM VI QUYỀN — cùng một chốt mà mọi trang đang dùng.
   *
   * Thiếu đoạn này thì trưởng nhóm bấm Tải về sẽ nhận vị thế, giao dịch và dòng vốn của
   * CẢ danh mục, dù mọi trang đều đã ép họ về nhóm mình. `report.export` chỉ trả lời câu
   * "được xuất hay không", không trả lời câu "được xuất PHẦN NÀO" — hai câu khác nhau,
   * và trước đây chỉ câu đầu được hỏi.
   *
   * `applyScope` trả về sentinel `__no_access__` khi phạm vi là NONE, nên báo cáo ra
   * rỗng thay vì ra tất — hỏng theo hướng an toàn.
   */
  const scope = dataScope(user.permissions, 'portfolio');
  const phamVi = applyScope({ portfolioId: portfolio.id }, scope, user.teamId);

  const params: ReportParams = {
    portfolioId: portfolio.id,
    teamId: phamVi.teamId,
    from: parseDate(search.get('from')),
    to: parseDate(search.get('to'), true),
    period: PERIODS.has(periodRaw) ? periodRaw : 'YTD',
    auditAction: search.get('action') ?? undefined,
    auditEntityType: search.get('entityType') ?? undefined,
  };

  let data;
  try {
    data = await buildReport(code, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[reports] dựng báo cáo thất bại:', code, error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const csv = toCsv(data.headers, data.rows);
  const meta = await requestMeta();

  await writeAudit({
    actor: user,
    action: AUDIT_ACTION.EXPORT,
    /*
     * `entityType` là REPORT và `entityId` là mã báo cáo — KHÔNG phải id danh
     * mục. Việc xảy ra ở đây là "một báo cáo đã được xuất", không phải "danh mục
     * bị thay đổi". Ghi id danh mục vào cột entityId sẽ khiến lần xuất báo cáo
     * nằm lẫn vào lịch sử thay đổi của danh mục đó khi lọc theo đối tượng.
     */
    entityType: ENTITY_TYPE.REPORT,
    entityId: code,
    entityLabel: `${definition.nameVi} · ${portfolio.code}`,
    after: {
      report: code,
      rows: data.rows.length,
      portfolio: portfolio.code,
      from: search.get('from') ?? null,
      to: search.get('to') ?? null,
      period: params.period,
      action: params.auditAction ?? null,
      entityType: params.auditEntityType ?? null,
    },
    note: `Xuất báo cáo CSV — ${data.rows.length} dòng`,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  /*
   * Tên tệp mang mã báo cáo, mã danh mục và ngày xuất. Ba tệp tải về trong cùng
   * một tuần sẽ không đè lên nhau và không cần mở ra mới biết là cái nào.
   */
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${code}_${portfolio.code}_${stamp}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      // `charset=utf-8` cùng với BOM trong nội dung: hai lớp cho cùng một việc,
      // vì Excel bỏ qua header còn công cụ khác bỏ qua BOM.
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
