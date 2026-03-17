@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

set AUTO_MODE=0
set WITH_OLLAMA=0
set NODE_MAJOR=20
for %%A in (%*) do (
  if /I "%%~A"=="--auto" set AUTO_MODE=1
  if /I "%%~A"=="--with-ollama" set WITH_OLLAMA=1
  if /I "%%~A"=="--skip-ollama" set WITH_OLLAMA=0
  set "ARG=%%~A"
  if /I "!ARG:~0,13!"=="--node-major=" set "NODE_MAJOR=!ARG:~13!"
)

echo.
echo ============================================
echo   minecraft-auto-bedrock セットアップ
echo   プラットフォーム: Windows
echo ============================================
echo.

:: ── winget 確認 ──────────────────────────────────────────────────────────
set WINGET_OK=0
where winget >nul 2>nul
if not errorlevel 1 set WINGET_OK=1

:: ── Git ───────────────────────────────────────────────────────────────────
where git >nul 2>nul
if not errorlevel 1 (
  for /f "tokens=*" %%v in ('git --version 2^>nul') do echo [OK] %%v
) else (
  echo [INFO] Git をインストール中...
  if "%WINGET_OK%"=="1" (
    winget install Git.Git --silent --accept-source-agreements --accept-package-agreements
    echo [OK] Git インストール完了
  ) else (
    echo [WARN] winget が見つかりません。
    echo        https://git-scm.com/download/win から Git をインストールしてください。
  )
)

:: ── Node.js (指定メジャー以上) ─────────────────────────────────────────────
set NODE_OK=0
where node >nul 2>nul
if not errorlevel 1 (
  node -e "const major=Number(process.versions.node.split('.')[0]);process.exit(major>=%NODE_MAJOR%?0:1)" >nul 2>nul
  if not errorlevel 1 (
    set NODE_OK=1
    for /f "tokens=*" %%v in ('node --version 2^>nul') do echo [OK] Node.js %%v
  ) else (
    echo [WARN] Node.js は v%NODE_MAJOR% 以上が必要です。現在のバージョンは要件未満です。
  )
) else (
  echo [WARN] Node.js が見つかりません。
)

if "%NODE_OK%"=="0" (
  echo [INFO] Node.js v%NODE_MAJOR% 以上をインストール中...
  if not "%NODE_MAJOR%"=="20" (
    echo [WARN] winget は特定メジャー固定指定が難しいため、LTS版を導入します。
  )
  if "%WINGET_OK%"=="1" (
    winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    node -e "const major=Number(process.versions.node.split('.')[0]);process.exit(major>=%NODE_MAJOR%?0:1)" >nul 2>nul
    if not errorlevel 1 (
      for /f "tokens=*" %%v in ('node --version 2^>nul') do echo [OK] Node.js %%v
    ) else (
      echo [WARN] インストール後も Node.js が v%NODE_MAJOR% 未満の可能性があります。
      echo        手動で https://nodejs.org から v%NODE_MAJOR% 以上を導入してください。
    )
  ) else (
    echo [WARN] winget が見つかりません。
    echo        https://nodejs.org から v%NODE_MAJOR% 以上をインストールしてください。
  )
) else (
  echo [INFO] Node.js 要件を満たしています。
)

:: ── Java 21 ───────────────────────────────────────────────────────────────
where java >nul 2>nul
if not errorlevel 1 (
  for /f "tokens=*" %%v in ('java -version 2^>^&1') do (
    echo [OK] %%v
    goto :java_done
  )
) else (
  echo [INFO] Java 21 (Temurin) をインストール中...
  if "%WINGET_OK%"=="1" (
    winget install EclipseAdoptium.Temurin.21.JDK --silent --accept-source-agreements --accept-package-agreements
    echo [OK] Java インストール完了
  ) else (
    echo [WARN] winget が見つかりません。
    echo        https://adoptium.net から Java 21 をインストールしてください。
  )
)
:java_done

:: ── PM2 ───────────────────────────────────────────────────────────────────
where pm2 >nul 2>nul
if not errorlevel 1 (
  echo [OK] PM2 インストール済み
) else (
  echo [INFO] PM2 をインストール中...
  call npm install -g pm2
  echo [OK] PM2 インストール完了
)

:: ── Ollama ────────────────────────────────────────────────────────────────
where ollama >nul 2>nul
if not errorlevel 1 (
  for /f "tokens=*" %%v in ('ollama --version 2^>nul') do echo [OK] Ollama %%v
) else (
  if "%AUTO_MODE%"=="1" (
    if "%WITH_OLLAMA%"=="1" (
      set INSTALL_OLLAMA=Y
    ) else (
      set INSTALL_OLLAMA=n
      echo [INFO] Ollama は任意機能のためスキップしました (--with-ollama で有効化)
    )
  ) else (
    echo.
    echo [INFO] Ollama が見つかりません。
    echo        Ollama はLLM日本語会話機能に必要です。
    if "%WITH_OLLAMA%"=="1" (
      set INSTALL_OLLAMA=Y
    ) else (
      set /p INSTALL_OLLAMA="  Ollama をインストールしますか? [Y/n]: "
    )
  )

  if /i not "!INSTALL_OLLAMA!"=="n" (
    if "%WINGET_OK%"=="1" (
      echo [INFO] winget で Ollama をインストール中...
      winget install Ollama.Ollama --silent --accept-source-agreements --accept-package-agreements
      echo [OK] Ollama インストール完了
    ) else (
      echo [INFO] 公式インストーラーをダウンロードしてください:
      echo        https://ollama.com/download/OllamaSetup.exe
      echo        インストール後、このスクリプトを再実行するか
      echo        "node scripts/install-ollama.js" を実行してください。
    )
  ) else (
    echo [INFO] Ollama のインストールをスキップしました。
    echo        後で "npm run ollama:setup" で設定できます。
  )
)

:: ── NVIDIA GPU 確認 ───────────────────────────────────────────────────────
where nvidia-smi >nul 2>nul
if not errorlevel 1 (
  echo.
  for /f "tokens=1,2 delims=," %%a in ('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2^>nul') do (
    echo [GPU] NVIDIA GPU 検出: %%a (VRAM: %%b MB)
    echo       Ollama セットアップ時にGPUモードを選択できます。
  )
)

echo.
echo ============================================
echo   前提ツール確認・インストール完了
echo ============================================
echo.
echo 次のステップ:
echo   1. npm install ^&^& npm run setup
echo   2. npm run configure:java  (または configure:bedrock)
echo   3. run.bat
echo.
echo LLM会話を有効化する場合:
echo   npm run ollama:setup
echo.
if "%AUTO_MODE%"=="1" goto :end
pause
:end
endlocal
