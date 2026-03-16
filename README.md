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
