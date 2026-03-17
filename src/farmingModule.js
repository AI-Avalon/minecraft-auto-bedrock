'use strict';
/**
 * farmingModule.js
 * 自動農業モジュール（拡張版）
 *
 * 機能:
 *  - 農地スキャン（farmland ブロックを探す）
 *  - 成熟した作物の自動収穫
 *  - 種まき（wheat/carrot/potato/beetroot/melon/pumpkin）
 *  - 動物の繁殖（cow/sheep/pig/chicken/rabbit）
 *  - 収穫物の自動格納（近くのチェストへ）
 *  - farmland が少なければ耕し拡張
 *  - 水源の自動配置（最適ポジション計算）
 *  - 灌漑計画（必要水源数の計算）
 *  - 収穫後の自動再植付け
 *  - バケツで近くの水源から水を汲む
 */

const { goals } = require('mineflayer-pathfinder');
const { logger } = require('./logger');
const { sleep }  = require('./utils');

// ── 作物情報テーブル ────────────────────────────────────────────────────────
// seed: 植えるアイテム名, maxAge: 収穫可能な age 値
const CROP_INFO = {
  wheat:        { seed: 'wheat_seeds',    maxAge: 7 },
  carrots:      { seed: 'carrot',         maxAge: 7 },
  potatoes:     { seed: 'potato',         maxAge: 7 },
  beetroots:    { seed: 'beetroot_seeds', maxAge: 3 },
  melon_stem:   { seed: 'melon_seeds',    maxAge: 7 },
  pumpkin_stem: { seed: 'pumpkin_seeds',  maxAge: 7 },
  nether_wart:  { seed: 'nether_wart',    maxAge: 3 },
};

// ── 繁殖に使える食べ物テーブル ──────────────────────────────────────────────
const BREED_FOOD = {
  cow:     ['wheat'],
  sheep:   ['wheat'],
  pig:     ['carrot', 'potato', 'beetroot'],
  chicken: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds', 'beetroot_seeds'],
  rabbit:  ['dandelion', 'carrot', 'golden_carrot'],
  horse:   ['golden_apple', 'golden_carrot'],
  llama:   ['hay_block'],
};

// ── Minecraft 水和ルール ──────────────────────────────────────────────────────
// 水はマンハッタン距離 4 ブロック以内の farmland を湿らせる（同一 Y レベル ±1 まで）
const WATER_HYDRATION_RADIUS = 4;

class FarmingModule {
  /**
   * @param {object} bot        - mineflayer bot インスタンス
   * @param {object} memStore   - MemoryStore インスタンス
   * @param {object} options
   * @param {number}  options.scanRadius      - 農地スキャン半径 (デフォルト: 32)
   * @param {number}  options.breedRadius     - 動物繁殖スキャン半径 (デフォルト: 24)
   * @param {boolean} options.autoExpand      - 農地を自動拡張するか (デフォルト: false)
   * @param {boolean} options.autoWater       - 水源を自動設置するか (デフォルト: true)
   * @param {boolean} options.autoReplant     - 収穫後に自動再植付けするか (デフォルト: true)
   * @param {boolean} options.autoStoreToChest - 収穫物をチェストに格納するか (デフォルト: true)
   */
  constructor(bot, memStore, options = {}) {
    this.bot         = bot;
    this.memStore    = memStore;
    this.scanRadius  = options.scanRadius   || 32;
    this.breedRadius = options.breedRadius  || 24;
    this.autoExpand  = options.autoExpand   ?? false;
    this.autoWater   = options.autoWater    ?? true;
    this.autoReplant = options.autoReplant  ?? true;
    this.autoStoreToChest = options.autoStoreToChest ?? true;

    this._running = false;

    // 収穫した作物の記録（自動再植付けに使用）
    // キー: 座標文字列, 値: { cropName, seedItem }
    this._harvestLog = new Map();

    // 統計情報
    this._stats = {
      totalHarvested:  0,
      totalPlanted:    0,
      totalWaterPlaced: 0,
      cycleCount:      0,
    };
  }

