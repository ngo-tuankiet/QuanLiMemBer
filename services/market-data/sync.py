"""
MARKET DATA SERVICE — Phase 07 (§10).

    VNStock  →  service này  →  POST /api/market-data/ingest  →  database
                                                                    ↓
                                                          Portfolio Engine
                                                                    ↓
                                                              Dashboard

Chạy:
    python sync.py quotes          lấy giá một lần rồi thoát
    python sync.py quotes --loop   chạy liên tục theo chu kỳ
    python sync.py history --days 90
    python sync.py index --days 365
    python sync.py check           kiểm tra cấu hình và kết nối, không ghi gì

Service KHÔNG mở kết nối database. Nó gọi route nội bộ của Next.js để mọi quy tắc
schema và tiền tệ nằm ở một chỗ duy nhất (xem app/api/market-data/ingest/route.ts).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

from config import CONFIG
from vnstock_source import VnstockSource

ICT = timezone(timedelta(hours=7))

# Ghi log theo dòng, mã hoá UTF-8.
#
# Hai vấn đề đều chỉ xuất hiện khi chạy như tiến trình nền, nên rất dễ bỏ sót:
#
#   1. Python ĐỆM stdout khi output bị chuyển hướng vào file thay vì terminal. Với
#      `quotes --loop` dưới Task Scheduler hay systemd, file log RỖNG hàng giờ rồi
#      mới xuất hiện một cục — đúng lúc cần xem log để biết service còn sống thì
#      lại không có gì.
#
#   2. Trên Windows, stdout mặc định dùng bảng mã hệ thống (cp1252/cp1258) nên
#      tiếng Việt trong file log thành ký tự rác, không đọc được.
#
# Sửa tại đây thay vì bắt người dùng nhớ thêm `-u` và đặt PYTHONIOENCODING mỗi lần.
try:
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
except (AttributeError, OSError):
    pass


# ---------------------------------------------------------------------------
# Gọi cổng nạp dữ liệu
# ---------------------------------------------------------------------------

def _request(url: str, method: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "content-type": "application/json",
            "x-market-data-token": CONFIG.ingest_token,
        },
    )
    with urllib.request.urlopen(req, timeout=CONFIG.request_timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_watchlist() -> dict:
    """Hỏi app xem cần lấy giá những mã nào.

    Service không tự quyết định danh sách mã — nếu tự quyết, việc thêm mã theo dõi
    sẽ phải sửa cấu hình tiến trình nền thay vì làm ở trang Stocks.
    """
    return _request(CONFIG.ingest_url, "GET")


def push(payload: dict) -> dict:
    """
    Nạp dữ liệu, kèm theo id của dòng nhật ký nếu lần chạy này do người bấm nút.

    MARKET_DATA_SYNC_ID do server action đặt khi người dùng bấm "Cập nhật giá" trên
    trang Market Data. App đã tạo sẵn một dòng `market_data_syncs` ở trạng thái
    RUNNING với `triggeredBy = MANUAL` và id của người bấm; gửi id đó lên để cổng
    nạp CẬP NHẬT đúng dòng ấy thay vì tạo dòng thứ hai.

    Thiếu biến này — tức là chạy theo vòng lặp nền — thì không gửi gì, và cổng nạp
    tạo dòng mới với `triggeredBy = CRON` như cũ.

    Vì sao đặt ở đây chứ không ở từng câu lệnh: mọi lệnh (`quotes`, `history`,
    `index`) đều đi qua hàm này, nên một chỗ là đủ và không lệnh nào bị bỏ sót.
    """
    sync_id = os.environ.get("MARKET_DATA_SYNC_ID", "").strip()
    if sync_id:
        payload = {**payload, "syncId": sync_id}
    return _request(CONFIG.ingest_url, "POST", payload)


# ---------------------------------------------------------------------------
# Giờ giao dịch
# ---------------------------------------------------------------------------

def is_weekday(now: datetime) -> bool:
    return now.weekday() < 5  # 5 = thứ Bảy, 6 = Chủ nhật


def in_trading_hours(now: datetime | None = None) -> bool:
    """
    HOSE/HNX: 09:00–15:00 ICT, thứ Hai đến thứ Sáu.

    Ngoài giờ mà gọi liên tục thì vừa vô ích vừa tốn hạn mức truy cập.
    """
    if CONFIG.ignore_trading_hours:
        return True
    now = now or datetime.now(ICT)
    if not is_weekday(now):
        return False
    return CONFIG.session_start_hour <= now.hour < CONFIG.session_end_hour


def close_moment(day: datetime) -> datetime:
    """Thời điểm lấy giá chốt phiên của một ngày: giờ đóng cửa + độ trễ cấu hình."""
    return day.replace(
        hour=CONFIG.session_end_hour, minute=0, second=0, microsecond=0
    ) + timedelta(seconds=CONFIG.close_delay_seconds)


def should_fetch_close(now: datetime, last_close_date: date | None) -> bool:
    """
    Có cần lấy GIÁ ĐÓNG CỬA của hôm nay hay không.

    VÌ SAO CẦN HÀM NÀY
    Với chu kỳ dài (ví dụ 60 phút), các lần gọi rơi vào 09:00, 10:00, … 14:00 —
    còn lần 15:00 bị `in_trading_hours()` coi là ngoài giờ nên bỏ qua. Kết quả là
    **giá đóng cửa không bao giờ được lấy**, dù đó là giá quan trọng nhất trong
    ngày để định giá danh mục cuối phiên.

    Vì vậy sau khi phiên kết thúc, service lấy thêm ĐÚNG MỘT lần cho mỗi ngày giao
    dịch, ở mốc `giờ đóng cửa + close_delay_seconds`. Không lặp lại:
    `last_close_date` chặn việc gọi lại suốt buổi tối.
    """
    if CONFIG.ignore_trading_hours:
        return False
    if not is_weekday(now):
        return False
    if now < close_moment(now):
        return False
    return last_close_date != now.date()


def seconds_until_next_event(now: datetime, last_close_date: date | None) -> float:
    """
    Ngủ bao lâu khi đang ngoài giờ giao dịch.

    Ngủ theo mốc sự kiện thay vì cứ 5 phút thức một lần. Với chu kỳ 60 phút, việc
    này quan trọng: nếu chỉ polling thô thì lần lấy giá chốt phiên có thể lệch tới
    vài phút so với mốc 15:00:30 mong muốn.

    Mốc kế tiếp là sớm nhất trong hai thứ: giờ chốt phiên hôm nay (nếu chưa lấy),
    hoặc giờ mở phiên của ngày giao dịch tiếp theo.
    """
    candidates: list[datetime] = []

    if is_weekday(now) and last_close_date != now.date():
        close_at = close_moment(now)
        if close_at > now:
            candidates.append(close_at)

    # Giờ mở phiên gần nhất trong tương lai (bỏ qua thứ Bảy, Chủ nhật).
    probe = now
    for _ in range(1, 5):
        probe = probe + timedelta(days=1)
        if is_weekday(probe):
            candidates.append(
                probe.replace(hour=CONFIG.session_start_hour, minute=0, second=0, microsecond=0)
            )
            break

    open_today = now.replace(
        hour=CONFIG.session_start_hour, minute=0, second=0, microsecond=0
    )
    if is_weekday(now) and open_today > now:
        candidates.append(open_today)

    if not candidates:
        return 300.0

    # Chừa 1 giây để lúc thức dậy đã chắc chắn qua mốc.
    return max(1.0, (min(candidates) - now).total_seconds() + 1)


# ---------------------------------------------------------------------------
# Các lệnh
# ---------------------------------------------------------------------------

def cmd_check() -> int:
    print("=" * 70)
    print(" KIỂM TRA CẤU HÌNH MARKET DATA SERVICE")
    print("=" * 70)

    problems = CONFIG.validate()
    print(f"\n  Nguồn giá (provider) : {CONFIG.provider}")
    print(f"  Cổng nạp dữ liệu     : {CONFIG.ingest_url}")
    print(f"  Token                : {'đã đặt' if CONFIG.ingest_token else 'CHƯA ĐẶT'}")
    interval = CONFIG.interval_seconds
    print(
        f"  Chu kỳ               : {interval}s"
        + (f" ({interval // 60} phút)" if interval >= 120 else "")
    )
    print(f"  Chỉ số theo dõi      : {', '.join(CONFIG.index_codes)}")
    print(f"  Trong giờ giao dịch  : {'có' if in_trading_hours() else 'không'}")

    # In lịch chạy dự kiến để thấy ngay giá đóng cửa có được lấy hay không.
    now_ict = datetime.now(ICT)
    session_hours = CONFIG.session_end_hour - CONFIG.session_start_hour
    runs_in_session = max(1, int(session_hours * 3600 / interval))
    print(
        f"  Phiên                : {CONFIG.session_start_hour:02d}:00–"
        f"{CONFIG.session_end_hour:02d}:00 ICT · ~{runs_in_session} lần/ngày trong phiên"
    )
    print(
        f"  Chốt giá đóng cửa    : {CONFIG.session_end_hour:02d}:00:"
        f"{CONFIG.close_delay_seconds:02d} (giờ đóng cửa + {CONFIG.close_delay_seconds}s), 1 lần/ngày"
    )
    if CONFIG.ignore_trading_hours:
        print("  LƯU Ý                : MARKET_DATA_IGNORE_HOURS đang bật —")
        print("                         chạy mọi lúc và KHÔNG có lần chốt phiên riêng.")
    elif in_trading_hours(now_ict):
        print(f"  Lần chạy tiếp theo   : ngay (đang trong phiên), rồi mỗi {interval // 60} phút")
    else:
        wake = now_ict + timedelta(seconds=seconds_until_next_event(now_ict, None))
        print(f"  Lần chạy tiếp theo   : {wake:%d/%m %H:%M:%S}")

    # Áp key và hiển thị TIER THẬT do vnstock báo, không suy đoán từ việc có key
    # hay không — key miễn phí và key tài trợ đều là "có key" nhưng hạn mức khác nhau.
    source = VnstockSource(CONFIG.provider, CONFIG.vnstock_api_key)
    if CONFIG.vnstock_api_key:
        status = source.status or {}
        tier = status.get("tier", "?")
        limits = status.get("limits") or {}
        print(f"  API key vnstock      : {status.get('api_key_preview', 'đã đặt')}")
        print(f"  Tier                 : {tier}")
        if limits:
            print(
                f"  Hạn mức              : {limits.get('per_minute', '?')} req/phút"
                f" · {limits.get('per_hour', '?')} req/giờ"
            )
        # Cảnh báo nếu chu kỳ quá dày so với hạn mức.
        per_minute = limits.get("per_minute")
        if isinstance(per_minute, int) and per_minute > 0:
            calls_per_minute = 60 / max(1, CONFIG.interval_seconds)
            if calls_per_minute > per_minute:
                print(
                    f"  CẢNH BÁO             : chu kỳ {CONFIG.interval_seconds}s vượt hạn mức"
                    f" {per_minute} req/phút"
                )
    else:
        print("  API key vnstock      : không có (dùng mức mặc định của thư viện)")

    if problems:
        print("\n  VẤN ĐỀ CẤU HÌNH:")
        for p in problems:
            print(f"    - {p}")
        return 1

    print("\n  Thử gọi cổng nạp dữ liệu…")
    try:
        info = fetch_watchlist()
    except urllib.error.HTTPError as exc:
        print(f"    LỖI HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:300]}")
        return 1
    except Exception as exc:
        print(f"    LỖI: {type(exc).__name__}: {exc}")
        print("    App Next.js có đang chạy ở địa chỉ trên không?")
        return 1

    symbols = info.get("symbols", [])
    print(f"    OK — app yêu cầu {len(symbols)} mã: {', '.join(symbols[:15])}{'…' if len(symbols) > 15 else ''}")

    print("\n  Thử lấy giá thật từ vnstock…")
    probe = symbols[:3] or ["MBB", "VCB", "FPT"]
    rows, failed = source.fetch_quotes(probe)
    for row in rows:
        print(f"    {row.symbol:<6} {row.price:>10,} ₫   (tham chiếu {row.reference_price or 0:,})")
    if failed:
        print(f"    Không lấy được: {', '.join(failed)}")

    print("\n  Cấu hình hợp lệ. Chạy `python sync.py quotes` để nạp giá thật.\n")
    return 0


def cmd_quotes(loop: bool) -> int:
    source = VnstockSource(CONFIG.provider, CONFIG.vnstock_api_key)
    last_close_date: date | None = None

    while True:
        started = time.monotonic()
        now = datetime.now(ICT)

        # Ngoài giờ: chỉ chạy nếu còn nợ lần chốt giá đóng cửa của hôm nay.
        closing_run = False
        if loop and not in_trading_hours(now):
            if should_fetch_close(now, last_close_date):
                closing_run = True
                print(
                    f"[{now:%H:%M:%S}] chốt phiên {now.date()} "
                    f"(giờ đóng cửa {CONFIG.session_end_hour}:00 + {CONFIG.close_delay_seconds}s)"
                )
            else:
                wait = seconds_until_next_event(now, last_close_date)
                wake = now + timedelta(seconds=wait)
                print(
                    f"[{now:%H:%M:%S}] ngoài giờ giao dịch — ngủ tới {wake:%d/%m %H:%M:%S}"
                )
                time.sleep(wait)
                continue

        try:
            info = fetch_watchlist()
        except Exception as exc:
            print(f"[{now:%H:%M:%S}] không hỏi được danh sách mã: {exc}")
            if not loop:
                return 1
            time.sleep(CONFIG.interval_seconds)
            continue

        # ------------------------------------------------------------------
        # ĐÃ CŨ CHƯA? Nếu chưa thì không gọi nguồn.
        #
        # App trả về `ageMinutes` (tính từ lần đồng bộ THÀNH CÔNG gần nhất, kể cả
        # lượt do người bấm nút "Cập nhật giá") và `refreshAfterMinutes` (ngưỡng
        # trong system_settings). Cả hai đi kèm chính request hỏi danh sách mã ở
        # trên, nên phép kiểm này không thêm lượt gọi nào.
        #
        # VÌ SAO NGƯỠNG DO APP QUYẾT, KHÔNG PHẢI `.env` CỦA TIẾN TRÌNH NÀY:
        #
        #   1. Người bấm nút và tiến trình nền phải biết đến nhau. Chỉ database
        #      biết "ai đó vừa bấm 5 phút trước"; tiến trình nền không thấy được.
        #      Thiếu phép kiểm này thì vừa bấm tay xong, lượt tự động kế tiếp vẫn
        #      gọi nguồn lần nữa cho cùng khoảng thời gian đó.
        #
        #   2. Ngưỡng sửa được ở trang Settings lúc đang chạy. Nếu tiến trình giữ
        #      bản riêng thì có hai nguồn sự thật, và người sửa qua giao diện sẽ
        #      thấy không có gì đổi.
        #
        # LƯỢT CHỐT PHIÊN KHÔNG BỊ CHẶN. Giá đóng cửa là giá quan trọng nhất trong
        # ngày; nếu 14:05 vừa có một lượt thì tới 15:00:30 tuổi dữ liệu mới 55 phút
        # và phép kiểm này sẽ bỏ qua lượt chốt — mất giá đóng cửa của cả ngày.
        # ------------------------------------------------------------------
        if loop and not closing_run:
            tuoi = info.get("ageMinutes")
            nguong = info.get("refreshAfterMinutes")
            if isinstance(tuoi, int) and isinstance(nguong, int) and tuoi < nguong:
                cho = max(1.0, min(float(CONFIG.interval_seconds), (nguong - tuoi) * 60.0))
                boi = info.get("lastTriggeredBy") or "?"
                print(
                    f"[{now:%H:%M:%S}] giá mới {tuoi}/{nguong} phút "
                    f"(lượt gần nhất: {boi}) — chưa cần lấy, ngủ {int(cho)}s"
                )
                time.sleep(cho)
                continue

        symbols: list[str] = info.get("symbols", [])
        if not symbols:
            print(f"[{now:%H:%M:%S}] app chưa yêu cầu mã nào (chưa có giao dịch). Dùng ?all=1 nếu muốn lấy toàn bộ.")
            if not loop:
                return 0
            time.sleep(CONFIG.interval_seconds)
            continue

        all_rows = []
        all_failed: list[str] = []

        # Chia lô — gọi cả trăm mã một lượt hay bị nguồn chặn.
        for i in range(0, len(symbols), CONFIG.batch_size):
            batch = symbols[i : i + CONFIG.batch_size]
            rows, failed = source.fetch_quotes(batch)
            all_rows.extend(rows)
            all_failed.extend(failed)

        payload = {
            "source": "VNSTOCK",
            "provider": CONFIG.provider,
            "tradingDate": now.date().isoformat(),
            "quotes": [r.to_payload() for r in all_rows],
            "failedSymbols": all_failed,
            "durationMs": int((time.monotonic() - started) * 1000),
        }

        fallback_count = sum(1 for r in all_rows if r.used_reference)

        try:
            result = push(payload)
            unknown = result.get("unknownSymbols") or []
            print(
                f"[{now:%H:%M:%S}] {result.get('status')} — cập nhật {result.get('updated')}/{len(symbols)} mã"
                + (" [CHỐT PHIÊN]" if closing_run else "")
                + (f", {len(all_failed)} lỗi nguồn" if all_failed else "")
                + (f", {len(unknown)} mã chưa có trong master data: {', '.join(unknown[:8])}" if unknown else "")
            )

            if closing_run:
                real = len(all_rows) - fallback_count
                print(f"           {real}/{len(all_rows)} mã có giá khớp thật")
                # Nếu quá nửa phải lùi về giá tham chiếu thì độ trễ còn quá ngắn —
                # nói thẳng thay vì để người dùng tự đoán vì sao giá trông "cũ".
                if all_rows and fallback_count * 2 > len(all_rows):
                    print(
                        f"           CẢNH BÁO: {fallback_count} mã phải dùng giá tham chiếu. "
                        f"Nguồn chưa công bố giá khớp sau {CONFIG.close_delay_seconds}s — "
                        f"tăng MARKET_CLOSE_DELAY_SECONDS."
                    )
                # Chỉ đánh dấu đã chốt phiên khi việc nạp THÀNH CÔNG. Nếu đánh dấu
                # trước, một lần lỗi mạng sẽ làm mất giá đóng cửa của cả ngày.
                last_close_date = now.date()
        except urllib.error.HTTPError as exc:
            print(f"[{now:%H:%M:%S}] nạp thất bại HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:300]}")
            if not loop:
                return 1
        except Exception as exc:
            print(f"[{now:%H:%M:%S}] nạp thất bại: {type(exc).__name__}: {exc}")
            if not loop:
                return 1

        if not loop:
            return 0

        elapsed = time.monotonic() - started
        time.sleep(max(1.0, CONFIG.interval_seconds - elapsed))


def _throttle_delay(source: VnstockSource) -> float:
    """
    Khoảng nghỉ giữa hai request để không vượt hạn mức của nguồn.

    `history` và `index` gọi MỘT request cho MỖI mã, khác với `quotes` gộp nhiều mã
    vào một lần `price_board`. Với 84 mã và hạn mức 60 req/phút, gọi liên tục không
    nghỉ sẽ bị chặn giữa đường — và tệ hơn là chặn im lặng, chỉ thấy vài mã "không
    có dữ liệu".
    """
    limits = (source.status or {}).get("limits") or {}
    per_minute = limits.get("per_minute")
    if not isinstance(per_minute, int) or per_minute <= 0:
        per_minute = 60  # mức thận trọng khi nguồn không báo hạn mức
    # Chừa 20% biên an toàn.
    return 60.0 / (per_minute * 0.8)


def cmd_history(days: int) -> int:
    source = VnstockSource(CONFIG.provider, CONFIG.vnstock_api_key)
    end = date.today()
    start = end - timedelta(days=days)

    info = fetch_watchlist()
    symbols: list[str] = info.get("symbols", [])
    if not symbols:
        print("Chưa có mã nào cần lấy lịch sử.")
        return 0

    delay = _throttle_delay(source)
    print(
        f"Lấy OHLCV {start} → {end} cho {len(symbols)} mã "
        f"(nghỉ {delay:.2f}s giữa các request để giữ hạn mức)…"
    )

    started = time.monotonic()
    bars: list[dict] = []
    failed: list[str] = []

    for index, symbol in enumerate(symbols):
        if index > 0:
            time.sleep(delay)
        rows = source.fetch_history(symbol, start, end)
        if rows:
            bars.extend(rows)
            print(f"  {symbol:<6} {len(rows)} phiên")
        else:
            failed.append(symbol)
            print(f"  {symbol:<6} không có dữ liệu")

    if not bars:
        print("Không lấy được phiên nào.")
        return 1

    result = push(
        {
            "source": "VNSTOCK",
            "provider": CONFIG.provider,
            "tradingDate": end.isoformat(),
            "history": bars,
            "failedSymbols": failed,
            "durationMs": int((time.monotonic() - started) * 1000),
        }
    )
    print(f"\n{result.get('status')} — ghi {result.get('updated')} dòng OHLCV.")
    return 0


def cmd_index(days: int) -> int:
    source = VnstockSource(CONFIG.provider, CONFIG.vnstock_api_key)
    end = date.today()
    start = end - timedelta(days=days)

    started = time.monotonic()
    delay = _throttle_delay(source)
    bars: list[dict] = []
    failed: list[str] = []

    for index, code in enumerate(CONFIG.index_codes):
        if index > 0:
            time.sleep(delay)
        rows = source.fetch_index(code, start, end)
        if rows:
            bars.extend(rows)
            last = rows[-1]
            value = int(last["closeValue"]) / 100
            print(f"  {code:<10} {len(rows)} phiên · gần nhất {last['tradingDate']} = {value:,.2f}")
        else:
            failed.append(code)
            print(f"  {code:<10} không có dữ liệu")

    if not bars:
        print("Không lấy được chỉ số nào.")
        return 1

    result = push(
        {
            "source": "VNSTOCK",
            "provider": CONFIG.provider,
            "tradingDate": end.isoformat(),
            "indices": bars,
            "failedSymbols": failed,
            "durationMs": int((time.monotonic() - started) * 1000),
        }
    )
    print(f"\n{result.get('status')} — ghi {result.get('updated')} dòng chỉ số.")
    return 0


def cmd_groups(groups: list[str], out_path: str = "") -> int:
    """
    In thành phần các rổ chỉ số dưới dạng JSON, KHÔNG ghi gì vào database.

    Ai dùng: `npm run check:index` — đối chiếu VN30_SEED / VN100_SEED trong
    src/data/master-data.ts với rổ thật. Rổ được cơ cấu lại mỗi kỳ nên một danh sách
    khai trong seed sẽ lặng lẽ cũ đi; trước khi có phép kiểm này, VN30 trong seed đã
    lệch 11 mã mà không ai biết.

    Vì sao service chỉ IN RA thay vì tự sửa seed: quyết định mã nào vào master data là
    của app (§7). Service chỉ báo cáo nguồn nói gì.

    GHI RA FILE khi có `--out`, và đó là cách các script nên dùng.

    Lý do không để bên gọi đọc stdout: `vnstock` in một banner quảng cáo vẽ bằng ký
    tự khung ra chính stdout mỗi lần import, nên "JSON ở stdout" là hợp đồng không
    đứng vững — bên gọi sẽ phải đoán dòng nào là JSON. Lọc theo dấu ngoặc nhọn thì
    chạy được hôm nay và vỡ im lặng ngày nguồn đổi banner.

    Vẫn in ra stdout để người gõ tay đọc được.
    """
    from vnstock import Listing

    lst = Listing(source=CONFIG.provider)
    out: dict[str, list[str]] = {}
    for g in groups:
        try:
            out[g] = sorted(str(x) for x in lst.symbols_by_group(g))
        except Exception as exc:
            print(f"không lấy được rổ {g}: {type(exc).__name__}: {exc}", file=sys.stderr)
            return 1

    text = json.dumps(out, ensure_ascii=False)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"đã ghi {out_path}", file=sys.stderr)
    print(text)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Market Data Service (vnstock → Dashboard)")
    parser.add_argument("command", choices=["check", "quotes", "history", "index", "groups"])
    parser.add_argument("--loop", action="store_true", help="chạy liên tục theo chu kỳ")
    parser.add_argument("--days", type=int, default=90, help="số ngày lịch sử cần lấy")
    parser.add_argument(
        "--groups",
        default="VN30,VN100",
        help="các rổ cần in với lệnh groups, phân cách bằng dấu phẩy",
    )
    parser.add_argument(
        "--out",
        default="",
        help="ghi JSON của lệnh groups ra file này (tin cậy hơn đọc stdout)",
    )
    args = parser.parse_args()

    problems = CONFIG.validate()
    if problems and args.command not in ("check", "groups"):
        for p in problems:
            print(f"CẤU HÌNH SAI: {p}")
        return 1

    if args.command == "check":
        return cmd_check()
    if args.command == "quotes":
        return cmd_quotes(args.loop)
    if args.command == "history":
        return cmd_history(args.days)
    if args.command == "index":
        return cmd_index(args.days)
    if args.command == "groups":
        return cmd_groups(
            [g.strip().upper() for g in args.groups.split(",") if g.strip()],
            args.out,
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())
