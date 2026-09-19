'use client';

/**
 * Vỏ bọc cho Server Action: nối `useActionState` + `useFormStatus` để mọi form
 * trong app có cùng cách hiển thị lỗi và cùng trạng thái "đang xử lý".
 *
 * Vì sao cần: form gửi tới server action là chỗ dễ bấm hai lần nhất. Với hệ thống
 * quản lý vốn thì bấm hai lần có nghĩa là ghi trùng dữ liệu, nên nút bấm phải bị
 * vô hiệu trong lúc chờ.
 */

import { useActionState, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export interface ActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Nút gửi form, kèm bước xác nhận TRONG TRANG cho hành động khó hoàn tác.
 *
 * VÌ SAO KHÔNG DÙNG `window.confirm`. Bản đầu gọi `window.confirm()` và huỷ gửi khi
 * người dùng bấm Cancel. Nó hỏng theo kiểu không ai đoán ra: Chrome có ô "Prevent this
 * page from creating additional dialogs", và một khi ô đó được tick — thường là vô ý,
 * sau vài lần đóng hộp thoại — thì `confirm()` TRẢ VỀ `false` NGAY LẬP TỨC MÀ KHÔNG HIỆN
 * GÌ. Handler gọi `preventDefault()`, form không gửi, và người dùng thấy nút bấm chết:
 * không hộp thoại, không thông báo, không chuyện gì xảy ra.
 *
 * Đã xảy ra thật, và nó làm chết CẢ CHÍN chỗ dùng chung nút này — gồm duyệt và huỷ lệnh
 * giao dịch. Một cơ chế xác nhận mà trình duyệt tắt được không phải cơ chế xác nhận.
 *
 * Bước xác nhận nay nằm trong trang: bấm lần đầu đổi nút thành câu hỏi kèm hai lựa chọn.
 * Không phụ thuộc hộp thoại, thấy được câu hỏi, và chạy như nhau trên máy tính lẫn điện
 * thoại — nơi hộp thoại chặn luồng còn dễ bị chặn hơn.
 */
export function SubmitButton({
  children,
  variant = 'primary',
  className = '',
  confirm,
}: {
  children: ReactNode;
  variant?: 'primary' | 'danger' | 'ghost' | 'subtle';
  className?: string;
  /** Câu hỏi xác nhận hiện ngay trong trang trước khi gửi. */
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  const [dangHoi, setDangHoi] = useState(false);

  const variants: Record<string, string> = {
    primary: 'bg-accent-600 text-white hover:bg-accent-500 disabled:bg-accent-600/40',
    danger: 'bg-down-500/90 text-white hover:bg-down-500 disabled:bg-down-500/30',
    ghost: 'border border-ink-600 text-slate-soft hover:border-ink-500 hover:text-strong',
    subtle: 'bg-ink-800 text-slate-soft hover:bg-ink-700 hover:text-strong',
  };

  const nutCls = (v: string) =>
    `inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${variants[v]} ${className}`;

  /*
   * BƯỚC HỎI. Nút đầu là `type="button"` nên nó KHÔNG gửi form — chỉ đổi trạng thái.
   * Nút "Xác nhận" mới là `type="submit"`. Đặt sai kiểu ở đây thì hành động khó hoàn tác
   * sẽ chạy ngay từ cú bấm đầu, đúng thứ bước xác nhận sinh ra để ngăn.
   */
  if (confirm && !dangHoi && !pending) {
    return (
      <button type="button" onClick={() => setDangHoi(true)} className={nutCls(variant)}>
        {children}
      </button>
    );
  }

  if (confirm && dangHoi && !pending) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-xs leading-relaxed text-warn-500">{confirm}</span>
        <button type="submit" className={nutCls(variant)}>
          Xác nhận
        </button>
        <button
          type="button"
          onClick={() => setDangHoi(false)}
          className="rounded-lg px-2 py-2 text-sm text-slate-muted transition hover:text-strong"
        >
          Huỷ
        </button>
      </span>
    );
  }

  return (
    <button
      type="submit"
      disabled={pending}
      className={nutCls(variant)}
    >
      {pending ? (
        <>
          <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Đang xử lý…
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState | null }) {
  if (!state?.message) return null;

  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      className={`rounded-lg border px-3 py-2 text-sm ${
        state.ok
          ? 'border-up-500/30 bg-up-500/10 text-up-500'
          : 'border-down-500/30 bg-down-500/10 text-down-500'
      }`}
    >
      {state.message}
    </p>
  );
}

export function ActionForm({
  action,
  children,
  className = '',
  hidden,
}: {
  action: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
  /** Nhận state để render lỗi theo từng field. */
  children: (state: ActionState | null) => ReactNode;
  className?: string;
  /** Các giá trị ẩn kèm theo, ví dụ userId. */
  hidden?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className={className}>
      {hidden
        ? Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}
      {children(state)}
    </form>
  );
}
