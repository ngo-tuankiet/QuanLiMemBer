'use client';

/**
 * ĐỔI NGÔN NGỮ.
 *
 * Ghi COOKIE rồi `router.refresh()`, không giữ ngôn ngữ trong state React. Lý do giống
 * hệt nút đổi chủ đề: chuỗi hiển thị được dựng ở SERVER (từ điển nằm trong Server
 * Component), nên đổi ngôn ngữ nghĩa là phải lấy lại HTML — không phải vẽ lại phía
 * client. Giữ một bản sao ngôn ngữ trong state chỉ tạo ra chỗ thứ hai có thể lệch.
 *
 * `router.refresh()` giữ nguyên vị trí cuộn và state của các form đang mở, khác hẳn
 * `location.reload()`.
 */

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { LANG_COOKIE, LOCALES, LOCALE_LABEL, LOCALE_SHORT, type Locale } from '@/i18n/shared';

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Ghi cookie ngôn ngữ. Đặt Ở NGOÀI component là cố ý.
 *
 * Quy tắc `react-hooks/immutability` chặn việc sửa một biến ngoài component ngay
 * trong thân component — `document.cookie` là đúng loại đó. Tách ra hàm riêng vừa
 * hết cảnh báo vừa đúng bản chất: đây là tác động ra bên ngoài, không phải state.
 * Cùng cách làm với `apply()` trong ThemeToggle.
 */
function ghiCookie(next: Locale): void {
  document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

export function LangToggle({ current }: { current: Locale }) {
  const router = useRouter();
  const [dangDoi, batDau] = useTransition();

  function chon(next: Locale): void {
    if (next === current) return;
    ghiCookie(next);
    batDau(() => router.refresh());
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-ink-700 bg-ink-850 p-0.5"
      role="group"
      aria-label="Ngôn ngữ / Language"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => chon(l)}
          disabled={dangDoi}
          title={LOCALE_LABEL[l]}
          aria-pressed={l === current}
          className={`rounded-md px-2 py-1 text-tiny font-medium transition disabled:opacity-60 ${
            l === current
              ? 'bg-accent-600/20 text-accent-400'
              : 'text-slate-muted hover:bg-ink-800 hover:text-strong'
          }`}
        >
          {LOCALE_SHORT[l]}
        </button>
      ))}
    </div>
  );
}
