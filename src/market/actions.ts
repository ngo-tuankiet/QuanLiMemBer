'use server';

/**
 * Server Action cho master data thị trường (§7) — Phase 03.
 *
 * Còn hai việc: ngành / phân ngành, và nhập giá thủ công.
 *
 * ĐÃ BỎ ba action thêm / sửa / đổi trạng thái mã chứng khoán, cùng với trang
 * quản lý mã. §23 "Stock phải có master data" vẫn được giữ nguyên — form nhập
 * lệnh vẫn CHỌN mã từ bảng `stocks` chứ không gõ tay. Chỉ khác là bảng đó bây
 * giờ được nạp từ `STOCK_SEED` (src/data/master-data.ts) chứ không sửa qua giao
 * diện: thêm mã = thêm vào seed rồi `npm run db:seed`.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { requirePermission, requestMeta } from '@/auth/guards';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  AUDIT_ACTION,
  ENTITY_TYPE,
  MARKET_DATA_SOURCE,
  SYNC_KIND,
  SYNC_STATUS,
  SYNC_TRIGGER,
} from '@/lib/enums';
import { toTradingDate } from '@/lib/trading-date';

export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

function zodErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function refresh(): void {
  revalidatePath('/market/sectors');
  revalidatePath('/audit');
}

// ---------------------------------------------------------------------------
// Sector & Industry
// ---------------------------------------------------------------------------

const sectorSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,40}$/, 'Mã ngành chỉ gồm chữ in hoa, số và gạch dưới'),
  name: z.string().min(2).max(100).trim(),
  nameVi: z.string().min(2).max(100).trim(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Màu phải ở dạng #RRGGBB').optional(),
});

export async function createSectorAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('sector.manage');

  const parsed = sectorSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    nameVi: formData.get('nameVi'),
    colorHex: formData.get('colorHex') || undefined,
  });
  if (!parsed.success) return { ok: false, fieldErrors: zodErrors(parsed.error) };

  try {
    const exists = await prisma.sector.findUnique({
      where: { code: parsed.data.code },
      select: { id: true },
    });
    if (exists) return { ok: false, fieldErrors: { code: ['Mã ngành đã tồn tại.'] } };

    const max = await prisma.sector.aggregate({ _max: { sortOrder: true } });
    const meta = await requestMeta();

    const created = await prisma.sector.create({
      data: { ...parsed.data, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });

    await writeAudit({
      actor,
      action: AUDIT_ACTION.CREATE,
      entityType: ENTITY_TYPE.SECTOR,
      entityId: created.id,
      entityLabel: `${created.code} — ${created.nameVi}`,
      after: { code: created.code, name: created.name, nameVi: created.nameVi },
      ...meta,
    });

    refresh();
    return { ok: true, message: `Đã thêm ngành ${created.nameVi}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Thêm ngành thất bại.' };
  }
}

const industrySchema = sectorSchema.extend({ sectorId: z.string().min(1) });

export async function createIndustryAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('sector.manage');

  const parsed = industrySchema.omit({ colorHex: true }).safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    nameVi: formData.get('nameVi'),
    sectorId: formData.get('sectorId'),
  });
  if (!parsed.success) return { ok: false, fieldErrors: zodErrors(parsed.error) };

  try {
    const exists = await prisma.industry.findUnique({
      where: { code: parsed.data.code },
      select: { id: true },
    });
    if (exists) return { ok: false, fieldErrors: { code: ['Mã phân ngành đã tồn tại.'] } };

    const max = await prisma.industry.aggregate({
      where: { sectorId: parsed.data.sectorId },
      _max: { sortOrder: true },
    });
    const meta = await requestMeta();

    const created = await prisma.industry.create({
      data: { ...parsed.data, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });

    await writeAudit({
      actor,
      action: AUDIT_ACTION.CREATE,
      entityType: ENTITY_TYPE.INDUSTRY,
      entityId: created.id,
      entityLabel: `${created.code} — ${created.nameVi}`,
      after: { code: created.code, nameVi: created.nameVi, sectorId: created.sectorId },
      ...meta,
    });

    refresh();
    return { ok: true, message: `Đã thêm phân ngành ${created.nameVi}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Thêm phân ngành thất bại.' };
  }
}

// ---------------------------------------------------------------------------
// Nhập giá thủ công
// ---------------------------------------------------------------------------

/**
 * Nhập giá tay cho một mã.
 *
 * Phase 07 sẽ có Market Data Service tự đồng bộ từ VNStock. Trong lúc chưa có, đây
 * là đường duy nhất để có giá — và nó ghi `source = MANUAL` để phân biệt rõ với
 * giá lấy từ nguồn chính thức. Dashboard cần biết số liệu đang dựa trên giá tay.
 */
