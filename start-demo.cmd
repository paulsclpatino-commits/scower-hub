@echo off
setlocal
title Scower (demo)
pushd "%~dp0"

if not exist "scripts\windows-setup.cmd" (
  echo.
  echo   Scower's other files aren't next to this script.
  echo   If you opened it from inside the ZIP file, extract the ZIP first:
  echo   right-click the ZIP, choose "Extract All...", open the extracted folder,
  echo   and double-click this file there.
  goto :failed
)

call "scripts\windows-setup.cmd"
if %errorlevel% neq 0 goto :failed

echo.
echo   Starting Scower in demo mode: sample listings, no API keys needed.
echo   Every search shows the same sample results, whatever photo you use.
echo   For real searches, close this window and double-click start.cmd instead.
node server.js --demo --open
if %errorlevel% neq 0 goto :failed
goto :eof

:failed
echo.
pause
exit /b 1
