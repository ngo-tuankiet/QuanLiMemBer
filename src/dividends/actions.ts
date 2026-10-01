'use server';

/**
 * BỎ QUA / HOÀN TÁC một mục trong danh sách cổ tức đang chờ.
 *
 * "Ghi nhận" đi qua `recordDividendAction` — nó tạo bản ghi cổ tức và đánh dấu mục
 * trong cùng một transaction. File này chỉ lo hai việc còn lại:
 *
 *   BỎ QUA   sàn báo tài khoản không được hưởng, dữ liệu nguồn sai, hoặc đã xử lý
 *            quyền mua bằng một lệnh mua. BẮT BUỘC có lý do: một mục biến mất không
 *            lời giải thích là một khoản tiền có thể đã bị bỏ sót mà không ai biết.
 *   HOÀN TÁC chỉ cho mục ĐÃ BỎ QUA. Mục đã ghi thì hoàn tác bằng cách xoá chính bản
 *            ghi cổ tức — dòng đánh dấu xoá theo (`onDelete: Cascade`) và mục tự quay
 *            lại danh sách. Hai đường cho cùng một việc là hai chỗ để lệch nhau.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { requestMeta, requireUser } from '@/auth/guards';
import { ghiDuoc } from '@/dividends/scope';
import { computePendingCorporateEvents } from '@/dividends/pending';
import { AUDIT_ACTION, ENTITY_TYPE, EVENT_RESOLUTION } from '@/lib/enums';

export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

const boQuaSchema = z.object({
  eventId: z.string().trim().min(1).max(64),
  accountId: z.string().trim().min(1).max(64),
  reason: z
    .string()
    .trim()
    .min(3, 'Ghi lý do bỏ qua — ít nhất vài chữ')
    .max(300, 'Lý do quá dài'),
});

export async function dismissCorporateEventAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();

  const parsed = boQuaSchema.safeParse({
    eventId: formData.get('eventId'),
    accountId: formData.get('accountId'),
    reason: formData.get('reason') ?? '',
  });
  if (!parsed.success) {
    const loi = parsed.error.flatten().fieldErrors;
    return { ok: false, fieldErrors: { reason: loi.reason ?? ['Thiếu thông tin.'] } };
  }
  const { eventId, accountId, reason } = parsed.data;

  const tk = await prisma.brokerAccount.findUnique({
    where: { id: accountId },
    select: { userId: true, accountNo: true, user: { select: { fullName: true, teamId: true } } },
  });
  if (!tk) return { ok: false, message: 'Không tìm thấy tài khoản.' };
  if (!ghiDuoc(actor, { id: tk.userId, teamId: tk.user.teamId })) {
    return { ok: false, message: 'Tài khoản này không thuộc phạm vi bạn quản lý.' };
  }

  /*
   * Chỉ bỏ qua được mục ĐANG CHỜ. Không kiểm thì gửi tay một cặp (sự kiện, tài khoản)
   * bất kỳ cũng tạo được dòng DISMISSED — vô hại hôm nay, nhưng nó chặn trước một mục
   * mà ngày mai (khi lệnh được sửa) lẽ ra phải hiện ra.
   */
  const muc = (
    await computePendingCorporateEvents(
      { loai: 'ALL', userId: actor.id },
      { onlyAccountId: accountId, onlyEventId: eventId },
    )
  )[0];
  if (!muc) {
    return { ok: false, message: 'Mục này không còn chờ ghi nhận. Tải lại trang.' };
  }

  try {
    await prisma.corporateEventResolution.create({
      data: {
        eventId,
        brokerAccountId: accountId,
        status: EVENT_RESOLUTION.DISMISSED,
        reason,
        resolvedById: actor.id,
      },
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002') {
      return { ok: false, message: 'Mục này vừa được người khác xử lý. Tải lại trang.' };
    }
    throw error;
  }

  await writeAudit({
    actor,
    action: AUDIT_ACTION.UPDATE,
    entityType: ENTITY_TYPE.CORPORATE_EVENT,
    entityId: eventId,
    entityLabel: `Bỏ qua ${muc.symbol} · ${muc.titleVi} · TK ${tk.accountNo}`,
    after: {
      trangThai: EVENT_RESOLUTION.DISMISSED,
      lyDo: reason,
      khoiLuongHuong: muc.eligibleQuantity,
      duKienTien: muc.expectedCash.toString(),
      duKienCoPhieu: muc.expectedShares,
      ghiHoCho: tk.userId !== actor.id ? tk.user.fullName : null,
    },
    note: reason,
    ...(await requestMeta()),
  });

  revalidatePath('/transactions/dividend');
  return { ok: true, message: `Đã bỏ qua ${muc.symbol} cho tài khoản ${tk.accountNo}.` };
}

export async function undoDismissCorporateEventAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireUser();
  const id = String(formData.get('resolutionId') ?? '').trim();
  if (!id) return { ok: false, message: 'Thiếu mục cần hoàn tác.' };

  const r = await prisma.corporateEventResolution.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      reason: true,
      eventId: true,
      event: { select: { titleVi: true, stock: { select: { symbol: true } } } },
      brokerAccount: {
        select: { accountNo: true, userId: true, user: { select: { teamId: true } } },
      },
    },
  });
  if (!r) return { ok: false, message: 'Mục này đã được hoàn tác rồi.' };
  if (r.status !== EVENT_RESOLUTION.DISMISSED) {
    return {
      ok: false,
      message: 'Mục đã ghi nhận thì hoàn tác bằng cách xoá bản ghi cổ tức, không hoàn tác ở đây.',
    };
  }
  if (!ghiDuoc(actor, { id: r.brokerAccount.userId, teamId: r.brokerAccount.user.teamId })) {
    return { ok: false, message: 'Tài khoản này không thuộc phạm vi bạn quản lý.' };
  }

  await prisma.corporateEventResolution.delete({ where: { id } });

  await writeAudit({
    actor,
    action: AUDIT_ACTION.UPDATE,
    entityType: ENTITY_TYPE.CORPORATE_EVENT,
    entityId: r.eventId,
    entityLabel: `Hoàn tác bỏ qua ${r.event.stock.symbol} · TK ${r.brokerAccount.accountNo}`,
    before: { trangThai: EVENT_RESOLUTION.DISMISSED, lyDo: r.reason },
    after: { trangThai: 'PENDING' },
    ...(await requestMeta()),
  });

  revalidatePath('/transactions/dividend');
  return { ok: true, message: `${r.event.stock.symbol} đã quay lại danh sách chờ.` };
}
