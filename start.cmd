@echo off
setlocal
title Scower
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

if not exist ".env" if exist ".env.txt" ren ".env.txt" ".env"
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo.
  echo   Created a settings file called .env and opened it in Notepad.
  echo   Paste your API keys after the = signs, for example:
  echo       SERPAPI_KEY=abc123
  echo   Save the file, close Notepad, then double-click start.cmd again.
  echo   See README.md for where to get each key. To change them later,
  echo   double-click edit-settings.cmd.
  echo.
  start "" notepad ".env"
  pause
  exit /b 0
)

echo.
echo   Starting Scower. Your browser will open in a moment.
echo   If the demo is still open in another window, close it first.
node server.js --open
if %errorlevel% neq 0 goto :failed
goto :eof

:failed
echo.
pause
exit /b 1
