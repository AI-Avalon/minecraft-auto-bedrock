@echo off
setlocal enabledelayedexpansion
cd /d %~dp0

git pull --rebase
call npm install
call npm run setup

pm2 describe minecraft-auto-bedrock >nul 2>nul
if %errorlevel%==0 (
  pm2 restart minecraft-auto-bedrock
) else (
  pm2 start ecosystem.config.cjs
)

pm2 save
