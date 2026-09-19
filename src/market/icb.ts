/**
 * QUY ĐỔI PHÂN NGÀNH ICB CỦA VNSTOCK SANG NGÀNH/PHÂN NGÀNH CỦA MASTER DATA.
 *
 * Hai hệ phân ngành khác nhau, và đó là lý do file này tồn tại:
 *
 *   - VNStock trả về ICB (Industry Classification Benchmark) — 4 cấp, mã số, tên
 *     tiếng Việt: `5751 Hàng không`.
 *   - Master data của Dashboard dùng 11 ngành kiểu GICS với ~30 phân ngành do người
 *     dùng tự đặt: `Công nghiệp / Hàng không`.
 *
 * Không có công thức nào nối hai hệ đó — chỉ có một bảng. Bảng dưới đây được lập từ
 * SỐ LIỆU THẬT, không từ ký ức: `sync.py info` và `Listing.symbols_by_industries()`
 * cho ra đúng 86 nhóm ICB cấp 4 và 37 nhóm cấp 3 đang có mã niêm yết trên
 * HOSE/HNX/UPCOM (tháng 09/2026). Mỗi nhóm đó có một dòng ở đây.
 *
 * DÙNG CẤP 4 TRƯỚC, VÌ NÓ ĐÚNG HƠN HẲN. Ví dụ đo được: SCS (dịch vụ hàng hoá sân
 * bay) ở cấp 3 là `5750 Du lịch & Giải trí` — sai với thực tế; ở cấp 4 là
 * `5751 Hàng không` — đúng. Cấp 3 chỉ là lớp đỡ cho nhóm ICB mới mà bảng chưa có.
 *
 * KHI KHÔNG CHẮC THÌ ĐỂ TRỐNG, KHÔNG ĐOÁN. Nhiều nhóm ICB không có phân ngành nào
 * tương ứng trong master data (`1771 Khai thác Than`, `2723 Containers & Đóng gói`),
 * và vài nhóm trải trên nhiều phân ngành (`1353 Nhựa, cao su & sợi`). Ở những nhóm
 * đó `industryCode` để trống và `cungKhaNang` liệt kê các lựa chọn hợp lý. Gợi ý một
 * phân ngành sai tự tin còn tệ hơn không gợi ý: người dùng tin nó và ngành của mã đó
 * lệch vĩnh viễn trong mọi biểu đồ tỷ trọng.
 *
 * File này KHÔNG chạm database và không import gì — để `scripts/test-suggest-stock.ts`
 * đối chiếu được từng mã trong bảng với bảng `sectors`/`industries` thật.
 */

export interface QuyDoiIcb {
  /** `sectors.code` trong master data. */
  sectorCode: string;
  /** `industries.code` — chỉ đặt khi nhóm ICB ứng đúng một phân ngành. */
  industryCode?: string;
  /**
   * Phân ngành khác cũng hợp lý cho nhóm ICB này.
   *
   * Hiện kèm trong gợi ý để người dùng biết còn lựa chọn nào. Ví dụ `1353 Nhựa, cao
   * su & sợi` gồm cả AAA (nhựa) và BRC (cao su) — chọn hộ là chọn sai một nửa số mã.
   *
   * HAI DẠNG VIẾT: `'RUBBER'` là phân ngành thuộc chính `sectorCode` ở trên;
   * `'INDUSTRIALS/AVIATION'` là phân ngành thuộc NGÀNH KHÁC.
   *
   * Vì sao cần dạng thứ hai: có nhóm ICB lửng lơ giữa hai ngành của master data, chứ
   * không chỉ giữa hai phân ngành. `5750 Du lịch & Giải trí` gồm cả khách sạn (Hàng
   * tiêu dùng không thiết yếu) và SCS (Công nghiệp / Hàng không). Bản đầu của bảng
   * này viết `cungKhaNang: ['AVIATION']` dưới ngành `CONSUMER_DISCRETIONARY`, và
   * `scripts/test-suggest-stock.ts` bắt được: phân ngành đó không thuộc ngành đã map
   * nên gợi ý lặng lẽ biến mất — không báo lỗi, chỉ thiếu.
   */
  cungKhaNang?: string[];
}

/**
 * Tách một mục `cungKhaNang` thành cặp ngành + phân ngành.
 *
 * Không có dấu `/` thì phân ngành đó thuộc chính ngành của dòng đang xét.
 */
