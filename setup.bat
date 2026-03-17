@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d %~dp0

echo.
echo ============================================
echo   minecraft-auto-bedrock setup
echo ============================================
echo.

set NEED_PREREQS=0
set NODE_MAJOR=20

for %%A in (%*) do (
  set "ARG=%%~A"
  if /I "!ARG:~0,13!"=="--node-major=" set "NODE_MAJOR=!ARG:~13!"
)

where node >nul 2>nul
if errorlevel 1 (
  set NEED_PREREQS=1
) else (
  for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_CUR_VER=%%v"
  for /f "tokens=1 delims=." %%m in ("!NODE_CUR_VER:v=!") do set "NODE_CUR_MAJOR=%%m"
  if not defined NODE_CUR_MAJOR (
    set NEED_PREREQS=1
  ) else (
    if !NODE_CUR_MAJOR! LSS %NODE_MAJOR% set NEED_PREREQS=1
  )
)

if "%NEED_PREREQS%"=="1" (
  echo [setup] Node.js v%NODE_MAJOR%+ is required. Installing prerequisites...
  call scripts\install-prereqs.bat --auto --node-major=%NODE_MAJOR%
  echo.
  echo [setup] If a new terminal is needed, run: setup.bat --resume
  echo.
)

node scripts\full-install.js %*
if %errorlevel% neq 0 (
  echo.
  echo [setup] Setup stopped before completion.
  echo [setup] Resume with: setup.bat --resume
  echo [setup] Start from a step with: setup.bat --from-step=config
  echo.
  pause
  endlocal
  exit /b %errorlevel%
)

echo.
echo [setup] Setup completed.
echo.
pause
endlocal
