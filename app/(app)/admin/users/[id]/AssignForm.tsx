'use client';

import { useState } from 'react';
import { assignUserAction, revokeUserSessionsAction } from '@/admin/actions';
import { ActionForm, FormMessage, SubmitButton } from '@/components/ActionForm';
import { nhomTheoPhongBan, type TeamOption } from '../ApproveForm';

export function AssignForm({
  userId,
  roles,
  departments,
  teams,
  current,
  disabled,
  laChinhMinh,
}: {
  userId: string;
  roles: { value: string; label: string }[];
  departments: { id: string; label: string }[];
  teams: TeamOption[];
  current: { roleCode: string | null; departmentId: string | null; teamId: string | null };
  disabled: boolean;
  /**
   * Người đang xem chính là người đang bị sửa.
   *
   * Cần biết vì hậu quả KHÁC HẲN về mức độ: lưu xong thì chính người bấm bị đăng
   * xuất ngay giữa lúc làm việc. Câu cảnh báo cũ nói "phiên của NGƯỜI NÀY sẽ bị thu
   * hồi" — khi đối tượng là chính mình, câu đó đọc ra là chuyện của ai khác. Đã xảy
   * ra thật: tự gán mình vào một nhóm, bị đá về trang đăng nhập, và tưởng Dashboard
   * bị lỗi.
   */
  laChinhMinh: boolean;
}) {
  const [departmentId, setDepartmentId] = useState(current.departmentId ?? '');
  /*
    Nhóm KHÔNG lọc theo phòng ban — xem chú thích đầu `ApproveForm`. Dùng lại
    chính hàm gom nhóm của form đó thay vì viết lại: hai form hiện cùng một danh
    sách, nếu dựng riêng thì sớm muộn hai chỗ sẽ khác nhau.
  */
  const nhomTheoPB = nhomTheoPhongBan(teams);

  return (
    <ActionForm action={assignUserAction} hidden={{ userId }} className="space-y-3">
      {(state) => (
        <>
          <FormMessage state={state} />

          <div>
            <label htmlFor="roleCode" className="field-label">
              Vai trò
            </label>
            <select
              id="roleCode"
              name="roleCode"
              defaultValue={current.roleCode ?? ''}
              disabled={disabled}
              className="field disabled:opacity-40"
            >
              <option value="">Chọn vai trò</option>
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="departmentId" className="field-label">
              Phòng ban
            </label>
            <select
              id="departmentId"
              name="departmentId"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              disabled={disabled}
              className="field disabled:opacity-40"
            >
              <option value="">Không thuộc phòng ban nào</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="teamId" className="field-label">
              Nhóm
            </label>
            <select
              id="teamId"
              name="teamId"
              defaultValue={current.teamId ?? ''}
              disabled={disabled}
              className="field disabled:opacity-40"
            >
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
              <p className="mt-1 text-xs text-down-500">{state.fieldErrors.teamId.join(' ')}</p>
            ) : null}
          </div>

          {/*
            Cảnh báo phải nói ĐÚNG AI bị ảnh hưởng.

            Sửa chính mình thì hậu quả tức thì và với chính người đang bấm, nên nó được
            khung màu cảnh báo thay vì một dòng chữ mờ — dòng chữ mờ là thứ mắt bỏ qua.

            Bản đầu nói "bạn sẽ bị đăng xuất ngay", và đúng là như vậy: action thu hồi CẢ
            phiên đang dùng. Hậu quả là người bấm Lưu bị ném ra trang đăng nhập, không kịp
            thấy thông báo nào — và họ báo lại rằng "không lưu thay đổi được", trong khi dữ
            liệu đã lưu xong. Nay phiên hiện tại được giữ; xem `revokeAllSessions`.
          */}
          {laChinhMinh ? (
            <p className="rounded-lg border border-warn-500/30 bg-warn-500/5 px-3 py-2 text-xs leading-relaxed text-warn-500">
              Đây là tài khoản của chính bạn. Phiên bạn đang dùng{' '}
              <span className="font-medium">được giữ lại</span> nên bạn thấy ngay kết quả,
              nhưng {' '}
              <span className="font-medium">mọi phiên khác của bạn bị thu hồi</span> — thiết bị
              hay trình duyệt khác phải đăng nhập lại. Quyền mới có hiệu lực tức thì.
            </p>
          ) : (
            <p className="text-xs text-slate-muted">
              Lưu xong, toàn bộ phiên đăng nhập của người này bị thu hồi và họ phải đăng nhập
              lại — kể cả khi chỉ đổi nhóm.
            </p>
          )}

          {!disabled ? (
            <SubmitButton
              confirm={
                laChinhMinh
                  ? 'Lưu thay đổi cho chính tài khoản của bạn? Các phiên đăng nhập khác của bạn sẽ bị thu hồi.'
                  : 'Lưu thay đổi? Người dùng sẽ phải đăng nhập lại.'
              }
            >
              Lưu thay đổi
            </SubmitButton>
          ) : null}
        </>
      )}
    </ActionForm>
  );
}

export function RevokeSessionsForm({
  userId,
  sessionCount,
  disabled,
}: {
  userId: string;
  sessionCount: number;
  disabled: boolean;
}) {
  // Không có quyền thì không hiện nút. Server action vẫn kiểm tra lại, nhưng bày
  // ra một nút chắc chắn bị từ chối là giao diện gây nhầm lẫn.
  if (disabled) {
    return (
      <p className="text-xs text-slate-muted">
        {sessionCount > 0
          ? `${sessionCount} phiên đang hoạt động.`
          : 'Không có phiên nào đang hoạt động.'}
      </p>
    );
  }

  return (
    <ActionForm action={revokeUserSessionsAction} hidden={{ userId }} className="space-y-2">
      {(state) => (
        <>
          <FormMessage state={state} />
          <SubmitButton
            variant="ghost"
            className="!text-xs"
            confirm="Thu hồi toàn bộ phiên đăng nhập của người này?"
          >
            {sessionCount > 0
              ? `Thu hồi ${sessionCount} phiên đang hoạt động`
              : 'Không có phiên nào đang hoạt động'}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
