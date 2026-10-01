'use server';

/**
 * QUẢN LÝ CHIẾN LƯỢC ĐẦU TƯ (§6).
 *
 * Quyền `strategy.create` / `strategy.update` đã được khai từ đầu nhưng chưa có gì dùng
 * tới — chiến lược chỉ tồn tại trong `master-data.ts` và phải chạy `npm run db:seed` mới
 * đổi được. Đây là phần bù lại, cùng lối với `org-actions.ts`.
 *
 * CHIẾN LƯỢC KHÁC NHÓM Ở MỘT ĐIỂM QUAN TRỌNG: nó không chỉ là một cái nhãn. Mỗi lệnh
 * phải chia hết 100% cho các chiến lược (§6), và `computeStrategyAllocation` CHỈ liệt kê
 * chiến lược đang bật. Đóng một chiến lược còn giữ cổ phiếu sẽ làm phần vốn đó biến mất
 * khỏi mọi biểu đồ phân bổ, và bất biến "Σ vốn theo chiến lược = Σ giá vốn vị thế mở" vỡ
 * — im lặng, vì biểu đồ vẫn trông hoàn chỉnh. Xem `kiemDongChienLuoc`.
 */

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { requirePermission, requestMeta } from '@/auth/guards';
import { strategySchema, zodErrors } from '@/domain/validation';
import { computeStrategyAllocation } from '@/domain/portfolio-engine';
import { formatVnd } from '@/lib/money';
import { AUDIT_ACTION, ENTITY_TYPE, PORTFOLIO_STATUS } from '@/lib/enums';

export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

function lamMoi(): void {
  revalidatePath('/strategies');
  revalidatePath('/admin/strategies');
  revalidatePath('/dashboard');
  revalidatePath('/portfolio/allocation');
  revalidatePath('/transactions/new');
}

export async function saveStrategyAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const id = String(formData.get('id') ?? '') || undefined;
  const actor = await requirePermission(id ? 'strategy.update' : 'strategy.create');

  /*
   * ĐỔI PHẦN TRĂM SANG BASIS POINT TRƯỚC KHI PARSE.
   *
   * Form nhập "40" vì người dùng nghĩ bằng phần trăm, còn `strategySchema` nhận
   * `maxAllocationBps` vì database lưu số nguyên để không bao giờ phải so sánh số thực
   * (4000 = 40%). Phép đổi đặt ở đây — đúng biên nhập liệu — nên nó chỉ tồn tại một chỗ.
   *
   * Kiểm khoảng 0–100 TRƯỚC khi nhân 100: "1000" nhập nhầm sẽ thành 100.000 bps và lọt
   * qua `bps` nếu schema chỉ chặn số âm. Bắt ở đơn vị người dùng gõ thì thông báo cũng
   * nói bằng đơn vị đó.
   */
  const phanTramRaw = String(formData.get('maxAllocationPercent') ?? '').trim();
  const phanTram = phanTramRaw === '' ? undefined : Number(phanTramRaw.replace(',', '.'));

  if (phanTram !== undefined && (!Number.isFinite(phanTram) || phanTram < 0 || phanTram > 100)) {
    return { ok: false, fieldErrors: { maxAllocationBps: ['Hạn mức phải từ 0 đến 100%.'] } };
  }

  const parsed = strategySchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    nameVi: formData.get('nameVi'),
    description: String(formData.get('description') ?? '') || undefined,
    colorHex: String(formData.get('colorHex') ?? '') || undefined,
    sortOrder: formData.get('sortOrder'),
    maxAllocationBps: phanTram === undefined ? undefined : Math.round(phanTram * 100),
  });

  if (!parsed.success) {
    return { ok: false, message: 'Kiểm tra lại thông tin.', fieldErrors: zodErrors(parsed.error) };
  }

  const input = parsed.data;
  const meta = await requestMeta();

  const trung = await prisma.strategy.findUnique({
    where: { code: input.code },
    select: { id: true },
  });
  if (trung && trung.id !== id) {
    return { ok: false, fieldErrors: { code: [`Mã ${input.code} đã có chiến lược khác dùng.`] } };
  }

  const data = {
    code: input.code,
    name: input.name,
    nameVi: input.nameVi,
    description: input.description ?? null,
    colorHex: input.colorHex ?? null,
    sortOrder: input.sortOrder,
    maxAllocationBps: input.maxAllocationBps ?? null,
  };

  if (id) {
    const before = await prisma.strategy.findUnique({ where: { id } });
    if (!before) return { ok: false, message: 'Không tìm thấy chiến lược.' };

    const after = await prisma.strategy.update({ where: { id }, data });

    await writeAudit({
      actor,
      action: AUDIT_ACTION.UPDATE,
      entityType: ENTITY_TYPE.STRATEGY,
      entityId: id,
      entityLabel: after.nameVi,
      before,
      after,
      note: 'Sửa chiến lược',
      ...meta,
    });

    lamMoi();
    return { ok: true, message: `Đã cập nhật chiến lược ${after.nameVi}.` };
  }

  const created = await prisma.strategy.create({ data });

  await writeAudit({
    actor,
    action: AUDIT_ACTION.CREATE,
    entityType: ENTITY_TYPE.STRATEGY,
    entityId: created.id,
    entityLabel: created.nameVi,
    after: created,
    note: 'Tạo chiến lược',
    ...meta,
  });

  lamMoi();
  return { ok: true, message: `Đã tạo chiến lược ${created.nameVi}.` };
}

