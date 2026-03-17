# minecraft-auto-bedrock

Java版/統合版を切り替えて動かせる Mineflayer 自律Botです。ViaProxy 自動取得、記憶DB、GUI監視、運用自動化までを含みます。

## 主な機能
- edition 切替で Java/Bedrock 接続を自動分岐
- Bedrock 時の ViaProxy 自動ダウンロードと自動再起動監視
- チェスト/拠点/死亡地点の永続記憶と資材検索
- Bedrock 用 waitForTicks を含む安全なアイテム移動
- AFK対策 Jitter と簡易チャット行動
- 自動採掘(鉱石プラン)と自動取得(目標数指定)
- 自動保管モード（不要アイテムを近傍チェストへ自動格納）
- 自動仕分けモード（近傍チェスト群をカテゴリ単位で巡回整理）
- 建築失敗時の記憶チェスト自動補充 + リトライ
- prismarine-viewer + Web GUI によるリアルタイム監視
- GUIで oneclick 実行の段階進捗表示（ステップごとの進捗バー）
- simple-git + PM2 連携による運用自動化
- 起動時アップデート確認（ローカルversion / npm / git上流差分）
- 外部サーバー接続ポリシー（許可/拒否/ホワイトリスト）
- プレイヤーチャット指示（日本語ベース）
- Ollama を使った無料ローカルLLM会話
- 複数Bot同時起動（役割分担・個別メモリ）
- Mojang bedrock-samples 解析によるレシピ/ドロップ推定
- 戦闘/PvP（近接MOB戦闘・プレイヤー指定戦闘）
- 戦闘AI強化（装備切替・回復行動・遠距離戦闘・敵種別戦術）
- 役割ベースのタスク割当（Orchestrator）

## セットアップ
1. Node.js 20+ と Java をインストール
2. 依存を導入
3. 初期設定を生成

```bash
npm install
npm run setup
```

### ほぼ全自動セットアップ

前提ツール確認・依存導入・初期設定・bedrock samples 同期までを一括で実行します。

```bash
npm run oneclick:setup
```

GUIの「運用 / セットアップ」からも実行でき、進捗バーで段階表示されます。

### Bedrockサンプルデータ同期（Mojang公式）

以下で `data/bedrock-samples` に shallow clone / update します。

```bash
npm run bedrock:sync
```

解析対象の中心は `behavior_pack/recipes` と `behavior_pack/loot_tables` です。

### 接続モードの自動設定
- Java ローカルサーバー向け:

```bash
npm run configure:java
```

- 外部Javaサーバー接続向け（ローカルサーバー自動起動なし）:

```bash
npm run configure:java-external
```

- 採掘専用（無言）モード:

```bash
npm run configure:mining-only
```

- 日本語会話モード（Ollama）:

```bash
npm run configure:conversation-jp
```

- 複数Botサンプル設定:

```bash
npm run configure:multibot-sample
```

### ローカルJavaサーバーの自動準備・起動
有名ソフトウェア（Vanilla / Paper / Purpur / Fabric / Forge）に対応しています。

- 設定ファイル (`localJavaServer`) を使ってインストール:

```bash
npm run server:install
```

- 設定ファイル (`localJavaServer`) を使って起動:

```bash
npm run server:start
```

- インストール+起動を一括実行:

```bash
npm run server:bootstrap
```

- コマンド引数でソフトウェア/バージョンを指定してインストール:

```bash
npm run server:install -- --software paper --mc 1.21.4
npm run server:install -- --software fabric --mc 1.21.4
npm run server:install -- --software forge --mc 1.20.1 --forge 47.3.0
npm run server:install -- --software vanilla --mc 1.21.4
npm run server:install -- --software purpur --mc 1.21.4
```

`npm run configure:java` を実行すると、`edition=java` と `localJavaServer.autoStart=true` のローカル運用向け設定になります。

## 自動採掘・自動素材収集・レシピ計算

- GUI の「レシピ計算 / 素材計画」から必要素材を計算できます。
- `素材収集を開始` は、算出素材に対して自動採取可能なものを優先して実行します。
- MOBドロップが必要な素材は、候補MOB情報を計画に含めます。

## 戦闘 / PvP

- GUI から `近くの敵MOBを攻撃` / `プレイヤー攻撃` / `戦闘停止` を実行できます。
- チャットコマンドでも以下を実行できます。
	- `!bot fightmob`
	- `!bot fight <playerName>`
	- `!bot stop` (戦闘含む自動作業停止)

### 戦闘AIの挙動

- HPが閾値以下で回復アイテム（例: golden_apple）を優先使用
- 敵種別で戦術を切替（例: creeper/witch は遠距離、skeleton/spider は近接）
- 武器を自動切替（弓/クロスボウ/剣/斧）し、可能なら盾/トーテムをオフハンド装備
- `combat` 設定で回復閾値や戦闘距離を調整可能

## 指示系統 (Orchestrator)

