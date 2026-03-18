@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d %~dp0

set TEST_TYPE=%1
if "%TEST_TYPE%"=="" set TEST_TYPE=full

echo.
echo ============================================
echo   minecraft-auto-bedrock test runner
echo ============================================
echo [test] mode: %TEST_TYPE%
echo.

call :check_cmd node "Node.js"
if errorlevel 1 exit /b 1
call :check_cmd npm "npm"
if errorlevel 1 exit /b 1
call :check_cmd git "Git"
if errorlevel 1 echo [test] warning: Git not found
call :check_cmd pm2 "PM2"
if errorlevel 1 echo [test] warning: PM2 not found (process checks skipped)

if /I "%TEST_TYPE%"=="quick" goto :quick
if /I "%TEST_TYPE%"=="gui" goto :gui
if /I "%TEST_TYPE%"=="full" goto :full

echo [test] usage: run-tests.bat [quick^|full^|gui]
exit /b 1

:quick
echo [test] Running system doctor...
call npm run doctor
if errorlevel 1 (
  echo [test] ERROR: doctor failed
  exit /b 1
)
echo [test] quick mode finished
exit /b 0

:gui
echo [test] Running GUI tests...
call npm run test:gui
if errorlevel 1 (
  echo [test] ERROR: GUI tests failed
  exit /b 1
)
echo [test] gui mode finished
exit /b 0

:full
echo [test] Running comprehensive tests...
call npm run test:comprehensive
if errorlevel 1 (
  echo [test] ERROR: comprehensive tests failed
  exit /b 1
)

echo [test] Running unit/integration tests...
call npm test
if errorlevel 1 (
  echo [test] ERROR: npm test failed
  exit /b 1
)

echo [test] Running GUI tests...
call npm run test:gui
if errorlevel 1 (
  echo [test] ERROR: npm run test:gui failed
  exit /b 1
)

echo [test] full mode finished
exit /b 0

:check_cmd
where %~1 >nul 2>nul
if errorlevel 1 (
  echo [test] missing: %~2
  exit /b 1
)
for /f "tokens=*" %%V in ('%~1 --version 2^>nul') do (
  echo [test] %~2: %%V
  goto :check_cmd_done
)
:check_cmd_done
exit /b 0