  // ── メインサイクル ──────────────────────────────────────────────────────────
  /**
   * 農業サイクルを実行する
   * 収穫 → 再植付け → 拡張 → 繁殖 → 格納 の順に処理
   */
  async startCycle() {
    if (this._running) {
      logger.info('[Farming] 既に農業サイクル実行中');
      return;
    }
    this._running = true;
    this._stats.cycleCount++;
    logger.info(`[Farming] 農業サイクル開始 (${this._stats.cycleCount} 回目)`);

    try {
      // 1. 収穫（収穫位置を記録しておく）
      await this.harvestAll();
      await sleep(500);

      // 2. 自動再植付け（収穫ログを使って元の場所に植え直し）
      if (this.autoReplant) {
        await this.replantFromLog();
        await sleep(500);
      }

      // 3. 通常の種まき（空の farmland に対して）
      await this.plantAll();
      await sleep(500);

      // 4. 農地拡張（有効時）
      if (this.autoExpand) {
        await this.expandFarmland();
        await sleep(500);
      }

      // 5. 動物繁殖
      await this.breedAnimals();
      await sleep(500);

      // 6. チェストへ格納
      if (this.autoStoreToChest) {
        await this.storeHarvestInChest();
      }
    } catch (e) {
      logger.warn(`[Farming] サイクルエラー: ${e.message}`);
    } finally {
      this._running = false;
      logger.info('[Farming] 農業サイクル完了');
    }
  }

  // ── 収穫 ───────────────────────────────────────────────────────────────────
  /**
   * 半径内の全成熟作物を収穫する
   * 収穫した作物の種類と位置を _harvestLog に記録する
   * @returns {number} 収穫したブロック数
   */
  async harvestAll() {
    logger.info('[Farming] 収穫スキャン中...');
    let count = 0;

    for (const [cropName, info] of Object.entries(CROP_INFO)) {
      const blocks = this._findCrops(cropName, info.maxAge);

      for (const blockPos of blocks) {
        try {
          await this._gotoBlock({ position: blockPos });
          const block = this.bot.blockAt(blockPos);
          if (!block) continue;

          // 収穫位置をログに記録（再植付け用）
          const key = `${blockPos.x},${blockPos.y},${blockPos.z}`;
          this._harvestLog.set(key, { cropName, seedItem: info.seed });

          await this.bot.dig(block);
          count++;
          this._stats.totalHarvested++;
          await sleep(150);
        } catch (e) {
          logger.debug(`[Farming] 収穫失敗 (${cropName}): ${e.message}`);
        }
      }
    }

    logger.info(`[Farming] 収穫完了: ${count} ブロック`);
    return count;
  }

  /**
   * 指定作物の成熟ブロックを検索する
   * @param {string} cropName - 作物ブロック名
   * @param {number} maxAge   - 収穫可能な最大 age 値
   * @returns {Vec3[]} 成熟作物の位置配列
   */
  _findCrops(cropName, maxAge) {
    // レジストリに存在しない作物はスキップ
    if (!this.bot.registry?.blocksByName?.[cropName]) return [];

    return this.bot.findBlocks({
      matching: (b) => {
        if (b.name !== cropName) return false;
        const age = b.getProperties?.()?.age;
        return age !== undefined ? Number(age) >= maxAge : true;
      },
      maxDistance: this.scanRadius,
      count: 64,
    });
  }

  // ── 収穫後の自動再植付け ───────────────────────────────────────────────────
  /**
   * _harvestLog に記録された位置に対して自動再植付けを行う
   * 収穫ログは処理後にクリアされる
   * @returns {number} 植えたブロック数
   */
  async replantFromLog() {
    if (this._harvestLog.size === 0) return 0;

    logger.info(`[Farming] 自動再植付け開始: ${this._harvestLog.size} 箇所`);
    let count = 0;

    for (const [key, { seedItem }] of this._harvestLog.entries()) {
      const [x, y, z] = key.split(',').map(Number);

      try {
        // farmland ブロックが存在するか確認（掘られていない場合）
        const farmBlock = this.bot.blockAt({ x, y, z });
        if (!farmBlock || farmBlock.name !== 'farmland') continue;

        // 上のブロックが air か確認
        const above = this.bot.blockAt({ x, y: y + 1, z });
        if (!above || above.name !== 'air') continue;

        // インベントリから種を探す
        const seed = this.bot.inventory.items().find(i => i.name === seedItem);
        if (!seed) continue;

        await this._gotoBlock({ position: { x, y, z } });
        await this.bot.equip(seed, 'hand');
        await this.bot.placeBlock(farmBlock, { x: 0, y: 1, z: 0 });
        count++;
        this._stats.totalPlanted++;
        await sleep(200);
      } catch (e) {
        logger.debug(`[Farming] 再植付け失敗 (${key}): ${e.message}`);
      }
    }

    // ログをクリア
    this._harvestLog.clear();
    logger.info(`[Farming] 自動再植付け完了: ${count} ブロック`);
    return count;
  }

