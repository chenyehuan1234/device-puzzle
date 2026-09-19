# 在真实 Chrome 里跑一遍界面自检（无头模式），并把结果打印出来。
#   用法：  pwsh -File tests\run-probe.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$chrome = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) { Write-Host "找不到 Chrome / Edge，无法跑浏览器自检" -ForegroundColor Red; exit 1 }

$probeUrl = "file:///" + ($root -replace '\\', '/') + "/tests/probe.html"
$dump = Join-Path $root "tests\dump.html"
$err = Join-Path $root "tests\dump.err"

Start-Process -FilePath $chrome -NoNewWindow -Wait -PassThru -ArgumentList @(
  "--headless=new", "--disable-gpu", "--allow-file-access-from-files",
  "--window-size=1400,900", "--virtual-time-budget=15000", "--dump-dom", $probeUrl
) -RedirectStandardOutput $dump -RedirectStandardError $err | Out-Null

$txt = Get-Content $dump -Raw
$m = [regex]::Match($txt, '(?s)<pre id="probe-out"[^>]*>(.*?)</pre>')
if (-not $m.Success) { Write-Host "没有拿到探针结果（页面可能报错）" -ForegroundColor Red; exit 1 }

$body = $m.Groups[1].Value -replace '&lt;', '<' -replace '&gt;', '>' -replace '&amp;', '&'
$lines = $body -split "`n"
$fail = ($lines | Where-Object { $_ -like 'FAIL*' }).Count
$pass = ($lines | Where-Object { $_ -like 'PASS*' }).Count

$lines | Where-Object { $_ -like 'FAIL*' -or $_ -like 'ERRORS*' -or $_ -like 'DBG*' -or $_ -like 'WATCHDOG*' }
Write-Host ""
Write-Host ("浏览器自检：通过 {0} 项，失败 {1} 项" -f $pass, $fail) -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
Remove-Item $dump, $err -ErrorAction SilentlyContinue
if ($fail) { exit 1 }
