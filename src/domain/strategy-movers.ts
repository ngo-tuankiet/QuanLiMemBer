import 'server-only';

/**
 * MỖI CHIẾN LƯỢC: 3 MÃ ĐANG LÃI NHIỀU NHẤT VÀ 3 MÃ ĐANG LỖ NHIỀU NHẤT.
 *
 * Hai biểu đồ trên Dashboard. Đơn vị là % LÃI/LỖ CHƯA CHỐT TRÊN GIÁ VỐN của phần vị thế
 * thuộc chiến lược đó — đúng cột "Lợi nhuận (%)" / "Mức lỗ (%)" trong mẫu người dùng
 * gửi. Không cộng cổ tức hay lãi đã chốt: câu hỏi là "mã nào trong chiến lược này
 * đang đi đúng / sai hướng", và lãi đã chốt là chuyện của vị thế đã đóng.
 *
 * KHÔNG VIẾT LẠI PHÉP TÍNH NÀO. Mỗi chiến lược đi qua đúng `computePositions` với bộ
 * lọc `strategyId` — cùng phép chia vốn theo tỷ lệ phân bổ (§16) mà bảng vị thế dùng —
 * nên con số trên biểu đồ bằng đúng con số người dùng thấy khi lọc Vị thế theo chiến
 * lược đó.
 *
 * MÃ THIẾU GIÁ BỊ LOẠI: giá trị thị trường bằng 0 thì "lỗ" ra đúng −100%, một khoản lỗ
 * không có thật và nó sẽ luôn đứng đầu biểu đồ lỗ.
 */

import { prisma } from '@/lib/prisma';
import { ratioToBps } from '@/lib/money';
import { computePositions, type EngineFilter } from '@/domain/portfolio-engine';

/** Số mã mỗi phía cho mỗi chiến lược. */
export const SO_MA_MOI_PHIA = 3;

export interface MaBienDong {
  stockId: string;
  symbol: string;
  companyName: string;
  /** Lãi/lỗ chưa chốt trên giá vốn, bps. */
  returnBps: number;
  unrealizedPnl: bigint;
  totalCost: bigint;
  marketValue: bigint;
  quantity: number;
}

export interface NhomBienDong {
  /** Khoá nhóm — tên đã chuẩn hoá, xem `nhomChienLuoc`. */
  key: string;
  label: string;
  /** Slot màu dự phòng (`sortOrder − 1`) — chỉ dùng khi chiến lược không cài màu. */
  colorIndex: number;
  /** Màu cài ở Quản trị → Chiến lược. Tô bằng `mauChienLuoc(colorHex, colorIndex)`. */
  colorHex: string | null;
  /** Tên các chiến lược gốc đã gộp vào nhóm — để chú thích nói ra việc gộp. */
  members: string[];
  gainers: MaBienDong[];
  losers: MaBienDong[];
}

/**
 * GỘP CÁC CHIẾN LƯỢC CÙNG HỌ THÀNH MỘT NHÓM TRÊN BIỂU ĐỒ.
 *
 * Yêu cầu của người dùng: IOPTIMA 01, IOPTIMA 02, IOPTIMA 03 là một chiến lược trên hai
 * biểu đồ này. Gộp theo TÊN bỏ số thứ tự ở cuối ("IOPTIMA 03" → "IOPTIMA"), không liệt
 * kê cứng ba cái tên: mở thêm IOPTIMA 04 thì nó tự vào nhóm, không ai phải nhớ sửa mã.
 *
 * CHỈ GỘP KHI CÓ TỪ HAI CHIẾN LƯỢC CÙNG GỐC. Một chiến lược đứng một mình giữ nguyên
 * tên: "Top 10" không được thành "Top" chỉ vì tên nó kết thúc bằng số.
 *
 * CHỈ ÁP CHO HAI BIỂU ĐỒ NÀY. Dữ liệu, bộ lọc, và donut phân bổ vẫn giữ ba chiến lược
 * riêng — người dùng chỉ yêu cầu gộp ở đây.
 */
export function gocTen(nameVi: string): string {
  const goc = nameVi.trim().replace(/\s+\d+$/, '').trim();
  return goc.length > 0 ? goc : nameVi.trim();
}

/** Nhóm của từng chiến lược (theo tên): gộp theo gốc tên chỉ khi gốc đó có ≥ 2 chiến lược. */
export function nhomChienLuoc(
  names: readonly string[],
): Map<string, { key: string; label: string }> {
  const khoa = (x: string) => x.toLocaleUpperCase('vi-VN');
  const dem = new Map<string, number>();
  for (const n of names) dem.set(khoa(gocTen(n)), (dem.get(khoa(gocTen(n))) ?? 0) + 1);

  const ra = new Map<string, { key: string; label: string }>();
  for (const n of names) {
    const goc = gocTen(n);
    const label = (dem.get(khoa(goc)) ?? 0) > 1 ? goc : n.trim();
    ra.set(n, { key: khoa(label), label });
  }
  return ra;
}

