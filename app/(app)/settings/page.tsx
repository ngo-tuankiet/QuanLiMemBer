import Link from 'next/link';
import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { getDict } from '@/i18n';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { SettingForm } from './SettingForm';
import { SETTING_BOUNDS } from '@/settings/bounds';
import { absoluteVi } from '@/lib/elapsed';
import { SETTING_GROUP, type SettingGroup } from '@/lib/enums';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.nav.settings };
}

/**
 * SETTINGS (§21) — Phase 10.
 *
 * Mỗi tham số hiện kèm KHOÁ THẬT (`trading.lot_size`), không chỉ tên tiếng Việt.
 * Khoá là thứ xuất hiện trong Audit Log, trong `.env`, và trong code — người vận
 * hành cần đọc được cùng một tên ở cả bốn nơi.
 *
 * Trang này KHÔNG chứa mọi thứ cấu hình được của hệ thống, và điều đó là chủ ý:
 *
 *   `system_settings`  quy tắc nghiệp vụ  → sửa ở đây
 *   `risk_rules`       ngưỡng rủi ro      → sửa ở trang Risk
 *   `.env`             tham số triển khai → sửa trên máy chủ, cần khởi động lại
 *
 * Ranh giới đó được ghi rõ ở cuối trang, vì câu hỏi "sửa X ở đâu" là câu hỏi
 * thường gặp nhất với một trang Settings.
 */

const GROUP_ORDER: readonly SettingGroup[] = [
  SETTING_GROUP.TRADING,
  SETTING_GROUP.MARKET_DATA,
  SETTING_GROUP.RISK,
  SETTING_GROUP.GENERAL,
];

const GROUP_LABEL: Record<SettingGroup, { title: string; hint: string }> = {
  TRADING: {
    title: 'Giao dịch',
    hint: 'Phí, thuế, lô chuẩn và ngưỡng buộc phải duyệt.',
  },
  MARKET_DATA: {
    title: 'Dữ liệu thị trường',
    hint: 'Khi nào coi giá là cũ, và chỉ số nào dùng làm tham chiếu.',
  },
  RISK: {
    title: 'Rủi ro',
    hint: 'Ngưỡng rủi ro nằm ở trang Risk, không ở đây.',
  },
  GENERAL: {
    title: 'Chung',
    hint: 'Múi giờ và đơn vị tiền tệ.',
  },
};

