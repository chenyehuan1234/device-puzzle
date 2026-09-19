# 自检「单文件版」：用无头 Chrome 打开 dist 里的单文件，
# 确认内联脚本真的跑起来了（调色板画出来了、关卡树填上了、顶栏版本号写上了）。
#   用法： pwsh -File tools\check-single.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$file = Join-Path $root 'dist\机关谜题.html'
if (-not (Test-Path $file)) {
  Write-Host "找不到 $file —— 先跑 node tools\build-single.js" -ForegroundColor Red
  exit 1
}

$chrome = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Host "找不到 Chrome / Edge" -ForegroundColor Red; exit 1 }

$url = "file:///" + ($file -replace '\\', '/')
$dump = Join-Path $root 'dist\_check.html'
$err = Join-Path $root 'dist\_check.err'

Start-Process -FilePath $chrome -NoNewWindow -Wait -PassThru -ArgumentList @(
  "--headless=new", "--disable-gpu", "--allow-file-access-from-files",
  "--window-size=1400,900", "--virtual-time-budget=8000", "--dump-dom", $url
) -RedirectStandardOutput $dump -RedirectStandardError $err | Out-Null

$txt = Get-Content $dump -Raw
Remove-Item $dump, $err -ErrorAction SilentlyContinue

$checks = @(
  @{ name = '页面里有内联 <style>';      pass = ($txt -match '<style>') },
  @{ name = '没有任何外部 js 引用';      pass = ($txt -notmatch '<script src=') },
  @{ name = '调色板真的建出来了';        pass = ([regex]::Matches($txt, 'class="pal-btn"').Count -ge 40) },
  @{ name = '两种新对角交换器在里面';    pass = (($txt -match '主对角（左上↔右下）') -and ($txt -match '副对角（左下↔右上）')) },
  @{ name = '关卡信息栏真的渲出来了';    pass = ([regex]::Matches($txt, 'tree-empty|tree-item|tree-chapter').Count -ge 1) },
  @{ name = '顶栏写了版本号 + 单文件版'; pass = ($txt -match 'v0\.\d+\.\d+ · 单文件版') },
  @{ name = 'canvas 已经按舞台尺寸建好'; pass = ($txt -match 'id="board"[^>]*width="[1-9]\d{2,}"') }
)

$fail = 0
foreach ($c in $checks) {
  if ($c.pass) { Write-Host ("PASS " + $c.name) } else { Write-Host ("FAIL " + $c.name) -ForegroundColor Red; $fail++ }
}
Write-Host ""
Write-Host ("单文件版自检：通过 {0} 项，失败 {1} 项" -f ($checks.Count - $fail), $fail) -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
if ($fail) { exit 1 }
