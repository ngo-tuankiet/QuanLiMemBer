import Link from 'next/link';
import { Card } from '@/components/ui';
import { BoQuaForm, HoanTacForm, QuetLaiButton } from '@/components/CorporateEventButtons';
import { formatVnd } from '@/lib/money';
import { formatTradingDate } from '@/lib/trading-date';
import { CORPORATE_EVENT_KIND, CORPORATE_EVENT_KIND_LABEL_VI } from '@/lib/enums';
import type { MucChoGhi } from '@/dividends/pending';

/** Tỷ lệ × 1e9 → "26,04%". Chỉ để hiển thị; mọi phép tính dùng số nguyên. */
function phanTram(ratioE9: bigint | null): string {
  if (!ratioE9) return '—';
  const pct = Number(ratioE9) / 10_000_000;
  return `${pct.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`;
}

export interface LanQuet {
  finishedAt: Date | null;
  startedAt: Date;
  status: string;
  symbolsRequested: number;
  symbolsFailed: number;
  errorMessage: string | null;
}

export interface MucDaBoQua {
  id: string;
  symbol: string;
  titleVi: string;
  accountLabel: string;
  ownerName: string;
  reason: string | null;
  resolvedBy: string;
  createdAt: Date;
  hoanTacDuoc: boolean;
}

/**
 * CỔ TỨC ĐANG CHỜ GHI NHẬN — khối đầu trang Ghi nhận cổ tức.
 *
 * MỖI DÒNG LÀ MỘT (SỰ KIỆN × TÀI KHOẢN), không gộp theo mã. Cùng một đợt FPT thưởng
 * 10% rơi vào ba tài khoản là ba việc phải làm — mỗi tài khoản ghi riêng, số được
 * hưởng khác nhau, và có thể do ba người khác nhau ghi.
 *
 * Mục biến mất khi được ghi hoặc bỏ qua — không có trạng thái "đã xem" hay "để sau".
 */
