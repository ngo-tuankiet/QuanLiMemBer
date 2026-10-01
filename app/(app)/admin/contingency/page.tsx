import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { mauChienLuoc } from '@/components/charts';
import { ContingencyForm, type MucForm } from './ContingencyForm';
import { maNguong, mucCuaMaNguong, type MucDuPhong } from '@/risk/contingency';
import { formatBps } from '@/lib/money';
import { ALERT_STATUS, RISK_SCOPE } from '@/lib/enums';

export const metadata: Metadata = { title: 'Kế hoạch dự phòng' };

/** 750 bps → "7,5" để điền sẵn vào ô. */
function bpsSangO(bps: bigint): string {
  const n = Number(bps) / 100;
  return n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
}

const DOT: Record<MucDuPhong, string> = { 1: '🟡', 2: '🟠', 3: '🔴' };

/**
 * KẾ HOẠCH DỰ PHÒNG THEO CHIẾN LƯỢC.
 *
 * Mỗi chiến lược ba mức lỗ. Khi một mã của chiến lược lỗ (trên giá vốn bình quân phần
 * thuộc chiến lược, gộp mọi tài khoản) chạm một mức, hệ thống bắn cảnh báo kèm hành động
 * đã ghi. Cảnh báo đi qua hệ thống rủi ro sẵn có — xem `src/risk/contingency.ts`.
 *
 * Trang hiện luôn các mã ĐANG chạm mức của từng chiến lược, để người đặt kế hoạch thấy
 * ngay hệ quả của con số vừa nhập.
 */
export default async function ContingencyPage() {
  await requirePagePermission('risk.manage_rules');

  const [strategies, rules, alerts] = await Promise.all([
    prisma.strategy.findMany({
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, nameVi: true, isActive: true, colorHex: true, sortOrder: true },
    }),
    prisma.riskRule.findMany({
      where: { scope: RISK_SCOPE.STRATEGY_POSITION },
      select: { id: true, code: true, targetRef: true, threshold: true, isActive: true, description: true },
    }),
    prisma.riskAlert.findMany({
      where: {
        status: { in: [ALERT_STATUS.OPEN, ALERT_STATUS.ACKNOWLEDGED] },
        rule: { scope: RISK_SCOPE.STRATEGY_POSITION },
      },
      orderBy: { measuredValue: 'desc' },
      select: {
        targetRef: true,
        measuredValue: true,
        rule: { select: { code: true, targetRef: true } },
      },
    }),
  ]);

  const quyTac = new Map(rules.map((r) => [r.code, r]));

  return (
    <>
      <PageHeader
        title="Kế hoạch dự phòng"
        subtitle="Mỗi chiến lược ba mức lỗ · cảnh báo tới admin và các cấp quản lý khi một mã chạm mức"
      />

      <Card className="mb-4 p-4">
        <ul className="space-y-1 text-tiny leading-relaxed text-slate-muted">
          <li>
            <span className="text-slate-soft">Mức lỗ</span> tính trên giá vốn bình quân của phần vị
            thế thuộc chiến lược, gộp mọi tài khoản — đúng con số khi lọc trang Vị thế theo chiến lược
            đó.
          </li>
          <li>
            <span className="text-slate-soft">Mỗi mã chỉ một cảnh báo</span>, ở mức sâu nhất đang
            chạm. Giá rơi tiếp thì cảnh báo nâng mức; giá hồi lên trên mức 1 thì cảnh báo tự đóng.
          </li>
          <li>
            <span className="text-slate-soft">Ai thấy:</span> admin và quản lý cấp cao thấy tất cả;
            quản lý nhóm chỉ thấy mã mà nhóm mình đang giữ. Cảnh báo hiện ở chuông trên menu, trên
            Dashboard và trang{' '}
            <Link href="/risk" className="text-accent-400 hover:underline">
              Rủi ro
            </Link>
            .
          </li>
          <li>
            <span className="text-slate-soft">Kiểm tra</span> ở mỗi lượt quét rủi ro, và ngay khi bấm
            Lưu. Mã chưa có giá không được tính.
          </li>
        </ul>
      </Card>

      {strategies.length === 0 ? (
        <Card className="p-5">
          <EmptyState title="Chưa có chiến lược nào" />
        </Card>
      ) : (
        <div className="space-y-4">
          {strategies.map((s) => {
            const levels: MucForm[] = ([1, 2, 3] as const).map((m) => {
              const r = quyTac.get(maNguong(s.id, m));
              return {
                muc: m,
                phanTram: r && r.threshold > 0n ? bpsSangO(r.threshold) : '',
                hanhDong: r?.description ?? '',
              };
            });
            const cuaCL = rules.filter((r) => r.targetRef === s.id);
            const dangBat = cuaCL.some((r) => r.isActive && r.threshold > 0n);
            const coKeHoach = cuaCL.some((r) => r.threshold > 0n);
            const dangCham = alerts.filter((a) => a.rule.targetRef === s.id);

            return (
              <Card key={s.id} className="p-5">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-strong">
                    <span
                      className="size-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: mauChienLuoc(s.colorHex, s.sortOrder - 1) }}
                      aria-hidden
                    />
                    {s.nameVi}
                    {!s.isActive ? (
                      <span className="rounded border border-ink-700 px-1.5 py-px text-micro font-normal text-slate-muted">
                        chiến lược đã tắt
                      </span>
                    ) : null}
                  </h2>
                  <span className={`text-tiny ${dangBat ? 'text-up-500' : 'text-slate-muted'}`}>
                    {dangBat ? 'Kế hoạch đang bật' : coKeHoach ? 'Kế hoạch đang tắt' : 'Chưa đặt kế hoạch'}
                  </span>
                </div>

                {dangCham.length > 0 ? (
                  <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-tiny text-slate-soft">
                    <span className="text-slate-muted">Đang chạm mức:</span>
                    {dangCham.map((a) => {
                      const m = mucCuaMaNguong(a.rule.code) ?? 1;
                      return (
                        <span key={`${a.rule.code}|${a.targetRef}`} className="flex items-center gap-1">
                          <span aria-hidden>{DOT[m]}</span>
                          <span className="font-mono font-semibold text-strong">{a.targetRef}</span>
                          <span className="tabular text-down-500">
                            −{formatBps(Number(a.measuredValue ?? 0n), false)}
                          </span>
                        </span>
                      );
                    })}
                  </p>
                ) : null}

                <ContingencyForm strategyId={s.id} isActive={dangBat || !coKeHoach} levels={levels} />
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