export async function setManualQuoteAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('market_data.sync');

  const symbol = String(formData.get('symbol') ?? '').trim().toUpperCase();
  // Người dùng thường gõ "26.150" theo thói quen bảng giá — bỏ dấu phân cách.
  const rawPrice = String(formData.get('price') ?? '').replace(/[.,\s]/g, '');

  if (!symbol) {
    return { ok: false, fieldErrors: { symbol: ['Nhập mã chứng khoán.'] } };
  }
  if (!/^\d+$/.test(rawPrice) || rawPrice === '0') {
    return { ok: false, fieldErrors: { price: ['Giá phải là số nguyên dương (VNĐ).'] } };
  }
  const price = BigInt(rawPrice);

  try {
    const stock = await prisma.stock.findUnique({
      where: { symbol },
      select: { id: true, symbol: true, exchange: true, quote: { select: { price: true } } },
    });

    // Không cho nhập giá cho mã không có trong master data (§7).
    if (!stock) {
      return {
        ok: false,
        fieldErrors: { symbol: [`Mã ${symbol} không có trong danh mục chuẩn. Thêm mã ở trang Stocks trước.`] },
      };
    }
    const stockId = stock.id;

    const now = new Date();
    const meta = await requestMeta();

    await prisma.marketQuote.upsert({
      where: { stockId },
      create: {
        stockId,
        price,
        referencePrice: price,
        tradingDate: toTradingDate(now),
        source: 'MANUAL',
        isStale: false,
        fetchedAt: now,
      },
      update: { price, tradingDate: toTradingDate(now), source: 'MANUAL', isStale: false, fetchedAt: now },
    });

    await prisma.marketDataSync.create({
      data: {
        source: 'MANUAL',
        kind: 'QUOTE',
        startedAt: now,
        finishedAt: now,
        status: 'SUCCESS',
        symbolsRequested: 1,
        symbolsUpdated: 1,
        durationMs: 0,
        triggeredBy: 'MANUAL',
        triggeredById: actor.id,
      },
    });

    await writeAudit({
      actor,
      action: AUDIT_ACTION.UPDATE,
      entityType: ENTITY_TYPE.MARKET_DATA,
      entityId: stockId,
      entityLabel: `${stock.symbol} giá thủ công`,
      before: { price: stock.quote?.price ?? null },
      after: { price, source: 'MANUAL' },
      note: 'Nhập giá thủ công. Phase 07 sẽ thay bằng đồng bộ từ VNStock.',
      ...meta,
    });

    revalidatePath('/market/market-data');
    revalidatePath('/portfolio');
    revalidatePath('/dashboard');
    return { ok: true, message: `${stock.symbol} = ${price.toLocaleString('vi-VN')} ₫` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Cập nhật giá thất bại.' };
  }
}

// ---------------------------------------------------------------------------
// Đồng bộ giá từ VNStock theo yêu cầu người dùng (§10)
// ---------------------------------------------------------------------------

/**
 * Số giây chờ tối đa cho một lần bấm nút.
 *
 * Lấy giá 12 mã qua `price_board` thường mất 5–20 giây, nhưng nguồn có lúc treo.
 * Không có mốc chờ thì tiến trình con sống mãi và request của người dùng treo theo.
 */
const SYNC_TIMEOUT_SECONDS = Number(process.env.MARKET_DATA_SYNC_TIMEOUT ?? '180') || 180;

