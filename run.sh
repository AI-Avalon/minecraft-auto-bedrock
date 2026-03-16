#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

git pull --rebase
npm install
npm run setup

if pm2 describe minecraft-auto-bedrock >/dev/null 2>&1; then
  pm2 restart minecraft-auto-bedrock
else
  pm2 start ecosystem.config.cjs
fi

pm2 save
