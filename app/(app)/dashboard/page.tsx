import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, TradeStatusChip } from '@/components/ui';
import { Change, Money, MoneyCompact, Weight } from '@/components/money';
import {
  DONUT_MAX_SEGMENTS,
  DivergingBars,
  Donut,
  DonutLegend,
  RankedBars,
  Sparkline,
  foldSlices,
  seriesColor,
  type DivergingBar,
  type DonutSlice,
  type RankedBar,
} from '@/components/charts';
import { DashboardFilters, type FilterGroup } from '@/components/DashboardFilters';
import { Icon, type IconName } from '@/components/icons';
import { dataScope } from '@/domain/permissions';
import {
  applyScope,
  computePerformance,
  computeIbExposure,
  type IbExposure,
  computeMemberPerformance,
  computePerformanceSeries,
  computePortfolioSummary,
  computeTeamPerformance,
  type EngineFilter,
  type PeriodCode,
} from '@/domain/portfolio-engine';
import { formatBps, formatCompactVnd_vi, netAmount, ratioToBps } from '@/lib/money';
import {
  PORTFOLIO_STATUS,
  SEVERITY_DOT,
  TRANSACTION_TYPE,
  USER_STATUS,
  type RiskMetric,
  type TradeStatus,
} from '@/lib/enums';
import { countPendingForUser } from '@/approvals/queue';
import { getDict } from '@/i18n';
import { BRAND_TAGLINE } from '@/lib/brand';
import { ensureRecentScan, listOpenAlerts } from '@/risk/scan';
import { formatMeasure } from '@/domain/risk-engine';
import { elapsedVi } from '@/lib/elapsed';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.nav.dashboard };
}

/**
 * EXECUTIVE CONTROL CENTER (§11–§19).
 *
 * Nguyên tắc §23: "Không hiển thị quá nhiều thông tin ở Dashboard Tầng 1. Tầng 1
 * chỉ là Control Center. Click vào mới drill-down." Vì vậy mỗi khối ở đây trả lời
 * đúng MỘT câu hỏi quản trị và luôn có đường dẫn xuống tầng chi tiết.
 *
 * BỘ LỌC TOÀN CỤC (§11) nằm ở query string và áp cho MỌI khối trên trang. Không
 * có chuyện KPI thuộc một phạm vi mà biểu đồ thuộc phạm vi khác — đó là kiểu sai
 * khiến người đọc tin vào một tương quan không tồn tại.
 *
 * MỌI CON SỐ TÍNH TỪ GIAO DỊCH, không bảng nào lưu sẵn P&L (§23). Ghi chú cuối
 * trang nói lại điều đó cho NGƯỜI ĐỌC, không chỉ cho người viết code.
 */

/*
 * THỨ TỰ CÁC KHOẢNG THỜI GIAN. Chữ hiển thị nằm ở từ điển (`t.period`), không nằm
 * ở đây: bảng này là hằng số module scope, chạy một lần lúc nạp module, trong khi
 * ngôn ngữ phụ thuộc cookie của từng request — cùng lý do với bảng MENU ở AppShell.
 */
