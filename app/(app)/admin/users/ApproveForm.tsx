'use client';

import { useState } from 'react';
import { approveUserAction, rejectUserAction } from '@/admin/actions';
import { ActionForm, FormMessage, SubmitButton } from '@/components/ActionForm';
import { Field, Select } from '@/components/ui';

export interface OrgOption {
  id: string;
  label: string;
}
export interface RoleOption {
  /** Giá trị gửi lên server là ROLE CODE, không phải id. */
  value: string;
  label: string;
}

export interface TeamOption extends OrgOption {
  departmentId: string;
  /** Tên phòng ban chứa nhóm này — để nhóm dropdown bằng optgroup. */
  departmentLabel: string;
}

/**
 * Gom nhóm theo phòng ban, giữ nguyên thứ tự nhóm đã được sắp từ server.
 */
export function nhomTheoPhongBan(teams: TeamOption[]): [string, TeamOption[]][] {
  const map = new Map<string, TeamOption[]>();
  for (const t of teams) {
    const cu = map.get(t.departmentLabel);
    if (cu) cu.push(t);
    else map.set(t.departmentLabel, [t]);
  }
  return [...map.entries()];
}

/**
 * Form duyệt tài khoản (§4): gán Role + Department + Team.
 *
 * PHÒNG BAN VÀ NHÓM ĐỘC LẬP VỚI NHAU — và đây là một sửa đổi có chủ ý.
 *
 * Trước đây dropdown Nhóm bị lọc theo Phòng ban đang chọn, và server từ chối nếu
 * hai thứ không khớp. Nghe hợp lý, nhưng nó chặn đúng một trường hợp thật: một
 * Quản lý cấp cao thuộc phòng "Ban lãnh đạo" vẫn giao dịch dưới nhóm "Cá nhân".
 * Phòng "Ban lãnh đạo" không có nhóm nào (đúng thiết kế), nên dropdown rỗng và
 * hiện "Phòng ban này chưa có nhóm" — người duyệt không có cách nào gán nhóm.
 *
 * Hai ô trả lời hai câu khác nhau:
 *
 *   PHÒNG BAN  người này ngồi ở đâu trong cây tổ chức (§2)
 *   NHÓM       giao dịch của người này thuộc nhóm nào — quyết định `trades.teamId`,
 *              phạm vi `dataScope` khi SCOPED, và cách cộng lãi/lỗ theo nhóm
 *
 * Ràng buộc cũ gộp hai câu đó thành một. Nay dropdown liệt kê MỌI nhóm, gom theo
 * phòng ban để vẫn thấy rõ mình đang gán ra ngoài phòng ban của người đó.
 *
 * Cố tình KHÔNG có ô chọn Strategy: theo §4, Strategy thuộc Trade.
 */
export function ApproveForm({
  userId,
  roles,
  departments,
  teams,
}: {
  userId: string;
  roles: RoleOption[];
  departments: OrgOption[];
  teams: TeamOption[];
}) {
  const [departmentId, setDepartmentId] = useState('');
  const nhomTheoPB = nhomTheoPhongBan(teams);

  return (
    <div className="space-y-3">
      <ActionForm action={approveUserAction} hidden={{ userId }} className="space-y-3">
        {(state) => (
          <>
            <FormMessage state={state} />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Vai trò"
                name="roleCode"
                required
                placeholder="Chọn vai trò"
                options={roles}
                errors={state?.fieldErrors?.roleCode}
              />

              <div>
                <label htmlFor="departmentId" className="field-label">
                  Phòng ban <span className="ml-1 text-down-500">*</span>
                </label>
                <select
                  id="departmentId"
                  name="departmentId"
                  required
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="field"
                >
                  <option value="">Chọn phòng ban</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
                {state?.fieldErrors?.departmentId ? (
                  <p className="mt-1 text-xs text-down-500">
                    {state.fieldErrors.departmentId.join(' ')}
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor="teamId" className="field-label">
                  Nhóm
                </label>
                {/*
                  KHÔNG còn `disabled={!departmentId}`: nhóm không phụ thuộc phòng ban
                  nữa, nên chờ chọn phòng ban là chờ vô cớ.
                */}
                <select id="teamId" name="teamId" className="field">
                  <option value="">Không thuộc nhóm nào</option>
                  {nhomTheoPB.map(([tenPB, ds]) => (
                    <optgroup key={tenPB} label={tenPB}>
                      {ds.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {state?.fieldErrors?.teamId ? (
                  <p className="mt-1 text-xs text-down-500">
                    {state.fieldErrors.teamId.join(' ')}
                  </p>
                ) : null}
              </div>

              <Field
                label="Mã nhân viên"
                name="employeeCode"
                placeholder="EX-003"
                errors={state?.fieldErrors?.employeeCode}
              />
            </div>

            <SubmitButton>Duyệt &amp; kích hoạt</SubmitButton>
          </>
        )}
      </ActionForm>

      <details className="rounded-lg border border-ink-700 bg-ink-850">
        <summary className="cursor-pointer px-3 py-2 text-xs text-slate-muted hover:text-slate-soft">
          Từ chối tài khoản này
        </summary>
        <div className="border-t border-ink-700 p-3">
          <ActionForm action={rejectUserAction} hidden={{ userId }} className="space-y-2.5">
            {(state) => (
              <>
                <FormMessage state={state} />
                <Field
                  label="Lý do từ chối"
                  name="reason"
                  required
                  placeholder="Không thuộc tổ chức"
                  errors={state?.fieldErrors?.reason}
                />
                <SubmitButton variant="danger" confirm="Từ chối tài khoản này?">
                  Từ chối
                </SubmitButton>
              </>
            )}
          </ActionForm>
        </div>
      </details>
    </div>
  );
}