export function PendingDividends({
  items,
  dismissed,
  hienChuTaiKhoan,
  ghiDuoc,
  viewerId,
  lanQuet,
  dangQuet,
  quetDuoc,
}: {
  items: MucChoGhi[];
  dismissed: MucDaBoQua[];
  /** Người xem thấy mục của người khác → hiện cột chủ tài khoản. */
  hienChuTaiKhoan: boolean;
  /** Quyết định ghi được hay không cho từng mục, tính sẵn ở trang. */
  ghiDuoc: (m: MucChoGhi) => boolean;
  viewerId: string;
  lanQuet: LanQuet | null;
  dangQuet: boolean;
  quetDuoc: boolean;
}) {
  const tongTien = items.reduce((s, m) => s + (m.choTienVe ? 0n : m.expectedCash), 0n);
  const soChoTien = items.filter((m) => m.choTienVe).length;

  return (
    <Card className="mb-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-strong">Cổ tức đang chờ ghi nhận</h2>
          <p className="mt-0.5 text-tiny text-slate-muted">
            Quét từ VNStock mỗi ngày. Mục hiện từ ngày giao dịch không hưởng quyền (GDKHQ) và biến
            mất khi được ghi nhận hoặc bỏ qua.
          </p>
        </div>
        <div className="text-right">
          <p className="text-tiny text-slate-muted">
            {dangQuet
              ? 'Đang quét…'
              : lanQuet
                ? `Quét lần cuối ${formatTradingDate(lanQuet.finishedAt ?? lanQuet.startedAt)} · ${
                    lanQuet.symbolsRequested - lanQuet.symbolsFailed
                  }/${lanQuet.symbolsRequested} mã`
                : 'Chưa quét lần nào'}
          </p>
          {lanQuet && lanQuet.symbolsFailed > 0 && lanQuet.errorMessage ? (
            <p className="mt-0.5 max-w-xs text-micro text-warn-500">{lanQuet.errorMessage}</p>
          ) : null}
          {quetDuoc ? <div className="mt-1.5 flex justify-end"><QuetLaiButton /></div> : null}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-ink-800 px-3 py-4 text-center text-xs text-slate-muted">
          {lanQuet
            ? 'Không có đợt chia nào đang chờ ghi nhận.'
            : 'Chưa có dữ liệu sự kiện quyền — cần quét ít nhất một lần.'}
        </p>
      ) : (
        <>
          <p className="mt-3 text-tiny text-slate-muted">
            <span className="text-strong">{items.length}</span> mục
            {tongTien > 0n ? (
              <>
                {' · '}tiền mặt ghi được ngay <span className="tabular text-up-500">{formatVnd(tongTien)}</span>
              </>
            ) : null}
            {soChoTien > 0 ? ` · ${soChoTien} mục chờ tiền về` : null}
          </p>

          <div className="mt-2 overflow-x-auto rounded-lg border border-ink-700">
            <table className="w-full min-w-[60rem] text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-left text-xs text-slate-muted">
                  <th className="px-3 py-2 font-medium">Mã</th>
                  <th className="px-3 py-2 font-medium">Đợt chia</th>
                  <th className="px-3 py-2 font-medium">GDKHQ</th>
                  <th className="px-3 py-2 font-medium">Tài khoản</th>
                  <th className="px-3 py-2 text-right font-medium">KL hưởng</th>
                  <th className="px-3 py-2 text-right font-medium">Dự kiến nhận</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {items.map((m) => {
                  const ghi = ghiDuoc(m);
                  const laQuyenMua = m.kind === CORPORATE_EVENT_KIND.RIGHTS_ISSUE;
                  const laTien = m.kind === CORPORATE_EVENT_KIND.CASH_DIVIDEND;
                  return (
                    <tr key={`${m.eventId}|${m.accountId}`} className="border-b border-ink-800 align-top last:border-0">
                      <td className="px-3 py-2">
                        <span className="font-mono font-semibold text-strong" title={m.companyName}>
                          {m.symbol}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="block text-xs text-slate-soft">
                          {CORPORATE_EVENT_KIND_LABEL_VI[m.kind]}{' '}
                          <span className="tabular text-strong">
                            {laTien && m.cashPerShare ? `${formatVnd(m.cashPerShare)}/CP` : phanTram(m.ratioE9)}
                          </span>
                        </span>
                        <span className="block text-micro text-ink-500" title={m.titleVi}>
                          {m.titleVi.length > 60 ? `${m.titleVi.slice(0, 60)}…` : m.titleVi}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className="tabular text-slate-soft">{formatTradingDate(m.exRightDate)}</span>
                        {laTien && m.payoutDate ? (
                          <span className="block text-micro text-ink-500">
                            trả {formatTradingDate(m.payoutDate)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className="block text-slate-soft">{m.accountLabel}</span>
                        {hienChuTaiKhoan ? (
                          <span className="block text-micro text-slate-muted">
                            {m.ownerName}
                            {m.ownerTeamName ? ` · ${m.ownerTeamName}` : ''}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="tabular text-slate-soft">
                          {m.eligibleQuantity.toLocaleString('vi-VN')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {laTien ? (
                          <span className="tabular text-up-500">{formatVnd(m.expectedCash)}</span>
                        ) : (
                          <span className="tabular text-strong">
                            {m.expectedShares.toLocaleString('vi-VN')} CP
                          </span>
                        )}
                        {laQuyenMua ? (
                          <span className="block text-micro text-slate-muted">được quyền mua</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        {!ghi ? (
                          <span className="text-tiny text-ink-500">chỉ xem</span>
                        ) : (
                          <div className="flex flex-wrap items-start gap-1.5">
                            {laQuyenMua ? (
                              /*
                                NHẬP LỆNH MUA chỉ chính chủ: form nhập lệnh không có chế độ
                                đặt lệnh hộ, và "ghi hộ" mà người dùng cho phép là cổ tức —
                                việc doanh nghiệp đã làm — không phải một quyết định mua.
                              */
                              m.ownerId === viewerId ? (
                                <Link
                                  href="/transactions/new"
                                  className="rounded-md bg-accent-600 px-2 py-1 text-tiny font-medium text-white hover:bg-accent-500"
                                >
                                  Nhập lệnh mua
                                </Link>
                              ) : null
                            ) : m.choTienVe && m.payoutDate ? (
                              <span className="rounded-md border border-ink-700 px-2 py-1 text-tiny text-slate-muted">
                                Tiền về {formatTradingDate(m.payoutDate)}
                              </span>
                            ) : (
                              <Link
                                href={`/transactions/dividend?event=${m.eventId}&account=${m.accountId}#form-co-tuc`}
                                className="rounded-md bg-accent-600 px-2 py-1 text-tiny font-medium text-white hover:bg-accent-500"
                              >
                                {m.ownerId === viewerId ? 'Ghi nhận' : 'Ghi hộ'}
                              </Link>
                            )}
                            <BoQuaForm
                              eventId={m.eventId}
                              accountId={m.accountId}
                              goiY={
                                laQuyenMua
                                  ? ['Đã mua theo quyền, đã nhập lệnh', 'Không thực hiện quyền mua']
                                  : ['Sàn báo tài khoản không được hưởng', 'Đã ghi tay trước đó']
                              }
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {dismissed.length > 0 ? (
        <details className="mt-4 rounded-lg border border-ink-700">
          <summary className="cursor-pointer px-3 py-2 text-xs text-slate-muted hover:text-slate-soft">
            Đã bỏ qua ({dismissed.length})
          </summary>
          <ul className="divide-y divide-ink-800 border-t border-ink-700">
            {dismissed.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="text-xs text-slate-soft">
                  <span className="font-mono font-semibold text-strong">{d.symbol}</span> · {d.titleVi} ·{' '}
                  {d.accountLabel}
                  {hienChuTaiKhoan ? ` · ${d.ownerName}` : ''}
                  <span className="block text-micro text-slate-muted">
                    {d.reason} — {d.resolvedBy}, {d.createdAt.toLocaleDateString('vi-VN')}
                  </span>
                </span>
                {d.hoanTacDuoc ? <HoanTacForm resolutionId={d.id} /> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}
