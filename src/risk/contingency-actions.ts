'use server';

/**
 * LƯU KẾ HOẠCH DỰ PHÒNG CỦA MỘT CHIẾN LƯỢC — ba mức, mỗi mức một ngưỡng rủi ro.
 *
 * Xem `src/risk/contingency.ts` cho lý do lưu thành `risk_rules`. Action này là chỗ DUY
 * NHẤT tạo và sửa các ngưỡng đó: nó kiểm ba mức cùng lúc (mức sau phải lỗ sâu hơn mức
 * trước), việc mà form sửa từng ngưỡng một không làm được.
 */

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { requirePermission, requestMeta } from '@/auth/guards';
import { runRiskScan } from '@/risk/scan';
import {
  DO_NGHIEM_TRONG,
  SO_MUC,
  kiemThuTuMuc,
  maNguong,
  type MucDuPhong,
} from '@/risk/contingency';
import {
  ALERT_STATUS,
  AUDIT_ACTION,
  COMPARATOR,
  ENTITY_TYPE,
  RISK_METRIC,
  RISK_SCOPE,
} from '@/lib/enums';

export interface ActionResult {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

const CAC_MUC: readonly MucDuPhong[] = [1, 2, 3];

/**
 * "7", "7,5", "7.5", "-7" → 750 bps. Ô trống → null (mức đó không dùng).
 *
 * NHẬN CẢ DẤU TRỪ và bỏ đi: người điền nghĩ "lỗ 7%" và rất hay gõ "-7". Từ chối nó là
 * bắt người dùng đoán quy ước; hiểu nó là lỗ 7% thì không có cách hiểu nào khác.
 */
function docPhanTram(raw: FormDataEntryValue | null): number | null | 'LOI' {
  const s = String(raw ?? '').trim().replace(/^-/, '').replace(',', '.').replace(/%$/, '').trim();
  if (s === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return 'LOI';
  const bps = Math.round(Number(s) * 100);
  return bps >= 10 && bps <= 10_000 ? bps : 'LOI';
}

export async function saveContingencyPlanAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requirePermission('risk.manage_rules');

  const strategyId = String(formData.get('strategyId') ?? '').trim();
  const batKeHoach = formData.get('isActive') === 'on';

  const strategy = await prisma.strategy.findUnique({
    where: { id: strategyId },
    select: { id: true, code: true, name: true, nameVi: true },
  });
  if (!strategy) return { ok: false, message: 'Không tìm thấy chiến lược.' };

  // --- Đọc và kiểm ba mức ---------------------------------------------------
  const fieldErrors: Record<string, string[]> = {};
  const muc: { muc: MucDuPhong; nguongBps: number | null; hanhDong: string | null }[] = [];

  for (const m of CAC_MUC) {
    const bps = docPhanTram(formData.get(`level${m}`));
    const hanhDong = String(formData.get(`action${m}`) ?? '').trim().slice(0, 300) || null;
    if (bps === 'LOI') {
      fieldErrors[`level${m}`] = ['Nhập % lỗ từ 0,1 đến 100, ví dụ 7 hoặc 7,5.'];
      continue;
    }
    if (bps === null && hanhDong) {
      fieldErrors[`level${m}`] = ['Có hành động nhưng chưa có % lỗ.'];
      continue;
    }
    muc.push({ muc: m, nguongBps: bps, hanhDong });
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: 'Kiểm tra lại các mức.', fieldErrors };
  }

  const loiThuTu = kiemThuTuMuc(muc);
  if (loiThuTu) return { ok: false, message: loiThuTu };

  const coMuc = muc.some((m) => m.nguongBps !== null);
  if (batKeHoach && !coMuc) {
    return { ok: false, message: 'Bật kế hoạch thì phải có ít nhất một mức.' };
  }

  // --- Ghi ------------------------------------------------------------------
  const cu = await prisma.riskRule.findMany({
    where: { code: { in: CAC_MUC.map((m) => maNguong(strategy.id, m)) } },
    select: { id: true, code: true, threshold: true, isActive: true, description: true },
  });
  const cuTheoMa = new Map(cu.map((r) => [r.code, r]));

