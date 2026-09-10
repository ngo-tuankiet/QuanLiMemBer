/**
 * Khung ứng dụng: sidebar theo đúng cấu trúc menu §21 + top bar.
 *
 * Mục menu được lọc theo QUYỀN THẬT của người dùng (`user.permissions`), nên
 * người không có `audit.view` sẽ không thấy mục Audit Log — chứ không phải thấy
 * rồi bấm vào mới bị chặn.
 *
 * Các mục thuộc phase chưa triển khai được hiển thị mờ kèm nhãn phase, thay vì
 * ẩn đi. Người dùng cần thấy toàn cảnh hệ thống sẽ có gì.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { logoutAction } from '@/auth/actions';
import { NavItem } from '@/components/NavItem';
import { MobileNav } from '@/components/MobileNav';
import type { IconName } from '@/components/icons';
import { PhaseTag, RoleBadge } from '@/components/ui';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getTheme } from '@/components/theme';
import { getDict, type Dict } from '@/i18n';
import { LangToggle } from '@/components/LangToggle';
import { getMarketDataStatus } from '@/domain/portfolio-engine';
import { countOpenAlertsBySeverity } from '@/risk/scan';
import { countPendingForUser } from '@/approvals/queue';
import type { AuthUser } from '@/auth/guards';
import { BRAND_NAME_UPPER, BRAND_TAGLINE } from '@/lib/brand';

interface MenuEntry {
  /**
   * Khoá tra vào `t.nav`, KHÔNG phải chữ hiển thị.
   *
   * Kiểu lấy thẳng từ từ điển nên gõ sai khoá là lỗi biên dịch, và thêm một mục
   * menu mà quên dịch cũng vậy — không có đường nào để một nhãn lọt ra màn hình
   * mà chưa qua từ điển.
   */
  labelKey: keyof Dict['nav'];
  href?: string;
  permission: string;
  /** Biểu tượng của mục cha. Mục con cố tình KHÔNG có icon — xem chú thích dưới. */
  icon?: IconName;
  /** Nhãn phase nếu chưa triển khai. */
  phase?: string;
  children?: { labelKey: keyof Dict['nav']; href?: string; phase?: string }[];
}

/**
 * CHỈ MỤC CHA CÓ BIỂU TƯỢNG.
 *
 * Mục con (Overview / Positions / Allocation…) cố tình để trống: chúng đã nằm
 * thụt vào sau một vạch dọc, nên quan hệ cha–con đã rõ bằng vị trí. Thêm icon cho
 * chúng sẽ tạo hai cột icon lệch nhau và làm menu trông rối hơn chứ không gọn hơn.
 */
/*
 * BẢNG MENU GIỮ KHOÁ, KHÔNG GIỮ CHỮ.
 *
 * Đây là hằng số ở module scope: nó chạy MỘT LẦN lúc nạp module, trong khi từ điển
 * phụ thuộc cookie của TỪNG request. Nhét chữ vào đây thì người đầu tiên mở app
 * quyết định ngôn ngữ cho mọi người sau đó — một lỗi chỉ lộ ra khi có hai người
 * dùng hai ngôn ngữ khác nhau cùng lúc. Chữ được tra ở chỗ kết xuất.
 */
