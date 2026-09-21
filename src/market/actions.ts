'use server';

/**
 * Server Action cho master data thị trường (§7) — Phase 03.
 *
 * Còn hai việc: ngành / phân ngành, và gọi giá từ VNStock.
 *
 * ĐÃ BỎ HẲN NHẬP GIÁ THỦ CÔNG. Nó sinh ra khi chưa có Market Data Service (Phase 07);
 * giờ service đã chạy, giữ lại một đường ghi giá bằng tay nghĩa là giữ một đường ghi
 * số vào chỗ mà mọi phép tính tiền đều đọc, không ai đối chiếu được với nguồn nào.
 * Mã nào VNStock không có giá thì để trống — con số 0 thấy rõ là thiếu dữ liệu, còn
 * một giá gõ tay trông y hệt giá thật.
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
import { readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { quyDoiIcb, quyDoiSan, tachKhaNang, type CapIcb } from '@/market/icb';
import {
  AUDIT_ACTION,
  ENTITY_TYPE,
  MARKET_DATA_SOURCE,
  SYNC_KIND,
  SYNC_STATUS,
  SYNC_TRIGGER,
} from '@/lib/enums';

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
// Đồng bộ giá từ VNStock theo yêu cầu người dùng (§10)
// ---------------------------------------------------------------------------

/**
 * Số giây chờ tối đa cho một lần bấm nút.
 *
 * Lấy giá 12 mã qua `price_board` thường mất 5–20 giây, nhưng nguồn có lúc treo.
 * Không có mốc chờ thì tiến trình con sống mãi và request của người dùng treo theo.
 */
const SYNC_TIMEOUT_SECONDS = Number(process.env.MARKET_DATA_SYNC_TIMEOUT ?? '180') || 180;

/** Đường dẫn tới interpreter của venv và thư mục service. */
function duongDanService(): { python: string; cwd: string } {
  const cwd = path.join(process.cwd(), 'services', 'market-data');
  const envPython = process.env.MARKET_DATA_PYTHON_PATH || process.env.PYTHON_PATH;
  if (envPython && existsSync(envPython)) {
    return { python: envPython, cwd };
  }

  const venvWin = path.join(cwd, '.venv', 'Scripts', 'python.exe');
  const venvUnix = path.join(cwd, '.venv', 'bin', 'python');

  let python = venvWin;
  if (process.platform === 'win32') {
    python = existsSync(venvWin) ? venvWin : (existsSync(venvUnix) ? venvUnix : venvWin);
  } else {
    python = existsSync(venvUnix) ? venvUnix : (existsSync(venvWin) ? venvWin : venvUnix);
  }

  return { python, cwd };
}

/**
 * Chạy `sync.py quotes` một lần và trả về mã thoát cùng output.
 *
 * KHÔNG DÙNG SHELL, và tham số truyền dạng MẢNG. Đường dẫn dự án có khoảng trắng
 * ("Dashboard CKVN") nên chuỗi lệnh qua shell sẽ cần thoát dấu; quan trọng hơn,
 * mảng tham số khiến không có đường nào cho chuỗi của người dùng lọt vào dòng lệnh.
 *
 * `chiDinh` LÀ THỨ DUY NHẤT ĐI TỪ FORM RA DÒNG LỆNH, nên nó phải đã qua kiểm ở
 * `fetchQuoteForSymbolAction`: đúng dạng mã chứng khoán VÀ có thật trong bảng
 * `stocks`. Kể cả vậy, không có shell nên chuỗi này tới Python nguyên vẹn dạng một
 * phần tử argv — không có ký tự nào tách được nó thành lệnh thứ hai.
 */
function chayPython(
  python: string,
  cwd: string,
  syncId: string,
  chiDinh: string[] | null,
): Promise<{ code: number | null; output: string; hetGio: boolean }> {
  const argv = ['sync.py', 'quotes'];
  if (chiDinh?.length) argv.push('--symbols', chiDinh.join(','));

  return chayTienTrinh(python, cwd, argv, SYNC_TIMEOUT_SECONDS, {
    // Cầu nối duy nhất giữa action và Python: id dòng nhật ký cần cập nhật.
    MARKET_DATA_SYNC_ID: syncId,
  });
}

