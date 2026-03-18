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
set NO_PAUSE=0
if /I "%MAB_NO_PAUSE%"=="1" set NO_PAUSE=1

for %%A in (%*) do (
  set "ARG=%%~A"
  if /I "!ARG:~0,13!"=="--node-major=" set "NODE_MAJOR=!ARG:~13!"
)

call :check_node
if "%NODE_OK%"=="0" set NEED_PREREQS=1

if "%NEED_PREREQS%"=="1" (
  echo [setup] Node.js v%NODE_MAJOR%+ is required. Installing prerequisites...
  if /I "%MAB_SKIP_PREREQS%"=="1" (
    echo [setup] Skipping prereq install due to MAB_SKIP_PREREQS=1
  ) else (
    call scripts\install-prereqs.bat --auto --node-major=%NODE_MAJOR%
  )
  call :check_node
  if "%NODE_OK%"=="0" (
    echo.
    echo [setup] ERROR: Node.js v%NODE_MAJOR%+ is still not available.
    echo [setup] Close this terminal and open a new one, then run: setup.bat --resume
    echo.
    if "%NO_PAUSE%"=="0" pause
    endlocal
    exit /b 1
  )
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
  if "%NO_PAUSE%"=="0" pause
  endlocal
  exit /b %errorlevel%
)

echo.
echo [setup] Setup completed.
echo.
if "%NO_PAUSE%"=="0" pause
endlocal

goto :eof

:check_node
set NODE_OK=0
set NODE_CUR_VER=
set NODE_CUR_MAJOR=
where node >nul 2>nul
if errorlevel 1 exit /b 0

for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_CUR_VER=%%v"
if not defined NODE_CUR_VER exit /b 0

for /f "tokens=1 delims=." %%m in ("!NODE_CUR_VER:v=!") do set "NODE_CUR_MAJOR=%%m"
if not defined NODE_CUR_MAJOR exit /b 0

if !NODE_CUR_MAJOR! GEQ %NODE_MAJOR% set NODE_OK=1
exit /b 0
