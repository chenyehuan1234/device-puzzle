@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 打包单文件版 ===
node tools\build-single.js || exit /b 1
echo.
echo === 自检单文件版（无头 Chrome） ===
pwsh -File tools\check-single.ps1 || exit /b 1
echo.
echo 单文件版在 dist\ 目录里，直接双击就能玩，也可以直接发给别人。
pause
