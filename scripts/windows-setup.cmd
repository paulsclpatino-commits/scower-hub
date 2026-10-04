@echo off
rem Shared checks for start.cmd and start-demo.cmd. Run from the Scower folder.
rem Exits with errorlevel 1 (after explaining why) if Scower can't start.

if not exist "package.json" (
  echo.
  echo   Scower's files aren't next to this script.
  echo   If you opened it from inside the ZIP file, extract the ZIP first:
  echo   right-click the ZIP, choose "Extract All...", open the extracted folder,
  echo   and double-click start-demo.cmd there.
  echo.
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js isn't installed, or Windows can't find it.
  echo   Install the "LTS" version from https://nodejs.org, then run this again.
  echo   If you just installed it, restart your computer first.
  echo.
  start "" "https://nodejs.org/en/download"
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)"
if errorlevel 1 (
  echo.
  for /f "delims=" %%v in ('node -v') do echo   Your Node.js is %%v, but Scower needs v20.9 or newer.
  echo   Install the current "LTS" version from https://nodejs.org, then run this again.
  echo.
  start "" "https://nodejs.org/en/download"
  exit /b 1
)

rem Install packages on first run, and again whenever package-lock.json changes
rem (node_modules\.scower-installed remembers which package-lock.json was installed).
node -e "const fs=require('fs');const h=require('crypto').createHash('sha1').update(fs.readFileSync('package-lock.json')).digest('hex');let s='';try{s=fs.readFileSync('node_modules/.scower-installed','utf8')}catch{}process.exit(s===h?0:1)"
if errorlevel 1 (
  echo.
  echo   Installing Scower's packages. This takes a minute the first time...
  echo.
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   Installing packages failed. Check your internet connection and try again.
    echo.
    exit /b 1
  )
  node -e "const fs=require('fs');fs.writeFileSync('node_modules/.scower-installed',require('crypto').createHash('sha1').update(fs.readFileSync('package-lock.json')).digest('hex'))"
)
exit /b 0
