'use server';

/**
 * QUẢN LÝ DANH MỤC IB (Introducing Broker).
 *
 * VÌ SAO CÓ FILE NÀY. `broker_accounts.ibName` từng là ô chữ người dùng tự gõ. Ô tự gõ
 * thì "Bùi Hải", "bùi hải" và "Bui Hai" chắc chắn cùng xuất hiện, và trên Dashboard một
 * IB bị tách thành ba dòng, mỗi dòng mang một phần vốn. Cái sai đó trông y hệt dữ liệu
 * thật nên không ai kiểm lại — `computeIbExposure` đã phải gộp theo tên chuẩn hoá để
 * chữa hậu quả. Chọn từ danh mục thì không còn gì để chữa.
 *
 * BA NGUYÊN TẮC, giống mọi action quản trị khác:
 *
 *   1. `requirePermission()` gác ngay dòng đầu — không dựa vào việc giao diện có hiện
 *      nút hay không, vì URL và form đều gửi tay được.
 *   2. Ghi Audit Log before/after cho mọi thay đổi (§20).
 *   3. Không xoá, chỉ tắt. Xoá một IB sẽ làm `broker_accounts.ibId` mồ côi — tài khoản
 *      vẫn còn nhưng không tra được nó thuộc IB nào, và số liệu theo IB trên Dashboard
 *      hụt đi mà không có gì báo.
 *
 * `code` KHÔNG SỬA ĐƯỢC SAU KHI TẠO — cùng lý do như mã phòng ban và mã nhóm: nó là thứ
 * người vận hành dùng để gọi tên IB giữa các bảng biểu và giấy tờ ngoài hệ thống. Tên
 * hiển thị thì sửa thoải mái, vì tài khoản trỏ vào `id` chứ không trỏ vào tên.
 */

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { requirePermission, requestMeta } from '@/auth/guards';
import { introducingBrokerSchema, zodErrors } from '@/domain/validation';
import { AUDIT_ACTION, BROKER, ENTITY_TYPE } from '@/lib/enums';

export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

function lamMoi(): void {
  revalidatePath('/admin/organization');
  revalidatePath('/profile');
  revalidatePath('/dashboard');
  revalidatePath('/transactions/new');
}

/**
 * So tên công ty khi sàn là "Khác": bỏ qua hoa/thường và khoảng trắng thừa.
 *
 * Cùng quy tắc với `kiemIb` bên accounts/actions.ts. Hai chỗ so khác nhau thì một
 * cặp sẽ "cùng sàn" ở chỗ này và "khác sàn" ở chỗ kia.
 */
