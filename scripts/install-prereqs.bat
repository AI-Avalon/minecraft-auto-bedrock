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
call :check_node
if "%NODE_OK%"=="1" (
  echo [OK] Node.js %NODE_CUR_VER%
) else if "%NODE_FOUND%"=="1" (
  echo [WARN] Node.js %NODE_CUR_VER% is below required v%NODE_MAJOR%.
) else (
  echo [WARN] Node.js was not found.
)

if "%NODE_OK%"=="0" (
  echo [INFO] Node.js v%NODE_MAJOR% 以上をインストール中...
  if not "%NODE_MAJOR%"=="20" (
    echo [WARN] winget は特定メジャー固定指定が難しいため、LTS版を導入します。
  )
  if "%WINGET_OK%"=="1" (
    winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    call :check_node
    if "%NODE_OK%"=="1" (
      echo [OK] Node.js %NODE_CUR_VER%
    ) else (
      echo [WARN] Node.js is still below v%NODE_MAJOR% after install.
      echo        Install Node.js v%NODE_MAJOR%+ manually from https://nodejs.org
    )
  ) else (
    echo [WARN] winget was not found.
    echo        Install Node.js v%NODE_MAJOR%+ from https://nodejs.org
  )
) else (
  echo [INFO] Node.js requirement is satisfied.
)

goto :after_node_check

:check_node
set NODE_OK=0
set NODE_FOUND=0
set NODE_CUR_VER=
set NODE_CUR_MAJOR=
where node >nul 2>nul
if errorlevel 1 exit /b 0
set NODE_FOUND=1
for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_CUR_VER=%%v"
if not defined NODE_CUR_VER exit /b 0
for /f "tokens=1 delims=." %%m in ("%NODE_CUR_VER:v=%") do set "NODE_CUR_MAJOR=%%m"
if not defined NODE_CUR_MAJOR exit /b 0
if %NODE_CUR_MAJOR% GEQ %NODE_MAJOR% set NODE_OK=1
exit /b 0

:after_node_check

:: ── Java 21 ───────────────────────────────────────────────────────────────
where java >nul 2>nul
if not errorlevel 1 (
  for /f "tokens=*" %%v in ('java -version 2^>^&1') do (
    echo [OK] %%v
    goto :java_done
  )
) else (
  echo [INFO] Installing Java 21 - Temurin...
  if "%WINGET_OK%"=="1" (
    winget install EclipseAdoptium.Temurin.21.JDK --silent --accept-source-agreements --accept-package-agreements
    echo [OK] Java installation completed
  ) else (
    echo [WARN] winget was not found.
    echo        Install Java 21 from https://adoptium.net
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
      echo [INFO] Ollama optional setup skipped. Use --with-ollama to enable.
    )
  ) else (
    echo.
    echo [INFO] Ollama was not found.
    echo        Ollama is required for LLM chat features.
    if "%WITH_OLLAMA%"=="1" (
      set INSTALL_OLLAMA=Y
    ) else (
      set /p INSTALL_OLLAMA="  Install Ollama now? [Y/n]: "
    )
  )

  if /i not "!INSTALL_OLLAMA!"=="n" (
    if "%WINGET_OK%"=="1" (
      echo [INFO] Installing Ollama via winget...
      winget install Ollama.Ollama --silent --accept-source-agreements --accept-package-agreements
      echo [OK] Ollama installation completed
    ) else (
      echo [INFO] Download the official installer:
      echo        https://ollama.com/download/OllamaSetup.exe
      echo        After install, rerun this script or run:
      echo        node scripts/install-ollama.js
    )
  ) else (
    echo [INFO] Ollama installation was skipped.
    echo        You can set it up later with: npm run ollama:setup
  )
)

:: ── NVIDIA GPU 確認 ───────────────────────────────────────────────────────
where nvidia-smi >nul 2>nul
if not errorlevel 1 (
  echo.
  for /f "tokens=*" %%a in ('nvidia-smi --query-gpu=name --format=csv,noheader 2^>nul') do (
    echo [GPU] NVIDIA GPU detected: %%a
    echo       You can choose GPU mode in Ollama setup.
  )
)

echo.
echo ============================================
echo   Prerequisites complete
echo ============================================
echo.
echo Next steps:
echo   1. npm install ^&^& npm run setup
echo   2. npm run configure:java or configure:bedrock
echo   3. run.bat
echo.
echo To enable LLM chat:
echo   npm run ollama:setup
echo.
if "%AUTO_MODE%"=="1" goto :end
pause
:end
endlocal
