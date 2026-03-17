'use strict';
/**
 * resourceGatheringModule.js
 * リソース収集モジュール
 *
 * 機能:
 *  - 収集プランの実行（複数リソースを一括処理）
 *  - 各種収集戦略:
 *    mine     : branchMiningModule または collectblock で採掘
 *    chop     : 木を伐採して苗を再植
 *    kill     : 特定モブを狩って素材を入手
 *    farm     : farmingModule で作物を収穫
 *    craft    : recipeAnalyzer でクラフト
 *    trade    : ヴィレジャーと取引
 *    loot_chest: 構造物のチェストを漁る
 *  - 優先キュー（依存関係順にソート）
 *  - 進捗追跡と残り時間推定
 *  - プライマリ戦略失敗時の代替戦略へのフォールバック
 *  - リソースプリセット定義
 *
 * プリセット:
 *  PRESET_STARTER_KIT  : 木・石ツール・食料・シェルター素材
 *  PRESET_IRON_KIT     : 鉄ツールと防具素材
 *  PRESET_DIAMOND_KIT  : ダイヤモンド採集素材
 *  PRESET_FARM_SETUP   : 農場設置用資材
 */

const { goals } = require('mineflayer-pathfinder');
const { logger } = require('./logger');
const { sleep }  = require('./utils');

// ── リソースプリセット定義 ─────────────────────────────────────────────────
// 各エントリ: { resource: アイテム名, count: 必要数, strategy: 戦略名 }

/** スターターキット: 木材・基本ツール・食料・シェルター */
const PRESET_STARTER_KIT = [
  { resource: 'oak_log',    count: 32, strategy: 'chop'  },
  { resource: 'cobblestone',count: 64, strategy: 'mine'  },
  { resource: 'bread',      count: 16, strategy: 'craft' },
  { resource: 'oak_planks', count: 32, strategy: 'craft' },
];

/** 鉄キット: 鉄ツールと防具製造素材 */
const PRESET_IRON_KIT = [
  { resource: 'iron_ore',    count: 32, strategy: 'mine'  },
  { resource: 'coal',        count: 16, strategy: 'mine'  },
  { resource: 'cobblestone', count: 32, strategy: 'mine'  },
  { resource: 'oak_log',     count: 16, strategy: 'chop'  },
];

/** ダイヤモンドキット: ダイヤ採集に必要な資材 */
const PRESET_DIAMOND_KIT = [
  { resource: 'iron_pickaxe', count: 3,  strategy: 'craft' },
  { resource: 'torch',        count: 64, strategy: 'craft' },
  { resource: 'cobblestone',  count: 32, strategy: 'mine'  },
  { resource: 'coal',         count: 32, strategy: 'mine'  },
];

/** 農場設置キット: 農場運営に必要な資材 */
const PRESET_FARM_SETUP = [
  { resource: 'wheat_seeds',  count: 32, strategy: 'farm'  },
  { resource: 'water_bucket', count: 4,  strategy: 'mine'  },
  { resource: 'oak_log',      count: 16, strategy: 'chop'  },
  { resource: 'iron_hoe',     count: 1,  strategy: 'craft' },
];

// ── 戦略フォールバック定義 ─────────────────────────────────────────────────
// プライマリ戦略が失敗した場合、次の戦略を試みる
const STRATEGY_FALLBACKS = {
  mine:       ['loot_chest', 'craft'],
  chop:       ['loot_chest', 'craft'],
  kill:       ['loot_chest'],
  farm:       ['loot_chest', 'trade'],
  craft:      ['trade', 'loot_chest'],
  trade:      ['loot_chest', 'craft'],
  loot_chest: [],
};

