@echo off
setlocal
title Scower (demo)
cd /d "%~dp0"

call "scripts\windows-setup.cmd"
if errorlevel 1 goto :failed

echo.
echo   Starting Scower in demo mode (sample listings, no API keys needed).
echo   Your browser will open in a moment. Close this window to stop Scower.
node server.js --demo --open
if errorlevel 1 goto :failed
goto :eof

:failed
echo.
pause
exit /b 1
