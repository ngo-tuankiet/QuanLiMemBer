'use client';

import { useActionState, useState } from 'react';
import {
  saveDepartmentAction,
  saveTeamAction,
  toggleTeamAction,
  type ActionResult,
} from '@/admin/org-actions';

const EMPTY: ActionResult = { ok: false };

const inputCls =
  'w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-strong ' +
  'placeholder:text-ink-500 focus:border-accent-500 focus:outline-none';
const labelCls = 'mb-1 block text-tiny font-medium text-slate-muted';

export interface DeptOption {
  id: string;
  code: string;
  nameVi: string;
  parentId: string | null;
  sortOrder: number;
  teamCount: number;
}

export interface MemberOption {
  id: string;
  fullName: string;
}

export interface TeamRow {
  id: string;
  code: string;
  name: string;
  nameVi: string;
  description: string | null;
  departmentId: string;
  leaderId: string | null;
  isActive: boolean;
  memberCount: number;
  members: MemberOption[];
}

function Loi({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <span className="mt-1 block text-tiny text-down-500">{errors.join(' · ')}</span>;
}

function KetQua({ state }: { state: ActionResult }) {
  if (!state.message) return null;
  return (
    <p className={`mt-2 text-xs ${state.ok ? 'text-up-500' : 'text-down-500'}`} role="status">
      {state.message}
    </p>
  );
}

/**
 * MÃ CHỈ NHẬP ĐƯỢC KHI TẠO MỚI.
 *
 * `code` là khoá mà `db:seed` dùng để `upsert`. Đổi nó khiến lần seed sau tạo một bản ghi
 * MỚI thay vì cập nhật bản ghi cũ, và mọi lệnh đã gắn nhóm sẽ trỏ về một nhóm không còn
 * ai nhìn thấy. Server cũng chặn — ô này khoá lại chỉ để người dùng khỏi mất công gõ.
 */
function OMa({ giaTri, moi, errors }: { giaTri?: string; moi: boolean; errors?: string[] }) {
  return (
    <label className="block">
      <span className={labelCls}>
        Mã {moi ? <span className="text-down-500">*</span> : <span className="text-ink-500">(không sửa được)</span>}
      </span>
      <input
        name="code"
        required
        defaultValue={giaTri}
        readOnly={!moi}
        placeholder="DAU_TU_1"
        className={`${inputCls} font-mono ${moi ? '' : 'cursor-not-allowed text-slate-muted'}`}
      />
      <Loi errors={errors} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Nhóm
// ---------------------------------------------------------------------------

export function TeamForm({
  team,
  departments,
}: {
  /** Bỏ trống = tạo nhóm mới. */
  team?: TeamRow;
  departments: DeptOption[];
}) {
  const [mo, setMo] = useState(false);
  const [state, action, pending] = useActionState(saveTeamAction, EMPTY);

  const moi = team === undefined;

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className={
          moi
            ? 'rounded-lg border border-accent-500/40 px-3 py-1.5 text-xs font-medium text-accent-400 transition hover:bg-accent-500/10'
            : 'rounded-md px-2 py-1 text-tiny text-ink-500 transition hover:text-slate-soft'
        }
      >
        {moi ? '+ Thêm nhóm' : 'Sửa'}
      </button>
    );
  }

  return (
    <form action={action} className="w-full rounded-lg border border-ink-700 bg-ink-850 p-4">
      {team ? <input type="hidden" name="id" value={team.id} /> : null}

      <p className="mb-3 text-xs font-medium text-strong">
        {moi ? 'Nhóm mới' : `Sửa nhóm ${team!.nameVi}`}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <OMa giaTri={team?.code} moi={moi} errors={state.fieldErrors?.code} />

        <label className="block">
          <span className={labelCls}>
            Tên hiển thị <span className="text-down-500">*</span>
          </span>
          <input name="nameVi" required defaultValue={team?.nameVi} placeholder="Đầu tư 1" className={inputCls} />
          <Loi errors={state.fieldErrors?.nameVi} />
        </label>

        <label className="block">
          <span className={labelCls}>
            Tên tiếng Anh <span className="text-down-500">*</span>
          </span>
          <input name="name" required defaultValue={team?.name} placeholder="Investment 1" className={inputCls} />
          <Loi errors={state.fieldErrors?.name} />
        </label>

        <label className="block">
          <span className={labelCls}>
            Phòng ban <span className="text-down-500">*</span>
          </span>
          <select name="departmentId" required defaultValue={team?.departmentId} className={inputCls}>
            <option value="">— chọn —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nameVi}
              </option>
            ))}
          </select>
          <Loi errors={state.fieldErrors?.departmentId} />
        </label>

        {/*
          TRƯỞNG NHÓM CHỈ CHỌN TRONG THÀNH VIÊN CỦA NHÓM.
          Gán người ở nhóm khác sẽ cho họ quyền quyết định trên dữ liệu mà `dataScope`
          không cho họ xem — hai chốt nói hai điều trái ngược. Nhóm mới chưa có ai nên ô
          này ẩn hẳn.
        */}
        {!moi ? (
          <label className="block">
            <span className={labelCls}>Trưởng nhóm</span>
            <select name="leaderId" defaultValue={team?.leaderId ?? ''} className={inputCls}>
              <option value="">— chưa có —</option>
              {team!.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
            <Loi errors={state.fieldErrors?.leaderId} />
            {team!.members.length === 0 ? (
              <span className="mt-1 block text-tiny text-ink-500">
                Nhóm chưa có thành viên nào.
              </span>
            ) : null}
          </label>
        ) : null}

        <label className="block sm:col-span-2">
          <span className={labelCls}>Mô tả</span>
          <input
            name="description"
            defaultValue={team?.description ?? ''}
            placeholder="Không bắt buộc"
            className={inputCls}
          />
          <Loi errors={state.fieldErrors?.description} />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-60"
        >
          {pending ? 'Đang lưu…' : moi ? 'Tạo nhóm' : 'Lưu'}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded-lg px-2 py-2 text-sm text-slate-muted transition hover:text-strong"
        >
          Đóng
        </button>
      </div>

      <KetQua state={state} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Phòng ban
// ---------------------------------------------------------------------------

export function DepartmentForm({
  dept,
  departments,
}: {
  dept?: DeptOption;
  departments: DeptOption[];
}) {
  const [mo, setMo] = useState(false);
  const [state, action, pending] = useActionState(saveDepartmentAction, EMPTY);

  const moi = dept === undefined;

  // Không cho chọn chính nó làm cấp trên — server chặn cả nhánh con, đây chặn ca hiển nhiên.
  const chonDuoc = departments.filter((d) => d.id !== dept?.id);

  if (!mo) {
    return (
      <button
        type="button"
        onClick={() => setMo(true)}
        className={
          moi
            ? 'rounded-lg border border-accent-500/40 px-3 py-1.5 text-xs font-medium text-accent-400 transition hover:bg-accent-500/10'
            : 'rounded-md px-2 py-1 text-tiny text-ink-500 transition hover:text-slate-soft'
        }
      >
        {moi ? '+ Thêm phòng ban' : 'Sửa'}
      </button>
    );
  }

  return (
    <form action={action} className="w-full rounded-lg border border-ink-700 bg-ink-850 p-4">
      {dept ? <input type="hidden" name="id" value={dept.id} /> : null}

      <p className="mb-3 text-xs font-medium text-strong">
        {moi ? 'Phòng ban mới' : `Sửa phòng ban ${dept!.nameVi}`}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <OMa giaTri={dept?.code} moi={moi} errors={state.fieldErrors?.code} />

        <label className="block">
          <span className={labelCls}>
            Tên hiển thị <span className="text-down-500">*</span>
          </span>
          <input name="nameVi" required defaultValue={dept?.nameVi} placeholder="Khối đầu tư" className={inputCls} />
          <Loi errors={state.fieldErrors?.nameVi} />
        </label>

        <label className="block">
          <span className={labelCls}>
            Tên tiếng Anh <span className="text-down-500">*</span>
          </span>
          <input name="name" required defaultValue={dept?.nameVi} placeholder="Investment Division" className={inputCls} />
          <Loi errors={state.fieldErrors?.name} />
        </label>

        <label className="block">
          <span className={labelCls}>Trực thuộc</span>
          <select name="parentId" defaultValue={dept?.parentId ?? ''} className={inputCls}>
            <option value="">— không, đây là cấp cao nhất —</option>
            {chonDuoc.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nameVi}
              </option>
            ))}
          </select>
          <Loi errors={state.fieldErrors?.parentId} />
        </label>

        <label className="block">
          <span className={labelCls}>Thứ tự hiển thị</span>
          <input
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={dept?.sortOrder ?? 0}
            className={`${inputCls} tabular w-28`}
          />
          <Loi errors={state.fieldErrors?.sortOrder} />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-60"
        >
          {pending ? 'Đang lưu…' : moi ? 'Tạo phòng ban' : 'Lưu'}
        </button>
        <button
          type="button"
          onClick={() => setMo(false)}
          className="rounded-lg px-2 py-2 text-sm text-slate-muted transition hover:text-strong"
        >
          Đóng
        </button>
      </div>

      <KetQua state={state} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Đóng / mở lại nhóm
// ---------------------------------------------------------------------------

export function ToggleTeamButton({
  teamId,
  isActive,
  memberCount,
}: {
  teamId: string;
  isActive: boolean;
  memberCount: number;
}) {
  const [state, action, pending] = useActionState(toggleTeamAction, EMPTY);

  // Nhóm còn người thì không đóng được — server chặn, đây nói trước.
  const biChan = isActive && memberCount > 0;

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={teamId} />
      <button
        type="submit"
        disabled={pending || biChan}
        title={
          biChan
            ? `Còn ${memberCount} thành viên — chuyển họ sang nhóm khác trước khi đóng.`
            : isActive
              ? 'Đóng nhóm. Lịch sử lệnh và vốn vẫn giữ nguyên.'
              : 'Mở lại nhóm'
        }
        className={`rounded-md px-2 py-1 text-tiny transition disabled:opacity-60 ${
          biChan ? 'cursor-not-allowed text-ink-600' : 'text-ink-500 hover:text-slate-soft'
        }`}
      >
        {pending ? '…' : isActive ? 'Đóng' : 'Mở lại'}
      </button>
      {state.message && !state.ok ? (
        <span className="ml-2 text-tiny text-down-500">{state.message}</span>
      ) : null}
    </form>
  );
}
