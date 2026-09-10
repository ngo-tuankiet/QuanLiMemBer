import 'server-only';

/**
 * PORTFOLIO ENGINE — Phase 06.
 *
 * Đây là hiện thực đầy đủ của §9. Nguyên tắc §23 được giữ tuyệt đối: **không có
 * bảng nào lưu Position hay P&L**. Mọi con số ở đây được tính từ
 *
 *     trades  +  trade_strategies  +  market_quotes  +  capital_flows
 *
 * mỗi lần được gọi. Nhờ vậy không bao giờ có tình trạng số liệu hiển thị lệch với
 * giao dịch thực tế — thứ tệ nhất có thể xảy ra với hệ thống quản lý vốn.
 *
 * Tiền tệ là `bigint` VNĐ nguyên, tỷ lệ là `number` basis point. Xem
 * src/lib/money.ts để biết vì sao.
 */

import { prisma } from '@/lib/prisma';
import { inTradingSession, lastClosedSession, sessionsBetween } from '@/lib/trading-date';
import {
  MICRO,
  avgCostMicro,
  costBasis,
  divRound,
  netAmount,
  allocateAmount,
  bpsFromWeights,
  ratioToBps,
  BPS_TOTAL,
} from '@/lib/money';
import {
  COUNTED_TRADE_STATUS,
  TRADE_STATUS,
  TRANSACTION_TYPE,
  CAPITAL_FLOW_SIGN,
  CAPITAL_FLOW_TYPE,
  CAPITAL_FLOW_STATUS,
  CAPITAL_FLOW_AFFECTS_CONTRIBUTED,
  DEFAULT_BENCHMARK,
  type CapitalFlowType,
} from '@/lib/enums';

// ---------------------------------------------------------------------------
// Kiểu dữ liệu
// ---------------------------------------------------------------------------

/** Bộ lọc global của Dashboard (§11). Mọi hàm trong file này nhận cùng bộ lọc. */
export interface EngineFilter {
  portfolioId?: string;
  /**
   * Lọc theo nhóm. BA trạng thái, khác nhau thật:
   *
   *   `undefined`  không lọc — mọi giao dịch, thuộc nhóm nào cũng tính.
   *   `"<id>"`     chỉ giao dịch của nhóm đó.
   *   `null`       chỉ giao dịch KHÔNG thuộc nhóm nào (`teamId IS NULL`).
   *
   * Trạng thái `null` cần thiết để phần chia theo nhóm cộng lại đúng bằng toàn
   * danh mục. Admin nhập lệnh hộ mà không thuộc nhóm nào là chuyện xảy ra thật;
   * không có trạng thái này thì những lệnh đó rơi khỏi mọi nhóm và biểu đồ báo
   * thiếu vốn mà không ai phát hiện.
   *
   * Lưu ý: `applyScope()` dùng chuỗi sentinel `'__no_team__'` cho người không
   * thuộc nhóm nào — KHÔNG dùng `null`. Hai thứ ngược nhau: sentinel để họ không
   * thấy gì, còn `null` để thấy đúng phần chưa được gán nhóm.
   */
  teamId?: string | null;
  /**
   * Chỉ tính giao dịch do NGƯỜI NÀY thực hiện (`trades.userId`).
   *
   * Là người THỰC HIỆN lệnh, không phải người nhập hay người duyệt. Bảng `trades`
   * giữ cả ba (`userId`, `createdById`, `approvedById`) vì đó là ba việc khác
   * nhau; câu hỏi "người này làm ra bao nhiêu" chỉ có một câu trả lời đúng là
   * người đặt lệnh.
   */
  userId?: string;
  /** Chỉ tính phần vốn được phân bổ cho chiến lược này. */
  strategyId?: string;
  sectorId?: string;
  /** Mốc bắt đầu; null = từ đầu. */
  from?: Date;
  to?: Date;
}

export interface PositionView {
  stockId: string;
  symbol: string;
  companyName: string;
  exchange: string;
  sectorId: string;
  sectorCode: string;
  sectorNameVi: string;
  sectorColor: string | null;
  /** `sortOrder` của ngành — dùng làm slot màu cố định cho biểu đồ. */
  sectorSortOrder: number;
  industryNameVi: string | null;

  quantity: number;
  totalCost: bigint;
  /** Giá vốn trung bình, đơn vị micro-đồng (1đ = 1e6). Xem money.ts. */
  avgCostMicro: bigint;

  currentPrice: bigint;
  priceTradingDate: Date | null;
  isStale: boolean;
  /** true khi mã chưa có giá trong market_quotes — giá trị thị trường không tính được. */
  missingPrice: boolean;

  marketValue: bigint;
  unrealizedPnl: bigint;
  realizedPnl: bigint;

  /**
   * Số cổ phiếu ĐÃ BÁN mà trong phạm vi này không tìm thấy lệnh mua tương ứng.
   *
   * Khác 0 nghĩa là phạm vi đang cắt ngang một lô: lệnh mua nằm ngoài phạm vi còn
   * lệnh bán nằm trong. Xảy ra thật khi lọc theo NHÓM — `trades.teamId` đóng băng lúc
   * ghi lệnh, nên người đổi nhóm giữa hai lệnh sẽ để lệnh mua ở nhóm cũ và lệnh bán ở
   * nhóm mới.
   *
   * Lãi/lỗ của phần này KHÔNG TÍNH ĐƯỢC (không biết giá vốn), nên nó không được cộng
   * vào `realizedPnl`. Nơi hiển thị phải nói ra thay vì im lặng đưa một con số thiếu.
   */
  unmatchedSellQuantity: number;

  /** Tiền thu về của phần bán không khớp ở trên. Có tiền nhưng chưa biết lãi hay lỗ. */
  unmatchedSellProceeds: bigint;

  /**
   * CỔ TỨC TIỀN MẶT đã nhận từ mã này, trong phạm vi đang lọc.
   *
   * ĐỂ RIÊNG, KHÔNG CỘNG VÀO `unrealizedPnl` hay `realizedPnl`. Hai nguồn lợi nhuận
   * khác hẳn nhau: lãi/lỗ giá là chênh lệch chưa/đã chốt trên giá vốn, còn cổ tức là
   * tiền doanh nghiệp đã trả và không bao giờ mất đi. Trộn vào thì cột `returnBps`
   * không còn là "giá đã đi bao nhiêu so với giá vốn" — đúng con số người ta nhìn
   * để quyết định mua thêm hay cắt lỗ.
   *
   * CHỈ CỘNG CỔ TỨC BẰNG TIỀN. Cổ tức bằng cổ phiếu đã nằm sẵn trong `quantity` (nó
   * được ghi như một lệnh mua giá 0), cộng thêm ở đây là tính hai lần.
   */
  dividendCash: bigint;

  /** Lãi/lỗ giá cộng cổ tức đã nhận — tổng lợi ích của việc nắm mã này. */
  totalReturn: bigint;
  /** `totalReturn` trên giá vốn. Khác `returnBps` đúng bằng phần cổ tức. */
  totalReturnBps: number;

  returnBps: number;
  weightBps: number;
}

export interface SectorExposure {
  sectorId: string;
  code: string;
  nameVi: string;
  colorHex: string | null;
  /**
   * Slot màu CỐ ĐỊNH của ngành này, lấy từ `sortOrder` của master data.
   *
   * KHÔNG được gán màu theo vị trí trong mảng kết quả: mảng được sắp theo giá
   * trị, nên lọc bỏ một ngành sẽ sơn lại các ngành còn lại — người đã học
   * "Tài chính màu xanh" bị dẫn sai. Màu phải theo THỰC THỂ, không theo thứ hạng.
   */
  colorIndex: number;
  marketValue: bigint;
  costValue: bigint;
  unrealizedPnl: bigint;
  weightBps: number;
  symbols: string[];
}

export interface StrategyAllocation {
  strategyId: string;
  code: string;
  nameVi: string;
  colorHex: string | null;
  /** Slot màu cố định, lấy từ `sortOrder` — không theo thứ hạng. */
  colorIndex: number;
  /**
   * Giá vốn của phần CÒN ĐANG GIỮ theo chiến lược này.
   *
   * Không phải "Σ mua − Σ bán" trên `allocationAmount` — xem chú thích của
   * `computeStrategyAllocation` để biết vì sao phép đó cho ra lãi/lỗ chứ không phải vốn.
   */
  netCapital: bigint;
  weightBps: number;
  tradeCount: number;
  maxAllocationBps: number | null;
  /** true khi vượt hạn mức cấu hình của chiến lược. */
  overLimit: boolean;
}

export interface CashBreakdown {
  /** Σ nạp − rút (chỉ dòng vốn góp/rút). */
  contributedCapital: bigint;
  /** Cổ tức + lãi + thu/chi khác. */
  otherFlows: bigint;
  spentOnBuys: bigint;
  receivedFromSells: bigint;
  /** Số dư tiền thực tế. */
  cashBalance: bigint;
  /**
   * Quỹ dự phòng THỰC SỰ giữ được. LUÔN BẰNG 0 khi `scope === 'TEAM'`.
   *
   * `portfolios.reserveAmount` là một cột của DANH MỤC, không của nhóm. Trừ nó
   * vào số dư của từng nhóm sẽ trừ cùng một khoản dự phòng bốn lần.
   *
   * KHÔNG BAO GIỜ LỚN HƠN SỐ TIỀN ĐANG CÓ — xem `reserveShortfall`.
   */
  reserveAmount: bigint;
  /**
   * Phần quỹ dự phòng CHƯA CÓ TIỀN để giữ: `cấu hình − giữ được`.
   *
   * Bằng 0 là bình thường. Khác 0 nghĩa là danh mục chưa đủ tiền mặt để đáp ứng mức dự
   * phòng đã đặt ra — một thông tin thật, cần nói ra, nhưng KHÔNG được biến thành số dư
   * âm (xem `availableCash`).
   */
  reserveShortfall: bigint;
  /** cashBalance − reserve. Đây mới là "Available Cash" của §12. */
  availableCash: bigint;

  /** Con số này thuộc toàn danh mục, hay riêng một nhóm. */
  scope: 'PORTFOLIO' | 'TEAM';
  /**
   * true khi tính cho một nhóm mà nhóm đó CHƯA được cấp dòng vốn riêng nào.
   *
   * Lúc đó `cashBalance` là số ÂM bằng đúng phần nhóm đã rút từ quỹ chung — con
   * số đúng nhưng không phải "tiền còn lại", nên nơi hiển thị phải nói khác đi
   * thay vì in một số âm dưới nhãn "Available Cash".
   */
  noGrant: boolean;
}

export interface MarketDataStatus {
  /**
   * Đang trong phiên giao dịch hay không — QUYẾT ĐỊNH DÙNG THƯỚC NÀO.
   *
   *   trong phiên  giá phải mới trong vòng `staleAfterMinutes`
   *   ngoài phiên  giá phải là của phiên gần nhất đã đóng; bao lâu trôi qua
   *                không quan trọng
   */
  duringSession: boolean;
  /** Ngày giao dịch của giá đang lưu (mới nhất trong `market_quotes`). */
  quoteTradingDate: Date | null;
  /** Phiên gần nhất ĐÃ đóng — cái mà `quoteTradingDate` phải bằng. */
  expectedSession: Date;
  /** Chậm bao nhiêu PHIÊN. 0 = đang mới nhất. */
  sessionsBehind: number;
  connected: boolean;
  lastSuccessAt: Date | null;
  ageMinutes: number | null;
  staleAfterMinutes: number;
  symbolsUpdated: number;
  symbolsRequested: number;
  source: string | null;
  /** Số mã trong danh mục chưa có giá. */
  missingPriceCount: number;
}

export interface PortfolioSummary {
  portfolioId: string;
  portfolioCode: string;
  portfolioName: string;

  /** §12 Portfolio Value = giá trị thị trường của vị thế + số dư tiền. */
  portfolioValue: bigint;
  /** §12 Invested Capital = giá trị thị trường của các vị thế đang giữ. */
  investedValue: bigint;
  investedCost: bigint;
  cash: CashBreakdown;

  realizedPnl: bigint;
  unrealizedPnl: bigint;
  totalPnl: bigint;
  /** Lợi nhuận trên giá vốn đã bỏ ra. */
  totalPnlBps: number;

  /** §14 Capital Allocation — ba phần cộng lại 100%. */
  allocation: { investedBps: number; cashBps: number; reserveBps: number };

  positions: PositionView[];
  positionCount: number;
  sectorExposure: SectorExposure[];
  strategyAllocation: StrategyAllocation[];
  marketData: MarketDataStatus;
}

// ---------------------------------------------------------------------------
// Truy vấn giao dịch
// ---------------------------------------------------------------------------

/**
 * Điều kiện lọc giao dịch dùng chung.
 *
 * CHỈ lệnh `EXECUTED` được tính vào vị thế và P&L. Lệnh nháp hay chờ duyệt không
 * được phép ảnh hưởng tới số liệu — đây là ràng buộc quan trọng nhất của engine.
 */