const PERIODS: PeriodCode[] = ['1W', '1M', '3M', '6M', 'YTD', 'ALL'];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    portfolioId?: string;
    teamId?: string;
    strategyId?: string;
    sectorId?: string;
    period?: string;
  }>;
}) {
  const user = await requirePagePermission('dashboard.view');

  /* Từ điển đọc theo TỪNG REQUEST (cookie) — xem `src/i18n/index.ts`. */
  const { t } = await getDict();
  const params = await searchParams;

  const portfolioScope = dataScope(user.permissions, 'portfolio');
  /*
   * Giữ nguyên GIÁ TRỊ phạm vi, không rút về một cờ boolean: khối theo nhóm cần
   * biết 'có xem được tất cả không', còn khối theo cá nhân cần phân biệt SCOPED
   * (xem người cùng nhóm) với NONE (không xem được ai). Rút thành boolean thì
   * hai khối buộc phải bật/tắt cùng nhau, mà chúng không nên.
   */
  const positionScope = dataScope(user.permissions, 'position');
  const seeAllTeams = positionScope === 'ALL';

  /*
   * PHẠM VI DỮ LIỆU VỐN — cho khối "Tài khoản & vốn theo IB".
   *
   * Khối đó hiện số tiền của tài khoản chứng khoán CỦA NGƯỜI KHÁC, nên không thể
   * dùng chung cổng với `dashboard.view`: một MEMBER xem được dashboard sẽ thấy
   * vốn của cả công ty. Quyền đúng tên đúng việc là `capital.view` / `capital.view_all`.
   *
   * Đây cũng là lần `dataScope(…, 'capital')` được gọi thật lần đầu. Trước đó
   * `capital.view` là một QUYỀN BẪY: đã cấp cho 3 vai trò mà không gác gì —
   * `npm run audit:pages` vẫn đang báo đỏ nó. Dùng ở đây không cấp thêm quyền cho
   * ai; nó chỉ khiến quyền đã cấp bắt đầu có tác dụng đúng như tên gọi.
   *
   * Tính RIÊNG, không mượn `portfolioScope`: hai module có thể lệch nhau qua
   * bảng `user_permissions` (cấp lẻ cho từng người), và lúc đó mượn phạm vi của
   * module khác là nới quyền mà không ai chủ ý.
   */
  const capitalScope = dataScope(user.permissions, 'capital');

  const period = (PERIODS.includes(params.period as PeriodCode)
    ? params.period
    : 'YTD') as PeriodCode;

  const [portfolios, teams, strategies, sectors] = await Promise.all([
    prisma.portfolio.findMany({
      where: { status: PORTFOLIO_STATUS.ACTIVE },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true, nameVi: true, name: true },
    }),
    prisma.team.findMany({
      where: { isActive: true },
      orderBy: { nameVi: 'asc' },
      select: { id: true, nameVi: true },
    }),
    prisma.strategy.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, nameVi: true },
    }),
    prisma.sector.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, nameVi: true },
    }),
  ]);

  const portfolio = portfolios.find((p) => p.id === params.portfolioId) ?? portfolios[0] ?? null;

  if (!portfolio) {
    return (
      <>
        <Header
          title={BRAND_TAGLINE}
          subtitle={t.dash.noPortfolio}
          filters={null}
          alertCount={0}
          alertsTitle={t.dash.openAlerts(0)}
        />
        <Card>
          <EmptyState
            title={t.dash.noPortfolio}
            hint={t.dash.noPortfolioHint}
          />
        </Card>
      </>
    );
  }

  /*
   * BỘ LỌC NGƯỜI DÙNG CHỌN TRƯỚC, RỒI MỚI ÉP PHẠM VI QUYỀN. Thứ tự này quan trọng:
   * `applyScope()` đặt sau cùng nên nó GHI ĐÈ `teamId` mà người dùng tự gõ vào URL.
   * Làm ngược lại thì người chỉ có `position.view` sửa query string là xem được
   * nhóm khác.
   */
  const requestedTeamId = seeAllTeams ? params.teamId : undefined;

  const filter: EngineFilter & { portfolioId: string } = {
    ...applyScope(
      {
        portfolioId: portfolio.id,
        teamId: requestedTeamId,
        strategyId: params.strategyId,
        sectorId: params.sectorId,
      },
      portfolioScope,
      user.teamId,
    ),
    portfolioId: portfolio.id,
  };

  /*
   * Nhóm của khối IB đi qua `applyScope` LẦN RIÊNG với `capitalScope`.
   *
   * Không dùng lại `filter.teamId` vì nó đã bị ép theo `portfolioScope`. Người có
   * `portfolio.view_all` nhưng chỉ `capital.view` sẽ thấy vốn IB của mọi nhóm nếu
   * dùng chung — đúng kiểu rò rỉ mà thứ tự "lọc trước, ép phạm vi sau" sinh ra.
   */
  const ibTeamId = applyScope(
    { portfolioId: portfolio.id, teamId: requestedTeamId },
    capitalScope,
    user.teamId,
  ).teamId;

  const summary = await computePortfolioSummary(filter);

  await ensureRecentScan();

  /*
   * CHUỖI THEO PHIÊN LẤY TRƯỚC, không nằm trong `Promise.all` bên dưới.
   *
   * `computePerformance` cần chính chuỗi này để tính hiệu suất theo khoảng, nên
   * hai lời gọi không còn song song được. Đổi lấy tính đúng: chạy song song thì
   * `computePerformance` phải tự dựng lại chuỗi lần thứ hai — cùng một truy vấn
   * nặng làm hai lần, và hai bản dựng có thể lệch nhau nếu giá vừa được nạp
   * giữa hai lời gọi.
   */
  const series = await computePerformanceSeries(portfolio.id, period, {
    teamId: filter.teamId,
    userId: filter.userId,
    sectorId: filter.sectorId,
  });

  /*
   * TỔNG TOÀN DANH MỤC, dùng LÀM MẪU SỐ cho các tỷ trọng "% danh mục".
   *
   * Khi đang lọc, `summary` là của phần đã lọc nên chia cho chính nó ra những con
   * số vô nghĩa: lọc sang nhóm không có vị thế thì tiền hiện '78,50% danh mục',
   * trong đó "danh mục" chỉ là (0 vị thế + toàn bộ tiền). Mẫu số phải là danh mục
   * THẬT để "Đá Bóng chiếm 50% danh mục" mới là câu nói đúng.
   *
   * Không lọc thì dùng lại chính `summary`, không truy vấn thêm lần nào.
   */
  /*
   * MỌI chiều lọc đều làm hẹp phạm vi, kể cả chiến lược.
   *
   * Bản đầu tôi bỏ sót `strategyId`, nên lọc theo "Tích sản" vẫn ra Portfolio
   * Value ₫3,423 tỷ = ₫1,19 tỷ vị thế của chiến lược + ₫2,232 tỷ tiền của TOÀN
   * danh mục. Đúng cái lỗi vừa sửa, chỉ đi qua một chiều khác.
   */
  const narrowed =
    filter.teamId !== undefined ||
    filter.sectorId !== undefined ||
    filter.userId !== undefined ||
    filter.strategyId !== undefined;

  const whole = narrowed
    ? await computePortfolioSummary({ portfolioId: portfolio.id })
    : summary;

  const [perf, recentTrades, cho, pendingUsers, alerts, teamPerf, memberPerf, ibExposure] =
    await Promise.all([
      computePerformance(portfolio.id, period, summary.totalPnlBps, series),
      prisma.trade.findMany({
        where: {
          portfolioId: portfolio.id,
          ...(filter.teamId !== undefined ? { teamId: filter.teamId } : {}),
          ...(filter.strategyId
            ? { strategies: { some: { strategyId: filter.strategyId } } }
            : {}),
          ...(filter.sectorId ? { stock: { sectorId: filter.sectorId } } : {}),
        },
        orderBy: [{ executedAt: 'desc' }, { code: 'desc' }],
        take: 6,
        select: {
          id: true,
          transactionType: true,
          quantity: true,
          price: true,
          fees: true,
          tax: true,
          executedAt: true,
          status: true,
          stock: { select: { symbol: true } },
          strategies: {
            orderBy: { allocationBps: 'desc' },
            select: { strategy: { select: { nameVi: true, sortOrder: true } } },
          },
        },
      }),
      user.permissions.has('approval.view')
        ? /*
            LỌC THEO DANH MỤC ĐANG XEM. Thiếu `portfolioId` thì con số này đếm việc
            chờ duyệt của MỌI danh mục rồi hiện trên một trang nói về đúng một danh
            mục. Hiện chỉ có một danh mục nên chưa lệch, nhưng nó sẽ lệch ngay ở
            danh mục thứ hai — và lúc đó không có gì trên trang gợi ý vì sao.

            ĐẾM BẰNG HÀM DÙNG CHUNG với huy hiệu trên menu. Bản trước đếm thẳng
            `trade.count` tại đây: không trừ chốt bốn mắt, và KHÔNG đếm yêu cầu rút
            vốn — nên một yêu cầu rút 281 triệu đang chờ vẫn cho thẻ này biến mất,
            người duyệt không hề biết có việc.
          */
          countPendingForUser(user, portfolio.id)
        : null,
      user.permissions.has('user.approve')
        ? prisma.user.count({ where: { status: USER_STATUS.PENDING } })
        : 0,
      /*
       * CẢNH BÁO ĐỌC TỪ `risk_alerts`, KHÔNG tính lại tại đây. Hai chỗ cùng tính
       * một quy tắc rủi ro thì sớm muộn sẽ lệch nhau, và lúc đó Dashboard với
       * trang Risk nói hai điều khác nhau về cùng một danh mục.
       */
      user.permissions.has('risk.view') ? listOpenAlerts(8) : [],
      seeAllTeams ? computeTeamPerformance(portfolio.id) : Promise.resolve([]),
      /*
       * LÃI/LỖ TỪNG CÁ NHÂN. Truyền `filter.teamId` — đã qua `applyScope` — nên
       * bộ lọc nhóm ở đầu trang áp cả vào đây (§11), và người chỉ có 'position.view'
       * chỉ thấy nhóm của mình vì `applyScope` đã ép `teamId` về đó. Chốt quyền
       * nằm đúng một chỗ, không nhân bản.
       */
      positionScope === 'NONE'
        ? Promise.resolve([])
        : computeMemberPerformance(portfolio.id, { onlyTeamId: filter.teamId }),
      /*
       * TÀI KHOẢN & VỐN THEO IB. Cổng là `capitalScope`, không phải `positionScope`:
       * đây là dữ liệu vốn, không phải vị thế.
       */
      capitalScope === 'NONE'
        ? Promise.resolve([])
        : computeIbExposure(portfolio.id, { onlyTeamId: ibTeamId }),
    ]);

  const open = summary.positions.filter((p) => p.quantity > 0);

  // --- Dữ liệu biểu đồ -----------------------------------------------------

  /*
   * Màu lấy theo `colorIndex` của chính thực thể, KHÔNG theo vị trí trong mảng —
   * mảng được sắp theo giá trị, nên gán màu theo vị trí sẽ làm màu của một ngành
   * đổi mỗi khi thứ hạng đổi.
   */
  const sectorSlices: DonutSlice[] = foldSlices(
    summary.sectorExposure.map((s) => ({
      key: s.sectorId,
      label: s.nameVi,
      value: s.marketValue,
      bps: s.weightBps,
      color: seriesColor(s.colorIndex),
    })),
  );

  const strategySlices: DonutSlice[] = summary.strategyAllocation.map((s) => ({
    key: s.strategyId,
    label: s.nameVi,
    value: s.netCapital,
    bps: s.weightBps,
    color: seriesColor(s.colorIndex),
  }));

  const teamRows = teamPerf.filter((t) => t.tradeCount > 0);
  const totalTeamCapital = teamRows.reduce((s, t) => s + t.netCapital, 0n);

  const teamCapitalBars: RankedBar[] = [...teamRows]
    .sort((a, b) => (b.netCapital > a.netCapital ? 1 : b.netCapital < a.netCapital ? -1 : 0))
    .map((nh) => ({
      key: nh.teamId || 'unassigned',
      label: nh.nameVi,
      value: nh.netCapital,
      bps: ratioToBps(nh.netCapital, totalTeamCapital),
      color: seriesColor(nh.colorIndex),
      trailing: (
        <span className="tabular text-tiny text-ink-500">{t.dash.memberCount(nh.memberCount)}</span>
      ),
    }));

  // --- Tài khoản & vốn theo IB --------------------------------------------

  const ibTongTaiKhoan = ibExposure.reduce((n, x) => n + x.accountCount, 0);
  const ibTongVon = ibExposure.reduce((v, x) => v + x.netCapital, 0n);
  const ibSoDong = ibExposure.reduce((n, x) => n + (x.accountCount - x.activeAccountCount), 0);

  /*
   * GỘP ĐUÔI THÀNH "KHÁC" — bắt buộc, không phải cho gọn.
   *
   * Số IB không có trần: mỗi thành viên tự gõ tên đầu mối của mình, nên danh sách
   * này sẽ vượt 8 slot màu. Sinh thêm màu cho slot thứ 9 là sai — sắc thứ 9 không
   * phân biệt được với sắc đã có dưới mắt người mù màu (xem `foldSlices`).
   *
   * Không dùng thẳng `foldSlices` vì nó gộp `DonutSlice`, mà loại đó chỉ mang được
   * MỘT đại lượng. Ở đây phải cộng cả tiền LẪN số tài khoản — thiếu vế thứ hai thì
   * dòng "Khác" hiện tiền của mười đầu mối kèm số tài khoản của một đầu mối.
   */
  const nhanIb = (x: IbExposure): string =>
    x.isDirect ? t.dash.ibDirect : x.label;

  const ibDauBang = ibExposure.slice(0, DONUT_MAX_SEGMENTS - 1);
  const ibDuoi = ibExposure.slice(DONUT_MAX_SEGMENTS - 1);
  const ibGon = ibExposure.length <= DONUT_MAX_SEGMENTS;

  const ibBars: RankedBar[] = [
    ...(ibGon ? ibExposure : ibDauBang).map((x) => ({
      key: x.key || '__direct__',
      label: nhanIb(x),
      value: x.netCapital,
      bps: x.weightBps,
      color: seriesColor(x.colorIndex),
      accountCount: x.accountCount,
    })),
    ...(ibGon
      ? []
      : [
          {
            key: '__other__',
            label: t.dash.ibOther(ibDuoi.length),
            value: ibDuoi.reduce((v, x) => v + x.netCapital, 0n),
            bps: ibDuoi.reduce((b, x) => b + x.weightBps, 0),
            color: undefined,
            accountCount: ibDuoi.reduce((n, x) => n + x.accountCount, 0),
          },
        ]),
  ].map((x) => ({
    key: x.key,
    label: x.label,
    value: x.value,
    bps: x.bps,
    color: x.color,
    /*
     * SỐ TÀI KHOẢN LÀ CHỮ, không phải trục thứ hai.
     *
     * Chữ mang màu chữ (`text-ink-500`), không mang màu chuỗi dữ liệu: màu chuỗi ở
     * cỡ 11px không đạt 4.5:1, và ô màu cạnh tên đã lo phần nhận diện rồi.
     */
    trailing: <span className="tabular text-tiny text-ink-500">{x.accountCount} tk</span>,
  }));

  const teamPnlBars: DivergingBar[] = [...teamRows]
    .sort((a, b) => b.returnBps - a.returnBps)
    .map((nh) => ({
      key: nh.teamId || 'unassigned',
      label: nh.nameVi,
      value: nh.totalPnl,
      bps: nh.returnBps,
      meta: (
        <span className="tabular text-tiny text-ink-500">{t.dash.orderCount(nh.tradeCount)}</span>
      ),
    }));

  /*
   * Chuỗi cho sparkline trong ô KPI.
   *
   * `portfolioIndex` đã chuẩn hoá về 100 ở đầu kỳ. Alpha là HIỆU của hai chuỗi đã
   * chuẩn hoá — phiên nào thiếu chỉ số thì BỎ, không nội suy: một đường liền mạch
   * dựng từ dữ liệu có lỗ hổng là đường nói dối.
   */
  /*
   * CẨN THẬN: `portfolioIndex` KHÔNG phải giá trị danh mục.
   *
   * Nó là lãi/lỗ trên giá vốn, chuẩn hoá về 100 tại phiên ĐẦU của khoảng. Vì
   * chuẩn hoá theo phiên đầu chứ không theo mốc 0, một danh mục đang lỗ 10% mà
   * cải thiện lên lỗ 3% sẽ vẽ ra đường ĐI LÊN — trong khi lãi/lỗ tuyệt đối vẫn
   * âm. Đường đi lên cạnh một con số âm là đúng dữ liệu, không phải lỗi vẽ.
   */
  const valueSeries = series.points.map((p) => p.portfolioIndex);

  /*
   * Hướng của chính đường đó, dùng cho màu đường.
   *
   * Gần như luôn cùng dấu với delta, và đó là hệ quả cấu trúc chứ không may mắn:
   * `portfolioIndex` của phiên đầu luôn bằng 100, nên "đường kết thúc trên mốc
   * xuất phát" và "delta ≥ 0" là cùng một điều.
   *
   * MỘT NGOẠI LỆ hẹp: delta đọc ở phiên cuối CÓ chỉ số VN-Index (để Alpha cùng
   * gốc cùng đích), còn đường vẽ hết mọi phiên. Nếu phiên cuối cùng thiếu dòng
   * chỉ số VÀ đường vượt qua mốc 100 đúng ở phiên đó, màu đường và dấu delta sẽ
   * ngược nhau. Chấp nhận: màu đường phải nói đúng đường ĐANG VẼ, còn delta phải
   * nói đúng khoảng ĐO ĐƯỢC — ép chúng bằng nhau thì một trong hai sẽ nói sai.
   */
  const valueRising =
    valueSeries.length < 2 || valueSeries[valueSeries.length - 1]! >= valueSeries[0]!;

  /*
   * NHÃN IN NGÀY THẬT, không in tên khoảng.
   *
   * Người dùng chọn "Từ đầu năm" nhưng `price_history` chỉ có từ 10/02, nên con
   * số chỉ phủ từ 10/02. In lại tên khoảng là hứa một phạm vi mà con số không
   * phủ hết — và người đọc không có cách nào biết. In ngày bắt đầu thật thì
   * không cần một dòng cảnh báo nào cả.
   *
   * Trường hợp `source === 'current'` (chưa có phiên nào) thì KHÔNG có mức thay
   * đổi theo khoảng để in — `deltaLabel` là null và ô KPI tự ẩn dòng đó, thay vì
   * hiện lãi/lỗ toàn thời gian dưới một cái nhãn nói về thời gian.
   */
  const shortDate = (d: Date) =>
    d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const periodLabel = t.period[period].toLowerCase();

  /*
   * KHI ĐANG LỌC, Ô THỨ NHẤT KHÔNG CỘNG TIỀN VÀO.
   *
   * `capital_flows.teamId` đã có, nên tiền của một NHÓM là số thật — ô "Tiền của
   * nhóm" ở dưới dùng nó. Nhưng ô thứ nhất vẫn không cộng, vì hai lý do:
   *
   *   1. Bộ lọc theo NGÀNH hay CHIẾN LƯỢC vẫn không chia được tiền: bảng không có
   *      `stockId`, và vốn được cấp cho người chứ không cấp cho ngành.
   *   2. Ngay cả với nhóm, "vị thế của nhóm + tiền được cấp cho nhóm" không phải
   *      một đại lượng ai đi tìm. Câu hỏi thật là hai câu riêng: nhóm đang giữ bao
   *      nhiêu tài sản, và nhóm còn bao nhiêu tiền để tiêu.
   *
   * Cộng tiền TOÀN danh mục vào vị thế của một nhóm — cách làm cũ — cho ra con số
   * mà tổng bốn nhóm lên tới ₫19,26 tỷ trong khi danh mục thật chỉ có ₫10,33 tỷ.
   */
  const scopeNote = [
    filter.teamId !== undefined
      ? (teams.find((x) => x.id === filter.teamId)?.nameVi ?? t.filter.team)
      : null,
    filter.sectorId ? sectors.find((x) => x.id === filter.sectorId)?.nameVi : null,
    filter.strategyId ? strategies.find((x) => x.id === filter.strategyId)?.nameVi : null,
  ]
    .filter(Boolean)
    .join(' · ');

  /*
   * Lọc theo CHIẾN LƯỢC không đi vào chuỗi (xem `computePerformanceSeries`), nên
   * đường và mức thay đổi lúc đó là của toàn danh mục. Nói ra, không im lặng.
   */
  /*
   * VÌ SAO CHƯA CÓ ALPHA — BA LÝ DO KHÁC HẲN NHAU, và người đọc xử lý mỗi cái một
   * cách khác nhau:
   *
   *   chưa có vị thế   không có gì để đo. Nhập lệnh xong là có.
   *   thiếu chỉ số     chuỗi VNINDEX rỗng trong khoảng đang xem. Chạy đồng bộ.
   *   lệch khoảng      hai vế có dữ liệu nhưng không cùng khoảng thời gian.
   *
   * Trước đây cả ba đều in ra "thiếu dữ liệu giá theo phiên". Câu đó SAI ở trường
   * hợp thứ nhất — dữ liệu giá đầy đủ, chỉ là danh mục chưa mua gì — và nó chỉ người
   * đọc đi sửa đúng thứ không hỏng.
   */
  const lyDoChuaCoAlpha = ((): { sub: string; hint: string } => {
    if (series.points.length === 0) {
      /*
       * CHUỖI RỖNG CÓ HAI NGHĨA, và chúng dẫn tới hai việc phải làm khác hẳn nhau.
       *
       * Bản đầu của khối này gộp cả hai thành "chưa có vị thế nào". Đo trên dữ liệu
       * thật thì câu đó SAI ngay: danh mục có 4.000 ACB, lịch sử giá ACB có 174
       * phiên — nhưng dừng ở 25/08 trong khi lệnh mua ghi ngày 09/09, nên không có
       * phiên nào TỪ NGÀY MUA TRỞ ĐI để dựng chuỗi. Người đọc câu cũ sẽ đi tìm vị
       * thế của mình thay vì đi chạy đồng bộ giá.
       */
      if (open.length === 0) {
        return { sub: t.kpi.alphaNoPositions, hint: t.kpi.alphaNoPositionsHint };
      }
      return { sub: t.kpi.alphaNoPriceHistory, hint: t.kpi.alphaNoPriceHistoryHint };
    }
    if (!perf.benchmarkFrom || !perf.benchmarkTo) {
      return {
        sub: t.kpi.alphaNoBenchmark(perf.benchmarkCode),
        hint: t.kpi.alphaNoBenchmarkHint(perf.benchmarkCode),
      };
    }
    return { sub: t.kpi.alphaMismatch, hint: t.kpi.alphaMismatchHint };
  })();

  const seriesIgnoresStrategy = Boolean(filter.strategyId);

  /*
   * TIỀN CHỈ THEO ĐƯỢC CHIỀU NHÓM.
   *
   * `capital_flows.teamId` cho phép cấp riêng vốn cho một nhóm, nên số dư tiền của
   * nhóm là số thật. Nhưng lọc theo NGÀNH hay CHIẾN LƯỢC thì tiền vẫn là của toàn
   * danh mục: bảng không có `stockId`, và vốn được cấp cho người chứ không cấp cho
   * ngành. Vì vậy điều kiện ở đây là `filter.teamId`, không phải `narrowed`.
   */
  const cashByTeam = filter.teamId !== undefined;
  const teamCash = summary.cash;
  const granted = teamCash.contributedCapital + teamCash.otherFlows;

  /*
   * HIỆU SUẤT CHỈ ĐƯỢC HIỆN KHI NÓ THUỘC ĐÚNG PHẠM VI ĐANG XEM.
   *
   * `perf.comparable` chỉ nói hai vế cùng khoảng THỜI GIAN. Còn thiếu một điều:
   * chuỗi có thật sự thuộc phạm vi đang lọc hay không. Khi lọc theo chiến lược,
   * chuỗi là của toàn danh mục — đặt một mức thay đổi toàn danh mục ngay dưới một
   * con số đã lọc thì người đọc hiểu đó là mức thay đổi của con số đó.
   *
   * Không hiện gì còn hơn hiện một con số đúng nhưng thuộc phạm vi khác.
   */
  const perfInScope = perf.comparable && !seriesIgnoresStrategy;

  /** Tỷ trọng vị thế trên danh mục THẬT — mẫu số không đổi theo bộ lọc. */
  const investedOfWholeBps = ratioToBps(summary.investedValue, whole.portfolioValue);

  const deltaLabel = perf.window
    ? t.kpi.fromSessions(shortDate(perf.window.from), perf.window.sessions)
    : null;
  const alphaSeries = series.points
    .filter((p) => p.benchmarkIndex !== null)
    .map((p) => p.portfolioIndex - (p.benchmarkIndex ?? 0));

  const alertCount = alerts.length;

  /*
   * THANH LÃI/LỖ THEO CÁ NHÂN.
   *
   * Dùng lại `DivergingBars` — đúng component mà khối theo nhóm ở trên dùng.
   * Có chủ đích: cùng một câu hỏi ở mức chi tiết hơn thì phải trông giống nhau,
   * để người đọc hiểu ngay đây là "vẫn lãi/lỗ, nhưng theo người" chứ không phải
   * một đại lượng mới.
   *
   * MÀU CHẤM LẤY THEO NHÓM, nên hai người cùng nhóm cùng màu và mắt nối được
   * dòng ở đây với thanh nhóm phía trên. Cho mỗi người một màu riêng thì màu
   * không nói gì cả — bảng màu chỉ có tám slot phân biệt được.
   */
  const MEMBER_ROWS = 10;

  const memberBars: DivergingBar[] = memberPerf.slice(0, MEMBER_ROWS).map((m) => ({
    key: m.userId,
    label: m.fullName,
    value: m.totalPnl,
    bps: m.returnBps,
    href: `/members/${m.userId}`,
    meta: (
      <span className="flex shrink-0 items-center gap-1.5 text-tiny text-ink-500">
        <span
          className="size-1.5 rounded-sm"
          style={{ backgroundColor: seriesColor(m.colorIndex) }}
          aria-hidden
        />
        <span className="hidden sm:inline">{m.teamNameVi}</span>
        <span aria-hidden>·</span>
        {t.dash.orderCount(m.tradeCount)}
      </span>
    ),
  }));

  const hiddenMembers = Math.max(0, memberPerf.length - MEMBER_ROWS);
  const showMembers = positionScope !== 'NONE';

  // --- Bộ lọc --------------------------------------------------------------

  const filterGroups: FilterGroup[] = [
    {
      name: 'portfolioId',
      label: t.filter.portfolio,
      allLabel: portfolios.length > 1 ? t.filter.all : portfolio.code,
      options: portfolios.map((p) => ({ value: p.id, label: p.nameVi ?? p.name })),
    },
    {
      name: 'teamId',
      label: t.filter.team,
      allLabel: t.filter.all,
      options: teams.map((t) => ({ value: t.id, label: t.nameVi })),
      lockedReason: seeAllTeams
        ? undefined
        : t.dash.teamLocked(user.teamNameVi ?? t.dash.noTeam),
    },
    {
      name: 'strategyId',
      label: t.filter.strategy,
      allLabel: t.filter.all,
      options: strategies.map((s) => ({ value: s.id, label: s.nameVi })),
    },
    {
      name: 'sectorId',
      label: t.filter.sector,
      allLabel: t.filter.all,
      options: sectors.map((s) => ({ value: s.id, label: s.nameVi })),
    },
    {
      name: 'period',
      label: t.filter.period,
      allLabel: t.period.YTD,
      options: PERIODS.filter((p) => p !== 'YTD').map((p) => ({
        value: p,
        label: t.period[p],
      })),
    },
  ];

  const activeFilters = [
    params.teamId && seeAllTeams ? teams.find((t) => t.id === params.teamId)?.nameVi : null,
    params.strategyId ? strategies.find((s) => s.id === params.strategyId)?.nameVi : null,
    params.sectorId ? sectors.find((s) => s.id === params.sectorId)?.nameVi : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <Header
        title={BRAND_TAGLINE}
        subtitle={[
          summary.portfolioName,
          t.dash.positionCount(summary.positionCount),
          user.roleNameVi,
          portfolioScope === 'ALL'
            ? null
            : t.dash.scopeTeam(user.teamNameVi ?? t.dash.noTeam),
          activeFilters.length > 0 ? t.dash.filtering(activeFilters.join(' · ')) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        filters={<DashboardFilters groups={filterGroups} />}
        alertCount={alertCount}
        alertsTitle={t.dash.openAlerts(alertCount)}
      />

      {/* Việc cần làm — chỉ hiện khi thực sự có việc */}
      {pendingUsers > 0 || (cho?.total ?? 0) > 0 ? (
        <Card className="mb-3 flex flex-wrap items-center justify-between gap-3 border-warn-500/30 bg-warn-500/5 px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-warn-500">
            <Icon name="approvals" />
            {[
              cho && cho.trades > 0 ? t.dash.pendingTrades(cho.trades) : null,
              cho && cho.withdrawals > 0 ? t.dash.pendingWithdrawals(cho.withdrawals) : null,
              pendingUsers > 0 ? t.dash.pendingUsers(pendingUsers) : null,
            ]
              .filter(Boolean)
              .join(t.dash.and)}{' '}
            {t.dash.awaitingApproval}
          </p>
          <Link
            href={(cho?.total ?? 0) > 0 ? '/approvals' : '/admin/users?status=PENDING'}
            className="rounded-lg bg-warn-500/20 px-3 py-1.5 text-xs font-medium text-warn-500 transition hover:bg-warn-500/30"
          >
            {t.dash.viewQueue}
          </Link>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {/* §12 KPI                                                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {/*
          Hình và màu LẤY THEO DẤU CỦA CHÍNH CON SỐ, không ghim cứng.

          Trước đây ô này ghim `icon="trendUp" tone="up"` và `positive` cho đường
          — nên khi danh mục âm, ô hiện mũi tên xanh đi lên và một dải xanh ngay
          cạnh dòng đỏ "−3,17%". Ba tín hiệu trong cùng một ô nói hai điều ngược
          nhau, và cái ghim cứng luôn là cái nói sai.

          Đường và số delta là HAI ĐẠI LƯỢNG KHÁC NHAU (xem chú thích ở
          `valueSeries`), nên mỗi cái lấy dấu theo dữ liệu của chính nó chứ không
          ép cùng một màu.
        */}
        <Kpi
          /*
            Không so sánh được thì icon KHÔNG được chỉ hướng: một mũi tên lên hay
            xuống là một tuyên bố về diễn biến, và lúc đó ta chưa đo được diễn
            biến nào.
          */
          icon={
            !perfInScope ? 'wallet' : perf.portfolioBps >= 0 ? 'trendUp' : 'trendDown'
          }
          tone={
            !perfInScope ? 'accent' : perf.portfolioBps >= 0 ? 'up' : 'down'
          }
          label={narrowed ? t.kpi.positionValue : t.kpi.portfolioValue}
          hint={
            (narrowed
              ? t.kpi.hintValueFiltered(scopeNote, cashByTeam)
              : t.kpi.hintValueWhole) +
            (perfInScope && perf.window
              ? t.kpi.hintWindow(
                  perf.window.sessions,
                  shortDate(perf.window.from),
                  shortDate(perf.window.to),
                  periodLabel,
                )
              : '') +
            (seriesIgnoresStrategy
              ? t.kpi.hintNoStrategySeries
              : !perf.comparable
                ? t.kpi.hintNoSeries
                : '')
          }
          value={
            <MoneyCompact
              value={narrowed ? summary.investedValue : summary.portfolioValue}
              className="text-strong"
            />
          }
          sub={
            narrowed
              ? `${t.kpi.ofPortfolio(
                  formatBps(ratioToBps(summary.investedValue, whole.portfolioValue), false),
                )} · ${t.kpi.notIncludingCash}`
              : t.kpi.portfolioValueSub
          }
          chart={
            /* Đường cũng thuộc phạm vi hay không, cùng một điều kiện với delta. */
            perfInScope ? (
              <Sparkline
                values={valueSeries}
                width={230}
                height={38}
                area
                positive={valueRising}
              />
            ) : null
          }
          delta={perfInScope ? perf.portfolioBps : undefined}
          deltaLabel={perfInScope ? (deltaLabel ?? undefined) : undefined}
        />

        {/*
          KHI ĐANG LỌC, Ô NÀY ĐỔI SANG GIÁ VỐN.

          Không lọc thì "Portfolio Value" = vị thế + tiền, còn ô này = vị thế —
          hai con số khác nhau. Nhưng khi lọc, tiền không quy về nhóm được nên ô
          thứ nhất chỉ còn phần vị thế, và hai ô hiện Y HỆT một con số. Hai thẻ
          cạnh nhau nói cùng một điều là mất không một ô KPI.

          Đổi sang giá vốn thì cả hàng đọc thành một câu: bỏ vào bao nhiêu → giờ
          đáng bao nhiêu → tiền còn lại → lãi/lỗ → hơn kém thị trường. Và ô "Total
          P&L" ngay bên phải đúng bằng hiệu của hai ô đầu.
        */}
        <Kpi
          icon="pie"
          tone="accent"
          label={narrowed ? t.kpi.cost : t.kpi.investedCapital}
          hint={
            narrowed
              ? t.kpi.hintCostFiltered(scopeNote)
              : t.kpi.hintInvestedWhole
          }
          value={
            <MoneyCompact
              value={narrowed ? summary.investedCost : summary.investedValue}
              className="text-strong"
            />
          }
          sub={
            narrowed
              ? t.kpi.spentOnHeld
              : t.kpi.ofPortfolio(formatBps(investedOfWholeBps, false))
          }
          chart={
            narrowed ? null : <Bar bps={investedOfWholeBps} color="var(--accent)" />
          }
        />

        <Kpi
          icon="wallet"
          tone="up"
          label={cashByTeam ? t.kpi.teamCash : t.kpi.availableCash}
          hint={
            !cashByTeam
              ? t.kpi.hintCash +
                (narrowed
                  ? t.kpi.hintCashNotFiltered
                  : '')
              : teamCash.noGrant
                ? t.kpi.hintTeamNoGrant(formatCompactVnd_vi(-teamCash.cashBalance))
                : t.kpi.hintTeamCash(
                    formatCompactVnd_vi(granted),
                    formatCompactVnd_vi(teamCash.spentOnBuys - teamCash.receivedFromSells),
                  )
          }
          value={
            cashByTeam && teamCash.noGrant ? (
              <span className="text-ink-500">—</span>
            ) : (
              <MoneyCompact
                value={cashByTeam ? teamCash.availableCash : whole.cash.availableCash}
                className="text-strong"
              />
            )
          }
          /*
           * NÓI RA KHOẢN ĐANG BỊ GIỮ, ngay trên thẻ.
           *
           * "Available Cash" là số dư TRỪ quỹ dự phòng. Trước đây điều đó chỉ nằm
           * trong `hint` sau dấu ⓘ, nên người có 600 triệu trong tài khoản mà thấy
           * 120 triệu ở đây sẽ kết luận con số bị sai — không có gì trên thẻ nói cho
           * họ biết 480 triệu đang được giữ lại theo cấu hình của chính họ.
           *
           * Chỉ hiện khi quỹ dự phòng KHÁC 0: thêm chữ "giữ 0 ₫" vào mọi thẻ là làm
           * loãng dòng phụ ở trường hợp phổ biến nhất.
           */
          sub={
            !cashByTeam
              ? [
                  t.kpi.ofPortfolio(formatBps(whole.allocation.cashBps, false)),
                  narrowed ? t.kpi.notFiltered : null,
                  whole.cash.reserveAmount > 0n
                    ? t.kpi.holdingReserve(formatCompactVnd_vi(whole.cash.reserveAmount))
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : teamCash.noGrant
                ? t.kpi.noGrantYet
                : t.kpi.remainingOfGrant(
                    formatBps(ratioToBps(teamCash.availableCash, granted), false),
                  )
          }
          chart={
            cashByTeam && teamCash.noGrant ? null : (
              <Bar
                bps={
                  cashByTeam
                    ? ratioToBps(teamCash.availableCash, granted)
                    : whole.allocation.cashBps
                }
                color="var(--up)"
              />
            )
          }
        />

        <Kpi
          icon={summary.totalPnl >= 0n ? 'trendUp' : 'trendDown'}
          tone={summary.totalPnl >= 0n ? 'up' : 'down'}
          label={t.kpi.totalPnl}
          hint={
            t.kpi.hintPnl +
            (summary.investedCost === 0n
              ? t.kpi.hintPnlNoCost
              : '')
          }
          value={<MoneyCompact value={summary.totalPnl} signed />}
          sub={
            /*
              `ratioToBps` trả 0 khi mẫu số bằng 0, nên in thẳng sẽ ra "0,00% trên
              giá vốn" cho một phạm vi CHƯA BỎ VỐN — cùng loại lỗi đã sửa ở
              `MemberPerformance.returnBps`. Không có giá vốn thì không có tỷ suất.
            */
            summary.investedCost === 0n
              ? t.kpi.noCapitalYet
              : t.kpi.onCost(formatBps(summary.totalPnlBps))
          }
          chart={
            /* Cùng `valueSeries` với ô đầu, nên cùng điều kiện phạm vi. */
            perfInScope ? (
              <Sparkline
                values={valueSeries}
                width={230}
                height={38}
                positive={summary.totalPnl >= 0n}
              />
            ) : null
          }
        />

        <Kpi
          /*
            ALPHA CHỈ IN KHI HAI VẾ CÙNG KHOẢNG.

            Hiệu của "lãi/lỗ toàn thời gian" trừ "mức tăng chỉ số từ đầu năm" là
            một con số vô nghĩa nhưng trông hoàn toàn bình thường — nó từng làm
            Alpha nhảy từ +0,85% xuống −20,22% chỉ vì người dùng đổi khoảng. Thà
            in "—" còn hơn in một con số sẽ được dùng để đánh giá con người.
          */
          icon={
            !perfInScope ? 'shield' : perf.alphaBps >= 0 ? 'trendUp' : 'trendDown'
          }
          tone={
            !perfInScope ? 'accent' : perf.alphaBps >= 0 ? 'up' : 'down'
          }
          label={t.kpi.alphaVs(perf.benchmarkCode)}
          hint={
            perfInScope
              ? t.kpi.hintAlpha(
                  perf.window ? `${shortDate(perf.window.from)} → ${shortDate(perf.window.to)}` : '',
                )
              : seriesIgnoresStrategy
                ? t.kpi.hintAlphaNoStrategy
                : lyDoChuaCoAlpha.hint
          }
          value={
            perfInScope ? (
              <Change bps={perf.alphaBps} />
            ) : (
              <span className="text-ink-500">—</span>
            )
          }
          sub={
            perfInScope
              ? t.kpi.alphaSub(
                  formatBps(perf.portfolioBps),
                  perf.benchmarkCode,
                  formatBps(perf.benchmarkBps),
                )
              : seriesIgnoresStrategy
                ? t.kpi.alphaNotForStrategy
                : lyDoChuaCoAlpha.sub
          }
          chart={
            perfInScope && alphaSeries.length >= 2 ? (
              <Sparkline
                values={alphaSeries}
                width={230}
                height={38}
                positive={perf.alphaBps >= 0}
              />
            ) : null
          }
        />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Hàng chính — MỘT lưới, các thẻ tự xếp                            */}
      {/* ---------------------------------------------------------------- */}
      {/*
        VÌ SAO KHÔNG CÒN "CỘT TRÁI RỘNG + CỘT PHẢI 23rem".

        Bố cục hai cột cân bằng được đúng MỘT bộ thẻ. Số thẻ ở đây lại thay đổi
        theo QUYỀN của người xem, và đo ở khổ 1600px cho thấy hậu quả:

          Quản trị hệ thống   cột trái 973px · cột phải 1031px → lỗ  57px
          Quản lý nhóm        cột trái 287px · cột phải  932px → lỗ 644px

        Quản lý nhóm không có `position.view_all` nên mất thẻ "Vốn & lãi/lỗ theo
        nhóm" (498px) khỏi cột trái, còn cột phải không đổi. Chiều cao một hàng
        lưới bằng ô cao nhất, nên toàn bộ phần chênh dồn thành MỘT lỗ trống ở
        giữa trang — và nó ở giữa chứ không ở cuối vì phía dưới còn một hàng nữa.

        Thành viên thường còn mất thêm cả "Risk & Alerts" và thẻ IB, nên không
        phải hai dạng bố cục mà là nhiều dạng. Tôi đã thử ba cách chia tay khác
        nhau: cách nào cũng lệch khoảng 500px cho một vai trò khác — đúng bằng
        thẻ chênh nhau. Cân tay không giải được bài này.

        Nay mọi thẻ là con TRỰC TIẾP của một lưới. Hàng tự hình thành theo số thẻ
        thực có, phần chênh chiều cao bị hấp thụ NGAY TRONG hàng (thẻ ngắn giãn
        cho bằng thẻ cao nhất) thay vì dồn lại. Thêm hay bớt thẻ không phải cân
        lại gì.

        Hai thẻ cần rộng hơn một cột thì khai `col-span` tại chỗ:
          "Vốn & lãi/lỗ theo nhóm"  span hết chiều rộng (bên trong nó đã chia hai)
          "Giao dịch gần nhất"      span 2 cột — bảng cần 608px, một cột ~428px

        BA CỘT TỪ xl, KHÔNG TỪ lg: ở 1280px mỗi cột được ~400px, vừa đủ cho chú
        giải donut không cắt tên ngành tiếng Việt. Trước đây mốc này là 2xl vì cột
        trái chỉ chiếm 70% chiều rộng; giờ lưới dùng cả bề ngang nên xuống được xl.
      */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {seeAllTeams && teamRows.length > 0 ? (
          <Card className="p-5 sm:col-span-2 xl:col-span-3">
            <Section
              title={t.dash.teamPnlTitle}
              sub={t.dash.teamPnlSub}
              href="/teams"
            />

            {/*
              HAI DẠNG KHÁC NHAU VÌ HAI CÂU HỎI KHÁC NHAU. Vốn: mọi giá trị cùng
              dấu, việc cần làm là so độ lớn → thanh xếp hạng neo lề trái. Lãi/lỗ:
              dấu của con số là thông tin quan trọng nhất → thanh hai chiều quanh
              đường gốc giữa, để dấu nằm ở HÌNH DẠNG chứ không chỉ ở màu.
            */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <p className="mb-3 text-xs font-medium text-slate-soft">{t.dash.deployedCapital}</p>
                <RankedBars items={teamCapitalBars} />
              </div>
              <div>
                <p className="mb-3 text-xs font-medium text-slate-soft">{t.dash.pnlOnCost}</p>
                <DivergingBars items={teamPnlBars} />
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-xs">
                <thead>
                  <tr className="border-b border-ink-800 text-left text-slate-muted">
                    <th className="pb-2 font-medium">{t.dash.colTeam}</th>
                    <th className="pb-2 text-right font-medium">{t.common.marketValue}</th>
                    <th className="pb-2 text-right font-medium">{t.dash.colRealized}</th>
                    <th className="pb-2 text-right font-medium">{t.dash.colUnrealized}</th>
                    <th className="pb-2 text-right font-medium">{t.dash.colOrders}</th>
                    <th className="pb-2 text-right font-medium">{t.dash.colSymbols}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800">
                  {teamRows.map((nh) => (
                    <tr key={nh.teamId || 'unassigned'}>
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2 shrink-0 rounded-sm"
                            style={{ backgroundColor: seriesColor(nh.colorIndex) }}
                            aria-hidden
                          />
                          <span
                            className={nh.unassigned ? 'text-slate-muted' : 'text-slate-soft'}
                          >
                            {nh.nameVi}
                          </span>
                          {nh.unassigned ? (
                            <span
                              className="rounded border border-warn-500/40 px-1 py-px text-micro text-warn-500"
                              title={t.dash.unassignedTitle}
                            >
                              {t.dash.unassigned}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="tabular py-2 text-right">
                        <MoneyCompact value={nh.marketValue} className="text-strong" />
                      </td>
                      <td className="tabular py-2 text-right">
                        <MoneyCompact value={nh.realizedPnl} signed />
                      </td>
                      <td className="tabular py-2 text-right">
                        <MoneyCompact value={nh.unrealizedPnl} signed />
                      </td>
                      <td className="tabular py-2 text-right text-slate-muted">
                        {nh.tradeCount}
                      </td>
                      <td className="tabular py-2 text-right text-slate-muted">
                        {nh.positionCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {teamRows.some((t) => t.unassigned) ? (
                <p className="mt-3 text-tiny text-ink-500">
                  {t.dash.unassignedNote}
                  <Link href="/admin/users" className="text-accent-400 hover:underline">
                    {t.dash.usersLink}
                  </Link>
                  .
                </p>
              ) : null}
            </div>
          </Card>
        ) : null}

        <Card className="p-5">
          <Section title={t.dash.sectorExposure} href="/portfolio/allocation" />
          {sectorSlices.length === 0 ? (
            <p className="py-4 text-sm text-slate-muted">{t.dash.noPositions}</p>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <Donut
                slices={sectorSlices}
                size={148}
                thickness={20}
                centerLabel={t.dash.sectorCenter}
                centerValue={String(summary.sectorExposure.length)}
              />
              <DonutLegend slices={sectorSlices} className="w-full" />
            </div>
          )}
        </Card>

        <Card className="p-5">
          <Section
            title={t.dash.top10Title}
            href="/portfolio/positions"
            hrefLabel={t.common.viewAll}
          />
          {open.length === 0 ? (
            <p className="py-4 text-xs text-ink-500">{t.dash.noHoldings}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-ink-800 text-left text-slate-muted">
                    <th className="pb-2 font-medium">{t.dash.colStock}</th>
                    <th className="pb-2 text-right font-medium">{t.common.weight}</th>
                    <th className="pb-2 text-right font-medium">{t.dash.colValue}</th>
                    <th className="pb-2 text-right font-medium">P&amp;L</th>
                    <th className="pb-2 text-right font-medium">P&amp;L (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800">
                  {open.slice(0, 10).map((p) => (
                    <tr key={p.stockId}>
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2 shrink-0 rounded-sm"
                            style={{ backgroundColor: seriesColor(p.sectorSortOrder) }}
                            aria-hidden
                          />
                          <span className="font-mono font-semibold text-strong">
                            {p.symbol}
                          </span>
                        </span>
                      </td>
                      <td className="tabular py-2 text-right text-slate-muted">
                        <Weight bps={p.weightBps} />
                      </td>
                      <td className="tabular py-2 text-right">
                        <MoneyCompact value={p.marketValue} className="text-slate-soft" />
                      </td>
                      <td className="tabular py-2 text-right">
                        <MoneyCompact value={p.unrealizedPnl} signed />
                      </td>
                      <td className="tabular py-2 text-right">
                        <Change bps={p.returnBps} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/*
          TÀI KHOẢN & VỐN THEO IB — thay cho thẻ "Phân bổ theo ngành" trước đây.

          Thẻ cũ là một BẢNG lặp lại đúng dữ liệu của donut "Sector Exposure"
          nằm ngay bên trái nó: cùng ngành, cùng tỷ trọng, cùng giá trị. Hai
          cách vẽ một con số cạnh nhau không cho biết thêm gì, mà lại chiếm mất
          một ô lưới.

          DẠNG BIỂU ĐỒ: thanh ngang xếp hạng, KHÔNG phải hai trục.

          Ô này có hai đại lượng — số tài khoản và số tiền. Vẽ cả hai thành hai
          trục là lỗi biểu đồ kinh điển: hai thang khác nhau đặt chung khung thì
          chỗ hai đường cắt nhau trông như một sự kiện, trong khi nó chỉ là hệ quả
          của việc chọn thang. Ở đây SỐ TIỀN mang độ dài thanh (đại lượng cần so
          sánh), còn SỐ TÀI KHOẢN là chữ bên cạnh tên. Mắt so chiều dài chính xác
          hơn so diện tích cung tròn, nên thanh ngang chứ không phải donut — và
          tên IB là tên người Việt, hàng ngang mới đủ chỗ.
        */}
        <Card className="p-5">
          <Section
            title={t.dash.ibTitle}
            sub={t.dash.ibSub(ibTongTaiKhoan)}
          />
          {ibExposure.length === 0 ? (
            /*
              HAI TRẠNG THÁI RỖNG KHÁC NHAU, và gộp chúng lại là nói sai.

              Không có quyền `capital.view` thì ô này không có dữ liệu để hiện —
              nói "chưa có tài khoản nào" với người đó là báo sai hiện trạng hệ
              thống. Thà nói thẳng là không xem được.
            */
            capitalScope === 'NONE' ? (
              <p className="py-4 text-xs text-ink-500">
                {t.dash.ibNoPermission}
              </p>
            ) : (
              <p className="py-4 text-xs text-ink-500">
                {t.dash.ibNoAccounts}
                {filter.teamId !== undefined ? t.dash.ibInScope : ''}
                {t.dash.ibDeclareAt}
                <Link href="/profile" className="text-accent-soft hover:underline">
                  {t.dash.myAccounts}
                </Link>
                .
              </p>
            )
          ) : (
            <>
              <RankedBars items={ibBars} />

              {/*
                DÒNG CUỐI NÓI RÕ "VỐN" LÀ GÌ.

                "Số tiền của IB" có ít nhất ba cách hiểu: vốn đã nạp, tiền còn
                dùng được, hay giá trị tài sản đang nắm. Ô này là cách thứ nhất.
                Không ghi ra thì người đọc tự chọn một cách hiểu, và có khi chọn
                khác người làm ra con số.
              */}
              <p className="mt-3 border-t border-ink-800 pt-2.5 text-tiny leading-relaxed text-ink-500">
                {t.dash.ibTotalPrefix}
                <MoneyCompact value={ibTongVon} className="text-slate-muted" />
                {t.dash.ibTotalVia(ibExposure.length)}
                {ibSoDong > 0
                  ? t.dash.ibClosed(ibSoDong)
                  : ''}
              </p>
            </>
          )}
        </Card>

        <Card className="p-5">
          <Section title={t.dash.riskAlerts} href="/risk" />
          {alerts.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-up-500">
              <span aria-hidden>🟢</span> {t.dash.noAlerts}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-start gap-2 leading-relaxed">
                  <span aria-hidden className="shrink-0">
                    {SEVERITY_DOT[a.severity]}
                  </span>
                  <Link href="/risk" className="group min-w-0">
                    <span className="block text-xs text-strong group-hover:underline">
                      {a.title}
                    </span>
                    <span className="tabular block text-tiny text-slate-muted">
                      {formatMeasure(a.ruleMetric as RiskMetric, a.measuredValue)}{t.dash.alertAgo}
                      {elapsedVi(a.triggeredAt)}
                      {a.status === 'ACKNOWLEDGED' ? t.dash.acknowledged : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <Section title={t.dash.strategyAllocation} href="/strategies" />
          {strategySlices.length === 0 ? (
            <p className="py-4 text-sm text-slate-muted">{t.dash.noTrades}</p>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <Donut
                slices={strategySlices}
                size={148}
                thickness={20}
                centerLabel={t.dash.strategyCenter}
                centerValue={String(strategySlices.length)}
              />
              <DonutLegend slices={strategySlices} className="w-full" />
            </div>
          )}
        </Card>

        {/*
          DÒNG SỰ VIỆC — cùng dữ liệu với bảng "Giao dịch gần nhất" bên dưới
          nhưng khác việc, nên khác cách trình bày:

            ở đây    "vừa có gì xảy ra"  → nhiều dòng, ít cột, chỉ giờ phút
            bên dưới "đọc kỹ một lệnh"   → ít dòng, đủ cột, có trạng thái

          Dùng chung một mảng `recentTrades` nên không thêm truy vấn nào.
        */}
        <Card className="p-5">
          <Section title={t.dash.recentActivity} href="/transactions" hrefLabel={t.common.viewAll} />
          {recentTrades.length === 0 ? (
            <p className="text-xs text-ink-500">{t.dash.noTrades}</p>
          ) : (
            <ul className="space-y-2">
              {recentTrades.map((t) => {
                const buy = t.transactionType === TRANSACTION_TYPE.BUY;
                const first = t.strategies[0];
                return (
                  <li key={t.id} className="flex items-baseline gap-2 text-tiny">
                    <time className="tabular w-9 shrink-0 text-ink-500">
                      {t.executedAt.toLocaleTimeString('vi-VN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                    <span
                      className={
                        'w-8 shrink-0 font-semibold ' +
                        (buy ? 'text-up-500' : 'text-down-500')
                      }
                    >
                      {buy ? 'BUY' : 'SELL'}
                    </span>
                    <Link
                      href={"/transactions/" + t.id}
                      className="w-10 shrink-0 font-mono font-semibold text-strong transition hover:text-accent-400"
                    >
                      {t.stock.symbol}
                    </Link>
                    <span className="tabular min-w-0 flex-1 text-right text-slate-soft">
                      <MoneyCompact
                        value={netAmount(
                          buy ? 'BUY' : 'SELL',
                          t.quantity,
                          t.price,
                          t.fees,
                          t.tax,
                        )}
                      />
                    </span>
                    {/*
                      CHẤM MÀU MANG DANH TÍNH, CHỮ MẶC ÁO CHỮ.

                      Trước đây chính tên chiến lược được tô bằng màu slot. Đo trên
                      nền sáng mới: "Sóng ngành" (vàng đồng) chỉ đạt 3,3:1 và "Tín
                      hiệu Xanh/Đỏ" (đất nung) 4,22:1 — dưới ngưỡng 4,5:1 của chữ
                      11px. Bảng màu phân loại được kiểm ở ngưỡng 3:1 dành cho DẤU
                      VẼ, không phải cho chữ.

                      Chấm màu vẫn nối khối này với donut Strategy Allocation phía
                      trên, mà chữ thì luôn đọc được.
                    */}
                    <span
                      className="flex w-[6.5rem] shrink-0 items-center justify-end gap-1.5"
                      title={t.strategies.map((a) => a.strategy.nameVi).join(' · ')}
                    >
                      {first ? (
                        <span
                          className="size-1.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: seriesColor(first.strategy.sortOrder - 1) }}
                          aria-hidden
                        />
                      ) : null}
                      <span className="truncate text-ink-500">
                        {first?.strategy.nameVi ?? '—'}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/*
          ĐẢO THỨ TỰ: "Giao dịch gần nhất" (span 2 cột) đứng TRƯỚC "Thành viên".

          Ở khổ hai cột, một thẻ span-2 không chia hàng được với thẻ một cột. Đặt
          "Thành viên" trước thì nó chiếm một ô rồi để trống ô còn lại — một lỗ
          329×255px nằm GIỮA trang. Đặt sau thì ô trống rơi về ô cuối cùng của
          trang, và ở đó nó chỉ đọc ra là "trang hết", không ra là "thiếu gì đó".

          Ở khổ ba cột thì hai thẻ này lấp đúng một hàng (2 + 1), không dư ô nào.
        */}
        <Card className="p-5 sm:col-span-2">
          <Section
            title={t.dash.recentTrades}
            href="/transactions"
            hrefLabel={t.dash.viewAllTrades}
          />
          {recentTrades.length === 0 ? (
            <p className="py-4 text-xs text-ink-500">{t.dash.noTrades}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] text-xs">
                <thead>
                  <tr className="border-b border-ink-800 text-left text-slate-muted">
                    <th className="pb-2 font-medium">{t.dash.colTime}</th>
                    <th className="pb-2 font-medium">{t.dash.colType}</th>
                    <th className="pb-2 font-medium">{t.dash.colStock}</th>
                    <th className="pb-2 font-medium">{t.dash.colStrategy}</th>
                    <th className="pb-2 text-right font-medium">{t.dash.colValue}</th>
                    <th className="pb-2 text-right font-medium">{t.dash.colStatus}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800">
                  {recentTrades.map((t) => {
                    const buy = t.transactionType === TRANSACTION_TYPE.BUY;
                    return (
                      <tr key={t.id}>
                        <td className="tabular py-2 text-slate-muted">
                          {t.executedAt.toLocaleString('vi-VN', {
                            hour: '2-digit',
                            minute: '2-digit',
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                          })}
                        </td>
                        <td className="py-2">
                          <span
                            className={`font-semibold ${buy ? 'text-up-500' : 'text-down-500'}`}
                          >
                            {buy ? 'BUY' : 'SELL'}
                          </span>
                        </td>
                        <td className="py-2">
                          <Link
                            href={`/transactions/${t.id}`}
                            className="font-mono font-semibold text-strong transition hover:text-accent-400"
                          >
                            {t.stock.symbol}
                          </Link>
                        </td>
                        <td className="py-2">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            {t.strategies.map((a) => (
                              <span
                                key={a.strategy.nameVi}
                                className="flex items-center gap-1 text-tiny text-slate-muted"
                              >
                                <span
                                  className="size-1.5 rounded-sm"
                                  style={{
                                    backgroundColor: seriesColor(a.strategy.sortOrder - 1),
                                  }}
                                  aria-hidden
                                />
                                {a.strategy.nameVi}
                              </span>
                            ))}
                          </span>
                        </td>
                        <td className="tabular py-2 text-right">
                          <Money
                            value={netAmount(
                              buy ? 'BUY' : 'SELL',
                              t.quantity,
                              t.price,
                              t.fees,
                              t.tax,
                            )}
                            className="text-slate-soft"
                          />
                        </td>
                        <td className="py-2 text-right">
                          <TradeStatusChip status={t.status as TradeStatus} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/*
          LÃI/LỖ THEO TỪNG CÁ NHÂN — thay cho khối thẻ cảnh báo trước đây.

          Khối cảnh báo đã bị bỏ, KHÔNG mất thông tin: thẻ "Risk & Alerts" vẫn
          liệt kê tới 8 cảnh báo đang mở kèm mức độ, và số cảnh báo vẫn
          hiện ở phù hiệu trên đầu trang. Hai khối cũ nói cùng một điều ở hai chỗ,
          nên khối lặp lại là khối phải đi.

          SẮP THEO SỐ TIỀN, tỷ suất in ngay cạnh. Xếp theo tỷ suất một mình sẽ đưa
          người có 10 triệu vốn lãi 10% lên trên người có 3 tỷ vốn lãi 200 triệu;
          xếp theo tiền một mình lại ưu ái người được cấp nhiều vốn. Hai con số
          cạnh nhau thì không che được chiều nào.

          KHÔNG CẮT BỚT PHẦN LỖ. Danh sách chạy hết mọi người có lệnh, sắp giảm
          dần, nên người lỗ nặng nhất nằm ở cuối chứ không bị ẩn. Chỉ cắt khi quá
          10 người, và lúc đó có dòng ghi rõ còn bao nhiêu người chưa hiện —
          cắt im lặng thì bảng trông như đã đủ.
        */}
        {showMembers ? (
          <Card className="p-5">
            <Section
              title={t.dash.topMembers}
              sub={t.dash.topMembersSub}
              href="/members"
              hrefLabel={t.dash.viewAllMembers}
            />
            {memberBars.length === 0 ? (
              <p className="py-4 text-xs text-ink-500">
                {t.dash.noMembers}
              </p>
            ) : (
              <>
                <DivergingBars items={memberBars} />
                {hiddenMembers > 0 ? (
                  <p className="mt-3 text-tiny text-ink-500">
                    {t.dash.moreMembers(hiddenMembers)}
                    <Link href="/members" className="text-accent-400 hover:underline">
                      {t.dash.fullList}
                    </Link>
                    .
                  </p>
                ) : null}
              </>
            )}
          </Card>
        ) : null}
      </div>

      {/*
        Ghi chú cuối trang nói lại nguyên tắc §23 cho NGƯỜI ĐỌC, không chỉ cho
        người viết code. Ai thấy một con số lạ sẽ biết ngay nó được tính ra từ đâu
        thay vì đi tìm một "bảng lưu P&L" không tồn tại.
      */}
      <p className="mt-4 text-tiny leading-relaxed text-ink-500">
        {t.dash.footerNote}
        <span className="tabular text-slate-muted">
          <Money value={summary.realizedPnl} signed />
        </span>{' '}
        {t.dash.footerUnrealized}
        <span className="tabular text-slate-muted">
          <Money value={summary.unrealizedPnl} signed />
        </span>
        .
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Thành phần trình bày
// ---------------------------------------------------------------------------

function Header({
  title,
  subtitle,
  filters,
  alertCount,
  alertsTitle,
}: {
  title: string;
  subtitle: string;
  filters: React.ReactNode;
  alertCount: number;
  /**
   * Nhãn của huy hiệu cảnh báo, đã dịch sẵn.
   *
   * Component này nằm NGOÀI hàm trang nên không thấy từ điển — và không nên tự đọc:
   * `getDict()` là hàm async chỉ dùng được trong Server Component, còn đây là một
   * thành phần trình bày thuần. Nhận chữ đã dịch qua prop giữ nó thuần như vậy.
   */
  alertsTitle: string;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-strong">{title}</h1>
        <p className="mt-0.5 text-sm text-slate-muted">{subtitle}</p>
      </div>

      <div className="flex items-end gap-3">
        {filters}
        {alertCount > 0 ? (
          <Link
            href="/risk"
            title={alertsTitle}
            className="relative mb-px grid size-9 place-items-center rounded-lg border border-ink-700 text-slate-muted transition hover:border-ink-600 hover:text-strong"
          >
            <Icon name="risk" />
            <span className="tabular absolute -top-1.5 -right-1.5 grid min-w-4 place-items-center rounded-full bg-down-500 px-1 text-micro font-semibold text-white">
              {alertCount}
            </span>
          </Link>
        ) : null}
      </div>
    </header>
  );
}

function Section({
  title,
  sub,
  href,
  hrefLabel,
}: {
  title: string;
  sub?: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold text-strong">{title}</h2>
        {sub ? <p className="mt-0.5 text-xs text-slate-muted">{sub}</p> : null}
      </div>
      {href ? (
        <Link
          href={href}
          className="rounded-md border border-ink-700 px-2 py-1 text-tiny text-slate-muted transition hover:border-ink-600 hover:text-strong"
        >
          {hrefLabel} →
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Ô KPI.
 *
 * `hint` hiện khi trỏ vào dấu ⓘ — chỗ để định nghĩa CHÍNH XÁC con số mà không làm
 * thẻ dài ra. "Available Cash" là số dư trừ quỹ dự phòng, không phải số dư tiền;
 * không nói ra thì người đọc tự hiểu sai và không có cách nào biết mình hiểu sai.
 */
/**
 * MÀU NỀN CỦA HÌNH TRONG Ô KPI.
 *
 * Nền tô cùng màu với BIỂU ĐỒ NẰM TRONG CHÍNH Ô ĐÓ, không tô cho đẹp: ô nào
 * vẽ đường/thanh màu tăng thì hình cũng màu tăng. Nhờ vậy hình và biểu đồ
 * trong một ô luôn nói cùng một điều, và hai ô đổi dấu (Total P&L, Alpha) đổi
 * màu cùng lúc với biểu đồ của nó.
 *
 * Độ mờ 12–15% là mức nền còn đọc được chữ số lớn bên cạnh mà không tranh
 * chú ý với nó.
 */
const KPI_TONE: Record<'accent' | 'up' | 'down', string> = {
  accent: 'bg-accent-600/15 text-accent-400',
  up: 'bg-up-500/12 text-up-500',
  down: 'bg-down-500/12 text-down-500',
};

function Kpi({
  icon,
  tone = 'accent',
  label,
  hint,
  value,
  sub,
  chart,
  delta,
  deltaLabel,
}: {
  icon: IconName;
  tone?: keyof typeof KPI_TONE;
  label: string;
  hint: string;
  value: React.ReactNode;
  sub: string;
  chart: React.ReactNode;
  delta?: number;
  deltaLabel?: string;
}) {
  return (
    <Card className="flex flex-col justify-between overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-xs text-slate-muted">
            <span className="truncate">{label}</span>
            <span className="cursor-help text-ink-500" title={hint} aria-label={hint} role="note">
              ⓘ
            </span>
          </p>
          {/* Số lớn đứng một mình dùng chữ số TỶ LỆ, không dùng đẳng khoảng */}
          <p className="hero-figure mt-1.5 text-2xl font-semibold">{value}</p>
          <p className="mt-0.5 text-tiny text-ink-500">{sub}</p>
        </div>

        <span
          className={`grid size-9 shrink-0 place-items-center rounded-lg ${KPI_TONE[tone]}`}
        >
          <Icon name={icon} />
        </span>
      </div>

      {delta !== undefined && deltaLabel ? (
        <p className="tabular mt-2 flex flex-wrap items-center gap-1 text-tiny">
          <span className={delta >= 0 ? 'text-up-500' : 'text-down-500'}>
            {delta >= 0 ? '↑' : '↓'} {formatBps(delta, false)}
          </span>
          <span className="text-ink-500">{deltaLabel}</span>
        </p>
      ) : null}

      {chart ? <div className="mt-2 -mb-1">{chart}</div> : null}
    </Card>
  );
}

/**
 * Thanh tỷ trọng trong ô KPI — dày hơn `WeightBar` để cân với ô số.
 *
 * XỬ LÝ SỐ ÂM. Bản cũ viết `Math.max(1, bps / 100)`, nên một tỷ trọng âm bị kẹp
 * thành 1% và vẫn tô MÀU CỦA CALLER. Tiền khả dụng âm — xảy ra thật khi số dư tụt
 * xuống dưới quỹ dự phòng, tức danh mục đã tiêu vào phần để dành — sẽ hiện
 * "−₫980tr" ở dòng số nhưng kèm một vạch XANH nhỏ, đọc thành "còn một chút".
 * Con số đúng, cái vạch nói ngược lại nó.
 *
 * Nay bề rộng lấy theo ĐỘ LỚN và màu lấy theo DẤU: âm thì luôn `--down`, bất kể
 * caller truyền màu gì. Dấu của con số không phải chuyện caller được quyết.
 *
 * Đúng 0 thì KHÔNG vẽ gì. Sàn 1% tồn tại để một tỷ trọng rất nhỏ vẫn thấy được,
 * nhưng dùng nó cho 0 là vẽ ra một phần không tồn tại.
 */
function Bar({ bps, color }: { bps: number; color: string }) {
  const negative = bps < 0;
  const pct = bps === 0 ? 0 : Math.min(100, Math.max(1, Math.abs(bps) / 100));

  return (
    <span className="mt-1 block h-2 w-full overflow-hidden rounded-full bg-ink-800">
      <span
        className="block h-full rounded-full"
        style={{
          width: `${pct}%`,
          backgroundColor: negative ? 'var(--down)' : color,
        }}
      />
    </span>
  );
}