  // ── 種まき ─────────────────────────────────────────────────────────────────
  /**
   * 空の farmland に種を植える
   * @returns {number} 植えたブロック数
   */
  async plantAll() {
    logger.info('[Farming] 種まきスキャン中...');
    let count = 0;

    // 空の farmland を探す
    const farmlands = this.bot.findBlocks({
      matching: (b) => b.name === 'farmland',
      maxDistance: this.scanRadius,
      count: 128,
    });

    for (const pos of farmlands) {
      const above = this.bot.blockAt(pos.offset(0, 1, 0));
      if (!above || above.name !== 'air') continue;

      // インベントリから植えられる種を探す
      const seed = this._findSeedInInventory();
      if (!seed) break; // 種がなければ中断

      try {
        await this._gotoBlock({ position: pos });
        await this.bot.equip(seed, 'hand');
        const farmBlock = this.bot.blockAt(pos);
        if (!farmBlock) continue;
        await this.bot.placeBlock(farmBlock, { x: 0, y: 1, z: 0 });
        count++;
        this._stats.totalPlanted++;
        await sleep(200);
      } catch (e) {
        logger.debug(`[Farming] 種まき失敗: ${e.message}`);
      }
    }

    logger.info(`[Farming] 種まき完了: ${count} ブロック`);
    return count;
  }

  /**
   * インベントリから最初に見つかった種アイテムを返す
   * @returns {object|null} mineflayer Item オブジェクト
   */
  _findSeedInInventory() {
    const seedItems = Object.values(CROP_INFO).map(c => c.seed);
    for (const seedName of seedItems) {
      const item = this.bot.inventory.items().find(i => i.name === seedName);
      if (item) return item;
    }
    return null;
  }

  // ── 動物の繁殖 ─────────────────────────────────────────────────────────────
  /**
   * 近くにいる同種の動物2匹に繁殖アイテムを与える
   * @returns {number} 繁殖アクション実行回数
   */
  async breedAnimals() {
    logger.info('[Farming] 動物繁殖チェック...');
    let count = 0;

    for (const [mobName, foods] of Object.entries(BREED_FOOD)) {
      // 繁殖に使える食べ物がインベントリにあるか確認
      const foodItem = foods
        .map(f => this.bot.inventory.items().find(i => i.name === f))
        .find(Boolean);
      if (!foodItem) continue;

      // 近くの同種動物を探す（2匹以上いれば繁殖可能）
      const animals = Object.values(this.bot.entities || {}).filter(e =>
        e.name?.toLowerCase() === mobName &&
        e.position.distanceTo(this.bot.entity.position) < this.breedRadius
      );
      if (animals.length < 2) continue;

      try {
        await this.bot.equip(foodItem, 'hand');
        for (const animal of animals.slice(0, 2)) {
          await this._gotoEntity(animal);
          await this.bot.activateEntity(animal);
          count++;
          await sleep(500);
        }
      } catch (e) {
        logger.debug(`[Farming] 繁殖失敗 (${mobName}): ${e.message}`);
      }
    }

    logger.info(`[Farming] 繁殖アクション: ${count} 回`);
    return count;
  }