/**
 * Chạy một tiến trình Python của service và gom output.
 *
 * Tách ra khỏi `chayPython` khi có lệnh thứ hai (`info`) cần đúng cách chạy này:
 * không shell, argv dạng mảng, có mốc hết giờ, giữ phần cuối output. Ba thứ đó là lý
 * do an toàn chứ không phải tiện tay, nên lệnh mới phải dùng lại chứ không viết lại.
 */
function chayTienTrinh(
  python: string,
  cwd: string,
  argv: string[],
  giay: number,
  envThem: Record<string, string> = {},
): Promise<{ code: number | null; output: string; hetGio: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(python, argv, {
      cwd,
      env: { ...process.env, ...envThem },
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
    }, giay * 1000);

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
  return dongBoGia(actor, null);
}

/**
 * LÕI DÙNG CHUNG cho cả hai nút, khác nhau đúng một tham số `chiDinh`.
 *
 * `null` = hỏi app cần mã nào (nút "Cập nhật giá"). Một mảng = ép đúng mấy mã đó
 * (nút "Lấy giá" theo mã). Mọi thứ còn lại — dọn dòng treo, chốt chống bấm hai lần,
 * dòng nhật ký, đọc lại kết quả, ghi nhật ký kiểm toán, làm mới trang — GIỐNG HỆT
 * nhau, nên tách ra thay vì chép đôi.
 *
 * Chốt chống chạy chồng áp cho CẢ HAI. Lấy một mã trong lúc lượt toàn danh mục đang
 * chạy nghĩa là hai tiến trình cùng gọi nguồn và cùng ghi vào `market_quotes` —
 * đúng thứ mà dòng RUNNING sinh ra để chặn.
 */