export function tachKhaNang(
  muc: string,
  sectorCodeMacDinh: string,
): { sectorCode: string; industryCode: string } {
  const i = muc.indexOf('/');
  if (i < 0) return { sectorCode: sectorCodeMacDinh, industryCode: muc };
  return { sectorCode: muc.slice(0, i), industryCode: muc.slice(i + 1) };
}

/**
 * Nhóm ICB (cấp 4 và cấp 3) → ngành/phân ngành của master data.
 *
 * Khoá là mã ICB dạng chuỗi, giữ nguyên số 0 ở đầu (`0533`) như nguồn trả về.
 */
export const ICB_SANG_MASTER: Record<string, QuyDoiIcb> = {
  // --- Cấp 4 -------------------------------------------------------------
  // Năng lượng
  '0533': { sectorCode: 'ENERGY', industryCode: 'OIL_GAS' },
  '0573': { sectorCode: 'ENERGY', industryCode: 'OIL_GAS_SERVICES' },
  // ICB xếp phân phối khí vào Tiện ích; ở master data "Dầu khí" sát hơn (CNG, ASP).
  '7573': { sectorCode: 'ENERGY', industryCode: 'OIL_GAS', cungKhaNang: ['UTILITIES/POWER'] },

  // Nguyên vật liệu
  '1353': { sectorCode: 'MATERIALS', cungKhaNang: ['PLASTICS', 'RUBBER'] },
  '1357': { sectorCode: 'MATERIALS', industryCode: 'CHEMICALS' },
  '1733': { sectorCode: 'MATERIALS' },
  '1737': { sectorCode: 'MATERIALS' },
  '1753': { sectorCode: 'MATERIALS', cungKhaNang: ['STEEL'] },
  '1755': { sectorCode: 'MATERIALS', cungKhaNang: ['STEEL'] },
  '1757': { sectorCode: 'MATERIALS', industryCode: 'STEEL' },
  '1771': { sectorCode: 'MATERIALS' },
  '1775': { sectorCode: 'MATERIALS' },
  '1777': { sectorCode: 'MATERIALS' },
  '2353': { sectorCode: 'MATERIALS', industryCode: 'CEMENT' },
  '3357': { sectorCode: 'MATERIALS', industryCode: 'RUBBER' },

  // Công nghiệp
  '2357': { sectorCode: 'INDUSTRIALS', industryCode: 'CONSTRUCTION' },
  '2723': { sectorCode: 'INDUSTRIALS', cungKhaNang: ['INDUSTRIAL_MACHINERY'] },
  '2727': { sectorCode: 'INDUSTRIALS', cungKhaNang: ['INDUSTRIAL_MACHINERY'] },
  '2733': { sectorCode: 'INDUSTRIALS', industryCode: 'INDUSTRIAL_MACHINERY' },
  '2737': { sectorCode: 'INDUSTRIALS', industryCode: 'INDUSTRIAL_MACHINERY' },
  '2753': { sectorCode: 'INDUSTRIALS', industryCode: 'INDUSTRIAL_MACHINERY' },
  '2757': { sectorCode: 'INDUSTRIALS', industryCode: 'INDUSTRIAL_MACHINERY' },
  '2771': { sectorCode: 'INDUSTRIALS', industryCode: 'LOGISTICS' },
  '2773': { sectorCode: 'INDUSTRIALS', industryCode: 'LOGISTICS' },
  '2775': { sectorCode: 'INDUSTRIALS', industryCode: 'LOGISTICS' },
  '2777': { sectorCode: 'INDUSTRIALS', industryCode: 'LOGISTICS' },
  '2779': { sectorCode: 'INDUSTRIALS', industryCode: 'LOGISTICS' },
  '2791': { sectorCode: 'INDUSTRIALS' },
  '2793': { sectorCode: 'INDUSTRIALS' },
  '2797': { sectorCode: 'INDUSTRIALS' },
  '5751': { sectorCode: 'INDUSTRIALS', industryCode: 'AVIATION' },

  // Hàng tiêu dùng không thiết yếu
  '3353': { sectorCode: 'CONSUMER_DISCRETIONARY' },
  '3355': { sectorCode: 'CONSUMER_DISCRETIONARY' },
  '3722': { sectorCode: 'CONSUMER_DISCRETIONARY' },
  '3724': { sectorCode: 'CONSUMER_DISCRETIONARY' },
  '3726': { sectorCode: 'CONSUMER_DISCRETIONARY' },
  '3743': { sectorCode: 'CONSUMER_DISCRETIONARY', cungKhaNang: ['INFORMATION_TECHNOLOGY/TECH_HARDWARE'] },
  '3747': { sectorCode: 'CONSUMER_DISCRETIONARY' },
  '3763': { sectorCode: 'CONSUMER_DISCRETIONARY', industryCode: 'TEXTILES' },
  '3765': { sectorCode: 'CONSUMER_DISCRETIONARY', industryCode: 'TEXTILES' },
  '3767': { sectorCode: 'CONSUMER_DISCRETIONARY', cungKhaNang: ['TEXTILES'] },
  '5373': { sectorCode: 'CONSUMER_DISCRETIONARY', industryCode: 'RETAIL' },
  '5377': { sectorCode: 'CONSUMER_DISCRETIONARY', cungKhaNang: ['RETAIL'] },
  '5379': { sectorCode: 'CONSUMER_DISCRETIONARY', industryCode: 'RETAIL' },
  '5753': { sectorCode: 'CONSUMER_DISCRETIONARY', industryCode: 'HOSPITALITY' },
  '5755': { sectorCode: 'CONSUMER_DISCRETIONARY', industryCode: 'HOSPITALITY' },
  '5757': { sectorCode: 'CONSUMER_DISCRETIONARY', industryCode: 'HOSPITALITY' },
  // Vận tải hành khách + tour: có mã là hãng xe khách, có mã là công ty du lịch.
  '5759': { sectorCode: 'CONSUMER_DISCRETIONARY', cungKhaNang: ['HOSPITALITY', 'INDUSTRIALS/LOGISTICS'] },

  // Hàng tiêu dùng thiết yếu
  '3533': { sectorCode: 'CONSUMER_STAPLES', industryCode: 'FOOD_BEVERAGE' },
  '3535': { sectorCode: 'CONSUMER_STAPLES', industryCode: 'FOOD_BEVERAGE' },
  '3537': { sectorCode: 'CONSUMER_STAPLES', industryCode: 'FOOD_BEVERAGE' },
  '3573': { sectorCode: 'CONSUMER_STAPLES', industryCode: 'AGRICULTURE' },
  '3577': { sectorCode: 'CONSUMER_STAPLES', industryCode: 'FOOD_BEVERAGE' },
  '3785': { sectorCode: 'CONSUMER_STAPLES' },
  '5337': { sectorCode: 'CONSUMER_STAPLES', cungKhaNang: ['FOOD_BEVERAGE', 'CONSUMER_DISCRETIONARY/RETAIL'] },

  // Chăm sóc sức khoẻ
  '4533': { sectorCode: 'HEALTH_CARE', industryCode: 'MEDICAL_SERVICES' },
  '4535': { sectorCode: 'HEALTH_CARE', industryCode: 'MEDICAL_SERVICES' },
  '4537': { sectorCode: 'HEALTH_CARE', industryCode: 'MEDICAL_SERVICES' },
  '4573': { sectorCode: 'HEALTH_CARE', industryCode: 'PHARMACEUTICALS' },
  '4577': { sectorCode: 'HEALTH_CARE', industryCode: 'PHARMACEUTICALS' },

  // Dịch vụ truyền thông
  '5553': { sectorCode: 'COMMUNICATION_SERVICES', industryCode: 'MEDIA' },
  '5555': { sectorCode: 'COMMUNICATION_SERVICES', industryCode: 'MEDIA' },
  '5557': { sectorCode: 'COMMUNICATION_SERVICES', industryCode: 'MEDIA' },
  '6535': { sectorCode: 'COMMUNICATION_SERVICES', industryCode: 'TELECOM' },
  '6575': { sectorCode: 'COMMUNICATION_SERVICES', industryCode: 'TELECOM' },

  // Tiện ích công cộng
  '2799': { sectorCode: 'UTILITIES', industryCode: 'WATER' },
  '7535': { sectorCode: 'UTILITIES', industryCode: 'POWER' },
  '7575': { sectorCode: 'UTILITIES' },
  '7577': { sectorCode: 'UTILITIES', industryCode: 'WATER' },

  // Tài chính
  '8355': { sectorCode: 'FINANCIALS', industryCode: 'BANKS' },
  '8536': { sectorCode: 'FINANCIALS', industryCode: 'INSURANCE' },
  '8538': { sectorCode: 'FINANCIALS', industryCode: 'INSURANCE' },
  '8575': { sectorCode: 'FINANCIALS', industryCode: 'INSURANCE' },
  '8771': { sectorCode: 'FINANCIALS', industryCode: 'FINANCIAL_SERVICES' },
  '8773': { sectorCode: 'FINANCIALS', industryCode: 'FINANCIAL_SERVICES' },
  '8775': { sectorCode: 'FINANCIALS', industryCode: 'FINANCIAL_SERVICES' },
  '8777': { sectorCode: 'FINANCIALS', industryCode: 'SECURITIES' },
  '8985': { sectorCode: 'FINANCIALS', industryCode: 'FINANCIAL_SERVICES' },

  // Bất động sản
  '8633': {
    sectorCode: 'REAL_ESTATE',
    cungKhaNang: ['RESIDENTIAL_RE', 'INDUSTRIAL_RE', 'RE_SERVICES'],
  },
  '8637': { sectorCode: 'REAL_ESTATE', industryCode: 'RE_SERVICES' },

  // Công nghệ thông tin
  '9533': { sectorCode: 'INFORMATION_TECHNOLOGY', industryCode: 'SOFTWARE_IT' },
  '9535': { sectorCode: 'INFORMATION_TECHNOLOGY', industryCode: 'SOFTWARE_IT' },
  '9537': { sectorCode: 'INFORMATION_TECHNOLOGY', industryCode: 'SOFTWARE_IT' },
  '9572': { sectorCode: 'INFORMATION_TECHNOLOGY', industryCode: 'TECH_HARDWARE' },
  '9574': { sectorCode: 'INFORMATION_TECHNOLOGY', industryCode: 'TECH_HARDWARE' },
  '9578': { sectorCode: 'INFORMATION_TECHNOLOGY', industryCode: 'TECH_HARDWARE' },

  // --- Cấp 3: lớp đỡ khi nguồn trả về nhóm cấp 4 mà bảng trên chưa có ----
  '0530': { sectorCode: 'ENERGY', industryCode: 'OIL_GAS' },
  '0570': { sectorCode: 'ENERGY', industryCode: 'OIL_GAS_SERVICES' },
  '1350': { sectorCode: 'MATERIALS', cungKhaNang: ['CHEMICALS', 'PLASTICS', 'RUBBER'] },
  '1730': { sectorCode: 'MATERIALS' },
  '1750': { sectorCode: 'MATERIALS', cungKhaNang: ['STEEL'] },
  '1770': { sectorCode: 'MATERIALS' },
  // Nhóm cấp 3 này gồm cả xây dựng (Công nghiệp) và vật liệu (Nguyên vật liệu).
  '2350': { sectorCode: 'INDUSTRIALS', cungKhaNang: ['CONSTRUCTION'] },
  '2720': { sectorCode: 'INDUSTRIALS', cungKhaNang: ['INDUSTRIAL_MACHINERY'] },
  '2730': { sectorCode: 'INDUSTRIALS', industryCode: 'INDUSTRIAL_MACHINERY' },
  '2750': { sectorCode: 'INDUSTRIALS', industryCode: 'INDUSTRIAL_MACHINERY' },
  '2770': { sectorCode: 'INDUSTRIALS', cungKhaNang: ['LOGISTICS', 'AVIATION'] },
  '2790': { sectorCode: 'INDUSTRIALS' },
  '3350': { sectorCode: 'CONSUMER_DISCRETIONARY' },
  '3530': { sectorCode: 'CONSUMER_STAPLES', industryCode: 'FOOD_BEVERAGE' },
  '3570': { sectorCode: 'CONSUMER_STAPLES', cungKhaNang: ['FOOD_BEVERAGE', 'AGRICULTURE'] },
  '3720': { sectorCode: 'CONSUMER_DISCRETIONARY' },
  '3740': { sectorCode: 'CONSUMER_DISCRETIONARY' },
  '3760': { sectorCode: 'CONSUMER_DISCRETIONARY', cungKhaNang: ['TEXTILES'] },
  '3780': { sectorCode: 'CONSUMER_STAPLES' },
  '4530': { sectorCode: 'HEALTH_CARE', industryCode: 'MEDICAL_SERVICES' },
  '4570': { sectorCode: 'HEALTH_CARE', industryCode: 'PHARMACEUTICALS' },
  '5330': { sectorCode: 'CONSUMER_STAPLES', cungKhaNang: ['FOOD_BEVERAGE', 'CONSUMER_DISCRETIONARY/RETAIL'] },
  '5370': { sectorCode: 'CONSUMER_DISCRETIONARY', industryCode: 'RETAIL' },
  '5550': { sectorCode: 'COMMUNICATION_SERVICES', industryCode: 'MEDIA' },
  '5750': { sectorCode: 'CONSUMER_DISCRETIONARY', cungKhaNang: ['HOSPITALITY', 'INDUSTRIALS/AVIATION'] },
  '6530': { sectorCode: 'COMMUNICATION_SERVICES', industryCode: 'TELECOM' },
  '6570': { sectorCode: 'COMMUNICATION_SERVICES', industryCode: 'TELECOM' },
  '7530': { sectorCode: 'UTILITIES', industryCode: 'POWER' },
  '7570': { sectorCode: 'UTILITIES', cungKhaNang: ['WATER', 'ENERGY/OIL_GAS'] },
  '8350': { sectorCode: 'FINANCIALS', industryCode: 'BANKS' },
  '8530': { sectorCode: 'FINANCIALS', industryCode: 'INSURANCE' },
  '8570': { sectorCode: 'FINANCIALS', industryCode: 'INSURANCE' },
  '8630': {
    sectorCode: 'REAL_ESTATE',
    cungKhaNang: ['RESIDENTIAL_RE', 'INDUSTRIAL_RE', 'RE_SERVICES'],
  },
  '8770': { sectorCode: 'FINANCIALS', cungKhaNang: ['SECURITIES', 'FINANCIAL_SERVICES'] },
  '8980': { sectorCode: 'FINANCIALS', industryCode: 'FINANCIAL_SERVICES' },
  '9530': { sectorCode: 'INFORMATION_TECHNOLOGY', industryCode: 'SOFTWARE_IT' },
  '9570': { sectorCode: 'INFORMATION_TECHNOLOGY', industryCode: 'TECH_HARDWARE' },
};