/** Đường dẫn tới interpreter của venv và thư mục service (hỗ trợ cả Windows và Linux). */
function duongDanService(): { python: string; cwd: string } {
  const cwd = path.join(process.cwd(), 'services', 'market-data');
  const winPython = path.join(cwd, '.venv', 'Scripts', 'python.exe');
  const posixPython = path.join(cwd, '.venv', 'bin', 'python');

  const python = process.platform === 'win32'
    ? (existsSync(winPython) ? winPython : posixPython)
    : (existsSync(posixPython) ? posixPython : winPython);

  return {
    python,
    cwd,
  };
}

/**
 * Chạy `sync.py quotes` một lần và trả về mã thoát cùng output.
 *
 * KHÔNG DÙNG SHELL, và tham số truyền dạng MẢNG. Đường dẫn dự án có khoảng trắng
 * ("Dashboard CKVN") nên chuỗi lệnh qua shell sẽ cần thoát dấu; quan trọng hơn,
 * mảng tham số khiến không có đường nào cho chuỗi của người dùng lọt vào dòng lệnh.
 * Ở đây mọi tham số đều là hằng số trong code — không nhận gì từ form.
 */
function chayPython(
  python: string,
  cwd: string,
  syncId: string,
): Promise<{ code: number | null; output: string; hetGio: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(python, ['sync.py', 'quotes'], {
      cwd,
      env: {
        ...process.env,
        // Cầu nối duy nhất giữa action và Python: id dòng nhật ký cần cập nhật.
        MARKET_DATA_SYNC_ID: syncId,
      },
      windowsHide: true,
    });

    let output = '';
    let hetGio = false;

    // Giữ lại phần CUỐI của output, không phần đầu: dòng báo lỗi nằm ở cuối, còn
    // đầu output của vnstock là mấy chục dòng banner vẽ khung.
    const gom = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-8000);
    };
    child.stdout.on('data', gom);
    child.stderr.on('data', gom);

    const hen = setTimeout(() => {
      hetGio = true;
      child.kill();
    }, SYNC_TIMEOUT_SECONDS * 1000);

    child.on('error', (err) => {
      clearTimeout(hen);
      resolve({ code: null, output: `${output}\n${err.message}`, hetGio });
    });

    child.on('close', (code) => {
      clearTimeout(hen);
      resolve({ code, output, hetGio });
    });
  });
}

/**
 * Lọc output của Python xuống mấy dòng đáng đọc.
 *
 * `vnstock` in một banner quảng cáo bằng ký tự vẽ khung mỗi lần import. Đưa nguyên
 * output vào thông báo lỗi thì dòng lỗi thật bị chôn giữa đám khung — đúng vấn đề
 * mà `run.ps1` đã phải xử lý cho file log.
 */
function locOutput(raw: string, soDong = 4): string {
  const dong = raw
    .split(/\r?\n/)
    .map((d) => d.trim())
    .filter((d) => d !== '')
    .filter((d) => !/[─-╿✀-➿\uD800-\uDFFF]/.test(d));

  return dong.slice(-soDong).join(' | ').slice(0, 500);
}

