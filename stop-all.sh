#!/bin/bash

cd "$(dirname "$0")" || exit 1

echo ""
echo "============================================"
echo "   minecraft-auto-bedrock stop all"
echo "============================================"
echo ""

# ── Javaサーバープロセス停止 ──────────────────────────────────
echo "[stop] ローカルJavaサーバーをチェック中..."

if [ -f memory.json ]; then
  java_pid=$(grep -o '"javaServerPid"[[:space:]]*:[[:space:]]*[0-9]*' memory.json | grep -o '[0-9]*')
  
  if [ -n "$java_pid" ]; then
    if kill -0 "$java_pid" 2>/dev/null; then
      echo "[stop] Javaサーバープロセスを停止 - PID: $java_pid"
      kill -TERM "$java_pid"
      sleep 2
      # 強制終了が必要な場合
      kill -0 "$java_pid" 2>/dev/null && kill -KILL "$java_pid" 2>/dev/null
    fi
  fi
fi

# ── PM2 全プロセス停止 ────────────────────────────────────────
echo "[stop] PM2の全プロセスを停止中..."
pm2 stop all 2>/dev/null

if [ $? -ne 0 ]; then
  echo "[stop] warning: pm2 stop all に失敗しました"
  echo "[stop]   原因: PM2がインストールされていないか、プロセスがない可能性があります"
  exit 1
fi

echo "[stop] 完了: PM2の全プロセスを停止しました"
echo ""
echo "[stop] 各プロセスの状態:"
pm2 list

echo ""
