import { NextResponse, type NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { MARKET_DATA_SOURCE, SYNC_KIND, SYNC_STATUS } from '@/lib/enums';
import { INDEX_SCALE } from '@/lib/money';
import { toTradingDate } from '@/lib/trading-date';

/**
 * CỔNG NẠP DỮ LIỆU THỊ TRƯỜNG (§10) — Phase 07.
 *
 * Market Data Service (Python + vnstock) gọi vào đây; nó KHÔNG ghi thẳng vào
 * database. Lý do:
 *
 *   1. Một nguồn sự thật cho schema. Quy tắc tiền tệ (bigint VNĐ nguyên), quy tắc
 *      chỉ số (×100), và mọi ràng buộc quan hệ đều nằm trong Prisma. Nếu Python
 *      ghi trực tiếp, các quy tắc đó bị nhân đôi ở hai ngôn ngữ và sẽ lệch nhau.
 *   2. Chuyển sang PostgreSQL không phải sửa gì bên Python.
 *   3. Mọi lần nạp đều được ghi vào `market_data_syncs` tại đúng một chỗ.
 *
 * Đây KHÔNG phải vi phạm §23 "không gọi API thị trường trực tiếp từ frontend":
 * trình duyệt không bao giờ chạm tới VNStock. Service ở giữa vẫn tồn tại, nó chỉ
 * đi qua một route nội bộ có xác thực thay vì mở kết nối database riêng.
 *
 * Xác thực bằng shared secret `MARKET_DATA_INGEST_TOKEN`. Route này không dùng
 * phiên đăng nhập vì nó phục vụ tiến trình nền, không phục vụ người dùng.
 */

// Không cache: đây là endpoint ghi dữ liệu.
export const dynamic = 'force-dynamic';

/** Chuỗi số nguyên không dấu — tiền và khối lượng luôn truyền dạng chuỗi. */
const bigintString = z
  .string()
  .regex(/^-?\d+$/, 'phải là chuỗi số nguyên')
  .transform((v) => BigInt(v));

const optionalBigint = bigintString.nullish();

const quoteSchema = z.object({
  symbol: z.string().trim().toUpperCase().min(1).max(10),
  /** Giá khớp gần nhất, VNĐ nguyên. */
  price: bigintString,
  referencePrice: optionalBigint,
  ceilingPrice: optionalBigint,
  floorPrice: optionalBigint,
  openPrice: optionalBigint,
  highPrice: optionalBigint,
  lowPrice: optionalBigint,
  volume: optionalBigint,
  turnover: optionalBigint,
});

const historyBarSchema = z.object({
  symbol: z.string().trim().toUpperCase().min(1).max(10),
  tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  openPrice: bigintString,
  highPrice: bigintString,
  lowPrice: bigintString,
  closePrice: bigintString,
  volume: optionalBigint,
  turnover: optionalBigint,
});

const indexBarSchema = z.object({
  indexCode: z.string().trim().toUpperCase().min(1).max(20),
  tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Giá trị chỉ số ×100: VN-Index 1788,78 → "178878". */
  closeValue: bigintString,
  openValue: optionalBigint,
  highValue: optionalBigint,
  lowValue: optionalBigint,
  volume: optionalBigint,
});

const payloadSchema = z.object({
  source: z.string().default(MARKET_DATA_SOURCE.VNSTOCK),
  /** Nhãn nguồn con để truy vết, ví dụ "vci". */
  provider: z.string().optional(),
  tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quotes: z.array(quoteSchema).default([]),
  history: z.array(historyBarSchema).default([]),
  indices: z.array(indexBarSchema).default([]),
  /** Mã service đã thử lấy nhưng thất bại — để ghi đúng số liệu vào nhật ký. */
  failedSymbols: z.array(z.string()).default([]),
  durationMs: z.number().int().nonnegative().optional(),
  /**
   * Dòng `market_data_syncs` đã được app tạo sẵn cho lần chạy này.
   *
   * Chỉ có khi người dùng bấm "Cập nhật giá" trên trang Market Data:
   * `syncMarketDataAction` tạo trước một dòng RUNNING mang `triggeredBy = MANUAL`
   * và id người bấm, rồi truyền id đó cho tiến trình Python qua biến môi trường
   * `MARKET_DATA_SYNC_ID`.
   *
   * VÌ SAO PHẢI CÓ ĐƯỜNG NÀY. Nếu không, route luôn TẠO dòng mới với
   * `triggeredBy = 'CRON'` — nghĩa là mỗi lần bấm nút sinh ra HAI dòng nhật ký
   * (một RUNNING của app, một CRON của route), và dòng người dùng thật sự đọc lại
   * ghi sai là do cron. Cột `triggeredById` trong schema cũng sẽ mãi không có dữ
   * liệu dù nó tồn tại sẵn cho đúng việc này.
   */
  syncId: z.string().trim().min(1).max(64).optional(),
});

function tokenMatches(provided: string, expected: string): boolean {
  // So sánh hash để hai chuỗi khác độ dài không làm timingSafeEqual ném lỗi,
  // đồng thời không lộ độ dài token qua thời gian phản hồi.
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const expected = process.env.MARKET_DATA_INGEST_TOKEN;

  // Không có token cấu hình thì đóng hẳn cổng — mặc định an toàn, không mở toang.
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Body không phải JSON hợp lệ.' }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Payload sai định dạng.', issues: parsed.error.issues.slice(0, 10) },
      { status: 422 },
    );
  }

  const payload = parsed.data;
  const startedAt = new Date();
  const tradingDate = toTradingDate(payload.tradingDate);
  const sourceLabel = payload.provider
    ? `${payload.source}:${payload.provider.toUpperCase()}`
    : payload.source;

  const requested =
    payload.quotes.length +
    payload.history.length +
    payload.indices.length +
    payload.failedSymbols.length;

  let updated = 0;
  const unknownSymbols: string[] = [];
  const errors: string[] = [];

  try {
    // ------------------------------------------------------------------
    // 1. Giá mới nhất → market_quotes (upsert, 1 dòng / 1 mã)
    // ------------------------------------------------------------------
    if (payload.quotes.length > 0) {
      const symbols = [...new Set(payload.quotes.map((q) => q.symbol))];
      const stocks = await prisma.stock.findMany({
        where: { symbol: { in: symbols } },
        select: { id: true, symbol: true },
      });
      const idBySymbol = new Map(stocks.map((s) => [s.symbol, s.id]));

      for (const quote of payload.quotes) {
        const stockId = idBySymbol.get(quote.symbol);

        // §7: chỉ nhận giá cho mã có trong master data. Không tự tạo mã mới từ
        // dữ liệu ngoài — nếu không, danh mục chuẩn sẽ bị nguồn ngoài làm loãng.
        if (!stockId) {
          unknownSymbols.push(quote.symbol);
          continue;
        }

        const reference = quote.referencePrice ?? null;
        const changeBps =
          reference && reference > 0n
            ? Number(((quote.price - reference) * 10_000n) / reference)
            : null;

        const data = {
          price: quote.price,
          referencePrice: reference,
          ceilingPrice: quote.ceilingPrice ?? null,
          floorPrice: quote.floorPrice ?? null,
          openPrice: quote.openPrice ?? null,
          highPrice: quote.highPrice ?? null,
          lowPrice: quote.lowPrice ?? null,
          volume: quote.volume ?? null,
          turnover: quote.turnover ?? null,
          changeBps,
          tradingDate,
          source: sourceLabel,
          isStale: false,
          fetchedAt: startedAt,
        };

        await prisma.marketQuote.upsert({
          where: { stockId },
          create: { stockId, ...data },
          update: data,
        });
        updated += 1;
      }
    }

    // ------------------------------------------------------------------
    // 2. OHLCV theo ngày → price_history (unique theo stock + ngày)
    // ------------------------------------------------------------------
    if (payload.history.length > 0) {
      const symbols = [...new Set(payload.history.map((h) => h.symbol))];
      const stocks = await prisma.stock.findMany({
        where: { symbol: { in: symbols } },
        select: { id: true, symbol: true },
      });
      const idBySymbol = new Map(stocks.map((s) => [s.symbol, s.id]));

      for (const bar of payload.history) {
        const stockId = idBySymbol.get(bar.symbol);
        if (!stockId) {
          unknownSymbols.push(bar.symbol);
          continue;
        }

        const barDate = toTradingDate(bar.tradingDate);
        const data = {
          openPrice: bar.openPrice,
          highPrice: bar.highPrice,
          lowPrice: bar.lowPrice,
          closePrice: bar.closePrice,
          volume: bar.volume ?? 0n,
          turnover: bar.turnover ?? null,
          source: sourceLabel,
        };

        await prisma.priceHistory.upsert({
          where: { stockId_tradingDate: { stockId, tradingDate: barDate } },
          create: { stockId, tradingDate: barDate, ...data },
          update: data,
        });
        updated += 1;
      }
    }

    // ------------------------------------------------------------------
    // 3. Chỉ số → market_index_history (lưu ×100, xem money.ts)
    // ------------------------------------------------------------------
    for (const bar of payload.indices) {
      const barDate = toTradingDate(bar.tradingDate);
      const data = {
        closeValue: bar.closeValue,
        openValue: bar.openValue ?? null,
        highValue: bar.highValue ?? null,
        lowValue: bar.lowValue ?? null,
        volume: bar.volume ?? null,
        source: sourceLabel,
      };

      await prisma.marketIndexHistory.upsert({
        where: { indexCode_tradingDate: { indexCode: bar.indexCode, tradingDate: barDate } },
        create: { indexCode: bar.indexCode, tradingDate: barDate, ...data },
        update: data,
      });
      updated += 1;
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  // --------------------------------------------------------------------
  // 4. Ghi nhật ký đồng bộ — nguồn dữ liệu cho ô trạng thái §10
  // --------------------------------------------------------------------
  const failed = payload.failedSymbols.length + unknownSymbols.length;
  const status =
    errors.length > 0
      ? SYNC_STATUS.FAILED
      : failed > 0
        ? SYNC_STATUS.PARTIAL
        : SYNC_STATUS.SUCCESS;

  const finishedAt = new Date();

  const messageParts: string[] = [];
  if (unknownSymbols.length > 0) {
    messageParts.push(
      `${unknownSymbols.length} mã không có trong master data: ${[...new Set(unknownSymbols)].slice(0, 20).join(', ')}`,
    );
  }
  if (payload.failedSymbols.length > 0) {
    messageParts.push(`Service không lấy được: ${payload.failedSymbols.slice(0, 20).join(', ')}`);
  }
  errors.forEach((e) => messageParts.push(e));

  const kind =
    payload.indices.length > 0 && payload.quotes.length === 0
      ? SYNC_KIND.INDEX
      : payload.history.length > 0 && payload.quotes.length === 0
        ? SYNC_KIND.HISTORY
        : SYNC_KIND.QUOTE;

  const ketQua = {
    source: sourceLabel,
    kind,
    finishedAt,
    status,
    symbolsRequested: requested,
    symbolsUpdated: updated,
    symbolsFailed: failed,
    durationMs: payload.durationMs ?? finishedAt.getTime() - startedAt.getTime(),
    errorMessage: messageParts.length > 0 ? messageParts.join(' | ') : null,
  };

  /*
   * CÓ `syncId` → CẬP NHẬT dòng app đã tạo. Không có → tạo dòng mới, `triggeredBy`
   * mặc định là CRON.
   *
   * `startedAt` KHÔNG bị ghi đè khi cập nhật: dòng đó do app tạo lúc người bấm nút,
   * nên mốc bắt đầu thật là lúc ấy — sớm hơn lúc route này nhận request đúng bằng
   * thời gian Python khởi động và gọi VNStock. Ghi đè sẽ làm thời lượng hiển thị
   * ngắn hơn thực tế và giấu đi chính phần chậm nhất.
   *
   * `updateMany` chứ không `update`: id không tồn tại (app đã xoá dòng, hoặc ai đó
   * gửi id bừa) thì `update` NÉM và cả lần nạp dữ liệu thành công ở trên mất sạch
   * nhật ký. Ở đây nó trả về count = 0 và ta tạo dòng mới — dữ liệu đã ghi vào
   * database rồi, nhật ký không được phép biến mất vì một cái id sai.
   */
  let daGhiNhatKy = false;

  if (payload.syncId) {
    const { count } = await prisma.marketDataSync.updateMany({
      where: { id: payload.syncId },
      data: ketQua,
    });
    daGhiNhatKy = count > 0;
  }

  if (!daGhiNhatKy) {
    await prisma.marketDataSync.create({
      data: { ...ketQua, startedAt, triggeredBy: 'CRON' },
    });
  }

  return NextResponse.json(
    {
      ok: errors.length === 0,
      status,
      updated,
      failed,
      unknownSymbols: [...new Set(unknownSymbols)],
      errors,
    },
    { status: errors.length > 0 ? 500 : 200 },
  );
}

/**
 * Danh sách mã mà service cần lấy giá.
 *
 * Trả về đúng những mã có trong master data và đang giao dịch — service không tự
 * quyết định lấy mã nào. Nhờ vậy việc thêm/bớt mã theo dõi được làm ở một chỗ
 * (trang Stocks), không phải sửa cấu hình của tiến trình nền.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.MARKET_DATA_INGEST_TOKEN;
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

  const url = new URL(request.url);
  /*
   * `?all=1` lấy MỌI mã trong master data. Chỉ dùng cho việc nạp lịch sử một lần,
   * không dùng cho vòng lặp giá.
   */
  const all = url.searchParams.get('all') === '1';

  /*
   * PHẠM VI MẶC ĐỊNH: ĐANG ĐẦU TƯ ∪ VN100.
   *
   * Hai nhóm, hai lý do khác nhau, và thiếu nhóm nào cũng có hậu quả thật:
   *
   *   `trades: { some: {} }`  mã đã có giao dịch. BẮT BUỘC, vì thiếu giá thì
   *                           `computePositions` tính giá trị thị trường bằng 0 và
   *                           Portfolio Value của cả danh mục bị hụt.
   *
   *   `isVn100: true`         rổ VN100. Đây là những mã CÓ THỂ mua tới. Bó phạm vi
   *                           lại đúng những mã đã mua thì bảng giá chỉ nói về quá
   *                           khứ — không thể so một mã đang giữ với một mã đang
   *                           cân nhắc, mà đó chính là việc của người ra quyết định.
   *
   * Vì sao KHÔNG lấy hết ~1.600 mã của thị trường: mỗi lần gọi tốn hạn mức của
   * nguồn (tier free), và giá của một mã không ai định mua thì không trả lời câu hỏi
   * nào. VN100 là ranh giới có nghĩa — thanh khoản đủ để mua thật.
   *
   * Hợp của hai nhóm, không phải giao: một mã đang giữ mà rơi khỏi VN100 (DGC hiện
   * đúng trường hợp này) vẫn phải có giá, nếu không vị thế đang mở của nó mất giá trị.
   */
  const stocks = await prisma.stock.findMany({
    where: {
      status: { in: ['ACTIVE', 'WATCHLIST'] },
      ...(all ? {} : { OR: [{ trades: { some: {} } }, { isVn100: true }] }),
    },
    orderBy: { symbol: 'asc' },
    select: { symbol: true, exchange: true },
  });

  /*
   * ĐỘ TƯƠI CỦA DỮ LIỆU CŨNG TRẢ VỀ TỪ ĐÂY.
   *
   * Tiến trình nền cần biết "giá hiện cũ bao nhiêu phút" và "được phép cũ tới mức
   * nào" để quyết định có gọi nguồn hay không. Hai thông tin đó thuộc về APP, không
   * thuộc về tiến trình:
   *
   *   - Ngưỡng nằm ở `system_settings`, sửa được ở trang Settings lúc chạy. Nếu
   *     tiến trình giữ bản riêng trong `.env` thì sẽ có hai nguồn sự thật, và người
   *     sửa qua giao diện sẽ thấy không có gì đổi — đúng cái bẫy đã gặp với
   *     `market_data.sync_interval_seconds` (xem src/data/master-data.ts).
   *
   *   - "Lần thành công gần nhất" phải tính CẢ lượt do người bấm nút. Chỉ database
   *     biết điều đó; tiến trình nền không thấy được lượt của người khác. Nhờ vậy
   *     bấm tay xong thì lượt tự động kế tiếp tự lùi lại, không gọi nguồn hai lần
   *     cho cùng một khoảng thời gian.
   *
   * Gắn vào chính request đã dùng để hỏi danh sách mã, nên không thêm lượt gọi nào.
   */
  const [benchmark, refreshSetting, lastSync] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: 'market_data.benchmark_index' } }),
    prisma.systemSetting.findUnique({ where: { key: 'market_data.refresh_after_minutes' } }),
    prisma.marketDataSync.findFirst({
      where: { status: SYNC_STATUS.SUCCESS },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true, triggeredBy: true },
    }),
  ]);

  const lastSuccessAt = lastSync?.finishedAt ?? null;

  return NextResponse.json({
    ok: true,
    symbols: stocks.map((s) => s.symbol),
    exchanges: Object.fromEntries(stocks.map((s) => [s.symbol, s.exchange])),
    indices: [benchmark?.value ?? 'VNINDEX'],
    indexScale: Number(INDEX_SCALE),

    /** Mốc kết thúc của lần đồng bộ THÀNH CÔNG gần nhất, mọi nguồn kích hoạt. */
    lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
    /** Ai kích hoạt lượt đó — chỉ để ghi log cho dễ đọc. */
    lastTriggeredBy: lastSync?.triggeredBy ?? null,
    /** Giá đang cũ bao nhiêu phút. `null` = chưa từng đồng bộ thành công. */
    ageMinutes: lastSuccessAt
      ? Math.floor((Date.now() - lastSuccessAt.getTime()) / 60_000)
      : null,
    /** Cũ hơn mốc này thì đi lấy mới. Mặc định phòng hờ nếu thiếu cấu hình. */
    refreshAfterMinutes: Number(refreshSetting?.value ?? 120),
  });
}