/**
 * NÚT "CẬP NHẬT GIÁ" — lấy giá thật từ VNStock ngay khi người dùng bấm.
 *
 * VÌ SAO CẦN. `sync.py quotes --loop` phải có một tiến trình sống liên tục; sau mỗi
 * lần khởi động lại máy nó không tự chạy (xem `services/market-data/run.ps1`). Khi
 * đó Dashboard báo "Market Data trễ N phút" — đúng sự thật, nhưng người dùng không
 * có cách nào tự khắc phục ngoài việc mở PowerShell. Nút này cho họ đường đó.
 *
 * ĐÂY KHÔNG PHẢI VI PHẠM §23 "frontend không bao giờ gọi VNStock trực tiếp".
 * Chuỗi gọi vẫn nguyên vẹn, chỉ thêm một mắt ở đầu:
 *
 *     trình duyệt → server action → tiến trình Python → VNStock
 *                                        ↓
 *                            POST /api/market-data/ingest → database
 *
 * Trình duyệt không hề biết VNStock tồn tại, và mọi quy tắc schema vẫn nằm đúng
 * một chỗ ở cổng nạp. Nếu action tự gọi VNStock bằng `fetch` thì mới là vi phạm —
 * và cũng không làm được, vì `vnstock` là thư viện Python.
 *
 * MỘT LẦN RỒI THOÁT, không `--loop`: người bấm nút muốn giá mới bây giờ, không
 * muốn dựng thêm một tiến trình nền thứ hai chạy song song với cái do `run.ps1`
 * quản lý. Chạy một lần cũng bỏ qua được chốt giờ giao dịch trong `sync.py` — bấm
 * chiều thứ Bảy vẫn lấy được giá đóng cửa của phiên thứ Sáu, đúng cái người dùng
 * cần khi thấy "trễ 7871 phút".
 */
