import 'server-only';

/**
 * BÁO CÁO VỐN & LỢI NHUẬN THEO TÀI KHOẢN — đúng mẫu `baocaoChungKhoan_2026.xlsx` của
 * người dùng (sheet "2026-Thang9").
 *
 * Mỗi tài khoản chứng khoán một dòng:
 *
 *   Vốn ròng từ ngày   = TÀI SẢN RÒNG cuối ngày trước "từ ngày"
 *   Nộp / Rút          = nạp / rút vốn trong kỳ
 *   Vốn ròng đến ngày  = TÀI SẢN RÒNG cuối ngày "đến ngày"
 *   Profit             = Đến − Từ − Nộp + Rút
 *   Tỷ lệ sinh lời     = Profit / (Từ + Nộp)
 *
 * TÀI SẢN RÒNG (quyết định của người dùng) = cổ phiếu đang giữ × giá đóng cửa của ngày
 * đó + tiền mặt còn trong tài khoản. Chọn số này chứ không phải "vốn góp ròng" vì với
 * vốn góp ròng thì Profit luôn bằng 0 (Đến = Từ + Nộp − Rút).
 *
 * MỌI SỐ TÍNH LẠI TỪ SỔ, không đọc số dư lưu sẵn — không bảng nào lưu số dư:
 *   - khối lượng = Σ mua − Σ bán của lệnh khớp tới hết ngày đó
 *   - tiền mặt   = Σ dòng vốn đã xác nhận (theo dấu) − Σ chi mua + Σ thu bán, tới hết ngày đó
 * Cổ tức, lãi tiền gửi, thu/chi khác nằm trong tiền mặt và vì vậy vào Profit — đúng: đó là
 * tiền tài khoản làm ra, không phải tiền nộp thêm.
 */

import { prisma } from '@/lib/prisma';
import {
  BROKER,
  CAPITAL_FLOW_SIGN,
  CAPITAL_FLOW_STATUS,
  CAPITAL_FLOW_TYPE,
  COUNTED_TRADE_STATUS,
  TRANSACTION_TYPE,
  type CapitalFlowType,
} from '@/lib/enums';
import { netAmount } from '@/lib/money';
// Giá đầu/cuối kỳ dùng chung với lãi/lỗ trong kỳ của Dashboard — hai nơi phải định giá như nhau.
import { giaCuoiNgay as giaTaiNgay } from '@/domain/portfolio-engine';

/** Tên sàn ngắn, như người dùng viết trong mẫu (TCBS, VPBS, SSI, VietCap…). */
const SAN_NGAN: Record<string, string> = {
  TCBS: 'TCBS',
  VPBANKS: 'VPBS',
  VIETCAP: 'VietCap',
  SSI: 'SSI',
  VPS: 'VPS',
  VNDIRECT: 'VNDIRECT',
  MBS: 'MBS',
  HSC: 'HSC',
  BSC: 'BSC',
  KIS: 'KIS',
  MIRAE: 'Mirae',
  ACBS: 'ACBS',
};

export interface DongTaiKhoan {
  accountId: string;
  /** Nhánh = tên nhóm hiện tại của chủ tài khoản (quyết định của người dùng). */
  nhanh: string;
  san: string;
  soTaiKhoan: string;
  ten: string;
  userId: string;
  vonTu: bigint;
  nop: bigint;
  rut: bigint;
  vonDen: bigint;
  /** Mã đang giữ mà không có giá nào tới ngày đó — giá trị của chúng tính bằng 0. */
  thieuGia: string[];
}

export interface DongVonNguoi {
  userId: string;
  ten: string;
  /** Vốn góp ròng (nạp − rút) TRƯỚC kỳ. "Nâng vốn" trong kỳ là công thức trên bảng chính. */
  vonBanDau: bigint;
}