function tradeWhere(filter: EngineFilter) {
  return {
    status: COUNTED_TRADE_STATUS,
    ...(filter.portfolioId ? { portfolioId: filter.portfolioId } : {}),
    // `!== undefined` chứ không phải kiểm tra truthy: `null` phải đi vào where
    // để Prisma dịch thành `teamId IS NULL`, không được lặng lẽ bỏ qua.
    ...(filter.teamId !== undefined ? { teamId: filter.teamId } : {}),
    ...(filter.userId ? { userId: filter.userId } : {}),
    ...(filter.sectorId ? { stock: { sectorId: filter.sectorId } } : {}),
    ...(filter.strategyId ? { strategies: { some: { strategyId: filter.strategyId } } } : {}),
    ...(filter.from || filter.to
      ? {
          executedAt: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Vị thế & P&L (§9)
// ---------------------------------------------------------------------------

/**
 * Tính vị thế theo phương pháp **bình quân gia quyền** (weighted average cost).
 *
 * Xử lý tuần tự theo `executedAt` — thứ tự quan trọng, vì giá vốn trung bình phụ
 * thuộc vào trình tự mua/bán. Sắp xếp phụ theo `createdAt` để hai lệnh cùng giây
 * vẫn cho kết quả xác định.
 *
 * KHI CÓ LỌC THEO CHIẾN LƯỢC: tiền được nhân theo tỷ lệ phân bổ của chiến lược đó
 * (`allocationBps`), vì §16 yêu cầu không đếm trùng vốn. Khối lượng cũng được
 * nhân theo tỷ lệ nên có thể không còn là số nguyên tròn — đó là bản chất của câu
 * hỏi "bao nhiêu phần của vị thế này thuộc chiến lược Value".
 */
export async function computePositions(filter: EngineFilter): Promise<PositionView[]> {
  /*
   * CỔ TỨC TIỀN MẶT NẠP RIÊNG, không đi qua `tradeWhere`.
   *
   * Nó nằm ở `capital_flows` chứ không ở `trades`, và bộ lọc của nó khác:
   *
   *   danh mục   áp được — cột `portfolioId` có ở cả hai bảng.
   *   nhóm       KHÔNG áp: cổ tức về danh mục chứ không về nhóm nào (xem chú thích
   *              cột `capital_flows.teamId`). Lọc theo nhóm thì cột cổ tức trống
   *              chứ không sai — thà không có số còn hơn gán bừa cho một nhóm.
   *   chiến lược KHÔNG áp: `capital_flows` không nối với `trade_strategies`.
   *   khoảng     áp theo `occurredAt`, cùng mốc với lệnh.
   *
   * Bỏ hẳn truy vấn khi đang lọc theo nhóm hoặc chiến lược, thay vì trả một con số
   * không đúng phạm vi người dùng đang xem.
   */
  const loTheoPhamVi =
    filter.teamId === undefined && filter.strategyId === undefined;

  const coTucTheoMa = new Map<string, bigint>();
  if (loTheoPhamVi) {
    const dong = await prisma.capitalFlow.groupBy({
      by: ['stockId'],
      where: {
        ...(filter.portfolioId ? { portfolioId: filter.portfolioId } : {}),
        flowType: CAPITAL_FLOW_TYPE.DIVIDEND,
        status: CAPITAL_FLOW_STATUS.CONFIRMED,
        stockId: { not: null },
        ...(filter.from || filter.to
          ? {
              occurredAt: {
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lte: filter.to } : {}),
              },
            }
          : {}),
      },
      _sum: { amount: true },
    });
    for (const d of dong) {
      if (d.stockId) coTucTheoMa.set(d.stockId, d._sum.amount ?? 0n);
    }
  }

  const trades = await prisma.trade.findMany({
    where: tradeWhere(filter),
    orderBy: [{ executedAt: 'asc' }, { createdAt: 'asc' }],
    include: {
      stock: {
        include: {
          sector: { select: { id: true, code: true, nameVi: true, colorHex: true, sortOrder: true } },
          industry: { select: { nameVi: true } },
          quote: { select: { price: true, tradingDate: true, isStale: true } },
        },
      },
      strategies: filter.strategyId
        ? { where: { strategyId: filter.strategyId }, select: { allocationBps: true } }
        : false,
    },
  });

  interface Acc extends PositionView {
    /** Khối lượng tích luỹ ở đơn vị micro để giữ phần thập phân khi lọc chiến lược. */
    quantityMicro: bigint;
    /** Phần bán không khớp, cũng ở micro — quy về số cổ phiếu ở bước chốt. */
    unmatchedSellMicro: bigint;
  }

  const acc = new Map<string, Acc>();

  for (const trade of trades) {
    // Tỷ lệ phần vốn thuộc chiến lược đang lọc; 100% khi không lọc.
    const shareBps = filter.strategyId
      ? (trade.strategies as { allocationBps: number }[]).reduce((s, a) => s + a.allocationBps, 0)
      : BPS_TOTAL;
    if (shareBps === 0) continue;

    let pos = acc.get(trade.stockId);
    if (!pos) {
      pos = {
        stockId: trade.stockId,
        symbol: trade.stock.symbol,
        companyName: trade.stock.companyName,
        exchange: trade.stock.exchange,
        sectorId: trade.stock.sector.id,
        sectorCode: trade.stock.sector.code,
        sectorNameVi: trade.stock.sector.nameVi,
        sectorColor: trade.stock.sector.colorHex,
        sectorSortOrder: trade.stock.sector.sortOrder,
        industryNameVi: trade.stock.industry?.nameVi ?? null,
        quantity: 0,
        quantityMicro: 0n,
        totalCost: 0n,
        avgCostMicro: 0n,
        currentPrice: trade.stock.quote?.price ?? 0n,
        priceTradingDate: trade.stock.quote?.tradingDate ?? null,
        isStale: trade.stock.quote?.isStale ?? false,
        missingPrice: !trade.stock.quote,
        marketValue: 0n,
        unrealizedPnl: 0n,
        realizedPnl: 0n,
        unmatchedSellQuantity: 0,
        unmatchedSellProceeds: 0n,
        dividendCash: 0n,
        totalReturn: 0n,
        totalReturnBps: 0,
        unmatchedSellMicro: 0n,
        returnBps: 0,
        weightBps: 0,
      };
      acc.set(trade.stockId, pos);
    }

    const bps = BigInt(shareBps);
    const denom = BigInt(BPS_TOTAL);
    // Khối lượng theo tỷ lệ, giữ ở micro để không mất phần thập phân.
    const qtyMicro = divRound(BigInt(trade.quantity) * MICRO * bps, denom);

    if (trade.transactionType === 'BUY') {
      const cost = divRound(costBasis(trade.quantity, trade.price, trade.fees, trade.tax) * bps, denom);
      pos.totalCost += cost;
      pos.quantityMicro += qtyMicro;
      pos.avgCostMicro =
        pos.quantityMicro === 0n
          ? 0n
          : divRound(pos.totalCost * MICRO * MICRO, pos.quantityMicro);
    } else {
      const proceeds = divRound(
        netAmount('SELL', trade.quantity, trade.price, trade.fees, trade.tax) * bps,
        denom,
      );

      /*
       * CHỈ TÍNH LÃI/LỖ CHO PHẦN CÓ LỆNH MUA TRONG PHẠM VI.
       *
       * Bản đầu lấy `avgCostMicro * qtyMicro` cho TOÀN BỘ khối lượng bán. Khi phạm vi
       * không chứa lệnh mua thì `avgCostMicro` bằng 0, nên "giá vốn phần bán" bằng 0 và
       * lãi đã chốt bằng ĐÚNG TOÀN BỘ TIỀN BÁN — một khoản lãi không có thật.
       *
       * Đo được trên dữ liệu thật: nhóm Cá nhân thấy hai lệnh bán 6.000 MBB nhưng lệnh
       * mua 10.000 MBB lại mang `teamId` khác, nên trang nhóm báo lãi +123,291M cho một
       * lô đang LỖ. Khối lượng âm sau đó bị kẹp về 0 nên dấu vết cũng biến mất.
       *
       * Phần không khớp không có giá vốn thì lãi/lỗ của nó KHÔNG TÍNH ĐƯỢC. Ghi riêng
       * để nơi hiển thị nói ra, thay vì đoán một con số.
       */
      const conLai = pos.quantityMicro > 0n ? pos.quantityMicro : 0n;
      const khopMicro = qtyMicro <= conLai ? qtyMicro : conLai;
      const duMicro = qtyMicro - khopMicro;

      const proceedsKhop =
        qtyMicro === 0n ? 0n : divRound(proceeds * khopMicro, qtyMicro);

      // Giá vốn của phần bán ra, theo giá vốn trung bình tại thời điểm bán.
      const costOfSold = divRound(pos.avgCostMicro * khopMicro, MICRO * MICRO);

      pos.realizedPnl += proceedsKhop - costOfSold;
      pos.totalCost -= costOfSold;
      pos.quantityMicro -= khopMicro;

      if (duMicro > 0n) {
        pos.unmatchedSellMicro += duMicro;
        pos.unmatchedSellProceeds += proceeds - proceedsKhop;
      }

      // Bán hết thì đóng vị thế; tránh để lại dư nợ do làm tròn.
      if (pos.quantityMicro <= 0n) {
        pos.quantityMicro = 0n;
        pos.totalCost = 0n;
        pos.avgCostMicro = 0n;
      }
      // Giá vốn trung bình KHÔNG đổi khi bán — đó là định nghĩa của bình quân gia quyền.
    }
  }

  // Chốt các giá trị phụ thuộc giá thị trường.
  const positions: PositionView[] = [];
  for (const pos of acc.values()) {
    pos.quantity = Number(divRound(pos.quantityMicro, MICRO));
    pos.unmatchedSellQuantity = Number(divRound(pos.unmatchedSellMicro, MICRO));
    pos.marketValue = divRound(pos.quantityMicro * pos.currentPrice, MICRO);
    pos.unrealizedPnl = pos.marketValue - pos.totalCost;
    pos.returnBps = ratioToBps(pos.unrealizedPnl, pos.totalCost);

    pos.dividendCash = coTucTheoMa.get(pos.stockId) ?? 0n;
    pos.totalReturn = pos.unrealizedPnl + pos.realizedPnl + pos.dividendCash;
    pos.totalReturnBps = ratioToBps(pos.totalReturn, pos.totalCost);
    const { quantityMicro: _drop, unmatchedSellMicro: _drop2, ...view } = pos;
    positions.push(view);
  }

  const totalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0n);
  for (const p of positions) {
    p.weightBps = ratioToBps(p.marketValue, totalMarketValue);
  }

  // Vị thế đang giữ lên trước, sắp theo giá trị giảm dần; vị thế đã đóng xuống cuối.
  positions.sort((a, b) => {
    const aOpen = a.quantity > 0 ? 1 : 0;
    const bOpen = b.quantity > 0 ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    if (a.marketValue !== b.marketValue) return b.marketValue > a.marketValue ? 1 : -1;
    return a.symbol.localeCompare(b.symbol);
  });

  return positions;
}

// ---------------------------------------------------------------------------
// Tiền & vốn (§12, §14)
// ---------------------------------------------------------------------------

/**
 * Số dư tiền.
 *
 *   cash = Σ CapitalFlow (theo dấu) − Σ tiền chi mua + Σ tiền thu bán
 *
 * Tiền của giao dịch KHÔNG được ghi vào `capital_flows` (xem chú thích của bảng
 * đó) nên ở đây phải tự suy ra từ `trades`, và nhờ vậy không có nguy cơ đếm trùng.
 *
 * Lưu ý: số dư tiền luôn tính trên TOÀN danh mục, không áp bộ lọc team/strategy/
 * sector — một phần tiền không "thuộc" nhóm hay chiến lược nào.
 *
 * PHẠM VI NHÓM (`opts.teamId`). `capital_flows.teamId` cho phép cấp riêng vốn cho
 * một nhóm, nên số dư tiền của nhóm tính được thật:
 *
 *   vốn được cấp cho nhóm  −  chi mua của nhóm  +  thu bán của nhóm
 *
 * KHÔNG trừ quỹ dự phòng ở phạm vi nhóm: `reserveAmount` là cột của danh mục, trừ
 * nó cho từng nhóm là trừ cùng một khoản bốn lần.
 *
 * KHÔNG có phạm vi theo ngành hay chiến lược, và sẽ không có: `capital_flows`
 * không có `stockId` nên cổ tức cũng không suy ra được ngành. Vốn được cấp cho
 * người, không cấp cho ngành.
 *
 * NHÓM CHƯA ĐƯỢC CẤP VỐN cho `cashBalance` âm — bằng đúng phần đã rút từ quỹ
 * chung. Đó là số đúng, nhưng không phải "tiền còn lại"; cờ `noGrant` để nơi hiển
 * thị nói khác đi.
 */
export async function computeCash(
  portfolioId: string,
  opts: { teamId?: string | null } = {},
): Promise<CashBreakdown> {
  const scope = 'teamId' in opts ? 'TEAM' : 'PORTFOLIO';

  /*
   * `'teamId' in opts` chứ không phải `opts.teamId !== undefined`: `teamId: null`
   * là một phạm vi THẬT (phần vốn chưa gắn nhóm), khác hẳn với "không lọc". Cùng
   * quy ước ba trạng thái như `EngineFilter.teamId`.
   */
  const teamWhere = scope === 'TEAM' ? { teamId: opts.teamId ?? null } : {};

  const [portfolio, flows, trades] = await Promise.all([
    prisma.portfolio.findUniqueOrThrow({
      where: { id: portfolioId },
      select: { reserveAmount: true },
    }),
    prisma.capitalFlow.findMany({
      where: { portfolioId, status: 'CONFIRMED', ...teamWhere },
      select: { flowType: true, amount: true },
    }),
    prisma.trade.findMany({
      where: { portfolioId, status: COUNTED_TRADE_STATUS, ...teamWhere },
      select: { transactionType: true, quantity: true, price: true, fees: true, tax: true },
    }),
  ]);

  let contributedCapital = 0n;
  let otherFlows = 0n;

  for (const flow of flows) {
    const type = flow.flowType as CapitalFlowType;
    const signed = BigInt(CAPITAL_FLOW_SIGN[type]) * flow.amount;
    if (CAPITAL_FLOW_AFFECTS_CONTRIBUTED[type]) contributedCapital += signed;
    else otherFlows += signed;
  }

  let spentOnBuys = 0n;
  let receivedFromSells = 0n;
  for (const t of trades) {
    const net = netAmount(t.transactionType as 'BUY' | 'SELL', t.quantity, t.price, t.fees, t.tax);
    if (t.transactionType === 'BUY') spentOnBuys += net;
    else receivedFromSells += net;
  }

  const cashBalance = contributedCapital + otherFlows - spentOnBuys + receivedFromSells;

  /*
   * KHÔNG THỂ ĐỂ DÀNH SỐ TIỀN CHƯA CÓ.
   *
   * `portfolios.reserveAmount` là một CHÍNH SÁCH — "giữ lại 480 triệu" — chứ không phải
   * một khoản nợ. Bản đầu trừ thẳng nó khỏi số dư, nên một danh mục chưa nạp vốn hiện
   * "Available Cash = −480 triệu". Con số đó sai về nghĩa: danh mục đang có 0 đồng, chứ
   * không phải âm 480 triệu. Đo được ngay sau khi dọn dữ liệu để nạp số thật.
   *
   * Kẹp mức dự phòng theo số tiền đang có, và ghi riêng phần còn thiếu. Khi tiền ≥ dự
   * phòng — tức là mọi trường hợp đang chạy đúng — không con số nào đổi.
   *
   *   tiền 1 tỷ, dự phòng 480tr  → giữ 480tr · khả dụng 520tr · thiếu 0        (như cũ)
   *   tiền 300tr, dự phòng 480tr → giữ 300tr · khả dụng 0     · thiếu 180tr
   *   tiền 0,   dự phòng 480tr  → giữ 0     · khả dụng 0     · thiếu 480tr
   *
   * SỐ DƯ ÂM VẪN GIỮ NGUYÊN DẤU ÂM. `cashBalance < 0` nghĩa là vốn nạp chưa khai đủ —
   * một lỗi dữ liệu cần thấy, không phải thứ để che bằng phép kẹp này.
   */
  const reserveCauHinh = scope === 'TEAM' ? 0n : portfolio.reserveAmount;
  const tienDuong = cashBalance > 0n ? cashBalance : 0n;
  const reserveAmount = reserveCauHinh < tienDuong ? reserveCauHinh : tienDuong;
  const reserveShortfall = reserveCauHinh - reserveAmount;

  return {
    contributedCapital,
    otherFlows,
    spentOnBuys,
    receivedFromSells,
    cashBalance,
    reserveAmount,
    reserveShortfall,
    availableCash: cashBalance - reserveAmount,
    scope,
    noGrant: scope === 'TEAM' && contributedCapital === 0n && otherFlows === 0n,
  };
}

// ---------------------------------------------------------------------------
// Tỷ trọng ngành (§15)
// ---------------------------------------------------------------------------

export function computeSectorExposure(positions: readonly PositionView[]): SectorExposure[] {
  const open = positions.filter((p) => p.quantity > 0);
  const total = open.reduce((s, p) => s + p.marketValue, 0n);
  const map = new Map<string, SectorExposure>();

  for (const p of open) {
    const entry =
      map.get(p.sectorId) ??
      {
        sectorId: p.sectorId,
        code: p.sectorCode,
        nameVi: p.sectorNameVi,
        colorHex: p.sectorColor,
        colorIndex: Math.max(0, p.sectorSortOrder - 1),
        marketValue: 0n,
        costValue: 0n,
        unrealizedPnl: 0n,
        weightBps: 0,
        symbols: [],
      };

    entry.marketValue += p.marketValue;
    entry.costValue += p.totalCost;
    entry.unrealizedPnl += p.unrealizedPnl;
    entry.symbols.push(p.symbol);
    map.set(p.sectorId, entry);
  }

  const list = [...map.values()];
  for (const s of list) s.weightBps = ratioToBps(s.marketValue, total);
  list.sort((a, b) => (b.marketValue > a.marketValue ? 1 : -1));
  return list;
}

// ---------------------------------------------------------------------------
// Phân bổ theo chiến lược (§16)
// ---------------------------------------------------------------------------

/**
 * Vốn đang triển khai theo từng chiến lược — GIÁ VỐN CỦA PHẦN CÒN GIỮ.
 *
 * PHÉP TÍNH CŨ SAI, VÀ SAI THEO KIỂU KHÓ THẤY. Bản đầu làm "Σ allocationAmount lệnh
 * mua − Σ allocationAmount lệnh bán". Nghe đúng, nhưng hai số hạng là hai đại lượng
 * khác nhau:
 *
 *   lệnh MUA  `allocationAmount` = phần GIÁ VỐN chi ra cho chiến lược đó
 *   lệnh BÁN  `allocationAmount` = phần TIỀN THU VỀ của chiến lược đó
 *
 * Lấy tiền thu về trừ giá vốn thì ra LÃI/LỖ ĐÃ THỰC HIỆN, không phải vốn còn lại.
 * Đo được trên dữ liệu thật: một chiến lược mua 5.000 MBB hết 126,690M rồi bán hết
 * 5.000 CP đó thu về 102,743M. Khối lượng còn lại là 0, nhưng phép cũ báo còn
 * 23,947M vốn — đúng bằng khoản lỗ — và chiến lược đã thoát sạch vẫn chiếm 18,41%
 * trên biểu đồ. Bán có lãi thì lệch theo chiều ngược lại, thành vốn ÂM.
 *
 * PHÉP ĐÚNG đi từ khối lượng còn lại, không đi từ tiền:
 *
 *   1. khối lượng mỗi lệnh chia cho các chiến lược theo `allocationBps` (đúng
 *      `allocateAmount` mà `computeStrategyHoldings` dùng), mua cộng bán trừ
 *   2. mỗi mã, phân bổ GIÁ VỐN của vị thế còn mở cho các chiến lược theo tỷ trọng
 *      khối lượng còn lại ấy
 *
 * Bước 2 đi qua `bpsFromWeights` + `allocateAmount` chứ không chia rồi làm tròn, nên
 * Σ theo chiến lược bằng ĐÚNG giá vốn vị thế, không rơi mất đồng nào. Đã đối chiếu:
 * tổng khớp tuyệt đối với Σ `totalCost` của mọi vị thế đang mở, ở cả mức một người và
 * mức toàn danh mục.
 *
 * VÌ SAO KHÔNG LƯU SẴN VỐN THEO CHIẾN LƯỢC. §23: không lưu lãi/lỗ hay vị thế, mọi
 * con số dựng lại từ `trades` + `trade_strategies`. Một cột "vốn còn lại" sẽ phải cập
 * nhật đúng ở mọi đường ghi lệnh, và sai một đường là sai vĩnh viễn.
 *
 * Cố tình KHÔNG áp `filter.strategyId` — trang này để so sánh giữa các chiến lược
 * với nhau, lọc theo một chiến lược sẽ luôn ra 100%.
 */
/** Một mã trong một chiến lược: giá vốn phần còn giữ. */
export interface StrategySymbolSlice {
  stockId: string;
  symbol: string;
  sectorSortOrder: number;
  quantity: number;
  /** Giá vốn phần còn giữ của mã này trong chiến lược này. */
  netCapital: bigint;
}

export interface StrategyBreakdown {
  strategyId: string;
  symbols: StrategySymbolSlice[];
  /** Σ `netCapital` các mã — bằng ĐÚNG `netCapital` của chiến lược đó. */
  total: bigint;
  lastTradeAt: Date | null;
  tradeCount: number;
}

/**
 * Phần tính chung của mọi con số "vốn theo chiến lược".
 *
 * MỘT NGUỒN CHO CẢ TỔNG VÀ CHI TIẾT. Trang Chiến lược từng lấy tổng từ engine nhưng
 * tự tính danh sách mã bằng phép "Σ mua − Σ bán" trên `allocationAmount` — nên sau
 * khi sửa engine, hai con số trên CÙNG một thẻ sẽ đến từ hai phép khác nhau và lệch
 * nhau. Dùng chung hàm này thì Σ theo mã bằng đúng tổng, không phải nhờ trùng hợp.
 */
async function vonTheoChienLuoc(rest: EngineFilter): Promise<{
  theoCL: Map<string, StrategySymbolSlice[]>;
  lenhTheoCL: Map<string, Set<string>>;
  lanCuoi: Map<string, Date>;
}> {
  const [trades, positions] = await Promise.all([
    prisma.trade.findMany({
      where: { ...tradeWhere(rest), status: TRADE_STATUS.EXECUTED },
      select: {
        id: true,
        stockId: true,
        quantity: true,
        transactionType: true,
        executedAt: true,
        strategies: { select: { strategyId: true, allocationBps: true } },
      },
    }),
    computePositions(rest),
  ]);

  /*
   * BƯỚC 1 — khối lượng còn lại theo (mã, chiến lược).
   *
   * `trade_strategies` lưu tỷ lệ chứ không lưu khối lượng, nên khối lượng thuộc mỗi
   * chiến lược phải suy ra bằng CHÍNH `allocateAmount` — dùng phép khác sẽ cho ra một
   * bộ số khác với `computeStrategyHoldings`, và hai trang sẽ nói hai điều khác nhau
   * về cùng một vị thế.
   */
  const klConLai = new Map<string, Map<string, number>>();
  const lenhTheoCL = new Map<string, Set<string>>();
  const lanCuoi = new Map<string, Date>();

  for (const t of trades) {
    if (t.strategies.length === 0) continue;

    const bps = t.strategies.map((x) => x.allocationBps);
    const chia = allocateAmount(BigInt(t.quantity), bps);
    const dau = t.transactionType === TRANSACTION_TYPE.BUY ? 1 : -1;

    let theoMa = klConLai.get(t.stockId);
    if (!theoMa) {
      theoMa = new Map<string, number>();
      klConLai.set(t.stockId, theoMa);
    }

    t.strategies.forEach((x, i) => {
      theoMa!.set(x.strategyId, (theoMa!.get(x.strategyId) ?? 0) + Number(chia[i] ?? 0n) * dau);

      const ds = lenhTheoCL.get(x.strategyId) ?? new Set<string>();
      ds.add(t.id);
      lenhTheoCL.set(x.strategyId, ds);

      const cu = lanCuoi.get(x.strategyId);
      if (!cu || t.executedAt > cu) lanCuoi.set(x.strategyId, t.executedAt);
    });
  }

  /*
   * BƯỚC 2 — phân bổ giá vốn của từng vị thế còn mở theo tỷ trọng khối lượng đó.
   *
   * Chỉ xét vị thế đang mở: mã đã bán hết không còn vốn nào để chia. Bỏ khối lượng ÂM
   * (dữ liệu cũ có lệnh bán gán cho chiến lược chưa từng mua mã đó) — để lại thì nó
   * ăn vào tỷ trọng của chiến lược khác và tổng không còn khớp giá vốn.
   */
  const theoCL = new Map<string, StrategySymbolSlice[]>();

  for (const p of positions) {
    if (p.quantity <= 0) continue;

    const theoMa = klConLai.get(p.stockId);
    if (!theoMa) continue;

    const duong = [...theoMa.entries()].filter(([, q]) => q > 0);
    if (duong.length === 0) continue;

    const bps = bpsFromWeights(duong.map(([, q]) => BigInt(q)));
    const phan = allocateAmount(p.totalCost, bps);

    duong.forEach(([id, q], i) => {
      const ds = theoCL.get(id) ?? [];
      ds.push({
        stockId: p.stockId,
        symbol: p.symbol,
        sectorSortOrder: p.sectorSortOrder,
        quantity: q,
        netCapital: phan[i] ?? 0n,
      });
      theoCL.set(id, ds);
    });
  }

  return { theoCL, lenhTheoCL, lanCuoi };
}

/**
 * Vốn theo chiến lược, phân rã ra từng mã.
 *
 * Cùng nguồn với `computeStrategyAllocation`, nên `total` của mỗi chiến lược ở đây
 * bằng ĐÚNG `netCapital` của nó ở kia.
 */
export async function computeStrategyBreakdown(
  filter: EngineFilter,
): Promise<Map<string, StrategyBreakdown>> {
  const { strategyId: _ignored, ...rest } = filter;
  const { theoCL, lenhTheoCL, lanCuoi } = await vonTheoChienLuoc(rest);

  const ra = new Map<string, StrategyBreakdown>();

  for (const id of new Set([...theoCL.keys(), ...lenhTheoCL.keys()])) {
    const symbols = (theoCL.get(id) ?? [])
      .slice()
      .sort((a, b) => (b.netCapital > a.netCapital ? 1 : b.netCapital < a.netCapital ? -1 : 0));

    ra.set(id, {
      strategyId: id,
      symbols,
      total: symbols.reduce((s2, x) => s2 + x.netCapital, 0n),
      lastTradeAt: lanCuoi.get(id) ?? null,
      tradeCount: lenhTheoCL.get(id)?.size ?? 0,
    });
  }

  return ra;
}

export async function computeStrategyAllocation(
  filter: EngineFilter,
): Promise<StrategyAllocation[]> {
  const { strategyId: _ignored, ...rest } = filter;

  const [{ theoCL, lenhTheoCL }, strategies] = await Promise.all([
    vonTheoChienLuoc(rest),
    prisma.strategy.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, nameVi: true, colorHex: true, sortOrder: true, maxAllocationBps: true },
    }),
  ]);

  const netByStrategy = new Map<string, { net: bigint; trades: Set<string> }>();
  for (const s2 of strategies) {
    netByStrategy.set(s2.id, {
      net: (theoCL.get(s2.id) ?? []).reduce((t, x) => t + x.netCapital, 0n),
      trades: lenhTheoCL.get(s2.id) ?? new Set<string>(),
    });
  }

  const total = [...netByStrategy.values()].reduce((s2, e) => s2 + e.net, 0n);

  return strategies
    .map((s) => {
      const entry = netByStrategy.get(s.id);
      const netCapital = entry?.net ?? 0n;
      const weightBps = ratioToBps(netCapital, total);
      return {
        strategyId: s.id,
        code: s.code,
        nameVi: s.nameVi,
        colorHex: s.colorHex,
        colorIndex: Math.max(0, s.sortOrder - 1),
        netCapital,
        weightBps,
        tradeCount: entry?.trades.size ?? 0,
        maxAllocationBps: s.maxAllocationBps,
        overLimit: s.maxAllocationBps !== null && weightBps > s.maxAllocationBps,
      };
    })
    /*
     * Chỉ giữ chiến lược CÒN vốn. Trước đây `tradeCount > 0` là đủ, nên một chiến
     * lược đã thoát sạch vẫn nằm trên biểu đồ với 0% — chiếm một dòng và một màu để
     * nói rằng không còn gì. Lịch sử giao dịch đã có chỗ riêng của nó.
     */
    .filter((s) => s.netCapital !== 0n);
}

