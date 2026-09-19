@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 用法：
rem   build.cmd                     打包（如果根目录有 关卡库.json 就自动带上关卡）
rem   build.cmd 关卡库.json          指定关卡包
rem   build.cmd samples\示例关卡包.json   用示例关卡包试试

set BUNDLE=%~1
if "%BUNDLE%"=="" if exist "关卡库.json" set BUNDLE=关卡库.json

echo === 打包单文件版 ===
if "%BUNDLE%"=="" (
  node tools\build-single.js
) else (
  node tools\build-single.js "%BUNDLE%"
)
if errorlevel 1 exit /b 1

echo.
echo === 自检单文件版（无头 Chrome） ===
pwsh -File tools\check-single.ps1
if errorlevel 1 exit /b 1

echo.
echo 单文件版在 dist\ 目录里：双击就能玩，也可以直接发给别人。
echo 带上关卡的那种是 dist\带关卡-*.html，那个才是「一份完整的游戏」。
pause
