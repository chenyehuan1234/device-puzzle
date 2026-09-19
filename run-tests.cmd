@echo off
rem ---------------------------------------------------------------
rem  Run all Node tests (no browser needed).
rem  ASCII-only + CRLF on purpose: see build.cmd for why.
rem ---------------------------------------------------------------
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set RC=0

echo === 1/4 rules engine ===
node tests\rules.test.js
if errorlevel 1 set RC=1

echo.
echo === 2/4 level bundle ===
node tests\bundle.test.js
if errorlevel 1 set RC=1

echo.
echo === 3/4 ui smoke (fake DOM) ===
node tests\ui.smoke.js
if errorlevel 1 set RC=1

echo.
echo === 4/4 packaging hygiene ===
node tests\packaging.test.js
if errorlevel 1 set RC=1

echo.
if "%RC%"=="0" echo [OK] all node tests passed
if not "%RC%"=="0" echo [FAILED] see the red lines above
echo.
echo Browser self-check : pwsh -File tests\run-probe.ps1
echo Single-file build : build.cmd
pause
exit /b %RC%
