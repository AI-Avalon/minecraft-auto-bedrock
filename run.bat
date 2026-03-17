@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d %~dp0

echo.
echo ============================================
echo   minecraft-auto-bedrock run
echo ============================================
echo.

:: ── 自動更新 ──────────────────────────────────────────────────
echo [run] コードを最新版に更新中...
git pull --rebase 2>nul || echo [run] git pull skipped

:: ── 依存関係更新 ──────────────────────────────────────────────
echo [run] 依存関係を確認中...
call npm install --silent
if errorlevel 1 (
  echo [run] npm install failed.
  pause
  endlocal
  exit /b 1
)

:: ── ViaProxy / 設定ファイル確認 ──────────────────────────────
call npm run setup --silent
if errorlevel 1 (
  echo [run] setup step failed.
  pause
  endlocal
  exit /b 1
)

:: ── Ollama サービス確認（設定済みの場合のみ） ─────────────────
node scripts\is-llm-enabled.js >nul 2>nul
if not errorlevel 1 (
  curl -s http://127.0.0.1:11434/api/version >nul 2>nul
  if errorlevel 1 (
    echo [run] Ollama サービスを起動中...
    start /b "" ollama serve >nul 2>&1
    timeout /t 3 /nobreak >nul
  )
)

:: ── PM2 で Bot + GUI 起動 ─────────────────────────────────────
echo [run] Starting Bot and GUI with PM2...
pm2 startOrRestart ecosystem.config.cjs
if errorlevel 1 (
  echo [run] PM2 startOrRestart failed.
  pause
  endlocal
  exit /b 1
)

pm2 save
start "" http://127.0.0.1:3000
echo.
echo [run] Startup complete.
echo [run] Bot logs : pm2 logs minecraft-auto-bedrock
echo [run] GUI logs : pm2 logs minecraft-auto-bedrock-gui
echo [run] GUI URL  : http://127.0.0.1:3000
echo.
pause
endlocal