// ── よく使うブロック/モブのリソースマッピング ──────────────────────────────
// キー: リソース名, 値: { source: ブロック/モブ名, strategy }
const RESOURCE_SOURCE_MAP = {
  oak_log:      { source: 'oak_log',      strategy: 'chop'  },
  birch_log:    { source: 'birch_log',    strategy: 'chop'  },
  coal:         { source: 'coal_ore',     strategy: 'mine'  },
  iron_ore:     { source: 'iron_ore',     strategy: 'mine'  },
  diamond:      { source: 'diamond_ore',  strategy: 'mine'  },
  cobblestone:  { source: 'stone',        strategy: 'mine'  },
  gravel:       { source: 'gravel',       strategy: 'mine'  },
  sand:         { source: 'sand',         strategy: 'mine'  },
  beef:         { source: 'cow',          strategy: 'kill'  },
  leather:      { source: 'cow',          strategy: 'kill'  },
  pork:         { source: 'pig',          strategy: 'kill'  },
  feather:      { source: 'chicken',      strategy: 'kill'  },
  wool:         { source: 'sheep',        strategy: 'kill'  },
  wheat:        { source: 'wheat',        strategy: 'farm'  },
  carrot:       { source: 'carrots',      strategy: 'farm'  },
  potato:       { source: 'potatoes',     strategy: 'farm'  },
};

class ResourceGatheringModule {
  /**
   * @param {object} bot              - mineflayer bot インスタンス
   * @param {object} memStore         - MemoryStore インスタンス
   * @param {object} modules          - 他モジュールへの参照
   * @param {object} modules.farming  - FarmingModule インスタンス
   * @param {object} modules.mining   - BranchMiningModule インスタンス
   * @param {object} modules.recipes  - RecipeAnalyzer インスタンス
   */
  constructor(bot, memStore, modules = {}) {
    this.bot       = bot;
    this.memStore  = memStore;

    // 他モジュールへの参照（後から設定可能）
    this.farmingModule   = modules.farming  || null;
    this.miningModule    = modules.mining   || null;
    this.recipeAnalyzer  = modules.recipes  || null;

    // ── 実行状態 ──────────────────────────────────────────────────────────
    this._running       = false;
    this._currentTask   = null;  // 現在実行中のタスク
    this._queue         = [];    // 待機タスクキュー

    // ── 統計情報 ──────────────────────────────────────────────────────────
    this._stats = {
      tasksCompleted:  0,
      tasksFailed:     0,
      itemsGathered:   {},  // アイテム別収集数
      startTime:       null,
    };
  }

  // ── パブリック API ─────────────────────────────────────────────────────────

  /**
   * 指定リソースを指定数収集する
   * @param {string} resourceName - 収集するリソース名
   * @param {number} count        - 必要数
   * @param {object} options      - オプション
   * @param {string} options.strategy - 収集戦略 ('mine'|'chop'|'kill'|'farm'|'craft'|'trade'|'loot_chest')
   * @returns {object} 収集結果
   */
  async gatherResources(resourceName, count = 1, options = {}) {
    if (this._running) {
      logger.warn('[ResourceGathering] 既に収集中です');
      return { ok: false, reason: 'already-running' };
    }

    this._running = true;
    this._stats.startTime = Date.now();

    const strategy = options.strategy || this._guessStrategy(resourceName);
    const task = { resource: resourceName, count, strategy };

    logger.info(`[ResourceGathering] 収集開始: ${resourceName} x${count} (戦略: ${strategy})`);

    try {
      const result = await this._executeTask(task);
      this._stats.tasksCompleted++;
      return result;
    } catch (e) {
      this._stats.tasksFailed++;
      logger.warn(`[ResourceGathering] 収集失敗 (${resourceName}): ${e.message}`);
      return { ok: false, reason: e.message, resource: resourceName };
    } finally {
      this._running = false;
      this._currentTask = null;
    }
  }

  /**
   * 複数リソースの収集プランを一括実行する
   * 依存関係を考慮して順番にソートして実行する
   * @param {Array} plan - [{resource, count, strategy}] の配列
   * @returns {object} 収集結果サマリー
   */
  async gatherAll(plan) {
    if (this._running) {
      return { ok: false, reason: 'already-running' };
    }

    if (!Array.isArray(plan) || plan.length === 0) {
      return { ok: false, reason: 'empty-plan' };
    }

    this._running = true;
    this._stats.startTime = Date.now();

    // 依存関係を考慮してタスクをソート
    const sortedPlan = this._sortByDependency(plan);
    const results    = [];

    logger.info(`[ResourceGathering] 収集プラン実行: ${sortedPlan.length} タスク`);

    for (const task of sortedPlan) {
      if (!this._running) break;

      logger.info(`[ResourceGathering] タスク実行: ${task.resource} x${task.count}`);

      try {
        const result = await this._executeTask(task);
        results.push({ ...task, result, ok: result.ok });

        if (result.ok) {
          this._stats.tasksCompleted++;
        } else {
          this._stats.tasksFailed++;
          logger.warn(`[ResourceGathering] タスク失敗: ${task.resource}`);
        }
      } catch (e) {
        this._stats.tasksFailed++;
        results.push({ ...task, result: { ok: false, reason: e.message }, ok: false });
      }

      await sleep(500);
    }

    this._running = false;
    const succeeded = results.filter(r => r.ok).length;

    logger.info(`[ResourceGathering] プラン完了: ${succeeded}/${results.length} 成功`);
    return {
      ok:       succeeded === results.length,
      total:    results.length,
      succeeded,
      failed:   results.length - succeeded,
      results,
    };
  }

