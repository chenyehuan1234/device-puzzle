# =============================================================================
# 打包单文件版（可带关卡包）+ 自检
#   由 build.cmd 调用： build.cmd [关卡包.json]
#   也可以直接跑：     pwsh -File tools\build.ps1
#
# 注意：本文件必须存成「UTF-8 带 BOM」。
#   Windows PowerShell 5.1 会把没有 BOM 的脚本当 ANSI 读，中文全变乱码甚至语法错误。
#   tests/packaging.test.js 会盯着这一条。
# 找关卡包的活交给 node（按文件内容识别），这里不做中文路径判断。
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
  Say "装上 Node.js（ https://nodejs.org/ ）之后重新打开这个窗口再试。"
  exit 1
}
Say ("node: " + $node.Source) 'DarkGray'
Say ("目录: " + $root) 'DarkGray'

# ---------------------------------------------------------------- 2. 打包
if (-not $Bundle) { $Bundle = '' }
if ($Bundle -and -not (Test-Path -LiteralPath $Bundle)) {
  Say ("找不到这个关卡包文件：{0}" -f $Bundle) 'Red'
  Say "用法： build.cmd                          自动找根目录里的关卡包"
  Say "       build.cmd 我的关卡.json"
  Say "       build.cmd samples\示例关卡包.json"
  exit 1
}

Say ""
if ($Bundle) {
  Say ("=== 打包单文件版（指定关卡包：{0}） ===" -f $Bundle)
  & node tools\build-single.js $Bundle
} else {
  Say "=== 打包单文件版 ==="
  & node tools\build-single.js
}
if ($LASTEXITCODE -ne 0) { Say "" ; Say "打包失败" 'Red'; exit $LASTEXITCODE }

# ---------------------------------------------------------------- 3. 自检
Say ""
Say "=== 自检单文件版（无头 Chrome，一次性临时 profile，不会碰你的关卡库） ==="
& (Join-Path $root 'tools\check-single.ps1')
$rc = $LASTEXITCODE
if ($rc -ne 0) { Say "自检没通过 —— 上面标红的项目要看一眼" 'Red'; exit $rc }

Say ""
Say "搞定！单文件版都在 dist\ 目录里：" 'Green'
Say "  机关谜题.html / device-puzzle.html   —— 空游戏（玩家自己画关）"
Say "  带关卡-*.html                        —— 一份带关卡的完整游戏，发给别人用这个" 'Green'
exit 0
