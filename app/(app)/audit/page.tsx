import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { getDict } from '@/i18n';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { parseJsonField } from '@/lib/serialize';
import { AUDIT_ACTION } from '@/lib/enums';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.nav.auditLog };
}

const PAGE_SIZE = 40;

/**
 * Audit Log (§20). Chỉ đọc — bảng này bất biến, không có đường sửa hay xoá.
 *
 * Phase 10 thêm bộ lọc thật (hành động, loại đối tượng, người thực hiện, khoảng
 * ngày) và nút xuất CSV. Nút xuất mang THEO ĐÚNG bộ lọc đang hiển thị: người ta
 * lọc ra đúng thứ cần rồi mới xuất, nên tệp phải khớp với những gì trên màn hình.
 * Xuất "tất cả" trong khi màn hình đang lọc là cách chắc chắn để ai đó gửi đi một
 * tệp khác với tệp họ nghĩ mình vừa tải.
 *
 * Quyền xuất là `audit.export`, TÁCH RIÊNG khỏi `audit.view`: nhật ký này là dấu
 * vết hành vi của từng người, nên mang nó ra ngoài hệ thống là một quyền khác với
 * việc xem nó trên màn hình.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    action?: string;
    entityType?: string;
    actor?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const user = await requirePagePermission('audit.view');
  const { t } = await getDict();

  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? '1') || 1);
  const actionFilter = params.action;
  const entityFilter = params.entityType;
  const actorFilter = params.actor?.trim() || undefined;
  const fromDate = parseDay(params.from);
  const toDate = parseDay(params.to, true);

  const filters: AuditFilters = {
    action: actionFilter,
    entityType: entityFilter,
    actor: actorFilter,
    from: params.from,
    to: params.to,
  };

  const where = {
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(entityFilter ? { entityType: entityFilter } : {}),
    /*
     * Lọc người thực hiện theo BẢN CHỤP tên và email trên chính dòng nhật ký,
     * không join sang bảng users. Nhật ký giữ lại danh tính lúc hành động xảy ra
     * để còn đọc được sau khi tài khoản bị xoá — join sẽ làm những dòng đó biến
     * mất khỏi kết quả lọc, tức là đúng những dòng đáng soi nhất.
     */
    ...(actorFilter
      ? {
          OR: [
            { actorEmail: { contains: actorFilter } },
            { actorName: { contains: actorFilter } },
          ],
        }
      : {}),
    ...(fromDate || toDate
      ? {
          occurredAt: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {}),
          },
        }
      : {}),
  };

  const [logs, total, actionGroups, entityGroups, grandTotal] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({ by: ['action'], _count: true, orderBy: { action: 'asc' } }),
    prisma.auditLog.groupBy({
      by: ['entityType'],
      _count: true,
      orderBy: { entityType: 'asc' },
    }),
    prisma.auditLog.count(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canExport = user.permissions.has('audit.export');
  const filtered = Boolean(actionFilter || entityFilter || actorFilter || fromDate || toDate);

  return (
    <>
      <PageHeader
        title={t.nav.auditLog}
        subtitle={
          filtered
            ? `${total.toLocaleString('vi-VN')} / ${grandTotal.toLocaleString('vi-VN')} bản ghi khớp bộ lọc`
            : `${grandTotal.toLocaleString('vi-VN')} bản ghi · bảng chỉ ghi thêm, không sửa và không xoá được`
        }
        actions={
          canExport ? (
            <a
              href={`/api/reports/audit-log${queryString(filters)}`}
              className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-slate-soft transition hover:border-ink-500 hover:text-strong"
              title="Xuất đúng bộ lọc đang hiển thị ra tệp CSV"
            >
              Xuất CSV{filtered ? ' (đang lọc)' : ''}
            </a>
          ) : undefined
        }
      />

      {/* Lọc theo hành động */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        <FilterChip
          label="Mọi hành động"
          href={hrefWith(filters, { action: undefined, page: undefined })}
          active={!actionFilter}
        />
        {actionGroups.map((g) => (
          <FilterChip
            key={g.action}
            label={`${g.action} (${g._count})`}
            href={hrefWith(filters, { action: g.action, page: undefined })}
            active={actionFilter === g.action}
            tone={g.action === AUDIT_ACTION.LOGIN_FAILED ? 'danger' : 'neutral'}
          />
        ))}
      </div>

      {/* Lọc theo loại đối tượng */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip
          label="Mọi đối tượng"
          href={hrefWith(filters, { entityType: undefined, page: undefined })}
          active={!entityFilter}
        />
        {entityGroups.map((g) => (
          <FilterChip
            key={g.entityType}
            label={`${g.entityType} (${g._count})`}
            href={hrefWith(filters, { entityType: g.entityType, page: undefined })}
            active={entityFilter === g.entityType}
          />
        ))}
      </div>

      {/* Lọc theo người và theo khoảng ngày — form GET, không cần JavaScript */}
      <form method="get" action="/audit" className="mb-4 flex flex-wrap items-end gap-2">
        {actionFilter ? <input type="hidden" name="action" value={actionFilter} /> : null}
        {entityFilter ? <input type="hidden" name="entityType" value={entityFilter} /> : null}

        <label className="text-tiny text-slate-muted">
          <span className="mb-1 block">Người thực hiện</span>
          <input
            name="actor"
            defaultValue={actorFilter ?? ''}
            placeholder="tên hoặc email"
            className="field !py-1.5 sm:!text-xs sm:w-56"
          />
        </label>
        <label className="text-tiny text-slate-muted">
          <span className="mb-1 block">Từ ngày</span>
          <input
            type="date"
            name="from"
            defaultValue={params.from ?? ''}
            className="field tabular !py-1.5 sm:!text-xs"
          />
        </label>
        <label className="text-tiny text-slate-muted">
          <span className="mb-1 block">Đến ngày</span>
          <input
            type="date"
            name="to"
            defaultValue={params.to ?? ''}
            className="field tabular !py-1.5 sm:!text-xs"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-ink-800 px-3.5 py-2 text-xs font-medium text-slate-soft transition hover:bg-ink-700 hover:text-strong"
        >
          Lọc
        </button>
        {filtered ? (
          <a href="/audit" className="pb-2 text-tiny text-accent-400 transition hover:underline">
            Bỏ hết bộ lọc
          </a>
        ) : null}
      </form>

      <Card className="overflow-hidden">
        {logs.length === 0 ? (
          <EmptyState title="Chưa có bản ghi nào" />
        ) : (
          <ul className="divide-y divide-ink-800">
            {logs.map((log) => {
              const before = parseJsonField<Record<string, unknown>>(log.beforeJson);
              const after = parseJsonField<Record<string, unknown>>(log.afterJson);
              const changed = parseJsonField<string[]>(log.changedFieldsJson);

              return (
                <li key={log.id} className="px-4 py-3.5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {/* WHEN */}
                    <time className="tabular shrink-0 text-xs text-slate-muted">
                      {log.occurredAt.toLocaleString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </time>

                    {/* WHAT */}
                    <span
                      className={`rounded px-1.5 py-px font-mono text-micro font-medium ${actionTone(log.action)}`}
                    >
                      {log.action}
                    </span>
                    <span className="font-mono text-tiny text-slate-muted">{log.entityType}</span>

                    {/* WHO */}
                    <span className="text-sm text-strong">{log.actorName ?? 'hệ thống'}</span>
                    {log.actorEmail ? (
                      <span className="text-xs text-slate-muted">{log.actorEmail}</span>
                    ) : null}
                    {log.actorRole ? (
                      <span className="rounded border border-ink-700 px-1.5 py-px text-micro text-slate-muted">
                        {log.actorRole}
                      </span>
                    ) : null}

                    {log.ipAddress ? (
                      <span className="tabular ml-auto text-tiny text-ink-500">
                        {log.ipAddress}
                      </span>
                    ) : null}
                  </div>

                  {log.entityLabel ? (
                    <p className="mt-1.5 text-sm text-slate-soft">{log.entityLabel}</p>
                  ) : null}

                  {log.note ? (
                    <p className="mt-1 text-xs text-slate-muted">{log.note}</p>
                  ) : null}

                  {/* BEFORE / AFTER */}
                  {before || after ? (
                    <div className="mt-2.5 grid grid-cols-1 gap-2 text-tiny sm:grid-cols-2">
                      {before ? (
                        <div className="rounded-lg border border-down-500/20 bg-down-500/5 p-2.5">
                          <p className="mb-1 font-medium tracking-wide text-down-500">{t.page.before}</p>
                          <DiffList data={before} changed={changed} />
                        </div>
                      ) : (
                        <div />
                      )}
                      {after ? (
                        <div className="rounded-lg border border-up-500/20 bg-up-500/5 p-2.5">
                          <p className="mb-1 font-medium tracking-wide text-up-500">{t.page.after}</p>
                          <DiffList data={after} changed={changed} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm">
          <PageLink
            href={hrefWith(filters, { page: page - 1 })}
            disabled={page <= 1}
            label="← Trước"
          />
          <span className="tabular text-xs text-slate-muted">
            Trang {page} / {totalPages}
          </span>
          <PageLink
            href={hrefWith(filters, { page: page + 1 })}
            disabled={page >= totalPages}
            label={t.page.next}
          />
        </nav>
      ) : null}
    </>
  );
}

/** Bộ lọc đang áp dụng, ở dạng thô như trong URL. */
interface AuditFilters {
  action?: string;
  entityType?: string;
  actor?: string;
  from?: string;
  to?: string;
  page?: number;
}

/** `yyyy-MM-dd` → Date; `endOfDay` để "đến ngày" bao trọn cả ngày đó. */
function parseDay(raw: string | undefined, endOfDay = false): Date | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Query string từ bộ lọc, có thể ghi đè vài khoá.
 *
 * MỘT hàm duy nhất dựng URL cho chip lọc, cho nút phân trang và cho nút xuất.
 * Trước đây mỗi chỗ tự nối chuỗi riêng, nên bấm sang trang 2 sẽ mất bộ lọc — kiểu
 * lỗi luôn xuất hiện khi số tham số tăng từ một lên năm.
 */
function queryString(filters: AuditFilters, overrides: Partial<AuditFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const qs = new URLSearchParams();

  if (merged.action) qs.set('action', merged.action);
  if (merged.entityType) qs.set('entityType', merged.entityType);
  if (merged.actor) qs.set('actor', merged.actor);
  if (merged.from) qs.set('from', merged.from);
  if (merged.to) qs.set('to', merged.to);
  if (merged.page && merged.page > 1) qs.set('page', String(merged.page));

  const s = qs.toString();
  return s ? `?${s}` : '';
}

function hrefWith(filters: AuditFilters, overrides: Partial<AuditFilters> = {}): string {
  return `/audit${queryString(filters, overrides)}`;
}

function DiffList({
  data,
  changed,
}: {
  data: Record<string, unknown>;
  changed: string[] | null;
}) {
  return (
    <dl className="space-y-0.5">
      {Object.entries(data).map(([key, value]) => {
        const isChanged = changed?.includes(key);
        return (
          <div key={key} className="flex gap-2">
            <dt className={`shrink-0 ${isChanged ? 'text-warn-500' : 'text-slate-muted'}`}>
              {key}
            </dt>
            <dd
              className={`tabular min-w-0 break-all ${isChanged ? 'font-medium text-strong' : 'text-slate-soft'}`}
            >
              {value === null ? '—' : String(value)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function actionTone(action: string): string {
  if (action === AUDIT_ACTION.LOGIN_FAILED) return 'bg-down-500/15 text-down-500';
  if (action === AUDIT_ACTION.DELETE || action === AUDIT_ACTION.REJECT) {
    return 'bg-down-500/15 text-down-500';
  }
  if (action === AUDIT_ACTION.APPROVE || action === AUDIT_ACTION.CREATE) {
    return 'bg-up-500/15 text-up-500';
  }
  if (action === AUDIT_ACTION.PERMISSION_CHANGE) return 'bg-ceiling-500/15 text-ceiling-500';
  if (action === AUDIT_ACTION.UPDATE) return 'bg-warn-500/15 text-warn-500';
  return 'bg-ink-800 text-slate-muted';
}

function FilterChip({
  label,
  href,
  active,
  tone = 'neutral',
}: {
  label: string;
  href: string;
  active: boolean;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <a
      href={href}
      className={`rounded-md border px-2 py-1 font-mono text-tiny transition ${
        active
          ? 'border-accent-500/40 bg-accent-500/10 text-accent-400'
          : tone === 'danger'
            ? 'border-ink-700 text-down-500/80 hover:border-down-500/40'
            : 'border-ink-700 text-slate-muted hover:border-ink-600 hover:text-slate-soft'
      }`}
    >
      {label}
    </a>
  );
}

function PageLink({
  href,
  disabled,
  label,
}: {
  href: string;
  disabled: boolean;
  label: string;
}) {
  if (disabled) {
    return <span className="cursor-not-allowed text-xs text-ink-500">{label}</span>;
  }
  return (
    <a
      href={href}
      className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-slate-soft transition hover:border-ink-600 hover:text-strong"
    >
      {label}
    </a>
  );
}
