import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, requestMeta } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { nhanPhamVi, phamViCaNhan } from '@/domain/permissions';
import { applyPersonalScope } from '@/domain/portfolio-engine';
import { writeAudit } from '@/lib/audit';
import { buildAccountPnl } from '@/reports/account-pnl';
import { ghiAccountPnlXlsx } from '@/reports/account-pnl-xlsx';
import { tradingDayString } from '@/lib/trading-date';
import { AUDIT_ACTION, ENTITY_TYPE, PORTFOLIO_STATUS } from '@/lib/enums';

/**
 * TẢI BÁO CÁO VỐN & LỢI NHUẬN THEO TÀI KHOẢN (.xlsx, đúng mẫu của người dùng).
 *
 *   ?thang=2026-09              trọn tháng
 *   ?from=2026-09-01&to=…       khoảng tuỳ chọn
 *
 * Cùng chốt với các báo cáo khác: cần `report.export`, phạm vi theo vai trò
 * (`phamViCaNhan` — thực thi/thành viên chỉ tài khoản của mình, quản lý nhóm cả nhóm,
 * cấp cao & admin tất cả), và mỗi lần xuất ghi vào nhật ký.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const NGAY = /^\d{4}-\d{2}-\d{2}$/;

function khoang(search: URLSearchParams): { tu: string; den: string } | string {
  const thang = search.get('thang');
  if (thang) {
    if (!/^\d{4}-\d{2}$/.test(thang)) return `Tháng không hợp lệ: ${thang}`;
    const [y, m] = thang.split('-').map(Number) as [number, number];
    if (m < 1 || m > 12) return `Tháng không hợp lệ: ${thang}`;
    const den = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { tu: `${thang}-01`, den };
  }
  const tu = search.get('from') ?? '';
  const den = search.get('to') ?? '';
  if (!NGAY.test(tu) || !NGAY.test(den)) return 'Cần chọn tháng, hoặc cả từ ngày và đến ngày.';
  if (tu > den) return `Khoảng ngày không hợp lệ: từ ${tu} sau đến ${den}.`;
  return { tu, den };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Chưa đăng nhập.' }, { status: 401 });

  // Kiểm quyền TẠI ĐÂY: URL gõ tay được, nút bị ẩn không phải lớp bảo vệ.
  if (!user.permissions.has('report.export')) {
    return NextResponse.json({ ok: false, error: 'Cần quyền report.export để xuất báo cáo.' }, { status: 403 });
  }

  const k = khoang(request.nextUrl.searchParams);
  if (typeof k === 'string') return NextResponse.json({ ok: false, error: k }, { status: 400 });

  // Không tính cho tương lai: "đến ngày" sau hôm nay thì dừng ở hôm nay.
  const homNay = tradingDayString();
  const den = k.den > homNay ? homNay : k.den;
  if (k.tu > den) {
    return NextResponse.json({ ok: false, error: 'Kỳ này chưa bắt đầu.' }, { status: 400 });
  }

  const portfolio = await prisma.portfolio.findFirst({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    orderBy: { createdAt: 'asc' },
    select: { id: true, code: true },
  });
  if (!portfolio) return NextResponse.json({ ok: false, error: 'Không có danh mục nào.' }, { status: 404 });

  const scope = phamViCaNhan(user.permissions, 'portfolio');
  const pv = applyPersonalScope({ portfolioId: portfolio.id }, scope, user);

  let file;
  let soDong = 0;
  try {
    const bc = await buildAccountPnl(portfolio.id, k.tu, den, { userId: pv.userId, teamId: pv.teamId });
    soDong = bc.dong.length;
    file = await ghiAccountPnlXlsx(bc, {
      nguoiXuat: user.fullName,
      phamVi: scope === 'ALL' ? 'Toàn bộ tài khoản' : nhanPhamVi(scope, user.teamNameVi).replace(/^ · /, ''),
    });
  } catch (error) {
    console.error('[reports] dựng báo cáo vốn theo tài khoản thất bại:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }

  const meta = await requestMeta();
  await writeAudit({
    actor: user,
    action: AUDIT_ACTION.EXPORT,
    entityType: ENTITY_TYPE.REPORT,
    entityId: 'account-pnl',
    entityLabel: `Báo cáo vốn & lợi nhuận theo tài khoản · ${file.sheetName}`,
    after: { report: 'account-pnl', format: 'xlsx', from: k.tu, to: den, scope, rows: soDong },
    note: `Xuất báo cáo vốn theo tài khoản ${k.tu} → ${den} — ${soDong} tài khoản`,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return new NextResponse(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': String(file.buffer.length),
      'Cache-Control': 'no-store',
    },
  });
}
