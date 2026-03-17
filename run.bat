@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d %~dp0

echo.
echo ============================================
echo   minecraft-auto-bedrock GUI Manager
echo ============================================
echo.

:: ── 依存関係更新 ──────────────────────────────────────────────
echo [run] Checking dependencies...
call npm install --silent
if errorlevel 1 (
  echo [run] ERROR: npm install failed.
  echo [run] Continuing with existing installation...
)

:: ── GUI を起動（ポート自動選択付き） ─────────────────────────────
echo [run] Starting GUI...
node scripts\start-gui.js
if errorlevel 1 (
  echo [run] ERROR: GUI startup failed.
  pause
  endlocal
  exit /b 1
)

echo.
echo [run] GUI is running. Access: http://localhost:3000
echo [run] Bot/Java server management: GUI control panel
echo.
pause
endlocal
