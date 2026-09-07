@echo off
setlocal
REM ===========================================================================
REM  Chay Market Data Service o che do vong lap. Duoc goi boi scheduled task
REM  "VN Investment - Market Data" luc dang nhap Windows.
REM
REM  PHU THUOC VAO TASK APP: tien trinh nay POST vao http://127.0.0.1:3000. App
REM  chua len thi lan hoi dau tien that bai — khong sao, vong lap tu thu lai sau
REM  MARKET_DATA_INTERVAL_SECONDS giay. Trigger cua task van dat tre 1 phut de
REM  lan dau khong phai la mot dong loi trong log.
REM
REM  KHONG goi run.ps1: script do dung Start-Process nen no tra ve ngay va Task
REM  Scheduler tuong task da xong trong khi python van chay. Goi thang python o
REM  foreground thi trang thai task phan anh dung trang thai service.
REM
REM  KHONG DUNG DIACRITIC — xem ly do trong scripts/task-app.cmd.
REM ===========================================================================

cd /d "%~dp0..\services\market-data"

set PY=.venv\Scripts\python.exe
set LOG=..\..\logs\market-data.log

if not exist ..\..\logs mkdir ..\..\logs

echo. >> %LOG%
echo [%date% %time%] --- khoi dong market data (task-market-data.cmd) --- >> %LOG%

if not exist "%PY%" (
  echo [%date% %time%] LOI: chua co venv tai services\market-data\.venv >> %LOG%
  echo [%date% %time%] Tao bang: python -m venv .venv ^&^& .venv\Scripts\python.exe -m pip install -r requirements.txt >> %LOG%
  exit /b 1
)

REM Vong lap tu quyet dinh khi nao goi nguon: no hoi app "gia cu bao nhieu phut"
REM va chi lay khi qua nguong market_data.refresh_after_minutes (mac dinh 120).
REM Nho vay luot bam nut "Cap nhat gia" cung duoc tinh vao.
"%PY%" sync.py quotes --loop >> %LOG% 2>&1

echo [%date% %time%] market data da dung, exit=%errorlevel% >> %LOG%
exit /b %errorlevel%
