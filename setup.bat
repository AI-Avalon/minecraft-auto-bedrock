@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d %~dp0

echo.
echo ============================================
echo   minecraft-auto-bedrock セットアップ
echo ============================================
echo.

set NEED_PREREQS=0

where node >nul 2>nul
if errorlevel 1 (
  set NEED_PREREQS=1
) else (
  node -e "const major=Number(process.versions.node.split('.')[0]);process.exit(major>=20?0:1)" >nul 2>nul
  if errorlevel 1 set NEED_PREREQS=1
)

if "%NEED_PREREQS%"=="1" (
  echo [setup] Node.js v20+ が必要です。前提ツール導入を実行します...
  call scripts\install-prereqs.bat --auto
  echo.
  echo [setup] 前提導入後は新しいターミナルで setup.bat --resume を実行してください。
  echo.
)

node scripts\full-install.js %*
if %errorlevel% neq 0 (
  echo.
  echo [setup] セットアップは途中で停止しました。
  echo [setup] 再開するには setup.bat --resume を実行してください。
  echo.
  pause
  endlocal
  exit /b %errorlevel%
)

echo.
echo [setup] セットアップ完了。
echo.
pause
endlocal
