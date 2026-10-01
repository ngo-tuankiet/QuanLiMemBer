import 'server-only';

/**
 * DANH SÁCH CỔ TỨC ĐANG CHỜ GHI NHẬN — tính ra mỗi lần xem, không lưu sẵn.
 *
 * Một MỤC là một cặp (sự kiện quyền × tài khoản chứng khoán) thoả cả năm điều:
 *
 *   1. Đã tới ngày GDKHQ. Từ ngày đó số cổ phiếu được hưởng đã chốt — mua thêm cũng
 *      không được, bán đi cũng không mất.
 *   2. GDKHQ không sớm hơn ngày tài khoản vào hệ thống. Xem `ngayVaoHeThong`.
 *   3. Tài khoản giữ > 0 cổ phiếu trước ngày GDKHQ.
 *   4. Số nhận được > 0 sau khi làm tròn xuống (giữ 1 CP × 26% = 0 CP → không hiện).
 *   5. Chưa có dòng `corporate_event_resolutions` — chưa ghi, chưa bỏ qua.
 *
 * VÌ SAO KHÔNG LƯU SẴN: khối lượng hưởng phụ thuộc lệnh của tài khoản, và lệnh sửa
 * được (quản trị sửa khối lượng, sửa ngày khớp, xoá lệnh nhập sai). Lưu sẵn thì mỗi lần
 * sửa để lại một con số "được hưởng" không ai cập nhật lại — cùng lý do §23 không lưu
 * lãi/lỗ.
 */

import { prisma } from '@/lib/prisma';
import { tradingDayString, toTradingDate } from '@/lib/trading-date';
import { soCoPhieuNhan } from '@/dividends/classify';
import { dieuKienChuTaiKhoan, type PhamViCoTuc } from '@/dividends/scope';
import {
  BROKER,
  BROKER_LABEL_VI,
  CORPORATE_EVENT_KIND,
  TRADE_STATUS,
  TRANSACTION_TYPE,
  type Broker,
  type CorporateEventKind,
} from '@/lib/enums';

export interface MucChoGhi {
  eventId: string;
  kind: CorporateEventKind;
  titleVi: string;
  stockId: string;
  symbol: string;
  companyName: string;
  exRightDate: Date;
  recordDate: Date | null;
  payoutDate: Date | null;
  cashPerShare: bigint | null;
  ratioE9: bigint | null;

  accountId: string;
  accountLabel: string;
  ownerId: string;
  ownerName: string;
  ownerTeamId: string | null;
  ownerTeamName: string | null;

  /** Cổ phiếu tài khoản giữ trước ngày GDKHQ. */
  eligibleQuantity: number;
  /** Tiền dự kiến (cổ tức tiền mặt). 0 với các loại khác. */
  expectedCash: bigint;
  /** Cổ phiếu dự kiến nhận — hoặc được quyền mua, với RIGHTS_ISSUE. */
  expectedShares: number;
  /**
   * Cổ tức tiền mặt mà ngày trả CÒN Ở TƯƠNG LAI.
   *
   * Mục vẫn hiện (người dùng chọn "hiện từ ngày GDKHQ") nhưng chưa ghi được: ghi bây
   * giờ là cộng vào số dư một khoản tiền chưa về, và số dư lệch sao kê của sàn cho tới
   * đúng ngày trả.
   */
  choTienVe: boolean;
}

/** Nhãn tài khoản: "VPS · V75640". */
function nhanTaiKhoan(a: { broker: string; brokerOther: string | null; accountNo: string }): string {
  const san =
    a.broker === BROKER.OTHER
      ? (a.brokerOther ?? 'Khác')
      : (BROKER_LABEL_VI[a.broker as Broker] ?? a.broker);
  return `${san} · ${a.accountNo}`;
}

/**
 * NGÀY TÀI KHOẢN VÀO HỆ THỐNG — mốc quét ngược, theo quyết định của người dùng.
 *
 * Phần lớn lệnh hiện có (54/79) là VỊ THẾ KHAI SẴN lúc đưa tài khoản vào hệ thống,
 * mang ngày mua trong quá khứ. Số lượng khai lấy từ sao kê, nên đã GỒM các đợt thưởng
 * trước đó. Tính ngược từ ngày mua thì hệ thống gợi ý ghi lại những đợt đã nằm sẵn
 * trong số lượng khai — ví dụ SSI thưởng 20% tháng 8 — và cổ phiếu bị cộng hai lần.
 *
 * Lấy `broker_accounts.createdAt` (lúc khai tài khoản), không lấy ngày lệnh đầu tiên:
 * `executedAt` của vị thế khai sẵn là ngày mua trong quá khứ, chính là con số gây lỗi.
 */
function ngayVaoHeThong(a: { createdAt: Date }): string {
  return tradingDayString(a.createdAt);
}

