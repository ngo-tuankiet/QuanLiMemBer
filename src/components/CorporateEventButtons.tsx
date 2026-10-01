'use client';

/**
 * Ba nút tương tác của khối "Cổ tức đang chờ ghi nhận": Bỏ qua, Hoàn tác, Quét lại.
 *
 * Tách khỏi khối danh sách để phần danh sách vẫn là Server Component — nó đọc
 * database, còn ba nút này chỉ cần gửi form.
 */

import { useActionState, useState } from 'react';
import {
  dismissCorporateEventAction,
  undoDismissCorporateEventAction,
  type ActionResult,
} from '@/dividends/actions';
import { scanCorporateEventsAction } from '@/market/actions';

const EMPTY: ActionResult = { ok: false };

const nutPhu =
  'rounded-md border border-ink-600 px-2 py-1 text-tiny text-slate-soft transition ' +
  'hover:border-ink-500 hover:text-strong disabled:opacity-50';

/**
 * BỎ QUA — bấm lần đầu mở ô lý do ngay tại chỗ, không dùng hộp thoại.
 *
 * Lý do BẮT BUỘC (server kiểm lại). Với quyền mua, gợi ý sẵn hai lý do thường gặp để
 * người dùng không phải nghĩ cách viết; vẫn sửa được.
 */
export function BoQuaForm({
  eventId,
  accountId,
  goiY = [],
}: {
  eventId: string;
  accountId: string;
  goiY?: string[];
}) {
  const [state, action, pending] = useActionState(dismissCorporateEventAction, EMPTY);
  const [mo, setMo] = useState(false);
  const [lyDo, setLyDo] = useState('');

  if (state.ok) {
    return <span className="text-tiny text-up-500">{state.message}</span>;
  }

  if (!mo) {
    return (
      <button type="button" onClick={() => setMo(true)} className={nutPhu}>
        Bỏ qua
      </button>
    );
  }

  return (
    <form action={action} className="flex w-full min-w-[14rem] flex-col gap-1.5">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="accountId" value={accountId} />
      <input
        name="reason"
        value={lyDo}
        onChange={(e) => setLyDo(e.target.value)}
        placeholder="Lý do bỏ qua (bắt buộc)"
        autoFocus
        className="w-full rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-tiny text-strong placeholder:text-ink-500 focus:border-accent-500 focus:outline-none"
      />
      {goiY.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {goiY.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setLyDo(g)}
              className="rounded border border-ink-700 px-1.5 py-px text-micro text-slate-muted hover:text-strong"
            >
              {g}
            </button>
          ))}
        </span>
      ) : null}
      {state.fieldErrors?.reason || state.message ? (
        <span className="text-tiny text-down-500">
          {state.fieldErrors?.reason?.join(' ') ?? state.message}
        </span>
      ) : null}
      <span className="flex gap-1.5">
        <button type="submit" disabled={pending || lyDo.trim().length < 3} className={nutPhu}>
          {pending ? 'Đang lưu…' : 'Xác nhận bỏ qua'}
        </button>
        <button type="button" onClick={() => setMo(false)} className="px-1.5 text-tiny text-slate-muted hover:text-strong">
          Huỷ
        </button>
      </span>
    </form>
  );
}

export function HoanTacForm({ resolutionId }: { resolutionId: string }) {
  const [state, action, pending] = useActionState(undoDismissCorporateEventAction, EMPTY);
  if (state.ok) return <span className="text-tiny text-up-500">{state.message}</span>;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="resolutionId" value={resolutionId} />
      <button type="submit" disabled={pending} className={nutPhu}>
        {pending ? 'Đang hoàn tác…' : 'Hoàn tác'}
      </button>
      {state.message ? <span className="text-tiny text-down-500">{state.message}</span> : null}
    </form>
  );
}

export function QuetLaiButton() {
  const [state, action, pending] = useActionState(scanCorporateEventsAction, EMPTY);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <button type="submit" disabled={pending} className={nutPhu}>
        {pending ? 'Đang khởi động…' : 'Quét lại ngay'}
      </button>
      {state.message ? (
        <span className={`text-tiny ${state.ok ? 'text-up-500' : 'text-warn-500'}`}>{state.message}</span>
      ) : null}
    </form>
  );
}