  // ── 農地拡張 ───────────────────────────────────────────────────────────────
  /**
   * 農地の隣接する grass/dirt を耕して farmland に変換する
   * 水源が範囲内にない場合は水を自動設置してから耕す
   * @returns {number} 耕したブロック数
   */
  async expandFarmland() {
    const hoe = this.bot.inventory.items().find(i => i.name.includes('_hoe'));
    if (!hoe) {
      logger.info('[Farming] クワがないため農地拡張スキップ');
      return 0;
    }

    // 農地の隣接する grass/dirt を探す
    const dirtBlocks = this.bot.findBlocks({
      matching: (b) => ['dirt', 'grass_block', 'coarse_dirt'].includes(b.name),
      maxDistance: this.scanRadius,
      count: 32,
    });

    let count = 0;

    for (const pos of dirtBlocks) {
      // 水源が WATER_HYDRATION_RADIUS 以内にあるか確認
      let hasWater = this._hasWaterNearby(pos, WATER_HYDRATION_RADIUS);

      // 水がない場合、自動配置を試みる
      if (!hasWater && this.autoWater) {
        const placed = await this._placeWaterForPos(pos);
        if (placed) {
          hasWater = true;
          await sleep(300);
        }
      }

      if (!hasWater) continue;

      try {
        await this.bot.equip(hoe, 'hand');
        await this._gotoBlock({ position: pos });
        const block = this.bot.blockAt(pos);
        if (!block) continue;
        // クワで右クリックして耕す（activateBlock を使用）
        await this.bot.activateBlock(block);
        count++;
        await sleep(300);
      } catch { /* 個別エラーは無視 */ }
    }

    logger.info(`[Farming] 農地拡張: ${count} ブロック耕した`);
    return count;
  }

  // ── 水源自動配置 ───────────────────────────────────────────────────────────
  /**
   * 指定位置に適切な水源を配置する
   * 近くのウォーターソースブロックからバケツで水を汲み、設置する
   * @param {Vec3} targetPos - 耕したい土ブロックの位置
   * @returns {boolean} 水の設置に成功したか
   */
  async _placeWaterForPos(targetPos) {
    // 最適な水設置位置を計算（マンハッタン距離4ブロック以内の中心）
    const waterPos = this._calcOptimalWaterPos(targetPos);
    if (!waterPos) return false;

    // 既に水があるか確認
    const existing = this.bot.blockAt(waterPos);
    if (existing?.name === 'water' || existing?.name === 'flowing_water') return true;

    // 水入りバケツがインベントリにあるか確認
    let waterBucket = this.bot.inventory.items().find(i => i.name === 'water_bucket');

    if (!waterBucket) {
      // 空バケツがあれば近くの水源から汲む
      const collected = await this._collectWaterFromNearby();
      if (!collected) return false;
      waterBucket = this.bot.inventory.items().find(i => i.name === 'water_bucket');
      if (!waterBucket) return false;
    }

    try {
      await this._gotoBlock({ position: waterPos });
      await this.bot.equip(waterBucket, 'hand');

      // 設置先ブロックが空気か確認
      const targetBlock = this.bot.blockAt(waterPos);
      if (!targetBlock || !['air', 'cave_air'].includes(targetBlock.name)) return false;

      // 下のブロックに対して水を置く（上面に設置）
      const belowBlock = this.bot.blockAt({ x: waterPos.x, y: waterPos.y - 1, z: waterPos.z });
      if (!belowBlock) return false;

      await this.bot.placeBlock(belowBlock, { x: 0, y: 1, z: 0 });
      this._stats.totalWaterPlaced++;
      logger.info(`[Farming] 水源設置: ${waterPos.x},${waterPos.y},${waterPos.z}`);
      return true;
    } catch (e) {
      logger.debug(`[Farming] 水設置失敗: ${e.message}`);
      return false;
    }
  }

  /**
   * 近くの水源ブロックからバケツで水を汲む
   * @returns {boolean} 水汲みに成功したか
   */
  async _collectWaterFromNearby() {
    // 空バケツがあるか確認
    const emptyBucket = this.bot.inventory.items().find(i => i.name === 'bucket');
    if (!emptyBucket) return false;

    // 近くの水源ブロックを探す
    const waterBlocks = this.bot.findBlocks({
      matching: (b) => b.name === 'water' && b.getProperties?.()?.level === '0',
      maxDistance: 16,
      count: 1,
    });

    if (waterBlocks.length === 0) return false;

    const waterPos = waterBlocks[0];
    try {
      await this._gotoBlock({ position: waterPos });
      await this.bot.equip(emptyBucket, 'hand');
      const waterBlock = this.bot.blockAt(waterPos);
      if (!waterBlock) return false;
      // 水源ブロックを右クリックして水を汲む
      await this.bot.activateBlock(waterBlock);
      logger.info('[Farming] 水源から水を汲みました');
      return true;
    } catch (e) {
      logger.debug(`[Farming] 水汲み失敗: ${e.message}`);
      return false;
    }
  }

