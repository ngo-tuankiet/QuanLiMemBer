'use client';

import { useSyncExternalStore } from 'react';
import { THEME_COOKIE, type Theme } from '@/components/theme.shared';

/**
 * Chuyển chế độ sáng / tối / theo hệ thống.
 *
 * BA TRẠNG THÁI, KHÔNG PHẢI HAI. "Theo hệ thống" là mặc định và là một lựa chọn
 * thật: người dùng đặt máy tự đổi màu theo giờ thì app phải đi theo. Nút hai
 * trạng thái buộc họ chọn cứng một bên và mất hành vi đó.
 *
 * Lựa chọn lưu vào COOKIE, không phải localStorage — để server đọc được và đặt
 * `data-theme` ngay trong HTML đầu tiên. Nhờ vậy không cần script chặn và không
 * bao giờ nháy sai màu. Xem src/components/theme.ts để biết chi tiết.
 *
 * Component vẫn tự gắn `data-theme` ngay khi bấm để phản hồi tức thì, không chờ
 * một vòng round-trip nào.
 *
 * KHÔNG GIỮ BẢN SAO CỦA LỰA CHỌN TRONG STATE. `data-theme` trên `<html>` đã là
 * nguồn sự thật; giữ thêm một `useState` là có hai nơi cùng nói về một việc, và
 * hai nơi thì sẽ có lúc lệch — chẳng hạn app có hai nút này (thanh trên và menu
 * điện thoại), bấm cái này thì cái kia không biết. `useSyncExternalStore` đọc
 * thẳng từ DOM và theo dõi mọi thay đổi, nên mọi nút luôn cùng một câu trả lời.
 */

const ONE_YEAR = 60 * 60 * 24 * 365;

function apply(theme: Theme): void {
  const root = document.documentElement;

  if (theme === 'system') {
    root.removeAttribute('data-theme');
    // max-age=0 để xoá cookie; lần tải sau server lại trả về 'system'.
    document.cookie = `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } else {
    root.setAttribute('data-theme', theme);
    document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  }
}

/** Đọc lựa chọn hiện tại từ chính `<html>` — nguồn duy nhất, do server đặt. */
function readCurrent(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' || attr === 'dark' ? attr : 'system';
}

/** Báo lại mỗi khi `data-theme` đổi — kể cả do một nút khác trên trang đổi. */
function subscribe(doiY: () => void): () => void {
  const theoDoi = new MutationObserver(doiY);
  theoDoi.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => theoDoi.disconnect();
}

const OPTIONS: { value: Theme; label: string; icon: string; title: string }[] = [
  { value: 'light', label: 'Sáng', icon: '☀', title: 'Chế độ sáng' },
  { value: 'dark', label: 'Tối', icon: '☾', title: 'Chế độ tối' },
  { value: 'system', label: 'Hệ thống', icon: '◐', title: 'Theo cài đặt hệ thống' },
];

/**
 * `initial` là lựa chọn server đọc được từ cookie — chính giá trị nó vừa gắn vào
 * `<html>`. Truyền xuống để lượt kết xuất ở server tô đúng nút ngay từ đầu: không
 * còn khoảnh khắc "chưa biết" nên bỏ luôn được cờ `mounted`.
 */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const theme = useSyncExternalStore(subscribe, readCurrent, () => initial);

  /*
   * Chỉ gắn thuộc tính. `MutationObserver` thấy thay đổi rồi báo ngược lại, nên
   * không có bước "cập nhật state" nào ở đây.
   */
  function choose(next: Theme): void {
    apply(next);
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-850 p-0.5"
      role="group"
      aria-label="Chế độ hiển thị"
    >
      {OPTIONS.map((option) => {
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            title={option.title}
            aria-pressed={active}
            className={`rounded-md px-2 py-1 text-xs transition ${
              active
                ? 'bg-accent-600/20 text-accent-400'
                : 'text-slate-muted hover:bg-ink-800 hover:text-strong'
            }`}
          >
            <span aria-hidden>{option.icon}</span>
            <span className="sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
