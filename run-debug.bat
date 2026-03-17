@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d %~dp0

echo.
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
  pause
  endlocal
  exit /b 1
)

:: ── ViaProxy / 設定ファイル確認 ──────────────────────────────
echo [run] Running setup...
call npm run setup
if errorlevel 1 (
  echo [run] ERROR: setup step failed.
  pause
  endlocal
  exit /b 1
)

:: ── Ollama サービス確認（設定済みの場合のみ） ─────────────────
echo [run] Checking Ollama...
node scripts\is-llm-enabled.js >nul 2>nul
if not errorlevel 1 (
  echo [run] LLM enabled. Checking Ollama service...
  curl -s http://127.0.0.1:11434/api/version >nul 2>nul
  if errorlevel 1 (
    echo [run] Starting Ollama service...
    start /b "" ollama serve >nul 2>&1
    timeout /t 3 /nobreak >nul
  ) else (
    echo [run] Ollama is running.
  )
) else (
  echo [run] LLM not enabled.
)

:: ── PM2 で Bot 起動 (GUIは同一プロセス内) ─────────────────────
echo [run] Checking PM2 status...
pm2 describe minecraft-auto-bedrock-gui >nul 2>nul
if not errorlevel 1 (
  echo [run] Removing legacy duplicate process: minecraft-auto-bedrock-gui
  pm2 delete minecraft-auto-bedrock-gui >nul 2>nul
)

echo [run] Starting bot with ecosystem.config.cjs...
pm2 startOrRestart ecosystem.config.cjs
if errorlevel 1 (
  echo [run] ERROR: PM2 startOrRestart failed.
  pause
  endlocal
  exit /b 1
)

pm2 save
echo [run] Opening browser to http://localhost:3000...
start "" http://localhost:3000

echo.
echo ============================================
echo [run] Startup complete!
echo ============================================
echo [run] Bot logs : pm2 logs minecraft-auto-bedrock
echo [run] GUI URL  : http://localhost:3000
echo.
pause
endlocal