function chuanHoaTenSan(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function saveIbAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('ib.manage');

  const id = String(formData.get('id') ?? '') || undefined;

  const parsed = introducingBrokerSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    broker: formData.get('broker'),
    brokerOther: String(formData.get('brokerOther') ?? '') || undefined,
    note: String(formData.get('note') ?? '') || undefined,
    sortOrder: formData.get('sortOrder'),
    buyFeeRateBps: String(formData.get('buyFeeRateBps') ?? ''),
    sellFeeRateBps: String(formData.get('sellFeeRateBps') ?? ''),
    sellTaxRateBps: String(formData.get('sellTaxRateBps') ?? ''),
  });

  if (!parsed.success) {
    return { ok: false, message: 'Kiểm tra lại thông tin.', fieldErrors: zodErrors(parsed.error) };
  }

  const input = parsed.data;
  const meta = await requestMeta();

  /*
   * Mã trùng là lỗi nghiệp vụ, không phải lỗi hệ thống — bắt trước để trả câu tiếng
   * Việt. Ràng buộc unique ở database vẫn là chốt cuối khi hai người bấm cùng lúc.
   */
  const trung = await prisma.introducingBroker.findUnique({
    where: { code: input.code },
    select: { id: true },
  });
  if (trung && trung.id !== id) {
    return { ok: false, fieldErrors: { code: [`Mã ${input.code} đã có IB khác dùng.`] } };
  }

  if (id) {
    const before = await prisma.introducingBroker.findUnique({
      where: { id },
      include: { _count: { select: { accounts: true } } },
    });
    if (!before) return { ok: false, message: 'Không tìm thấy IB.' };

    /*
     * ĐỔI SÀN ĐƯỢC KHI SÀN MỚI KHỚP VỚI MỌI TÀI KHOẢN ĐANG GẮN.
     *
     * Bản trước chặn cứng: IB có tài khoản thì không đổi sàn, phải chuyển hết tài
     * khoản đi trước. Lý do đúng — đổi sàn sẽ biến mọi tài khoản đó thành khác sàn
     * với IB của chúng cùng lúc, âm thầm, vì bảng vẫn hiện tên IB và biểu đồ vẫn gom
     * vốn bình thường.
     *
     * NHƯNG NÓ CHẶN LUÔN CA CẦN SỬA NHẤT. Khi chính cột `broker` bị điền sai — ví dụ
     * một migration thêm cột và không mang dữ liệu cũ theo — thì mọi IB có tài khoản
     * đều mắc kẹt: sàn sai, không sửa được, và cũng không chuyển tài khoản đi đâu
     * được vì ô chọn IB đã lọc theo đúng cái sàn sai đó. Một chốt khoá cả đường
     * thoát không phải chốt an toàn.
     *
     * Phép kiểm đúng không phải "có tài khoản hay không" mà là "sàn mới có khớp với
     * tài khoản hay không". Khớp hết thì việc đổi chính là SỬA cho đúng, và sau khi
     * đổi không còn cặp nào khác sàn. Không khớp thì vẫn chặn, và nói rõ tài khoản
     * nào đang cản.
     */
    /*
     * ĐỔI TÊN CÔNG TY CŨNG LÀ ĐỔI SÀN, khi sàn là "Khác".
     *
     * Hai công ty khác nhau đều mang mã `OTHER`, nên so riêng `broker` sẽ thấy
     * "không đổi gì" trong khi IB vừa chuyển từ Chứng khoán Alpha sang Beta. Bài kiểm
     * bắt đúng lỗ này: nó cho qua một thay đổi lẽ ra phải bị chặn.
     */
    const doiSan =
      input.broker !== before.broker ||
      (input.broker === BROKER.OTHER &&
        chuanHoaTenSan(input.brokerOther) !== chuanHoaTenSan(before.brokerOther));

    if (doiSan && before._count.accounts > 0) {
      const dangGan = await prisma.brokerAccount.findMany({
        where: { ibId: id },
        select: { broker: true, brokerOther: true, accountNo: true },
      });

      const lech = dangGan.filter(
        (a) =>
          a.broker !== input.broker ||
          (input.broker === BROKER.OTHER &&
            chuanHoaTenSan(a.brokerOther) !== chuanHoaTenSan(input.brokerOther)),
      );

      if (lech.length > 0) {
        return {
          ok: false,
          fieldErrors: {
            broker: [
              `${lech.length}/${dangGan.length} tài khoản đang gắn KHÔNG mở tại ` +
                `${input.broker}: ` +
                lech.map((a) => `${a.broker} ${a.accountNo}`).slice(0, 5).join(
) +
                (lech.length > 5 ? '…' : '') +
                '. Đổi sàn chỉ được khi khớp với mọi tài khoản đang gắn.',
            ],
          },
        };
      }
    }

    const after = await prisma.introducingBroker.update({
      where: { id },
      data: {
        name: input.name,
        broker: input.broker,
        brokerOther: input.broker === BROKER.OTHER ? (input.brokerOther ?? null) : null,
        note: input.note ?? null,
        sortOrder: input.sortOrder,
        /*
         * `?? null` chứ không `|| null`: 0 là một mức phí hợp lệ ("miễn phí"), và
         * `||` sẽ biến nó thành null tức "theo mức chung" — sai hẳn ý người khai.
         */
        buyFeeRateBps: input.buyFeeRateBps ?? null,
        sellFeeRateBps: input.sellFeeRateBps ?? null,
        sellTaxRateBps: input.sellTaxRateBps ?? null,
      },
    });

    await writeAudit({
      actor,
      action: AUDIT_ACTION.UPDATE,
      entityType: ENTITY_TYPE.INTRODUCING_BROKER,
      entityId: id,
      entityLabel: after.name,
      before: { ...before, _count: undefined },
      after,
      ...meta,
    });

    lamMoi();
    return { ok: true, message: `Đã cập nhật IB ${after.code}.` };
  }

  const created = await prisma.introducingBroker.create({
    data: {
      code: input.code,
      name: input.name,
      broker: input.broker,
      brokerOther: input.broker === BROKER.OTHER ? (input.brokerOther ?? null) : null,
      note: input.note ?? null,
      sortOrder: input.sortOrder,
      buyFeeRateBps: input.buyFeeRateBps ?? null,
      sellFeeRateBps: input.sellFeeRateBps ?? null,
      sellTaxRateBps: input.sellTaxRateBps ?? null,
    },
  });

  await writeAudit({
    actor,
    action: AUDIT_ACTION.CREATE,
    entityType: ENTITY_TYPE.INTRODUCING_BROKER,
    entityId: created.id,
    entityLabel: created.name,
    after: created,
    ...meta,
  });

  lamMoi();
  return { ok: true, message: `Đã thêm IB ${created.code} — ${created.name}.` };
}

/**
 * Bật / tắt một IB.
 *
 * TẮT KHÔNG ĐỘNG TỚI TÀI KHOẢN ĐÃ GẮN. Nó chỉ có nghĩa "không khai mới theo IB này
 * nữa": ô chọn trong form khai tài khoản bỏ IB đã tắt đi, còn `kiemIb` trong
 * `accounts/actions.ts` từ chối nếu ai đó gửi tay `ibId` của một IB đã tắt. Tài khoản
 * cũ vẫn hiện đúng tên IB, và số liệu theo IB trên Dashboard vẫn đủ.
 */
export async function toggleIbAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const actor = await requirePermission('ib.manage');

  const id = String(formData.get('id') ?? '');
  const before = await prisma.introducingBroker.findUnique({
    where: { id },
    select: { id: true, code: true, name: true, isActive: true, _count: { select: { accounts: true } } },
  });
  if (!before) return { ok: false, message: 'Không tìm thấy IB.' };

  const meta = await requestMeta();
  const after = await prisma.introducingBroker.update({
    where: { id },
    data: { isActive: !before.isActive },
  });

  await writeAudit({
    actor,
    action: AUDIT_ACTION.UPDATE,
    entityType: ENTITY_TYPE.INTRODUCING_BROKER,
    entityId: id,
    entityLabel: before.name,
    before: { isActive: before.isActive },
    after: { isActive: after.isActive },
    ...meta,
  });

  lamMoi();

  if (after.isActive) return { ok: true, message: `Đã bật lại IB ${before.code}.` };

  const soTk = before._count.accounts;
  return {
    ok: true,
    message: soTk
      ? `Đã tắt IB ${before.code}. ${soTk} tài khoản đang gắn IB này vẫn giữ nguyên.`
      : `Đã tắt IB ${before.code}.`,
  };
}
