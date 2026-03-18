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
set NO_LOG_TAIL=0
if /I "%MAB_NO_LOG_TAIL%"=="1" set NO_LOG_TAIL=1
set NO_BROWSER=0
if /I "%MAB_NO_BROWSER%"=="1" set NO_BROWSER=1
set REQUIRED_NODE_MAJOR=20
if not "%MAB_NODE_MAJOR%"=="" set REQUIRED_NODE_MAJOR=%MAB_NODE_MAJOR%

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

:: ── LLM モデル確認（有効時） ──────────────────────────────────
set LLM_ENABLED=
set LLM_MODEL=
for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "try { $cfg = Get-Content -Raw 'config.json' ^| ConvertFrom-Json; if ($cfg.llm.enabled) { '1' } else { '0' } } catch { '0' }"`) do set LLM_ENABLED=%%A
if "%LLM_ENABLED%"=="1" (
  for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "try { $cfg = Get-Content -Raw 'config.json' ^| ConvertFrom-Json; if ($cfg.llm.model) { $cfg.llm.model } else { '' } } catch { '' }"`) do set LLM_MODEL=%%A
  if not "%LLM_MODEL%"=="" (
    where ollama >nul 2>nul
    if errorlevel 1 (
      echo [run] WARNING: LLM is enabled but ollama is not installed.
    ) else (
      set MODEL_FOUND=0
      for /f "tokens=* delims=" %%M in ('ollama list 2^>nul ^| findstr /I /C:"%LLM_MODEL%"') do set MODEL_FOUND=1
      if "!MODEL_FOUND!"=="0" (
        echo [run] WARNING: Configured model "%LLM_MODEL%" was not found in ollama list.
      ) else (
        echo [run] LLM model check OK: %LLM_MODEL%
      )
    )
  )
)

:: ── 既存プロセスのクリーンアップ ────────────────────────────────
echo [run] Cleaning up existing processes...
call pm2 stop minecraft-auto-bedrock >nul 2>nul
timeout /t 2 /nobreak >nul

:: ポート25565を使用中のプロセスを終了（孤立したJavaサーバー）
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":25565 " ^| findstr "LISTENING"') do (
  if not "%%P"=="" (
    echo [run] Terminating orphaned process on port 25565 (PID: %%P)
    taskkill /F /PID %%P >nul 2>nul
  )
)

:: ポート3000を使用中のプロセスを終了（孤立したGUIサーバー）
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
  if not "%%P"=="" (
    echo [run] Terminating orphaned process on port 3000 (PID: %%P)
    taskkill /F /PID %%P >nul 2>nul
  )
)

timeout /t 1 /nobreak >nul

:: ── PM2起動/再起動 ──────────────────────────────────────────────
echo [run] Starting bot process via PM2...
call pm2 start ecosystem.config.cjs
if errorlevel 1 (
  :: 既に登録済みの場合は restart を試みる
  call pm2 restart minecraft-auto-bedrock
  if errorlevel 1 (
    echo [run] ERROR: PM2 start failed.
    if "%NO_PAUSE%"=="0" pause
    endlocal
    exit /b 1
  )
)

call pm2 save >nul 2>nul

set GUI_PORT=3000
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try { $cfg = Get-Content -Raw 'config.json' ^| ConvertFrom-Json; if ($cfg.gui.port) { $cfg.gui.port } else { 3000 } } catch { 3000 }"`) do (
  set GUI_PORT=%%P
)

echo [run] Waiting for GUI health endpoint (up to 60s)...
set GUI_READY=0
for /L %%I in (1,1,60) do (
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

if "%NO_BROWSER%"=="1" (
  echo [run] Browser auto-open disabled by MAB_NO_BROWSER=1
) else (
  call :open_browser "http://localhost:!GUI_PORT!"
)

echo.
echo [run] GUI URL: http://localhost:!GUI_PORT!
echo [run] Bot/Java server management: GUI control panel
echo.
if "%NO_LOG_TAIL%"=="1" (
  echo [run] Skipping log monitor due to MAB_NO_LOG_TAIL=1
  if "%NO_PAUSE%"=="0" pause >nul
  endlocal
  exit /b 0
)

echo [run] Monitoring bot logs... (Press Ctrl+C to stop log monitor)
call pm2 logs minecraft-auto-bedrock --lines 30
echo.
echo [run] Log monitor ended. Press any key to close this window.
if "%NO_PAUSE%"=="0" pause >nul
endlocal

goto :eof

:open_browser
set "OPEN_URL=%~1"

start "" "%OPEN_URL%" >nul 2>nul
if not errorlevel 1 (
  echo [run] Opened browser: %OPEN_URL%
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%OPEN_URL%'" >nul 2>nul
if not errorlevel 1 (
  echo [run] Opened browser via PowerShell: %OPEN_URL%
  exit /b 0
)

rundll32 url.dll,FileProtocolHandler "%OPEN_URL%" >nul 2>nul
if not errorlevel 1 (
  echo [run] Opened browser via Shell handler: %OPEN_URL%
  exit /b 0
)

echo [run] WARNING: Could not auto-open browser. Open manually: %OPEN_URL%
exit /b 1

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
