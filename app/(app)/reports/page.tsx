import type { Metadata } from 'next';
import { requirePagePermission } from '@/auth/guards';
import { getDict } from '@/i18n';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { REPORTS } from '@/reports/catalog';
import { estimateRowCount } from '@/reports/build';
import { PORTFOLIO_STATUS } from '@/lib/enums';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getDict();
  return { title: t.nav.reports };
}

/**
 * REPORTS (§20) — Phase 10.
 *
 * Mỗi báo cáo hiện TRƯỚC KHI TẢI: cột sẽ có, số dòng ước tính, và quyền cần có.
 * Người dùng không phải tải về mới biết tệp có đúng thứ mình cần — và với những
 * báo cáo hàng chục nghìn dòng thì đó là điều đáng biết trước.
 *
 * Khoảng ngày và kỳ là ô nhập THẬT, gửi bằng GET tới route xuất tệp. Không dùng
 * Server Action ở đây: trình duyệt phải nhận được phản hồi có
 * `Content-Disposition: attachment` để bật hộp thoại tải, mà điều đó chỉ có ở một
 * điều hướng bình thường. Một form GET là cách đơn giản nhất và không cần dòng
 * JavaScript nào.
 */

const PERIOD_OPTIONS = [
  { value: 'YTD', label: 'Từ đầu năm' },
  { value: '1W', label: '1 tuần' },
  { value: '1M', label: '1 tháng' },
  { value: '3M', label: '3 tháng' },
  { value: '6M', label: '6 tháng' },
  { value: 'ALL', label: 'Toàn bộ' },
];

