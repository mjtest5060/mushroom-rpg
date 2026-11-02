@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 20 or later is required.
  echo Download from https://nodejs.org/
  pause
  exit /b 1
)
echo.
echo ======================================
echo   Mushroom Forest Multiplayer RPG
echo ======================================
echo Open http://localhost:3000 in your browser.
echo Stop server with Ctrl+C.
echo.
node server.js
pause
