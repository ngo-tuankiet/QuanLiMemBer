import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Icon } from '@/components/icons';
import {
  DepartmentForm,
  TeamForm,
  ToggleTeamButton,
  type DeptOption,
  type TeamRow,
} from '@/components/OrgForms';
import { IbForm, ToggleIbButton, type IbRow } from '@/components/IbForms';
import { defaultRates } from '@/trading/fee-rates';

export const metadata: Metadata = { title: 'Cơ cấu tổ chức' };

/**
 * Một mức trong biểu phí, hiện gọn trên dòng.
 *
 * NULL không hiện thành "0%" mà thành "0,15% (chung)" — người đọc phải phân biệt
 * được "IB này miễn phí" với "IB này chưa khai, đang theo mức chung". Hai thứ đó ra
 * hai số tiền khác nhau.
 */
function bieuPhi(bps: number | null, mucChung: string): string {
  return bps === null ? `${mucChung}% (chung)` : `${bps / 100}%`;
}

/**
 * CƠ CẤU TỔ CHỨC — phòng ban và nhóm.
 *
 * VÌ SAO TRANG NÀY CẦN TỒN TẠI. Trước đây bốn nhóm và ba phòng ban chỉ sống trong
 * `master-data.ts`; đổi tên một nhóm nghĩa là sửa mã nguồn rồi chạy `npm run db:seed`.
 * Đó không phải việc của người vận hành, và cũng không có dấu vết kiểm toán nào.
 *
 * ĐẶT Ở NHÁNH QUẢN TRỊ, KHÔNG GỘP VÀO `/teams`. Trang Teams trả lời câu "nhóm nào đang
 * làm ăn ra sao" — một bảng số liệu để đọc. Trang này trả lời câu "hệ thống có những nhóm
 * nào" — một chỗ để sửa. Gộp lại thì người vào xem hiệu suất phải lướt qua các nút sửa
 * cơ cấu, còn người muốn đổi tên nhóm phải tìm giữa các biểu đồ.
 */