/** Một cấp phân ngành ICB như `sync.py info` trả về. */
export interface CapIcb {
  ma: string;
  ten: string;
}

export interface KetQuaQuyDoi extends QuyDoiIcb {
  /** Cấp ICB đã dùng để quy đổi — để giao diện nói rõ gợi ý dựa trên đâu. */
  capDaDung: number;
  /** Tên nhóm ICB ở cấp đó, nguyên văn từ nguồn. */
  tenIcb: string;
}

/**
 * Chọn nhóm ICB chi tiết nhất mà bảng biết, rồi quy đổi.
 *
 * Thứ tự 4 → 3 → 2 là thứ tự giảm dần độ chính xác. Cấp 1 KHÔNG dùng: nó chỉ có 10
 * nhóm cho cả thị trường, và ở cấp đó "Dịch vụ Tiêu dùng" gom cả bán lẻ, khách sạn,
 * truyền thông — gợi ý ra được cũng không giúp ai chọn đúng.
 */
export function quyDoiIcb(icb: Record<string, CapIcb> | undefined): KetQuaQuyDoi | null {
  if (!icb) return null;
  for (const cap of [4, 3, 2]) {
    const nut = icb[String(cap)];
    if (!nut?.ma) continue;
    const quyDoi = ICB_SANG_MASTER[nut.ma];
    if (quyDoi) return { ...quyDoi, capDaDung: cap, tenIcb: nut.ten };
  }
  return null;
}

/**
 * Sàn của nguồn → `stocks.exchange`.
 *
 * VNStock gọi HOSE là "HSX". Ngoài ba sàn niêm yết, nguồn còn trả về "BOND" (trái
 * phiếu) và "DELISTED" (đã huỷ niêm yết) — hai thứ không phải lựa chọn của form, nên
 * trả về null để giao diện nói rõ thay vì gợi ý một sàn không đúng.
 */
export function quyDoiSan(san: string): 'HOSE' | 'HNX' | 'UPCOM' | null {
  const s = san.trim().toUpperCase();
  if (s === 'HSX' || s === 'HOSE') return 'HOSE';
  if (s === 'HNX') return 'HNX';
  if (s === 'UPCOM') return 'UPCOM';
  return null;
}
