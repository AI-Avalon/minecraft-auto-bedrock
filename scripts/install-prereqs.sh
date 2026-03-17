#!/usr/bin/env bash
# ============================================================
# install-prereqs.sh
# minecraft-auto-bedrock 前提ツール自動インストーラー
# macOS / Linux 対応
# ============================================================
set -euo pipefail

# ── カラー出力 ──────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
info() { echo -e "${CYAN}➜  $*${NC}"; }
err()  { echo -e "${RED}❌ $*${NC}"; }

PLATFORM="$(uname -s)"
ARCH="$(uname -m)"
AUTO_MODE=0
WITH_OLLAMA=0

for arg in "$@"; do
  case "$arg" in
    --auto) AUTO_MODE=1 ;;
    --with-ollama) WITH_OLLAMA=1 ;;
    --skip-ollama) WITH_OLLAMA=0 ;;
  esac
done

echo ""
echo "============================================"
echo "  minecraft-auto-bedrock セットアップ"
echo "  プラットフォーム: $PLATFORM ($ARCH)"
echo "============================================"
echo ""

# ── Homebrew (macOS) ──────────────────────────────────────────
install_brew() {
  if [[ "$PLATFORM" == "Darwin" ]] && ! command -v brew >/dev/null 2>&1; then
    info "Homebrew をインストール中..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Apple Silicon の場合 PATH を設定
    if [[ "$ARCH" == "arm64" ]]; then
      eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
    fi
    ok "Homebrew インストール完了"
  fi
}

# ── Git ───────────────────────────────────────────────────────
install_git() {
  if command -v git >/dev/null 2>&1; then
    ok "Git: $(git --version)"
    return
  fi
  info "Git をインストール中..."
  if command -v brew >/dev/null 2>&1; then
    brew install git
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get install -y git
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y git
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm git
  else
    warn "Git が見つかりません。https://git-scm.com から手動インストールしてください。"
    return
  fi
  ok "Git インストール完了"
}

# ── Node.js (v20+) ────────────────────────────────────────────
install_node() {
  if command -v node >/dev/null 2>&1; then
    NODE_VER="$(node -e 'console.log(process.versions.node.split(".")[0])')"
    if [[ "$NODE_VER" -ge 20 ]]; then
      ok "Node.js: $(node --version)"
      return
    fi
    warn "Node.js $(node --version) は古いです。v20以上が必要です。"
  fi
  info "Node.js v20 をインストール中..."
  if command -v brew >/dev/null 2>&1; then
    brew install node@20
    brew link --overwrite node@20 2>/dev/null || true
  elif command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf module install -y nodejs:20
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm nodejs npm
  else
    warn "Node.js インストール不可。https://nodejs.org からインストールしてください。"
    return
  fi
  ok "Node.js インストール完了: $(node --version 2>/dev/null || echo '再起動が必要な場合があります')"
}

# ── Java (JRE 21) ─────────────────────────────────────────────
install_java() {
  if command -v java >/dev/null 2>&1; then
    JAVA_VER="$(java -version 2>&1 | awk -F '"' '/version/ {print $2}' | cut -d'.' -f1)"
    if [[ "${JAVA_VER:-0}" -ge 17 ]]; then
      ok "Java: $(java -version 2>&1 | head -1)"
      return
    fi
    warn "Java のバージョンが古い可能性があります。"
  fi
  info "Java 21 (Temurin) をインストール中..."
  if command -v brew >/dev/null 2>&1; then
    brew tap homebrew/cask-versions 2>/dev/null || true
    brew install --cask temurin21 2>/dev/null || brew install openjdk@21
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get install -y wget apt-transport-https gnupg
    wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public | sudo apt-key add -
    echo "deb https://packages.adoptium.net/artifactory/deb $(lsb_release -cs) main" \
      | sudo tee /etc/apt/sources.list.d/adoptium.list
    sudo apt-get update && sudo apt-get install -y temurin-21-jdk
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y java-21-openjdk
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -S --noconfirm jre21-openjdk
  else
    warn "Java インストール不可。https://adoptium.net から手動インストールしてください。"
    return
  fi
  ok "Java インストール完了"
}

# ── PM2 ───────────────────────────────────────────────────────
install_pm2() {
  if command -v pm2 >/dev/null 2>&1; then
    ok "PM2: $(pm2 --version)"
    return
  fi
  info "PM2 をインストール中..."
  npm install -g pm2
  ok "PM2 インストール完了"
}

# ── Ollama ────────────────────────────────────────────────────
install_ollama_check() {
  if command -v ollama >/dev/null 2>&1; then
    ok "Ollama: $(ollama --version 2>/dev/null || echo '既存')"
    return
  fi

  if [[ "$WITH_OLLAMA" -ne 1 ]]; then
    info "Ollama は任意機能のためスキップしました (--with-ollama で有効化)"
    return
  fi

  if [[ "$AUTO_MODE" -eq 1 ]]; then
    info "Ollama をインストール中..."
    if command -v brew >/dev/null 2>&1; then
      brew install ollama
    else
      curl -fsSL https://ollama.com/install.sh | sh
    fi
    ok "Ollama インストール完了"
  else
    warn "Ollama が見つかりません。"
    read -r -p "  Ollama をインストールしますか? (LLM日本語会話に必要) [Y/n]: " yn
    case "$yn" in
      [Nn]*) info "Ollama のインストールをスキップしました。後で 'npm run ollama:setup' で設定できます。";;
      *)
        info "Ollama をインストール中..."
        if command -v brew >/dev/null 2>&1; then
          brew install ollama
        else
          curl -fsSL https://ollama.com/install.sh | sh
        fi
        ok "Ollama インストール完了"
        ;;
    esac
  fi
}

# ── 実行 ─────────────────────────────────────────────────────
install_brew
install_git
install_node
install_java
install_pm2
install_ollama_check

echo ""
echo "============================================"
echo -e "${GREEN}  前提ツール確認・インストール完了${NC}"
echo "============================================"
echo ""
echo "次のステップ:"
echo "  1. npm install && npm run setup"
echo "  2. npm run configure:java  (または configure:bedrock)"
echo "  3. bash run.sh"
echo ""
echo "LLM会話を有効化する場合:"
echo "  npm run ollama:setup"
echo ""
