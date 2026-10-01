import type React from 'react';
import { Card } from '@/components/ui';

/**
 * MỘT Ô SỐ LIỆU — nhãn, con số, một dòng phụ.
 *
 * VÌ SAO TÁCH RA. Trước đây mỗi trang tự dựng ô này: `/portfolio` viết thẳng bốn thẻ
 * `Card` giống nhau, `/members/[id]` có hàm `Kpi` riêng, `/teams` có một hàm `Kpi` khác
 * nữa. Cùng một ô, ba bản cài đặt, và chúng đã lệch nhau đúng như dự đoán:
 *
 *     /portfolio        text-2xl  ·  dòng % dùng text-xs
 *     /members/[id]     text-xl   ·  dòng % dùng text-tiny
 *
 * Lệch cỡ chữ nghe như chuyện nhỏ, nhưng hai hàng ô ấy nằm cạnh nhau trong cùng một
 * luồng đọc — người dùng nhìn ra ngay là hai hàng "không giống nhau" mà không chỉ được
 * ra chỗ khác. Một component thì không thể lệch.
 *
 * `/teams` và `/dashboard` KHÔNG dùng component này, có lý do:
 *
 *   `/teams`      các ô nằm trong MỘT thẻ chung, chia bằng đường kẻ dọc chứ không phải
 *                 bốn thẻ rời — bố cục khác, không phải cùng một thứ nhỏ hơn.
 *   `/dashboard`  ô có icon, sắc thái tăng/giảm, và biểu đồ nhỏ bên trong. Ép chung một
 *                 component sẽ biến nó thành một hàm mười tham số phục vụ hai hình dạng.
 */
export function StatCard({
  label,
  value,
  hint,
  className = '',
}: {
  label: string;
  value: React.ReactNode;
  /** Dòng phụ: chú thích, tỷ trọng, hoặc phần trăm thay đổi. */
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={`p-4 ${className}`}>
      <p className="text-xs text-slate-muted">{label}</p>
      <p className="tabular mt-1.5 text-2xl font-semibold">{value}</p>
      {hint !== undefined && hint !== null ? (
        <p className="mt-1 text-xs text-slate-muted">{hint}</p>
      ) : null}
    </Card>
  );
}
