# =============================================================================
# 一键修脚本编码（改完 .cmd / .ps1 之后跑一下）
#   - .cmd  → CRLF 换行（cmd.exe 解析不了 LF 换行 + 中文）
#   - .ps1  → UTF-8 带 BOM（没有 BOM 时 Windows PowerShell 5.1 会按 ANSI 读，中文乱码）
#   pwsh -File tools\fix-script-encoding.ps1
# =============================================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$utf8bom = New-Object System.Text.UTF8Encoding($true)
$utf8nobom = New-Object System.Text.UTF8Encoding($false)

# ---- .cmd：CRLF ----
Get-ChildItem -Path $root -Filter '*.cmd' -File | ForEach-Object {
  $t = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
  $t = ($t -replace "`r`n", "`n") -replace "`n", "`r`n"
  [System.IO.File]::WriteAllText($_.FullName, $t, $utf8nobom)
  Write-Host ("CRLF  ✓ " + $_.Name)
}

# ---- .ps1：UTF-8 BOM ----
Get-ChildItem -Path $root -Recurse -Filter '*.ps1' -File | ForEach-Object {
  if ($_.FullName -like '*\node_modules\*') { return }
  $t = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
  [System.IO.File]::WriteAllText($_.FullName, $t, $utf8bom)
  Write-Host ("BOM   ✓ " + $_.FullName.Substring($root.Length + 1))
}

Write-Host ""
Write-Host "好了。想确认的话跑： node tests\packaging.test.js" -ForegroundColor Green
