import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader, RoleBadge } from '@/components/ui';
import { Change, MoneyCompact, Weight } from '@/components/money';
import {
  Donut,
  DonutLegend,
  RankedBars,
  foldSlices,
  seriesColor,
  type DonutSlice,
  type RankedBar,
} from '@/components/charts';
import { dataScope } from '@/domain/permissions';
import {
  computeStrategyAllocation,
  computeTeamPerformance,
  type TeamPerformance,
} from '@/domain/portfolio-engine';
import { ratioToBps } from '@/lib/money';
import { PORTFOLIO_STATUS } from '@/lib/enums';

export const metadata: Metadata = { title: 'Teams' };

/**
 * TEAMS — mỗi nhóm là một DASHBOARD THU NHỎ (§2 × §9 × §15 × §16).
 *
 * Trang này phục vụ hai người đọc khác nhau, nên có hai tầng:
 *
 *   1. So sánh GIỮA các nhóm — dành cho người quản lý. Một khối duy nhất trên
 *      cùng, dạng thanh ngang.
 *   2. Bên trong TỪNG nhóm — dành cho chính thành viên nhóm đó. Mỗi nhóm một
 *      thẻ với KPI, tỷ trọng ngành, top vị thế, và ai đang làm chiến lược nào.
 *
 * Nhóm của người đang xem được đưa LÊN ĐẦU và đánh dấu. Một thành viên Đá Bóng
 * mở trang này là để xem Đá Bóng, không phải để cuộn tìm nó.
 *
 * PHẠM VI DỮ LIỆU — BA CHẾ ĐỘ, theo `dataScope(permissions, 'position')`:
 *
 *   ALL     thấy mọi nhóm + khối so sánh giữa các nhóm.
 *           ADMIN và Quản lý cấp cao (`position.view_all`).
 *   SCOPED  CHỈ thấy thẻ nhóm của mình; khối so sánh bị ẩn hoàn toàn.
 *           Trade (`position.view`).
 *   NONE    thấy cơ cấu tổ chức nhưng KHÔNG thấy con số tiền nào.
 *           Chỉ xảy ra khi `position.view` bị DENY riêng cho một người.
 *
 * VÌ SAO PHẢI CÓ: trước đây trang này chỉ có danh sách thành viên nên ai xem cũng
 * vô hại. Từ khi mỗi nhóm thành một dashboard có lãi/lỗ, một trader ở Đá Bóng sẽ
 * đọc được kết quả của Cầu Lông và Tài chính — thông tin nhạy cảm hơn hẳn.
 *
 * ẨN KHỐI SO SÁNH KHI SCOPED LÀ BẮT BUỘC, không phải cho gọn: khối đó in tỷ trọng
 * và số tiền của TỪNG nhóm, nên để lại thì việc lọc thẻ nhóm chỉ là hình thức.
 *
 * Dùng `position.*` chứ không thêm quyền `team.*` mới: con số ở đây LÀ vị thế và
 * P&L, chỉ gộp theo nhóm. Một người được xem vị thế toàn hệ thống thì đương nhiên
 * được xem chúng gộp theo nhóm; thêm một quyền thứ hai cho cùng dữ liệu sẽ tạo ra
 * hai nguồn sự thật có thể đặt lệch nhau.
 *
 * BA THỨ RIÊNG BIỆT, TRANG NÀY TỒN TẠI ĐỂ CHÚNG KHÔNG BỊ LẪN:
 *
 *   Nhóm       LÀM VIỆC VỚI AI   Đá Bóng · Cầu Lông · Tài chính · Cá nhân
 *   Vai trò    ĐƯỢC LÀM GÌ       Trade · Hỗ trợ Trade · Quản lý nhóm · Quản lý cấp cao…
 *   Chiến lược ĐANG LÀM GÌ       Định giá rẻ · Tín hiệu · Tích sản · Sóng ngành
 *
 * Đổi nhóm KHÔNG đổi quyền. Quyền đến từ vai trò, xem src/domain/permissions.ts.
 *
 * CHIẾN LƯỢC LÀ QUAN SÁT, KHÔNG PHẢI PHÂN CÔNG. Hệ thống cố tình KHÔNG có bảng
 * nối người ↔ chiến lược (§4: "người dùng không bị gán chiến lược cố định").
 * Những chiến lược hiện dưới tên mỗi người được suy ra từ giao dịch họ đã thực
 * hiện — tức là những gì họ THẬT SỰ đang làm, không phải những gì ai đó điền vào
 * một ô cấu hình rồi để đó không cập nhật.
 *
 * TỶ TRỌNG NGÀNH Ở ĐÂY LÀ TỶ TRỌNG NỘI BỘ NHÓM. 40% nghĩa là 40% vốn của nhóm
 * đó, không phải 40% danh mục. Dùng tỷ trọng toàn danh mục thì một nhóm nhỏ
 * trông như không tập trung vào gì cả, trong khi nó có thể đang dồn hết vào một
 * ngành duy nhất.
 */