export default async function SettingsPage() {
  const user = await requirePagePermission('settings.view');
  const { t } = await getDict();
  const canEdit = user.permissions.has('settings.update');

  const settings = await prisma.systemSetting.findMany({
    orderBy: [{ group: 'asc' }, { key: 'asc' }],
    include: { updatedBy: { select: { fullName: true } } },
  });

  const byGroup = new Map<string, typeof settings>();
  for (const setting of settings) {
    const list = byGroup.get(setting.group) ?? [];
    list.push(setting);
    byGroup.set(setting.group, list);
  }

  // Nhóm lạ (dữ liệu cũ trong DB) vẫn phải hiện, không được im lặng biến mất.
  const extraGroups = [...byGroup.keys()].filter(
    (g) => !GROUP_ORDER.includes(g as SettingGroup),
  );

  return (
    <>
      <PageHeader
        title={t.nav.settings}
        subtitle={
          canEdit
            ? `${settings.length} tham số · mọi thay đổi đều được ghi vào ${t.nav.auditLog}`
            : `${settings.length} tham số · cần quyền settings.update để sửa`
        }
      />

      {settings.length === 0 ? (
        <Card>
          <EmptyState
            title="Chưa có tham số nào"
            hint="Chạy npm run db:seed để nạp cấu hình mặc định."
          />
        </Card>
      ) : null}

      <div className="space-y-4">
        {[...GROUP_ORDER, ...extraGroups].map((group) => {
          const rows = byGroup.get(group);
          if (!rows || rows.length === 0) return null;

          const label = GROUP_LABEL[group as SettingGroup] ?? {
            title: group,
            hint: 'Nhóm không còn trong code.',
          };

          return (
            <Card key={group} className="overflow-hidden">
              <div className="border-b border-ink-800 px-4 py-3">
                <h2 className="text-sm font-semibold text-strong">{label.title}</h2>
                <p className="mt-0.5 text-tiny text-slate-muted">{label.hint}</p>
              </div>

              <ul className="divide-y divide-ink-800">
                {rows.map((setting) => (
                  <li key={setting.key} className="px-4 py-4">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className="text-sm font-medium text-strong">{setting.nameVi}</span>
                      <code className="rounded bg-ink-850 px-1.5 py-px font-mono text-tiny text-slate-muted">
                        {setting.key}
                      </code>
                      <span className="rounded border border-ink-700 px-1.5 py-px font-mono text-micro text-slate-muted">
                        {setting.valueType}
                      </span>
                      {!setting.isEditable ? (
                        <span className="rounded border border-ink-600 px-1.5 py-px text-micro text-ink-500">
                          chỉ đọc
                        </span>
                      ) : null}

                      {setting.updatedBy ? (
                        <span className="ml-auto text-tiny text-ink-500">
                          {setting.updatedBy.fullName} · {absoluteVi(setting.updatedAt)}
                        </span>
                      ) : null}
                    </div>

                    {setting.description ? (
                      <p className="mt-1 max-w-3xl text-xs text-slate-muted">
                        {setting.description}
                      </p>
                    ) : null}

                    <div className="mt-2.5">
                      {canEdit && setting.isEditable ? (
                        <SettingForm
                          settingKey={setting.key}
                          value={setting.value}
                          valueType={setting.valueType}
                          boundsNote={SETTING_BOUNDS[setting.key]?.note ?? null}
                        />
                      ) : (
                        <p className="tabular rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 font-mono text-xs text-slate-soft">
                          {/*
                            `isSecret` thì che giá trị. Hiện nay không tham số nào
                            được đánh dấu như vậy — bí mật thật (token, mật khẩu)
                            nằm trong `.env` và không bao giờ đi qua database. Cột
                            này vẫn được tôn trọng để nếu sau này có, nó có tác
                            dụng ngay chứ không cần ai nhớ ra.
                          */}
                          {setting.isSecret ? '••••••••' : setting.value}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>

      {/* Ranh giới giữa ba nơi cấu hình */}
      <Card className="mt-4 p-4">
        <h2 className="text-sm font-semibold text-strong">Cấu hình không nằm ở trang này</h2>
        <dl className="mt-2.5 space-y-2 text-xs">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-soft">Ngưỡng rủi ro</dt>
            <dd className="text-slate-muted">
              bảng <code className="font-mono">risk_rules</code> — sửa ở{' '}
              <Link href="/risk" className="text-accent-400 hover:underline">
                trang Risk
              </Link>
              . Ở đó ngưỡng còn kèm mức nghiêm trọng, bật/tắt, và phạm vi áp dụng.
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-soft">Tham số triển khai</dt>
            <dd className="text-slate-muted">
              tệp <code className="font-mono">.env</code> trên máy chủ — địa chỉ database, token
              nội bộ, chu kỳ đồng bộ giá, chu kỳ quét rủi ro. Sửa xong phải khởi động lại.
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-soft">Phân quyền</dt>
            <dd className="text-slate-muted">
              <Link href="/admin/permissions" className="text-accent-400 hover:underline">
                Ma trận quyền
              </Link>{' '}
              và trang người dùng.
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-tiny text-ink-500">
          Mỗi tham số chỉ tồn tại ở MỘT nơi. Một tham số nằm ở hai nơi thì sớm muộn hai bản
          lệch nhau, và người sửa bản không được đọc sẽ kết luận hệ thống bị lỗi.
        </p>
      </Card>
    </>
  );
}