/** Gộp các lát vị thế của CÙNG MỘT MÃ từ nhiều chiến lược trong một nhóm. */
interface Gop {
  stockId: string;
  symbol: string;
  companyName: string;
  unrealizedPnl: bigint;
  totalCost: bigint;
  marketValue: bigint;
  quantity: number;
}

export async function computeStrategyMovers(filter: EngineFilter): Promise<NhomBienDong[]> {
  const strategies = await prisma.strategy.findMany({
    /*
     * Đang lọc một chiến lược thì chỉ tính đúng nó. Không lọc thì lấy cả chiến lược
     * đã tắt: tắt chỉ chặn phân bổ MỚI, vị thế cũ của nó vẫn đang lãi lỗ thật.
     */
    where: filter.strategyId ? { id: filter.strategyId } : {},
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, nameVi: true, sortOrder: true, colorHex: true },
  });

  const nhom = new Map<
    string,
    { label: string; colorIndex: number; colorHex: string | null; members: string[]; theoMa: Map<string, Gop> }
  >();

  const theoCL = await Promise.all(
    strategies.map(async (s) => ({
      s,
      positions: await computePositions({ ...filter, strategyId: s.id }),
    })),
  );

  /*
   * Xét gốc tên trên MỌI chiến lược, không chỉ cái đang lọc: lọc riêng IOPTIMA 01 thì
   * nó vẫn thuộc họ IOPTIMA, và nhãn phải giống nhãn lúc không lọc.
   */
  const tatCa = filter.strategyId
    ? await prisma.strategy.findMany({ select: { nameVi: true } })
    : strategies;
  const nhomCua = nhomChienLuoc(tatCa.map((x) => x.nameVi));

  for (const { s, positions } of theoCL) {
    const { key, label } = nhomCua.get(s.nameVi) ?? {
      key: s.nameVi.toLocaleUpperCase('vi-VN'),
      label: s.nameVi,
    };
    let n = nhom.get(key);
    if (!n) {
      /*
       * NHÓM GỘP LẤY MÀU CỦA THÀNH VIÊN ĐỨNG ĐẦU theo thứ tự (Thứ tự, rồi ngày tạo).
       * IOPTIMA 01/02/03 được cài ba màu khác nhau; một cụm cột chỉ tô được một màu,
       * nên lấy màu của IOPTIMA 01 — thành viên đầu tiên của họ.
       */
      n = {
        label,
        colorIndex: Math.max(0, s.sortOrder - 1),
        colorHex: s.colorHex,
        members: [],
        theoMa: new Map(),
      };
      nhom.set(key, n);
    }
    n.members.push(s.nameVi);

    for (const p of positions) {
      if (p.quantity <= 0 || p.missingPrice) continue;
      const cu = n.theoMa.get(p.stockId);
      if (cu) {
        cu.unrealizedPnl += p.unrealizedPnl;
        cu.totalCost += p.totalCost;
        cu.marketValue += p.marketValue;
        cu.quantity += p.quantity;
      } else {
        n.theoMa.set(p.stockId, {
          stockId: p.stockId,
          symbol: p.symbol,
          companyName: p.companyName,
          unrealizedPnl: p.unrealizedPnl,
          totalCost: p.totalCost,
          marketValue: p.marketValue,
          quantity: p.quantity,
        });
      }
    }
  }

  const ra: NhomBienDong[] = [];
  for (const [key, n] of nhom) {
    /*
     * TỶ SUẤT TÍNH LẠI TỪ TỔNG sau khi gộp, không lấy trung bình các tỷ suất. Một mã ở
     * IOPTIMA 01 lãi 10% trên 100 triệu và ở IOPTIMA 03 lỗ 50% trên 1 triệu thì cả nhóm
     * đang lãi ~9,4%, không phải lỗ 20%.
     */
    const ds: MaBienDong[] = [...n.theoMa.values()]
      .filter((g) => g.totalCost > 0n)
      .map((g) => ({ ...g, returnBps: ratioToBps(g.unrealizedPnl, g.totalCost) }));

    const gainers = ds
      .filter((x) => x.returnBps > 0)
      .sort((a, b) => b.returnBps - a.returnBps || a.symbol.localeCompare(b.symbol))
      .slice(0, SO_MA_MOI_PHIA);
    const losers = ds
      .filter((x) => x.returnBps < 0)
      .sort((a, b) => a.returnBps - b.returnBps || a.symbol.localeCompare(b.symbol))
      .slice(0, SO_MA_MOI_PHIA);

    if (gainers.length === 0 && losers.length === 0) continue;
    ra.push({
      key,
      label: n.label,
      colorIndex: n.colorIndex,
      colorHex: n.colorHex,
      members: n.members,
      gainers,
      losers,
    });
  }

  return ra;
}