  /**
   * 指定位置を水和できる最適な水源設置位置を計算する
   * 農地に対して最大4ブロック離れた中心位置を返す
   * @param {Vec3} farmPos - 農地ブロックの位置
   * @returns {object|null} 水設置位置 {x, y, z} または null
   */
  _calcOptimalWaterPos(farmPos) {
    // farmPos の Y レベルを基準に水を置くべき中心を探す
    // シンプルな実装: farmPos の隣（距離1）のブロックを候補にする
    const candidates = [
      { x: farmPos.x + 1, y: farmPos.y, z: farmPos.z },
      { x: farmPos.x - 1, y: farmPos.y, z: farmPos.z },
      { x: farmPos.x,     y: farmPos.y, z: farmPos.z + 1 },
      { x: farmPos.x,     y: farmPos.y, z: farmPos.z - 1 },
    ];

    for (const candidate of candidates) {
      const b = this.bot.blockAt(candidate);
      // 空気ブロックかつ下にしっかりしたブロックがある場所を選ぶ
      if (b && ['air', 'cave_air'].includes(b.name)) {
        const below = this.bot.blockAt({ x: candidate.x, y: candidate.y - 1, z: candidate.z });
        if (below && below.isSolid) return candidate;
      }
    }
    return null;
  }

  // ── 灌漑計画 ───────────────────────────────────────────────────────────────
  /**
   * 指定した農地サイズに対して最適な水源配置を計算する
   * Minecraft の水和ルール（マンハッタン距離 4）に基づく
   *
   * @param {number} centerX - 農地中心 X 座標
   * @param {number} centerY - 農地 Y 座標
   * @param {number} centerZ - 農地中心 Z 座標
   * @param {number} width   - 農地の幅（X 方向）
   * @param {number} length  - 農地の長さ（Z 方向）
   * @returns {Array<{x:number, y:number, z:number}>} 水源設置推奨位置の配列
   */
  planIrrigation(centerX, centerY, centerZ, width, length) {
    const waterPositions = [];

    // 農地の全ブロック位置を列挙
    const farmPositions = [];
    const startX = centerX - Math.floor(width  / 2);
    const startZ = centerZ - Math.floor(length / 2);

    for (let x = startX; x < startX + width; x++) {
      for (let z = startZ; z < startZ + length; z++) {
        farmPositions.push({ x, y: centerY, z });
      }
    }

    // 未カバーの農地を追跡
    const uncovered = new Set(farmPositions.map(p => `${p.x},${p.z}`));

    // 貪欲アルゴリズムで水源を配置
    // 各候補位置について、カバーできる農地数を計算し最大を選ぶ
    while (uncovered.size > 0) {
      let bestPos = null;
      let bestCoverage = 0;

      // 農地内の各ブロックを水源候補として評価
      for (const farmPos of farmPositions) {
        // 水は farmland と同じ Y レベルに置く
        const candidate = { x: farmPos.x, y: centerY, z: farmPos.z };

        // この位置に水を置いた場合のカバー数を計算
        let coverage = 0;
        for (const pos of farmPositions) {
          const manhattan = Math.abs(pos.x - candidate.x) + Math.abs(pos.z - candidate.z);
          if (manhattan <= WATER_HYDRATION_RADIUS && uncovered.has(`${pos.x},${pos.z}`)) {
            coverage++;
          }
        }

        if (coverage > bestCoverage) {
          bestCoverage = coverage;
          bestPos = candidate;
        }
      }

      if (!bestPos || bestCoverage === 0) break;

      waterPositions.push(bestPos);

      // このポジションでカバーされる農地を uncovered から削除
      for (const pos of farmPositions) {
        const manhattan = Math.abs(pos.x - bestPos.x) + Math.abs(pos.z - bestPos.z);
        if (manhattan <= WATER_HYDRATION_RADIUS) {
          uncovered.delete(`${pos.x},${pos.z}`);
        }
      }
    }

    logger.info(`[Farming] 灌漑計画: ${width}x${length} 農地に ${waterPositions.length} 個の水源が必要`);
    return waterPositions;
  }

  /**
   * 指定サイズの農地に必要な最小水源数を返す
   * @param {number} width  - 農地幅
   * @param {number} length - 農地長さ
   * @returns {number} 必要な水源数
   */
  calcMinWaterSources(width, length) {
    const plan = this.planIrrigation(0, 0, 0, width, length);
    return plan.length;
  }

