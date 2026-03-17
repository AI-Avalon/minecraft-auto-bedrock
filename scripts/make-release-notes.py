#!/usr/bin/env python3
"""
scripts/make-release-notes.py
GitHub Release ノートを生成するスクリプト
使い方: python3 scripts/make-release-notes.py v2.0.0 > release-notes.md
"""
import sys
import pathlib
import re

tag = sys.argv[1] if len(sys.argv) > 1 else 'v0.0.0'
ver = tag.lstrip('v')

win = f'minecraft-auto-bedrock-windows-{tag}.zip'
mac = f'minecraft-auto-bedrock-macos-linux-{tag}.tar.gz'

# CHANGELOG から最新エントリを抽出
changelog_section = ''
cl_path = pathlib.Path(__file__).parent.parent / 'CHANGELOG.md'
if cl_path.exists():
    text = cl_path.read_text(encoding='utf-8')
    m = re.search(r'(## \[[\d.]+\].+?)(?=\n## |\Z)', text, re.DOTALL)
    if m:
        changelog_section = '\n\n' + m.group(1).strip()

notes = f"""\
## minecraft-auto-bedrock {tag}

Java版・統合版(Bedrock)両対応の自律Mineflayer Bot フレームワーク。
PrismarineJS エコシステムをフル活用した高機能Bot環境です。

### インストール手順

#### Windows
1. `{win}` をダウンロードして解凍
2. `install.bat` を実行 (ソース取得/更新 + 前提導入 + セットアップを自動実行)
3. `run.bat` をダブルクリックして Bot 起動

#### macOS / Linux
```bash
tar -xzf {mac}
cd minecraft-auto-bedrock-macos-linux-{tag}
bash scripts/install-prereqs.sh
bash run.sh
```

### 主な機能

| 機能 | 説明 |
|------|------|
| 状態機械 AI | mineflayer-statemachine による自律行動エンジン (IDLE/MINING/FARMING/COMBAT 等) |
| 農業モード | 作物収穫・種まき・動物繁殖を完全自動化 |
| 探索モード | 未探索エリア自動移動・村/廃坑/砦などのPOI自動検出・記録 |
| 人間らしい行動 | 首振り・タイピング遅延・AFK対策ジッター・ダメージリアクション |
| マルチサーバー管理 | 複数サーバー同時接続・ヘルスチェック・フェイルオーバー・負荷分散 |
| flying-squid テスト | Node.jsネイティブMCサーバーで実サーバーなしにBot統合テスト可能 |
| セルフホストサーバー | `npm run server:selfhost` で即起動できる軽量Minecraftサーバー |
| Java/Bedrock 両対応 | ViaProxy 自動ダウンロード・設定1つで切り替え |
| Web GUI | Socket.IO リアルタイム監視・遠隔操作ダッシュボード |
| 永続記憶 | チェスト/拠点/死亡地点をlowdb JSONに保存 |
| LLM会話 | Ollama 連携による日本語AI会話 (qwen2.5等) |
| マルチBot | 役割分担・個別メモリ・フリート管理 |

### 必要環境

- Node.js **20.0.0 以上**
- Java (Bedrock/ローカルサーバー使用時)
- Git

### 使用ライブラリ (PrismarineJS)

このプロジェクトは [PrismarineJS](https://github.com/PrismarineJS) の成果物を活用しています。

- [mineflayer](https://github.com/PrismarineJS/mineflayer) - Bot コアエンジン
- [mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) - 経路探索
- [mineflayer-statemachine](https://github.com/PrismarineJS/mineflayer-statemachine) - 状態機械AI
- [mineflayer-pvp](https://github.com/PrismarineJS/mineflayer-pvp) - PvP戦闘
- [mineflayer-collectblock](https://github.com/PrismarineJS/mineflayer-collectblock) - ブロック採取
- [mineflayer-tool](https://github.com/PrismarineJS/mineflayer-tool) - ツール自動選択
- [prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer) - 3Dビューア
- [minecraft-data](https://github.com/PrismarineJS/minecraft-data) - ゲームデータ
- [node-minecraft-protocol](https://github.com/PrismarineJS/node-minecraft-protocol) - プロトコル
- [flying-squid](https://github.com/PrismarineJS/flying-squid) - テスト用MCサーバー (devDep)
{changelog_section}
"""

print(notes, end='')