export default async function TeamsPage() {
  const user = await requirePagePermission('team.view');

  const scope = dataScope(user.permissions, 'position');
  const seeAllTeams = scope === 'ALL';
  const seeMoney = scope !== 'NONE';

  const portfolio = await prisma.portfolio.findFirst({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  const [teamRows, departments, strategyList, teamPerf] = await Promise.all([
    prisma.team.findMany({
      orderBy: { nameVi: 'asc' },
      include: {
        department: { select: { code: true, nameVi: true } },
        leader: { select: { fullName: true } },
        members: {
          orderBy: { fullName: 'asc' },
          select: {
            id: true,
            fullName: true,
            status: true,
            role: { select: { code: true } },
          },
        },
      },
    }),
    prisma.department.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, nameVi: true, _count: { select: { teams: true } } },
    }),

    /*
     * Danh sách chiến lược — chỉ để tra tên và slot màu. Con số thì lấy từ engine,
     * xem `capitalTheoNhom` / `capitalTheoNguoi` bên dưới.
     */
    prisma.strategy.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, nameVi: true, sortOrder: true },
    }),

    /*
     * KHÔNG tính số liệu của nhóm mà người này không được xem.
     *
     * Lọc ở tầng hiển thị thì cũng ra cùng một trang, nhưng số liệu của nhóm khác
     * vẫn được tính và vẫn nằm trong bộ nhớ của request. Chặn từ nguồn thì rẻ hơn
     * và không có gì để lỡ rò ra qua một lần refactor sau này.
     */
    portfolio && seeMoney
      ? computeTeamPerformance(
          portfolio.id,
          seeAllTeams ? {} : { onlyTeamId: user.teamId ?? '__no_team__' },
        )
      : Promise.resolve([]),
  ]);

  // --- Vốn theo chiến lược, LẤY TỪ ENGINE ----------------------------------

  /*
   * TRANG NÀY TỪNG TỰ TÍNH, VÀ SAI GIỐNG HỆT BẢN ENGINE CŨ.
   *
   * Phép cũ: "Σ allocationAmount lệnh mua − Σ allocationAmount lệnh bán". Nhưng
   * `allocationAmount` của lệnh mua là GIÁ VỐN chi ra, còn của lệnh bán là TIỀN THU
   * VỀ — hiệu của hai đại lượng khác nhau là lãi/lỗ đã thực hiện, không phải vốn còn
   * lại. Nhóm bán hết một mã sẽ hiện vốn ÂM, và các chiến lược đã thoát sạch vẫn
   * chiếm chỗ trên biểu đồ.
   *
   * `computeStrategyAllocation` đã sửa đúng phép này (đi từ khối lượng còn lại rồi
   * phân bổ giá vốn vị thế). Gọi nó thay vì giữ một bản sao thứ hai — hai bản của một
   * phép tính là hai cơ hội để sai khác nhau, và đó đúng là chuyện đã xảy ra.
   *
   * Một lượt gọi cho mỗi nhóm và mỗi thành viên hiển thị. Số nhóm và số người ở đây
   * nhỏ, đổi lại là con số trên trang này khớp với trang Chiến lược và trang thành
   * viên.
   */
  interface StrategyStat {
    strategyId: string;
    code: string;
    nameVi: string;
    sortOrder: number;
    net: bigint;
    trades: number;
  }

  const clTheoId = new Map(strategyList.map((x) => [x.id, x]));

  const doiSang = (rows: Awaited<ReturnType<typeof computeStrategyAllocation>>) => {
    const m = new Map<string, StrategyStat>();
    for (const r of rows) {
      const cl = clTheoId.get(r.strategyId);
      m.set(r.strategyId, {
        strategyId: r.strategyId,
        code: r.code,
        nameVi: r.nameVi,
        sortOrder: cl?.sortOrder ?? r.colorIndex + 1,
        net: r.netCapital,
        trades: r.tradeCount,
      });
    }
    return m;
  };

  const perTeamStrategy = new Map<string, Map<string, StrategyStat>>();
  const perUser = new Map<string, Map<string, StrategyStat>>();

  if (portfolio && seeMoney) {
    for (const t of teamRows) {
      if (!seeAllTeams && t.id !== user.teamId) continue;
      perTeamStrategy.set(
        t.id,
        doiSang(await computeStrategyAllocation({ portfolioId: portfolio.id, teamId: t.id })),
      );

      for (const m of t.members) {
        if (perUser.has(m.id)) continue;
        perUser.set(
          m.id,
          doiSang(await computeStrategyAllocation({ portfolioId: portfolio.id, userId: m.id })),
        );
      }
    }
  }

  const perfByTeam = new Map(teamPerf.map((t) => [t.teamId, t]));

  /*
   * NHÓM CỦA NGƯỜI ĐANG XEM LÊN ĐẦU.
   *
   * Sau đó sắp theo vốn ròng giảm dần. Không sắp theo tên: người mở trang muốn
   * biết ai đang triển khai nhiều nhất, và thứ tự bảng chữ cái không nói gì.
   */
  const visible = seeAllTeams
    ? teamRows
    : teamRows.filter((t) => t.id === user.teamId);

  const ordered = [...visible].sort((a, b) => {
    if (a.id === user.teamId) return -1;
    if (b.id === user.teamId) return 1;
    const av = perfByTeam.get(a.id)?.netCapital ?? 0n;
    const bv = perfByTeam.get(b.id)?.netCapital ?? 0n;
    return bv > av ? 1 : bv < av ? -1 : 0;
  });

  const totalDeployed = teamPerf.reduce((s, t) => s + t.netCapital, 0n);

  /*
   * Dựng từ `teamPerf`, KHÔNG từ `teamRows`.
   *
   * `teamPerf` có thêm một dòng "Không thuộc nhóm" gom các lệnh chưa được gán
   * nhóm (ví dụ Admin nhập hộ). Dựng từ danh sách nhóm trong database sẽ bỏ
   * dòng đó, và các tỷ trọng cộng lại chỉ được 96,5% — biểu đồ vẫn trông hoàn
   * chỉnh nhưng thiếu vốn. Xem `computeTeamPerformance`.
   */
  const memberCountOf = new Map(teamRows.map((t) => [t.id, t.members.length]));

  const comparisonBars: RankedBar[] = [...teamPerf]
    .map((perf) => ({
      key: perf.teamId || 'unassigned',
      label: perf.nameVi,
      value: perf.netCapital,
      // Tỷ trọng trên TỔNG — con số này được in ra; độ dài thanh do component
      // tự chuẩn hoá theo mục lớn nhất.
      bps: ratioToBps(perf.netCapital, totalDeployed),
      // Màu theo THỰC THỂ (`colorIndex` từ mã nhóm), không theo thứ hạng —
      // lọc hay sắp lại thì nhóm không bị sơn màu khác.
      color: seriesColor(perf.colorIndex),
      trailing: (
        <span className="tabular text-tiny text-ink-500">
          {perf.unassigned ? 'chưa gán' : (memberCountOf.get(perf.teamId) ?? 0) + ' người'}
        </span>
      ),
    }))
    .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));

  const emptyDepartments = departments.filter((d) => d._count.teams === 0);

  return (
    <>
      {/*
        Phụ đề nói THẲNG phạm vi đang áp dụng. Một người chỉ thấy một nhóm cần
        biết đó là do quyền hạn, không phải do hệ thống thiếu dữ liệu — nếu không
        họ sẽ đi báo lỗi "trang Teams mất mấy nhóm".
      */}
      <PageHeader
        title="Teams"
        subtitle={
          seeAllTeams
            ? `${teamRows.length} nhóm · ${teamRows.reduce((s, t) => s + t.members.length, 0)} người${
                user.teamId ? ' · nhóm của bạn hiện trên cùng' : ''
              }`
            : `Chỉ hiện nhóm của bạn — cần quyền position.view_all để xem cả ${teamRows.length} nhóm`
        }
      />

      {/* Nhắc rõ ba trục, vì đây chính là chỗ hay bị lẫn */}
      <Card className="mb-4 p-4">
        <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="font-medium text-strong">Nhóm — làm việc với ai</dt>
            <dd className="mt-0.5 text-slate-muted">
              Đá Bóng, Cầu Lông, Tài chính, Cá nhân. Đổi nhóm không đổi quyền.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-strong">Vai trò — được làm gì</dt>
            <dd className="mt-0.5 text-slate-muted">
              Quyền hạn nằm ở vai trò, không ở nhóm. Xem Ma trận quyền.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-strong">Chiến lược — đang làm gì</dt>
            <dd className="mt-0.5 text-slate-muted">
              Suy từ giao dịch đã thực hiện, không phải một ô phân công (§4).
            </dd>
          </div>
        </dl>
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* Tầng 1 — so sánh GIỮA các nhóm                                   */}
      {/* ---------------------------------------------------------------- */}
      {seeAllTeams && totalDeployed > 0n ? (
        <Card className="mb-6 p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-strong">Vốn ròng theo nhóm</h2>
            <span className="tabular text-xs text-slate-muted">
              tổng <MoneyCompact value={totalDeployed} className="text-slate-soft" />
            </span>
          </div>
          <RankedBars items={comparisonBars} />
          <p className="mt-3 text-tiny text-ink-500">
            Mua cộng, bán trừ — là vốn đang triển khai, không phải tổng giá trị đã giao dịch.
          </p>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* Tầng 2 — dashboard thu nhỏ của TỪNG nhóm                         */}
      {/* ---------------------------------------------------------------- */}
      {ordered.length === 0 ? (
        <Card>
          <EmptyState
            title={
              user.teamId
                ? 'Nhóm của bạn không còn tồn tại'
                : 'Bạn chưa được gán nhóm nào'
            }
            hint={
              user.teamId
                ? 'Liên hệ Admin để được gán lại nhóm.'
                : 'Bạn chỉ được xem nhóm của mình, nhưng tài khoản này chưa thuộc nhóm nào. Admin gán nhóm ở trang Duyệt & Người dùng.'
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {ordered.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              perf={perfByTeam.get(team.id)}
              strategies={[...(perTeamStrategy.get(team.id)?.values() ?? [])]
                .filter((s) => s.net !== 0n)
                .sort((a, b) => a.sortOrder - b.sortOrder)}
              memberStrategies={perUser}
              isOwn={team.id === user.teamId}
              seeMoney={seeMoney}
            />
          ))}
        </div>
      )}

      {/*
        Phòng ban chưa có nhóm nào vẫn phải nhắc tới — §2 là cây tổ chức, và một
        phòng ban biến mất khỏi trang sẽ khiến người đọc tưởng nó không tồn tại.
        Nhưng nhắc bằng MỘT DÒNG, không phải một thẻ trống to bằng cả màn hình
        như trước.
      */}
      {seeAllTeams && emptyDepartments.length > 0 ? (
        <p className="mt-4 text-tiny text-ink-500">
          Phòng ban chưa có nhóm nào:{' '}
          {emptyDepartments.map((d) => d.nameVi).join(' · ')}
        </p>
      ) : null}

      {/*
        Ghi chú này chỉ đúng khi có số để đọc. Ở chế độ NONE (`position.view` bị
        DENY) thẻ nhóm không hiện con số nào, nên để lại đoạn giải thích về tỷ
        trọng và vốn ròng sẽ khiến người đọc đi tìm thứ không có trên trang.
      */}
      {seeMoney ? (
        <p className="mt-2 text-tiny text-ink-500">
          Tỷ trọng ngành trong mỗi thẻ là tỷ trọng NỘI BỘ nhóm đó, không phải của toàn danh
          mục. Con số dưới mỗi tên chiến lược là phần vốn ròng đã triển khai cho chiến lược
          đó — mua cộng, bán trừ. Một lệnh có thể được phân bổ cho nhiều chiến lược (§6).
        </p>
      ) : (
        <p className="mt-2 text-tiny text-ink-500">
          Tài khoản này bị chặn quyền <span className="font-mono">position.view</span>, nên
          trang chỉ hiện cơ cấu tổ chức và chiến lược — không hiện số tiền nào.
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Thẻ một nhóm
// ---------------------------------------------------------------------------

type TeamRow = {
  id: string;
  code: string;
  nameVi: string;
  description: string | null;
  department: { code: string; nameVi: string };
  leader: { fullName: string } | null;
  members: {
    id: string;
    fullName: string;
    status: string;
    role: { code: string } | null;
  }[];
};

type StrategyStat = {
  strategyId: string;
  code: string;
  nameVi: string;
  sortOrder: number;
  net: bigint;
  trades: number;
};

function TeamCard({
  team,
  perf,
  strategies,
  memberStrategies,
  isOwn,
  seeMoney,
}: {
  team: TeamRow;
  perf: TeamPerformance | undefined;
  strategies: StrategyStat[];
  memberStrategies: Map<string, Map<string, StrategyStat>>;
  isOwn: boolean;
  /**
   * false khi `position.view` bị DENY: thẻ chỉ còn cơ cấu tổ chức.
   *
   * Tên chiến lược VẪN hiện, chỉ ẩn số tiền. Người bị chặn xem P&L vẫn cần biết
   * ai trong nhóm đang làm gì — đó là thông tin tổ chức, không phải thông tin tài
   * chính.
   */
  seeMoney: boolean;
}) {
  const active = seeMoney && perf !== undefined && perf.tradeCount > 0;

  // Donut gập về tối đa 6 phần; ngành thứ 7 trở đi vào "Khác".
  const sectorSlices: DonutSlice[] = perf
    ? foldSlices(
        perf.sectorExposure.map((s) => ({
          key: s.sectorId,
          label: s.nameVi,
          value: s.marketValue,
          bps: s.weightBps,
          color: seriesColor(s.colorIndex),
        })),
      )
    : [];

  const positionBars: RankedBar[] = (perf?.positions ?? []).slice(0, 5).map((p) => ({
    key: p.stockId,
    label: `${p.symbol} · ${p.sectorNameVi}`,
    value: p.marketValue,
    /*
     * Tỷ trọng TRONG NỘI BỘ NHÓM: mẫu số là giá trị thị trường của chính nhóm,
     * không phải của toàn danh mục. Đây mới là con số trả lời "nhóm này dồn bao
     * nhiêu vào mã đó" — dùng tỷ trọng toàn danh mục thì mọi mã của một nhóm
     * nhỏ đều hiện vài phần trăm và không so được với nhau.
     */
    bps: ratioToBps(p.marketValue, perf?.marketValue ?? 0n),
    color: seriesColor(p.sectorSortOrder),
    trailing: <Change bps={p.returnBps} className="text-tiny" />,
  }));

  return (
    <Card
      className={`overflow-hidden ${
        isOwn ? 'border-accent-500/40 ring-1 ring-accent-500/20' : ''
      }`}
    >
      {/* ---- Đầu thẻ ---- */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ink-800 px-5 py-3.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="text-sm font-semibold text-strong">{team.nameVi}</h2>
          <code className="rounded bg-ink-850 px-1.5 py-px font-mono text-micro text-slate-muted">
            {team.code}
          </code>
          {isOwn ? (
            <span className="rounded border border-accent-500/40 bg-accent-500/10 px-1.5 py-px text-micro font-medium text-accent-400">
              Nhóm của bạn
            </span>
          ) : null}
          <span className="text-tiny text-slate-muted">{team.department.nameVi}</span>
        </div>

        <p className="text-tiny text-slate-muted">
          {team.leader ? `Trưởng nhóm: ${team.leader.fullName}` : 'chưa có trưởng nhóm'}
          {' · '}
          {team.members.length} thành viên
          {seeMoney && perf ? ` · ${perf.tradeCount} lệnh` : ''}
        </p>
      </div>

      {team.description ? (
        <p className="border-b border-ink-800 px-5 py-2 text-xs text-slate-muted">
          {team.description}
        </p>
      ) : null}

      {/* ---- KPI của nhóm ---- */}
      {seeMoney ? (
      <div className="grid grid-cols-2 divide-ink-800 border-b border-ink-800 sm:grid-cols-4 sm:divide-x">
        <Kpi
          label="Vốn triển khai"
          value={<MoneyCompact value={perf?.netCapital ?? 0n} className="text-strong" />}
          hint="mua cộng, bán trừ"
        />
        <Kpi
          label="Giá trị thị trường"
          value={<MoneyCompact value={perf?.marketValue ?? 0n} className="text-strong" />}
          hint={`${perf?.positionCount ?? 0} mã đang giữ`}
        />
        <Kpi
          label="Lãi/lỗ"
          value={<MoneyCompact value={perf?.totalPnl ?? 0n} signed />}
          hint={<Change bps={perf?.returnBps ?? 0} className="text-tiny" />}
        />
        <Kpi
          label="Đã chốt / chưa chốt"
          value={
            <span className="text-sm">
              <MoneyCompact value={perf?.realizedPnl ?? 0n} signed />
              <span className="mx-1 text-ink-500">/</span>
              <MoneyCompact value={perf?.unrealizedPnl ?? 0n} signed />
            </span>
          }
          hint="bán rồi / còn giữ"
        />
      </div>
      ) : null}

      {/* ---- Ngành và vị thế ---- */}
      {active ? (
        <div className="grid grid-cols-1 gap-6 border-b border-ink-800 px-5 py-4 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-xs font-medium text-slate-soft">
              Tỷ trọng ngành trong nhóm
            </p>
            <div className="flex flex-wrap items-center gap-5">
              <Donut
                slices={sectorSlices}
                size={128}
                thickness={18}
                centerLabel="ngành"
                centerValue={String(sectorSlices.length)}
              />
              <DonutLegend slices={sectorSlices} className="min-w-52 flex-1" />
            </div>
          </div>

          <div>
            <p className="mb-3 text-xs font-medium text-slate-soft">
              Vị thế lớn nhất của nhóm
            </p>
            {positionBars.length > 0 ? (
              <RankedBars items={positionBars} />
            ) : (
              <p className="text-xs text-ink-500">Nhóm không còn giữ mã nào.</p>
            )}
          </div>
        </div>
      ) : null}

      {/*
        PHẠM VI BỊ CẮT NGANG LÔ — nói ra trước mọi con số của nhóm.

        Khi lệnh mua và lệnh bán của cùng một lô nằm ở hai nhóm, các con số phía trên
        đều thiếu một nửa: vốn triển khai âm vì chỉ thấy tiền bán, lãi/lỗ đã chốt
        không tính được vì không biết giá vốn, và vị thế khối lượng âm bị lọc mất nên
        trang hiện "0 mã đang giữ". Im lặng đưa những con số đó ra là để người đọc tin
        vào một bức tranh sai.
      */}
      {perf && perf.brokenLotSymbols.length > 0 ? (
        <div className="border-b border-warn-500/30 bg-warn-500/5 px-5 py-3">
          <p className="text-xs leading-relaxed text-warn-500">
            <span className="font-medium">Số liệu nhóm này chưa đầy đủ.</span>{' '}
            {perf.brokenLotSymbols.join(", ")} có lệnh BÁN thuộc nhóm này nhưng lệnh MUA
            thuộc nhóm khác (hoặc chưa gắn nhóm) — vì nhóm của một lệnh được ghi cố định
            lúc nhập, không đổi theo nhóm hiện tại của người thực hiện. Vốn triển khai và
            lãi/lỗ ở trên vì thế thiếu phần giá vốn.
            {' '}
            <span className="font-mono text-slate-soft">npm run check:team-scope</span> liệt kê
            đầy đủ.
          </p>
        </div>
      ) : null}

      {/* ---- Chiến lược của nhóm ---- */}
      {strategies.length > 0 ? (
        <div className="border-b border-ink-800 px-5 py-4">
          <p className="mb-2.5 text-xs font-medium text-slate-soft">
            Chiến lược nhóm đang thực thi
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {strategies.map((s) => (
              <li
                key={s.strategyId}
                className="flex items-baseline gap-1.5 rounded-md border border-ink-700 bg-ink-850 px-2 py-1"
                title={`${s.trades} lệnh thuộc chiến lược ${s.nameVi}`}
              >
                <span
                  className="size-1.5 rounded-sm"
                  style={{ backgroundColor: seriesColor(s.sortOrder - 1) }}
                  aria-hidden
                />
                <span className="text-tiny text-slate-soft">{s.nameVi}</span>
                {seeMoney ? (
                  <>
                    <span className="tabular text-tiny text-slate-muted">
                      <MoneyCompact value={s.net} />
                    </span>
                    <Weight
                      bps={ratioToBps(s.net, strategies.reduce((t, x) => t + x.net, 0n))}
                      className="tabular text-tiny text-ink-500"
                    />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ---- Thành viên ---- */}
      <div className="px-5 py-4">
        <p className="mb-2.5 text-xs font-medium text-slate-soft">Thành viên</p>

        {team.members.length === 0 ? (
          <p className="text-xs text-ink-500">Chưa có thành viên.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {team.members.map((member) => {
              const stats = [...(memberStrategies.get(member.id)?.values() ?? [])]
                // Bỏ chiến lược đã đóng hết vị thế: net 0 nghĩa là người này
                // không còn triển khai chiến lược đó nữa.
                .filter((s) => s.net !== 0n)
                .sort((a, b) => a.sortOrder - b.sortOrder);

              return (
                <li
                  key={member.id}
                  className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2.5 transition hover:border-ink-600"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {/*
                      Tên là LINK sang trang chi tiết cá nhân: mã, khối lượng, giá
                      mua/bán, chiến lược của từng lệnh. Ở đây chỉ tóm tắt được
                      vốn ròng theo chiến lược — nhồi thêm sổ giao dịch của từng
                      người vào thẻ nhóm sẽ làm nó dài gấp mười.
                    */}
                    <Link
                      href={`/members/${member.id}`}
                      className="text-sm text-strong transition hover:text-accent-400"
                    >
                      {member.fullName}
                    </Link>
                    <RoleBadge roleCode={member.role?.code ?? null} />
                    {member.status !== 'ACTIVE' ? (
                      <span className="rounded border border-ink-600 px-1.5 py-px text-micro text-ink-500">
                        {member.status}
                      </span>
                    ) : null}
                    <Link
                      href={`/members/${member.id}`}
                      className="ml-auto text-tiny text-accent-400 transition hover:underline"
                    >
                      chi tiết →
                    </Link>
                  </div>

                  {stats.length === 0 ? (
                    <p className="mt-1.5 text-tiny text-ink-500">
                      Chưa thực hiện giao dịch nào.
                    </p>
                  ) : (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {stats.map((s) => (
                        <li
                          key={s.strategyId}
                          className="flex items-baseline gap-1.5 rounded-md border border-ink-700 px-2 py-1"
                          title={`${s.trades} lệnh thuộc chiến lược ${s.nameVi}`}
                        >
                          <span
                            className="size-1.5 rounded-sm"
                            style={{ backgroundColor: seriesColor(s.sortOrder - 1) }}
                            aria-hidden
                          />
                          <span className="text-tiny text-slate-soft">{s.nameVi}</span>
                          {seeMoney ? (
                            <span className="tabular text-tiny text-slate-muted">
                              <MoneyCompact value={s.net} />
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Drill-down: nhóm nào cũng phải đi xuống được tầng chi tiết */}
      {active ? (
        <div className="flex flex-wrap gap-4 border-t border-ink-800 px-5 py-2.5 text-xs">
          <Link
            href={`/transactions?team=${team.id}`}
            className="text-accent-400 transition hover:underline"
          >
            Giao dịch của nhóm →
          </Link>
          <Link
            href="/portfolio/positions"
            className="text-accent-400 transition hover:underline"
          >
            Vị thế chi tiết →
          </Link>
        </div>
      ) : null}
    </Card>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint: React.ReactNode;
}) {
  return (
    <div className="px-5 py-3.5">
      <p className="text-tiny text-slate-muted">{label}</p>
      <p className="tabular mt-1 text-lg font-semibold">{value}</p>
      <p className="mt-0.5 text-tiny text-ink-500">{hint}</p>
    </div>
  );
}
