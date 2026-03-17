@echo off
setlocal

where git >nul 2>nul
if errorlevel 1 (
  echo git が見つかりません。Git for Windows をインストールしてください。
)

where node >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if not errorlevel 1 (
    winget install OpenJS.NodeJS.LTS
  ) else (
    echo Node.js が見つかりません。https://nodejs.org/ からインストールしてください。
  )
)

where java >nul 2>nul
if errorlevel 1 (
  where winget >nul 2>nul
  if not errorlevel 1 (
    winget install EclipseAdoptium.Temurin.21.JDK
  ) else (
    echo Java が見つかりません。https://adoptium.net/ からインストールしてください。
  )
)

echo 前提ツール確認完了