  /**
   * 目標アイテムを達成するための収集プランを自動生成する
   * recipeAnalyzer が利用可能な場合はクラフトツリーから生成する
   * @param {string|object} goal - 目標アイテム名または {item, count}
   * @returns {Array} 収集プラン
   */
  getGatheringPlan(goal) {
    const goalItem  = typeof goal === 'string' ? goal : goal.item;
    const goalCount = typeof goal === 'object' ? (goal.count || 1) : 1;
    const plan      = [];

    // recipeAnalyzer があれば依存ツリーから生成
    if (this.recipeAnalyzer) {
      const craftPlan = this.recipeAnalyzer.getCraftingPlan(goalItem, goalCount);

      for (const needed of craftPlan.needed) {
        const strategy = this._guessStrategy(needed.name);
        plan.push({ resource: needed.name, count: needed.count, strategy });
      }

      // クラフトステップを追加（素材が揃ったらクラフトする）
      for (const step of craftPlan.steps) {
        if (step.action !== 'smelting' && step.action !== 'smithing') {
          plan.push({ resource: step.output, count: step.count, strategy: 'craft' });
        }
      }
    } else {
      // recipeAnalyzer がない場合は直接採集を試みる
      const strategy = this._guessStrategy(goalItem);
      plan.push({ resource: goalItem, count: goalCount, strategy });
    }

    return plan;
  }

  /**
   * 現在の収集状態を返す
   * @returns {object}
   */
  getStatus() {
    const elapsed = this._stats.startTime
      ? Math.floor((Date.now() - this._stats.startTime) / 1000)
      : 0;

    return {
      running:        this._running,
      currentTask:    this._currentTask,
      queueLength:    this._queue.length,
      stats:          { ...this._stats },
      elapsedSeconds: elapsed,
    };
  }

  // ── 収集戦略の実装 ─────────────────────────────────────────────────────────

  /**
   * タスクを実行し、失敗時はフォールバック戦略を試みる
   * @param {object} task - {resource, count, strategy}
   * @returns {object} 結果
   */
  async _executeTask(task) {
    this._currentTask = task;

    const strategies = [task.strategy, ...(STRATEGY_FALLBACKS[task.strategy] || [])];

    for (const strategy of strategies) {
      logger.debug(`[ResourceGathering] 戦略試行: ${strategy} for ${task.resource}`);

      try {
        const result = await this._runStrategy(strategy, task.resource, task.count);
        if (result.ok) return result;

        logger.debug(`[ResourceGathering] 戦略失敗 (${strategy}): ${result.reason}`);
      } catch (e) {
        logger.debug(`[ResourceGathering] 戦略エラー (${strategy}): ${e.message}`);
      }
    }

    return { ok: false, reason: 'all-strategies-failed', resource: task.resource };
  }

  /**
   * 指定戦略でリソースを収集する
   * @param {string} strategy - 戦略名
   * @param {string} resource - リソース名
   * @param {number} count    - 必要数
   * @returns {object}
   */
  async _runStrategy(strategy, resource, count) {
    switch (strategy) {
      case 'mine':       return await this._strategyMine(resource, count);
      case 'chop':       return await this._strategyChop(resource, count);
      case 'kill':       return await this._strategyKill(resource, count);
      case 'farm':       return await this._strategyFarm(resource, count);
      case 'craft':      return await this._strategyCraft(resource, count);
      case 'trade':      return await this._strategyTrade(resource, count);
      case 'loot_chest': return await this._strategyLootChest(resource, count);
      default:
        return { ok: false, reason: `unknown-strategy: ${strategy}` };
    }
  }

