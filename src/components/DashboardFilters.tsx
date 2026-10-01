'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * BỘ LỌC TOÀN CỤC CỦA DASHBOARD (§11).
 *
 * Năm chiều: Danh mục · Nhóm · Chiến lược · Ngành · Thời gian. Chọn xong là trang
 * tự nạp lại — mọi khối trên Dashboard đều đọc cùng bộ lọc này, nên không có
 * chuyện KPI thuộc một phạm vi mà biểu đồ thuộc phạm vi khác.
 *
 * VÌ SAO ĐÂY LÀ CLIENT COMPONENT — cả trang còn lại là server. Lý do duy nhất:
 * người dùng chọn xong phải thấy kết quả ngay, không phải bấm thêm nút "Áp dụng".
 * Làm bằng `<form method="get">` thuần thì không cần JavaScript nhưng lại cần một
 * nút bấm thứ hai cho mỗi lần đổi ý, và với năm ô lọc thì đó là năm cú bấm dư.
 *
 * Trạng thái lọc nằm trong QUERY STRING, không trong state của React. Nhờ vậy một
 * góc nhìn cụ thể — "Đá Bóng, chiến lược Tích sản, 3 tháng" — copy được thành
 * đường dẫn gửi cho người khác, và nút Back của trình duyệt hoạt động đúng.
 */

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  /** Tên tham số trong query string. */
  name: string;
  label: string;
  /** Nhãn cho lựa chọn "không lọc". */
  allLabel: string;
  options: readonly FilterOption[];
  /**
   * Khoá cứng ô này, kèm lý do hiện khi trỏ vào.
   *
   * Dùng khi phạm vi dữ liệu của người xem đã cố định — ví dụ người chỉ có
   * `position.view` thì bị ép về nhóm của họ và không được chọn nhóm khác. Khoá ở
   * đây chỉ là để giao diện khỏi mời gọi; chốt thật nằm ở `applyScope()` phía server.
   */
  lockedReason?: string;
}

export function DashboardFilters({ groups }: { groups: readonly FilterGroup[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function change(name: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);

    startTransition(() => {
      // `scroll: false` để người đang xem khối giữa trang không bị nhảy lên đầu
      // mỗi lần đổi một ô lọc.
      router.push(next.toString() ? `?${next.toString()}` : '?', { scroll: false });
    });
  }

  return (
    <div
      className={`flex flex-wrap items-end gap-2 transition-opacity ${
        pending ? 'opacity-60' : ''
      }`}
      // Báo cho trình đọc màn hình biết vùng này đang nạp lại, thay vì để nội
      // dung đổi âm thầm.
      aria-busy={pending}
    >
      {groups.map((group) => {
        const current = params.get(group.name) ?? '';
        const locked = Boolean(group.lockedReason);

        return (
          <label key={group.name} className="min-w-0">
            <span className="mb-1 block text-tiny text-slate-muted">{group.label}</span>
            <select
              value={current}
              disabled={locked}
              title={group.lockedReason}
              onChange={(e) => change(group.name, e.target.value)}
              /*
                `sm:!text-xs`, KHÔNG phải `!text-xs`.
                `!important` đè cả quy tắc @media nâng cỡ chữ ô nhập lên 16px ở màn
                hẹp — mà dưới 16px thì Safari iOS phóng cả trang khi bấm vào ô, kể cả
                `<select>`, và không tự thu lại. Đo được: 5 ô lọc này cao đúng 44px
                nhưng cỡ chữ vẫn 12px. Giới hạn từ `sm` trở lên để desktop giữ thanh
                lọc gọn như cũ.

                `!w-auto` cũng chỉ từ `sm`: trên điện thoại năm ô lọc nên chiếm hết
                chiều ngang thành năm dòng, thay vì co lại theo nội dung rồi xếp so
                le nhau.
              */
              className={`field !py-1.5 sm:!w-auto sm:!min-w-32 sm:!text-xs ${
                locked ? 'cursor-not-allowed opacity-60' : ''
              } ${current ? '!border-accent-500/50 !text-accent-400' : ''}`}
            >
              <option value="">{group.allLabel}</option>
              {group.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}
