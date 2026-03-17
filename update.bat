@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d %~dp0

echo.
echo ============================================
echo   minecraft-auto-bedrock UpdateBat
echo ============================================
echo.

set NODE_MAJOR=20
for %%A in (%*) do (
  set "ARG=%%~A"
  if /I "!ARG:~0,13!"=="--node-major=" set "NODE_MAJOR=!ARG:~13!"
)

:menu
echo 1. コード更新 (git pull --rebase)
echo 2. 依存更新 (npm install)
echo 3. セットアップ再開 (setup.bat --resume)
echo 4. 途中ステップからセットアップ (setup.bat --from-step=...)
echo 5. Node仮想環境(Volta)設定
echo 6. 環境診断 (npm run doctor)
echo 7. すべて実行 (1-3)
echo 0. 終了
echo.
set /p CHOICE="選択してください [0-7]: "

if "%CHOICE%"=="1" goto :update_code
if "%CHOICE%"=="2" goto :update_deps
if "%CHOICE%"=="3" goto :resume_setup
if "%CHOICE%"=="4" goto :from_step
if "%CHOICE%"=="5" goto :node_env
if "%CHOICE%"=="6" goto :doctor
if "%CHOICE%"=="7" goto :all
if "%CHOICE%"=="0" goto :end

echo [update] 不正な入力です。
echo.
goto :menu

:update_code
echo [update] コードを更新します...
git pull --rebase
if errorlevel 1 echo [update] git pull に失敗しました。
echo.
goto :menu

:update_deps
echo [update] 依存関係を更新します...
call npm install
if errorlevel 1 echo [update] npm install に失敗しました。
echo.
goto :menu

:resume_setup
echo [update] セットアップを再開します...
call setup.bat --resume --node-major=%NODE_MAJOR%
echo.
goto :menu

:from_step
echo.
echo 利用可能ステップ例:
echo   prereqs, env, npmInstall, config, viaProxy, bedrockSamples, ollama, tests, resident
set /p STEP_ID="開始ステップIDを入力: "
if "%STEP_ID%"=="" (
  echo [update] ステップIDが未入力です。
  echo.
  goto :menu
)
call setup.bat --from-step=%STEP_ID% --node-major=%NODE_MAJOR%
echo.
goto :menu

:doctor
echo [update] システム診断を実行します...
call npm run doctor
echo.
goto :menu

:node_env
echo [update] Node 仮想環境 (Volta) を設定します...
call node scripts\setup-node-env.js --node-major=%NODE_MAJOR%
echo.
goto :menu

:all
echo [update] 一括更新を実行します...
git pull --rebase || echo [update] git pull をスキップ
call npm install || echo [update] npm install をスキップ
call setup.bat --resume --node-major=%NODE_MAJOR%
echo.
goto :menu

:end
echo [update] 終了します。
endlocal