export interface BaoCaoTaiKhoan {
  tu: string;
  den: string;
  dong: DongTaiKhoan[];
  vonNguoi: DongVonNguoi[];
  /** Ngày giá thực dùng cho đầu kỳ / cuối kỳ (phiên gần nhất không sau mốc). */
  ngayGiaTu: string | null;
  ngayGiaDen: string | null;
}

/** Hết ngày `ngay` (YYYY-MM-DD) theo giờ Việt Nam. */
export function cuoiNgay(ngay: string): Date {
  return new Date(`${ngay}T23:59:59.999+07:00`);
}

/** Đầu ngày `ngay` theo giờ Việt Nam. */
function dauNgay(ngay: string): Date {
  return new Date(`${ngay}T00:00:00.000+07:00`);
}

/** Ngày liền trước (YYYY-MM-DD). */
export function ngayTruoc(ngay: string): string {
  const d = new Date(`${ngay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Dựng báo cáo cho khoảng [tu, den] (YYYY-MM-DD, giờ Việt Nam).
 *
 * `phamVi` đã qua `applyPersonalScope`: `userId` = chỉ tài khoản của người đó, `teamId` =
 * tài khoản của người thuộc nhóm đó (nhóm hiện tại), không có gì = mọi tài khoản.
 */
export async function buildAccountPnl(
  portfolioId: string,
  tu: string,
  den: string,
  phamVi: { userId?: string; teamId?: string | null },
): Promise<BaoCaoTaiKhoan> {
  const ownerWhere =
    phamVi.userId !== undefined
      ? { userId: phamVi.userId }
      : phamVi.teamId !== undefined
        ? { user: { teamId: phamVi.teamId } }
        : {};

  const hetKy = cuoiNgay(den);
  const truocKy = cuoiNgay(ngayTruoc(tu));
  const batDauKy = dauNgay(tu);

  const accounts = await prisma.brokerAccount.findMany({
    where: ownerWhere,
    select: {
      id: true,
      broker: true,
      brokerOther: true,
      accountNo: true,
      isActive: true,
      user: { select: { id: true, fullName: true, team: { select: { nameVi: true } } } },
      capitalFlows: {
        where: { portfolioId, status: CAPITAL_FLOW_STATUS.CONFIRMED, occurredAt: { lte: hetKy } },
        select: { flowType: true, amount: true, occurredAt: true },
      },
      trades: {
        where: { portfolioId, status: COUNTED_TRADE_STATUS, executedAt: { lte: hetKy } },
        select: {
          stockId: true,
          transactionType: true,
          quantity: true,
          price: true,
          fees: true,
          tax: true,
          executedAt: true,
          stock: { select: { symbol: true } },
        },
      },
    },
  });

  const maDung = [...new Set(accounts.flatMap((a) => a.trades.map((t) => t.stockId)))];
  const [giaTu, giaDen] = await Promise.all([
    giaTaiNgay(maDung, ngayTruoc(tu)),
    giaTaiNgay(maDung, den),
  ]);

  /** Tài sản ròng của một tài khoản tại mốc `moc`. */
  const taiSan = (
    a: (typeof accounts)[number],
    moc: Date,
    gia: Map<string, bigint>,
  ): { nav: bigint; thieu: string[] } => {
    let tien = 0n;
    for (const f of a.capitalFlows) {
      if (f.occurredAt > moc) continue;
      tien += BigInt(CAPITAL_FLOW_SIGN[f.flowType as CapitalFlowType]) * f.amount;
    }
    const kl = new Map<string, { qty: number; symbol: string }>();
    for (const t of a.trades) {
      if (t.executedAt > moc) continue;
      const mua = t.transactionType === TRANSACTION_TYPE.BUY;
      const net = netAmount(mua ? 'BUY' : 'SELL', t.quantity, t.price, t.fees, t.tax);
      tien += mua ? -net : net;
      const cu = kl.get(t.stockId) ?? { qty: 0, symbol: t.stock.symbol };
      cu.qty += mua ? t.quantity : -t.quantity;
      kl.set(t.stockId, cu);
    }
    let coPhieu = 0n;
    const thieu: string[] = [];
    for (const [stockId, v] of kl) {
      if (v.qty === 0) continue;
      const p = gia.get(stockId);
      if (p === undefined) {
        if (v.qty > 0) thieu.push(v.symbol);
        continue;
      }
      coPhieu += BigInt(v.qty) * p;
    }
    return { nav: coPhieu + tien, thieu };
  };

  const dong: DongTaiKhoan[] = [];
  const vonTruocKy = new Map<string, bigint>();

  for (const a of accounts) {
    const dau = taiSan(a, truocKy, giaTu.gia);
    const cuoi = taiSan(a, hetKy, giaDen.gia);

    let nop = 0n;
    let rut = 0n;
    for (const f of a.capitalFlows) {
      if (f.occurredAt < batDauKy) {
        if (f.flowType === CAPITAL_FLOW_TYPE.CONTRIBUTION) {
          vonTruocKy.set(a.user.id, (vonTruocKy.get(a.user.id) ?? 0n) + f.amount);
        } else if (f.flowType === CAPITAL_FLOW_TYPE.WITHDRAWAL) {
          vonTruocKy.set(a.user.id, (vonTruocKy.get(a.user.id) ?? 0n) - f.amount);
        }
        continue;
      }
      if (f.flowType === CAPITAL_FLOW_TYPE.CONTRIBUTION) nop += f.amount;
      else if (f.flowType === CAPITAL_FLOW_TYPE.WITHDRAWAL) rut += f.amount;
    }

    // Tài khoản đã đóng mà không có gì trong kỳ thì bỏ — chỉ là một dòng toàn số 0.
    if (!a.isActive && dau.nav === 0n && cuoi.nav === 0n && nop === 0n && rut === 0n) continue;

    dong.push({
      accountId: a.id,
      nhanh: a.user.team?.nameVi ?? '',
      san:
        a.broker === BROKER.OTHER ? (a.brokerOther ?? 'Khác') : (SAN_NGAN[a.broker] ?? a.broker),
      soTaiKhoan: a.accountNo,
      ten: a.user.fullName,
      userId: a.user.id,
      vonTu: dau.nav,
      nop,
      rut,
      vonDen: cuoi.nav,
      thieuGia: [...new Set([...dau.thieu, ...cuoi.thieu])].sort(),
    });
  }

  // Như mẫu: theo tên người, rồi theo sàn.
  const so = new Intl.Collator('vi');
  dong.sort((x, y) => so.compare(x.ten, y.ten) || so.compare(x.san, y.san));

  /*
   * TÊN TRÙNG thì thêm hậu tố: "Bảng vốn" cộng "Nâng vốn" bằng SUMIFS theo tên, nên hai
   * người cùng tên sẽ bị gộp làm một nếu không phân biệt.
   */
  const demTen = new Map<string, Set<string>>();
  for (const d of dong) demTen.set(d.ten, (demTen.get(d.ten) ?? new Set()).add(d.userId));
  const thuTu = new Map<string, number>();
  for (const d of dong) {
    const ids = [...(demTen.get(d.ten) ?? [])];
    if (ids.length > 1) {
      if (!thuTu.has(d.userId)) thuTu.set(d.userId, ids.indexOf(d.userId) + 1);
      d.ten = `${d.ten} (${thuTu.get(d.userId)})`;
    }
  }

  const vonNguoi: DongVonNguoi[] = [];
  const daCo = new Set<string>();
  for (const d of dong) {
    if (daCo.has(d.userId)) continue;
    daCo.add(d.userId);
    vonNguoi.push({ userId: d.userId, ten: d.ten, vonBanDau: vonTruocKy.get(d.userId) ?? 0n });
  }

  return { tu, den, dong, vonNguoi, ngayGiaTu: giaTu.ngayGia, ngayGiaDen: giaDen.ngayGia };
}