// ---------------------------------------------------------------------------
// Trạng thái dữ liệu thị trường (§10)
// ---------------------------------------------------------------------------

export async function getMarketDataStatus(
  positions: readonly PositionView[] = [],
): Promise<MarketDataStatus> {
  const [lastSync, staleSetting] = await Promise.all([
    prisma.marketDataSync.findFirst({
      where: { status: 'SUCCESS' },
      orderBy: { finishedAt: 'desc' },
      select: {
        finishedAt: true,
        source: true,
        symbolsUpdated: true,
        symbolsRequested: true,
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: 'market_data.stale_after_minutes' } }),
  ]);

  const staleAfterMinutes = Number(staleSetting?.value ?? 15);
  const lastSuccessAt = lastSync?.finishedAt ?? null;
  const ageMinutes = lastSuccessAt
    ? Math.floor((Date.now() - lastSuccessAt.getTime()) / 60_000)
    : null;

  /*
   * ĐO BẰNG PHIÊN, KHÔNG BẰNG PHÚT — ngoài giờ giao dịch.
   *
   * Quy tắc cũ: "quá 120 phút kể từ lần lấy giá cuối = trễ". Hậu quả là mỗi tối và
   * trọn hai ngày cuối tuần, Dashboard đều báo trễ trong khi giá đang lưu là giá
   * đóng cửa phiên gần nhất — tức là MỚI NHẤT CÓ THỂ CÓ. Đã đo được "trễ 1338 phút"
   * vào một chiều thứ Bảy, với giá đóng cửa thứ Sáu hoàn toàn đúng.
   *
   * Một cảnh báo bật gần như suốt ngày không còn là cảnh báo: người dùng học cách
   * bỏ qua nó, và đến lúc dữ liệu hỏng thật thì không ai nhìn.
   */
  const duringSession = inTradingSession();
  const expectedSession = lastClosedSession();

  const newestQuote = await prisma.marketQuote.findFirst({
    orderBy: { tradingDate: 'desc' },
    select: { tradingDate: true },
  });
  const quoteTradingDate = newestQuote?.tradingDate ?? null;
  const sessionsBehind = quoteTradingDate
    ? Math.max(0, sessionsBetween(quoteTradingDate, expectedSession))
    : Number.POSITIVE_INFINITY;

  return {
    duringSession,
    quoteTradingDate,
    expectedSession,
    sessionsBehind,
    connected: duringSession
      ? ageMinutes !== null && ageMinutes <= staleAfterMinutes
      : sessionsBehind === 0,
    lastSuccessAt,
    ageMinutes,
    staleAfterMinutes,
    symbolsUpdated: lastSync?.symbolsUpdated ?? 0,
    symbolsRequested: lastSync?.symbolsRequested ?? 0,
    source: lastSync?.source ?? null,
    missingPriceCount: positions.filter((p) => p.quantity > 0 && p.missingPrice).length,
  };
}

