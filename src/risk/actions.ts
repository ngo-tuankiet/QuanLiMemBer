'use server';

/**
 * Server Action cho Risk (§19) — Phase 09.
 *
 * Ba nhóm hành động, ba quyền khác nhau:
 *   `risk.acknowledge_alert` → tiếp nhận cảnh báo ("tôi đã thấy, đang xử lý")
 *   `risk.manage_rules`      → sửa ngưỡng, bật/tắt rule
 *   `risk.view` + quét tay   → xem `rescanAction` bên dưới
 *
 * TIẾP NHẬN KHÔNG PHẢI ĐÓNG. Người dùng chỉ có thể chuyển cảnh báo sang
 * ACKNOWLEDGED; chỉ Risk Engine mới được chuyển sang RESOLVED, và chỉ khi đo lại
 * thấy điều kiện không còn đúng. Nếu cho người dùng tự đóng thì cảnh báo trở
 * thành thứ bấm cho hết việc, còn vi phạm thật vẫn nguyên đó — đúng thứ mà §19
 * tồn tại để ngăn.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { requirePermission, requestMeta } from '@/auth/guards';
import { ALERT_STATUS, AUDIT_ACTION, ENTITY_TYPE, SEVERITY } from '@/lib/enums';
import { runRiskScan } from '@/risk/scan';

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
  revalidatePath('/risk');
  revalidatePath('/dashboard');
  revalidatePath('/audit');
}

// ---------------------------------------------------------------------------
// Tiếp nhận cảnh báo
// ---------------------------------------------------------------------------

export async function acknowledgeAlertAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('risk.acknowledge_alert');

  const alertId = String(formData.get('alertId') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (!alertId) return { ok: false, message: 'Thiếu mã cảnh báo.' };

  const alert = await prisma.riskAlert.findUnique({
    where: { id: alertId },
    select: {
      id: true,
      status: true,
      title: true,
      severity: true,
      acknowledgedById: true,
      rule: { select: { code: true } },
    },
  });

  if (!alert) return { ok: false, message: 'Cảnh báo không tồn tại.' };

  if (alert.status === ALERT_STATUS.RESOLVED) {
    return { ok: false, message: 'Cảnh báo đã hết, không cần tiếp nhận.' };
  }
  if (alert.status === ALERT_STATUS.ACKNOWLEDGED) {
    return { ok: false, message: 'Cảnh báo đã được tiếp nhận trước đó.' };
  }

  const now = new Date();
  const meta = await requestMeta();

  await prisma.$transaction(async (tx) => {
    await tx.riskAlert.update({
      where: { id: alertId },
      data: {
        status: ALERT_STATUS.ACKNOWLEDGED,
        acknowledgedById: actor.id,
        acknowledgedAt: now,
      },
    });

    await writeAudit({
      actor,
      action: AUDIT_ACTION.UPDATE,
      entityType: ENTITY_TYPE.RISK_ALERT,
      entityId: alertId,
      entityLabel: `${alert.rule.code} · ${alert.title}`,
      before: { status: alert.status, acknowledgedById: alert.acknowledgedById },
      after: { status: ALERT_STATUS.ACKNOWLEDGED, acknowledgedById: actor.id },
      note: note || 'Tiếp nhận cảnh báo rủi ro',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      tx,
    });
  });

  refresh();
  return { ok: true, message: 'Đã tiếp nhận cảnh báo.' };
}

// ---------------------------------------------------------------------------
// Quét tay
// ---------------------------------------------------------------------------

/**
 * Quét lại ngay, bỏ qua cơ chế điều tiết.
 *
 * Quyền dùng là `risk.manage_rules`: đây là hành động GHI (sinh và đóng cảnh báo)
 * nên `risk.view` không đủ. Người chỉ được xem không nên có khả năng bắt hệ thống
 * chạy một tác vụ nền tuỳ ý.
 */
