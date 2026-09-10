import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { getDict } from '@/i18n';
import { prisma } from '@/lib/prisma';
import { Card, PageHeader } from '@/components/ui';
import { SectorForms } from './SectorForms';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.nav.sectors };
}

/**
 * Ngành & phân ngành (§7, §15) — Phase 03.
 *
 * "Ngành/phân ngành nên được chuẩn hoá để phục vụ dashboard." Cây hai cấp
 * Sector → Industry là nguồn duy nhất cho Sector Exposure ở §15, nên nó phải là
 * master data chứ không phải chuỗi tự do trên từng mã.
 */
export default async function SectorsPage() {
  const user = await requirePagePermission('sector.view');
  const { t } = await getDict();

  const sectors = await prisma.sector.findMany({
    orderBy: { sortOrder: 'asc' },
    include: {
      industries: {
        orderBy: { sortOrder: 'asc' },
        include: { _count: { select: { stocks: true } } },
      },
      _count: { select: { stocks: true } },
    },
  });

  const canManage = user.permissions.has('sector.manage');
  const totalStocks = sectors.reduce((s, x) => s + x._count.stocks, 0);
  const totalIndustries = sectors.reduce((s, x) => s + x.industries.length, 0);

  return (
    <>
      <PageHeader
        title={t.nav.sectors}
        subtitle={`${sectors.length} ngành · ${totalIndustries} phân ngành · ${totalStocks} mã đã phân loại`}
      />

      {canManage ? (
        <Card className="mb-4 p-5">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-strong">
              Thêm ngành hoặc phân ngành
            </summary>
            <div className="mt-4 border-t border-ink-800 pt-4">
              <SectorForms
                sectors={sectors.map((s) => ({ id: s.id, label: s.nameVi }))}
              />
            </div>
          </details>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {sectors.map((sector) => (
          <Card key={sector.id} className="overflow-hidden">
            <div
              className="flex items-baseline justify-between gap-3 border-b border-ink-800 px-5 py-3.5"
              style={{ borderLeft: `3px solid ${sector.colorHex ?? 'transparent'}` }}
            >
              <div>
                <h2 className="text-sm font-semibold text-strong">{sector.nameVi}</h2>
                <p className="mt-0.5 font-mono text-tiny text-slate-muted">
                  {sector.code} · {sector.name}
                </p>
              </div>
              <p className="tabular shrink-0 text-xs text-slate-muted">
                {sector._count.stocks} mã
              </p>
            </div>

            {sector.industries.length === 0 ? (
              <p className="px-5 py-4 text-xs text-ink-500">Chưa có phân ngành.</p>
            ) : (
              <ul className="divide-y divide-ink-800">
                {sector.industries.map((industry) => (
                  <li
                    key={industry.id}
                    className="flex items-baseline justify-between gap-3 px-5 py-2"
                  >
                    <div>
                      <span className="text-sm text-slate-soft">{industry.nameVi}</span>
                      <span className="ml-2 font-mono text-micro text-ink-500">
                        {industry.code}
                      </span>
                    </div>
                    {/* Không còn là link: trang danh sách mã đã được bỏ. */}
                    <span className="tabular shrink-0 text-xs text-slate-muted">
                      {industry._count.stocks} mã
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-slate-muted">
        Bộ ngành khởi tạo theo chuẩn GICS rút gọn, đặt tên tiếng Việt để hiển thị trực tiếp trên
        {t.dash.sectorExposure} (§15). Khi Phase 07 đồng bộ danh mục mã từ VNStock, việc gán ngành cho mã
        mới vẫn phải chọn từ cây này — hệ thống không tạo ngành tự động từ dữ liệu ngoài.
      </p>
    </>
  );
}