export default async function OrganizationPage() {
  const user = await requirePagePermission('team.view');

  const [departments, teams, ibs] = await Promise.all([
    prisma.department.findMany({
      orderBy: [{ sortOrder: 'asc' }, { nameVi: 'asc' }],
      select: {
        id: true,
        code: true,
        nameVi: true,
        parentId: true,
        sortOrder: true,
        isActive: true,
        _count: { select: { teams: true } },
      },
    }),
    prisma.team.findMany({
      orderBy: [{ isActive: 'desc' }, { nameVi: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        nameVi: true,
        description: true,
        departmentId: true,
        leaderId: true,
        isActive: true,
        leader: { select: { fullName: true } },
        members: { orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } },
        _count: { select: { members: true, trades: true } },
      },
    }),
    prisma.introducingBroker.findMany({
      orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        note: true,
        sortOrder: true,
        isActive: true,
        buyFeeRateBps: true,
        sellFeeRateBps: true,
        sellTaxRateBps: true,
        _count: { select: { accounts: true } },
      },
    }),
  ]);

  const suaDuocNhom = user.permissions.has('team.update');
  const taoDuocNhom = user.permissions.has('team.create');
  const suaDuocPhongBan = user.permissions.has('department.manage');
  const suaDuocIb = user.permissions.has('ib.manage');

  /*
   * Mức chung hiện hành, đổi sang phần trăm để hiện ngay trong ô trống của form.
   * Người khai thấy được "để trống thì thành bao nhiêu" mà không phải mở trang
   * Settings ra đối chiếu.
   */
  const chung = await defaultRates();
  const mucChungPhi = String(chung.buyFeeRateBps / 100);
  const mucChungThue = String(chung.sellTaxRateBps / 100);

  const ibRows: IbRow[] = ibs.map((x) => ({
    id: x.id,
    code: x.code,
    name: x.name,
    note: x.note,
    sortOrder: x.sortOrder,
    isActive: x.isActive,
    accountCount: x._count.accounts,
    buyFeeRateBps: x.buyFeeRateBps,
    sellFeeRateBps: x.sellFeeRateBps,
    sellTaxRateBps: x.sellTaxRateBps,
  }));

  const deptOptions: DeptOption[] = departments.map((d) => ({
    id: d.id,
    code: d.code,
    nameVi: d.nameVi,
    parentId: d.parentId,
    sortOrder: d.sortOrder,
    teamCount: d._count.teams,
  }));

  const tenPhongBan = new Map(departments.map((d) => [d.id, d.nameVi]));

  const teamRows: TeamRow[] = teams.map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    nameVi: t.nameVi,
    description: t.description,
    departmentId: t.departmentId,
    leaderId: t.leaderId,
    isActive: t.isActive,
    memberCount: t._count.members,
    members: t.members,
  }));

  return (
    <>
      <PageHeader
        title="Cơ cấu tổ chức"
        subtitle={`${departments.length} phòng ban · ${teams.length} nhóm · ${ibs.length} IB · mọi thay đổi đều được ghi vào Audit Log`}
      />

      {/* ---------------------------------------------------------------- */}
      {/* NHÓM — đứng trước phòng ban vì đây là thứ hay sửa hơn hẳn.        */}
      {/* ---------------------------------------------------------------- */}
      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 px-5 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-accent-400">
              <Icon name="teams" />
            </span>
            <h2 className="text-sm font-semibold text-strong">Nhóm</h2>
            <span className="text-tiny text-ink-500">{teams.length} nhóm</span>
          </div>
          {taoDuocNhom ? <TeamForm departments={deptOptions} /> : null}
        </div>

        {teams.length === 0 ? (
          <EmptyState
            title="Chưa có nhóm nào"
            hint="Tạo phòng ban trước, rồi thêm nhóm vào phòng ban đó."
          />
        ) : (
          <ul className="divide-y divide-ink-800">
            {teamRows.map((t) => (
              <li key={t.id} className="px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm font-medium text-strong">{t.nameVi}</span>
                      <span className="font-mono text-micro text-ink-500">{t.code}</span>
                      {!t.isActive ? (
                        <span className="rounded border border-ink-700 px-1.5 py-px text-micro text-slate-muted">
                          đã đóng
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-tiny text-slate-muted">
                      {tenPhongBan.get(t.departmentId) ?? '—'}
                      {' · '}
                      {t.memberCount} thành viên
                      {' · '}
                      {t.leaderId
                        ? `trưởng nhóm ${teams.find((x) => x.id === t.id)?.leader?.fullName ?? ''}`
                        : 'chưa có trưởng nhóm'}
                    </p>
                    {t.description ? (
                      <p className="mt-1 max-w-2xl text-tiny text-ink-500">{t.description}</p>
                    ) : null}
                  </div>

                  {suaDuocNhom ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <TeamForm team={t} departments={deptOptions} />
                      <ToggleTeamButton
                        teamId={t.id}
                        isActive={t.isActive}
                        memberCount={t.memberCount}
                      />
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* PHÒNG BAN                                                        */}
      {/* ---------------------------------------------------------------- */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 px-5 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-accent-400">
              <Icon name="members" />
            </span>
            <h2 className="text-sm font-semibold text-strong">Phòng ban</h2>
            <span className="text-tiny text-ink-500">{departments.length} phòng ban</span>
          </div>
          {suaDuocPhongBan ? <DepartmentForm departments={deptOptions} /> : null}
        </div>

        {departments.length === 0 ? (
          <EmptyState title="Chưa có phòng ban nào" />
        ) : (
          <ul className="divide-y divide-ink-800">
            {departments.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-strong">{d.nameVi}</span>
                    <span className="font-mono text-micro text-ink-500">{d.code}</span>
                  </div>
                  <p className="mt-0.5 text-tiny text-slate-muted">
                    {d.parentId ? `trực thuộc ${tenPhongBan.get(d.parentId) ?? '—'}` : 'cấp cao nhất'}
                    {' · '}
                    {d._count.teams} nhóm
                  </p>
                </div>

                {suaDuocPhongBan ? (
                  <DepartmentForm
                    dept={deptOptions.find((x) => x.id === d.id)!}
                    departments={deptOptions}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------------------------------------------------------- */}
      {/* DANH MỤC IB                                                      */}
      {/* ---------------------------------------------------------------- */}
      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 px-5 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-accent-400">
              <Icon name="userCheck" />
            </span>
            <h2 className="text-sm font-semibold text-strong">Danh mục IB</h2>
            <span className="text-tiny text-ink-500">
              {ibs.filter((x) => x.isActive).length} đang dùng / {ibs.length}
            </span>
          </div>
          {suaDuocIb ? <IbForm mucChungPhi={mucChungPhi} mucChungThue={mucChungThue} /> : null}
        </div>

        {ibs.length === 0 ? (
          <EmptyState
            title="Chưa khai IB nào"
            hint="Thêm IB ở đây thì khi khai tài khoản chứng khoán, người dùng chọn từ danh sách này thay vì tự gõ tên."
          />
        ) : (
          <ul className="divide-y divide-ink-800">
            {ibRows.map((x) => (
              <li key={x.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-strong">{x.name}</span>
                    <span className="font-mono text-micro text-ink-500">{x.code}</span>
                    {!x.isActive ? (
                      <span className="rounded border border-ink-700 px-1.5 py-px text-micro text-slate-muted">
                        ngừng dùng
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-tiny text-slate-muted">
                    {x.accountCount} tài khoản đang gắn
                    {' · '}
                    <span className="tabular">
                      {[
                        `mua ${bieuPhi(x.buyFeeRateBps, mucChungPhi)}`,
                        `bán ${bieuPhi(x.sellFeeRateBps, mucChungPhi)}`,
                        `thuế ${bieuPhi(x.sellTaxRateBps, mucChungThue)}`,
                      ].join(' · ')}
                    </span>
                  </p>
                  {x.note ? (
                    <p className="mt-1 max-w-2xl text-tiny text-ink-500">{x.note}</p>
                  ) : null}
                </div>

                {suaDuocIb ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <IbForm ib={x} mucChungPhi={mucChungPhi} mucChungThue={mucChungThue} />
                    <ToggleIbButton ib={x} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/*
        NÓI RÕ VÌ SAO MÃ KHÔNG SỬA ĐƯỢC. Người dùng sẽ thắc mắc, và câu trả lời không
        hiển nhiên: nó là khoá nối bản ghi trong database với dữ liệu chuẩn trong mã nguồn.
      */}
      <p className="mt-3 text-tiny leading-relaxed text-ink-500">
        Tên hiển thị sửa được bất cứ lúc nào. <span className="font-mono">Mã</span> thì không —
        nó là khoá nối bản ghi này với dữ liệu chuẩn trong mã nguồn, đổi mã sẽ khiến lần khởi
        tạo sau tạo một bản ghi mới thay vì cập nhật bản ghi cũ. Nhóm cũng không xoá được, chỉ
        đóng: lệnh và dòng vốn đã gắn nhóm sẽ mồ côi nếu nhóm biến mất.
      </p>
      <p className="mt-2 text-tiny leading-relaxed text-ink-500">
        <span className="text-slate-muted">Danh mục IB</span> là danh sách người dùng được
        chọn khi khai tài khoản chứng khoán — họ không gõ tay tên IB nữa. IB ngừng dùng thì
        biến mất khỏi ô chọn nhưng tài khoản đã gắn vẫn giữ nguyên, nên số liệu theo IB trên
        Dashboard không bị hụt.
      </p>
    </>
  );
}
