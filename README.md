# minecraft-auto-bedrock

Java版・統合版(Bedrock)両対応の **自律Mineflayer Bot** フレームワーク。
PrismarineJS エコシステムをフル活用した、状態機械AI・農業・探索・ブランチマイニング・マルチサーバー対応の高機能Bot環境です。

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

---

## 目次

- [主な機能](#主な機能)
- [新機能 v2.0.0](#新機能-v200)
- [セットアップ](#セットアップ)
- [モード一覧](#モード一覧)
- [チャットコマンド](#チャットコマンド)
- [ブランチマイニング](#ブランチマイニング)
- [農業モード](#農業モード)
- [探索モード](#探索モード)
- [防具・レシピ解析](#防具レシピ解析)
- [マルチサーバー](#マルチサーバー)
- [セルフホストサーバー](#セルフホストサーバー)
- [テスト](#テスト)
- [設定リファレンス](#設定リファレンス)
- [クレジット](#クレジット)

---

## 主な機能

| カテゴリ | 機能 |
|----------|------|
| **接続** | Java/Bedrock 自動切替、ViaProxy 自動DL・管理 |
| **記憶** | チェスト/拠点/死亡地点の永続記憶 (lowdb)、資材検索 |
| **採掘** | 自動採掘、**ブランチマイニング**、ストリップマイニング、鉱石脈丸ごと採掘 |
| **農業** | 自動収穫・種まき・動物繁殖、**水源自動配置**、**灌漑計画**、収穫後自動再植付け |
| **探索** | 未探索チャンク自動移動、村/廃坑/砦などのPOI自動検出・記録、村人取引 |
| **AI** | 状態機械AI (IDLE/MINING/FARMING/EXPLORING/COMBAT/RETREATING)、人間らしい行動 |
| **戦闘** | PvP、近接/遠距離自動切替、装備自動交換、**防具自動装備** (スコアリング付き) |
| **クラフト** | **レシピ解析** (依存ツリー)、資材不足自動判定、minecraft-data 連携 |
| **収集** | **リソース収集モード** (採掘/伐採/狩猟/農業/クラフト/取引/宝箱回収) |
| **GUI** | Web ダッシュボード (Socket.IO)、リアルタイム監視・遠隔操作 |
| **マルチBot** | フリート管理、役割分担、個別メモリ |
| **マルチサーバー** | 複数サーバー同時管理、ヘルスチェック、フェイルオーバー |
| **テスト** | flying-squid による実サーバーなし統合テスト |

---

## 新機能 v2.0.0

### 🧠 状態機械 AI (`src/behaviorStateMachine.js`)
`mineflayer-statemachine` ベースの自律行動エンジン。
体力・時間・インベントリ・敵の有無に応じて状態を自動遷移します。

```
IDLE → MINING → STORING → IDLE
     ↓ 敵出現           ↓ 満杯
     COMBAT → IDLE   RETREATING
```

### ⛏️ ブランチマイニング (`src/branchMiningModule.js`)
```bash
# チャットコマンドで起動
!bot mine branch y=-57        # Y=-57でダイヤ採掘 (1.18+)
!bot mine strip y=-57 w=16    # ストリップマイニング
!bot mine vein                 # 近くの鉱石脈を丸ごと採掘
!bot mine stop
```

- メイントンネル(1×2) + ブランチトンネルの自動掘削
- 溶岩検出・水検出による安全チェック
- たいまつ自動設置（8ブロックごと）
- インベントリ満杯時に自動でチェストへ格納して再開

### 🌾 農業モード (`src/farmingModule.js`)
```bash
!bot farm start    # 農業サイクル開始
!bot farm harvest  # 収穫のみ
!bot farm expand   # 農地拡張
!bot farm water    # 灌漑計画を実行
```

**水源自動配置**: `autoWater: true` で農地拡張時に水を自動設置。
空バケツがあれば近くの水源から自動で水を汲みます。

**灌漑計画**: 指定サイズの農地に必要な最小水源数を計算し、最適配置を提示。

### 🗺️ 探索モード (`src/explorerModule.js`)
```bash
!bot explore start   # 未探索エリアへ出発
!bot explore stop
!bot poi             # 発見済みPOI一覧
```

村、廃坑、砦、海底神殿、ポータルなどを自動検出・記録します。

### 🛡️ 防具解析 (`src/armorAnalyzer.js`)
```bash
!bot armor equip   # 最良防具を自動装備
!bot armor status  # 現在の防具スコアを表示
!bot armor suggest # アップグレード提案
```

アーマーティア・エンチャント・タフネスを加味したスコアリングで最適な装備を選択します。

### 📦 レシピ解析 (`src/recipeAnalyzer.js`)
```bash
!bot craft diamond_sword 1    # クラフト実行
!bot recipe iron_pickaxe      # 材料と手順を表示
!bot missing netherite_sword  # 不足材料をチェック
```

minecraft-data の全レシピから依存ツリーを解決。「ダイヤの剣を作るには棒が要る → 棒は板材から → 板材は木材から」まで自動計算します。

### 🎭 人間らしい行動 (`src/humanBehavior.js`)
- ランダムな首振り・視線追従
- タイピング遅延付きチャット
- ダメージ・レアアイテム入手時のリアクション
- アクティビティ別の独り言フレーズ

### 🌐 マルチサーバー管理 (`src/multiServerManager.js`)
複数のMinecraftサーバーに対してBotをフリート管理。
サーバーダウン時のフェイルオーバーにも対応。

---

## セットアップ

### 必要環境
- Node.js **20.0.0 以上**
- Java (Bedrock/ローカルサーバー使用時)
- Git

### 1. 依存関係インストール
```bash
git clone https://github.com/YOUR/minecraft-auto-bedrock
cd minecraft-auto-bedrock
npm install
npm run setup
```

Windows では `run.bat` と同じ階層の `setup.bat` で、
前提ツール確認・設定項目選択・途中再開付きのセットアップを実行できます。

最短導線は `install.bat` です。これ1つでリポジトリ取得/更新、前提導入、
セットアップ再開まで自動実行します。

```bat
install.bat
install.bat D:\minecraft-auto-bedrock --node-major=22

setup.bat
setup.bat --resume
setup.bat --from-step=config
setup.bat --node-major=22
```

Node.js が古い/未導入の場合は `setup.bat` が案内し、
前提ツール導入後に `setup.bat --resume` で再開できます。

Windows 更新用メニューは `update.bat` を使えます。

```bat
update.bat
update.bat --node-major=22
```

### 2. 接続設定
```bash
# Java ローカルサーバー向け
npm run configure:java

# Bedrock サーバー向け
npm run configure:bedrock

# 外部 Java サーバー向け
npm run configure:java-external

# 採掘専用（無言モード）
npm run configure:mining-only

# 日本語会話モード (Ollama)
npm run configure:conversation-jp

# 複数Botサンプル
npm run configure:multibot-sample

# サバイバルモード（全自律）
npm run configure:survival

# 農業特化モード
npm run configure:farming
```

### 3. Bot 起動
```bash
bash run.sh        # macOS/Linux（自動アップデート付き）
run.bat            # Windows（Bot起動 + GUI同時提供 + ブラウザ自動オープン）
# または
npm start
```

既存環境で GUI プロセスが重複登録されている場合は一度だけ次を実行:
```bash
pm2 delete minecraft-auto-bedrock-gui
```

### Bot 停止
```bash
stop-all.bat       # Windows（PM2 全プロセス + ローカルJavaサーバープロセスを停止）
bash stop-all.sh   # macOS/Linux（同じく）
# または手動で
pm2 stop all
```

**注意**: `stop-all.bat/sh` は起動時に `memory.json` に記録されたプロセスIDのみを終了するため、他の無関係なJavaプロセスは影響を受けません。

### ワンクリックセットアップ
```bash
npm run oneclick:setup
```

### 全自動/途中再開セットアップ
```bash
# 対話式（何を設定するか選択可能）
npm run install:all

# 非対話（必要に応じてオプション追加）
npm run install:all:auto

# 途中再開
node scripts/full-install.js --resume

# 途中ステップから開始（例: config から）
node scripts/full-install.js --from-step=config

# 必須 Node メジャー指定（例: 22 以上）
node scripts/full-install.js --node-major=22

# Node 仮想環境 (Volta) も導入
node scripts/full-install.js --use-volta

# ステップID確認
node scripts/full-install.js --show-steps
```

### Node をプロジェクト固定で使う（Python venv 風）
Volta を使うことで、リポジトリごとに Node バージョンを固定できます。

```bash
# 対話で導入したい場合
npm run node:env

# 自動導入（Node 20+ を固定）
npm run node:env:auto -- --node-major=20

# 例: Node 22 を固定
npm run node:env:auto -- --node-major=22
```

Windows では `update.bat` のメニューからも Node 仮想環境設定を実行できます。

### リリース自動化
```bash
# patch/minor/major を自動でバージョンアップして tag/push/release
npm run release:patch
npm run release:minor
npm run release:major

# 手動指定バージョン
npm run release -- --version=2.1.0 --yes

# タグ作成まで（push/releaseなし）
npm run release -- --version=2.1.0 --yes --no-push --no-gh
```

---

## モード一覧

| モード | 説明 |
|--------|------|
| `autonomous` | 状態機械AIによる完全自律動作 |
| `hybrid` | 手動指示 + 自動タスクの組み合わせ |
| `silent-mining` | 無言で採掘に専念 |
| `player-command` | チャットコマンドのみで動作 |
| `conversation` | LLM会話に特化 |

`config.json` の `behavior.mode` で設定、またはチャットで `!bot mode autonomous` と送信。

---

## チャットコマンド

全コマンドは `!bot ` プレフィックス付きで送信（設定変更可能）。

```
!bot help                      - コマンド一覧
!bot status                    - 現在の状態表示
!bot mode <モード名>            - 動作モード切替

# 採掘
!bot mine branch [y=<Y>]       - ブランチマイニング開始
!bot mine strip [y=<Y> w=<幅>] - ストリップマイニング
!bot mine vein                  - 鉱石脈採掘
!bot mine stop                  - 採掘停止
!bot collect <ブロック名> <数>  - 指定ブロックを指定数集める

# 農業
!bot farm start                - 農業サイクル開始
!bot farm stop                 - 農業停止
!bot farm harvest              - 収穫のみ
!bot farm expand               - 農地拡張
!bot farm water                - 灌漑実行

# 探索
!bot explore start             - 探索開始
!bot explore stop              - 探索停止
!bot poi                       - POI一覧表示

# 防具・アイテム
!bot armor equip               - 最良防具装備
!bot armor status              - 防具スコア表示
!bot craft <アイテム名> [数]   - クラフト実行
!bot recipe <アイテム名>       - レシピ・材料表示
!bot gather <アイテム名> <数>  - リソース収集開始

# 拠点・移動
!bot base                      - 現在地を拠点に設定
!bot base <名前>               - 指定名前で拠点設定
!bot go <拠点名>               - 指定拠点へ移動
!bot retreat                   - 最寄り拠点へ退避
!bot fetch <アイテム名>        - チェストから取得

# 保管・仕分け
!bot store                     - 不要アイテムをチェストへ
!bot autostore on/off          - 自動保管トグル
!bot sortchest                 - 近くのチェストを仕分け
!bot autosort on/off           - 自動仕分けトグル

# 戦闘
!bot fight <プレイヤー名>      - プレイヤーと戦闘
!bot fightmob [mob名]          - 最寄りMOBと戦闘
!bot stop                      - 全タスク停止
```

---

## ブランチマイニング

`config.json` の `behavior` に追加できる設定:

```json
{
  "behavior": {
    "miningSafetyChecks": true,
    "miningPlaceTorches": true,
    "miningReturnThreshold": 0.7,
    "branchMining": {
      "mainTunnelLength": 64,
      "branchInterval": 3,
      "branchLength": 16,
      "stripHeight": -57,
      "targetOres": [
        "diamond_ore", "deepslate_diamond_ore",
        "iron_ore", "deepslate_iron_ore",
        "gold_ore", "deepslate_gold_ore",
        "ancient_debris"
      ]
    }
  }
}
```

### Y座標の目安 (1.18+)

| 目的 | 推奨Y座標 |
|------|----------|
| ダイヤモンド | -57 |
| レッドストーン | -57 |
| 鉄鉱石 | 15 または -57 |
| 金鉱石 | -17 |
| エメラルド | 236 (山岳) |
| 古代残骸 (ネザー) | 15 |

---

## 農業モード

```json
{
  "behavior": {
    "farmScanRadius": 32,
    "farmAutoExpand": true,
    "farming": {
      "autoWater": true,
      "autoReplant": true,
      "autoStoreToChest": true,
      "breedRadius": 24
    }
  }
}
```

### 灌漑計画

ゲーム内のMinecraftの水和ルール: **水からマンハッタン距離4以内のfarmlandが湿る**

botが自動的に最小水源数で最大農地をカバーする配置を計算します:
```
例: 9×9 農地 → 中央に1つの水源で全てカバー
    17×17 農地 → 最適配置で水源を分散
```

---

## 探索モード

```json
{
  "behavior": {
    "explorerStepDistance": 64,
    "explorerMaxSteps": 20
  }
}
```

検出されたPOI（村、廃坑、砦など）は `memory.json` に自動保存され、
GUIの「記憶チェスト一覧」から確認できます。

---

## 防具・レシピ解析

### 防具スコア計算

```
スコア = 基本防御値 + タフネス×0.5 + ティア×2 + エンチャントボーナス
ティア: leather=1 < chainmail=2 < iron=3 < gold=3 < diamond=5 < netherite=6
```

### レシピ依存ツリー例

```
netherite_sword が必要
  └─ diamond_sword (クラフト可能？)
       ├─ diamond × 2 → 採掘必要
       └─ stick × 1
            └─ oak_planks × 2 (クラフト可能？)
                 └─ oak_log × 1 → 伐採必要
```

---

## マルチサーバー

`config.json` に `multiServerManager` セクションを追加:

```json
{
  "multiServerManager": {
    "enabled": true,
    "assignPolicy": "least-players",
    "pingIntervalMs": 30000,
    "servers": [
      { "id": "srv1", "host": "mc1.example.com", "port": 25565, "tags": ["survival"] },
      { "id": "srv2", "host": "mc2.example.com", "port": 25565, "tags": ["creative"] }
    ]
  }
}
```

ポリシー: `round-robin` / `least-players` / `failover` / `specified`

---

## セルフホストサーバー

[flying-squid](https://github.com/PrismarineJS/flying-squid) を使ったNode.jsネイティブのMinecraftサーバー。
テスト・開発用に実サーバーなしで即起動できます。

```bash
# flying-squid をインストール（初回のみ）
npm install --save-dev flying-squid

# サーバー起動
npm run server:selfhost:start

# サーバー停止
npm run server:selfhost:stop

# 状態確認
node scripts/self-host-server.js status
```

`config.json` に設定を追加:
```json
{
  "selfHostServer": {
    "port": 25565,
    "version": "1.21.4",
    "maxPlayers": 20,
    "flatWorld": true,
    "onlineMode": false
  }
}
```

---

## テスト

```bash
# 単体テスト（全モジュール）
npm test

# GUI統合テスト
npm run test:gui

# flying-squid を使った統合テスト（flying-squid要インストール）
RUN_INTEGRATION=1 npm run test:integration

# E2Eテスト（実サーバー必要）
RUN_E2E=1 E2E_JAVA_HOST=127.0.0.1 npm run test:e2e
```

---

## ローカル Java サーバー

```bash
# サーバーインストール（Vanilla/Paper/Purpur/Fabric/Forge）
npm run server:install

# サーバー起動
npm run server:start

# インストール + 即起動
npm run server:bootstrap
```

---

## PM2 自動復旧

```bash
# PM2 でBot起動
npm run pm2:start

# OS再起動後も自動起動するよう設定
npm run pm2:save
pm2 startup  # 表示されたコマンドをコピーして実行
```

---

## Ollama LLM会話

```json
{
  "llm": {
    "enabled": true,
    "provider": "ollama",
    "baseUrl": "http://127.0.0.1:11434",
    "model": "qwen2.5:3b",
    "timeoutMs": 12000,
    "fallbackRuleBased": true
  }
}
```

```bash
# モデルをダウンロード
ollama pull qwen2.5:3b

# LLM会話モードでBot起動
npm run configure:conversation-jp
npm start
```

---

## 設定リファレンス

主要な `config.json` キーの抜粋:

```json
{
  "edition": "java",
  "bot": { "username": "AutoBot", "auth": "offline" },
  "behavior": {
    "mode": "autonomous",
    "autoStoreIntervalMs": 12000,
    "autoSortIntervalMs": 18000,
    "humanChatIntervalMs": 90000,
    "farmScanRadius": 32,
    "farmAutoExpand": false,
    "explorerStepDistance": 64,
    "miningSafetyChecks": true,
    "miningPlaceTorches": true,
    "stateMachineTickMs": 2000
  },
  "combat": {
    "healThreshold": 10,
    "retreatThreshold": 8
  }
}
```

全設定は `config.template.json` を参照してください。

---

## クレジット

### PrismarineJS
このプロジェクトは [PrismarineJS](https://github.com/PrismarineJS) コミュニティの成果物に大きく依存しています。

| ライブラリ | 用途 | リポジトリ |
|-----------|------|-----------|
| mineflayer | Bot コアエンジン | [PrismarineJS/mineflayer](https://github.com/PrismarineJS/mineflayer) |
| mineflayer-pathfinder | 経路探索・自律移動 | [PrismarineJS/mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder) |
| mineflayer-statemachine | 状態機械AI基盤 | [PrismarineJS/mineflayer-statemachine](https://github.com/PrismarineJS/mineflayer-statemachine) |
| mineflayer-pvp | PvP・戦闘 | [PrismarineJS/mineflayer-pvp](https://github.com/PrismarineJS/mineflayer-pvp) |
| mineflayer-collectblock | ブロック自動採取 | [PrismarineJS/mineflayer-collectblock](https://github.com/PrismarineJS/mineflayer-collectblock) |
| mineflayer-tool | ツール自動選択 | [PrismarineJS/mineflayer-tool](https://github.com/PrismarineJS/mineflayer-tool) |
| mineflayer-auto-eat | 自動食事 | [link-discord/mineflayer-auto-eat](https://github.com/link-discord/mineflayer-auto-eat) |
| mineflayer-schem | 建築(.schem) | [Rothen/mineflayer-schem](https://github.com/Rothen/mineflayer-schem) |
| mineflayer-movement | 滑らかな歩行 | [PrismarineJS/mineflayer-movement](https://github.com/PrismarineJS/mineflayer-movement) |
| prismarine-viewer | 3Dビューア | [PrismarineJS/prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer) |
| minecraft-data | ゲームデータ (全レシピ・アイテム) | [PrismarineJS/minecraft-data](https://github.com/PrismarineJS/minecraft-data) |
| node-minecraft-protocol | プロトコル実装 | [PrismarineJS/node-minecraft-protocol](https://github.com/PrismarineJS/node-minecraft-protocol) |
| flying-squid | Node.js MCサーバー (テスト用) | [PrismarineJS/flying-squid](https://github.com/PrismarineJS/flying-squid) |

### その他
| ライブラリ | 用途 |
|-----------|------|
| [lowdb](https://github.com/typicode/lowdb) | 永続記憶 (JSON DB) |
| [express](https://github.com/expressjs/express) | Web GUI サーバー |
| [socket.io](https://github.com/socketio/socket.io) | リアルタイム通信 |
| [pm2](https://github.com/Unitech/pm2) | プロセス管理・自動復旧 |
| [simple-git](https://github.com/steveukx/git-js) | 自動Git同期 |
| [ViaProxy](https://github.com/ViaVersion/ViaProxy) | Bedrockプロキシ |

---

## ライセンス

MIT License — 詳細は [LICENSE](LICENSE) を参照してください。