export async function syncMarketDataAction(): Promise<ActionResult> {
  const actor = await requirePermission('market_data.sync');

  const { python, cwd } = duongDanService();

  if (!existsSync(python)) {
    const isWin = process.platform === 'win32';
    const hd = isWin
      ? 'python -m venv .venv rồi .venv\\Scripts\\python.exe -m pip install -r requirements.txt'
      : 'python3 -m venv .venv rồi .venv/bin/pip install -r requirements.txt';
    return {
      ok: false,
      message:
        `Chưa có môi trường Python tại ${path.relative(process.cwd(), python)}. ` +
        `Tạo bằng: ${hd} (trong services/market-data).`,
    };
  }

  if (!process.env.MARKET_DATA_INGEST_TOKEN) {
    return {
      ok: false,
      message: 'MARKET_DATA_INGEST_TOKEN chưa được cấu hình — cổng nạp dữ liệu đang đóng.',
    };
  }

  /*
   * DỌN DÒNG TREO TRƯỚC KHI KIỂM TRÙNG.
   *
   * Một lần chạy bị giết giữa đường (đóng tab, server restart, hết giờ) để lại dòng
   * RUNNING mãi mãi. Không dọn thì phép kiểm "đang có lần chạy khác" bên dưới sẽ
   * chặn nút VĨNH VIỄN, và người dùng không có cách nào biết vì sao.
   *
   * Mốc dọn là chính `SYNC_TIMEOUT_SECONDS`: quá mốc đó thì tiến trình đã bị kill,
   * nên dòng RUNNING chắc chắn không còn ai cập nhật nữa.
   */
  const mocTreo = new Date(Date.now() - SYNC_TIMEOUT_SECONDS * 1000);
  await prisma.marketDataSync.updateMany({
    where: { status: SYNC_STATUS.RUNNING, startedAt: { lt: mocTreo } },
    data: {
      status: SYNC_STATUS.FAILED,
      finishedAt: new Date(),
      errorMessage: 'Lần chạy bị bỏ dở — không có kết quả nào được nạp.',
    },
  });

  const dangChay = await prisma.marketDataSync.findFirst({
    where: { status: SYNC_STATUS.RUNNING },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true, triggeredByUser: { select: { fullName: true } } },
  });

  if (dangChay) {
    const giay = Math.round((Date.now() - dangChay.startedAt.getTime()) / 1000);
    const ai = dangChay.triggeredByUser?.fullName;
    return {
      ok: false,
      message:
        `Đang có một lần đồng bộ chạy${ai ? ` (${ai})` : ''}, bắt đầu ${giay} giây trước. ` +
        'Chờ nó xong rồi bấm lại.',
    };
  }

  /*
   * TẠO DÒNG NHẬT KÝ TRƯỚC KHI CHẠY.
   *
   * Hai việc cùng lúc: (1) ghi đúng "ai bấm, lúc nào" — cổng nạp không biết người
   * dùng nên không tự ghi được; (2) làm chốt chống bấm hai lần, vì dòng RUNNING này
   * chính là thứ phép kiểm ở trên tìm.
   */
  const ban = await prisma.marketDataSync.create({
    data: {
      source: MARKET_DATA_SOURCE.VNSTOCK,
      kind: SYNC_KIND.QUOTE,
      status: SYNC_STATUS.RUNNING,
      triggeredBy: SYNC_TRIGGER.MANUAL,
      triggeredById: actor.id,
    },
    select: { id: true },
  });

  const { code, output, hetGio } = await chayPython(python, cwd, ban.id);

  const meta = await requestMeta();

  /*
   * Đọc lại dòng nhật ký: nếu Python nạp được, cổng nạp đã CẬP NHẬT chính dòng này
   * với số mã và trạng thái thật. Lấy số từ đó thay vì bóc từ output — output là
   * chữ người đọc, còn database là con số đã ghi.
   */
  const sau = await prisma.marketDataSync.findUnique({
    where: { id: ban.id },
    select: {
      status: true,
      symbolsUpdated: true,
      symbolsFailed: true,
      symbolsRequested: true,
      errorMessage: true,
      durationMs: true,
    },
  });

  const chuaCapNhat = sau?.status === SYNC_STATUS.RUNNING;

  // Python thoát mà cổng nạp chưa hề được gọi → tự đóng dòng lại, đừng để nó treo.
  if (chuaCapNhat) {
    const lyDo = hetGio
      ? `Quá ${SYNC_TIMEOUT_SECONDS} giây, đã dừng tiến trình.`
      : `Tiến trình Python thoát với mã ${code}.`;

    await prisma.marketDataSync.update({
      where: { id: ban.id },
      data: {
        status: SYNC_STATUS.FAILED,
        finishedAt: new Date(),
        errorMessage: `${lyDo} ${locOutput(output)}`.trim(),
      },
    });

    await writeAudit({
      actor,
      action: AUDIT_ACTION.UPDATE,
      entityType: ENTITY_TYPE.MARKET_DATA,
      entityId: ban.id,
      entityLabel: 'Đồng bộ giá VNStock (thất bại)',
      after: { status: SYNC_STATUS.FAILED, exitCode: code, timedOut: hetGio },
      note: locOutput(output, 2) || lyDo,
      ...meta,
    });

    revalidatePath('/market/market-data');

    return {
      ok: false,
      message: `Không lấy được giá. ${lyDo} ${locOutput(output, 2)}`.trim(),
    };
  }

  await writeAudit({
    actor,
    action: AUDIT_ACTION.UPDATE,
    entityType: ENTITY_TYPE.MARKET_DATA,
    entityId: ban.id,
    entityLabel: 'Đồng bộ giá VNStock',
    after: {
      status: sau?.status,
      symbolsUpdated: sau?.symbolsUpdated,
      symbolsFailed: sau?.symbolsFailed,
    },
    note: 'Người dùng bấm "Cập nhật giá" trên trang Market Data.',
    ...meta,
  });

  /*
   * Làm mới mọi trang phụ thuộc giá. Bỏ sót `/portfolio` hay `/dashboard` thì người
   * dùng bấm nút, thấy "đã cập nhật 12 mã", quay ra Dashboard và vẫn thấy số cũ —
   * rồi kết luận nút không hoạt động.
   */
  for (const p of [
    '/market/market-data',
    '/dashboard',
    '/portfolio',
    '/portfolio/positions',
    '/portfolio/allocation',
    '/reports',
    '/risk',
    '/audit',
  ]) {
    revalidatePath(p);
  }

  const giay = sau?.durationMs ? (sau.durationMs / 1000).toFixed(1) : '?';
  const loi = sau?.symbolsFailed ?? 0;

  return {
    ok: sau?.status !== SYNC_STATUS.FAILED,
    message:
      `Đã cập nhật ${sau?.symbolsUpdated ?? 0}/${sau?.symbolsRequested ?? 0} mã trong ${giay}s` +
      (loi > 0 ? ` · ${loi} mã lỗi` : '') +
      (sau?.errorMessage ? ` · ${sau.errorMessage.slice(0, 200)}` : ''),
  };
}
