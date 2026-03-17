#!/usr/bin/env bash
# ============================================================
# run.sh — minecraft-auto-bedrock 起動スクリプト (macOS/Linux)
# ・git pull で最新コードに更新
# ・npm install で依存関係を更新
# ・PM2 でBot を起動 / 再起動
# ============================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# ── 自動更新 ──────────────────────────────────────────────────
echo "[run] コードを最新版に更新中..."
git pull --rebase 2>/dev/null || echo "[run] git pull スキップ（リモートなし）"

# ── 依存関係更新 ───────────────────────────────────────────────
echo "[run] 依存関係を確認中..."
npm install --silent

# ── ViaProxy / 設定ファイル確認 ────────────────────────────────
npm run setup --silent

# ── Ollama サービス確認（設定済みの場合のみ） ───────────────────
if node -e "
  try {
    const c = require('./config.json');
    process.exit(c.llm?.enabled ? 0 : 1);
  } catch { process.exit(1); }
" 2>/dev/null; then
  # Ollama が起動していなければバックグラウンドで起動
  if ! curl -s http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    echo "[run] Ollama サービスを起動中..."
    if command -v brew >/dev/null 2>&1; then
      brew services start ollama 2>/dev/null &
    else
      ollama serve >/dev/null 2>&1 &
    fi
    sleep 2
  fi
fi

# ── PM2 で Bot 起動 ────────────────────────────────────────────
if pm2 describe minecraft-auto-bedrock >/dev/null 2>&1; then
  echo "[run] Bot を再起動中..."
  pm2 restart minecraft-auto-bedrock
else
  echo "[run] Bot を起動中..."
  pm2 start ecosystem.config.cjs
fi

pm2 save
echo "[run] 起動完了。ログ確認: pm2 logs minecraft-auto-bedrock"
