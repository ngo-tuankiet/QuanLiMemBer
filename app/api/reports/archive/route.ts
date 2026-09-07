import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, requestMeta } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { dataScope } from '@/domain/permissions';
import { applyScope } from '@/domain/portfolio-engine';
import { writeAudit } from '@/lib/audit';
import { buildArchive } from '@/reports/archive';
import type { ReportParams } from '@/reports/build';
import { AUDIT_ACTION, ENTITY_TYPE, PORTFOLIO_STATUS } from '@/lib/enums';
import type { PeriodCode } from '@/domain/portfolio-engine';

/**
 * XUẤT TỆP TỔNG ĐỂ LƯU TRỮ (§20) — Excel nhiều sheet.
 *
 * Đường dẫn TĨNH `/api/reports/archive`, đứng cạnh route động
 * `/api/reports/[report]`. Next ưu tiên đoạn tĩnh nên `archive` không bị route
 * động bắt — và đó là lý do tách ra: tệp này khác định dạng, khác nội dung, và
 * nặng hơn hẳn một CSV. Nhồi nó vào route CSV sẽ làm route đó phải nhớ mình đang
 * trả về cái gì.
 *
 * QUYỀN. Cần `report.export` để xuất. Sheet Audit Log chỉ có khi người xuất còn
 * có thêm `audit.export` — cùng quy tắc như bản CSV lẻ, vì nhật ký đó là dấu vết
 * hành vi của từng người. Không đủ quyền thì sheet đó bị BỎ và sheet "Thông tin
 * xuất" nói rõ là đã bỏ, chứ không im lặng.
 */

export const dynamic = 'force-dynamic';

/*
 * Dựng workbook mất lâu hơn một CSV: 9 báo cáo cộng 9 bảng master data, mỗi báo
 * cáo là hàng loạt truy vấn. 120 giây đủ rộng cho một danh mục nhiều năm dữ liệu
 * mà vẫn không để một request treo mãi.
 */
export const maxDuration = 120;

/** `yyyy-MM-dd` từ query string; trả undefined nếu thiếu hoặc sai định dạng. */
function parseDate(raw: string | null, endOfDay = false): Date | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const PERIODS = new Set<PeriodCode>(['1W', '1M', '3M', '6M', 'YTD', 'ALL']);

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Chưa đăng nhập.' }, { status: 401 });
  }

  // Kiểm quyền TẠI ĐÂY: URL này gõ tay được, nút bị ẩn không phải lớp bảo vệ.
  if (!user.permissions.has('report.export')) {
    return NextResponse.json(
      { ok: false, error: 'Cần quyền report.export để xuất tệp lưu trữ.' },
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

  const from = search.get('from');
  const to = search.get('to');

  /*
   * Từ ngày sau Đến ngày thì chặn ngay, không âm thầm trả về tệp rỗng.
   *
   * Một tệp lưu trữ 0 dòng trông y như một tệp lưu trữ hợp lệ của một kỳ không có
   * giao dịch. Người ta sẽ cất nó đi và tin rằng kỳ đó thật sự trống.
   */
  if (from && to && from > to) {
    return NextResponse.json(
      { ok: false, error: `Khoảng ngày không hợp lệ: từ ${from} sau đến ${to}.` },
      { status: 400 },
    );
  }

  const periodRaw = (search.get('period') ?? 'ALL') as PeriodCode;

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
    from: parseDate(from),
    to: parseDate(to, true),
    // Mặc định ALL, không phải YTD: đây là tệp lưu trữ nên chuỗi hiệu suất phải
    // dài hết mức dữ liệu cho phép.
    period: PERIODS.has(periodRaw) ? periodRaw : 'ALL',
  };

  const includeAudit = user.permissions.has('audit.export');

  let archive;
  try {
    archive = await buildArchive({
      actor: user,
      params,
      portfolioCode: portfolio.code,
      from: from ?? undefined,
      to: to ?? undefined,
      includeAudit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[reports] dựng tệp lưu trữ thất bại:', error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const meta = await requestMeta();

  await writeAudit({
    actor: user,
    action: AUDIT_ACTION.EXPORT,
    entityType: ENTITY_TYPE.REPORT,
    entityId: 'archive',
    entityLabel: `Tệp tổng lưu trữ · ${portfolio.code}`,
    after: {
      report: 'archive',
      format: 'xlsx',
      portfolio: portfolio.code,
      from: from ?? null,
      to: to ?? null,
      period: params.period,
      includeAudit,
      totalRows: archive.totalRows,
      sizeBytes: archive.buffer.length,
      // Số dòng theo từng sheet: đủ để sau này đối chiếu tệp đã lưu với nhật ký
      // mà không cần mở tệp ra.
      rowCounts: archive.rowCounts,
    },
    note: `Xuất tệp tổng lưu trữ — ${archive.totalRows} dòng, ${Math.round(archive.buffer.length / 1024)} KB`,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return new NextResponse(new Uint8Array(archive.buffer), {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${archive.filename}"`,
      'Content-Length': String(archive.buffer.length),
      'Cache-Control': 'no-store',
    },
  });
}
