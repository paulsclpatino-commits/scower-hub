@echo off
setlocal
title Scower
cd /d "%~dp0"

call "scripts\windows-setup.cmd"
if errorlevel 1 goto :failed

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo.
  echo   Created a settings file called .env and opened it in Notepad.
  echo   Paste your API keys after the = signs, for example:
  echo       SERPAPI_KEY=abc123
  echo   Save the file, close Notepad, then double-click start.cmd again.
  echo   See README.md for where to get each key.
  echo.
  start "" notepad ".env"
  pause
  exit /b 0
)

echo.
echo   Starting Scower. Your browser will open in a moment.
echo   Close this window to stop Scower.
node server.js --open
if errorlevel 1 goto :failed
goto :eof

:failed
echo.
pause
exit /b 1