// ---------------------------------------------------------------------------
// Tổng hợp cho Dashboard (§12, §14)
// ---------------------------------------------------------------------------

export async function computePortfolioSummary(
  filter: EngineFilter & { portfolioId: string },
): Promise<PortfolioSummary> {
  const portfolio = await prisma.portfolio.findUniqueOrThrow({
    where: { id: filter.portfolioId },
    select: { id: true, code: true, name: true, nameVi: true },
  });

  const [positions, cash, strategyAllocation] = await Promise.all([
    computePositions(filter),
    /*
     * Tiền chỉ theo được chiều NHÓM. Lọc theo ngành hay chiến lược thì tiền vẫn là
     * của toàn danh mục — vốn được cấp cho người, không cấp cho ngành.
     */
    computeCash(
      filter.portfolioId,
      filter.teamId !== undefined ? { teamId: filter.teamId } : {},
    ),
    computeStrategyAllocation(filter),
  ]);

  const open = positions.filter((p) => p.quantity > 0);
  const investedValue = open.reduce((s, p) => s + p.marketValue, 0n);
  const investedCost = open.reduce((s, p) => s + p.totalCost, 0n);
  const unrealizedPnl = open.reduce((s, p) => s + p.unrealizedPnl, 0n);
  const realizedPnl = positions.reduce((s, p) => s + p.realizedPnl, 0n);
  const totalPnl = realizedPnl + unrealizedPnl;

  const portfolioValue = investedValue + cash.cashBalance;

  const marketData = await getMarketDataStatus(positions);

  return {
    portfolioId: portfolio.id,
    portfolioCode: portfolio.code,
    portfolioName: portfolio.nameVi ?? portfolio.name,

    portfolioValue,
    investedValue,
    investedCost,
    cash,

    realizedPnl,
    unrealizedPnl,
    totalPnl,
    // Lợi nhuận tính trên vốn đã bỏ ra, không trên tổng giá trị danh mục — nếu
    // chia cho portfolioValue thì tiền chưa dùng sẽ pha loãng hiệu suất đầu tư.
    totalPnlBps: ratioToBps(totalPnl, investedCost),

    allocation: {
      investedBps: ratioToBps(investedValue, portfolioValue),
      cashBps: ratioToBps(cash.availableCash, portfolioValue),
      reserveBps: ratioToBps(cash.reserveAmount, portfolioValue),
    },

    positions,
    positionCount: open.length,
    sectorExposure: computeSectorExposure(positions),
    strategyAllocation,
    marketData,
  };
}

// ---------------------------------------------------------------------------
// Hiệu suất so với chỉ số (§13)
// ---------------------------------------------------------------------------

export type PeriodCode = '1W' | '1M' | '3M' | '6M' | 'YTD' | 'ALL';

export function periodStart(period: PeriodCode, now = new Date()): Date | undefined {
  const d = new Date(now);
  switch (period) {
    case '1W':
      d.setDate(d.getDate() - 7);
      return d;
    case '1M':
      d.setMonth(d.getMonth() - 1);
      return d;
    case '3M':
      d.setMonth(d.getMonth() - 3);
      return d;
    case '6M':
      d.setMonth(d.getMonth() - 6);
      return d;
    case 'YTD':
      return new Date(d.getFullYear(), 0, 1);
    case 'ALL':
      return undefined;
  }
}

export interface PerformanceComparison {
  /**
   * Hiệu suất danh mục TRONG KHOẢNG, bps. Xem `source` để biết nó tính từ đâu.
   *
   * Khi `source === 'current'` đây KHÔNG phải hiệu suất theo khoảng mà là lãi/lỗ
   * trên giá vốn toàn thời gian — lúc đó `comparable` là false và nơi hiển thị
   * không được trình bày nó như một mức thay đổi theo thời gian.
   */
  portfolioBps: number;
  benchmarkBps: number;
  alphaBps: number;
  benchmarkCode: string;

  /**
   * NGUỒN của `portfolioBps`, quyết định con số có nghĩa gì:
   *
   *   'snapshots'  ảnh chụp cuối ngày thật — chính xác nhất, có tính dòng vốn.
   *   'series'     dựng lại từng phiên từ `price_history` (§23, không đọc số lưu sẵn).
   *   'current'    KHÔNG có dữ liệu theo phiên; rơi về lãi/lỗ trên giá vốn toàn
   *                thời gian. Đây là con số KHÁC ĐẠI LƯỢNG, không phải hiệu suất
   *                theo khoảng.
   */
  source: 'snapshots' | 'series' | 'current';

  /**
   * Khoảng thời gian THẬT mà `portfolioBps` phủ — không phải khoảng người dùng chọn.
   *
   * Hai thứ này lệch nhau là chuyện bình thường: chọn "Từ đầu năm" nhưng
   * `price_history` chỉ có từ 10/02 thì con số chỉ phủ từ 10/02. Trả về đây để
   * giao diện IN RA ngày thật thay vì nhắc lại tên khoảng mà nó không phủ hết.
   */
  window: { from: Date; to: Date; sessions: number } | null;

  /**
   * true khi `portfolioBps` và `benchmarkBps` đo trên CÙNG một khoảng, nên trừ
   * nhau ra Alpha là hợp lệ.
   *
   * false thì `alphaBps` là hiệu của hai đại lượng khác khoảng — vô nghĩa, và nơi
   * hiển thị phải in "—" chứ không in con số đó.
   */
  comparable: boolean;

  benchmarkFrom: { date: Date; value: bigint } | null;
  benchmarkTo: { date: Date; value: bigint } | null;
  /** Chuỗi ảnh chụp cuối ngày, nếu đã có. */
  snapshots: {
    date: Date;
    marketValue: bigint;
    costValue: bigint;
    totalPnlBps: number;
    benchmarkClose: bigint | null;
  }[];
}

/**
 * Đổi chỉ số đã chuẩn hoá (100 = mốc đầu khoảng) thành bps.
 *
 * Làm tròn nửa RA XA 0 cho khớp cách `ratioToBps` làm tròn, để hai đường tính
 * không lệch nhau 1 bps ở những con số nằm đúng giữa.
 */
function indexToBps(index: number): number {
  const bps = (index / 100 - 1) * 10_000;
  return bps >= 0 ? Math.round(bps) : -Math.round(-bps);
}

/**
 * So sánh hiệu suất danh mục với VN-Index (§13).
 *
 * BA NGUỒN, XÉT THEO THỨ TỰ ĐỘ TIN CẬY — xem `source`.
 *
 * VÌ SAO PHẢI DÙNG CHUỖI DỰNG LẠI. Trước đây hàm này chỉ có hai đường: ảnh chụp
 * cuối ngày, hoặc rơi về `currentPnlBps`. Bảng `portfolio_snapshots` chưa từng
 * được ghi (chưa có tiến trình chốt cuối ngày), nên nó LUÔN rơi về đường dự
 * phòng. Hậu quả đo được: mọi khoảng — 1 tuần, 1 tháng, từ đầu năm, toàn bộ —
 * đều in ra cùng một con số −3,17%, trong khi nhãn bên cạnh đổi theo khoảng. Tệ
 * hơn, Alpha lấy vế danh mục toàn thời gian trừ vế chỉ số CÓ lọc theo khoảng, nên
 * Alpha nhảy từ +0,85% (3 tháng) xuống −20,22% (toàn bộ) chỉ vì vế chỉ số đổi.
 *
 * `computePerformanceSeries` đã dựng lại giá trị và giá vốn của TỪNG PHIÊN từ
 * `price_history`, nên hiệu suất theo khoảng tính được ngay mà không cần bảng ảnh
 * chụp. Hàm này nhận chuỗi đó thay vì tự tính lại — nơi gọi vốn đã cần chuỗi để
 * vẽ biểu đồ.
 *
 * HAI VẾ LẤY TỪ CÙNG MỘT ĐIỂM. Cả `portfolioIndex` và `benchmarkIndex` đều được
 * chuẩn hoá về 100 tại CÙNG phiên đầu, và ở đây cả hai được đọc tại CÙNG phiên
 * cuối. Nhờ vậy Alpha là hiệu của hai số cùng gốc, cùng đích. Lấy vế chỉ số từ
 * một truy vấn riêng theo `period` sẽ cho nó một khoảng dài hơn khoảng của vế
 * danh mục — đúng cái lỗi vừa sửa.
 */
