@echo off
setlocal
title Scower settings
pushd "%~dp0"

if not exist "package.json" (
  echo.
  echo   Scower's other files aren't next to this script.
  echo   If you opened it from inside the ZIP file, extract the ZIP first:
  echo   right-click the ZIP, choose "Extract All...", open the extracted folder,
  echo   and double-click this file there.
  echo.
  pause
  exit /b 1
)

if not exist ".env" if exist ".env.txt" ren ".env.txt" ".env"
if not exist ".env" copy /y ".env.example" ".env" >nul

rem Opens the settings in Notepad. Restart Scower (close its window, then
rem double-click start.cmd) after saving so it picks up the changes.
start "" notepad ".env"
