#!/usr/bin/env bash
# ============================================================
# run.sh — minecraft-auto-bedrock GUI Manager (macOS/Linux)
# ・GUI を優先起動
# ・ポート自動選択
# ・Bot/Java は GUI から制御
# ============================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo ""
echo "============================================"
echo "  minecraft-auto-bedrock GUI Manager"
echo "============================================"
echo ""

# ── 依存関係更新 ───────────────────────────────────────────────
echo "[run] Checking dependencies..."
npm install --silent 2>/dev/null || echo "[run] npm install スキップ"

# ── GUI を起動（ポート自動選択付き） ──────────────────────────
echo "[run] Starting GUI..."
if ! node scripts/start-gui.js; then
  echo "[run] ERROR: GUI startup failed."
  exit 1
fi

echo ""
echo "[run] GUI is running."
echo "[run] Bot/Java server management: GUI control panel"
echo ""

