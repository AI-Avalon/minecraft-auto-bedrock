# minecraft-auto-bedrock

Java版/統合版を切り替えて動かせる Mineflayer 自律Botです。ViaProxy 自動取得、記憶DB、GUI監視、運用自動化までを含みます。

## 主な機能
- edition 切替で Java/Bedrock 接続を自動分岐
- Bedrock 時の ViaProxy 自動ダウンロードと自動再起動監視
- チェスト/拠点/死亡地点の永続記憶と資材検索
- Bedrock 用 waitForTicks を含む安全なアイテム移動
- AFK対策 Jitter と簡易チャット行動
- 自動採掘(鉱石プラン)と自動取得(目標数指定)
- 建築失敗時の記憶チェスト自動補充 + リトライ
- prismarine-viewer + Web GUI によるリアルタイム監視
- simple-git + PM2 連携による運用自動化
- 外部サーバー接続ポリシー（許可/拒否/ホワイトリスト）
- プレイヤーチャット指示（日本語ベース）
- Ollama を使った無料ローカルLLM会話
- 複数Bot同時起動（役割分担・個別メモリ）

## セットアップ
1. Node.js 20+ と Java をインストール
2. 依存を導入
3. 初期設定を生成

```bash
npm install
npm run setup
```

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
