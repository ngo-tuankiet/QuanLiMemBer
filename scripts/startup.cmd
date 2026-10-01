@echo off
REM ===========================================================================
REM  Khoi dong ca hai tien trinh cua Dashboard luc dang nhap Windows.
REM
REM  Duoc goi boi mot file dat trong thu muc Startup cua nguoi dung:
REM    %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\VN Investment.cmd
REM
REM  VI SAO STARTUP FOLDER MA KHONG PHAI TASK SCHEDULER
REM  Dang ky task o thu muc goc cua Task Scheduler can quyen nang cao
REM  (Register-ScheduledTask tra ve "Access is denied" khi khong elevated).
REM  Startup folder chay duoi chinh tai khoan dang dang nhap, khong can quyen
REM  nang cao va khong can luu mat khau o dau. Muon dung Task Scheduler thi xem
REM  huong dan trong services/market-data/README.md.
REM
REM  /min: hai cua so console nam duoi taskbar thay vi che man hinh. Khong AN
REM  hoan toan la co y — mot tien trinh vo hinh khong the tat duoc bang tay se
REM  kho xu ly hon la mot cua so nam trong taskbar.
REM
REM  KHONG CAN DO TRE giua hai tien trinh. Vong lap lay gia POST vao app; app
REM  chua len thi lan hoi dau that bai, nhung `fetch_watchlist` bat loi va thu
REM  lai sau MARKET_DATA_INTERVAL_SECONDS giay (300s). Nguong lam moi la 120
REM  PHUT nen tre 5 phut o lan dang nhap khong anh huong gi.
REM
REM  KHONG DUNG DIACRITIC — cmd.exe doc .cmd theo OEM codepage.
REM ===========================================================================

start "VN Investment - App" /min cmd /c ""%~dp0task-app.cmd""
start "VN Investment - Market Data" /min cmd /c ""%~dp0task-market-data.cmd""