export async function rescanAction(_prev: unknown): Promise<ActionResult> {
  const actor = await requirePermission('risk.manage_rules');

  try {
    const result = await runRiskScan({ trigger: 'MANUAL', actorId: actor.id });
    refresh();
    return {
      ok: true,
      message:
        `Đã quét ${result.rulesEvaluated} ngưỡng trong ${result.durationMs} ms · ` +
        `mở ${result.opened} · cập nhật ${result.updated} · đóng ${result.resolved}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `Quét thất bại: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Ngưỡng rủi ro
// ---------------------------------------------------------------------------

/**
 * Chỉ cho sửa NGƯỠNG, MỨC NGHIÊM TRỌNG và BẬT/TẮT.
 *
 * `scope`, `metric` và `comparator` không sửa được qua giao diện: chúng quyết
 * định engine chạy nhánh code nào, nên đổi chúng là đổi ý nghĩa của rule chứ
 * không phải đổi cấu hình. Đổi `metric` của `STOCK_CONCENTRATION_10` sang
 * `DATA_DELAY_MINUTES` sẽ để lại một rule mang tên tập trung mã nhưng đo độ trễ
 * dữ liệu — và mọi cảnh báo lịch sử của nó thành vô nghĩa. Cần rule khác thì tạo
 * rule mới, đừng biến dạng rule cũ.
 */
const updateRuleSchema = z.object({
  ruleId: z.string().min(1),
  threshold: z
    .string()
    .trim()
    .regex(/^-?\d+$/, 'Ngưỡng phải là số nguyên.')
    .transform((v) => BigInt(v)),
  severity: z.enum([SEVERITY.INFO, SEVERITY.WARNING, SEVERITY.HIGH, SEVERITY.CRITICAL]),
  isActive: z.boolean(),
});

export async function updateRiskRuleAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('risk.manage_rules');

  const parsed = updateRuleSchema.safeParse({
    ruleId: formData.get('ruleId'),
    threshold: formData.get('threshold'),
    severity: formData.get('severity'),
    isActive: formData.get('isActive') === 'on',
  });

  if (!parsed.success) {
    return { ok: false, message: 'Kiểm tra lại thông tin.', fieldErrors: zodErrors(parsed.error) };
  }

  const { ruleId, threshold, severity, isActive } = parsed.data;

  const before = await prisma.riskRule.findUnique({
    where: { id: ruleId },
    select: {
      id: true,
      code: true,
      nameVi: true,
      metric: true,
      threshold: true,
      severity: true,
      isActive: true,
    },
  });

  if (!before) return { ok: false, message: 'Ngưỡng không tồn tại.' };

  if (
    before.threshold === threshold &&
    before.severity === severity &&
    before.isActive === isActive
  ) {
    return { ok: true, message: 'Không có gì thay đổi.' };
  }

  const meta = await requestMeta();

  await prisma.$transaction(async (tx) => {
    await tx.riskRule.update({
      where: { id: ruleId },
      data: { threshold, severity, isActive },
    });

    await writeAudit({
      actor,
      action: AUDIT_ACTION.UPDATE,
      entityType: ENTITY_TYPE.RISK_RULE,
      entityId: ruleId,
      entityLabel: `${before.code} · ${before.nameVi}`,
      before: {
        threshold: before.threshold,
        severity: before.severity,
        isActive: before.isActive,
      },
      after: { threshold, severity, isActive },
      note: `Sửa ngưỡng rủi ro (đơn vị theo metric ${before.metric})`,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      tx,
    });
  });

  /*
   * Quét lại NGAY sau khi sửa ngưỡng.
   *
   * Nếu không, người vừa hạ ngưỡng từ 10% xuống 5% sẽ thấy danh sách cảnh báo
   * không đổi và kết luận rằng việc sửa không có tác dụng. Đợi tới lượt quét
   * định kỳ là đúng về kỹ thuật nhưng sai về trải nghiệm.
   */
  try {
    await runRiskScan({ trigger: 'MANUAL', actorId: actor.id });
  } catch (error) {
    console.error('[risk] quét lại sau khi sửa ngưỡng thất bại:', error);
    refresh();
    return {
      ok: true,
      message: 'Đã lưu ngưỡng, nhưng lượt quét lại thất bại — xem lịch sử quét.',
    };
  }

  refresh();
  return { ok: true, message: `Đã lưu ngưỡng ${before.code} và quét lại.` };
}
