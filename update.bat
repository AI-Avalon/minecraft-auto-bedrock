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
echo 1. Update code via git pull --rebase
echo 2. Update dependencies via npm install
echo 3. Resume setup via setup.bat --resume
echo 4. Start setup from step via --from-step
echo 5. Configure project Node env with Volta
echo 6. Run system doctor
echo 7. Run all steps 1 through 3
echo 0. Exit
echo.
set /p CHOICE="Select [0-7]: "

if "%CHOICE%"=="1" goto :update_code
if "%CHOICE%"=="2" goto :update_deps
if "%CHOICE%"=="3" goto :resume_setup
if "%CHOICE%"=="4" goto :from_step
if "%CHOICE%"=="5" goto :node_env
if "%CHOICE%"=="6" goto :doctor
if "%CHOICE%"=="7" goto :all
if "%CHOICE%"=="0" goto :end

echo [update] Invalid input.
echo.
goto :menu

:update_code
echo [update] Updating repository code...
git pull --rebase
if errorlevel 1 echo [update] git pull failed.
echo.
goto :menu

:update_deps
echo [update] Updating dependencies...
call npm install
if errorlevel 1 echo [update] npm install failed.
echo.
goto :menu

:resume_setup
echo [update] Resuming setup...
call setup.bat --resume --node-major=%NODE_MAJOR%
echo.
goto :menu

:from_step
echo.
echo Example step IDs:
echo   prereqs, env, npmInstall, config, viaProxy, bedrockSamples, ollama, tests, resident
set /p STEP_ID="Enter step ID: "
if "%STEP_ID%"=="" (
  echo [update] Step ID is required.
  echo.
  goto :menu
)
call setup.bat --from-step=%STEP_ID% --node-major=%NODE_MAJOR%
echo.
goto :menu

:doctor
echo [update] Running system doctor...
call npm run doctor
echo.
goto :menu

:node_env
echo [update] Configuring Node environment with Volta...
call node scripts\setup-node-env.js --node-major=%NODE_MAJOR%
echo.
goto :menu

:all
echo [update] Running all update steps...
git pull --rebase || echo [update] git pull skipped
call npm install || echo [update] npm install skipped
call setup.bat --resume --node-major=%NODE_MAJOR%
echo.
goto :menu

:end
echo [update] Done.
endlocal
