import 'server-only';

/**
 * LỊCH QUÉT SỰ KIỆN QUYỀN — một lần mỗi ngày, không phải mỗi lần lấy giá.
 *
 * Đo được: quét 37 mã mất 131 giây và có 2 mã hết giờ. Giá được lấy vài phút một lần;
 * quét theo nhịp đó là 2 phút gọi nguồn cho mỗi lượt giá, trong khi lịch chia cổ tức
 * đổi vài lần mỗi tháng.
 *
 * APP QUYẾT ĐỊNH "ĐẾN HẠN CHƯA", không phải tiến trình Python. Cùng lý do như ngưỡng
 * độ tươi của giá (xem GET của cổng nạp): lần quét do người bấm nút và lần quét của
 * vòng lặp nền phải biết đến nhau, và chỉ database biết cả hai.
 */

import { prisma } from '@/lib/prisma';
import { SYNC_KIND, SYNC_STATUS, TRADE_STATUS } from '@/lib/enums';

/**
 * Dòng quét RUNNING quá mốc này thì coi là tiến trình đã chết.
 *
 * Một lượt 60 mã đo được 10–13 phút (mỗi mã hết giờ tốn 30 giây, thử hai lần, cộng
 * vòng cứu cuối). Mốc 15 phút cũ quá sát: một lượt chậm còn đang chạy sẽ bị đánh dấu
 * bỏ dở. Dùng chung cho nút "Quét lại ngay" (dọn dòng treo) và trang cổ tức (không hiện
 * "Đang quét…" mãi cho một lượt đã chết).
 */
export const EVENTS_TREO_PHUT = 30;

/**
 * Có lượt quét nào ĐANG CHẠY THẬT không — tức RUNNING và chưa quá `EVENTS_TREO_PHUT`.
 *
 * Tiến trình quét chết giữa chừng thì dòng RUNNING ở lại mãi (chỉ được dọn khi có người
 * bấm quét lần sau). Trước đây trang cổ tức đếm mọi dòng RUNNING nên hiện "Đang quét…"
 * cả đêm cho một lượt không còn tồn tại.
 */
export async function dangCoLuotQuet(now: Date = new Date()): Promise<boolean> {
  const n = await prisma.marketDataSync.count({
    where: {
      kind: SYNC_KIND.EVENTS,
      status: SYNC_STATUS.RUNNING,
      startedAt: { gte: new Date(now.getTime() - EVENTS_TREO_PHUT * 60_000) },
    },
  });
  return n > 0;
}

/** Quét thành công (kể cả một phần) trong khoảng này thì chưa quét lại. */
const QUET_LAI_SAU_GIO = 20;

/**
 * Lần thử gần nhất — BẤT KỂ KẾT QUẢ — trong khoảng này thì chưa thử lại.
 *
 * Thiếu mốc này thì một lần nguồn sập làm vòng lặp nền thử lại ở MỖI lượt giá: vài
 * phút một lần, mỗi lần 2 phút, suốt cả ngày.
 */
const THU_LAI_SAU_PHUT = 60;

export async function suKienDenHanQuet(now: Date = new Date()): Promise<boolean> {
  const [xong, thu] = await Promise.all([
    prisma.marketDataSync.findFirst({
      where: {
        kind: SYNC_KIND.EVENTS,
        /*
         * PARTIAL CŨNG TÍNH LÀ ĐÃ QUÉT. Một mã hết giờ thì lần quét được đánh PARTIAL;
         * không tính nó thì một mã hay hết giờ (VCB, VIX đo được) làm cả 37 mã bị quét
         * lại liên tục.
         */
        status: { in: [SYNC_STATUS.SUCCESS, SYNC_STATUS.PARTIAL] },
        finishedAt: { gte: new Date(now.getTime() - QUET_LAI_SAU_GIO * 3_600_000) },
      },
      select: { id: true },
    }),
    prisma.marketDataSync.findFirst({
      where: {
        kind: SYNC_KIND.EVENTS,
        startedAt: { gte: new Date(now.getTime() - THU_LAI_SAU_PHUT * 60_000) },
      },
      select: { id: true },
    }),
  ]);
  return !xong && !thu;
}

/**
 * Mã cần quét: mọi mã TỪNG có lệnh khớp.
 *
 * Không chỉ mã đang giữ. Bán hết sau ngày GDKHQ thì vẫn được hưởng đợt đó, nên một mã
 * vừa bán sạch hôm nay vẫn có thể còn một mục đang chờ từ tuần trước.
 */
export async function maCanQuetSuKien(): Promise<string[]> {
  const ds = await prisma.stock.findMany({
    where: { trades: { some: { status: TRADE_STATUS.EXECUTED } } },
    orderBy: { symbol: 'asc' },
    select: { symbol: true },
  });
  return ds.map((s) => s.symbol);
}
