'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/icons';

/**
 * Mục menu có đánh dấu trạng thái đang xem.
 *
 * Biểu tượng nhận theo TÊN, không nhận phần tử JSX: bảng menu nằm ở Server
 * Component còn file này là Client Component, và một chuỗi thì luôn đi qua ranh
 * giới đó an toàn.
 */
export function NavItem({
  href,
  label,
  icon,
  badge,
  badgeTone = 'neutral',
  badgeTitle,
}: {
  href: string;
  label: string;
  icon?: IconName;
  /** Con số hiện bên phải nhãn; bỏ qua khi 0 hoặc undefined. */
  badge?: number;
  badgeTone?: 'neutral' | 'alert';
  badgeTitle?: string;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
        active
          ? 'bg-accent-600/15 font-medium text-accent-400'
          : 'text-slate-soft hover:bg-ink-800 hover:text-strong'
      }`}
    >
      {/*
        Vạch chỉ trạng thái đang xem. Giữ nguyên chiều rộng cả khi không hoạt động
        để nhãn của mọi mục thẳng hàng — nếu chỉ hiện khi active thì cả menu sẽ
        nhích sang phải mỗi lần đổi trang.
      */}
      <span
        className={`h-4 w-0.5 shrink-0 rounded-full ${active ? 'bg-accent-400' : 'bg-transparent'}`}
        aria-hidden
      />

      {icon ? (
        <Icon
          name={icon}
          /*
           * Icon nhạt hơn chữ một bậc khi không hoạt động, rồi sáng lên theo chữ
           * khi hover hoặc đang xem. Để icon cùng độ đậm với nhãn sẽ làm hàng menu
           * nặng gấp đôi và mắt không biết đọc cái nào trước — chữ mới là thứ cần
           * đọc, icon chỉ để nhận ra nhanh.
           */
          className={active ? '' : 'text-ink-500 transition group-hover:text-slate-soft'}
        />
      ) : null}

      <span className="min-w-0 truncate">{label}</span>

      {badge && badge > 0 ? (
        <span
          title={badgeTitle}
          className={`tabular ml-auto rounded px-1.5 py-px text-micro font-medium ${
            badgeTone === 'alert'
              ? 'bg-down-500/15 text-down-500'
              : 'bg-ink-800 text-slate-muted'
          }`}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
