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

:: ── Java バージョンチェック ───────────────────────────────────
echo [run] Checking Java installation...
java -version >nul 2>&1
if errorlevel 1 (
  echo [run] WARNING: Java not found in PATH
  echo [run] Please install Java 16+ from https://www.java.com/
) else (
  for /f "tokens=* delims=" %%A in ('java -version 2^>^&1') do echo [run] %%A
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

:: ── PM2プロセスの存在確認と起動 ───────────────────────────────
pm2 describe minecraft-auto-bedrock >nul 2>nul
if errorlevel 1 (
  echo [run] minecraft-auto-bedrock process not found in PM2. Starting...
  pm2 startOrRestart ecosystem.config.cjs
  if errorlevel 1 (
    echo [run] ERROR: PM2 startOrRestart failed.
    pause
    endlocal
    exit /b 1
  )
)

echo.
echo [run] GUI is running. Access: http://localhost:3000 or auto-assigned port
echo [run] Bot/Java server management: GUI control panel
echo.
echo [run] Monitoring bot logs... (Press Ctrl+C to stop log monitor)
pm2 logs minecraft-auto-bedrock --lines 30
echo.
echo [run] Log monitor ended. Press any key to close this window.
pause >nul
endlocal