const MENU: readonly MenuEntry[] = [
  { labelKey: 'dashboard', href: '/dashboard', permission: 'dashboard.view', icon: 'dashboard' },
  {
    labelKey: 'portfolio',
    href: '/portfolio',
    permission: 'portfolio.view',
    icon: 'portfolio',
    children: [
      { labelKey: 'overview', href: '/portfolio' },
      { labelKey: 'positions', href: '/portfolio/positions' },
      { labelKey: 'allocation', href: '/portfolio/allocation' },
    ],
  },
  {
    labelKey: 'transactions',
    href: '/transactions',
    permission: 'transaction.view',
    icon: 'transactions',
    children: [
      { labelKey: 'allTransactions', href: '/transactions' },
      { labelKey: 'buy', href: '/transactions?type=BUY' },
      { labelKey: 'sell', href: '/transactions?type=SELL' },
      { labelKey: 'dividend', href: '/transactions/dividend' },
    ],
  },
  { labelKey: 'strategies', href: '/strategies', permission: 'strategy.view', icon: 'strategies' },
  {
    labelKey: 'market',
    href: '/market/sectors',
    permission: 'stock.view',
    icon: 'market',
    children: [
      { labelKey: 'sectors', href: '/market/sectors' },
      { labelKey: 'marketData', href: '/market/market-data' },
    ],
  },
  { labelKey: 'risk', href: '/risk', permission: 'risk.view', icon: 'risk' },
  { labelKey: 'teams', href: '/teams', permission: 'team.view', icon: 'teams' },
  { labelKey: 'members', href: '/members', permission: 'user.view', icon: 'members' },
  { labelKey: 'approvals', href: '/approvals', permission: 'approval.view', icon: 'approvals' },
  { labelKey: 'reports', href: '/reports', permission: 'report.view', icon: 'reports' },
  { labelKey: 'auditLog', href: '/audit', permission: 'audit.view', icon: 'audit' },
  { labelKey: 'settings', href: '/settings', permission: 'settings.view', icon: 'settings' },
];

const ADMIN_MENU: readonly MenuEntry[] = [
  {
    labelKey: 'organization',
    href: '/admin/organization',
    permission: 'team.view',
    icon: 'teams',
  },
  {
    labelKey: 'manageStrategies',
    href: '/admin/strategies',
    permission: 'strategy.view',
    icon: 'strategies',
  },
  {
    labelKey: 'usersApprovals',
    href: '/admin/users',
    permission: 'user.approve',
    icon: 'userCheck',
  },
  {
    labelKey: 'permissionMatrix',
    href: '/admin/permissions',
    permission: 'permission.view',
    icon: 'permissions',
  },
];

