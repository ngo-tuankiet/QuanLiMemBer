"""
CẤU HÌNH MARKET DATA SERVICE — đây là chỗ khai báo nguồn giá.

Toàn bộ đọc từ biến môi trường (file `.env` ở gốc repo), không hardcode.

MỘT ĐIỀU CẦN NÓI RÕ VỀ VNSTOCK
vnstock KHÔNG phải một REST API có endpoint và API key để dán vào. Nó là một
**thư viện Python** bọc các nguồn dữ liệu công khai (VCI, KBS, MSN, DNSE...).
Vì vậy ở đây không có ô "API URL" hay "API key" cho giá — thứ bạn cấu hình là:

    MARKET_DATA_PROVIDER   nguồn con nào (vci / kbs / msn / dnse)
    MARKET_DATA_INTERVAL   bao lâu lấy một lần
    VNSTOCK_API_KEY        chỉ cần nếu bạn mua gói Insiders của vnstock

Gói Insiders (https://vnstocks.com/insiders-program) là tuỳ chọn: nó tăng giới
hạn truy cập và tắt banner quảng cáo. Không có nó thì thư viện vẫn chạy.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    """
    Đọc `.env` ở gốc repo.

    Tự viết thay vì dùng python-dotenv để service không cần thêm dependency, và
    để dùng **cùng một file .env** với app Next.js — hai nơi cấu hình riêng là
    nguồn gốc của lỗi "chạy được ở app nhưng service lại trỏ sai database".
    """
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return

    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # Biến môi trường thật luôn thắng file .env.
        os.environ.setdefault(key, value)


_load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    # ---------------------------------------------------------------- nguồn giá
    #
    # Nguồn con của vnstock. Đã kiểm chứng với vnstock 4.0.7:
    #   vci   — mặc định, có bảng giá đầy đủ (price_board) và OHLCV lịch sử
    #   kbs   — mặc định của thư viện, cũng hỗ trợ Quote
    #   msn   — dữ liệu quốc tế, KHÔNG dùng cho cổ phiếu Việt Nam
    #   dnse  — nguồn thay thế
    #
    # Chọn `vci` vì đây là nguồn duy nhất trả về đủ giá trần/sàn/tham chiếu mà
    # bảng giá Việt Nam cần, trong một lần gọi cho nhiều mã.
    provider: str = field(default_factory=lambda: os.environ.get("MARKET_DATA_PROVIDER", "vci").lower())

    # Chỉ cần khi mua gói Insiders. Để trống thì dùng mức truy cập miễn phí.
    vnstock_api_key: str = field(default_factory=lambda: os.environ.get("VNSTOCK_API_KEY", ""))

    # ------------------------------------------------------- cổng nạp dữ liệu
    # Service KHÔNG ghi trực tiếp vào database — nó POST vào route nội bộ của
    # Next.js để mọi quy tắc schema và tiền tệ nằm ở một chỗ.
    ingest_url: str = field(
        default_factory=lambda: os.environ.get("MARKET_DATA_INGEST_URL", "http://127.0.0.1:3000/api/market-data/ingest")
    )
    ingest_token: str = field(default_factory=lambda: os.environ.get("MARKET_DATA_INGEST_TOKEN", ""))

    # ------------------------------------------------------------------ nhịp độ
    interval_seconds: int = field(default_factory=lambda: _int("MARKET_DATA_INTERVAL_SECONDS", 60))
    request_timeout: int = field(default_factory=lambda: _int("MARKET_DATA_REQUEST_TIMEOUT", 30))
    # Số mã mỗi lần gọi price_board. Gọi cả 100 mã một lượt hay bị nguồn chặn.
    batch_size: int = field(default_factory=lambda: _int("MARKET_DATA_BATCH_SIZE", 50))

    # ----------------------------------------------------- giờ giao dịch (ICT)
    # HOSE/HNX: 09:00–11:30 và 13:00–15:00, thứ Hai đến thứ Sáu.
    # Ngoài giờ thì không gọi liên tục — vừa vô ích vừa dễ bị nguồn giới hạn.
    session_start_hour: int = field(default_factory=lambda: _int("MARKET_SESSION_START_HOUR", 9))
    session_end_hour: int = field(default_factory=lambda: _int("MARKET_SESSION_END_HOUR", 15))

    # Chờ bao lâu sau giờ đóng cửa rồi mới lấy giá chốt phiên.
    #
    # Giá đóng cửa được xác định ở phiên ATC (khoảng 14:45 trên HOSE), nhưng nguồn
    # dữ liệu cần vài giây để công bố. Lấy đúng lúc 15:00:00 có thể vẫn nhận được
    # giá khớp bằng 0 và phải lùi về giá tham chiếu — mất chính giá quan trọng nhất
    # trong ngày. Tăng con số này nếu thấy log báo nhiều mã dùng giá tham chiếu.
    close_delay_seconds: int = field(default_factory=lambda: _int("MARKET_CLOSE_DELAY_SECONDS", 30))
    ignore_trading_hours: bool = field(
        default_factory=lambda: os.environ.get("MARKET_DATA_IGNORE_HOURS", "").lower() in {"1", "true", "yes"}
    )

    @property
    def index_codes(self) -> list[str]:
        raw = os.environ.get("MARKET_DATA_INDICES", "VNINDEX")
        return [c.strip().upper() for c in raw.split(",") if c.strip()]

    def validate(self) -> list[str]:
        problems: list[str] = []
        if not self.ingest_token:
            problems.append(
                "MARKET_DATA_INGEST_TOKEN chưa đặt. Sinh một chuỗi ngẫu nhiên và đặt "
                "GIỐNG NHAU ở cả .env của app và của service."
            )
        if self.provider not in {"vci", "kbs", "dnse"}:
            problems.append(
                f"MARKET_DATA_PROVIDER='{self.provider}' không dùng được cho cổ phiếu Việt Nam. "
                "Chọn vci, kbs hoặc dnse."
            )
        return problems


CONFIG = Config()