export async function computePendingCorporateEvents(
  pv: PhamViCoTuc,
  opts: { now?: Date; onlyAccountId?: string; onlyEventId?: string } = {},
): Promise<MucChoGhi[]> {
  const now = opts.now ?? new Date();
  const homNay = tradingDayString(now);

  const taiKhoan = await prisma.brokerAccount.findMany({
    where: {
      // Tài khoản đã đóng không nhận tiền về nữa, và form cổ tức từ chối nó.
      isActive: true,
      user: dieuKienChuTaiKhoan(pv),
      ...(opts.onlyAccountId ? { id: opts.onlyAccountId } : {}),
    },
    select: {
      id: true,
      broker: true,
      brokerOther: true,
      accountNo: true,
      createdAt: true,
      userId: true,
      user: {
        select: { fullName: true, teamId: true, team: { select: { nameVi: true } } },
      },
    },
  });
  if (taiKhoan.length === 0) return [];

  const somNhat = taiKhoan.reduce(
    (m, a) => (ngayVaoHeThong(a) < m ? ngayVaoHeThong(a) : m),
    ngayVaoHeThong(taiKhoan[0]!),
  );

  const suKien = await prisma.corporateEvent.findMany({
    where: {
      exRightDate: { gte: toTradingDate(somNhat), lte: toTradingDate(homNay) },
      ...(opts.onlyEventId ? { id: opts.onlyEventId } : {}),
    },
    orderBy: [{ exRightDate: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      kind: true,
      titleVi: true,
      stockId: true,
      exRightDate: true,
      recordDate: true,
      payoutDate: true,
      cashPerShare: true,
      ratioE9: true,
      stock: { select: { symbol: true, companyName: true } },
    },
  });
  if (suKien.length === 0) return [];

  const idTk = taiKhoan.map((a) => a.id);
  const idMa = [...new Set(suKien.map((e) => e.stockId))];

  const [lenh, daXuLy] = await Promise.all([
    prisma.trade.findMany({
      where: {
        brokerAccountId: { in: idTk },
        stockId: { in: idMa },
        status: TRADE_STATUS.EXECUTED,
      },
      select: {
        brokerAccountId: true,
        stockId: true,
        transactionType: true,
        quantity: true,
        executedAt: true,
      },
    }),
    prisma.corporateEventResolution.findMany({
      where: { brokerAccountId: { in: idTk }, eventId: { in: suKien.map((e) => e.id) } },
      select: { eventId: true, brokerAccountId: true },
    }),
  ]);

  const xong = new Set(daXuLy.map((r) => `${r.eventId}|${r.brokerAccountId}`));

  /*
   * LỆNH NHÓM THEO (tài khoản, mã), mỗi lệnh mang sẵn NGÀY THEO GIỜ VIỆT NAM.
   *
   * So ngày dạng chuỗi `YYYY-MM-DD` theo giờ Việt Nam, KHÔNG so thời điểm. Một lệnh
   * khai "ngày 21/09" lưu thành 21/09 00:00 +07 = 20/09 17:00 UTC; so thẳng với GDKHQ
   * 21/09 00:00 UTC thì lệnh đó bị tính là mua TRƯỚC ngày GDKHQ — được hưởng một đợt
   * mà ngoài đời nó không được hưởng.
   */
  const theoCap = new Map<string, { ngay: string; dau: number; kl: number }[]>();
  for (const t of lenh) {
    const k = `${t.brokerAccountId}|${t.stockId}`;
    const ds = theoCap.get(k) ?? [];
    ds.push({
      ngay: tradingDayString(t.executedAt),
      dau: t.transactionType === TRANSACTION_TYPE.BUY ? 1 : -1,
      kl: t.quantity,
    });
    theoCap.set(k, ds);
  }

  const ra: MucChoGhi[] = [];

  for (const e of suKien) {
    const ngayGd = tradingDayString(e.exRightDate);
    const kind = e.kind as CorporateEventKind;

    for (const a of taiKhoan) {
      if (ngayGd < ngayVaoHeThong(a)) continue;
      if (xong.has(`${e.id}|${a.id}`)) continue;

      const ds = theoCap.get(`${a.id}|${e.stockId}`);
      if (!ds) continue;

      // Mua TRƯỚC ngày GDKHQ mới được hưởng; mua đúng ngày GDKHQ thì không.
      const kl = ds.reduce((s, x) => (x.ngay < ngayGd ? s + x.dau * x.kl : s), 0);
      if (kl <= 0) continue;

      const laTien = kind === CORPORATE_EVENT_KIND.CASH_DIVIDEND;
      const tien = laTien && e.cashPerShare ? e.cashPerShare * BigInt(kl) : 0n;
      const cp = !laTien && e.ratioE9 ? soCoPhieuNhan(kl, e.ratioE9) : 0;
      if (tien <= 0n && cp <= 0) continue;

      ra.push({
        eventId: e.id,
        kind,
        titleVi: e.titleVi,
        stockId: e.stockId,
        symbol: e.stock.symbol,
        companyName: e.stock.companyName,
        exRightDate: e.exRightDate,
        recordDate: e.recordDate,
        payoutDate: e.payoutDate,
        cashPerShare: e.cashPerShare,
        ratioE9: e.ratioE9,
        accountId: a.id,
        accountLabel: nhanTaiKhoan(a),
        ownerId: a.userId,
        ownerName: a.user.fullName,
        ownerTeamId: a.user.teamId,
        ownerTeamName: a.user.team?.nameVi ?? null,
        eligibleQuantity: kl,
        expectedCash: tien,
        expectedShares: cp,
        choTienVe:
          laTien && e.payoutDate !== null && tradingDayString(e.payoutDate) > homNay,
      });
    }
  }

  return ra;
}

/** Mục đã BỎ QUA trong phạm vi — để hoàn tác được khi bấm nhầm. */
export async function computeDismissedCorporateEvents(pv: PhamViCoTuc, take = 30) {
  return prisma.corporateEventResolution.findMany({
    where: { status: 'DISMISSED', brokerAccount: { user: dieuKienChuTaiKhoan(pv) } },
    orderBy: { createdAt: 'desc' },
    take,
    select: {
      id: true,
      reason: true,
      createdAt: true,
      resolvedBy: { select: { fullName: true } },
      event: {
        select: { kind: true, titleVi: true, exRightDate: true, stock: { select: { symbol: true } } },
      },
      brokerAccount: {
        select: {
          broker: true,
          brokerOther: true,
          accountNo: true,
          userId: true,
          user: { select: { fullName: true, teamId: true } },
        },
      },
    },
  });
}

export { nhanTaiKhoan };