export async function computePerformance(
  portfolioId: string,
  period: PeriodCode,
  currentPnlBps: number,
  series: { points: readonly PerformancePoint[] },
): Promise<PerformanceComparison> {
  const from = periodStart(period);

  const [indexRows, snapshots] = await Promise.all([
    prisma.marketIndexHistory.findMany({
      where: {
        indexCode: DEFAULT_BENCHMARK,
        ...(from ? { tradingDate: { gte: from } } : {}),
      },
      orderBy: { tradingDate: 'asc' },
      select: { tradingDate: true, closeValue: true },
    }),
    prisma.portfolioSnapshot.findMany({
      where: { portfolioId, ...(from ? { snapshotDate: { gte: from } } : {}) },
      orderBy: { snapshotDate: 'asc' },
      select: {
        snapshotDate: true,
        marketValue: true,
        costValue: true,
        realizedPnl: true,
        unrealizedPnl: true,
        benchmarkClose: true,
      },
    }),
  ]);

  const first = indexRows[0] ?? null;
  const last = indexRows[indexRows.length - 1] ?? null;

  /** Vế chỉ số tính riêng theo `period` — chỉ dùng khi không ghép được cùng gốc. */
  const indexOnlyBps =
    first && last && first !== last
      ? ratioToBps(last.closeValue - first.closeValue, first.closeValue)
      : 0;

  const common = {
    benchmarkCode: DEFAULT_BENCHMARK,
    benchmarkFrom: first ? { date: first.tradingDate, value: first.closeValue } : null,
    benchmarkTo: last ? { date: last.tradingDate, value: last.closeValue } : null,
    snapshots: snapshots.map((s) => ({
      date: s.snapshotDate,
      marketValue: s.marketValue,
      costValue: s.costValue,
      totalPnlBps: ratioToBps(s.realizedPnl + s.unrealizedPnl, s.costValue),
      benchmarkClose: s.benchmarkClose,
    })),
  };

  // --- 1. Ảnh chụp cuối ngày ------------------------------------------------
  /*
   * CHƯA KIỂM ĐƯỢC TRÊN DỮ LIỆU THẬT: bảng `portfolio_snapshots` đang rỗng vì
   * chưa có tiến trình chốt cuối ngày. Nhánh này giữ nguyên công thức cũ, chỉ bổ
   * sung phần ghép vế chỉ số từ `benchmarkClose` của chính ảnh chụp — cột đó tồn
   * tại đúng để hai vế cùng gốc. Khi nào có tiến trình ghi, phải kiểm lại nhánh
   * này trước khi tin nó.
   */
  if (snapshots.length >= 2) {
    const s0 = snapshots[0]!;
    const sN = snapshots[snapshots.length - 1]!;

    const portfolioBps = ratioToBps(
      sN.realizedPnl + sN.unrealizedPnl - (s0.realizedPnl + s0.unrealizedPnl),
      s0.costValue,
    );

    const aligned =
      s0.benchmarkClose !== null && sN.benchmarkClose !== null && s0.benchmarkClose > 0n;
    const benchmarkBps = aligned
      ? ratioToBps(sN.benchmarkClose! - s0.benchmarkClose!, s0.benchmarkClose!)
      : indexOnlyBps;

    return {
      ...common,
      portfolioBps,
      benchmarkBps,
      alphaBps: portfolioBps - benchmarkBps,
      source: 'snapshots',
      window: { from: s0.snapshotDate, to: sN.snapshotDate, sessions: snapshots.length },
      comparable: aligned,
    };
  }

  // --- 2. Chuỗi dựng lại từ price_history ----------------------------------
  /*
   * Chỉ lấy các phiên CÓ chỉ số, rồi đọc phiên cuối trong số đó: bảo đảm hai vế
   * kết thúc ở cùng một ngày. `benchmarkIndex` là null khi phiên đó thiếu dòng
   * chỉ số, và nếu chính phiên ĐẦU thiếu thì mọi `benchmarkIndex` đều null —
   * `withIndex` rỗng và ta rơi xuống nhánh 3.
   */
  const withIndex = series.points.filter((p) => p.benchmarkIndex !== null);

  if (withIndex.length >= 2) {
    const end = withIndex[withIndex.length - 1]!;
    const portfolioBps = indexToBps(end.portfolioIndex);
    const benchmarkBps = indexToBps(end.benchmarkIndex!);

    return {
      ...common,
      portfolioBps,
      benchmarkBps,
      alphaBps: portfolioBps - benchmarkBps,
      source: 'series',
      window: {
        /*
         * Gốc là phiên đầu của CHUỖI — nơi cả hai chỉ số bằng 100 — không phải
         * phiên đầu của `withIndex`. Hai cái này trùng nhau khi phiên đầu có
         * chỉ số, và `withIndex` không rỗng nghĩa là nó có.
         */
        from: series.points[0]!.date,
        to: end.date,
        sessions: series.points.length,
      },
      comparable: true,
    };
  }

  // --- 3. Không có dữ liệu theo phiên --------------------------------------
  /*
   * `currentPnlBps` là lãi/lỗ trên giá vốn TOÀN THỜI GIAN, không phải hiệu suất
   * theo khoảng. Vẫn trả về để trang có gì mà hiện, nhưng `comparable: false` và
   * `window: null` nói rõ rằng nó không được trình bày như một mức thay đổi theo
   * thời gian, và Alpha không được tính từ nó.
   */
  return {
    ...common,
    portfolioBps: currentPnlBps,
    benchmarkBps: indexOnlyBps,
    alphaBps: currentPnlBps - indexOnlyBps,
    source: 'current',
    window: null,
    comparable: false,
  };
}

// ---------------------------------------------------------------------------
// Chuỗi hiệu suất theo ngày (§13) — dữ liệu cho biểu đồ đường
// ---------------------------------------------------------------------------

export interface PerformancePoint {
  date: Date;
  /** Giá trị thị trường của vị thế tại ngày đó. */
  marketValue: bigint;
  costValue: bigint;
  /** Lợi nhuận trên giá vốn, bps. */
  returnBps: number;
  /** Chuẩn hoá về 100 tại phiên đầu của khoảng. */
  portfolioIndex: number;
  benchmarkIndex: number | null;
  benchmarkClose: bigint | null;
}

/**
 * Tính lại giá trị danh mục cho TỪNG PHIÊN từ `price_history`.
 *
 * Đây là dữ liệu cho biểu đồ đường của §13. Vẫn giữ nguyên tắc §23: không đọc
 * giá trị nào được lưu sẵn — mỗi phiên được dựng lại từ giao dịch tính tới ngày
 * đó nhân với giá đóng cửa của đúng ngày đó.
 *
 * GIỚI HẠN CẦN BIẾT: chuỗi chỉ dài bằng phần `price_history` đang có. Nếu mới
 * chạy `sync.py history --days 30` thì chuỗi chỉ có 30 ngày, dù danh mục đã hoạt
 * động lâu hơn. Hàm trả về `coverageDays` để giao diện nói thật điều đó thay vì
 * hiển thị một đường trông như toàn bộ lịch sử.
 *
 * Hai chuỗi được CHUẨN HOÁ VỀ 100 tại phiên đầu. Danh mục tính bằng đồng, chỉ số
 * tính bằng điểm — vẽ hai thang trên cùng một biểu đồ là tự bịa ra tương quan.
 *
 * CÓ NHẬN BỘ LỌC (§11). Trước đây hàm này chỉ nhận `portfolioId`, nên khi người
 * dùng lọc sang một nhóm thì KPI và Alpha vẫn hiện hiệu suất của TOÀN danh mục.
 * Lọc sang nhóm "Cá nhân" — nhóm không có vị thế nào — vẫn ra Alpha +6,29% của cả
 * danh mục. Nay điều kiện lọc dùng chung `tradeWhere()` với `computePositions()`,
 * nên hai nơi không thể lệch nhau.
 *
 * KHÔNG NHẬN `strategyId` — CỐ Ý. Lọc theo chiến lược phải nhân tiền theo
 * `allocationBps` của từng lệnh (§16, không đếm trùng vốn), và phép nhân đó tạo ra
 * khối lượng lẻ nên `computePositions()` phải giữ khối lượng ở đơn vị micro. Vòng
 * lặp trong hàm này chạy trên khối lượng nguyên. Lọc lệnh mà KHÔNG nhân tỷ lệ sẽ
 * cho một con số quá cao trông hoàn toàn bình thường — nên thà bỏ qua chiều này và
 * để nơi gọi nói rõ rằng đường đang là của toàn danh mục.
 */
export async function computePerformanceSeries(
  portfolioId: string,
  period: PeriodCode,
  filter: Omit<EngineFilter, 'portfolioId' | 'strategyId' | 'from' | 'to'> = {},
): Promise<{ points: PerformancePoint[]; coverageDays: number; benchmarkCode: string }> {
  const from = periodStart(period);

  /*
   * Dùng chung `tradeWhere()` với `computePositions()`. Viết lại điều kiện ở đây
   * là mở đường cho hai nơi lệch nhau — và lúc đó KPI với đường biểu đồ nói hai
   * điều khác nhau về cùng một nhóm mà không ai phát hiện.
   */
  const where = tradeWhere({ ...filter, portfolioId });

  const [trades, history, indexRows] = await Promise.all([
    prisma.trade.findMany({
      where,
      orderBy: [{ executedAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        stockId: true,
        transactionType: true,
        quantity: true,
        price: true,
        fees: true,
        tax: true,
        executedAt: true,
      },
    }),
    prisma.priceHistory.findMany({
      where: {
        ...(from ? { tradingDate: { gte: from } } : {}),
        /*
         * Cùng điều kiện lọc: chỉ lấy giá của những mã NẰM TRONG phạm vi. Lấy rộng
         * hơn thì `days` có thêm phiên mà phạm vi này chưa giữ gì, và phiên gốc
         * của chuỗi có thể bị đẩy về sớm hơn thực tế.
         */
        stock: { trades: { some: where } },
      },
      orderBy: { tradingDate: 'asc' },
      select: { stockId: true, tradingDate: true, closePrice: true },
    }),
    prisma.marketIndexHistory.findMany({
      where: { indexCode: DEFAULT_BENCHMARK, ...(from ? { tradingDate: { gte: from } } : {}) },
      orderBy: { tradingDate: 'asc' },
      select: { tradingDate: true, closeValue: true },
    }),
  ]);

  if (history.length === 0) {
    return { points: [], coverageDays: 0, benchmarkCode: DEFAULT_BENCHMARK };
  }

  // Giá đóng cửa theo (ngày, mã)
  const closeByDay = new Map<number, Map<string, bigint>>();
  for (const row of history) {
    const key = row.tradingDate.getTime();
    const inner = closeByDay.get(key) ?? new Map<string, bigint>();
    inner.set(row.stockId, row.closePrice);
    closeByDay.set(key, inner);
  }

  const indexByDay = new Map(indexRows.map((r) => [r.tradingDate.getTime(), r.closeValue]));
  const days = [...closeByDay.keys()].sort((a, b) => a - b);

  // Chạy tuần tự qua các phiên, cộng dồn giao dịch tới từng ngày.
  interface Holding {
    quantity: number;
    totalCost: bigint;
    avgCostMicro: bigint;
  }
  const holdings = new Map<string, Holding>();
  let tradeCursor = 0;
  /** Giá đóng cửa gần nhất đã biết của mỗi mã — dùng khi một phiên thiếu giá. */
  const lastClose = new Map<string, bigint>();

  const raw: { date: Date; marketValue: bigint; costValue: bigint }[] = [];

  for (const dayMs of days) {
    const dayEnd = new Date(dayMs);
    // Giao dịch được tính vào ngày nếu khớp trước hết ngày đó (23:59:59 UTC).
    dayEnd.setUTCHours(23, 59, 59, 999);

    while (tradeCursor < trades.length && trades[tradeCursor]!.executedAt <= dayEnd) {
      const t = trades[tradeCursor]!;
      const h = holdings.get(t.stockId) ?? { quantity: 0, totalCost: 0n, avgCostMicro: 0n };

      if (t.transactionType === 'BUY') {
        h.totalCost += costBasis(t.quantity, t.price, t.fees, t.tax);
        h.quantity += t.quantity;
        h.avgCostMicro = avgCostMicro(h.totalCost, h.quantity);
      } else {
        const costOfSold = divRound(h.avgCostMicro * BigInt(t.quantity), MICRO);
        h.totalCost -= costOfSold;
        h.quantity -= t.quantity;
        if (h.quantity <= 0) {
          h.quantity = 0;
          h.totalCost = 0n;
          h.avgCostMicro = 0n;
        }
      }

      holdings.set(t.stockId, h);
      tradeCursor += 1;
    }

    const closes = closeByDay.get(dayMs)!;
    for (const [stockId, price] of closes) lastClose.set(stockId, price);

    let marketValue = 0n;
    let costValue = 0n;
    for (const [stockId, h] of holdings) {
      if (h.quantity <= 0) continue;
      const price = closes.get(stockId) ?? lastClose.get(stockId);
      // Mã chưa có giá ở phiên nào thì bỏ qua CẢ giá trị lẫn giá vốn của nó —
      // nếu cộng giá vốn mà không cộng giá trị thì đường hiệu suất bị kéo xuống giả.
      if (price === undefined) continue;
      marketValue += BigInt(h.quantity) * price;
      costValue += h.totalCost;
    }

    // Chỉ giữ phiên đã có vị thế — trước lệnh mua đầu tiên thì không có gì để vẽ.
    if (costValue > 0n) {
      raw.push({ date: new Date(dayMs), marketValue, costValue });
    }
  }

  if (raw.length === 0) {
    return { points: [], coverageDays: 0, benchmarkCode: DEFAULT_BENCHMARK };
  }

  const baseReturnBps = ratioToBps(raw[0]!.marketValue - raw[0]!.costValue, raw[0]!.costValue);
  const firstIndex = indexByDay.get(raw[0]!.date.getTime()) ?? null;

  const points: PerformancePoint[] = raw.map((r) => {
    const returnBps = ratioToBps(r.marketValue - r.costValue, r.costValue);
    const close = indexByDay.get(r.date.getTime()) ?? null;

    return {
      date: r.date,
      marketValue: r.marketValue,
      costValue: r.costValue,
      returnBps,
      // Chuẩn hoá: (1 + r_t) / (1 + r_0) × 100
      portfolioIndex: (100 * (1 + returnBps / 10_000)) / (1 + baseReturnBps / 10_000),
      benchmarkIndex:
        close !== null && firstIndex !== null && firstIndex > 0n
          ? (100 * Number(close)) / Number(firstIndex)
          : null,
      benchmarkClose: close,
    };
  });

  return {
    points,
    coverageDays: points.length,
    benchmarkCode: DEFAULT_BENCHMARK,
  };
}

// ---------------------------------------------------------------------------
// Phạm vi dữ liệu theo quyền
// ---------------------------------------------------------------------------

/**
 * Ép bộ lọc theo quyền của người dùng.
 *
 * Người chỉ có `*.view` (không có `*.view_all`) bị giới hạn vào nhóm của mình.
 * Đây là chốt bắt buộc: nếu chỉ dựa vào giao diện không hiện lựa chọn "tất cả",
 * người dùng vẫn có thể sửa query string.
 */
export function applyScope(
  filter: EngineFilter,
  scope: 'ALL' | 'SCOPED' | 'NONE',
  userTeamId: string | null,
): EngineFilter {
  if (scope === 'ALL') return filter;
  if (scope === 'NONE') return { ...filter, teamId: '__no_access__' };
  // SCOPED: buộc về nhóm của người dùng, bỏ qua teamId họ tự truyền vào.
  return { ...filter, teamId: userTeamId ?? '__no_team__' };
}

// ---------------------------------------------------------------------------
// Hiệu suất theo nhóm (§2 × §9)
// ---------------------------------------------------------------------------

export interface TeamPerformance {
  /** Rỗng với dòng tổng hợp "không thuộc nhóm". */
  teamId: string;
  code: string;
  nameVi: string;
  /**
   * true với dòng gom các giao dịch chưa được gán nhóm.
   *
   * Đây KHÔNG phải một nhóm trong bảng `teams`. Nó tồn tại để tổng theo nhóm
   * luôn bằng toàn danh mục — thiếu nó thì con số bị hụt mà biểu đồ vẫn trông
   * hoàn chỉnh, và đó là kiểu sai tệ nhất.
   */
  unassigned: boolean;
  /**
   * Các mã mà nhóm này có lệnh BÁN nhưng lệnh MUA nằm ngoài phạm vi nhóm.
   *
   * Rỗng là bình thường. Khác rỗng nghĩa là mọi con số của nhóm đang thiếu một nửa
   * câu chuyện: `trades.teamId` đóng băng lúc ghi lệnh, nên người đổi nhóm giữa lệnh
   * mua và lệnh bán để hai lệnh của cùng một lô ở hai nhóm. Lúc đó vốn triển khai âm,
   * lãi/lỗ đã chốt không tính được, và vị thế khối lượng âm bị lọc mất.
   *
   * Trang hiển thị PHẢI nói ra thay vì đưa những con số đó như số bình thường.
   */
  brokenLotSymbols: string[];
  /**
   * Slot màu CỐ ĐỊNH, lấy từ thứ tự bảng chữ cái của `code`.
   *
   * KHÔNG theo vị trí trong mảng kết quả: mảng được sắp theo giá trị, nên gán
   * màu theo vị trí sẽ làm nhóm Đá Bóng đổi màu mỗi khi nó vượt hay tụt so với
   * Cầu Lông. Màu phải theo THỰC THỂ để người đã học "Đá Bóng màu xanh" không bị
   * dẫn sai. Teams chưa có cột `sortOrder` nên `code` là khoá ổn định sẵn có.
   */
  colorIndex: number;

  /** Vốn ròng đã triển khai: tiền thực chi khi mua trừ tiền thực thu khi bán. */
  netCapital: bigint;
  /** Giá vốn của phần vị thế nhóm này đang giữ. */
  investedCost: bigint;
  marketValue: bigint;

  realizedPnl: bigint;
  unrealizedPnl: bigint;
  totalPnl: bigint;
  /** Lãi/lỗ trên giá vốn đã bỏ ra, bps. */
  returnBps: number;

  tradeCount: number;
  positionCount: number;
  memberCount: number;

  /**
   * Vị thế của riêng nhóm này, đã sắp theo giá trị thị trường giảm dần.
   *
   * Đi kèm sẵn thay vì để nơi gọi tự truy vấn lại: vị thế đã được tính ở đây rồi
   * (đó là cách duy nhất ra được các con số trên), nên trả về là miễn phí. Tính
   * lại ở tầng trên sẽ là chạy `computePositions` lần thứ hai cho cùng một nhóm.
   */
  positions: PositionView[];
  /** Tỷ trọng ngành TRONG NỘI BỘ nhóm — gập từ `positions`, không truy vấn thêm. */
  sectorExposure: SectorExposure[];
}

/**
 * Tách hiệu suất danh mục theo NHÓM.
 *
 * Mỗi nhóm được tính từ ĐÚNG chuỗi giao dịch của nó (`computePositions` với
 * `teamId`), nên con số trả lời được câu hỏi quản trị thật: *nhóm này tự làm ra
 * bao nhiêu*. Không phải chia tỷ lệ số tổng của danh mục cho các nhóm — cách đó
 * cho ra những con số cộng lại đúng nhưng không có nghĩa gì với từng nhóm.
 *
 * ĐIỀU CẦN BIẾT VỀ GIÁ VỐN TRUNG BÌNH: giá vốn của mỗi nhóm được tính riêng trên
 * chuỗi lệnh của nhóm đó. Nếu Đá Bóng mua MBB ở 25.000 và Cầu Lông mua MBB ở
 * 21.000 thì hai nhóm có hai giá vốn khác nhau cho cùng một mã — và đó chính là
 * điều đúng cần hiển thị. Giá vốn trung bình toàn danh mục là một con số thứ ba,
 * không phải trung bình của hai con số kia.
 *
 * Tuần tự chứ không song song: mỗi nhóm là một loạt truy vấn, chạy song song bốn
 * nhóm sẽ làm nghẽn connection pool của SQLite.
 *
 * `options.onlyTeamId` giới hạn phép tính vào một nhóm. Dùng khi người xem chỉ
 * được thấy nhóm của họ: không tính những nhóm sẽ không hiển thị là vừa nhanh hơn
 * vừa đúng nguyên tắc tối thiểu quyền — số liệu người dùng không được xem thì
 * không nên tồn tại trong tiến trình xử lý request của họ.
 */
/**
 * Danh sách nhóm theo THỨ TỰ CỐ ĐỊNH, kèm mục ảo "không thuộc nhóm" ở cuối.
 *
 * Dùng chung cho `computeTeamPerformance` và `computeMemberPerformance`. Trước
 * đây chỉ hàm theo nhóm có bảng này; nếu hàm theo cá nhân tự dựng lại thứ tự
 * riêng thì cùng một nhóm sẽ có hai slot màu khác nhau ở hai khối nằm cạnh nhau
 * trên cùng một trang — người đọc học "Đá Bóng màu xanh" ở khối trên rồi thấy
 * nó màu tím ở khối dưới. Một bảng, một thứ tự.
 */
async function teamBuckets() {
  const teams = await prisma.team.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
    select: {
      id: true,
      code: true,
      nameVi: true,
      _count: { select: { members: true } },
    },
  });

  /*
   * Danh sách quét gồm cả một mục ẢO cho phần chưa gán nhóm. Đặt nó CÙNG một
   * vòng lặp thay vì tính riêng ở dưới để không có hai đường tính song song —
   * hai đường thì sớm muộn sẽ lệch nhau.
   */
  return [
    ...teams.map((t) => ({
      teamId: t.id,
      code: t.code,
      nameVi: t.nameVi,
      memberCount: t._count.members,
    })),
    {
      teamId: null as string | null,
      code: 'UNASSIGNED',
      nameVi: 'Không thuộc nhóm',
      memberCount: 0,
    },
  ];
}

