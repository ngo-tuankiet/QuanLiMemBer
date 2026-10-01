'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { setUserPermissionAction } from '@/admin/actions';
import { PERMISSION_EFFECT } from '@/lib/enums';

export interface PermissionRowData {
  code: string;
  module: string;
  nameVi: string;
  /** Quyền này có trong Role của người dùng hay không. */
  fromRole: boolean;
  /** Override đang áp dụng: GRANT | DENY | null. */
  override: 'GRANT' | 'DENY' | null;
  /** Kết quả cuối cùng sau khi phân giải DENY > GRANT > Role. */
  effective: boolean;
}

/**
 * Bảng điều chỉnh quyền riêng cho một người dùng (§3).
 *
 * Cột "Hiệu lực" là kết quả của `resolvePermissions()`: DENY thắng GRANT, GRANT
 * thắng Role. Hiển thị cả ba cột để người quản trị thấy rõ vì sao một quyền đang
 * bật hay tắt — nếu chỉ hiện kết quả cuối, việc gỡ lỗi phân quyền là bất khả thi.
 */
export function PermissionEditor({
  userId,
  rows,
  disabled,
  laChinhMinh,
}: {
  userId: string;
  rows: PermissionRowData[];
  disabled: boolean;
  /** Người đang xem chính là người đang bị sửa — xem chú thích trong `AssignForm`. */
  laChinhMinh: boolean;
}) {
  const [query, setQuery] = useState('');
  const [onlyOverridden, setOnlyOverridden] = useState(false);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (onlyOverridden && !r.override) return false;
      if (!q) return true;
      return r.code.toLowerCase().includes(q) || r.nameVi.toLowerCase().includes(q);
    });

    const map = new Map<string, PermissionRowData[]>();
    for (const row of filtered) {
      const list = map.get(row.module) ?? [];
      list.push(row);
      map.set(row.module, list);
    }
    return [...map.entries()];
  }, [rows, query, onlyOverridden]);

  const overrideCount = rows.filter((r) => r.override).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm quyền…"
          className="field max-w-xs"
        />
        <label className="flex items-center gap-2 text-xs text-slate-muted">
          <input
            type="checkbox"
            checked={onlyOverridden}
            onChange={(e) => setOnlyOverridden(e.target.checked)}
            className="accent-accent-500"
          />
          Chỉ hiện quyền đã ghi đè ({overrideCount})
        </label>
      </div>

      {disabled ? (
        <p className="mb-3 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-xs text-slate-muted">
          Bạn không thể điều chỉnh quyền của tài khoản có vai trò cao hơn mình.
        </p>
      ) : (
        /*
          CẢNH BÁO THU HỒI PHIÊN — trước đây khối này KHÔNG có.

          Mỗi ô Cấp/Chặn/Bỏ ghi đè là một form riêng, bấm là gửi ngay, không qua hộp
          xác nhận nào. `setUserPermissionAction` thu hồi toàn bộ phiên của người bị
          sửa — nên một cú bấm ở đây đá người đó ra khỏi hệ thống mà không có gì báo
          trước. Tệ nhất là khi người bị sửa là chính mình: mất phiên giữa lúc đang
          sửa dở bảng quyền.

          Không thêm hộp xác nhận cho từng ô: bảng này có hàng chục dòng và việc điều
          chỉnh quyền thường là bấm nhiều ô liên tiếp. Một hộp thoại mỗi lần bấm sẽ
          thành thứ bấm-Yes-theo-phản-xạ, tức là mất tác dụng. Một câu nói rõ đặt
          NGAY TRÊN bảng, đọc một lần trước khi bắt đầu, hợp với cách dùng thật hơn.
        */
        <p
          className={`mb-3 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
            laChinhMinh
              ? 'border-warn-500/30 bg-warn-500/5 text-warn-500'
              : 'border-ink-700 bg-ink-850 text-slate-muted'
          }`}
        >
          {laChinhMinh ? (
            <>
              Đây là tài khoản của chính bạn. Mỗi lần bấm Cấp / Chặn / Bỏ ghi đè,{' '}
              <span className="font-medium">bạn sẽ bị đăng xuất ngay</span> và phải đăng
              nhập lại. Đổi xong hết rồi hãy bấm, hoặc nhờ một quản trị viên khác đổi hộ.
            </>
          ) : (
            <>
              Mỗi lần đổi một quyền ở đây sẽ thu hồi toàn bộ phiên đăng nhập của người
              này — họ bị đăng xuất ngay và phải đăng nhập lại.
            </>
          )}
        </p>
      )}

      <div className="space-y-4">
        {grouped.map(([module, moduleRows]) => (
          <div key={module}>
            <p className="mb-1.5 font-mono text-tiny font-medium tracking-wide text-accent-400">
              {module}
            </p>
            <div className="overflow-hidden rounded-lg border border-ink-700">
              <table className="w-full text-sm">
                <tbody>
                  {moduleRows.map((row) => (
                    <PermissionRow
                      key={row.code}
                      userId={userId}
                      row={row}
                      disabled={disabled}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {grouped.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-muted">Không có quyền nào khớp.</p>
        ) : null}
      </div>
    </div>
  );
}

function PermissionRow({
  userId,
  row,
  disabled,
}: {
  userId: string;
  row: PermissionRowData;
  disabled: boolean;
}) {
  const [state, formAction] = useActionState(setUserPermissionAction, null);

  return (
    <tr className="border-b border-ink-800 last:border-0">
      <td className="px-3 py-2">
        <span
          className={`mr-2 inline-block size-1.5 rounded-full ${
            row.effective ? 'bg-up-500' : 'bg-ink-600'
          }`}
          title={row.effective ? 'Đang có hiệu lực' : 'Không có hiệu lực'}
        />
        <span className="font-mono text-tiny text-slate-soft">{row.code}</span>
        <span className="ml-2 text-xs text-slate-muted">{row.nameVi}</span>
      </td>

      <td className="w-32 px-3 py-2 text-xs">
        {row.fromRole ? (
          <span className="text-slate-muted">theo vai trò</span>
        ) : (
          <span className="text-ink-500">không có</span>
        )}
      </td>

      <td className="w-24 px-3 py-2">
        {row.override === PERMISSION_EFFECT.GRANT ? (
          <span className="rounded border border-up-500/30 bg-up-500/10 px-1.5 py-px text-micro font-medium text-up-500">
            GRANT
          </span>
        ) : row.override === PERMISSION_EFFECT.DENY ? (
          <span className="rounded border border-down-500/30 bg-down-500/10 px-1.5 py-px text-micro font-medium text-down-500">
            DENY
          </span>
        ) : (
          <span className="text-micro text-ink-500">—</span>
        )}
      </td>

      <td className="w-56 px-3 py-2">
        <form action={formAction} className="flex items-center justify-end gap-1">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="permissionCode" value={row.code} />

          <EffectButton
            effect={PERMISSION_EFFECT.GRANT}
            label="Cấp"
            disabled={disabled || row.override === PERMISSION_EFFECT.GRANT}
            tone="up"
          />
          <EffectButton
            effect={PERMISSION_EFFECT.DENY}
            label="Chặn"
            disabled={disabled || row.override === PERMISSION_EFFECT.DENY}
            tone="down"
          />
          <EffectButton
            effect="CLEAR"
            label="Bỏ"
            disabled={disabled || !row.override}
            tone="neutral"
          />
        </form>

        {state && !state.ok && state.message ? (
          <p className="mt-1 text-right text-micro text-down-500">{state.message}</p>
        ) : null}
      </td>
    </tr>
  );
}

function EffectButton({
  effect,
  label,
  disabled,
  tone,
}: {
  effect: string;
  label: string;
  disabled: boolean;
  tone: 'up' | 'down' | 'neutral';
}) {
  const { pending } = useFormStatus();

  const tones = {
    up: 'hover:border-up-500/50 hover:text-up-500',
    down: 'hover:border-down-500/50 hover:text-down-500',
    neutral: 'hover:border-ink-500 hover:text-strong',
  };

  return (
    <button
      type="submit"
      name="effect"
      value={effect}
      disabled={disabled || pending}
      className={`rounded border border-ink-700 px-2 py-0.5 text-tiny text-slate-muted transition disabled:cursor-not-allowed disabled:opacity-30 ${tones[tone]}`}
    >
      {label}
    </button>
  );
}
