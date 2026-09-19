@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === 1/3 规则引擎单元测试 ===
node tests\rules.test.js || exit /b 1
echo.
echo === 2/3 关卡包单元测试 ===
node tests\bundle.test.js || exit /b 1
echo.
echo === 3/3 界面层冒烟测试（假 DOM） ===
node tests\ui.smoke.js || exit /b 1
echo.
echo 全部通过。
echo 想再跑一遍真实浏览器自检： pwsh -File tests\run-probe.ps1
echo 想打包单文件版：         build.cmd
pause