/**
 * Slot màu theo id nhóm (chuỗi rỗng = không thuộc nhóm).
 *
 * Tách riêng để cả hai hàm hiệu suất tra cùng một bảng.
 */
function colorSlots(buckets: readonly { teamId: string | null }[]) {
  return new Map(buckets.map((b, i) => [b.teamId ?? '', i]));
}

export async function computeTeamPerformance(
  portfolioId: string,
  options: { onlyTeamId?: string } = {},
): Promise<TeamPerformance[]> {
  const buckets = await teamBuckets();

  /*
   * SLOT MÀU LẤY TỪ DANH SÁCH ĐẦY ĐỦ, tính TRƯỚC khi lọc.
   *
   * Nếu gán `colorIndex` theo vị trí trong danh sách đã lọc thì nhóm Tài chính sẽ
   * là màu 0 khi người của nó xem một mình, nhưng là màu 3 khi Ban lãnh đạo xem
   * cả bốn nhóm — cùng một nhóm, hai màu, tuỳ ai đang đăng nhập. Màu phải theo
   * THỰC THỂ, và "thực thể" ở đây là vị trí trong danh sách nhóm đầy đủ.
   */
  const colorOf = colorSlots(buckets);

  const selected =
    options.onlyTeamId === undefined
      ? buckets
      : buckets.filter((b) => b.teamId === options.onlyTeamId);

  const out: TeamPerformance[] = [];

  for (const team of selected) {
    const index = colorOf.get(team.teamId ?? '') ?? 0;
    const [positions, tradeCount] = await Promise.all([
      computePositions({ portfolioId, teamId: team.teamId }),
      prisma.trade.count({
        where: { portfolioId, teamId: team.teamId, status: COUNTED_TRADE_STATUS },
      }),
    ]);

    const open = positions.filter((p) => p.quantity > 0);
    const investedCost = open.reduce((s, p) => s + p.totalCost, 0n);
    const marketValue = open.reduce((s, p) => s + p.marketValue, 0n);
    const unrealizedPnl = open.reduce((s, p) => s + p.unrealizedPnl, 0n);
    const realizedPnl = positions.reduce((s, p) => s + p.realizedPnl, 0n);
    const totalPnl = realizedPnl + unrealizedPnl;

    /*
     * Vốn ròng triển khai lấy từ dòng tiền thật của các lệnh, KHÔNG phải
     * `investedCost`. Hai con số khác nhau: bán hết một mã có lãi làm
     * `investedCost` về 0 nhưng vốn ròng vẫn âm (đã rút về nhiều hơn bỏ ra).
     */
    const trades = await prisma.trade.findMany({
      where: { portfolioId, teamId: team.teamId, status: COUNTED_TRADE_STATUS },
      select: { transactionType: true, quantity: true, price: true, fees: true, tax: true },
    });

    const netCapital = trades.reduce((sum, t) => {
      const net = netAmount(
        t.transactionType === TRANSACTION_TYPE.BUY ? 'BUY' : 'SELL',
        t.quantity,
        t.price,
        t.fees,
        t.tax,
      );
      return t.transactionType === TRANSACTION_TYPE.BUY ? sum + net : sum - net;
    }, 0n);

    out.push({
      teamId: team.teamId ?? '',
      code: team.code,
      nameVi: team.nameVi,
      unassigned: team.teamId === null,
      brokenLotSymbols: positions
        .filter((p) => p.unmatchedSellQuantity > 0)
        .map((p) => p.symbol),
      colorIndex: index,
      netCapital,
      investedCost,
      marketValue,
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      returnBps: ratioToBps(totalPnl, investedCost),
      tradeCount,
      positionCount: open.length,
      memberCount: team.memberCount,

      /*
       * Sắp theo giá trị thị trường giảm dần ngay tại đây để mọi nơi hiển thị
       * dùng cùng một thứ tự. Nếu để nơi gọi tự sắp thì hai trang sẽ hiện "Top
       * vị thế" theo hai thứ tự khác nhau mà không ai để ý.
       */
      positions: [...open].sort((a, b) =>
        b.marketValue > a.marketValue ? 1 : b.marketValue < a.marketValue ? -1 : 0,
      ),
      /*
       * Tỷ trọng ngành tính LẠI trong phạm vi nhóm, nên `weightBps` là phần trăm
       * của chính nhóm đó chứ không phải của toàn danh mục. Đây mới là con số trả
       * lời "nhóm này đang dồn vào ngành nào" — dùng tỷ trọng toàn danh mục thì
       * một nhóm nhỏ trông như không tập trung vào gì cả.
       */
      sectorExposure: computeSectorExposure(open),
    });
  }

  /*
   * Bỏ dòng "không thuộc nhóm" khi nó rỗng: mọi lệnh đã có nhóm là trạng thái
   * bình thường, và hiển thị một dòng 0 sẽ khiến người đọc đi tìm vấn đề không
   * có. Nó chỉ xuất hiện đúng khi thật sự có lệnh chưa được gán.
   */
  return out.filter((t) => !t.unassigned || t.tradeCount > 0);
}

// ---------------------------------------------------------------------------
// Hiệu suất theo cá nhân (§2 × §9)
// ---------------------------------------------------------------------------

export interface MemberPerformance {
  userId: string;
  fullName: string;
  employeeCode: string | null;
  /** null = người này không thuộc nhóm nào. */
  teamId: string | null;
  teamNameVi: string;
  /**
   * Slot màu của NHÓM người này thuộc về, KHÔNG phải của riêng người.
   *
   * Có chủ đích: hai người cùng nhóm mang cùng một màu, nên khi nhìn danh sách
   * cá nhân người đọc thấy ngay "hai dòng xanh này đều là Đá Bóng" mà không phải
   * đọc cột nhóm. Cho mỗi người một màu riêng thì màu không còn nói gì cả —
   * mười người là mười màu, và bảng màu phân loại chỉ có tám slot phân biệt được.
   */
  colorIndex: number;

  /** Giá vốn của phần vị thế người này ĐANG giữ. 0 khi đã chốt hết. */
  investedCost: bigint;
  marketValue: bigint;

  realizedPnl: bigint;
  unrealizedPnl: bigint;
  totalPnl: bigint;
  /**
   * Lãi/lỗ trên giá vốn đang giữ, bps — hoặc `null` khi không định nghĩa được.
   *
   * `null` xảy ra thật: người đã bán hết mọi mã có `investedCost = 0`, nên tỷ
   * suất là phép chia cho 0. `ratioToBps` trả về 0 trong trường hợp đó, và in
   * "+0,00%" cho một người vừa chốt lãi 100 triệu là nói sai hẳn. Trả `null` để
   * nơi hiển thị buộc phải chọn cách in — dấu "—" thay vì một con số bịa.
   */
  returnBps: number | null;

  tradeCount: number;
  positionCount: number;
}

