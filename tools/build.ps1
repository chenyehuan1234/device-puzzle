# =============================================================================
# 打包单文件版（可带关卡包）+ 自检
#   由 build.cmd 调用：build.cmd [关卡包.json]
#   也可以直接跑：    pwsh -File tools\build.ps1
# =============================================================================
param([string]$Bundle = '')

$ErrorActionPreference = 'Stop'
try { & chcp.com 65001 | Out-Null } catch {}
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say($msg, $color) { if ($color) { Write-Host $msg -ForegroundColor $color } else { Write-Host $msg } }

# ---------------------------------------------------------------- 1. 检查 node
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Say "找不到 node.js —— 打包要用它来把 js/css 内联成一个文件。" 'Red'
  Say "装上 Node.js（https://nodejs.org/）之后重新打开这个窗口再试。"
  exit 1
}
Say ("node: " + $node.Source) 'DarkGray'

# ---------------------------------------------------------------- 2. 找关卡包
if (-not $Bundle) {
  if (Test-Path (Join-Path $root '关卡库.json')) { $Bundle = '关卡库.json' }
}
if ($Bundle -and -not (Test-Path $Bundle)) {
  Say ("找不到关卡包：{0}" -f $Bundle) 'Red'
  Say "用法： build.cmd            （自动找根目录的 关卡库.json）"
  Say "       build.cmd 我的关卡.json"
  Say "       build.cmd samples\示例关卡包.json"
  exit 1
}

Say ""
if ($Bundle) {
  Say ("=== 打包单文件版（带关卡包：{0}） ===" -f $Bundle)
  & node tools\build-single.js $Bundle
} else {
  Say "=== 打包单文件版（不带关卡） ==="
  Say "    （根目录没有 关卡库.json；想做成「一份带关卡的完整游戏」，"
  Say "      先在编辑器里「导出整个关卡库」，把文件改名成 关卡库.json 放到根目录再来打包）"
  & node tools\build-single.js
}
if ($LASTEXITCODE -ne 0) { Say "打包失败" 'Red'; exit $LASTEXITCODE }

# ---------------------------------------------------------------- 3. 自检
Say ""
Say "=== 自检单文件版（无头 Chrome，用一次性临时 profile，不会碰你的关卡库） ==="
& (Join-Path $root 'tools\check-single.ps1')
$rc = $LASTEXITCODE
if ($rc -ne 0) { Say "自检没通过 —— 上面标红的项目要看一眼" 'Red'; exit $rc }

Say ""
Say "搞定！单文件版都在 dist\ 目录里：" 'Green'
Say "  机关谜题.html / device-puzzle.html   —— 空游戏（玩家自己画关）"
if ($Bundle) { Say "  带关卡-*.html                        —— 一份带关卡的完整游戏，发给别人用这个" 'Green' }
exit 0
