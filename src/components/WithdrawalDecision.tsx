'use client';

import { useActionState, useState } from 'react';
import { approveWithdrawalAction, rejectWithdrawalAction, type ActionResult } from '@/accounts/actions';

const EMPTY: ActionResult = { ok: false };

/**
 * CHẤP NHẬN / TỪ CHỐI MỘT YÊU CẦU RÚT VỐN.
 *
 * Quyết định ngay tại hàng chờ, không qua trang chi tiết như duyệt lệnh giao dịch: một
 * dòng vốn không có trang riêng, và mọi thứ cần để quyết định — ai rút, tài khoản nào,
 * bao nhiêu, còn lại bao nhiêu — đã hiện đủ trên thẻ.
 *
 * BẮT BUỘC GHI LÝ DO KHI TỪ CHỐI. Người gửi yêu cầu chỉ thấy trạng thái "đã từ chối";
 * không có lý do thì họ gửi lại đúng yêu cầu đó. Chấp nhận thì lý do là tuỳ chọn.
 *
 * Chốt thật nằm trong `quyetDinhRut`: quyền `capital.approve`, phạm vi nhóm, bốn mắt,
 * và kiểm lại số dư ở đúng thời điểm duyệt. Phần này chỉ là giao diện.
 */
export function WithdrawalDecision({ flowId }: { flowId: string }) {
  const [mode, setMode] = useState<'none' | 'REJECT'>('none');
  const [comment, setComment] = useState('');

  const [duyetState, duyetAction, dangDuyet] = useActionState(approveWithdrawalAction, EMPTY);
  const [tuChoiState, tuChoiAction, dangTuChoi] = useActionState(rejectWithdrawalAction, EMPTY);

  const state = duyetState.message ? duyetState : tuChoiState;

  if (state.ok) {
    return <p className="text-xs text-up-500">{state.message}</p>;
  }

  if (mode === 'REJECT') {
    return (
      <form action={tuChoiAction} className="w-56 space-y-2">
        <input type="hidden" name="flowId" value={flowId} />

        <label className="block">
          <span className="mb-1 block text-tiny font-medium text-slate-muted">
            Lý do từ chối <span className="text-down-500">*</span>
          </span>
          <textarea
            name="comment"
            required
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Vì sao chưa rút được"
            className="w-full rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs text-strong placeholder:text-ink-500 focus:border-accent-500 focus:outline-none"
          />
        </label>

        <div className="flex gap-1.5">
          <button
            type="submit"
            disabled={dangTuChoi || comment.trim().length === 0}
            className="rounded-lg bg-down-500 px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {dangTuChoi ? 'Đang ghi…' : 'Xác nhận từ chối'}
          </button>
          <button
            type="button"
            onClick={() => setMode('none')}
            className="rounded-lg px-2 py-1.5 text-xs text-slate-muted transition hover:text-strong"
          >
            Huỷ
          </button>
        </div>

        {state.message ? <p className="text-tiny text-down-500">{state.message}</p> : null}
      </form>
    );
  }

  return (
    <div className="w-56 space-y-2">
      <form action={duyetAction} className="space-y-2">
        <input type="hidden" name="flowId" value={flowId} />
        <input
          name="comment"
          placeholder="Ghi chú (không bắt buộc)"
          className="w-full rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs text-strong placeholder:text-ink-500 focus:border-accent-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={dangDuyet}
          className="w-full rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-60"
        >
          {dangDuyet ? 'Đang ghi…' : 'Chấp nhận rút'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => setMode('REJECT')}
        className="w-full rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-slate-muted transition hover:border-down-500/40 hover:text-down-500"
      >
        Từ chối
      </button>

      {state.message ? <p className="text-tiny text-down-500">{state.message}</p> : null}
    </div>
  );
}
