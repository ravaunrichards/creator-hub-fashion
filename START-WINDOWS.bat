@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.5 or newer is required. Install it before starting Creator Hub Fashion.
  pause
  exit /b 1
)
if not exist ".env" copy ".env.example" ".env" >nul
for /f "delims=" %%v in ('node -p "process.versions.node"') do set NODE_VERSION=%%v
echo Creator Hub Fashion ^| Node.js %NODE_VERSION%
echo Keep this window open while the storefront is running.
echo Open http://localhost:3000 on this computer.
echo To test on a phone using the same Wi-Fi, use this computer's local IP address with port 3000.
echo.
npm start
pause