  // ── チェストへの格納 ──────────────────────────────────────────────────────
  /**
   * インベントリの農作物を近くのチェストに格納する
   * 種、道具、防具は格納しない
   * @returns {number} 格納したアイテム種類数
   */
  async storeHarvestInChest() {
    // 近くのチェストを探す
    const chestBlocks = this.bot.findBlocks({
      matching: (b) => b.name === 'chest' || b.name === 'trapped_chest',
      maxDistance: 24,
      count: 5,
    });

    if (chestBlocks.length === 0) {
      logger.debug('[Farming] 近くにチェストが見つかりません');
      return 0;
    }

    // 格納しないアイテム（種・道具・装備）
    const keepItems = new Set([
      ...Object.values(CROP_INFO).map(c => c.seed),
      ...Object.values(BREED_FOOD).flat(),
    ]);

    // チェストに入れるべきアイテムを収集
    const harvestItems = this.bot.inventory.items().filter(item =>
      !keepItems.has(item.name) &&
      !item.name.includes('_pickaxe') &&
      !item.name.includes('_axe') &&
      !item.name.includes('_hoe') &&
      !item.name.includes('_sword') &&
      !item.name.includes('_helmet') &&
      !item.name.includes('_chestplate') &&
      !item.name.includes('_leggings') &&
      !item.name.includes('_boots')
    );

    if (harvestItems.length === 0) {
      logger.debug('[Farming] 格納するアイテムがありません');
      return 0;
    }

    let storedCount = 0;
    const chestPos = chestBlocks[0];

    try {
      await this._gotoBlock({ position: chestPos });
      const chestBlock = this.bot.blockAt(chestPos);
      if (!chestBlock) return 0;

      const chest = await this.bot.openContainer(chestBlock);
      await sleep(300);

      for (const item of harvestItems) {
        try {
          await chest.deposit(item.type, null, item.count);
          storedCount++;
          await sleep(100);
        } catch (e) {
          logger.debug(`[Farming] アイテム格納失敗 (${item.name}): ${e.message}`);
        }
      }

      chest.close();
      logger.info(`[Farming] チェストに ${storedCount} 種類のアイテムを格納しました`);
    } catch (e) {
      logger.warn(`[Farming] チェスト操作エラー: ${e.message}`);
    }

    return storedCount;
  }

  // ── 水源チェック ─────────────────────────────────────────────────────────
  /**
   * 指定位置の周囲に水源があるか確認する
   * @param {Vec3} pos    - 確認するブロック位置
   * @param {number} radius - 検索半径
   * @returns {boolean} 水源が見つかったか
   */
  _hasWaterNearby(pos, radius) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        // マンハッタン距離チェック（Minecraft の水和範囲に合わせる）
        if (Math.abs(dx) + Math.abs(dz) > radius) continue;
        const b = this.bot.blockAt(pos.offset(dx, 0, dz));
        if (b?.name === 'water' || b?.name === 'flowing_water') return true;
      }
    }
    return false;
  }

  // ── 移動ヘルパー ───────────────────────────────────────────────────────────
  /**
   * 指定ブロック位置に移動する
   * @param {object} block - position プロパティを持つオブジェクト、または Vec3
   */
  async _gotoBlock(block) {
    const pos = block.position || block;
    if (!this.bot.pathfinder) return;
    const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 2);
    await this.bot.pathfinder.goto(goal);
  }

  /**
   * 指定エンティティに近づく
   * @param {object} entity - mineflayer エンティティ
   */
  async _gotoEntity(entity) {
    if (!this.bot.pathfinder || !entity?.position) return;
    const p = entity.position;
    const goal = new goals.GoalNear(p.x, p.y, p.z, 2);
    await this.bot.pathfinder.goto(goal);
  }

  // ── ステータス ─────────────────────────────────────────────────────────────
  /**
   * 現在の農業モジュールのステータスを返す
   * @returns {object} ステータスオブジェクト
   */
  getStatus() {
    return {
      running:    this._running,
      scanRadius: this.scanRadius,
      autoExpand: this.autoExpand,
      autoWater:  this.autoWater,
      autoReplant: this.autoReplant,
      stats:      { ...this._stats },
      pendingReplant: this._harvestLog.size,
    };
  }
}

module.exports = { FarmingModule, CROP_INFO, BREED_FOOD, WATER_HYDRATION_RADIUS };
