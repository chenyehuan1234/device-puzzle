# =============================================================================
# 一键发布到 GitHub Pages
#   做的事：打包单文件版 → 挑「带关卡」的那一份 → 同步成 docs\index.html → 提交推送
#
#   前提：GitHub 仓库的 Pages 源目录设成「main 分支 / docs 文件夹」（只需设一次）
#   用法： pwsh -File tools\publish-pages.ps1
#
# 注意：本文件必须存成「UTF-8 带 BOM」。
#   Windows PowerShell 5.1 会把没有 BOM 的脚本当 ANSI 读，中文全变乱码甚至语法错误。
#   改完跑一下 pwsh -File tools\fix-script-encoding.ps1 一键修好。
# =============================================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say($msg, $color) { if ($color) { Write-Host $msg -ForegroundColor $color } else { Write-Host $msg } }

# ---------------------------------------------------------------- 1. 打包
Say ""
Say "=== 1/3 打包单文件版 ==="
& node tools\build-single.js
if ($LASTEXITCODE -ne 0) { Say "" ; Say "打包失败，中止。" 'Red'; exit $LASTEXITCODE }

# ---------------------------------------------------------------- 2. 挑一份
$dist = Join-Path $root 'dist'
$withLevels = Get-ChildItem $dist -Filter '带关卡-*.html' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($withLevels) {
  $src = $withLevels
  Say ("用带关卡的那一份：" + $withLevels.Name) 'DarkGray'
} else {
  $plain = Join-Path $dist 'device-puzzle.html'
  if (-not (Test-Path $plain)) { Say ("dist 里没有产物，打包可能没成功：{0}" -f $plain) 'Red'; exit 1 }
  $src = Get-Item $plain
  Say "dist 里没有「带关卡」的单文件版 —— 这次发布的是空游戏（玩家得自己画关）" 'Yellow'
  Say "想带关卡：编辑器左栏「关卡包」→「导出整个关卡库」→ 把 json 放到项目根目录 → 再跑一次本脚本" 'Yellow'
}

# ---------------------------------------------------------------- 3. 同步
$docs = Join-Path $root 'docs'
New-Item -ItemType Directory -Path $docs -Force | Out-Null
Copy-Item -LiteralPath $src.FullName -Destination (Join-Path $docs 'index.html') -Force
# 空文件，作用是让 GitHub Pages 别拿 Jekyll 去处理这个目录
[System.IO.File]::WriteAllText((Join-Path $docs '.nojekyll'), '', (New-Object System.Text.UTF8Encoding($false)))

$kb = [math]::Round($src.Length / 1KB, 1)
Say ""
Say "=== 2/3 同步到 docs\index.html ==="
Say ("  {0}  →  docs\index.html（{1} KB）" -f $src.Name, $kb) 'Green'

# ---------------------------------------------------------------- 4. 提交推送
Say ""
Say "=== 3/3 提交并推送 ==="
git add docs
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Say "  docs\ 内容没变化，不用提交" 'DarkGray'
} else {
  git commit -m "chore: 同步 GitHub Pages（docs/）"
  if ($LASTEXITCODE -ne 0) { Say "提交失败" 'Red'; exit $LASTEXITCODE }
}

$remote = (git remote get-url origin 2>$null)
if (-not $remote) {
  Say ""
  Say "还没有配置远程仓库，先建一个再推：" 'Yellow'
  Say "  gh repo create device-puzzle --public --source=. --remote=origin"
  Say "  git push -u origin main --tags"
  exit 0
}

git push
if ($LASTEXITCODE -ne 0) { Say "推送失败（网络？权限？）" 'Red'; exit $LASTEXITCODE }

Say ""
Say "好了，线上地址：" 'Green'
if ($remote -match 'github\.com[:/](?<owner>[^/]+?)/(?<repo>[^/\.]+?)(\.git)?$') {
  Say ("  https://{0}.github.io/{1}/" -f $Matches.owner, $Matches.repo) 'Green'
} else {
  Say ("  远程是 {0}，Pages 地址去仓库 Settings → Pages 里看" -f $remote) 'Green'
}
