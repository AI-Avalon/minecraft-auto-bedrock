@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d %~dp0

echo.

set NO_PAUSE=0
if /I "%MAB_NO_PAUSE%"=="1" set NO_PAUSE=1
set NO_LOG_TAIL=0
if /I "%MAB_NO_LOG_TAIL%"=="1" set NO_LOG_TAIL=1
set REQUIRED_NODE_MAJOR=20

call :check_node
if "%NODE_OK%"=="0" (
  echo [run] ERROR: Node.js v%REQUIRED_NODE_MAJOR%+ is required, current=%NODE_CUR_VER%
  echo [run] Please run: setup.bat --node-major=%REQUIRED_NODE_MAJOR%
  if "%NO_PAUSE%"=="0" pause
  endlocal
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [run] ERROR: npm command is not available in PATH.
  echo [run] Please run: setup.bat --resume
  if "%NO_PAUSE%"=="0" pause
  endlocal
  exit /b 1
)
echo ============================================
echo   minecraft-auto-bedrock run (DEBUG)
echo ============================================
echo.

:: ── 自動更新 ──────────────────────────────────────────────────
echo [run] コードを最新版に更新中...
git pull --rebase 2>nul || echo [run] git pull skipped

:: ── 依存関係更新 ──────────────────────────────────────────────
echo [run] 依存関係を確認中...
call npm install
if errorlevel 1 (
  echo [run] ERROR: npm install failed.
  if "%NO_PAUSE%"=="0" pause
  endlocal
  exit /b 1
)

:: ── ViaProxy / 設定ファイル確認 ──────────────────────────────
echo [run] Running setup...
call npm run setup
if errorlevel 1 (
  echo [run] ERROR: setup step failed.
  if "%NO_PAUSE%"=="0" pause
  endlocal
  exit /b 1
)

:: ── Ollama サービス確認（設定済みの場合のみ） ─────────────────
echo [run] Checking Ollama...
node scripts\is-llm-enabled.js >nul 2>nul
if not errorlevel 1 (
  echo [run] LLM enabled. Checking Ollama service...
  where ollama >nul 2>nul
  if errorlevel 1 (
    echo [run] WARNING: ollama command not found. Model-based chat will be unavailable.
  ) else (
    curl -s http://127.0.0.1:11434/api/version >nul 2>nul
    if errorlevel 1 (
      echo [run] Starting Ollama service...
      start /b "" ollama serve >nul 2>&1
      timeout /t 3 /nobreak >nul
    ) else (
      echo [run] Ollama is running.
    )
  )
) else (
  echo [run] LLM not enabled.
)

:: ── PM2 で Bot 起動 (GUIは同一プロセス内) ─────────────────────
echo [run] Checking PM2 status...
call pm2 describe minecraft-auto-bedrock-gui >nul 2>nul
if not errorlevel 1 (
  echo [run] Removing legacy duplicate process: minecraft-auto-bedrock-gui
  call pm2 delete minecraft-auto-bedrock-gui
  if errorlevel 1 (
    echo [run] ERROR: pm2 delete failed (errorlevel=%errorlevel%)
  )
)

echo [run] Current PM2 processes:
call pm2 list
echo.

echo [run] Starting bot with ecosystem.config.cjs...
call pm2 startOrRestart ecosystem.config.cjs
if errorlevel 1 (
  echo [run] ERROR: PM2 startOrRestart failed (errorlevel=%errorlevel%)
  echo [run] Checking PM2 logs...
  call pm2 logs minecraft-auto-bedrock --lines 30
  if "%NO_PAUSE%"=="0" pause
  endlocal
  exit /b 1
)

echo [run] PM2 save...
call pm2 save
if errorlevel 1 (
  echo [run] WARNING: pm2 save failed (errorlevel=%errorlevel%)
)

echo [run] Opening browser to http://localhost:3000...
start "" http://localhost:3000

echo.
echo ============================================
echo [run] Startup complete!
echo ============================================
echo [run] Bot logs : pm2 logs minecraft-auto-bedrock
echo [run] GUI URL  : http://localhost:3000
echo.
if "%NO_LOG_TAIL%"=="1" (
  echo [run] Skipping debug log monitor due to MAB_NO_LOG_TAIL=1
  if "%NO_PAUSE%"=="0" pause >nul
  endlocal
  exit /b 0
)

echo [run] DEBUG log monitor starting... (Press Ctrl+C to stop)
call pm2 logs minecraft-auto-bedrock --lines 50
echo.
echo [run] Debug monitor ended. Press any key to close this window.
if "%NO_PAUSE%"=="0" pause >nul
endlocal

goto :eof

:check_node
set NODE_OK=0
set NODE_CUR_VER=unknown
set NODE_CUR_MAJOR=
where node >nul 2>nul
if errorlevel 1 exit /b 0

for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_CUR_VER=%%v"
for /f "tokens=1 delims=." %%m in ("!NODE_CUR_VER:v=!") do set "NODE_CUR_MAJOR=%%m"
if not defined NODE_CUR_MAJOR exit /b 0
if !NODE_CUR_MAJOR! GEQ %REQUIRED_NODE_MAJOR% set NODE_OK=1
exit /b 0
