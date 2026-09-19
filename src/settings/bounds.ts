/**
 * Ràng buộc giá trị của từng tham số cấu hình (§21) — Phase 10.
 *
 * MODULE THƯỜNG, cố tình không phải `'use server'`. Cả server action lẫn trang
 * hiển thị đều cần bảng này: action để CHẶN, trang để GIẢI THÍCH. Nếu chỉ có ở
 * phía action thì giao diện phải viết lại lời nhắc bằng tay, và hai bên sẽ lệch
 * nhau ngay lần đầu ai đó đổi giới hạn.
 *
 * (Và mọi hàm export từ một file `'use server'` trở thành một endpoint gọi được
 * từ ngoài — không nên là chỗ đặt dữ liệu tra cứu.)
 */

import { SETTING_VALUE_TYPE } from '@/lib/enums';

export interface SettingBound {
  min?: bigint;
  max?: bigint;
  /** Lời nhắc hiện dưới ô nhập và cũng dùng trong thông báo lỗi. */
  note: string;
}

/**
 * Chặn dưới / chặn trên theo từng khoá.
 *
 * Kiểm tra kiểu một mình không đủ: `-15` là số nguyên hợp lệ nhưng phí giao dịch
 * âm thì vô nghĩa, và `0` cho ngưỡng trễ sẽ làm mọi giá đều bị coi là cũ ngay lập
 * tức. Đây là ràng buộc NGHIỆP VỤ, không suy ra được từ `valueType`, nên phải
 * viết ra từng cái.
 */
export const SETTING_BOUNDS: Readonly<Record<string, SettingBound>> = {
  'trading.default_fee_rate_bps': {
    min: 0n,
    max: 1_000n,
    note: 'Từ 0 đến 1000 bps (0–10%).',
  },
  'trading.sell_tax_rate_bps': {
    min: 0n,
    max: 1_000n,
    note: 'Từ 0 đến 1000 bps (0–10%).',
  },
  'trading.require_approval_above_vnd': {
    min: 0n,
    note: 'Không âm. Đặt 0 nghĩa là mọi lệnh đều phải qua bước duyệt.',
  },
  'trading.lot_size': {
    min: 1n,
    max: 1_000n,
    note: 'Từ 1 đến 1000. Lô chuẩn HOSE là 100.',
  },
  'market_data.stale_after_minutes': {
    min: 1n,
    max: 10_080n,
    note:
      'Từ 1 phút đến 7 ngày. Phải CAO HƠN chu kỳ đồng bộ, nếu không mỗi khoảng ' +
      'nghỉ giữa hai lần lấy giá đều bị báo trễ.',
  },
};

export type ValidationOutcome =
  | { ok: true; value: string }
  | { ok: false; error: string };

/** Kiểm tra giá trị mới có hợp với `valueType` và với ràng buộc nghiệp vụ. */
export function validateSettingValue(
  key: string,
  valueType: string,
  raw: string,
): ValidationOutcome {
  const value = raw.trim();

  switch (valueType) {
    case SETTING_VALUE_TYPE.INT:
    case SETTING_VALUE_TYPE.BIGINT: {
      if (!/^-?\d+$/.test(value)) return { ok: false, error: 'Phải là số nguyên.' };

      /*
       * So sánh bằng BigInt, không bằng Number. Có tham số là số tiền VNĐ —
       * `trading.require_approval_above_vnd` mặc định đã là 1 tỷ — và một danh
       * mục nghìn tỷ vượt 2^53, lúc đó so sánh bằng Number sai âm thầm.
       */
      const parsed = BigInt(value);
      const bound = SETTING_BOUNDS[key];
      if (bound) {
        if (bound.min !== undefined && parsed < bound.min) {
          return { ok: false, error: `Không được nhỏ hơn ${bound.min}. ${bound.note}` };
        }
        if (bound.max !== undefined && parsed > bound.max) {
          return { ok: false, error: `Không được lớn hơn ${bound.max}. ${bound.note}` };
        }
      }
      return { ok: true, value };
    }

    case SETTING_VALUE_TYPE.BOOL:
      if (value !== 'true' && value !== 'false') {
        return { ok: false, error: 'Chỉ nhận true hoặc false.' };
      }
      return { ok: true, value };

    case SETTING_VALUE_TYPE.JSON:
      try {
        JSON.parse(value);
      } catch {
        return { ok: false, error: 'JSON không hợp lệ.' };
      }
      return { ok: true, value };

    default:
      if (value.length === 0) return { ok: false, error: 'Không được để trống.' };
      if (value.length > 500) return { ok: false, error: 'Tối đa 500 ký tự.' };
      return { ok: true, value };
  }
}