async function dongBoGia(
  actor: Awaited<ReturnType<typeof requirePermission>>,
  chiDinh: string[] | null,
): Promise<ActionResult> {
  const { python, cwd } = duongDanService();

  if (!existsSync(python)) {
    const huongDan = process.platform === 'win32'
      ? 'python -m venv .venv rồi .venv\\Scripts\\python.exe -m pip install -r requirements.txt'
      : 'python3 -m venv .venv && .venv/bin/pip install -r requirements.txt';
    return {
      ok: false,
      message:
        `Chưa có môi trường Python tại ${path.relative(process.cwd(), python)}. ` +
        `Tạo bằng: ${huongDan} ` +
        '(trong services/market-data).',
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

  const { code, output, hetGio } = await chayPython(python, cwd, ban.id, chiDinh);

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
      entityLabel: `Đồng bộ giá VNStock (thất bại)${chiDinh ? ` — ${chiDinh.join(', ')}` : ''}`,
      after: { status: SYNC_STATUS.FAILED, exitCode: code, timedOut: hetGio, symbols: chiDinh },
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
    entityLabel: `Đồng bộ giá VNStock${chiDinh ? ` — ${chiDinh.join(', ')}` : ''}`,
    after: {
      status: sau?.status,
      symbolsUpdated: sau?.symbolsUpdated,
      symbolsFailed: sau?.symbolsFailed,
      symbols: chiDinh,
    },
    note: chiDinh
      ? `Người dùng yêu cầu lấy giá cho ${chiDinh.join(
)} trên trang Market Data.`
      : 'Người dùng bấm "Cập nhật giá" trên trang Market Data.',
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

// ---------------------------------------------------------------------------
// Lấy giá cho MỘT mã theo yêu cầu (§7, §10)
// ---------------------------------------------------------------------------

/**
 * NÚT "LẤY GIÁ" — gọi VNStock cho đúng một mã đang thiếu giá.
 *
 * VÌ SAO KHÔNG PHẢI NÚT "CẬP NHẬT GIÁ" Ở ĐẦU TRANG. Nút kia hỏi app "cần mã nào"
 * và app chỉ trả về mã ĐÃ CÓ GIAO DỊCH. Nó đúng cho việc làm mới giá hằng ngày,
 * nhưng lại bất lực đúng lúc cần nhất: người dùng vừa thấy một mã trong danh sách
 * "đã có giao dịch nhưng chưa có giá" và muốn lấy riêng mã đó. Chạy cả trăm mã để
 * lấy một mã vừa chậm vừa dễ bị nguồn chặn giữa đường.
 *
 * §7 VẪN NGUYÊN: mã phải có sẵn trong `stocks`. Ô nhập này KHÔNG tạo mã mới —
 * nhập một mã lạ thì bị từ chối tại đây, và kể cả có lọt xuống Python thì cổng nạp
 * cũng đẩy nó vào `unknownSymbols` chứ không tự thêm vào master data.
 *
 * KHÔNG CÓ ĐƯỜNG DỰ PHÒNG khi VNStock không có dữ liệu cho mã đó — đây là lựa chọn
 * có chủ đích của người dùng khi bỏ nhập giá thủ công. Mã không có giá sẽ tính giá
 * trị thị trường bằng 0, và trang này nói thẳng điều đó thay vì để một con số gõ tay
 * trông giống giá thật.
 */
export async function fetchQuoteForSymbolAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('market_data.sync');

  const symbol = String(formData.get('symbol') ?? '').trim().toUpperCase();

  if (!symbol) {
    return { ok: false, fieldErrors: { symbol: ['Nhập mã chứng khoán.'] } };
  }
  /*
   * KIỂM DẠNG TRƯỚC KHI TRA DATABASE, vì chuỗi này sẽ thành một phần tử argv của
   * tiến trình Python. Chỉ cho chữ in hoa và số, tối đa 10 ký tự — không khoảng
   * trắng, không dấu gạch, không dấu phẩy (dấu phẩy là ký tự tách mã của
   * `--symbols`, để lọt thì một ô nhập thành nhiều mã).
   */
  if (!/^[A-Z0-9]{3,10}$/.test(symbol)) {
    return {
      ok: false,
      fieldErrors: { symbol: ['Mã chứng khoán chỉ gồm chữ in hoa và số, 3–10 ký tự.'] },
    };
  }

  const stock = await prisma.stock.findUnique({
    where: { symbol },
    select: {
      id: true,
      symbol: true,
      companyName: true,
      quote: { select: { price: true, fetchedAt: true } },
    },
  });

  // §7: không tạo mã từ dữ liệu ngoài. Mã lạ bị chặn ngay, không gọi nguồn.
  if (!stock) {
    return {
      ok: false,
      fieldErrors: {
        symbol: [`Mã ${symbol} không có trong danh mục chuẩn — chỉ lấy được giá cho mã đã có sẵn (§7).`],
      },
    };
  }

  const truoc = stock.quote?.fetchedAt?.getTime() ?? null;

  const ketQua = await dongBoGia(actor, [symbol]);

  /*
   * ĐỌC LẠI ĐÚNG MÃ NÀY, KHÔNG TIN THÔNG BÁO CHUNG.
   *
   * `dongBoGia` báo "cập nhật n/m mã" theo con số cổng nạp ghi. Với một mã thì con
   * số đó vẫn có thể là 1 trong khi giá của MÃ NÀY không đổi — nguồn trả về dòng
   * rỗng chẳng hạn. Thứ người dùng hỏi là "mã của tôi có giá chưa", nên câu trả lời
   * phải đọc từ chính dòng giá của mã đó.
   */
  const sau = await prisma.marketQuote.findUnique({
    where: { stockId: stock.id },
    select: { price: true, fetchedAt: true, source: true },
  });

  const coGiaMoi = sau != null && sau.fetchedAt.getTime() !== truoc;

  if (coGiaMoi) {
    return {
      ok: true,
      message: `${stock.symbol} = ${sau.price.toLocaleString('vi-VN')} ₫ (${sau.source})`,
    };
  }

  // Tiến trình lỗi (venv thiếu, hết giờ, nguồn sập) — giữ nguyên lý do thật.
  if (!ketQua.ok) return ketQua;

  return {
    ok: false,
    message:
      `VNStock không trả về giá cho ${stock.symbol}. ` +
      'Mã này vẫn được tính giá trị thị trường bằng 0 cho tới khi nguồn có dữ liệu.',
  };
}

// ---------------------------------------------------------------------------
// Thêm mã vào danh mục chuẩn (§7)
// ---------------------------------------------------------------------------

/**
 * THÊM MỘT MÃ VÀO DANH MỤC CHUẨN, rồi lấy giá luôn.
 *
 * ĐÂY LÀ ĐƯỜNG DUY NHẤT ĐỂ THEO DÕI MỘT MÃ NGOÀI `STOCK_SEED`. Không có nó, muốn
 * xem giá SCS thì phải sửa mã nguồn — và cũng không nhập được lệnh SCS, vì form
 * nhập lệnh chọn mã từ chính bảng này.
 *
 * VÌ SAO BẮT KHAI NGÀNH VÀ PHÂN NGÀNH, KHÔNG LẤY TỰ ĐỘNG TỪ NGUỒN. Luồng giá của
 * VNStock chỉ trả về giá — không kèm phân loại ngành. Danh mục ICB thì có, và
 * `suggestStockInfoAction` dùng nó để GỢI Ý, nhưng gợi ý không tự điền: nguồn xếp sai
 * ngành một cách rất thuyết phục (SCS → "Du lịch & Giải trí"). Tạo mã với ngành để trống thì
 * Sector Exposure và mọi phép phân bổ theo ngành thủng đúng chỗ mã đó, mà lỗ thủng
 * ấy không báo lỗi: biểu đồ vẫn vẽ, chỉ là thiếu. Bắt khai ngay lúc thêm là chỗ duy
 * nhất ép được thông tin đó, vì sau khi thêm thì không còn giao diện sửa mã nữa.
 *
 * §7 KHÔNG BỊ NỚI. Điều §7 cấm là DỮ LIỆU NGOÀI tự tạo mã — cổng nạp vẫn đẩy mã lạ
 * vào `unknownSymbols` như cũ. Ở đây người có quyền chủ động khai một mã, có nhật ký
 * kiểm toán ghi ai khai và khai gì.
 */
export async function addStockAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('stock.create');

  const schema = z.object({
    symbol: z
      .string()
      .trim()
      .toUpperCase()
      // Cùng bộ ký tự với `fetchQuoteForSymbolAction`: mã này rồi sẽ được truyền cho
      // `sync.py --symbols`, nên thêm được một mã có dấu phẩy là mở lại đúng lỗ đó.
      .regex(/^[A-Z0-9]{3,10}$/, 'Mã chỉ gồm chữ in hoa và số, 3–10 ký tự'),
    companyName: z.string().trim().min(3, 'Tên công ty quá ngắn').max(200),
    exchange: z.enum(['HOSE', 'HNX', 'UPCOM'], { message: 'Chọn sàn niêm yết' }),
    sectorId: z.string().min(1, 'Chọn ngành'),
    industryId: z.string().min(1, 'Chọn phân ngành'),
  });

  const parsed = schema.safeParse({
    symbol: formData.get('symbol') ?? '',
    companyName: formData.get('companyName') ?? '',
    exchange: formData.get('exchange') ?? '',
    sectorId: formData.get('sectorId') ?? '',
    industryId: formData.get('industryId') ?? '',
  });

  if (!parsed.success) {
    return { ok: false, fieldErrors: zodErrors(parsed.error) };
  }

  const { symbol, companyName, exchange, sectorId, industryId } = parsed.data;

  try {
    const daCo = await prisma.stock.findUnique({
      where: { symbol },
      select: { symbol: true, status: true },
    });
    if (daCo) {
      return {
        ok: false,
        fieldErrors: { symbol: [`Mã ${symbol} đã có trong danh mục chuẩn rồi.`] },
      };
    }

    /*
     * PHÂN NGÀNH PHẢI THUỘC ĐÚNG NGÀNH ĐÃ CHỌN.
     *
     * Ô chọn trên trang đã lọc theo ngành, nhưng phép kiểm đó nằm ở trình duyệt —
     * nơi form gửi lên là một request bất kỳ. Ghép sai cặp thì `stocks.sectorId` nói
     * một đằng, `industryId` một nẻo, và hai biểu đồ đọc hai trường đó sẽ xếp cùng
     * một mã vào hai ngành khác nhau.
     */
    const industry = await prisma.industry.findUnique({
      where: { id: industryId },
      select: { id: true, sectorId: true, nameVi: true, sector: { select: { nameVi: true } } },
    });
    if (!industry) {
      return { ok: false, fieldErrors: { industryId: ['Phân ngành không tồn tại.'] } };
    }
    if (industry.sectorId !== sectorId) {
      return {
        ok: false,
        fieldErrors: {
          industryId: [`Phân ngành "${industry.nameVi}" thuộc ngành "${industry.sector.nameVi}", không thuộc ngành đã chọn.`],
        },
      };
    }

    const stock = await prisma.stock.create({
      data: {
        symbol,
        companyName,
        companyNameVi: companyName,
        exchange,
        sectorId,
        industryId,
        status: 'ACTIVE',
        /*
         * `isVn30` / `isVn100` để NGUYÊN false, kể cả khi mã này thật sự nằm trong rổ.
         * Nguồn sự thật của hai rổ là `VN30_SEED` / `VN100_SEED`, và `npm run db:seed`
         * ghi đè hai cờ này theo seed ở mỗi lần chạy. Đặt tay ở đây chỉ tạo ra một giá
         * trị sống được tới lần seed kế tiếp — tệ hơn là để false, vì nó trông như đã
         * được khai báo. Mã thuộc rổ thì thêm vào seed.
         */
      },
      select: { id: true, symbol: true },
    });

    await writeAudit({
      actor,
      action: AUDIT_ACTION.CREATE,
      entityType: ENTITY_TYPE.STOCK,
      entityId: stock.id,
      entityLabel: `${stock.symbol} — thêm vào danh mục chuẩn`,
      after: { symbol, companyName, exchange, sector: industry.sector.nameVi, industry: industry.nameVi },
      note: 'Thêm mã qua trang Market Data.',
      ...(await requestMeta()),
    });

    for (const p of ['/market/market-data', '/market/sectors', '/transactions/new']) {
      revalidatePath(p);
    }

    /*
     * LẤY GIÁ NGAY, nhưng KHÔNG để kết quả lấy giá quyết định thành bại của việc thêm
     * mã. Mã đã được ghi rồi; nếu nguồn đang bận hay không có dữ liệu thì đó là tin
     * phụ, không phải lý do để người dùng tưởng thao tác thất bại và thêm lại.
     */
    if (!actor.permissions.has('market_data.sync')) {
      return {
        ok: true,
        message: `Đã thêm ${symbol}. Bạn không có quyền gọi nguồn giá, nhờ người có quyền bấm "Lấy giá theo mã".`,
      };
    }

    const giaKq = await dongBoGia(actor, [symbol]);
    const quote = await prisma.marketQuote.findUnique({
      where: { stockId: stock.id },
      select: { price: true },
    });

    if (quote) {
      return {
        ok: true,
        message: `Đã thêm ${symbol} và lấy được giá: ${quote.price.toLocaleString('vi-VN')} ₫.`,
      };
    }

    return {
      ok: true,
      message:
        `Đã thêm ${symbol} vào danh mục chuẩn, nhưng chưa lấy được giá` +
        (giaKq.message ? ` (${giaKq.message})` : '') +
        '. Bấm "Lấy giá theo mã" để thử lại.',
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Thêm mã thất bại.' };
  }
}

// ---------------------------------------------------------------------------
// Gợi ý thông tin mã từ VNStock — GỢI Ý, KHÔNG ĐIỀN
// ---------------------------------------------------------------------------

/**
 * Mốc chờ riêng cho lệnh `info`.
 *
 * Nó tải hai bảng danh mục của cả thị trường (~1.500 mã) rồi mới tra một mã, nên
 * chậm hơn lấy giá một mã. Đo được 25–40 giây khi nguồn khoẻ.
 */
const INFO_TIMEOUT_SECONDS = Number(process.env.MARKET_DATA_INFO_TIMEOUT ?? '150') || 150;

/** Một lựa chọn trong ô chọn — đủ để giao diện hiện tên và điền đúng id khi bấm. */
export interface MucGoiY {
  id: string;
  nameVi: string;
}

/**
 * Một phân ngành gợi ý, KÈM NGÀNH CỦA NÓ.
 *
 * Phải kèm, vì gợi ý phụ có thể thuộc ngành khác: `5750 Du lịch & Giải trí` gợi ý cả
 * "Khách sạn và giải trí" (Hàng tiêu dùng) lẫn "Hàng không" (Công nghiệp). Bấm "dùng"
 * mà chỉ đặt phân ngành thì ô Ngành vẫn giữ giá trị cũ, và `addStockAction` từ chối
 * đúng cặp vừa được gợi ý.
 */
export interface MucPhanNganh extends MucGoiY {
  idNganh: string;
  tenNganh: string;
}

export interface GoiYThemMa {
  symbol: string;
  tenCongTy: string;
  tenNgan: string;
  /** Sàn đã quy về lựa chọn của form; null khi nguồn trả về thứ khác (BOND/DELISTED). */
  san: 'HOSE' | 'HNX' | 'UPCOM' | null;
  /** Sàn nguyên văn từ nguồn — hiện ra để người dùng tự đánh giá khi không quy đổi được. */
  sanNguon: string;
  nganh: MucGoiY | null;
  /** Chỉ có khi nhóm ICB ứng đúng một phân ngành. */
  phanNganh: MucPhanNganh | null;
  /** Phân ngành khác cũng hợp lý — người dùng chọn, hệ thống không chọn hộ. */
  phanNganhKhac: MucPhanNganh[];
  /** Tên nhóm ICB nguyên văn, kèm cấp đã dùng: "Hàng không (ICB cấp 4)". */
  nhomIcb: string;
  /** Những điều người dùng cần biết trước khi tin gợi ý. */
  canhBao: string[];
}

export type KetQuaGoiY = { ok: true; goiY: GoiYThemMa } | { ok: false; message: string };

interface ThongTinNguon {
  ten: string;
  ten_ngan: string;
  san: string;
  loai: string;
  icb: Record<string, CapIcb>;
}

/**
 * Nhớ tạm kết quả THÔ của nguồn trong một khoảng ngắn.
 *
 * Vì sao cần: người dùng gõ sai một ký tự rồi sửa lại là chuyện thường, và mỗi lần
 * gọi là 25–40 giây tải lại danh mục cả thị trường. Nhớ theo mã làm lần gõ lại trả
 * lời tức thì.
 *
 * CHỈ NHỚ DỮ LIỆU THÔ, KHÔNG NHỚ GỢI Ý ĐÃ QUY ĐỔI. Gợi ý chứa id của `sectors` /
 * `industries`; nhớ nó lại thì một lần sửa master data sẽ để lại id cũ trong bộ nhớ
 * tạm. Quy đổi lại mỗi lần gọi thì không bao giờ có chuyện đó, mà cũng chẳng tốn gì.
 */
const boNhoNguon = new Map<string, { luc: number; tin: ThongTinNguon | null }>();
const BO_NHO_MS = 15 * 60 * 1000;

/** Gọi `sync.py info` cho đúng một mã và đọc file JSON nó ghi ra. */
async function traNguon(symbol: string): Promise<{ tin: ThongTinNguon | null } | { loi: string }> {
  const nho = boNhoNguon.get(symbol);
  if (nho && Date.now() - nho.luc < BO_NHO_MS) return { tin: nho.tin };

  const { python, cwd } = duongDanService();
  if (!existsSync(python)) {
    return {
      loi:
        `Chưa có môi trường Python tại ${path.relative(process.cwd(), python)} — ` +
        'không tra được thông tin mã. Vẫn nhập tay được đầy đủ.',
    };
  }

  /*
   * FILE TẠM MỖI LẦN MỘT TÊN.
   *
   * Hai người bấm cùng lúc mà dùng chung một tên file thì người này đọc kết quả của
   * người kia — một mã trả về tên công ty của mã khác, không báo lỗi gì.
   */
  const fileTam = path.join(os.tmpdir(), `bti-info-${randomUUID()}.json`);

  try {
    const { code, output, hetGio } = await chayTienTrinh(
      python,
      cwd,
      ['sync.py', 'info', '--symbols', symbol, '--out', fileTam],
      INFO_TIMEOUT_SECONDS,
    );

    if (hetGio) {
      return { loi: `Tra thông tin ${symbol} quá ${INFO_TIMEOUT_SECONDS} giây nên đã dừng.` };
    }
    if (code !== 0) {
      return { loi: `Không tra được ${symbol} từ VNStock: ${locOutput(output)}` };
    }

    const raw = await readFile(fileTam, 'utf8');
    const doc = JSON.parse(raw) as Record<string, ThongTinNguon | null>;
    const tin = doc[symbol] ?? null;
    boNhoNguon.set(symbol, { luc: Date.now(), tin });
    return { tin };
  } catch (error) {
    return {
      loi: `Không đọc được kết quả tra mã: ${error instanceof Error ? error.message : 'lỗi lạ'}`,
    };
  } finally {
    // Xoá file tạm kể cả khi đọc lỗi; không để rác tích lại trong %TEMP%.
    await unlink(fileTam).catch(() => {});
  }
}

/**
 * GỢI Ý TÊN CÔNG TY / SÀN / NGÀNH CHO MỘT MÃ, KHÔNG ĐIỀN HỘ.
 *
 * Đây là yêu cầu nguyên văn của người dùng: "sau khi nhập mã ở ô tô đỏ, các ô còn
 * lại sẽ tự động gợi ý (không điền)". Action này trả về gợi ý; việc đưa vào ô là một
 * cú bấm của người dùng trên `AddStockForm`.
 *
 * VÌ SAO KHÔNG ĐIỀN THẲNG, dù điền thì ít việc hơn cho cả hai bên. Nguồn có sai, và
 * sai một cách trông rất thuyết phục. Đo được trên chính mã trong ví dụ: VCI xếp SCS
 * — dịch vụ hàng hoá sân bay — vào `5750 Du lịch & Giải trí` ở cấp 3. Một ô đã điền
 * sẵn thì không ai đọc lại; một dòng gợi ý thì phải đọc mới bấm được. Ngành sai không
 * báo lỗi ở đâu cả, nó chỉ làm mọi biểu đồ tỷ trọng ngành lệch vĩnh viễn.
 *
 * KHÔNG GHI GÌ. Không tạo mã, không ghi nhật ký kiểm toán, không sửa master data —
 * §7 nguyên vẹn: chỉ `addStockAction` mới tạo được mã, và nó vẫn tự kiểm lại mọi thứ
 * người dùng gửi lên chứ không tin gợi ý này.
 */
export async function suggestStockInfoAction(symbolRaw: string): Promise<KetQuaGoiY> {
  await requirePermission('stock.create');

  const symbol = String(symbolRaw ?? '').trim().toUpperCase();

  // Cùng bộ ký tự với `addStockAction`: chuỗi này rồi sẽ thành một phần tử argv.
  if (!/^[A-Z0-9]{3,10}$/.test(symbol)) {
    return { ok: false, message: 'Mã chỉ gồm chữ in hoa và số, 3–10 ký tự.' };
  }

  const daCo = await prisma.stock.findUnique({
    where: { symbol },
    select: { symbol: true, companyName: true },
  });
  if (daCo) {
    return { ok: false, message: `${symbol} đã có trong danh mục chuẩn (${daCo.companyName}).` };
  }

  const kq = await traNguon(symbol);
  if ('loi' in kq) return { ok: false, message: kq.loi };
  if (!kq.tin) {
    return {
      ok: false,
      message: `VNStock không có mã ${symbol} trong danh mục niêm yết. Kiểm lại mã, hoặc nhập tay.`,
    };
  }

  const tin = kq.tin;
  const canhBao: string[] = [];

  if (tin.loai && tin.loai !== 'STOCK') {
    canhBao.push(`Nguồn xếp ${symbol} là "${tin.loai}", không phải cổ phiếu thường.`);
  }

  const san = quyDoiSan(tin.san);
  if (!san && tin.san) {
    canhBao.push(
      tin.san === 'DELISTED'
        ? `Nguồn ghi ${symbol} đã HUỶ NIÊM YẾT — không gợi ý được sàn.`
        : `Nguồn ghi sàn "${tin.san}", không thuộc HOSE/HNX/UPCOM.`,
    );
  }

  /*
   * QUY ĐỔI ICB → NGÀNH CỦA MASTER DATA rồi TRA ID THẬT.
   *
   * Bảng `ICB_SANG_MASTER` chỉ nói mã ngành dạng chữ (`INDUSTRIALS`). Ô chọn của form
   * gửi lên id, nên phải tra bảng thật — và việc tra đó cũng là phép kiểm: mã ngành
   * nào không còn trong master data thì gợi ý tự biến mất thay vì trả về một id chết.
   */
  const quyDoi = quyDoiIcb(tin.icb);
  let nganh: MucGoiY | null = null;
  let phanNganh: MucPhanNganh | null = null;
  const phanNganhKhac: MucPhanNganh[] = [];

  if (quyDoi) {
    const sector = await prisma.sector.findFirst({
      where: { code: quyDoi.sectorCode, isActive: true },
      select: { id: true, nameVi: true },
    });
    if (sector) nganh = { id: sector.id, nameVi: sector.nameVi };

    /*
     * Tra một lượt mọi phân ngành cần tới — chính và phụ, ở bất kỳ ngành nào — rồi
     * lọc theo đúng cặp ngành/phân ngành mà bảng khai. Cặp nào không khớp thì BỎ,
     * không chữa: một cặp lệch ở đây sẽ bị `addStockAction` từ chối, nên gợi ý nó ra
     * chỉ để người dùng bấm vào một cái bẫy.
     */
    const can = (quyDoi.cungKhaNang ?? []).map((c) => tachKhaNang(c, quyDoi.sectorCode));
    if (quyDoi.industryCode) {
      can.unshift({ sectorCode: quyDoi.sectorCode, industryCode: quyDoi.industryCode });
    }

    if (can.length > 0) {
      const rows = await prisma.industry.findMany({
        where: { code: { in: can.map((c) => c.industryCode) }, isActive: true },
        select: {
          id: true,
          code: true,
          nameVi: true,
          sector: { select: { id: true, code: true, nameVi: true, isActive: true } },
        },
      });
      const theoCode = new Map(rows.map((r) => [r.code, r]));

      for (const [i, c] of can.entries()) {
        const r = theoCode.get(c.industryCode);
        if (!r || !r.sector.isActive || r.sector.code !== c.sectorCode) continue;
        const muc: MucPhanNganh = {
          id: r.id,
          nameVi: r.nameVi,
          idNganh: r.sector.id,
          tenNganh: r.sector.nameVi,
        };
        // Phần tử đầu là gợi ý chính khi bảng có khai `industryCode`.
        if (i === 0 && quyDoi.industryCode) phanNganh = muc;
        else phanNganhKhac.push(muc);
      }
    }
  }

  const nhomIcb = quyDoi
    ? `${quyDoi.tenIcb} (ICB cấp ${quyDoi.capDaDung})`
    : (tin.icb['4']?.ten ?? tin.icb['3']?.ten ?? tin.icb['2']?.ten ?? '');

  if (!nganh) {
    canhBao.push(
      nhomIcb
        ? `Chưa có quy đổi cho nhóm ICB "${nhomIcb}" — chọn ngành bằng tay.`
        : 'Nguồn không cho biết phân ngành của mã này — chọn ngành bằng tay.',
    );
  } else if (!phanNganh) {
    canhBao.push(
      phanNganhKhac.length > 0
        ? `Nhóm ICB "${nhomIcb}" trải trên nhiều phân ngành — chọn một trong các gợi ý.`
        : `Không có phân ngành nào trong master data ứng với "${nhomIcb}" — chọn bằng tay.`,
    );
  }

  return {
    ok: true,
    goiY: {
      symbol,
      tenCongTy: tin.ten,
      tenNgan: tin.ten_ngan,
      san,
      sanNguon: tin.san,
      nganh,
      phanNganh,
      phanNganhKhac,
      nhomIcb,
      canhBao,
    },
  };
}