/**
 * Lãi/lỗ của TỪNG CÁ NHÂN, sắp theo lợi nhuận tuyệt đối giảm dần.
 *
 * CHỈ NGƯỜI ĐÃ CÓ LỆNH KHỚP trong danh mục này. Người chưa giao dịch không có
 * lãi/lỗ bằng 0 — họ KHÔNG CÓ lãi/lỗ, và xếp họ ở mức 0% sẽ đặt họ trên mọi
 * người đang lỗ, đọc thành "không làm gì thì hơn".
 *
 * SẮP THEO SỐ TIỀN TUYỆT ĐỐI, không theo tỷ suất. Hai lý do:
 *
 *   1. Số tiền luôn định nghĩa được; tỷ suất thì không (xem `returnBps`). Xếp
 *      hạng theo một đại lượng có thể null nghĩa là phải bịa ra một quy tắc cho
 *      trường hợp null, và mọi quy tắc như vậy đều gây tranh cãi.
 *   2. "Lợi nhuận cao nhất" theo nghĩa thông thường là số tiền làm ra.
 *
 * Nhưng tỷ suất VẪN được trả về và phải được in cạnh số tiền: xếp theo tiền một
 * mình sẽ ưu ái người được cấp nhiều vốn hơn. Hai con số cạnh nhau thì người đọc
 * thấy được cả "làm ra bao nhiêu" và "trên bao nhiêu vốn".
 *
 * MỌI SỐ TÍNH TỪ CHUỖI LỆNH CỦA CHÍNH NGƯỜI ĐÓ (`trades.userId`), nên giá vốn ở
 * đây là giá vốn riêng của họ. Hai người cùng mua MBB ở hai mức giá có hai giá
 * vốn khác nhau, và đó chính là con số cần khi đánh giá từng người.
 *
 * PHẠM VI: `onlyTeamId` nhận đúng giá trị `EngineFilter.teamId` sau `applyScope`.
 * Chuỗi sentinel (`'__no_access__'`, `'__no_team__'`) không khớp nhóm nào nên tự
 * trả về danh sách rỗng — chốt quyền vẫn nằm ở `applyScope`, không nhân bản ở đây.
 */
export async function computeMemberPerformance(
  portfolioId: string,
  options: { onlyTeamId?: string | null } = {},
): Promise<MemberPerformance[]> {
  const traded = await prisma.trade.groupBy({
    by: ['userId'],
    where: { portfolioId, status: COUNTED_TRADE_STATUS },
    _count: { _all: true },
  });

  if (traded.length === 0) return [];

  const tradeCountOf = new Map(traded.map((t) => [t.userId, t._count._all]));

  const users = await prisma.user.findMany({
    where: { id: { in: traded.map((t) => t.userId) } },
    orderBy: { fullName: 'asc' },
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      team: { select: { id: true, nameVi: true } },
    },
  });

  const buckets = await teamBuckets();
  const colorOf = colorSlots(buckets);

  const selected =
    options.onlyTeamId === undefined
      ? users
      : users.filter((u) => (u.team?.id ?? null) === options.onlyTeamId);

  const out: MemberPerformance[] = [];

  for (const u of selected) {
    /*
     * `computePositions` với `userId` — KHÔNG lọc thêm theo nhóm. Nhóm của một
     * lệnh là nhóm lúc đặt lệnh; nếu người đó đã chuyển nhóm thì lệnh cũ vẫn
     * thuộc nhóm cũ. Lọc cả hai điều kiện sẽ làm biến mất chính những lệnh cần
     * tính, và tổng theo cá nhân không còn khớp tổng theo nhóm.
     */
    const positions = await computePositions({ portfolioId, userId: u.id });

    const open = positions.filter((p) => p.quantity > 0);
    const investedCost = open.reduce((s, p) => s + p.totalCost, 0n);
    const marketValue = open.reduce((s, p) => s + p.marketValue, 0n);
    const unrealizedPnl = open.reduce((s, p) => s + p.unrealizedPnl, 0n);
    const realizedPnl = positions.reduce((s, p) => s + p.realizedPnl, 0n);

    out.push({
      userId: u.id,
      fullName: u.fullName,
      employeeCode: u.employeeCode,
      teamId: u.team?.id ?? null,
      teamNameVi: u.team?.nameVi ?? 'Không thuộc nhóm',
      colorIndex: colorOf.get(u.team?.id ?? '') ?? 0,
      investedCost,
      marketValue,
      realizedPnl,
      unrealizedPnl,
      totalPnl: realizedPnl + unrealizedPnl,
      returnBps:
        investedCost === 0n ? null : ratioToBps(realizedPnl + unrealizedPnl, investedCost),
      tradeCount: tradeCountOf.get(u.id) ?? 0,
      positionCount: open.length,
    });
  }

  /*
   * Sắp ở ĐÂY, không để nơi gọi tự sắp: nếu hai trang cùng hiện "người lãi nhất"
   * theo hai thứ tự khác nhau thì không ai phát hiện, mà một trong hai đang sai.
   */
  return out.sort((a, b) =>
    b.totalPnl > a.totalPnl ? 1 : b.totalPnl < a.totalPnl ? -1 : 0,
  );
}

// ---------------------------------------------------------------------------
// Số dư từng tài khoản chứng khoán
// ---------------------------------------------------------------------------

export interface AccountBalance {
  accountId: string;
  broker: string;
  brokerOther: string | null;
  accountNo: string;
  /**
   * Tên IB đã dựng sẵn để hiển thị (`MÃ · Tên`), `null` = mở trực tiếp.
   *
   * Dựng ở đây thay vì trả `ibId` cho nơi gọi tự tra: bốn chỗ hiển thị mà mỗi chỗ
   * tự ghép thì bốn chỗ sẽ ghép mỗi kiểu một khác.
   */
  ibLabel: string | null;
  isActive: boolean;

  /** Σ dòng vốn của tài khoản này, đã tính theo dấu (nạp cộng, rút trừ). */
  granted: bigint;
  spentOnBuys: bigint;
  receivedFromSells: bigint;
  /**
   * Tiền còn dùng được ở tài khoản này: `granted − chi mua + thu bán`.
   *
   * KHÔNG trừ quỹ dự phòng — đó là khoản của cả danh mục (`portfolios.reserveAmount`),
   * trừ nó cho từng tài khoản là trừ cùng một khoản nhiều lần. Cùng lý do như phạm vi
   * nhóm trong `computeCash`.
   */
  available: bigint;

  /**
   * GIÁ TRỊ VỊ THẾ đang nằm ở tài khoản này, theo giá hiện tại.
   *
   * Cổ phiếu không nằm ở "danh mục" hay ở "một người" — nó nằm ở MỘT TÀI KHOẢN cụ
   * thể (xem `computeStrategyHoldings`). Nên "tài khoản này đang đáng bao nhiêu"
   * phải là `positionValue + available`, và hai phần đó là hai thứ khác nhau: một
   * phần biến động theo thị trường, một phần thì không.
   *
   * MÃ THIẾU GIÁ ĐÓNG GÓP 0, không bịa giá — cùng quy tắc với `computePositions`.
   * `symbolsMissingPrice` nói ra chuyện đó để nơi hiển thị không im lặng.
   *
   * Vị thế ÂM (bán quá số giữ — một lỗi dữ liệu) vẫn được TRỪ vào đây thay vì bỏ
   * qua: bỏ qua thì con số trông lành lặn trong khi dữ liệu đang sai.
   */
  positionValue: bigint;
  /** Mã đang giữ ở tài khoản này (khối lượng > 0). */
  heldSymbols: string[];
  /** Mã đang giữ nhưng `market_quotes` chưa có giá — phần giá trị bị thiếu. */
  symbolsMissingPrice: string[];

  tradeCount: number;
}

/**
 * Số dư của TỪNG tài khoản chứng khoán mà một người đang nắm.
 *
 * Đây là con số form nhập lệnh cần: "tài khoản này còn bao nhiêu tiền để mua".
 *
 * CHỈ TÍNH ĐƯỢC SAU KHI `trades.brokerAccountId` TỒN TẠI. Các lệnh có trước cột đó
 * mang `brokerAccountId = null` nên tiền của chúng không thuộc tài khoản nào — đúng
 * như vậy, vì lúc ghi chúng chưa có khái niệm tài khoản. Hệ quả cần biết: tổng số dư
 * các tài khoản KHÔNG bằng số dư tiền của danh mục cho tới khi mọi lệnh cũ được gán
 * tài khoản. Chênh lệch chính là phần vốn và phần lệnh chưa gắn tài khoản nào.
 */