  // ── 戦略: 採掘 ─────────────────────────────────────────────────────────────
  /**
   * ブロックを採掘してリソースを収集する
   * collectblock プラグインを優先使用、なければ直接掘削
   */
  async _strategyMine(resource, count) {
    const sourceInfo = RESOURCE_SOURCE_MAP[resource];
    const blockName  = sourceInfo?.source || resource;

    // 既にインベントリに十分ある場合はスキップ
    const have = this._countInInventory(resource);
    if (have >= count) {
      return { ok: true, resource, collected: have, skipped: true };
    }

    const needed = count - have;

    // collectblock プラグインがあれば使用
    if (this.bot.collectBlock) {
      try {
        const blocks = this.bot.findBlocks({
          matching: (b) => b.name === blockName,
          maxDistance: 32,
          count: Math.min(needed * 2, 64),
        });

        if (blocks.length === 0) {
          return { ok: false, reason: 'no-blocks-found', resource };
        }

        const blockObjects = blocks.map(pos => this.bot.blockAt(pos)).filter(Boolean);
        await this.bot.collectBlock.collect(blockObjects);

        const newHave = this._countInInventory(resource);
        this._updateStats(resource, newHave - have);
        return { ok: newHave - have >= needed, resource, collected: newHave - have };
      } catch (e) {
        logger.debug(`[ResourceGathering] collectblock 失敗: ${e.message}`);
      }
    }

    // branchMiningModule がある場合は採掘
    if (this.miningModule) {
      try {
        await this.miningModule.startBranchMining({
          targetOres:       [blockName],
          mainTunnelLength: Math.min(needed * 2, 32),
        });

        const newHave = this._countInInventory(resource);
        this._updateStats(resource, newHave - have);
        return { ok: newHave >= count, resource, collected: newHave - have };
      } catch (e) {
        logger.debug(`[ResourceGathering] branchMining 失敗: ${e.message}`);
      }
    }

    // 単純な近くのブロックを掘る
    return await this._simpleCollect(blockName, resource, needed);
  }

  // ── 戦略: 伐採 ─────────────────────────────────────────────────────────────
  /**
   * 近くの木を伐採してログを収集し、苗を再植する
   */
  async _strategyChop(resource, count) {
    const have = this._countInInventory(resource);
    if (have >= count) return { ok: true, resource, collected: have, skipped: true };

    const needed = count - have;

    // 木のブロック名を推定（oak_log → oak_log など）
    const logTypes = [
      'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
      'acacia_log', 'dark_oak_log', 'mangrove_log',
    ];
    const targetLog = logTypes.includes(resource) ? resource : 'oak_log';

    let collected = 0;
    let saplingPos = null;

    // 木を探す
    const logBlocks = this.bot.findBlocks({
      matching: (b) => logTypes.includes(b.name),
      maxDistance: 32,
      count: Math.min(needed * 4, 32),
    });

    if (logBlocks.length === 0) {
      return { ok: false, reason: 'no-trees-found', resource };
    }

    for (const pos of logBlocks) {
      if (collected >= needed) break;

      const block = this.bot.blockAt(pos);
      if (!block) continue;

      try {
        // 木の根元（Y 方向で最も低い同種ブロック）を見つける
        const rootPos = this._findTreeRoot(pos, block.name);
        if (!rootPos) continue;

        // 苗位置を記録
        saplingPos = { x: rootPos.x, y: rootPos.y, z: rootPos.z };

        // 木を登りながら全て伐採
        const chopCount = await this._chopTree(pos, block.name);
        collected += chopCount;

        await sleep(200);
      } catch (e) {
        logger.debug(`[ResourceGathering] 伐採失敗: ${e.message}`);
      }
    }

    // 苗を再植する
    if (saplingPos) {
      await this._replantSapling(saplingPos, targetLog);
    }

    const newHave = this._countInInventory(resource);
    this._updateStats(resource, newHave - have);
    return { ok: newHave >= count, resource, collected: newHave - have };
  }

