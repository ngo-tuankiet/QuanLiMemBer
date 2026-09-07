'use client';

import { useEffect, useRef, type InputHTMLAttributes } from 'react';

/**
 * Ô NHẬP SỐ LỚN — hiện dấu chấm ngăn nghìn, gửi lên server số thuần.
 *
 * `200000000` gõ vào thì hiện `200.000.000`. Không có dấu ngăn, một dãy chín chữ số là
 * thứ không ai đọc được: người nhập phải đếm bằng mắt để biết mình vừa gõ hai trăm
 * triệu hay hai tỷ.
 *
 * HAI Ô, MỘT TRƯỜNG. Ô nhìn thấy KHÔNG có `name` nên nó không được gửi đi; một ô ẩn
 * mang `name` thật và giá trị số thuần. Bắt buộc phải làm vậy:
 *
 *   - `vndAmount` trong validation chỉ nhận `^\d+$` — gửi "200.000.000" là lỗi;
 *   - và tệ hơn, khối lượng dùng `z.coerce.number()`, nên "10.000" sẽ được đọc thành
 *     **10** chứ không phải mười nghìn. Một dấu chấm lọt xuống server làm khối lượng
 *     sai một nghìn lần mà không có lỗi nào được ném ra.
 *
 * CON TRỎ. Định dạng lại làm độ dài chuỗi thay đổi, nên nếu không xử lý thì con trỏ
 * nhảy về cuối mỗi lần thêm một dấu chấm — sửa số ở giữa thành ra không làm được. Cách
 * xử lý: đếm số CHỮ SỐ nằm trước con trỏ, rồi sau khi định dạng lại đặt con trỏ sau
 * đúng số chữ số đó.
 *
 * Component có điều khiển (`value` + `onChange` trả về số thuần) chứ không tự giữ state:
 * nơi gọi thường cần chính con số đó để tính tổng ngay trên form.
 */
export function MoneyInput({
  name,
  value,
  onChange,
  className = '',
  ...rest
}: {
  /** Tên trường gửi lên server. Đặt trên ô ẩn, không đặt trên ô nhìn thấy. */
  name: string;
  /** Số thuần, chỉ chữ số. Chuỗi rỗng = chưa nhập. */
  value: string;
  onChange: (raw: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'name' | 'value' | 'onChange' | 'type'>) {
  const ref = useRef<HTMLInputElement>(null);
  /** Vị trí con trỏ cần đặt lại sau khi React vẽ xong giá trị mới. */
  const caretDigits = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    const soChuSo = caretDigits.current;
    if (!el || soChuSo === null) return;
    caretDigits.current = null;

    // Đi từ đầu chuỗi đã định dạng, đếm tới đúng `soChuSo` chữ số.
    const hienThi = el.value;
    let dem = 0;
    let viTri = hienThi.length;
    for (let i = 0; i < hienThi.length; i += 1) {
      if (dem === soChuSo) {
        viTri = i;
        break;
      }
      if (/\d/.test(hienThi[i]!)) dem += 1;
    }
    if (dem === soChuSo && viTri === hienThi.length) viTri = hienThi.length;
    el.setSelectionRange(viTri, viTri);
  }, [value]);

  return (
    <>
      <input
        {...rest}
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={nhomNghin(value)}
        onChange={(e) => {
          const goVao = e.target.value;
          const caret = e.target.selectionStart ?? goVao.length;
          // Đếm chữ số trước con trỏ TRÊN CHUỖI VỪA GÕ, trước khi định dạng lại.
          caretDigits.current = (goVao.slice(0, caret).match(/\d/g) ?? []).length;
          onChange(goVao.replace(/\D/g, ''));
        }}
        className={className}
      />
      <input type="hidden" name={name} value={value} />
    </>
  );
}

/**
 * `200000000` → `200.000.000`.
 *
 * Dấu chấm theo quy ước Việt Nam. Không dùng `toLocaleString` vì nó cần một `number`,
 * và số tiền ở đây có thể vượt `Number.MAX_SAFE_INTEGER` — chuỗi thì không bao giờ.
 */
export function nhomNghin(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits === '') return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