export default async function ReportsPage() {
  const user = await requirePagePermission('report.view');
  const { t } = await getDict();

  const portfolios = await prisma.portfolio.findMany({
    where: { status: PORTFOLIO_STATUS.ACTIVE },
    orderBy: { createdAt: 'asc' },
    select: { id: true, code: true, name: true, nameVi: true },
  });

  const defaultPortfolio = portfolios[0];

  if (!defaultPortfolio) {
    return (
      <>
        <PageHeader title={t.nav.reports} />
        <Card>
          <EmptyState
            title="Chưa có danh mục nào"
            hint="Chạy npm run db:seed để khởi tạo danh mục mặc định."
          />
        </Card>
      </>
    );
  }

  // Số dòng ước tính — tính một lần cho danh mục mặc định, chỉ để hiện gợi ý.
  const counts = new Map<string, number | null>(
    await Promise.all(
      REPORTS.map(
        async (r) => [r.code, await estimateRowCount(r.code, defaultPortfolio.id)] as const,
      ),
    ),
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title={t.nav.reports}
        subtitle={`1 tệp tổng (.xlsx) · ${REPORTS.length} báo cáo lẻ (.csv) · mỗi lần xuất đều được ghi vào ${t.nav.auditLog}`}
      />

      {/* ---------------------------------------------------------------- */}
      {/* TỆP TỔNG — đứng riêng trên cùng, không xếp lẫn 9 báo cáo lẻ.      */}
      {/*                                                                  */}
      {/* Nó khác loại: một workbook Excel nhiều sheet gồm CẢ chín báo cáo  */}
      {/* cộng master data, dùng để lưu trữ. Xếp nó thành "báo cáo thứ 10"  */}
      {/* sẽ khiến người ta tải chín tệp lẻ rồi mới thấy có cái gộp sẵn.    */}
      {/* ---------------------------------------------------------------- */}
      {user.permissions.has('report.export') ? (
        <Card className="mb-4 border-accent-500/30 bg-accent-500/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-strong">Tệp tổng để lưu trữ</h2>
                <span className="rounded bg-accent-600/20 px-1.5 py-px text-micro font-medium text-accent-400">
                  XLSX · nhiều sheet
                </span>
              </div>
              <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-slate-muted">
                Một tệp Excel duy nhất gồm{' '}
                <span className="text-slate-soft">cả {REPORTS.length} báo cáo bên dưới</span>, mỗi
                cái một sheet, cộng thêm{' '}
                <span className="text-slate-soft">9 sheet master data</span> — mã chứng khoán,
                ngành, chiến lược, người dùng, nhóm, phòng ban, ngưỡng rủi ro, cấu hình, danh
                mục. Có master data thì tệp còn giải mã được về sau; thiếu nó thì phần số liệu
                chỉ còn là một mớ mã không tra được.
              </p>
              <ul className="mt-2 space-y-0.5 text-tiny text-ink-500">
                <li>
                  Sheet đầu là <span className="text-slate-muted">Thông tin xuất</span>: ai xuất,
                  lúc nào, khoảng ngày nào, mỗi sheet bao nhiêu dòng.
                </li>
                <li>
                  Số đúng kiểu số — tiền định dạng <span className="font-mono">#,##0</span>, ngày
                  là ngày thật, nên cộng và lọc được ngay trong Excel.
                </li>
                <li>
                  Vị thế và tỷ trọng là <span className="text-slate-muted">ảnh chụp lúc xuất</span>;
                  giao dịch, dòng vốn, cảnh báo và audit log lọc theo khoảng ngày.
                </li>
                {!user.permissions.has('audit.export') ? (
                  <li className="text-warn-500">
                    Tài khoản này thiếu quyền <span className="font-mono">audit.export</span> nên
                    tệp sẽ KHÔNG có sheet {t.nav.auditLog}.
                  </li>
                ) : null}
              </ul>
            </div>
          </div>

          <form
            action="/api/reports/archive"
            method="get"
            className="mt-4 flex flex-wrap items-end gap-2"
          >
            {portfolios.length > 1 ? (
              <label className="text-tiny text-slate-muted">
                <span className="mb-1 block">Danh mục</span>
                <select name="portfolioId" className="field !py-1.5 sm:!text-xs">
                  {portfolios.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.nameVi ?? p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="text-tiny text-slate-muted">
              <span className="mb-1 block">Từ ngày</span>
              <input type="date" name="from" max={today} className="field tabular !py-1.5 sm:!text-xs" />
            </label>
            <label className="text-tiny text-slate-muted">
              <span className="mb-1 block">Đến ngày</span>
              <input type="date" name="to" max={today} className="field tabular !py-1.5 sm:!text-xs" />
            </label>

            <button
              type="submit"
              className="rounded-lg bg-accent-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-accent-500"
            >
              Tải tệp tổng (.xlsx)
            </button>

            <span className="pb-2 text-tiny text-ink-500">
              Để trống ngày = toàn bộ lịch sử
            </span>
          </form>
        </Card>
      ) : null}

      <Card className="mb-4 p-4">
        <h2 className="text-sm font-semibold text-strong">Về định dạng tệp</h2>
        <ul className="mt-2 space-y-1 text-xs text-slate-muted">
          <li>
            <span className="text-slate-soft">Tiền tệ</span> ghi bằng số nguyên đồng, không dấu
            phân cách nghìn — cộng trừ trong Excel là chính xác, không phụ thuộc vùng miền của
            máy.
          </li>
          <li>
            <span className="text-slate-soft">Ngày</span> theo dạng{' '}
            <code className="font-mono">yyyy-MM-dd</code>, giờ theo múi giờ Việt Nam.
          </li>
          <li>
            <span className="text-slate-soft">Bảng mã</span> UTF-8 kèm BOM để Excel trên Windows
            đọc đúng tiếng Việt.
          </li>
          <li>
            <span className="text-slate-soft">Dấu phân cách</span> là dấu phẩy. Nếu Excel dồn hết
            vào một cột, dùng Data → Text to Columns và chọn Comma.
          </li>
        </ul>
      </Card>

      <h2 className="mt-6 mb-3 text-sm font-semibold text-strong">Báo cáo lẻ</h2>

      <div className="space-y-3">
        {REPORTS.map((report) => {
          const allowed = user.permissions.has(report.permission);
          const rowCount = counts.get(report.code);

          return (
            <Card key={report.code} className="p-4">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h2 className="text-sm font-semibold text-strong">{report.nameVi}</h2>
                <code className="rounded bg-ink-850 px-1.5 py-px font-mono text-tiny text-slate-muted">
                  {report.code}
                </code>
                {rowCount !== null && rowCount !== undefined ? (
                  <span className="tabular text-tiny text-slate-muted">
                    ~{rowCount.toLocaleString('vi-VN')} dòng
                  </span>
                ) : null}
                {!allowed ? (
                  <span className="rounded border border-ink-600 px-1.5 py-px text-micro text-ink-500">
                    cần quyền {report.permission}
                  </span>
                ) : null}
              </div>

              <p className="mt-1 max-w-3xl text-xs text-slate-muted">{report.description}</p>

              <details className="mt-2">
                <summary className="cursor-pointer text-tiny text-slate-muted hover:text-slate-soft">
                  {report.columns.length} cột
                </summary>
                <p className="mt-1.5 font-mono text-tiny break-words text-ink-500">
                  {report.columns.join(', ')}
                </p>
              </details>

              {allowed ? (
                <form
                  action={`/api/reports/${report.code}`}
                  method="get"
                  className="mt-3 flex flex-wrap items-end gap-2"
                >
                  {report.params.includes('portfolio') && portfolios.length > 1 ? (
                    <label className="text-tiny text-slate-muted">
                      <span className="mb-1 block">Danh mục</span>
                      <select name="portfolioId" className="field !py-1.5 sm:!text-xs">
                        {portfolios.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} — {p.nameVi ?? p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  {report.params.includes('dateRange') ? (
                    <>
                      <label className="text-tiny text-slate-muted">
                        <span className="mb-1 block">Từ ngày</span>
                        <input
                          type="date"
                          name="from"
                          max={today}
                          className="field tabular !py-1.5 sm:!text-xs"
                        />
                      </label>
                      <label className="text-tiny text-slate-muted">
                        <span className="mb-1 block">Đến ngày</span>
                        <input
                          type="date"
                          name="to"
                          max={today}
                          className="field tabular !py-1.5 sm:!text-xs"
                        />
                      </label>
                    </>
                  ) : null}

                  {report.params.includes('period') ? (
                    <label className="text-tiny text-slate-muted">
                      <span className="mb-1 block">Kỳ</span>
                      <select name="period" className="field !py-1.5 sm:!text-xs">
                        {PERIOD_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <button
                    type="submit"
                    className="rounded-lg bg-accent-600 px-3.5 py-2 text-xs font-medium text-white transition hover:bg-accent-500"
                  >
                    Tải CSV
                  </button>

                  {report.params.includes('dateRange') ? (
                    <span className="pb-2 text-tiny text-ink-500">
                      Để trống ngày = lấy toàn bộ
                    </span>
                  ) : null}
                </form>
              ) : null}
            </Card>
          );
        })}
      </div>
    </>
  );
}
