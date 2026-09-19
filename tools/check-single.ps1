# 自检「单文件版」：用无头 Chrome 打开 dist 里的单文件，
# 确认内联脚本真的跑起来了（调色板画出来了、关卡树填上了、顶栏版本号写上了）；
# 如果这一份内嵌了关卡包，还要确认关卡真的被装进关卡库、选关界面能看到卡片。
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

# 用一次性临时用户目录，保证是「第一次打开」的状态（才能真正测到自动装关卡包）
$profile = Join-Path $env:TEMP ("mp-check-" + [guid]::NewGuid().ToString('N'))

Start-Process -FilePath $chrome -NoNewWindow -Wait -PassThru -ArgumentList @(
  "--headless=new", "--disable-gpu", "--allow-file-access-from-files",
  "--user-data-dir=$profile",
  "--window-size=1400,900", "--virtual-time-budget=8000", "--dump-dom", $url
) -RedirectStandardOutput $dump -RedirectStandardError $err | Out-Null

# 一定要按 UTF-8 读：Windows PowerShell 5.1 的 Get-Content -Raw 会按 ANSI 解码，
# 那样中文断言（比如「主对角（左上↔右下）」）就永远匹配不上了。
$txt = [System.IO.File]::ReadAllText($dump, [System.Text.Encoding]::UTF8)
Remove-Item $dump, $err -ErrorAction SilentlyContinue
Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue

$seeded = ($txt -match 'window\.MP_SEED = ')
$cards = [regex]::Matches($txt, 'class="level-card').Count
$cardCount = ([regex]::Matches($txt, 'level-card')).Count

$checks = @(
  @{ name = '页面里有内联 <style>';      pass = ($txt -match '<style>') },
  @{ name = '没有任何外部 js 引用';      pass = ($txt -notmatch '<script src=') },
  @{ name = '调色板真的建出来了';        pass = ([regex]::Matches($txt, 'class="pal-btn[" ]').Count -ge 50) },
  @{ name = '两种对角交换器在里面';      pass = (($txt -match '主对角（左上↔右下）') -and ($txt -match '副对角（左下↔右上）')) },
  @{ name = '四种拐角交换器在里面';      pass = (($txt -match '上右（上↔右）') -and ($txt -match '上左（上↔左）') -and ($txt -match '下左（下↔左）') -and ($txt -match '下右（下↔右）')) },
  @{ name = '解法录制面板在里面';        pass = (($txt -match 'id="sol-info"') -and ($txt -match 'id="btn-sol-replay"')) },
  @{ name = '关卡包面板在里面';          pass = (($txt -match 'id="btn-export-all"') -and ($txt -match 'id="btn-import-bundle"')) },
  @{ name = '关卡信息栏真的渲出来了';    pass = ([regex]::Matches($txt, 'tree-empty|tree-item|tree-chapter').Count -ge 1) },
  @{ name = '顶栏写了版本号 + 单文件版'; pass = ($txt -match 'v0\.\d+\.\d+ · 单文件版') },
  @{ name = 'canvas 已经按舞台尺寸建好'; pass = ($txt -match 'id="board"[^>]*width="[1-9]\d{2,}"') }
)

if ($seeded) {
  $checks += @{ name = '内嵌关卡包：大关真的建出来了'; pass = (([regex]::Matches($txt, 'class="chapter-block"').Count -ge 1) -or ([regex]::Matches($txt, 'class="chapter-title"').Count -ge 1)) }
  $checks += @{ name = '内嵌关卡包：选关界面有卡片';   pass = ($cards -ge 1) }
  $checks += @{ name = '内嵌关卡包：卡片带缩略图';     pass = ([regex]::Matches($txt, 'class="lc-thumb"').Count -ge 1) }
} else {
  $checks += @{ name = '这一份没带关卡（空游戏，符合预期）'; pass = (-not $seeded) }
}

$fail = 0
foreach ($c in $checks) {
  if ($c.pass) { Write-Host ("PASS " + $c.name) } else { Write-Host ("FAIL " + $c.name) -ForegroundColor Red; $fail++ }
}
Write-Host ""
if ($seeded) { Write-Host ("这一份内嵌了关卡包，选关界面渲染出 {0} 张关卡卡片" -f $cards) -ForegroundColor Cyan }
Write-Host ("单文件版自检：通过 {0} 项，失败 {1} 项" -f ($checks.Count - $fail), $fail) -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
if ($fail) { exit 1 }
