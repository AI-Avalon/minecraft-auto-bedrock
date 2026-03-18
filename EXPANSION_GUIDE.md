# Minecraft Auto Bedrock v2.0 - 拡張機能マニュアル

## 目次
- [新機能概要](#新機能概要)
- [Litematica統合](#litematica統合)
- [親子ボット指示システム](#親子ボット指示システム)
- [プリセット管理](#プリセット管理)
- [統合建築ワークフロー](#統合建築ワークフロー)
- [テスト実行](#テスト実行)
- [GUI操作ガイド](#gui操作ガイド)
- [トラブルシューティング](#トラブルシューティング)

---

## 新機能概要

### 実装された機能
✓ **Litematica Schematicsサポート** - `.lit`ファイル読み込み  
✓ **タスクオーケストレーション** - 親ボットが子ボットに指示を出す  
✓ **統合建築管理** - 材料採掘～クラフト～建築の完全自動化  
✓ **プリセットシステム** - 建築、採掘、クラフト、農業のプリセット  
✓ **マルチボット対応** - 複数ボットの並列実行  
✓ **Windows/Mac対応テスト** - 両OS向け統合テスト  

### 新規モジュール
- `src/litematicaLoader.js` - Litematica format loader
- `src/taskOrchestrator.js` - Bot command orchestration
- `src/presetManager.js` - Preset management system
- `src/integratedBuildingManager.js` - Complete workflow automation

---

## Litematica統合

### 基本的な使い方

#### 1. Litematicaファイルの読み込み

```javascript
const { LitematicaLoader } = require('./src/litematicaLoader');

const loader = new LitematicaLoader();
const schematic = await loader.loadLitematicaFile('./schematics/my-building.litematic');

console.log('Width:', schematic.metadata.width);
console.log('Height:', schematic.metadata.height);
console.log('Length:', schematic.metadata.length);
```

#### 2. 材料の自動抽出

```javascript
const materials = await loader.extractMaterials('./schematics/my-building.litematic');

console.log('Required materials:');
for (const [blockType, count] of Object.entries(materials)) {
  console.log(`  ${blockType}: ${count}`);
}
// Output:
//   minecraft:oak_planks: 128
//   minecraft:stone: 256
//   minecraft:oak_log: 32
```

#### 3. ディレクトリからのバッチ読み込み

```javascript
const schematics = await loader.loadFromDirectory('./presets/schematics');

for (const item of schematics) {
  console.log(`Loaded: ${item.filename}`);
  console.log(`  Size: ${item.schematic.metadata.width}x${item.schematic.metadata.height}x${item.schematic.metadata.length}`);
}
```

---

## 親子ボット指示システム

### TaskOrchestrator の使い方

#### 1. 単一ボットへの命令

```javascript
const { TaskOrchestrator } = require('./src/taskOrchestrator');
const { FleetController } = require('./src/fleetController');

const fleet = new FleetController(botEntries);
const orchestrator = new TaskOrchestrator(fleet);

// 指定ボットに命令を発行
const result = await orchestrator.issueCommand(
  'workflow-1',                          // ワークフローID
  'miner-1',                             // 対象ボットID
  'collect-materials',                   // コマンド
  { materials: { 'minecraft:stone': 64 }} // パラメータ
);
```

#### 2. マルチボット並列実行

```javascript
const tasks = [
  { botId: 'bot1', command: 'auto-mine', params: { blockTypes: ['minecraft:diamond_ore'] } },
  { botId: 'bot2', command: 'auto-mine', params: { blockTypes: ['minecraft:gold_ore'] } },
  { botId: 'bot3', command: 'auto-mine', params: { blockTypes: ['minecraft:iron_ore'] } }
];

const results = await orchestrator.executeWorkflow(
  'mining-workflow-1',
  tasks,
  { serial: false, maxConcurrent: 3 }  // 並列実行
);
```

#### 3. 建築ワークフロー

```javascript
const botAssignments = [
  { botId: 'bot1', region: { x: 0, y: 0, z: 0, size: 16 } },
  { botId: 'bot2', region: { x: 16, y: 0, z: 0, size: 16 } }
];

const buildResults = await orchestrator.buildingWorkflow(
  'house-build-1',
  './schematics/simple-house.litematic',
  botAssignments
);
```

#### 4. 階層的タスク実行

```javascript
const taskTree = [
  {
    parentCommand: 'prepare-blocks',
    parentParams: { blockTypes: ['minecraft:oak_planks'] },
    childTasks: [
      { botId: 'worker1', command: 'auto-mine', params: { blockTypes: ['minecraft:oak_log'] } },
      { botId: 'worker2', command: 'auto-mine', params: { blockTypes: ['minecraft:oak_log'] } }
    ],
    maxChildConcurrency: 2
  }
];

await orchestrator.hierarchicalTaskExecution('complex-wf', taskTree);
```

---

## プリセット管理

### 使い方

#### 1. プリセットの初期化と読み込み

```javascript
const { PresetManager } = require('./src/presetManager');

const manager = new PresetManager();

// デフォルトプリセットを登録
manager.initializeDefaultPresets();

// ディスクから読み込み
manager.loadPresetsFromDisk();
```

#### 2. プリセット取得

```javascript
// 建築プリセット取得
const housePreset = manager.getPreset('building', 'simple-house');
console.log('Description:', housePreset.description);
console.log('Materials:', housePreset.materials);

// 採掘プリセット取得
const miningPreset = manager.getPreset('mining', 'branch-mining');
console.log('Block types:', miningPreset.blockTypes);
console.log('Target counts:', miningPreset.targetCounts);
```

#### 3. 全プリセット一覧

```javascript
const allPresets = manager.listAllPresets();

console.log('Building presets:', allPresets.building.length);
console.log('Mining presets:', allPresets.mining.length);
console.log('Crafting presets:', allPresets.crafting.length);
console.log('Workflow presets:', allPresets.workflow.length);
console.log('Farming presets:', allPresets.farming.length);
console.log('Exploration presets:', allPresets.exploration.length);
```

#### 4. カスタムプリセット作成

```javascript
// 建築プリセット
manager.registerBuildingPreset('my-tower', {
  description: 'My custom tower',
  schemPath: './schematics/my-tower.litematic',
  materials: {
    'minecraft:stone_bricks': 256,
    'minecraft:stone_stairs': 64,
    'minecraft:stone_slab': 32
  },
  difficulty: 'medium'
});

// 採掘プリセット
manager.registerMiningPreset('my-mining', {
  description: 'Custom mining pattern',
  blockTypes: ['minecraft:coal_ore', 'minecraft:iron_ore'],
  targetCounts: [128, 64],
  patterns: ['branch', 'branch'],
  difficulty: 'hard'
});
```

---

## 統合建築ワークフロー

### 完全な建築フロー（材料採掘～建築まで自動化）

#### 1. 準備

```javascript
const { IntegratedBuildingManager } = require('./src/integratedBuildingManager');
const buildingPlanner = require('./src/buildingPlanner');
const recipeAnalyzer = require('./src/recipeAnalyzer');

const manager = new IntegratedBuildingManager(
  fleetController,
  buildingPlanner,
  recipeAnalyzer,
  { logger: console }
);
```

#### 2. ワークフロー実行

```javascript
const workflow = await manager.executeCompleteWorkflow(
  './schematics/house.litematic',
  {
    botAssignments: ['bot1', 'bot2'],          // ボット割り当て
    gatherMode: 'auto-mine',                   // 採掘モード
    buildMode: 'efficient'                     // 建築モード
  }
);

console.log('Workflow created:');
console.log('  Required materials:', Object.keys(workflow.materials).length);
console.log('  Recipes:', workflow.recipes.length);
console.log('  Estimated time:', workflow.estimatedTime, 'minutes');
```

#### 3. ライブラリ処理

```javascript
// スキーマティックディレクトリ内の全ファイルを処理
const results = await manager.processBuildingLibrary('./presets/schematics', {
  botAssignments: ['bot1', 'bot2'],
  buildMode: 'efficient'
});

for (const item of results) {
  console.log(`${item.filename}: ${item.status}`);
  if (item.workflow) {
    console.log(`  Estimated: ${item.workflow.estimatedTime} min`);
  }
}
```

---

## テスト実行

### macOS / Linux

```bash
# 包括的テスト（推奨）
npm run test:comprehensive

# 全テスト実行
npm test

# GUIテスト
npm run test:gui

# E2Eテスト
npm run test:e2e
```

### Windows

```batch
# テストスクリプト実行
run-tests.bat full

# または個別実行
npm run test:comprehensive
```

### テスト結果

```
✔ [OS Compatibility] Correct OS detected
✔ [OS Compatibility] Node version >= 18
✔ [OS Compatibility] Path handling cross-platform
✔ [Litematica] LitematicaLoader instantiation
✔ [Litematica] Litematica file format validation
✔ [Litematica] Material extraction logic
✔ [TaskOrchestrator] Instantiation with FleetController
✔ [TaskOrchestrator] Command handler registration
✔ [TaskOrchestrator] Workflow execution with empty fleet
✔ [TaskOrchestrator] Command event emissions
✔ [PresetManager] Instantiation
✔ [PresetManager] Building preset registration
... (30 tests total)
```

---

## GUI操作ガイド

### 新GUIコマンド

#### Litematica関連
- **litematica-load** - `.lit`ファイルを読み込み
- **litematica-extract-materials** - 必要な材料を抽出

#### ワークフロー関連
- **execute-building-workflow** - Litematicaから建築ワークフローを実行
- **start-orchestrated-workflow** - タスク列を実行

#### プリセット関連
- **list-presets** - プリセット一覧を表示
- **execute-preset** - プリセットを実行

### GUIでの操作例

#### Litematicaファイルから建築

1. GUI の「建築」タブを開く
2. 「Litematicaファイルを読み込み」をクリック
3. `.litematic`ファイルを選択
4. 材料が自動抽出される
5. 「建築を開始」をクリック

#### プリセットで採掘

1. GUI の「採掘」タブを開く
2. 「プリセット一覧」から「branch-mining」を選択
3. ボットを割り当て
4. 「採掘を開始」をクリック

---

## トラブルシューティング

### Litematicaファイルが読み込めない

**症状**: ENOENT: no such file or directory

**原因**: ファイルパスが正しくない

**解決策**:
```javascript
// 相対パスではなく絶対パスを使用
const path = require('path');
const fullPath = path.join(process.cwd(), 'schematics/my-building.litematic');
const schematic = await loader.loadLitematicaFile(fullPath);
```

### マルチボットワークフローが実行されない

**症状**: タスクが実行されない

**原因**: FleetControllerにボットが登録されていない

**解決策**:
```javascript
// ボットエントリを確認
const status = fleet.statusAll();
console.log('Connected bots:', status.map(b => b.id));

if (status.length === 0) {
  throw new Error('No bots connected to fleet');
}
```

### テストが失敗する

**症状**: Node version や OS compatibility エラー

**解決策**: Node 18以上を使用
```bash
node --version  # v18.0.0 以上である確認
```

---

## パフォーマンスチューニング

### プリセット検索の最適化
```javascript
// キャッシュを使用
manager.loadPresetsFromDisk();  // 1回だけ実行
const preset = manager.getPreset('building', 'simple-house');  // 高速
```

### ワークフロー並列化
```javascript
// 採掘は並列、クラフトは順序実行
executeWorkflow(id, tasks, { serial: false, maxConcurrent: 5 });
```

### 材料抽出の効率化
```javascript
// 複数ファイルを一括処理
const results = await loader.loadFromDirectory('./schematics');
```

---

## API リファレンス

### LitematicaLoader
```javascript
loadLitematicaFile(filePath)          // ファイル読み込み
extractMaterials(filePath)             // 材料抽出
loadFromDirectory(directory)           // バッチ読み込み
```

### TaskOrchestrator
```javascript
issueCommand(workflowId, botId, command, params)
executeWorkflow(workflowId, tasks, options)
buildingWorkflow(workflowId, schemPath, botAssignments, options)
miningWorkflow(workflowId, blockTypes, targetCounts, bots, options)
craftingWorkflow(workflowId, recipes, targetCounts, options)
hierarchicalTaskExecution(workflowId, taskTree, parentBotId)
registerCommand(command, handler)
```

### PresetManager
```javascript
registerBuildingPreset(name, preset)
registerMiningPreset(name, preset)
registerCraftingPreset(name, preset)
registerWorkflowPreset(name, preset)
registerFarmingPreset(name, preset)
registerExplorationPreset(name, preset)
getPreset(category, name)
listPresets(category)
listAllPresets()
deletePreset(category, name)
loadPresetsFromDisk()
initializeDefaultPresets()
```

### IntegratedBuildingManager
```javascript
executeCompleteWorkflow(litematicaPath, options)
processBuildingLibrary(directory, options)
getAvailablePlans()
```

---

## よキューによくある質問

**Q: Windows で Litematica ファイルを読み込めません**  
A: `\` のエスケープに注意してください。`path.join()` を使用することを推奨します。

**Q: マルチボットで同時に事を実行できますか？**  
A: はい。`executeWorkflow()` で `serial: false` を指定してください。

**Q: プリセットをカスタマイズできますか？**  
A: はい。`registerBuildingPreset()` などで新しいプリセットを作成できます。

---

## 更新履歴

**v2.0.0** (2026-03-19)
- Litematica Schematics支援
- Task Orchestration無
- Preset Management システム
- 統合建築ワークフロー
- Windows/Mac 統合テスト

---

**Made with ❤️ for Minecraft automation**
