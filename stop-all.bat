@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d %~dp0

set NO_PAUSE=0
if /I "%MAB_NO_PAUSE%"=="1" set NO_PAUSE=1

echo.
echo ============================================
echo   minecraft-auto-bedrock stop all
echo ============================================
echo.

:: ── Javaサーバープロセス停止 ──────────────────────────────────
echo [stop] ローカルJavaサーバープロセスをチェック中...
set JAVA_PID=
if exist memory.json (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try { $m = Get-Content -Raw 'memory.json' ^| ConvertFrom-Json; if ($m.javaServerPid) { $m.javaServerPid } } catch {}"`) do (
    set JAVA_PID=%%P
  )
)

if defined JAVA_PID (
  echo [stop] Javaサーバープロセスを停止 - PID: !JAVA_PID!
  taskkill /PID !JAVA_PID! /T /F >nul 2>nul
  if errorlevel 1 (
    echo [stop] warning: Javaサーバー PID !JAVA_PID! は既に停止済みの可能性があります
  )
) else (
  echo [stop] Javaサーバー PID は記録されていません
)

:: ── PM2 全プロセス停止 ────────────────────────────────────────
echo [stop] PM2の全プロセスを停止中...
where pm2 >nul 2>nul
if errorlevel 1 (
  echo [stop] warning: PM2 が見つかりません。PM2停止はスキップします
  if "%NO_PAUSE%"=="0" pause
  endlocal
  exit /b 0
)

pm2 stop all >nul 2>nul
if errorlevel 1 (
  echo [stop] PM2停止対象がないか、停止に失敗しました
) else (
  echo [stop] PM2全プロセスを停止しました
)

echo [stop] 完了: 停止処理を実行しました
echo.
echo [stop] 各プロセスの状態:
pm2 list

echo.
if "%NO_PAUSE%"=="0" pause
endlocal
