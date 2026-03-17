#!/usr/bin/env bash
set -euo pipefail

# Best-effort installer for macOS/Linux
if ! command -v git >/dev/null 2>&1; then
  echo "git が見つかりません。先にインストールしてください。"
fi

if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install node
  else
    echo "Node.js が見つかりません。https://nodejs.org/ からインストールしてください。"
  fi
fi

if ! command -v java >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install openjdk
    echo "openjdk をインストールしました。PATH設定が必要な場合があります。"
  else
    echo "Java が見つかりません。https://adoptium.net/ からインストールしてください。"
  fi
fi

echo "前提ツール確認完了"
