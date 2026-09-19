# Khởi động / dừng / xem trạng thái Market Data Service.
#
#   .\run.ps1 start     chạy vòng lặp lấy giá ở chế độ nền
#   .\run.ps1 stop      dừng
#   .\run.ps1 status    xem đang chạy hay không, và log mới nhất
#   .\run.ps1 log       theo dõi log trực tiếp
#
# VÌ SAO CẦN FILE NÀY
# `python sync.py quotes --loop` phải chạy liên tục. Nếu không có tiến trình nào
# sống, Dashboard sẽ báo "Market Data trễ N phút" — đúng sự thật, nhưng nguyên
# nhân (service không chạy) rất dễ bị hiểu sai thành lỗi nguồn dữ liệu.
#
# Script này KHÔNG tạo scheduled task. Sau khi khởi động lại máy phải chạy `start`
# lại. Muốn tự khởi động cùng Windows thì tạo Task Scheduler riêng — xem README.
#
# LƯU Ý VỀ MÃ HOÁ: file này phải được lưu UTF-8 CÓ BOM. Windows PowerShell 5.1 đọc
# file .ps1 không BOM theo bảng mã ANSI, làm mọi ký tự Unicode trong chuỗi và regex
# bị hỏng âm thầm — kể cả bộ lọc log bên dưới.

param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'status', 'log')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'

$ServiceDir = $PSScriptRoot
$RepoRoot = Split-Path (Split-Path $ServiceDir -Parent) -Parent
$Python = Join-Path $ServiceDir '.venv\Scripts\python.exe'
$LogDir = Join-Path $RepoRoot 'logs'
$LogFile = Join-Path $LogDir 'market-data.log'
$PidFile = Join-Path $LogDir 'market-data.pid'

function Get-ServiceProcess {
    # Tìm theo dòng lệnh, không dựa vào PID file: PID file có thể còn lại sau khi
    # tiến trình chết bất thường, và PID đó có thể đã được hệ thống cấp cho việc khác.
    Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*sync.py*' -and $_.CommandLine -like '*--loop*' }
}

function Get-ServiceRoot {
    # Trên Windows, `.venv\Scripts\python.exe` chỉ là launcher: nó chạy tiếp
    # interpreter thật, nên MỘT service xuất hiện thành HAI tiến trình. Chỉ báo cáo
    # tiến trình gốc để không gây tưởng là có hai service đang chạy song song.
    $all = @(Get-ServiceProcess)
    if ($all.Count -eq 0) { return @() }
    $ids = $all | ForEach-Object { $_.ProcessId }
    $all | Where-Object { $ids -notcontains $_.ParentProcessId }
}

function Show-Log {
    param([int]$Tail = 12)

    if (-not (Test-Path $LogFile)) { return }

    # Bỏ các dòng banner quảng cáo của vnstock (toàn ký tự vẽ khung Unicode
    # U+2500–U+257F) và dòng chứa emoji, để dòng log thật không bị chôn.
    # So sánh theo MÃ ký tự thay vì viết ký tự Unicode vào regex — cách sau phụ
    # thuộc mã hoá file và từng hỏng trên PowerShell 5.1.
    Get-Content $LogFile -Encoding UTF8 -Tail 200 -ErrorAction SilentlyContinue |
        Where-Object {
            if ($_.Trim() -eq '') { return $false }
            foreach ($ch in $_.ToCharArray()) {
                $code = [int]$ch
                if ($code -ge 0x2500 -and $code -le 0x257F) { return $false }  # vẽ khung
                if ($code -ge 0x2700 -and $code -le 0x27BF) { return $false }  # dingbats
                if ($code -ge 0xD800 -and $code -le 0xDFFF) { return $false }  # emoji
            }
            return $true
        } |
        Select-Object -Last $Tail
}

switch ($Action) {
    'start' {
        if (-not (Test-Path $Python)) {
            Write-Error "Chua co venv. Chay: python -m venv .venv; .venv\Scripts\python.exe -m pip install -r requirements.txt"
            exit 1
        }

        $existing = Get-ServiceRoot
        if ($existing) {
            Write-Host "Service da chay (PID $($existing[0].ProcessId))." -ForegroundColor Yellow
            exit 0
        }

        if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }

        $proc = Start-Process -FilePath $Python `
            -ArgumentList 'sync.py', 'quotes', '--loop' `
            -WorkingDirectory $ServiceDir `
            -RedirectStandardOutput $LogFile `
            -RedirectStandardError "$LogFile.err" `
            -WindowStyle Hidden -PassThru

        $proc.Id | Out-File -Encoding ascii $PidFile

        Start-Sleep -Seconds 3
        if ($proc.HasExited) {
            Write-Host "Service thoat ngay lap tuc (exit $($proc.ExitCode)). Log:" -ForegroundColor Red
            Show-Log -Tail 20
            exit 1
        }

        Write-Host "Da khoi dong (PID $($proc.Id))." -ForegroundColor Green
        Write-Host "Log: $LogFile"
    }

    'stop' {
        $procs = @(Get-ServiceProcess)
        if ($procs.Count -eq 0) {
            Write-Host 'Service khong chay.' -ForegroundColor Yellow
            exit 0
        }
        # Dừng cả cha và con: chỉ kill launcher thì interpreter con vẫn sống tiếp.
        foreach ($p in $procs) {
            Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        }
        Write-Host "Da dung $($procs.Count) tien trinh." -ForegroundColor Green
        if (Test-Path $PidFile) { Remove-Item $PidFile -Force }
    }

    'status' {
        $roots = @(Get-ServiceRoot)
        $all = @(Get-ServiceProcess)

        if ($roots.Count -gt 0) {
            $childInfo = if ($all.Count -gt $roots.Count) { " (+$($all.Count - $roots.Count) tien trinh con)" } else { '' }
            Write-Host "DANG CHAY - PID $($roots[0].ProcessId)$childInfo" -ForegroundColor Green
        }
        else {
            Write-Host 'KHONG CHAY' -ForegroundColor Red
            Write-Host 'Dashboard se bao "Market Data tre N phut" cho den khi chay lai.'
        }

        Write-Host "`n--- log gan nhat ---"
        Show-Log -Tail 12
    }

    'log' {
        if (-not (Test-Path $LogFile)) { Write-Error "Chua co log tai $LogFile"; exit 1 }
        Get-Content $LogFile -Encoding UTF8 -Wait -Tail 30
    }
}
