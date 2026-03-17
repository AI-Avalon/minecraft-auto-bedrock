@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d %~dp0

echo.
echo ============================================
echo   minecraft-auto-bedrock stop all
echo ============================================
echo.

:: ── Javaサーバープロセス停止 ──────────────────────────────────
echo [stop] ローカルJavaサーバーをチェック中...

REM memory.json から javaServerPid を取得して kill
if exist memory.json (
  setlocal disabledelayedexpansion
  for /f "usebackq delims=" %%A in ("memory.json") do (
    set "line=%%A"
    setlocal enabledelayedexpansion
    if "!line:javaServerPid=!" neq "!line!" (
      REM javaServerPid が見つかった
      for /f "tokens=2 delims=:" %%B in ("!line!") do (
        set "pid=%%B"
        set "pid=!pid:,=!"
        set "pid=!pid: =!"
        if not "!pid!"=="" (
          echo [stop] Javaサーバープロセスを停止 - PID: !pid!
          taskkill /PID !pid! /T /F >nul 2>nul
        )
      )
    )
    endlocal
  )
  setlocal enabledelayedexpansion
)

:: ── PM2 全プロセス停止 ────────────────────────────────────────
echo [stop] PM2の全プロセスを停止中...
pm2 stop all 2>nul

if errorlevel 1 (
  echo [stop] warning: pm2 stop all に失敗しました
  echo [stop]   原因: PM2がインストールされていないか、プロセスがない可能性があります
  pause
  exit /b 1
)

echo [stop] 完了: PM2の全プロセスを停止しました
echo.
echo [stop] 各プロセスの状態:
pm2 list

echo.
pause