- GUI の Orchestrator で `role` 指定タスクを割り当てできます。
- `mine / gather / fight-mob / fight-player` をサポート。
- 例: `role=worker` に採掘、`role=assistant` に素材計算や会話支援を割り当て。

## プレイヤーチャット指示（日本語）

`chatControl.commandPrefix` が `!bot` の場合、以下をゲーム内チャットで実行できます。

- `!bot help`
- `!bot mode silent-mining|hybrid|conversation|player-command|autonomous`
- `!bot mine <blockName> <count>`
- `!bot stop`
- `!bot base <name>`
- `!bot fetch <itemName> <count>`
- `!bot retreat`
- `!bot status`
- `!bot store`
- `!bot autostore on|off`
- `!bot sortchest`
- `!bot autosort on|off`

`mode=silent-mining` では Bot 側の自発チャットと会話応答を抑制し、無言運用できます。

### 権限レベル（管理者/一般）

`chatControl.playerRoles` にプレイヤー名を設定すると権限を分離できます。

```json
"chatControl": {
	"playerRoles": {
		"owner_name": "admin",
		"friend_name": "general"
	},
	"dangerousCommands": ["mode", "stop", "retreat", "base"]
}
```

`dangerousCommands` に含まれるコマンドは `admin` のみ実行可能です。

## LLM会話（無料運用）

ローカル無料構成は Ollama を推奨します。

1. Ollama を起動し、モデルを取得

```bash
ollama pull qwen2.5:3b
```

2. `config.json` の `llm.enabled=true` にする（または `npm run configure:conversation-jp`）

3. Botにメンションを含めたチャットで会話

例: `@bot 今日は何を掘る？`

Bot は LLM へ以下のコンテキストを渡して応答品質を上げます。

- 現在座標
- 体力 / 空腹
- インベントリ要約
- 記憶チェスト数
- 記憶チェストの中身要約

## 推奨スペック

### 最小（無料ローカル運用）
- CPU: 4コア
- RAM: 16GB
- Javaサーバー: 2GB
- Bot+GUI: 1GB
- Ollama(3B): 4〜6GB

### 推奨（複数Bot + 会話 + 戦闘）
- CPU: 8コア以上
- RAM: 32GB
- Javaサーバー: 4〜8GB
- Bot 1体あたり: 0.7〜1.2GB
- Ollama 7B使用時: 8〜12GB 追加

### GPU推奨（任意）
- Ollamaの応答を高速化したい場合はVRAM 8GB以上を推奨

- Bedrock (avalox.f5.si:19132) 向け:

```bash
npm run configure:bedrock
```

## 起動
```bash
npm run bootstrap
```

## GUI
起動後に次を開きます。
- GUI: http://localhost:3000
- 3D Viewer: http://localhost:3001

### GUI権限制御と監査ログ
- [config.json](config.json) の gui.security で制御できます。
- requireToken=true のときは WebUI 上部のトークン欄を入力して再接続してください。
- readOnly=true で破壊的操作を無効化できます。
- 操作監査ログは logs/gui-audit.log に JSON Lines 形式で追記されます。
- WebUI から 自動取得ON/OFF, 自動採掘ON/OFF, 建築+自動補充 を直接実行できます。
- WebUI の MultiBot 管理パネルから Bot の追加/削除/役割変更をリアルタイム操作できます。
- WebUI の 戦闘/PvP, レシピ計算/素材計画, Orchestrator パネルで運用を完結できます。

## PM2 自動復旧
```bash
npm run pm2:start
npm run pm2:save
node scripts/pm2-startup-guide.js
```

## 自動更新
```bash
node scripts/deploy.js
```

## テスト
```bash
npm test
```

### GUI統合テスト
```bash
npm run test:gui
```

### E2E 実接続テスト (Java/Bedrock)
実サーバーがある環境のみで実行します。

```bash
RUN_E2E=1 \
E2E_JAVA_HOST=127.0.0.1 \
E2E_JAVA_PORT=25565 \
E2E_BEDROCK_HOST=avalox.f5.si \
E2E_BEDROCK_PORT=19132 \
E2E_BEDROCK_PROXY_HOST=127.0.0.1 \
E2E_BEDROCK_PROXY_PORT=25566 \
npm run test:e2e
```

### 全自動検証 (設定チェック + 単体 + GUI + E2E)
```bash
npm run verify:all
```

## 補足
- Discord通知は拡張ポイントのみで、本実装には含めていません。
- ViaProxy 固定版を使う場合は config.json の bedrock.proxy.fixedVersion を設定してください。

## 初心者向け: Clone後に一生放置で動かす最初のコマンド

Bedrock(avalox)で常時運用する場合:

```bash
npm install && npm run setup && npm run configure:bedrock && npm run pm2:start && npm run pm2:save
```

次にOS再起動時の自動復帰設定を表示:

```bash
node scripts/pm2-startup-guide.js
```

Javaローカルサーバー（Paper）も含めて常時運用する場合:

```bash
npm install && npm run setup && npm run configure:java && npm run pm2:start && npm run pm2:save
```
