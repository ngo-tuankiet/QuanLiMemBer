'use server';

/**
 * Server Action cho Settings (§21) — Phase 10.
 *
 * Chỉ SỬA GIÁ TRỊ. Không tạo, không xoá: danh mục tham số do code định nghĩa
 * (`SETTING_SEED` trong src/data/master-data.ts), vì một tham số chỉ có ý nghĩa
 * khi có dòng code thật sự đọc nó. Cho Admin tự thêm khoá qua giao diện sẽ sinh
 * ra những tham số không ai đọc — trông như cấu hình được mà sửa không có tác
 * dụng gì, đúng cái bẫy đã gặp với `market_data.sync_interval_seconds`.
 *
 * Thêm tham số: thêm vào code rồi `npm run db:seed`.
 * Bỏ tham số:   bỏ khỏi code rồi `npx tsx scripts/prune-settings.ts --apply`.
 */

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { requirePermission, requestMeta } from '@/auth/guards';
import { AUDIT_ACTION, ENTITY_TYPE } from '@/lib/enums';
import { validateSettingValue } from '@/settings/bounds';

export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

export async function updateSettingAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('settings.update');

  const key = String(formData.get('key') ?? '');
  const raw = String(formData.get('value') ?? '');

  if (!key) return { ok: false, message: 'Thiếu khoá cấu hình.' };

  const setting = await prisma.systemSetting.findUnique({
    where: { key },
    select: {
      id: true,
      key: true,
      value: true,
      valueType: true,
      nameVi: true,
      isEditable: true,
    },
  });

  if (!setting) return { ok: false, message: 'Tham số không tồn tại.' };

  /*
   * `isEditable = false` được ép ở SERVER, không chỉ ẩn ô nhập trên giao diện.
   * Giao diện chỉ là gợi ý — ai cũng gửi được request tới một server action.
   */
  if (!setting.isEditable) {
    return { ok: false, message: 'Tham số này không cho sửa qua giao diện.' };
  }

  const checked = validateSettingValue(key, setting.valueType, raw);
  if (!checked.ok) {
    return { ok: false, fieldErrors: { value: [checked.error] } };
  }

  if (checked.value === setting.value) {
    return { ok: true, message: 'Không có gì thay đổi.' };
  }

  const meta = await requestMeta();

  await prisma.$transaction(async (tx) => {
    await tx.systemSetting.update({
      where: { key },
      data: { value: checked.value, updatedById: actor.id },
    });

    await writeAudit({
      actor,
      action: AUDIT_ACTION.UPDATE,
      entityType: ENTITY_TYPE.SETTING,
      entityId: setting.id,
      entityLabel: `${setting.key} · ${setting.nameVi}`,
      before: { value: setting.value },
      after: { value: checked.value },
      note: 'Sửa cấu hình hệ thống',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      tx,
    });
  });

  /*
   * Xoá cache của MỌI trang đọc cấu hình, không chỉ trang Settings.
   *
   * `market_data.stale_after_minutes` quyết định đèn "Market Data Delayed" trên
   * mọi trang; `trading.*` quyết định phí gợi ý ở form nhập lệnh. Chỉ revalidate
   * '/settings' sẽ khiến người sửa thấy giá trị mới ở đây mà số cũ vẫn hiện chỗ
   * khác — kiểu lỗi luôn bị báo là "hệ thống không lưu".
   */
  revalidatePath('/', 'layout');

  return { ok: true, message: `Đã lưu ${setting.key}.` };
}
