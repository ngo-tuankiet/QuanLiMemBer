@echo off
setlocal
REM ===========================================================================
REM  Chay server production cua Dashboard. Duoc goi boi scheduled task
REM  "VN Investment - App" luc dang nhap Windows.
REM
REM  VI SAO CAN WRAPPER NAY THAY VI TRO TASK THANG VAO npm:
REM    1. Task Scheduler khong co cho ghi log. O day chuyen het ra logs\app.log,
REM       nen khi app khong len thi co cho de doc nguyen nhan.
REM    2. Kiem npm co tren PATH khong. Task chay voi PATH khac shell tuong tac;
REM       thieu npm ma khong bao gi la loi rat kho tim.
REM    3. Logic nam trong repo, duoc git theo doi. Dinh nghia task chi con mot
REM       dong tro tro vao file nay.
REM
REM  KHONG DUNG DIACRITIC: cmd.exe doc file .cmd theo OEM codepage, tieng Viet
REM  co dau se thanh ky tu rac. Ghi khong dau de log con doc duoc.
REM ===========================================================================

REM %~dp0 = thu muc chua file nay (scripts\), nen ".." la goc repo.
cd /d "%~dp0.."

if not exist logs mkdir logs

echo. >> logs\app.log
echo [%date% %time%] --- khoi dong app (task-app.cmd) --- >> logs\app.log

where npm >nul 2>&1
if errorlevel 1 (
  echo [%date% %time%] LOI: khong thay npm tren PATH. Task khong chay duoc. >> logs\app.log
  exit /b 1
)

REM npm start = node scripts/serve.mjs, phuc vu .next-build (KHONG phai .next).
REM Xem chu thich trong scripts/serve.mjs: npm start truoc day phuc vu sai thu muc.
REM
REM Chay o FOREGROUND: Task Scheduler giu trang thai "Running" suot thoi gian app
REM song, nen xem task la biet app con song hay khong.
npm start >> logs\app.log 2>&1

echo [%date% %time%] app da dung, exit=%errorlevel% >> logs\app.log
exit /b %errorlevel%
