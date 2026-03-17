'use strict';
/**
 * explorerModule.js
 * 自動探索モジュール
 *
 * 機能:
 *  - 未探索チャンクへのランダム移動
 *  - 村・廃坑・砦などの構造物検出 & 記録
 *  - Point of Interest (POI) 記録（MemoryStore に保存）
 *  - ミニマップ的な探索済みエリアの管理
 *  - 村人取引の自動実行
 *  - ネザー/エンド行き用のポータル検出
 */

const { goals } = require('mineflayer-pathfinder');
const { logger } = require('./logger');
const { sleep }  = require('./utils');

// 注目ブロック（POI の手がかり）
const POI_BLOCKS = {
  village:     ['hay_block', 'bed', 'bell', 'lectern'],
  dungeon:     ['spawner', 'mossy_cobblestone'],
  mineshaft:   ['rail', 'oak_fence', 'chain'],
  stronghold:  ['end_portal_frame', 'infested_stone'],
  nether_fort: ['nether_brick', 'blaze_spawner'],
  temple:      ['chiseled_stone_bricks', 'tripwire_hook'],
  ocean_ruin:  ['sea_lantern', 'prismarine'],
  portal:      ['obsidian', 'nether_portal', 'end_portal'],
};

// 全 POIブロック のフラットリスト
const ALL_POI_BLOCKS = [...new Set(Object.values(POI_BLOCKS).flat())];

class ExplorerModule {
  /**
   * @param {object} bot       - mineflayer bot
   * @param {object} memStore  - MemoryStore インスタンス
   * @param {object} options
   * @param {number} options.stepDistance   - 一歩の移動距離 (デフォルト: 64)
   * @param {number} options.maxSteps       - 最大ステップ数 (デフォルト: 20)
   * @param {number} options.poiScanRadius  - POI スキャン半径 (デフォルト: 48)
   */
  constructor(bot, memStore, options = {}) {
    this.bot           = bot;
    this.memStore      = memStore;
    this.stepDistance  = options.stepDistance  || 64;
    this.maxSteps      = options.maxSteps      || 20;
    this.poiScanRadius = options.poiScanRadius || 48;
    this._visitedChunks = new Set(); // "cx,cz" 形式
    this._poiList       = [];        // { type, position, discoveredAt }
    this._running       = false;
  }

  // ── メイン探索ループ ────────────────────────────────────────────────────────
  async explore(steps = null) {
    if (this._running) {
      logger.info('[Explorer] 既に探索中');
      return;
    }
    this._running = true;
    const maxSteps = steps || this.maxSteps;
    logger.info(`[Explorer] 探索開始 (最大 ${maxSteps} ステップ)`);

    try {
      for (let i = 0; i < maxSteps; i++) {
        if (!this._running) break;

        // 次の目的地を決定
        const target = this._nextTarget();
        logger.info(`[Explorer] ステップ ${i + 1}/${maxSteps} → (${target.x}, ${target.y}, ${target.z})`);

        // 移動
        await this._moveTo(target);
        await sleep(500);

        // 現在チャンクを記録
        this._markVisited(this.bot.entity.position);

        // POI スキャン
        const pois = await this._scanForPOI();
        if (pois.length > 0) {
          logger.info(`[Explorer] POI 発見: ${pois.map(p => p.type).join(', ')}`);
        }
      }
    } catch (e) {
      logger.warn(`[Explorer] 探索エラー: ${e.message}`);
    } finally {
      this._running = false;
      logger.info('[Explorer] 探索完了');
    }
  }

  stop() {
    this._running = false;
  }

  // ── 次の目的地を計算 ────────────────────────────────────────────────────────
  _nextTarget() {
    const pos = this.bot.entity.position;
    // 未訪問方向を優先
    const angle = this._getUnvisitedAngle(pos);
    const dist  = this.stepDistance * (0.8 + Math.random() * 0.4);
    return {
      x: Math.round(pos.x + Math.cos(angle) * dist),
      y: pos.y, // Y は pathfinder が調整
      z: Math.round(pos.z + Math.sin(angle) * dist),
    };
  }