export async function AppShell({ user, children }: { user: AuthUser; children: ReactNode }) {
  // Lựa chọn chủ đề đọc từ cookie, truyền xuống nút để lượt server tô đúng ngay.
  const theme = await getTheme();

  /*
   * Từ điển đọc theo TỪNG REQUEST (cookie), nên phải lấy ở đây chứ không ở module
   * scope — xem chú thích của bảng MENU.
   */
  const { t, locale } = await getDict();
  const nhan = (k: keyof Dict['nav']): string => {
    const v = t.nav[k];
    return typeof v === 'string' ? v : String(v);
  };
  const visible = MENU.filter((item) => user.permissions.has(item.permission));
  const adminVisible = ADMIN_MENU.filter((item) => user.permissions.has(item.permission));

  // Trạng thái nguồn giá hiện lên mọi trang (§10) — người dùng phải biết ngay khi
  // số liệu họ đang xem dựa trên dữ liệu cũ, không phải chỉ khi mở trang Market Data.
  const marketData = user.permissions.has('market_data.view')
    ? await getMarketDataStatus()
    : null;

  /*
   * Số cảnh báo đang mở hiện ngay trên menu.
   *
   * Một Control Center mà cảnh báo chỉ thấy được khi chủ động mở trang Risk thì
   * không phải control center. Con số này phải đi theo người dùng ở mọi trang.
   */
  const openAlerts = user.permissions.has('risk.view') ? await countOpenAlertsBySeverity() : null;
  const alertCount = openAlerts
    ? openAlerts.CRITICAL + openAlerts.HIGH + openAlerts.WARNING + openAlerts.INFO
    : 0;
  const alertUrgent = Boolean(openAlerts && openAlerts.CRITICAL + openAlerts.HIGH > 0);

  /*
   * VIỆC CHỜ DUYỆT CŨNG PHẢI ĐI THEO NGƯỜI DÙNG, cùng lý do với cảnh báo ở trên —
   * và lý do còn mạnh hơn: một cảnh báo là thông tin, còn một việc chờ duyệt là
   * việc đang đợi ĐÚNG NGƯỜI NÀY làm. Trước đây yêu cầu rút vốn nằm im trong
   * `/approvals` và không chỗ nào báo, nên người duyệt chỉ biết nếu tự nhớ mà bấm
   * vào — người gửi thì thấy "chờ duyệt" và tưởng đề xuất đã tới tay ai đó.
   *
   * `countPendingForUser` đã trừ sẵn việc bị chốt bốn mắt chặn, nên con số này là
   * việc họ BẤM ĐƯỢC, không phải việc họ nhìn thấy.
   */
  const pending = await countPendingForUser(user);

  /*
   * MỘT CÂY NAV, HAI CHỖ HIỆN.
   *
   * Sidebar (từ `lg` trở lên) và drawer (dưới `lg`) cùng kết xuất biến này. Chép
   * thành hai khối JSX là dựng sẵn hai bảng menu sẽ lệch nhau — và lệch nguy hiểm
   * nhất ở phần lọc quyền, tức là hiện cho người dùng một mục họ không được vào.
   *
   * Kết xuất ở SERVER rồi truyền vào `MobileNav` như con, nên phần lọc theo
   * `user.permissions` vẫn nằm nguyên ở server.
   */
  const navContent = (
      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        <ul className="space-y-0.5">
          {visible.map((item) => (
            <li key={item.labelKey}>
              {item.href ? (
                <NavItem
                  href={item.href}
                  label={nhan(item.labelKey)}
                  icon={item.icon}
                  badge={
                    item.href === '/risk'
                      ? alertCount
                      : item.href === '/approvals'
                        ? pending.total
                        : undefined
                  }
                  badgeTone={item.href === '/approvals' ? 'alert' : alertUrgent ? 'alert' : 'neutral'}
                  badgeTitle={
                    item.href === '/approvals'
                      ? [
                          pending.trades > 0 ? `${pending.trades} giao dịch` : null,
                          pending.withdrawals > 0 ? `${pending.withdrawals} yêu cầu rút vốn` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'Không có việc nào bạn duyệt được'
                      : openAlerts
                        ? `${openAlerts.CRITICAL} rất nghiêm trọng · ${openAlerts.HIGH} nghiêm trọng · ` +
                          `${openAlerts.WARNING} cảnh báo · ${openAlerts.INFO} thông tin`
                        : undefined
                  }
                />
              ) : (
                <div
                  className="flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-500"
                  title={`Sẽ có ở phase ${item.phase}`}
                >
                  <span>{nhan(item.labelKey)}</span>
                  {item.phase ? <PhaseTag phase={item.phase} /> : null}
                </div>
              )}

              {item.children ? (
                // Thụt vào 7.5 để vạch dọc thẳng hàng với icon của mục cha,
                // không phải với chữ — mắt đọc thành "những mục này nằm dưới
                // biểu tượng kia".
                <ul className="mt-0.5 mb-1.5 ml-[1.875rem] border-l border-ink-800 pl-3">
                  {item.children.map((child) =>
                    child.href ? (
                      <li key={child.labelKey}>
                        <Link
                          href={child.href}
                          className="block py-1 text-xs text-slate-muted transition hover:text-strong"
                        >
                          {nhan(child.labelKey)}
                        </Link>
                      </li>
                    ) : (
                      <li
                        key={child.labelKey}
                        className="cursor-not-allowed py-1 text-xs text-ink-500"
                      >
                        {nhan(child.labelKey)}
                      </li>
                    ),
                  )}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>

        {adminVisible.length > 0 ? (
          <>
            <p className="mt-5 mb-1.5 px-3 text-micro font-semibold tracking-[0.16em] text-slate-muted">
              {t.nav.adminSection}
            </p>
            <ul className="space-y-0.5">
              {adminVisible.map((item) => (
                <li key={item.labelKey}>
                  <NavItem href={item.href!} label={nhan(item.labelKey)} icon={item.icon} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* ---------------------------------------------------------------- */}
      {/* Sidebar                                                          */}
      {/* ---------------------------------------------------------------- */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-900 lg:flex">
        <div className="flex items-center gap-2.5 border-b border-ink-800 px-4 py-4">
          {/*
            Dấu hiệu nhận diện vẽ bằng SVG, không dùng tệp ảnh: nó ăn theo màu nhấn
            nên tự đúng ở cả hai chế độ sáng/tối, và không thêm một request nào.
          */}
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-600/15">
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
              <path
                d="M4 4.5h4.2l3.8 11 3.8-11H20L13.6 21h-3.2L4 4.5Z"
                fill="var(--accent)"
              />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block truncate text-tiny font-semibold tracking-[0.16em] text-accent-400">
              {BRAND_NAME_UPPER}
            </span>
            <span className="block truncate text-tiny text-slate-muted">
              {BRAND_TAGLINE}
            </span>
          </span>
        </div>

        {navContent}

        {/*
          THẺ NGƯỜI DÙNG Ở CHÂN SIDEBAR, không ở thanh trên.
          Danh tính là thứ tra cứu chứ không phải thứ đọc liên tục, nên nó thuộc
          về vùng ổn định nhất của giao diện. Dời xuống đây cũng trả lại toàn bộ
          thanh trên cho thứ THAY ĐỔI theo trang — tiêu đề và bộ lọc.
        */}
        <Link
          href="/profile"
          className="flex items-center gap-2.5 border-t border-ink-800 px-4 py-3 transition hover:bg-ink-800"
        >
          <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-accent-600/20 text-xs font-semibold text-accent-400">
            {initials(user.fullName)}
            {/* Đốm xanh = phiên đang hoạt động, không phải trạng thái tài khoản */}
            <span
              className="absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-ink-900 bg-up-500"
              aria-hidden
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-strong">
              {user.fullName}
            </span>
            <span className="block truncate text-tiny text-slate-muted">
              {user.roleNameVi ?? user.email}
            </span>
          </span>
          <span className="shrink-0 text-ink-500" aria-hidden>
            ›
          </span>
        </Link>
      </aside>

      {/* ---------------------------------------------------------------- */}
      {/* Nội dung                                                         */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          `gap-2` ở khổ hẹp thay vì `gap-4`: sáu phần tử × 16px khoảng cách là 80px
          thuần khoảng trống trên một màn 375px.
        */}
        <header className="flex items-center justify-between gap-2 border-b border-ink-800 bg-ink-900/60 px-3 py-2 backdrop-blur sm:gap-4 sm:px-5 sm:py-3">
          {/*
            Bên trái thanh trên ở khổ hẹp: nút mở menu, rồi mới đến chữ nhận diện.

            Panel nav được kết xuất ở SERVER (biến `navContent`) và truyền vào
            `MobileNav` như con — xem chú thích ở chỗ khai báo biến đó.
          */}
          <div className="flex min-w-0 items-center gap-1.5 lg:hidden">
            <MobileNav>{navContent}</MobileNav>
            {/*
              Chữ nhận diện ẩn dưới 375px. Đo ở khổ 375: cả thanh cần 407px nên nút
              "Đăng xuất" bị cắt mất. Trong sáu thứ đang chen nhau ở đây, chữ nhận
              diện là thứ duy nhất KHÔNG làm được việc gì — bỏ nó trước.
            */}
            <p className="hidden text-tiny font-semibold tracking-[0.16em] text-accent-400 min-[375px]:block">
              {BRAND_NAME_UPPER}
            </p>
          </div>

          {/* Trạng thái Market Data (§10) */}
          <div className="ml-auto flex items-center gap-4">
            {marketData ? (
              <Link
                href="/market/market-data"
                className="hidden items-center gap-2 text-xs transition hover:opacity-80 sm:flex"
                title={
                  marketData.lastSuccessAt
                    ? `Cập nhật lúc ${marketData.lastSuccessAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} · nguồn ${marketData.source}` +
                      (marketData.duringSession
                        ? ` · đang trong phiên, ngưỡng ${marketData.staleAfterMinutes} phút`
                        : ` · ngoài phiên, so theo phiên giao dịch gần nhất`)
                    : 'Chưa có lần đồng bộ thành công nào'
                }
              >
                <span
                  className={`size-1.5 rounded-full ${
                    marketData.lastSuccessAt
                      ? marketData.connected
                        ? 'bg-up-500'
                        : 'bg-warn-500'
                      : 'bg-ink-500'
                  }`}
                />
                <span
                  className={
                    marketData.lastSuccessAt
                      ? marketData.connected
                        ? 'text-up-500'
                        : 'text-warn-500'
                      : 'text-slate-muted'
                  }
                >
                  {/*
                    NGOÀI PHIÊN THÌ ĐỌC THEO PHIÊN, KHÔNG ĐỌC THEO PHÚT.

                    "Trễ 1338 phút" vào chiều thứ Bảy là câu vô nghĩa: giá đóng cửa
                    thứ Sáu đúng là giá mới nhất tồn tại. Ngoài phiên, câu đúng là
                    "giá phiên 28/08".
                  */}
                  {!marketData.lastSuccessAt
                    ? 'Market Data · chưa kết nối'
                    : marketData.duringSession
                      ? marketData.connected
                        ? `Market Data · ${marketData.lastSuccessAt.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
                        : `Market Data trễ ${marketData.ageMinutes} phút`
                      : marketData.connected
                        ? t.nav.priceSession(phienNgan(marketData.quoteTradingDate))
                        : `Chậm ${marketData.sessionsBehind} phiên`}
                </span>
              </Link>
            ) : null}

            {/*
              Trên màn hình hẹp sidebar bị ẩn, nên thẻ người dùng ở chân sidebar
              cũng mất theo — lúc đó thanh trên phải gánh lại danh tính.
            */}
            <Link
              href="/profile"
              className="flex items-center gap-2 rounded-lg px-2 py-1 transition hover:bg-ink-800 lg:hidden"
            >
              <span className="grid size-8 place-items-center rounded-full bg-accent-600/20 text-xs font-semibold text-accent-400">
                {initials(user.fullName)}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block text-xs font-medium text-strong">{user.fullName}</span>
                <span className="block text-tiny text-slate-muted">
                  {user.roleNameVi ?? user.email}
                </span>
              </span>
            </Link>

            <LangToggle current={locale} />
            <ThemeToggle initial={theme} />

            {/*
              Vai trò đã hiện ở thẻ người dùng ngay bên cạnh (dòng thứ hai), nên ở
              khổ hẹp cái nhãn này chỉ là bản sao chiếm chỗ.
            */}
            <span className="hidden sm:block">
              <RoleBadge roleCode={user.roleCode} />
            </span>

            <form action={logoutAction}>
              {/*
                Ở khổ hẹp chỉ còn biểu tượng — nhưng vẫn là nút 44×44 và vẫn có
                `aria-label`, nên người dùng bàn phím và trình đọc màn hình không mất
                gì. Giữ nguyên chữ từ `sm` trở lên vì ở đó có chỗ.
              */}
              <button
                type="submit"
                aria-label={t.nav.logout}
                title={t.nav.logout}
                className="grid size-11 place-items-center rounded-lg border border-ink-700 text-slate-muted transition hover:border-down-500/50 hover:text-down-500 sm:h-auto sm:w-auto sm:px-3 sm:py-1.5"
              >
                <svg viewBox="0 0 24 24" className="size-5 sm:hidden" aria-hidden>
                  <path
                    d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 8l-4 4 4 4M6 12h9"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
                <span className="hidden text-xs sm:block">{t.nav.logout}</span>
              </button>
            </form>
          </div>
        </header>

        {/*
          Lề 20px hai bên trên màn 375px là 40px, hơn 10% chiều rộng. Xuống 12px ở
          khổ hẹp trả lại chỗ đó cho số liệu.
        */}
        <main className="min-w-0 flex-1 overflow-x-hidden px-3 py-4 sm:px-5 sm:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * Ngày phiên dạng ngắn `dd/MM`.
 *
 * KHÔNG dùng `toLocaleDateString('vi-VN', { day, month })`: nó trả về `28-08` với dấu
 * gạch, lệch với mọi chỗ khác trong app vốn dùng dấu gạch chéo.
 */
function phienNgan(d: Date | null): string {
  if (!d) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`;
}
function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
