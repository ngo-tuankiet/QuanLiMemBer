'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { BRAND_NAME_UPPER } from '@/lib/brand';

/**
 * MENU ĐIỀU HƯỚNG CHO MÀN HÌNH HẸP.
 *
 * VÌ SAO CẦN. Sidebar là `hidden lg:flex`, nên dưới 1024px nó biến mất — và không có
 * gì thay thế. Đo trên thiết bị ảo 375px: 23 mục menu vẫn được gửi xuống điện thoại
 * rồi bị `display:none`, thanh trên còn đúng MỘT link điều hướng (thẻ avatar). Nghĩa
 * là mở app trên điện thoại rồi thì không có đường nào sang Portfolio, Transactions,
 * Market Data… trừ khi tình cờ có link trong nội dung trang.
 *
 * NHẬN NAV QUA `children`, KHÔNG TỰ DỰNG LẠI MENU.
 *
 * Bảng `MENU` nằm ở `AppShell` (Server Component) và được lọc theo quyền thật của
 * người dùng. Nếu component này tự dựng menu riêng thì sẽ có HAI bảng menu, và hai
 * bảng chắc chắn sẽ lệch nhau — tệ nhất là lệch phần lọc quyền, tức là hiện cho
 * người dùng một mục họ không có quyền vào. Ở đây nav đã kết xuất sẵn ở server được
 * truyền vào như con, nên chỉ có một nguồn sự thật.
 *
 * ĐÓNG KHI ĐỔI TRANG. Next điều hướng ở phía client nên panel không tự mất: bấm một
 * mục xong trang đã đổi mà panel vẫn che.
 *
 * Cách làm: state KHÔNG phải cờ mở/đóng mà là ĐƯỜNG DẪN LÚC MỞ. "Đang mở" là một
 * giá trị suy ra — `moTai === pathname`. Đổi trang thì `pathname` khác đi và panel
 * tự đóng, không cần hiệu ứng nào theo dõi. Một cờ boolean cộng `useEffect` cũng ra
 * kết quả ấy nhưng phải kết xuất thừa một lượt với panel còn mở, và React 19 đã
 * cảnh báo đúng chỗ đó (`react-hooks/set-state-in-effect`).
 *
 * PANEL ĐI QUA PORTAL RA `document.body`, KHÔNG nằm tại chỗ.
 *
 * Nút mở nằm trong `<header>` mà header có `backdrop-blur`. `backdrop-filter` tạo ra
 * một CONTAINING BLOCK mới, nên `position: fixed` bên trong nó neo vào HEADER chứ
 * không neo vào viewport — panel co lại đúng bằng chiều cao thanh trên (~48px) và
 * toàn bộ 22 mục menu bị nén về chiều cao 0.
 *
 * Đây là kiểu lỗi đọc code không thấy: `fixed inset-0` trông hoàn toàn đúng, và nó
 * đúng ở mọi chỗ khác. Chỉ đo mới ra — `clientHeight` của vùng nav bằng 0 trong khi
 * `scrollHeight` là 806.
 *
 * Portal đưa panel ra ngoài mọi containing block, nên `fixed` lại đúng nghĩa. Cách
 * khác là bỏ `backdrop-blur` khỏi header, nhưng đó là đổi thiết kế để chữa một lỗi
 * kỹ thuật — sai chỗ.
 */
export function MobileNav({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  /*
   * Đường dẫn tại thời điểm mở panel; `null` là đang đóng. Xem chú thích ở đầu file.
   */
  const [moTai, setMoTai] = useState<string | null>(null);
  const mo = moTai === pathname;

  /*
   * Không cần cờ "đã mount" để bảo vệ portal: nhánh này chỉ chạy khi `mo` bật, mà
   * `mo` chỉ bật do người dùng bấm — tức là luôn ở client, `document` chắc chắn có.
   */

  useEffect(() => {
    if (!mo) return;

    /*
     * KHOÁ CUỘN CỦA TRANG khi panel mở. Không khoá thì ngón tay kéo trong panel sẽ
     * cuộn luôn trang phía dưới, và lúc đóng lại người dùng ở một vị trí khác chỗ
     * họ đang đọc.
     */
    const cu = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoTai(null);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = cu;
      window.removeEventListener('keydown', onKey);
    };
  }, [mo]);

  return (
    <>
      {/*
        Nút mở: 44×44 để đạt ngưỡng vùng bấm tối thiểu. Ẩn từ `lg` trở lên vì ở đó
        sidebar đã hiện.
      */}
      <button
        type="button"
        onClick={() => setMoTai(pathname)}
        aria-label="Mở menu điều hướng"
        aria-expanded={mo}
        className="grid size-11 shrink-0 place-items-center rounded-lg text-slate-soft transition hover:bg-ink-800 hover:text-strong lg:hidden"
      >
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
          <path
            d="M4 7h16M4 12h16M4 17h16"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>

      {mo
        ? createPortal(
            <div className="fixed inset-0 z-50 flex lg:hidden">
          {/* Nền mờ: bấm ra ngoài là đóng — thao tác ai cũng thử trước tiên. */}
          <button
            type="button"
            aria-label="Đóng menu"
            onClick={() => setMoTai(null)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/*
            Panel rộng 17rem, KHÔNG full-screen: chừa lại một dải nền mờ bên phải để
            người dùng thấy ngay là mình đang ở một lớp phủ tạm và bấm ra ngoài được.
            Full-screen trông như đã điều hướng sang một trang khác.
          */}
          <div className="relative flex w-[17rem] max-w-[85vw] flex-col border-r border-ink-800 bg-ink-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
              <span className="text-tiny font-semibold tracking-[0.16em] text-accent-400">
                {BRAND_NAME_UPPER}
              </span>
              <button
                type="button"
                onClick={() => setMoTai(null)}
                aria-label="Đóng menu"
                className="grid size-11 shrink-0 place-items-center rounded-lg text-slate-muted transition hover:bg-ink-800 hover:text-strong"
              >
                <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
              </button>
            </div>

            {/*
              CUỘN DỌC LÀ BẮT BUỘC: 23 mục cộng mục con không vừa chiều cao một điện
              thoại. `min-h-0` để ô flex này co được — thiếu nó thì `overflow-y-auto`
              vô hiệu và mấy mục cuối không tới được, đúng cái bẫy đang có ở lưới
              trên Dashboard.
            */}
            {/*
              `nav-touch` nới mọi mục menu bên trong lên 44px — chỉ ở drawer.

              Không sửa `NavItem`: sidebar desktop dùng chung component đó, và ở đó
              36px là đúng — menu 23 mục ở mật độ chuột thì gọn hơn, còn nới lên 44px
              sẽ đẩy mấy mục cuối xuống dưới màn hình.
            */}
            <div className="nav-touch min-h-0 flex-1 overflow-y-auto">{children}</div>
          </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
