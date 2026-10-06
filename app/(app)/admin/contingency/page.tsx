import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { mauChienLuoc } from '@/components/charts';
import { ContingencyForm, type MucForm } from './ContingencyForm';
import { maNguong, mucCuaMaNguong, type MucDuPhong } from '@/risk/contingency';
import { formatBps } from '@/lib/money';
import { ALERT_STATUS, PORTFOLIO_STATUS, RISK_SCOPE } from '@/lib/enums';
import { computePositions } from '@/domain/portfolio-engine';
import { ContingencyGauge, type MaLo } from '@/components/ContingencyGauge';

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

  /*
   * LỖ TỪNG MÃ THEO CHIẾN LƯỢC — cho thanh mức độ. Đo ĐÚNG như bộ kiểm cảnh báo
   * (`evaluateContingencyRules`): `computePositions({ strategyId })`, chỉ mã đang giữ có
   * giá và có giá vốn, lỗ = −returnBps. Thanh và cảnh báo không thể nói hai điều khác nhau.
   */
  const portfolio = await prisma.portfolio.findFirst({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const loTheoCL = new Map<string, { maLo: MaLo[]; soMa: number }>(
    portfolio
      ? await Promise.all(
          strategies.map(async (s) => {
            const vt = (await computePositions({ portfolioId: portfolio.id, strategyId: s.id })).filter(
              (p) => p.quantity > 0 && !p.missingPrice && p.totalCost > 0n,
            );
            const maLo = vt
              .filter((p) => p.returnBps < 0)
              .map((p) => ({ symbol: p.symbol, loBps: -p.returnBps }))
              .sort((a, b) => b.loBps - a.loBps);
            return [s.id, { maLo, soMa: vt.length }] as const;
          }),
        )
      : [],
  );

  /** Thẻ kế hoạch của một chiến lược. */
  const veThe = (s: (typeof strategies)[number]) => {
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <h2 className="flex shrink-0 items-center gap-2 text-sm font-semibold text-strong">
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
          {/*
            THANH MỨC ĐỘ: mã lỗ sâu nhất của chiến lược so với ba mức đang đặt
            (theo số đã LƯU, không theo ô đang gõ dở).
          */}
          <div className="order-3 w-full sm:order-none sm:w-auto sm:min-w-[18rem] sm:flex-1">
            <ContingencyGauge
              mucBps={levels.map((l) => {
                const r = quyTac.get(maNguong(s.id, l.muc));
                return r && r.isActive && r.threshold > 0n ? Number(r.threshold) : null;
              })}
              maLo={loTheoCL.get(s.id)?.maLo ?? []}
              soMaDangGiu={loTheoCL.get(s.id)?.soMa ?? 0}
            />
          </div>
          <span className={`shrink-0 text-tiny ${dangBat ? 'text-up-500' : 'text-slate-muted'}`}>
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
  };

  /*
   * KẾ HOẠCH CHƯA BẬT ĐƯỢC ẨN ĐI (yêu cầu của người dùng — "để dễ nhìn"): chỉ chiến lược
   * đang bật kế hoạch hiện đầy đủ. Chiến lược chưa đặt hoặc đang tắt gom vào một mục thu
   * gọn cuối trang — ẩn chứ không bỏ, vì đó vẫn là chỗ duy nhất để bật hay đặt mới.
   */
  const dangBatCL = (id: string) => rules.some((r) => r.targetRef === id && r.isActive && r.threshold > 0n);
  const hien = strategies.filter((x) => dangBatCL(x.id));
  const an = strategies.filter((x) => !dangBatCL(x.id));

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
        <>
          {hien.length > 0 ? (
            <div className="space-y-4">{hien.map(veThe)}</div>
          ) : (
            <Card className="p-5">
              <EmptyState
                title="Chưa chiến lược nào bật kế hoạch"
                hint="Mở mục bên dưới để đặt mức lỗ và bật kế hoạch cho một chiến lược."
              />
            </Card>
          )}

          {an.length > 0 ? (
            <details className="mt-4 rounded-xl border border-ink-700">
              <summary className="cursor-pointer px-4 py-3 text-xs text-slate-muted hover:text-slate-soft">
                Kế hoạch chưa bật ({an.length}):{' '}
                <span className="text-slate-soft">{an.map((x) => x.nameVi).join(', ')}</span>
                <span className="ml-1 text-ink-500">— bấm để mở, đặt mức và bật</span>
              </summary>
              <div className="space-y-4 border-t border-ink-700 p-4">{an.map(veThe)}</div>
            </details>
          ) : null}
        </>
      )}
    </>
  );
}
