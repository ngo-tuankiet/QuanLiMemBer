"""
Bọc thư viện vnstock và CHUẨN HOÁ ĐƠN VỊ.

ĐÂY LÀ PHẦN QUAN TRỌNG NHẤT CỦA FILE NÀY.

vnstock trả về giá ở hai đơn vị khác nhau tuỳ hàm, và đây là cái bẫy dễ làm sai
số liệu 1000 lần mà không có lỗi nào được ném ra:

    Trading.price_board()   → ĐỒNG        MBB ref_price = 20750
    Quote.history()         → NGHÌN ĐỒNG  MBB close     = 20.75

Đã kiểm chứng trực tiếp với vnstock 4.0.7, nguồn `vci`, ngày 24/08/2026.

Hệ thống lưu tiền bằng số nguyên VNĐ (xem src/lib/money.ts), nên mọi giá lấy từ
`history()` phải nhân 1000. Chỉ số thì lưu ×100 (VN-Index 1788,78 → 178878).

Mọi phép quy đổi tập trung trong file này. Không nơi nào khác được phép nhân chia
đơn vị giá.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import pandas as pd
import vnstock
from vnstock import Quote, Trading

# Nơi vnstock lưu API key sau khi gọi change_api_key().
_API_KEY_FILE = Path.home() / ".vnstock" / "api_key.json"


def apply_api_key(api_key: str) -> dict | None:
    """
    Áp API key của vnstock, nếu có.

    Key là TUỲ CHỌN: không có nó thư viện vẫn chạy. Có key thì tài khoản được đăng
    ký và biết được hạn mức truy cập của mình.

    `change_api_key()` ghi vào `~/.vnstock/api_key.json` — một tác dụng phụ ở phạm
    vi toàn máy. Vì vậy chỉ gọi khi key đã lưu KHÁC key trong cấu hình, tránh ghi
    lại file mỗi 60 giây khi chạy vòng lặp.

    Trả về dict trạng thái (tier, limits) hoặc None nếu không có key.
    """
    if not api_key:
        return None

    stored = ""
    if _API_KEY_FILE.exists():
        try:
            stored = json.loads(_API_KEY_FILE.read_text(encoding="utf-8")).get("api_key", "")
        except (json.JSONDecodeError, OSError):
            stored = ""

    if stored != api_key:
        try:
            vnstock.change_api_key(api_key)
        except Exception as exc:
            print(f"  Không áp được API key: {type(exc).__name__}: {exc}")
            return None

    try:
        return vnstock.check_status()
    except Exception:
        return None

# vnstock dùng mã sàn riêng; hệ thống dùng mã theo đặc tả §7.
EXCHANGE_MAP = {
    "HSX": "HOSE",
    "HOSE": "HOSE",
    "HNX": "HNX",
    "UPCOM": "UPCOM",
}

# history() trả giá theo nghìn đồng → nhân lên để ra đồng.
HISTORY_PRICE_MULTIPLIER = 1_000

# Chỉ số lưu ×100 để giữ 2 chữ số thập phân bằng số nguyên.
INDEX_SCALE = 100


def _to_int(value: Any) -> int | None:
    """
    Chuyển giá trị của pandas về int, hoặc None nếu không dùng được.

    Cần thiết vì price_board trả về lẫn None, NaN, chuỗi và numpy types. Ép kiểu
    thô bằng int() sẽ ném lỗi hoặc âm thầm ra 0 — cả hai đều tệ với dữ liệu giá.
    """
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    try:
        if isinstance(value, str):
            value = value.replace(",", "").strip()
            if not value:
                return None
        result = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return result


def _cell(row: pd.Series, group: str, name: str) -> Any:
    """Đọc một ô từ DataFrame MultiIndex của price_board, thiếu thì trả None."""
    key = (group, name)
    if key in row.index:
        return row[key]
    return None


@dataclass
class QuoteRow:
    symbol: str
    price: int
    reference_price: int | None
    ceiling_price: int | None
    floor_price: int | None
    open_price: int | None
    high_price: int | None
    low_price: int | None
    volume: int | None
    turnover: int | None

    # True khi nguồn trả match_price = 0 và phải lùi về giá tham chiếu.
    #
    # Đây là chỉ báo quan trọng cho lần chốt phiên: nếu phần lớn mã đều dùng giá
    # tham chiếu thì độ trễ sau giờ đóng cửa còn quá ngắn, nguồn chưa công bố giá
    # khớp. Không có cờ này thì lỗi đó im lặng hoàn toàn.
    used_reference: bool = False

    def to_payload(self) -> dict[str, str | None]:
        """Tiền truyền dạng CHUỖI, không phải number.

        JSON number là double 64-bit, chỉ chính xác tới 2^53. Giá trị giao dịch của
        một danh mục nghìn tỷ đồng vượt ngưỡng đó và sẽ bị sai âm thầm. Phía Next.js
        đọc chuỗi rồi chuyển sang BigInt.
        """
        def s(v: int | None) -> str | None:
            return None if v is None else str(v)

        return {
            "symbol": self.symbol,
            "price": str(self.price),
            "referencePrice": s(self.reference_price),
            "ceilingPrice": s(self.ceiling_price),
            "floorPrice": s(self.floor_price),
            "openPrice": s(self.open_price),
            "highPrice": s(self.high_price),
            "lowPrice": s(self.low_price),
            "volume": s(self.volume),
            "turnover": s(self.turnover),
        }


class VnstockSource:
    def __init__(self, provider: str = "vci", api_key: str = "") -> None:
        self.provider = provider
        # Áp key ngay lúc khởi tạo để mọi lệnh sau đó chạy dưới đúng tài khoản.
        self.status = apply_api_key(api_key)

    # ------------------------------------------------------------------ quotes
    def fetch_quotes(self, symbols: list[str]) -> tuple[list[QuoteRow], list[str]]:
        """
        Lấy bảng giá cho nhiều mã trong một lần gọi.

        Trả về (danh sách giá, danh sách mã thất bại).

        Giá ở đây đã là ĐỒNG, không cần quy đổi.
        """
        if not symbols:
            return [], []

        try:
            board = Trading(source=self.provider, symbol=symbols[0]).price_board(symbols)
        except Exception as exc:  # nguồn ngoài — phải bắt mọi lỗi
            print(f"  price_board thất bại cho {len(symbols)} mã: {type(exc).__name__}: {exc}")
            return [], list(symbols)

        rows: list[QuoteRow] = []
        seen: set[str] = set()

        for _, row in board.iterrows():
            symbol = _cell(row, "listing", "symbol")
            if not isinstance(symbol, str) or not symbol:
                continue
            symbol = symbol.upper()

            reference = _to_int(_cell(row, "listing", "ref_price"))
            match_price = _to_int(_cell(row, "match", "match_price"))

            # NGOÀI GIỜ GIAO DỊCH match_price = 0. Lấy 0 làm giá sẽ khiến toàn bộ
            # Portfolio Value về 0 — dùng giá tham chiếu làm giá thay thế.
            has_match = bool(match_price and match_price > 0)
            price = match_price if has_match else reference
            if not price or price <= 0:
                continue

            rows.append(
                QuoteRow(
                    symbol=symbol,
                    price=price,
                    reference_price=reference,
                    ceiling_price=_to_int(_cell(row, "listing", "ceiling")),
                    floor_price=_to_int(_cell(row, "listing", "floor")),
                    open_price=_to_int(_cell(row, "match", "open_price")),
                    high_price=_to_int(_cell(row, "match", "highest")) or None,
                    low_price=_to_int(_cell(row, "match", "lowest")) or None,
                    volume=_to_int(_cell(row, "match", "accumulated_volume")),
                    turnover=_to_int(_cell(row, "match", "accumulated_value")),
                    used_reference=not has_match,
                )
            )
            seen.add(symbol)

        failed = [s for s in symbols if s.upper() not in seen]
        return rows, failed

    # ----------------------------------------------------------------- history
    def fetch_history(
        self, symbol: str, start: date, end: date
    ) -> list[dict[str, str]]:
        """
        Lấy OHLCV theo ngày cho một mã.

        Giá từ `history()` ở NGHÌN ĐỒNG nên được nhân 1000 tại đây.
        """
        try:
            df = Quote(source=self.provider, symbol=symbol).history(
                start=start.isoformat(), end=end.isoformat(), interval="1D"
            )
        except Exception as exc:
            print(f"  history({symbol}) thất bại: {type(exc).__name__}: {exc}")
            return []

        if df is None or df.empty:
            return []

        bars: list[dict[str, str]] = []
        for _, row in df.iterrows():
            def px(col: str) -> int | None:
                raw = row.get(col)
                if raw is None:
                    return None
                value = _to_int(float(raw) * HISTORY_PRICE_MULTIPLIER)
                return value

            open_p, high_p, low_p, close_p = px("open"), px("high"), px("low"), px("close")
            if None in (open_p, high_p, low_p, close_p):
                continue

            trading_day = pd.Timestamp(row["time"]).date()
            bars.append(
                {
                    "symbol": symbol.upper(),
                    "tradingDate": trading_day.isoformat(),
                    "openPrice": str(open_p),
                    "highPrice": str(high_p),
                    "lowPrice": str(low_p),
                    "closePrice": str(close_p),
                    "volume": str(_to_int(row.get("volume")) or 0),
                }
            )
        return bars

    # ------------------------------------------------------------------ indices
    def fetch_index(
        self, index_code: str, start: date, end: date
    ) -> list[dict[str, str]]:
        """
        Lấy lịch sử chỉ số.

        Chỉ số là điểm số, không phải tiền — KHÔNG nhân 1000. Nhân 100 để giữ hai
        chữ số thập phân bằng số nguyên (1788,78 → 178878).
        """
        try:
            df = Quote(source=self.provider, symbol=index_code).history(
                start=start.isoformat(), end=end.isoformat(), interval="1D"
            )
        except Exception as exc:
            print(f"  index({index_code}) thất bại: {type(exc).__name__}: {exc}")
            return []

        if df is None or df.empty:
            return []

        bars: list[dict[str, str]] = []
        for _, row in df.iterrows():
            def scaled(col: str) -> str | None:
                raw = row.get(col)
                if raw is None:
                    return None
                value = _to_int(float(raw) * INDEX_SCALE)
                return None if value is None else str(value)

            close = scaled("close")
            if close is None:
                continue

            bars.append(
                {
                    "indexCode": index_code.upper(),
                    "tradingDate": pd.Timestamp(row["time"]).date().isoformat(),
                    "closeValue": close,
                    "openValue": scaled("open"),
                    "highValue": scaled("high"),
                    "lowValue": scaled("low"),
                    "volume": str(_to_int(row.get("volume")) or 0),
                }
            )
        return bars