  /**
   * 木を根元から全て伐採する
   * @param {Vec3} startPos - 開始位置
   * @param {string} logName - ログブロック名
   * @returns {number} 伐採したブロック数
   */
  async _chopTree(startPos, logName) {
    const visited  = new Set();
    const toChop   = [startPos];
    let   count    = 0;
    const maxBlocks = 64;

    while (toChop.length > 0 && count < maxBlocks) {
      const pos = toChop.shift();
      const key = `${pos.x},${pos.y},${pos.z}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const block = this.bot.blockAt(pos);
      if (!block || block.name !== logName) continue;

      try {
        if (this.bot.pathfinder) {
          const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 3);
          await this.bot.pathfinder.goto(goal);
        }
        await this.bot.dig(block);
        count++;
        await sleep(100);

        // 上方向を優先して追加
        const up = pos.offset(0, 1, 0);
        const upBlock = this.bot.blockAt(up);
        if (upBlock?.name === logName) toChop.unshift(up);

        // 隣接ブロックも追加（幹や葉で隠れている場合）
        for (const n of [pos.offset(1,0,0), pos.offset(-1,0,0), pos.offset(0,0,1), pos.offset(0,0,-1)]) {
          const nb = this.bot.blockAt(n);
          if (nb?.name === logName) toChop.push(n);
        }
      } catch (e) {
        logger.debug(`[ResourceGathering] ブロック伐採失敗: ${e.message}`);
      }
    }

    return count;
  }

  /**
   * 木の根元位置を探す（伐採開始位置 → Y を下げて同種ブロックを探す）
   */
  _findTreeRoot(pos, logName) {
    let current = pos;
    for (let dy = 0; dy >= -5; dy--) {
      const below = current.offset(0, -1, 0);
      const b     = this.bot.blockAt(below);
      if (b?.name !== logName) return current;
      current = below;
    }
    return current;
  }

  /**
   * 苗を再植する
   */
  async _replantSapling(pos, logName) {
    // ログ名から苗名を推定
    const saplingMap = {
      oak_log:      'oak_sapling',
      birch_log:    'birch_sapling',
      spruce_log:   'spruce_sapling',
      jungle_log:   'jungle_sapling',
      acacia_log:   'acacia_sapling',
      dark_oak_log: 'dark_oak_sapling',
    };
    const saplingName = saplingMap[logName] || 'oak_sapling';
    const sapling = this.bot.inventory.items().find(i => i.name === saplingName);
    if (!sapling) return;

    try {
      const ground = this.bot.blockAt({ x: pos.x, y: pos.y - 1, z: pos.z });
      if (!ground?.isSolid) return;
      if (this.bot.pathfinder) {
        const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 2);
        await this.bot.pathfinder.goto(goal);
      }
      await this.bot.equip(sapling, 'hand');
      await this.bot.placeBlock(ground, { x: 0, y: 1, z: 0 });
      logger.debug(`[ResourceGathering] 苗を再植: ${saplingName}`);
    } catch (e) {
      logger.debug(`[ResourceGathering] 苗再植失敗: ${e.message}`);
    }
  }

  // ── 戦略: モブ討伐 ─────────────────────────────────────────────────────────
  /**
   * 指定モブを倒してドロップアイテムを収集する
   */
  async _strategyKill(resource, count) {
    const have = this._countInInventory(resource);
    if (have >= count) return { ok: true, resource, collected: have, skipped: true };

    // モブ名を推定
    const mobMap = {
      beef: 'cow', leather: 'cow', pork: 'pig',
      chicken: 'chicken', feather: 'chicken',
      mutton: 'sheep', wool: 'sheep',
      bone: 'skeleton', arrow: 'skeleton',
      rotten_flesh: 'zombie', gunpowder: 'creeper',
      string: 'spider', spider_eye: 'spider',
    };
    const mobName = mobMap[resource] || resource;

    // 近くの対象モブを探す
    const mob = Object.values(this.bot.entities || {}).find(e =>
      e.name?.toLowerCase() === mobName &&
      e.position?.distanceTo(this.bot.entity.position) < 32
    );

    if (!mob) {
      return { ok: false, reason: `no-${mobName}-found`, resource };
    }

    try {
      // 近づいて攻撃
      if (this.bot.pathfinder) {
        const goal = new goals.GoalNear(mob.position.x, mob.position.y, mob.position.z, 2);
        await this.bot.pathfinder.goto(goal);
      }

      // 最良の武器を装備
      const sword = this.bot.inventory.items().find(i => i.name.includes('_sword'));
      if (sword) await this.bot.equip(sword, 'hand');

      this.bot.attack(mob);
      await sleep(1000); // 倒れるまで待つ（簡略化）

      const newHave = this._countInInventory(resource);
      this._updateStats(resource, newHave - have);
      return { ok: newHave > have, resource, collected: newHave - have };
    } catch (e) {
      return { ok: false, reason: e.message, resource };
    }
  }

  // ── 戦略: 農業 ────────────────────────────────────────────────────────────
  /**
   * farmingModule を使用して作物を収穫する
   */
  async _strategyFarm(resource, count) {
    const have = this._countInInventory(resource);
    if (have >= count) return { ok: true, resource, collected: have, skipped: true };

    if (!this.farmingModule) {
      return { ok: false, reason: 'farming-module-unavailable', resource };
    }

    try {
      const harvested = await this.farmingModule.harvestAll();
      const newHave   = this._countInInventory(resource);
      this._updateStats(resource, newHave - have);
      return { ok: newHave >= count, resource, collected: newHave - have, harvested };
    } catch (e) {
      return { ok: false, reason: e.message, resource };
    }
  }

  // ── 戦略: クラフト ────────────────────────────────────────────────────────
  /**
   * recipeAnalyzer を使用してアイテムをクラフトする
   */
  async _strategyCraft(resource, count) {
    if (!this.recipeAnalyzer) {
      return { ok: false, reason: 'recipe-analyzer-unavailable', resource };
    }

    try {
      const result = await this.recipeAnalyzer.craftItem(resource, count);
      if (result.ok) {
        this._updateStats(resource, count);
      }
      return { ok: result.ok, resource, reason: result.reason, needed: result.needed };
    } catch (e) {
      return { ok: false, reason: e.message, resource };
    }
  }

  // ── 戦略: 取引 ────────────────────────────────────────────────────────────
  /**
   * 近くのヴィレジャーと取引してアイテムを入手する（簡略実装）
   */
  async _strategyTrade(resource, count) {
    const villager = Object.values(this.bot.entities || {}).find(e =>
      e.name?.toLowerCase() === 'villager' &&
      e.position?.distanceTo(this.bot.entity.position) < 24
    );

    if (!villager) {
      return { ok: false, reason: 'no-villager-found', resource };
    }

    try {
      if (this.bot.pathfinder) {
        const goal = new goals.GoalNear(
          villager.position.x, villager.position.y, villager.position.z, 2
        );
        await this.bot.pathfinder.goto(goal);
      }

      // ヴィレジャーを右クリックして取引画面を開く
      await this.bot.activateEntity(villager);
      await sleep(500);

      const window = this.bot.currentWindow;
      if (!window) {
        return { ok: false, reason: 'could-not-open-trade', resource };
      }

      // 取引をスキャンして目的のアイテムを探す
      // 実際の取引ロジックはサーバー依存のため簡略化
      window.close?.();
      logger.info(`[ResourceGathering] ヴィレジャーとの取引画面を開きました (${resource})`);
      return { ok: false, reason: 'trade-not-implemented', resource };
    } catch (e) {
      return { ok: false, reason: e.message, resource };
    }
  }

  // ── 戦略: チェスト漁り ───────────────────────────────────────────────────
  /**
   * 近くのチェストを開いて指定アイテムを探す
   */
  async _strategyLootChest(resource, count) {
    const have = this._countInInventory(resource);
    if (have >= count) return { ok: true, resource, collected: have, skipped: true };

    const chestBlocks = this.bot.findBlocks({
      matching: (b) => b.name === 'chest' || b.name === 'trapped_chest' || b.name === 'barrel',
      maxDistance: 24,
      count: 10,
    });

    if (chestBlocks.length === 0) {
      return { ok: false, reason: 'no-chests-found', resource };
    }

    let looted = 0;

    for (const chestPos of chestBlocks) {
      if (looted >= count - have) break;

      try {
        if (this.bot.pathfinder) {
          const goal = new goals.GoalNear(chestPos.x, chestPos.y, chestPos.z, 2);
          await this.bot.pathfinder.goto(goal);
        }

        const chestBlock = this.bot.blockAt(chestPos);
        if (!chestBlock) continue;

        const chest = await this.bot.openContainer(chestBlock);
        await sleep(300);

        // チェスト内から目的アイテムを探す
        for (const item of (chest.containerItems?.() || [])) {
          if (item?.name === resource) {
            const take = Math.min(item.count, count - have - looted);
            try {
              await chest.withdraw(item.type, null, take);
              looted += take;
              await sleep(100);
            } catch { /* 個別エラーは無視 */ }
          }
          if (looted >= count - have) break;
        }

        chest.close();
        await sleep(200);
      } catch (e) {
        logger.debug(`[ResourceGathering] チェスト漁り失敗: ${e.message}`);
      }
    }

    this._updateStats(resource, looted);
    return { ok: looted > 0, resource, collected: looted };
  }

  // ── 単純収集（フォールバック） ────────────────────────────────────────────
  /**
   * 近くの指定ブロックを直接掘って収集する
   */
  async _simpleCollect(blockName, resource, count) {
    const blocks = this.bot.findBlocks({
      matching: (b) => b.name === blockName,
      maxDistance: 32,
      count: Math.min(count * 2, 32),
    });

    if (blocks.length === 0) {
      return { ok: false, reason: 'no-blocks-found', resource };
    }

    let collected = 0;
    const haveBefore = this._countInInventory(resource);

    for (const pos of blocks) {
      if (collected >= count) break;

      const block = this.bot.blockAt(pos);
      if (!block) continue;

      try {
        if (this.bot.pathfinder) {
          const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 2);
          await this.bot.pathfinder.goto(goal);
        }
        await this.bot.dig(block);
        collected++;
        await sleep(150);
      } catch (e) {
        logger.debug(`[ResourceGathering] 収集失敗: ${e.message}`);
      }
    }

    const haveAfter = this._countInInventory(resource);
    this._updateStats(resource, haveAfter - haveBefore);
    return { ok: haveAfter - haveBefore >= count, resource, collected: haveAfter - haveBefore };
  }

  // ── ヘルパーメソッド ──────────────────────────────────────────────────────

  /**
   * リソース名から適切な収集戦略を推定する
   * @param {string} resource - リソース名
   * @returns {string} 戦略名
   */
  _guessStrategy(resource) {
    if (RESOURCE_SOURCE_MAP[resource]) {
      return RESOURCE_SOURCE_MAP[resource].strategy;
    }
    if (resource.includes('_log') || resource.includes('_wood')) return 'chop';
    if (resource.includes('_ore') || resource.includes('stone') ||
        resource.includes('gravel') || resource.includes('sand')) return 'mine';
    if (resource.includes('wheat') || resource.includes('carrot') ||
        resource.includes('potato') || resource.includes('beetroot')) return 'farm';

    // クラフト可能かチェック
    if (this.recipeAnalyzer?.getRecipe(resource)?.length > 0) return 'craft';

    return 'mine';
  }

  /**
   * クラフト依存関係を考慮してタスクをソートする
   * craft タスクを後ろ（依存先の素材収集タスクを先）にする
   * @param {Array} plan - プランの配列
   * @returns {Array} ソート済みプラン
   */
  _sortByDependency(plan) {
    // 戦略の優先順位: mine/chop/kill/farm/loot_chest は先、craft/trade は後
    const order = { mine: 0, chop: 0, kill: 1, farm: 1, loot_chest: 2, trade: 3, craft: 4 };
    return [...plan].sort((a, b) => {
      const oa = order[a.strategy] ?? 5;
      const ob = order[b.strategy] ?? 5;
      return oa - ob;
    });
  }

  /**
   * インベントリ内の指定アイテムの個数を返す
   * @param {string} itemName
   * @returns {number}
   */
  _countInInventory(itemName) {
    return (this.bot.inventory?.items() || [])
      .filter(i => i.name === itemName)
      .reduce((sum, i) => sum + i.count, 0);
  }

  /**
   * 統計情報を更新する
   * @param {string} resource - リソース名
   * @param {number} amount   - 収集した個数
   */
  _updateStats(resource, amount) {
    if (amount <= 0) return;
    this._stats.itemsGathered[resource] =
      (this._stats.itemsGathered[resource] || 0) + amount;
  }
}

module.exports = {
  ResourceGatheringModule,
  PRESET_STARTER_KIT,
  PRESET_IRON_KIT,
  PRESET_DIAMOND_KIT,
  PRESET_FARM_SETUP,
  RESOURCE_SOURCE_MAP,
};
