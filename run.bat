@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d %~dp0

echo.
echo ============================================
echo   minecraft-auto-bedrock GUI Manager
echo ============================================
echo.

set NO_PAUSE=0
if /I "%MAB_NO_PAUSE%"=="1" set NO_PAUSE=1

:: ── 依存関係更新 ──────────────────────────────────────────────
echo [run] Checking dependencies...
call npm install --silent --no-audit --no-fund
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

:: ── 起動前セットアップ確認 ─────────────────────────────────────
echo [run] Running setup checks...
call npm run setup --silent
if errorlevel 1 (
  echo [run] ERROR: setup failed.
  if "%NO_PAUSE%"=="0" pause
  endlocal
  exit /b 1
)

:: ── PM2起動/再起動 ──────────────────────────────────────────────
echo [run] Starting bot process via PM2...
pm2 startOrRestart ecosystem.config.cjs
if errorlevel 1 (
  echo [run] ERROR: PM2 startOrRestart failed.
  if "%NO_PAUSE%"=="0" pause
  endlocal
  exit /b 1
)

pm2 save >nul 2>nul

set GUI_PORT=3000
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try { $cfg = Get-Content -Raw 'config.json' ^| ConvertFrom-Json; if ($cfg.gui.port) { $cfg.gui.port } else { 3000 } } catch { 3000 }"`) do (
  set GUI_PORT=%%P
)

echo [run] Waiting for GUI health endpoint...
set GUI_READY=0
for /L %%I in (1,1,20) do (
  curl.exe -fsS "http://127.0.0.1:!GUI_PORT!/health" >nul 2>nul
  if not errorlevel 1 (
    set GUI_READY=1
    goto :gui_ready
  )
  timeout /t 1 /nobreak >nul
)

:gui_ready
if "!GUI_READY!"=="1" (
  echo [run] GUI is running at http://localhost:!GUI_PORT!
) else (
  echo [run] WARNING: GUI health check timed out. Check logs with pm2 logs minecraft-auto-bedrock
)

start "" "http://localhost:!GUI_PORT!" >nul 2>nul

echo.
echo [run] GUI URL: http://localhost:!GUI_PORT!
echo [run] Bot/Java server management: GUI control panel
echo.
echo [run] Monitoring bot logs... (Press Ctrl+C to stop log monitor)
pm2 logs minecraft-auto-bedrock --lines 30
echo.
echo [run] Log monitor ended. Press any key to close this window.
if "%NO_PAUSE%"=="0" pause >nul
endlocal
