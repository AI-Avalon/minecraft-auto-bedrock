# CHANGELOG

このプロジェクトの変更履歴です。[Semantic Versioning](https://semver.org/lang/ja/) に従っています。

---

## [2.0.0] - 2026-03-17

### 追加

#### 新モジュール
- **`src/behaviorStateMachine.js`** — `mineflayer-statemachine` ベースの自律行動状態機械
  - 状態: IDLE / MINING / FARMING / EXPLORING / COMBAT / RETREATING / STORING / BUILDING / SLEEPING / TRADING
  - 体力・時間・インベントリ・敵の有無による自動遷移
  - `setGoal()` で採掘/農業/探索/自動をランタイム切替

- **`src/branchMiningModule.js`** — ブランチマイニング完全自動化
  - 1×2メイントンネル + ブランチトンネルの自動掘削
  - ストリップマイニング (Y座標指定レイヤー)
  - 鉱石脈をBFSで丸ごと採掘 (`mineOreVein`)
  - 溶岩/水検出による安全チェック
  - たいまつ自動設置、インベントリ満杯時自動帰還

- **`src/farmingModule.js`** — 農業モジュール強化 (全面リライト)
  - **水源自動配置**: 農地拡張時に適切な位置に水を自動設置
  - **水汲み**: 空バケツで近くの水源から自動収集
  - **灌漑計画** (`planIrrigation`): マンハッタン距離4ルールに基づく最小水源配置計算
  - **自動再植付け** (`replantFromLog`): 収穫位置を記録して同種の作物を再植
  - **チェスト格納** (`storeHarvestInChest`): 収穫物を近くのチェストへ自動保管
  - 統計情報 (収穫数・植付け数・水設置数・サイクル数)

- **`src/humanBehavior.js`** — 人間らしい行動シミュレーション
  - ランダム首振り・視線移動
  - タイピング遅延付きチャット送信
  - アクティビティ別独り言 (採掘中/戦闘中/農業中/待機中)
  - ダメージ・レアアイテム取得のリアクション
  - 近くのプレイヤーへの視線追従

- **`src/explorerModule.js`** — 自動探索モジュール
  - 未探索チャンクへの優先移動
  - POI自動検出: 村/廃坑/砦/海底神殿/ネザー要塞/ポータル
  - 発見POIをMemoryStoreに自動保存
  - 村人取引の自動実行 (`tradeWithVillagers`)

- **`src/armorAnalyzer.js`** — 防具解析・自動装備
  - 防具スコアリング (基本防御値 + タフネス + ティア + エンチャントボーナス)
  - `autoEquipBestArmor()`: インベントリから最良装備を自動選択・装着
  - `getBestArmorSet()`: スロット別最適防具セット計算
  - `getArmorGaps()`: 空きスロット・弱い装備の検出
  - エリトラ対応 (飛行vs防御のトレードオフ)

- **`src/recipeAnalyzer.js`** — レシピ解析・クラフト自動化
  - `minecraft-data` から全レシピを読み込み
  - `getCraftingPlan()`: ネストした依存ツリーを再帰解決
  - `canCraft()`: 現在のインベントリでクラフト可能か判定
  - `analyzeMissingMaterials()`: 不足材料リストを生成
  - `craftItem()`: レシピ自動選択でクラフト実行
  - 製錬・スミシング対応

- **`src/resourceGatheringModule.js`** — 統合リソース収集
  - 戦略: mine/chop/kill/farm/craft/trade/loot_chest
  - `gatherAll()`: 複数リソースの依存順で順次収集
  - 戦略フォールバック (第一手段失敗時に別戦略へ自動切替)
  - プリセット: STARTER_KIT / IRON_KIT / DIAMOND_KIT / FARM_SETUP

- **`src/multiServerManager.js`** — マルチサーバー管理
  - 複数サーバーへの同時接続管理
  - TCPヘルスチェック + 遅延監視
  - フェイルオーバー: ダウン検知 → 自動で別サーバーへBot移動
  - 割り当てポリシー: round-robin / least-players / failover / specified
  - イベントブリッジ: サーバー間チャットリレー

- **`src/flyingSquidServer.js`** — flying-squid テストサーバーラッパー
  - `createTestServer()`: テスト用MCサーバーをプログラムから即起動
  - OP付与・アイテム付与・ゲームモード変更API

- **`scripts/self-host-server.js`** — セルフホストサーバー管理スクリプト
  - `npm run server:selfhost:start/stop/status`
  - flying-squid 未インストール時に自動インストール提案

- **`scripts/make-release-notes.py`** — リリースノート自動生成スクリプト

- **`test/statemachine.test.js`** — 状態機械・全新モジュールの単体テスト (30+ ケース)

- **`test/integration/flying_squid_bot.test.js`** — flying-squid 統合テスト

#### 新パッケージ
- `mineflayer-statemachine ^1.2.2` — 状態機械AI基盤
- `minecraft-data ^3.65.0` — 全レシピ・アイテムデータ
- `node-minecraft-protocol ^1.47.0` — プロトコル実装
- `flying-squid ^1.5.3` (devDependencies) — テスト用MCサーバー

#### 新 npm スクリプト
- `npm run configure:survival` — サバイバルモード設定
- `npm run configure:farming` — 農業特化設定
- `npm run server:selfhost` — セルフホストサーバー管理
- `npm run server:selfhost:start/stop` — 起動/停止
- `npm run test:integration` — flying-squid 統合テスト

### 変更

- **`src/bot.js`**: 新モジュール (BranchMiningModule, ResourceGatheringModule, ArmorAnalyzer, RecipeAnalyzer) を統合
  - `spawn` イベントで全モジュールを自動初期化
  - `stopRuntimeLoops()` に全モジュールのクリーンアップを追加
  - `craftItem()` を RecipeAnalyzer に委譲 (フォールバックあり)
  - 新パブリックメソッド: `startBranchMining()`, `gatherResources()`, `autoEquipArmor()`
  - `status()` に stateMachine/farming/explorer/branchMining/resourceGathering/armorScore を追加

- **`package.json`**: バージョン `1.0.0` → `2.0.0`

- **`.github/workflows/release.yml`**: リリースワークフロー改善
  - package.json とタグのバージョン不一致でエラー終了 (warning から変更)
  - テスト実行ステップを追加
  - CHANGELOG 最新エントリを自動抽出してリリースノートに含める
  - macOS + Linux を同一アーカイブにまとめ、ファイル名を `-macos-linux-` に変更
  - Python ヒアドキュメントを外部スクリプト (`scripts/make-release-notes.py`) に分離
  - CRLF変換に `unix2dos` を使用

- **`README.md`**: 全面刷新
  - 新機能の詳細説明を追加
  - ブランチマイニング Y座標ガイド表を追加
  - 農業・水源・灌漑計画の説明を追加
  - 防具スコア計算式を明記
  - レシピ依存ツリーの例を追加
  - マルチサーバー・セルフホストサーバーの設定例を追加
  - PrismarineJS クレジットテーブルを追加

---

## [1.0.0] - 2026-03-15

### 追加

- Java/Bedrock 両対応の Mineflayer Bot 基盤
- ViaProxy 自動ダウンロード・管理
- チェスト/拠点/死亡地点の永続記憶 (lowdb)
- 自動採掘・自動保管・自動仕分け
- 建築モード (mineflayer-schem)
- PvP 戦闘 AI (装備切替・遠距離対応)
- Ollama LLM 日本語会話
- Web GUI ダッシュボード (Socket.IO + prismarine-viewer)
- マルチBot フリート管理・役割分担
- Bedrock サンプルデータ解析 (レシピ・ドロップテーブル)
- PM2 永続化対応
- ローカル Java サーバー自動セットアップ (Vanilla/Paper/Purpur/Fabric/Forge)
- GitHub Actions リリースワークフロー
