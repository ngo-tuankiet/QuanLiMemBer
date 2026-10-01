import { NextResponse, type NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { runRiskScan } from '@/risk/scan';
import { prisma } from '@/lib/prisma';

/**
 * CỔNG QUÉT RỦI RO ĐỊNH KỲ (§19) — Phase 09.
 *
 * Bộ hẹn giờ bên ngoài (Windows Task Scheduler, cron, hoặc chính Market Data
 * Service) gọi POST vào đây. Không dùng phiên đăng nhập vì nó phục vụ tiến trình
 * nền, giống hệt cổng nạp giá — xem app/api/market-data/ingest/route.ts.
 *
 * VÌ SAO CẦN CẢ ENDPOINT NÀY KHI ĐÃ CÓ QUÉT LƯỜI: quét lười chỉ chạy khi có
 * người mở trang. Rủi ro không chờ ai đăng nhập — một danh mục vượt ngưỡng lúc
 * 21h thứ Bảy phải được ghi nhận vào lúc 21h thứ Bảy, không phải sáng thứ Hai.
 * `triggeredAt` là thông tin quản trị, và nó chỉ đúng nếu có người đo đúng lúc.
 *
 * Dùng lại `MARKET_DATA_INGEST_TOKEN` thay vì thêm một secret nữa: cả hai đều là
 * "tiến trình nền của chính hệ thống này được phép ghi", cùng một mức tin cậy.
 * Thêm secret thứ hai chỉ tạo thêm một thứ để quên xoay vòng.
 */

export const dynamic = 'force-dynamic';

function tokenMatches(provided: string, expected: string): boolean {
  // So sánh hash để hai chuỗi khác độ dài không làm timingSafeEqual ném lỗi.
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function authorize(request: NextRequest): NextResponse | null {
  const expected = process.env.MARKET_DATA_INGEST_TOKEN;

  // Không cấu hình token thì đóng hẳn cổng — mặc định an toàn.
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'MARKET_DATA_INGEST_TOKEN chưa được cấu hình trên server.' },
      { status: 503 },
    );
  }

  const provided = request.headers.get('x-market-data-token') ?? '';
  if (!provided || !tokenMatches(provided, expected)) {
    return NextResponse.json({ ok: false, error: 'Token không hợp lệ.' }, { status: 401 });
  }

  return null;
}

export async function POST(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;

  try {
    const result = await runRiskScan({ trigger: 'SCHEDULE' });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    /*
     * 500 chứ không phải 200-với-ok-false: bộ hẹn giờ phải phân biệt được
     * "đã quét, không có gì" với "quét lỗi". Nếu luôn trả 200 thì log của
     * Task Scheduler sẽ toàn thành công trong khi engine chết cả tuần.
     */
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Kiểm tra sức khoẻ engine — để bộ hẹn giờ hoặc người vận hành soi nhanh. */
export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;

  const [lastRun, openCount] = await Promise.all([
    prisma.riskScanRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        trigger: true,
        status: true,
        startedAt: true,
        finishedAt: true,
        durationMs: true,
        rulesEvaluated: true,
        alertsOpened: true,
        alertsUpdated: true,
        alertsResolved: true,
        errorMessage: true,
      },
    }),
    prisma.riskAlert.count({ where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } } }),
  ]);

  return NextResponse.json({
    ok: true,
    openAlerts: openCount,
    lastRun,
    ageSeconds: lastRun ? Math.round((Date.now() - lastRun.startedAt.getTime()) / 1000) : null,
  });
}