  _getUnvisitedAngle(pos) {
    // 8方向を試して最も未訪問の方向を選ぶ
    let bestAngle = Math.random() * Math.PI * 2;
    let maxUnvisited = 0;

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      let unvisited = 0;
      for (let step = 1; step <= 3; step++) {
        const cx = Math.floor((pos.x + Math.cos(angle) * this.stepDistance * step) / 16);
        const cz = Math.floor((pos.z + Math.sin(angle) * this.stepDistance * step) / 16);
        if (!this._visitedChunks.has(`${cx},${cz}`)) unvisited++;
      }
      if (unvisited > maxUnvisited) {
        maxUnvisited = unvisited;
        bestAngle = angle;
      }
    }
    return bestAngle;
  }

  _markVisited(pos) {
    const cx = Math.floor(pos.x / 16);
    const cz = Math.floor(pos.z / 16);
    this._visitedChunks.add(`${cx},${cz}`);
  }

  // ── POI スキャン ────────────────────────────────────────────────────────────
  async _scanForPOI() {
    const found = [];
    const pos = this.bot.entity.position;

    for (const blockName of ALL_POI_BLOCKS) {
      const blockType = this.bot.registry?.blocksByName?.[blockName];
      if (!blockType) continue;

      const blocks = this.bot.findBlocks({
        matching: blockName,
        maxDistance: this.poiScanRadius,
        count: 3,
      });

      if (blocks.length > 0) {
        const type = this._identifyPOIType(blockName);
        const key  = `${type}@${Math.round(pos.x / 64)},${Math.round(pos.z / 64)}`;

        // 重複チェック
        if (!this._poiList.find(p => p.key === key)) {
          const poi = {
            key,
            type,
            position:      { x: blocks[0].x, y: blocks[0].y, z: blocks[0].z },
            discoveredAt:  new Date().toISOString(),
            blockEvidence: blockName,
          };
          this._poiList.push(poi);
          found.push(poi);

          // MemoryStore に保存（拠点として記録）
          try {
            await this.memStore.addBase(type, blocks[0], `自動探索で発見 (${blockName})`);
          } catch (e) {
            logger.debug(`[Explorer] POI 保存失敗: ${e.message}`);
          }
        }
      }
    }
    return found;
  }

  _identifyPOIType(blockName) {
    for (const [type, blocks] of Object.entries(POI_BLOCKS)) {
      if (blocks.includes(blockName)) return type;
    }
    return 'unknown';
  }

  // ── 村人取引 ───────────────────────────────────────────────────────────────
  async tradeWithVillagers(wantItem = null) {
    const villagers = Object.values(this.bot.entities || {}).filter(e =>
      e.name?.toLowerCase() === 'villager' &&
      e.position.distanceTo(this.bot.entity.position) < 16
    );

    if (villagers.length === 0) {
      logger.info('[Explorer] 近くに村人が見つかりません');
      return false;
    }

    for (const villager of villagers) {
      try {
        await this._gotoEntity(villager);
        const window = await this.bot.openVillager(villager);
        logger.info(`[Explorer] 村人と取引ウィンドウを開きました (取引数: ${window.trades?.length || 0})`);

        if (wantItem && window.trades) {
          for (const trade of window.trades) {
            const output = trade.outputs?.[0];
            if (output?.name === wantItem) {
              // 取引実行（素材があれば）
              const input1 = trade.inputs?.[0];
              const has = this.bot.inventory.items().find(i =>
                i.name === input1?.name && i.count >= (input1?.count || 1)
              );
              if (has) {
                await window.trade(trade.index ?? 0, 1);
                logger.info(`[Explorer] 取引成功: ${wantItem}`);
              }
            }
          }
        }
        window.close();
        return true;
      } catch (e) {
        logger.debug(`[Explorer] 村人取引失敗: ${e.message}`);
      }
    }
    return false;
  }

  // ── 移動ヘルパー ───────────────────────────────────────────────────────────
  async _moveTo(target) {
    if (!this.bot.pathfinder) {
      logger.warn('[Explorer] pathfinder が利用できません');
      return;
    }
    const goal = new goals.GoalNear(target.x, target.y, target.z, 8);
    try {
      await this.bot.pathfinder.goto(goal);
    } catch (e) {
      // 到達できなくても続行
      logger.debug(`[Explorer] 移動失敗（スキップ）: ${e.message}`);
    }
  }

  async _gotoEntity(entity) {
    if (!this.bot.pathfinder || !entity?.position) return;
    const p = entity.position;
    await this.bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2));
  }

  // ── ステータス ─────────────────────────────────────────────────────────────
  getStatus() {
    return {
      running:         this._running,
      visitedChunks:   this._visitedChunks.size,
      discoveredPOIs:  this._poiList.length,
      pois:            this._poiList.slice(-10),
    };
  }

  getPOIList() {
    return [...this._poiList];
  }
}

module.exports = { ExplorerModule, POI_BLOCKS };