/**
 * Chiến lược này đóng được chưa. Trả câu tiếng Việt, hoặc `null` nếu đóng được.
 *
 * ĐIỀU KIỆN DUY NHẤT: không còn vốn nào đang nằm trong chiến lược đó.
 *
 * `computeStrategyAllocation` chỉ liệt kê chiến lược `isActive: true`. Đóng một chiến
 * lược còn giữ cổ phiếu thì phần vốn ấy biến mất khỏi biểu đồ phân bổ mà tổng vẫn trông
 * hợp lý — kiểu sai tệ nhất, vì không có gì trên màn hình gợi ý rằng thiếu. Bất biến
 * "Σ vốn theo chiến lược = Σ giá vốn vị thế đang mở" cũng vỡ theo.
 *
 * KHÔNG chặn theo "đã từng có lệnh": một chiến lược đã thoát sạch vị thế thì đóng lại là
 * hợp lý, và lịch sử lệnh vẫn giữ nguyên vì `trade_strategies` không bị đụng tới.
 */
export async function kiemDongChienLuoc(strategyId: string): Promise<string | null> {
  const danhMuc = await prisma.portfolio.findMany({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    select: { id: true },
  });

  let von = 0n;
  for (const p of danhMuc) {
    const rows = await computeStrategyAllocation({ portfolioId: p.id });
    von += rows.find((r) => r.strategyId === strategyId)?.netCapital ?? 0n;
  }

  if (von === 0n) return null;

  return (
    `Chưa đóng được: còn ${formatVnd(von)} vốn đang nằm trong chiến lược này. ` +
    'Bán hết phần vị thế thuộc chiến lược đó trước khi đóng.'
  );
}

export async function toggleStrategyAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('strategy.update');
  const id = String(formData.get('id') ?? '');

  const before = await prisma.strategy.findUnique({ where: { id } });
  if (!before) return { ok: false, message: 'Không tìm thấy chiến lược.' };

  // Chỉ kiểm khi ĐANG ĐÓNG. Mở lại không cần điều kiện — nó chỉ đưa chiến lược về danh sách.
  if (before.isActive) {
    const loi = await kiemDongChienLuoc(id);
    if (loi) return { ok: false, message: loi };
  }

  const meta = await requestMeta();
  const after = await prisma.strategy.update({
    where: { id },
    data: { isActive: !before.isActive },
  });

  await writeAudit({
    actor,
    action: AUDIT_ACTION.UPDATE,
    entityType: ENTITY_TYPE.STRATEGY,
    entityId: id,
    entityLabel: after.nameVi,
    before,
    after,
    note: after.isActive ? 'Mở lại chiến lược' : 'Đóng chiến lược',
    ...meta,
  });

  lamMoi();
  return { ok: true, message: after.isActive ? 'Đã mở lại chiến lược.' : 'Đã đóng chiến lược.' };
}
