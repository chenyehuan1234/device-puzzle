@echo off
rem ---------------------------------------------------------------
rem  Build the single-file HTML version (optionally with a level pack)
rem  This file is intentionally ASCII-only and CRLF: a .cmd with LF
rem  line endings (or non-ASCII text) makes cmd.exe fail with a flash.
rem ---------------------------------------------------------------
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "tools\build.ps1" %*
set RC=%ERRORLEVEL%

echo.
if not "%RC%"=="0" echo [FAILED] build.cmd exit code %RC%
pause
exit /b %RC%
