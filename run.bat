@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d %~dp0

echo.
echo ============================================
echo   minecraft-auto-bedrock 起動
echo ============================================
echo.

:: ── 自動更新 ──────────────────────────────────────────────────
echo [run] コードを最新版に更新中...
git pull --rebase 2>nul || echo [run] git pull スキップ

:: ── 依存関係更新 ──────────────────────────────────────────────
echo [run] 依存関係を確認中...
call npm install --silent

:: ── ViaProxy / 設定ファイル確認 ──────────────────────────────
call npm run setup --silent

:: ── Ollama サービス確認（設定済みの場合のみ） ─────────────────
node -e "try{const c=require('./config.json');process.exit(c.llm&&c.llm.enabled?0:1)}catch{process.exit(1)}" >nul 2>nul
if not errorlevel 1 (
  curl -s http://127.0.0.1:11434/api/version >nul 2>nul
  if errorlevel 1 (
    echo [run] Ollama サービスを起動中...
    start /b "" ollama serve >nul 2>&1
    timeout /t 3 /nobreak >nul
  )
)

:: ── PM2 で Bot 起動 ────────────────────────────────────────────
pm2 describe minecraft-auto-bedrock >nul 2>nul
if %errorlevel%==0 (
  echo [run] Bot を再起動中...
  pm2 restart minecraft-auto-bedrock
) else (
  echo [run] Bot を起動中...
  pm2 start ecosystem.config.cjs
)

pm2 save
echo.
echo [run] 起動完了。ログ確認: pm2 logs minecraft-auto-bedrock
echo.
pause
endlocal