export async function computeAccountBalances(
  portfolioId: string,
  userId: string,
): Promise<AccountBalance[]> {
  const accounts = await prisma.brokerAccount.findMany({
    where: { userId },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      broker: true,
      brokerOther: true,
      accountNo: true,
      ib: { select: { code: true, name: true } },
      isActive: true,
      capitalFlows: {
        where: { status: 'CONFIRMED' },
        select: { flowType: true, amount: true },
      },
      trades: {
        where: { portfolioId, status: COUNTED_TRADE_STATUS },
        select: {
          transactionType: true,
          quantity: true,
          price: true,
          fees: true,
          tax: true,
          stock: { select: { symbol: true, quote: { select: { price: true } } } },
        },
      },
    },
  });

  return accounts.map((a) => {
    /*
     * Cộng THEO DẤU của `flowType`, không cộng thẳng `amount`: `amount` luôn dương và
     * chiều tiền nằm ở `CAPITAL_FLOW_SIGN`. Cộng thẳng thì một lần rút lại làm tăng
     * số dư.
     */
    const granted = a.capitalFlows.reduce(
      (sum, f) => sum + BigInt(CAPITAL_FLOW_SIGN[f.flowType as CapitalFlowType]) * f.amount,
      0n,
    );

    let spentOnBuys = 0n;
    let receivedFromSells = 0n;

    /*
     * Khối lượng còn lại theo từng mã, gộp ngay trong vòng lặp đang có thay vì gọi
     * `computeStrategyHoldings` cho từng tài khoản — cách kia là N truy vấn cho N
     * tài khoản, và cùng một phép cộng.
     */
    const conLai = new Map<string, { qty: number; gia: bigint | null }>();

    for (const t of a.trades) {
      const ma = t.stock.symbol;
      const cu = conLai.get(ma) ?? { qty: 0, gia: t.stock.quote?.price ?? null };
      cu.qty += t.transactionType === TRANSACTION_TYPE.BUY ? t.quantity : -t.quantity;
      conLai.set(ma, cu);
    }

    let positionValue = 0n;
    const heldSymbols: string[] = [];
    const symbolsMissingPrice: string[] = [];
    for (const [ma, v] of conLai) {
      if (v.qty === 0) continue;
      if (v.qty > 0) heldSymbols.push(ma);
      if (v.gia === null) {
        if (v.qty > 0) symbolsMissingPrice.push(ma);
        continue;
      }
      positionValue += BigInt(v.qty) * v.gia;
    }
    heldSymbols.sort();
    symbolsMissingPrice.sort();

    for (const t of a.trades) {
      const net = netAmount(
        t.transactionType === TRANSACTION_TYPE.BUY ? 'BUY' : 'SELL',
        t.quantity,
        t.price,
        t.fees,
        t.tax,
      );
      if (t.transactionType === TRANSACTION_TYPE.BUY) spentOnBuys += net;
      else receivedFromSells += net;
    }

    return {
      accountId: a.id,
      broker: a.broker,
      brokerOther: a.brokerOther,
      accountNo: a.accountNo,
      ibLabel: a.ib ? `${a.ib.code} · ${a.ib.name}` : null,
      isActive: a.isActive,
      granted,
      spentOnBuys,
      receivedFromSells,
      available: granted - spentOnBuys + receivedFromSells,
      positionValue,
      heldSymbols,
      symbolsMissingPrice,
      tradeCount: a.trades.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Gộp theo IB — tài khoản chứng khoán mở "dưới IB nào"
// ---------------------------------------------------------------------------

export interface IbExposure {
  /** Khoá ổn định (tên IB đã chuẩn hoá chữ thường). Chuỗi rỗng = mở trực tiếp. */
  key: string;
  /** Tên hiện cho người đọc — cách gõ của tài khoản khai sớm nhất. */
  label: string;
  /** true = nhóm "mở trực tiếp", KHÔNG phải một IB. Giao diện phải nói rõ. */
  isDirect: boolean;

  accountCount: number;
  /** Số tài khoản còn hoạt động. Nhỏ hơn `accountCount` khi có tài khoản đã đóng. */
  activeAccountCount: number;
  /** Số NGƯỜI khác nhau — không bằng số tài khoản, một người mở được nhiều tài khoản. */
  memberCount: number;

  /** Σ dòng vốn đã xác nhận của các tài khoản dưới IB này, tính theo dấu. */
  netCapital: bigint;
  /** Phần của `netCapital` trên tổng. 0 khi tổng bằng 0. */
  weightBps: number;

  colorIndex: number;
}

/**
 * Số tài khoản và số tiền gộp theo IB (`broker_accounts.ibId`).
 *
 * Trả lời câu "IB nào đang mang về bao nhiêu tài khoản và bao nhiêu vốn".
 *
 * BỐN QUYẾT ĐỊNH ĐÁNG NÓI:
 *
 * 1. GỘP THEO `ibId`, KHÔNG THEO TÊN. Trước đây `ibName` là ô người dùng tự gõ, nên
 *    "Bùi Hải", "bùi hải" và " Bùi Hải " cùng xuất hiện và tách một IB thành ba
 *    dòng, mỗi dòng một phần vốn — cái sai đó trông y như dữ liệu thật nên không ai
 *    kiểm lại. Hàm này từng phải gộp theo tên chuẩn hoá để chữa. Nay IB là một bản
 *    ghi trong danh mục do quản trị khai và tài khoản trỏ vào `id` của nó, nên không
 *    còn biến thể nào để gộp: một IB là một dòng, kể cả khi đổi tên hiển thị.
 *
 * 2. `ibId` NULL KHÔNG BỊ BỎ. Nó thành một nhóm riêng `isDirect`, vì
 *    "không qua IB" là một câu trả lời thật (xem chú thích cột trong schema), chứ
 *    không phải dữ liệu thiếu. Bỏ nó đi thì tổng vốn theo IB nhỏ hơn tổng vốn
 *    thật mà không có gì báo.
 *
 * 3. TIỀN CỘNG THEO DẤU của `flowType`, và LỌC THEO DANH MỤC. `amount` luôn dương,
 *    chiều tiền nằm ở `CAPITAL_FLOW_SIGN`; cộng thẳng thì một lần rút lại làm tăng
 *    số tiền của IB. Lọc `portfolioId` vì `capital_flows` có cột đó: hôm nay hệ
 *    thống chỉ một danh mục nên lọc hay không cho cùng kết quả, nhưng viết đúng từ
 *    đầu thì thêm danh mục thứ hai không làm con số này sai âm thầm.
 *
 * 4. SLOT MÀU THEO LẦN XUẤT HIỆN ĐẦU TIÊN, không theo thứ hạng và không theo bảng
 *    chữ cái. Theo thứ hạng thì IB đổi màu mỗi lần đổi thứ tự; theo bảng chữ cái
 *    thì thêm một IB tên "An" sẽ sơn lại toàn bộ. Theo thứ tự khai thì màu của một
 *    IB không bao giờ đổi vì người khác làm gì.
 *
 * PHẠM VI: `onlyTeamId` lọc theo nhóm HIỆN TẠI của chủ tài khoản. Khác `computePositions`
 * — nhóm của một LỆNH là nhóm lúc đặt lệnh, còn một TÀI KHOẢN không có nhóm lịch sử,
 * nó thuộc về người, và người thuộc về nhóm hiện tại. Truyền `filter.teamId` đã qua
 * `applyScope` để chốt quyền vẫn nằm đúng một chỗ.
 */
export async function computeIbExposure(
  portfolioId: string,
  options: { onlyTeamId?: string | null } = {},
): Promise<IbExposure[]> {
  const accounts = await prisma.brokerAccount.findMany({
    // Sắp theo thời điểm khai để slot màu ổn định (quyết định 4).
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      ibId: true,
      ib: { select: { code: true, name: true } },
      isActive: true,
      createdAt: true,
      userId: true,
      user: { select: { teamId: true } },
      capitalFlows: {
        where: { status: CAPITAL_FLOW_STATUS.CONFIRMED, portfolioId },
        select: { flowType: true, amount: true },
      },
    },
  });

  interface Bucket {
    key: string;
    label: string;
    isDirect: boolean;
    accountCount: number;
    activeAccountCount: number;
    userIds: Set<string>;
    netCapital: bigint;
  }

  /*
   * HAI LƯỢT, và thứ tự giữa chúng là điều quan trọng.
   *
   * Lượt một quét TOÀN BỘ tài khoản để chốt slot màu; lượt hai mới lọc theo nhóm.
   * Làm gộp trong một lượt trên danh sách đã lọc thì IB "Mỹ" là màu 0 khi người
   * của nhóm Cầu Lông xem một mình, nhưng là màu 4 khi Ban lãnh đạo xem tất cả —
   * cùng một IB, hai màu, tuỳ ai đang đăng nhập. Đúng lỗi mà `computeTeamPerformance`
   * đã xử lý theo cách này.
   */
  /*
   * KHOÁ NHÓM. `ibId` cho IB có trong danh mục, chuỗi rỗng cho tài khoản mở trực
   * tiếp — giữ nguyên quy ước cũ để `key` rỗng vẫn là dấu hiệu của nhóm "trực tiếp".
   */
  const khoaNhom = (ibId: string | null): string => ibId ?? '';

  const slotMau = new Map<string, number>();
  for (const a of accounts) {
    const k = khoaNhom(a.ibId);
    if (!slotMau.has(k)) slotMau.set(k, slotMau.size);
  }

  const buckets = new Map<string, Bucket>();

  for (const a of accounts) {
    if (options.onlyTeamId !== undefined && (a.user.teamId ?? null) !== options.onlyTeamId) {
      continue;
    }

    const key = khoaNhom(a.ibId);
    /*
     * Tên hiển thị lấy từ danh mục, KHÔNG lưu bản sao. Quản trị sửa tên IB thì mọi
     * chỗ đổi theo ngay — trước đây tên nằm rải trong từng dòng tài khoản nên sửa
     * một chỗ không sửa được chỗ khác.
     */
    const nhanGoc = a.ib ? `${a.ib.code} · ${a.ib.name}` : '';

    let b = buckets.get(key);
    if (!b) {
      b = {
        key,
        // Tài khoản khai sớm nhất quyết định cách viết, vì mảng đã sắp theo createdAt.
        label: nhanGoc === '' ? 'Mở trực tiếp' : nhanGoc,
        isDirect: nhanGoc === '',
        accountCount: 0,
        activeAccountCount: 0,
        userIds: new Set<string>(),
        netCapital: 0n,
      };
      buckets.set(key, b);
    }

    b.accountCount += 1;
    if (a.isActive) b.activeAccountCount += 1;
    b.userIds.add(a.userId);
    b.netCapital += a.capitalFlows.reduce(
      (sum, f) => sum + BigInt(CAPITAL_FLOW_SIGN[f.flowType as CapitalFlowType]) * f.amount,
      0n,
    );
  }

  const tong = [...buckets.values()].reduce((s, b) => s + b.netCapital, 0n);

  const out: IbExposure[] = [...buckets.values()].map((b) => ({
    key: b.key,
    label: b.label,
    isDirect: b.isDirect,
    accountCount: b.accountCount,
    activeAccountCount: b.activeAccountCount,
    memberCount: b.userIds.size,
    netCapital: b.netCapital,
    weightBps: tong === 0n ? 0 : ratioToBps(b.netCapital, tong),
    colorIndex: slotMau.get(b.key) ?? 0,
  }));

  /*
   * Sắp ở ĐÂY, không để nơi gọi tự sắp — cùng lý do như `computeMemberPerformance`.
   * Ba mức để thứ tự không bao giờ phụ thuộc thứ tự trả về của database: tiền, rồi
   * số tài khoản, rồi tên. Nhiều IB cùng 0 đồng là chuyện thường (tài khoản mới khai
   * chưa nạp), nên mức thứ hai và thứ ba không phải cho đủ bộ.
   */
  return out.sort(
    (a, b) =>
      (b.netCapital > a.netCapital ? 1 : b.netCapital < a.netCapital ? -1 : 0) ||
      b.accountCount - a.accountCount ||
      a.label.localeCompare(b.label, 'vi'),
  );
}

// ---------------------------------------------------------------------------
// Khối lượng đang giữ theo TỪNG CHIẾN LƯỢC — chốt cho lệnh bán
// ---------------------------------------------------------------------------

export interface StrategyHolding {
  strategyId: string;
  strategyCode: string;
  strategyNameVi: string;
  /** Khối lượng còn giữ thuộc chiến lược này. Luôn > 0 trong kết quả trả về. */
  quantity: number;
}

export interface StockHolding {
  stockId: string;
  symbol: string;
  companyName: string;
  sectorNameVi: string;
  /** Tổng khối lượng đang giữ. Bằng đúng Σ `byStrategy[].quantity`. */
  quantity: number;
  /** Giá đang lưu trong `market_quotes` — dùng làm giá điền sẵn cho lệnh bán. */
  quotePrice: bigint;
  byStrategy: StrategyHolding[];
}

/**
 * Đang giữ những mã nào, và mỗi mã chia theo chiến lược ra sao.
 *
 * BA MỨC PHẠM VI, VÀ VÌ SAO PHẢI XUỐNG TỚI MỨC TÀI KHOẢN.
 *
 * Thị trường Việt Nam không có bán khống: chỉ bán được thứ đang giữ. Cổ phiếu không
 * nằm ở "danh mục" hay ở "một người" — nó nằm ở MỘT TÀI KHOẢN CHỨNG KHOÁN cụ thể, và
 * lệnh bán đi qua đúng tài khoản đó.
 *
 *   danh mục   `heldQuantity(portfolioId, stockId)` — chốt đầu tiên, quá rộng: một
 *              người bán được 52.000 MBB trong khi tài khoản họ chỉ có 10.000.
 *   người      thêm `userId` — vẫn quá rộng: MBB giữ ở tài khoản SSI vẫn bán được
 *              khi đang chọn tài khoản VPBankS, và lệnh bán đó tạo ra vị thế ÂM ở
 *              VPBankS. Đã xảy ra thật: SSI 12345 từng âm 5.000 MBB.
 *   tài khoản  thêm `brokerAccountId` — mức đúng. Đây là mức mà câu "tài khoản này
 *              đang giữ mã đó" có nghĩa.
 *
 * `brokerAccountId` để trống = đo cả người (mọi tài khoản, kể cả lệnh chưa gắn tài
 * khoản). Dùng cho chỗ chỉ cần biết một người đang giữ gì, ví dụ trang vị thế.
 *
 * LỆNH KHÔNG GẮN TÀI KHOẢN thì không thuộc tài khoản nào, nên khi lọc theo tài khoản
 * nó BỊ LOẠI — không rơi về một tài khoản mặc định nào. Đó là chủ ý: 15/16 lệnh trong
 * dữ liệu hiện tại chưa gắn tài khoản, và cho chúng rơi về tài khoản đầu tiên là tự
 * quyết định hộ người dùng cổ phiếu của họ nằm ở đâu.
 *
 * CHIA KHỐI LƯỢNG THEO bps CỦA LỆNH MUA.
 *
 * `trade_strategies` lưu `allocationBps` (tỷ lệ) và `allocationAmount` (tiền), không
 * lưu khối lượng. Khối lượng thuộc mỗi chiến lược được suy ra bằng CHÍNH `allocateAmount`
 * — thuật toán largest-remainder đã dùng cho tiền — nên Σ theo chiến lược bằng đúng
 * khối lượng lệnh, không rơi cổ phiếu nào. Chia thẳng rồi làm tròn sẽ làm tổng lệch và
 * mức trần khi bán sai theo.
 *
 * Lệnh BÁN trừ đi theo cùng cách, nên phần còn lại của mỗi chiến lược luôn khớp.
 *
 * CHỈ TÍNH LỆNH `EXECUTED`. Lệnh đang chờ duyệt chưa phải cổ phiếu trong tay — tính
 * vào sẽ cho phép bán hai lần cùng một lô: một lần theo lệnh chờ, một lần theo lệnh
 * thật khi nó được duyệt.
 */
export async function computeStrategyHoldings(
  portfolioId: string,
  userId: string,
  brokerAccountId?: string,
): Promise<StockHolding[]> {
  const trades = await prisma.trade.findMany({
    where: {
      portfolioId,
      userId,
      status: TRADE_STATUS.EXECUTED,
      ...(brokerAccountId ? { brokerAccountId } : {}),
    },
    select: {
      transactionType: true,
      quantity: true,
      stock: {
        select: {
          id: true,
          symbol: true,
          companyName: true,
          sector: { select: { nameVi: true } },
          quote: { select: { price: true } },
        },
      },
      strategies: {
        select: {
          allocationBps: true,
          strategy: { select: { id: true, code: true, nameVi: true } },
        },
      },
    },
  });

  interface Gop {
    stockId: string;
    symbol: string;
    companyName: string;
    sectorNameVi: string;
    quotePrice: bigint;
    tong: number;
    theoCL: Map<string, { code: string; nameVi: string; quantity: number }>;
  }

  const theoMa = new Map<string, Gop>();

  for (const t of trades) {
    const dau = t.transactionType === TRANSACTION_TYPE.BUY ? 1 : -1;

    let g = theoMa.get(t.stock.id);
    if (!g) {
      g = {
        stockId: t.stock.id,
        symbol: t.stock.symbol,
        companyName: t.stock.companyName,
        sectorNameVi: t.stock.sector.nameVi,
        quotePrice: t.stock.quote?.price ?? 0n,
        tong: 0,
        theoCL: new Map(),
      };
      theoMa.set(t.stock.id, g);
    }

    g.tong += t.quantity * dau;

    /*
     * Lệnh KHÔNG có phân bổ chiến lược: vẫn cộng vào tổng nhưng không vào chiến lược
     * nào. `tradeSchema` bắt buộc phải có, nên chuyện này chỉ xảy ra với dữ liệu có
     * trước ràng buộc đó. Bỏ qua im lặng sẽ làm Σ theo chiến lược nhỏ hơn tổng — và
     * lúc đó mức trần khi bán thấp hơn thực tế mà không ai hiểu vì sao.
     */
    if (t.strategies.length === 0) continue;

    const phan = allocateAmount(
      BigInt(t.quantity),
      t.strategies.map((s) => s.allocationBps),
    );

    t.strategies.forEach((s, i) => {
      const cu = g!.theoCL.get(s.strategy.id);
      const them = Number(phan[i]!) * dau;
      if (cu) {
        cu.quantity += them;
      } else {
        g!.theoCL.set(s.strategy.id, {
          code: s.strategy.code,
          nameVi: s.strategy.nameVi,
          quantity: them,
        });
      }
    });
  }

  const out: StockHolding[] = [];

  for (const g of theoMa.values()) {
    if (g.tong <= 0) continue;

    const byStrategy = [...g.theoCL.entries()]
      .filter(([, v]) => v.quantity > 0)
      .map(([strategyId, v]) => ({
        strategyId,
        strategyCode: v.code,
        strategyNameVi: v.nameVi,
        quantity: v.quantity,
      }))
      // Nhiều nhất trước: dòng ảnh hưởng lớn nhất tới lệnh bán nằm trên.
      .sort((a, b) => b.quantity - a.quantity);

    out.push({
      stockId: g.stockId,
      symbol: g.symbol,
      companyName: g.companyName,
      sectorNameVi: g.sectorNameVi,
      quantity: g.tong,
      quotePrice: g.quotePrice,
      byStrategy,
    });
  }

  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}
