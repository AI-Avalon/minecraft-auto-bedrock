@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

set "REPO_URL=https://github.com/AI-Avalon/minecraft-auto-bedrock.git"
set "ZIP_URL=https://codeload.github.com/AI-Avalon/minecraft-auto-bedrock/zip/refs/heads/main"
set "DEFAULT_DIR=%USERPROFILE%\minecraft-auto-bedrock"
set "TARGET_DIR="
set "SETUP_ARGS="

if "%~1"=="" (
  set "TARGET_DIR=%DEFAULT_DIR%"
) else (
  set "FIRST_ARG=%~1"
  if "!FIRST_ARG:~0,1!"=="-" (
    set "TARGET_DIR=%DEFAULT_DIR%"
  ) else (
    set "TARGET_DIR=%~1"
    shift
  )
)

:collect_args
if "%~1"=="" goto :args_done
set "SETUP_ARGS=!SETUP_ARGS! %~1"
shift
goto :collect_args

:args_done
echo.
echo ============================================
echo   minecraft-auto-bedrock install
echo ============================================
echo Repo   : %REPO_URL%
echo Target : %TARGET_DIR%
echo.

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

set "HAS_GIT=0"
where git >nul 2>nul
if not errorlevel 1 set "HAS_GIT=1"

if "%HAS_GIT%"=="1" (
  if exist "%TARGET_DIR%\.git" (
    echo [install] Updating existing repository...
    git -C "%TARGET_DIR%" pull --rebase
    if errorlevel 1 (
      echo [install] git pull failed.
      exit /b 1
    )
  ) else (
    echo [install] Cloning repository...
    git clone "%REPO_URL%" "%TARGET_DIR%"
    if errorlevel 1 (
      echo [install] git clone failed.
      exit /b 1
    )
  )
) else (
  echo [install] Git not found. Downloading source ZIP via PowerShell...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $zip=Join-Path $env:TEMP 'minecraft-auto-bedrock-main.zip'; $tmp=Join-Path $env:TEMP ('mab-' + [guid]::NewGuid().ToString()); Invoke-WebRequest -Uri '%ZIP_URL%' -OutFile $zip; Expand-Archive -Path $zip -DestinationPath $tmp -Force; $src=Join-Path $tmp 'minecraft-auto-bedrock-main'; if (!(Test-Path $src)) { throw 'Expanded source folder not found' }; robocopy $src '%TARGET_DIR%' /MIR /NFL /NDL /NJH /NJS /NP | Out-Null; Remove-Item $zip -Force -ErrorAction SilentlyContinue; Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue"
  if errorlevel 1 (
    echo [install] ZIP download/extract failed.
    exit /b 1
  )
)

echo [install] Running prerequisite installer...
call "%TARGET_DIR%\scripts\install-prereqs.bat" --auto --node-major=20
if errorlevel 1 (
  echo [install] Prerequisite setup failed.
  exit /b 1
)

echo [install] Running project setup...
call "%TARGET_DIR%\setup.bat" --resume %SETUP_ARGS%
if errorlevel 1 (
  echo [install] setup.bat failed.
  exit /b 1
)

echo.
echo [install] Completed successfully.
echo [install] Run bot with: "%TARGET_DIR%\run.bat"
echo.
pause
endlocal