  const meta = await requestMeta();
  const tatNguong: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const m of muc) {
      const code = maNguong(strategy.id, m.muc);
      const coSan = cuTheoMa.get(code);

      if (m.nguongBps === null) {
        /*
         * MỨC BỊ XOÁ: tắt ngưỡng và đưa ngưỡng về 0.
         *
         * Không xoá dòng — cảnh báo cũ còn trỏ vào nó. Ngưỡng 0 là dấu "mức này không
         * dùng": chỉ tắt thì không phân biệt được với "cả kế hoạch đang tắt", và lần mở
         * trang sau form sẽ điền lại con số mà người dùng vừa xoá.
         */
        if (coSan && (coSan.isActive || coSan.threshold !== 0n)) {
          await tx.riskRule.update({
            where: { id: coSan.id },
            data: { isActive: false, threshold: 0n, description: null },
          });
          if (coSan.isActive) tatNguong.push(coSan.id);
        }
        continue;
      }

      const data = {
        name: `Contingency · ${strategy.name} · level ${m.muc}`,
        nameVi: `Dự phòng · ${strategy.nameVi} · Mức ${m.muc}`,
        scope: RISK_SCOPE.STRATEGY_POSITION,
        metric: RISK_METRIC.POSITION_LOSS_BPS,
        comparator: COMPARATOR.GTE,
        threshold: BigInt(m.nguongBps),
        severity: DO_NGHIEM_TRONG[m.muc],
        targetRef: strategy.id,
        portfolioId: null,
        isActive: batKeHoach,
        description: m.hanhDong,
      };

      if (coSan) {
        await tx.riskRule.update({ where: { id: coSan.id }, data });
        if (coSan.isActive && !batKeHoach) tatNguong.push(coSan.id);
      } else {
        await tx.riskRule.create({ data: { code, ...data, createdById: actor.id } });
      }
    }

    /*
     * TẮT KẾ HOẠCH THÌ ĐÓNG LUÔN CẢNH BÁO CỦA NÓ.
     *
     * Engine cố ý giữ mở cảnh báo của một ngưỡng vừa bị tắt ("người tắt cần thấy hậu
     * quả"). Với kế hoạch dự phòng thì khác: người quản lý chủ động bỏ một mức hoặc tắt
     * cả kế hoạch, và để lại "Dự phòng mức 2: PNJ" treo mãi trên chuông là báo một việc
     * mà chính họ vừa nói không còn cần làm.
     */
    if (tatNguong.length > 0) {
      await tx.riskAlert.updateMany({
        where: {
          ruleId: { in: tatNguong },
          status: { in: [ALERT_STATUS.OPEN, ALERT_STATUS.ACKNOWLEDGED] },
        },
        data: { status: ALERT_STATUS.RESOLVED, resolvedAt: new Date() },
      });
    }

    await writeAudit({
      actor,
      action: AUDIT_ACTION.UPDATE,
      entityType: ENTITY_TYPE.STRATEGY,
      entityId: strategy.id,
      entityLabel: `Kế hoạch dự phòng · ${strategy.nameVi}`,
      before: cu.map((r) => ({
        code: r.code,
        nguongBps: r.threshold.toString(),
        batKeHoach: r.isActive,
        hanhDong: r.description,
      })),
      after: {
        batKeHoach,
        muc: muc.map((m) => ({ muc: m.muc, nguongBps: m.nguongBps, hanhDong: m.hanhDong })),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      tx,
    });
  });

  revalidatePath('/admin/contingency');
  revalidatePath('/risk');
  revalidatePath('/dashboard');

  /*
   * Quét lại ngay — cùng lý do với việc sửa ngưỡng thường: người vừa đặt "lỗ 7%" phải
   * thấy ngay những mã đang chạm mức đó, không phải đợi lượt quét kế tiếp.
   */
  try {
    await runRiskScan({ trigger: 'MANUAL', actorId: actor.id });
  } catch (error) {
    console.error('[duphong] quét lại sau khi lưu kế hoạch thất bại:', error);
    return { ok: true, message: 'Đã lưu kế hoạch, nhưng lượt quét lại thất bại — xem lịch sử quét.' };
  }

  return {
    ok: true,
    message: batKeHoach
      ? `Đã lưu kế hoạch ${strategy.nameVi} (${muc.filter((m) => m.nguongBps !== null).length}/${SO_MUC} mức) và quét lại.`
      : `Đã tắt kế hoạch ${strategy.nameVi}.`,
  };
}
