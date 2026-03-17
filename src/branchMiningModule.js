'use strict';
/**
 * branchMiningModule.js
 * ブランチマイニングモジュール
 *
 * 機能:
 *  - クラシックブランチマイニング: メイントンネル(1x2)を掘り、N ブロック毎に支線を掘る
 *  - ストリップマイニング: 指定 Y レベルで広い水平層を掘る
 *  - 鉱石脈マイニング: 発見した鉱石の連続した脈全体を採掘
 *  - 安全チェック: 溶岩・水・落下の検出
 *  - 自動松明設置
 *  - インベントリが一定量埋まったら拠点に戻り格納
 *  - 最良のピッケルを自動装備
 *
 * 状態機械:
 *  IDLE → DIGGING_MAIN → DIGGING_BRANCH → MINING_ORE → RETREATING → DEPOSITING → IDLE
 */

const { goals, Movements } = require('mineflayer-pathfinder');
const { logger } = require('./logger');
const { sleep }  = require('./utils');

// ── 採掘対象鉱石デフォルト ────────────────────────────────────────────────
const DEFAULT_TARGET_ORES = [
  'diamond_ore',
  'deepslate_diamond_ore',
  'iron_ore',
  'deepslate_iron_ore',
  'gold_ore',
  'deepslate_gold_ore',
  'emerald_ore',
  'deepslate_emerald_ore',
  'ancient_debris',
  'coal_ore',
  'deepslate_coal_ore',
  'copper_ore',
  'deepslate_copper_ore',
  'lapis_ore',
  'deepslate_lapis_ore',
  'redstone_ore',
  'deepslate_redstone_ore',
];

// ── ピッケルの tier 順（強い順） ──────────────────────────────────────────
const PICKAXE_TIERS = [
  'netherite_pickaxe',
  'diamond_pickaxe',
  'iron_pickaxe',
  'stone_pickaxe',
  'golden_pickaxe',
  'wooden_pickaxe',
];

// ── 掘削する方向ベクトル (右手座標系) ─────────────────────────────────────
const DIRECTIONS = {
  north: { x: 0, z: -1 },
  south: { x: 0, z:  1 },
  east:  { x: 1, z:  0 },
  west:  { x: -1, z: 0 },
};

// ── モジュール状態 ──────────────────────────────────────────────────────────
const STATE = {
  IDLE:           'IDLE',
  DIGGING_MAIN:   'DIGGING_MAIN',
  DIGGING_BRANCH: 'DIGGING_BRANCH',
  MINING_ORE:     'MINING_ORE',
  RETREATING:     'RETREATING',
  DEPOSITING:     'DEPOSITING',
};

class BranchMiningModule {
  /**
   * @param {object} bot      - mineflayer bot インスタンス
   * @param {object} memStore - MemoryStore インスタンス
   * @param {object} options  - 設定オプション
   */
  constructor(bot, memStore, options = {}) {
    this.bot      = bot;
    this.memStore = memStore;

    // ── デフォルト設定 ──────────────────────────────────────────────────────
    this.options = {
      mainTunnelLength: options.mainTunnelLength || 64,     // メイントンネル長さ（ブロック）
      branchInterval:   options.branchInterval   || 3,      // 支線間隔（1.18+ の cave gen 向け）
      branchLength:     options.branchLength     || 16,     // 支線の長さ（ブロック）
      targetOres:       options.targetOres       || DEFAULT_TARGET_ORES,
      stripHeight:      options.stripHeight      || -57,    // ストリップマイニング Y レベル（1.18+ ダイヤ最適）
      safetyChecks:     options.safetyChecks     ?? true,   // 安全チェックを行うか
      placeTorches:     options.placeTorches     ?? true,   // 松明を自動設置するか
      torchInterval:    options.torchInterval    || 8,      // 松明設置間隔（ブロック）
      returnThreshold:  options.returnThreshold  || 0.7,    // インベントリ使用率でリターン
      stripWidth:       options.stripWidth       || 16,     // ストリップマイニング幅
      maxOreVeinSize:   options.maxOreVeinSize   || 64,     // 鉱石脈の最大探索数
    };

    // ── 実行状態 ────────────────────────────────────────────────────────────
    this.state         = STATE.IDLE;
    this._running      = false;
    this._shouldStop   = false;
    this._startPos     = null;  // マイニング開始地点
    this._startDir     = 'north'; // 掘り進む方向

    // ── 統計情報 ────────────────────────────────────────────────────────────
    this._stats = {
      blocksMined:     0,   // 採掘したブロック数
      oresFound:       0,   // 発見した鉱石数
      oresByType:      {},  // 種類別鉱石数
      torchesPlaced:   0,   // 設置した松明数
      branchCount:     0,   // 掘った支線数
      deposited:       0,   // 格納したアイテム数
      startTime:       null,
    };
  }

  // ── パブリックAPI ──────────────────────────────────────────────────────────

  /**
   * ブランチマイニングを開始する
   * @param {object} options - オプション（コンストラクタのオプションを上書き）
   */
  async startBranchMining(options = {}) {
    if (this._running) {
      logger.warn('[BranchMining] 既にマイニング中です');
      return { ok: false, reason: 'already-running' };
    }

    // オプションをマージ
    Object.assign(this.options, options);

    this._running    = true;
    this._shouldStop = false;
    this._startPos   = this.bot.entity?.position?.clone();
    this._startDir   = options.direction || 'north';
    this._stats.startTime = Date.now();
    logger.info(`[BranchMining] ブランチマイニング開始: 方向=${this._startDir}`);

    try {
      // 最良のピッケルを装備
      await this._equipBestPickaxe();

      // メイントンネルを掘る
      this.state = STATE.DIGGING_MAIN;
      await this._digMainTunnel();

      logger.info('[BranchMining] ブランチマイニング完了');
    } catch (e) {
      logger.warn(`[BranchMining] エラー: ${e.message}`);
    } finally {
      this._running = false;
      this.state    = STATE.IDLE;
    }

    return { ok: true, stats: this.getProgress() };
  }

  /**
   * ストリップマイニングを開始する
   * @param {object} options - オプション
   */
  async startStripMining(options = {}) {
    if (this._running) {
      logger.warn('[BranchMining] 既にマイニング中です');
      return { ok: false, reason: 'already-running' };
    }

    Object.assign(this.options, options);
    this._running    = true;
    this._shouldStop = false;
    this._startPos   = this.bot.entity?.position?.clone();
    this._stats.startTime = Date.now();

    const targetY = options.stripHeight || this.options.stripHeight;
    logger.info(`[BranchMining] ストリップマイニング開始: Y=${targetY}`);

    try {
      await this._equipBestPickaxe();

      // 目標 Y レベルまで降りる
      if (this.bot.entity.position.y > targetY + 2) {
        await this._digDown(targetY);
      }

      this.state = STATE.DIGGING_MAIN;
      await this._digStripLayer(targetY);

      logger.info('[BranchMining] ストリップマイニング完了');
    } catch (e) {
      logger.warn(`[BranchMining] エラー: ${e.message}`);
    } finally {
      this._running = false;
      this.state    = STATE.IDLE;
    }

    return { ok: true, stats: this.getProgress() };
  }

  /**
   * 発見した鉱石ブロックから連続する鉱石脈を全て採掘する
   * @param {object} startBlock - 採掘を開始する鉱石ブロック（mineflayer Block）
   * @returns {number} 採掘した鉱石ブロック数
   */
  async mineOreVein(startBlock) {
    if (!startBlock) return 0;

    const oreName  = startBlock.name;
    const visited  = new Set();
    const toMine   = [startBlock.position.clone()];
    let   minedCount = 0;

    logger.info(`[BranchMining] 鉱石脈採掘開始: ${oreName}`);

    while (toMine.length > 0 && minedCount < this.options.maxOreVeinSize) {
      if (this._shouldStop) break;

      const pos   = toMine.pop();
      const key   = `${pos.x},${pos.y},${pos.z}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const block = this.bot.blockAt(pos);
      if (!block || block.name !== oreName) continue;

      try {
        await this._gotoBlock(pos);
        await this.bot.dig(block);
        minedCount++;
        this._stats.blocksMined++;
        this._stats.oresFound++;
        this._stats.oresByType[oreName] = (this._stats.oresByType[oreName] || 0) + 1;
        await sleep(100);

        // 隣接する同種ブロックをキューに追加（6方向）
        const neighbors = [
          pos.offset( 1, 0, 0), pos.offset(-1, 0, 0),
          pos.offset( 0, 1, 0), pos.offset( 0,-1, 0),
          pos.offset( 0, 0, 1), pos.offset( 0, 0,-1),
        ];

        for (const n of neighbors) {
          const nKey = `${n.x},${n.y},${n.z}`;
          if (!visited.has(nKey)) {
            const nb = this.bot.blockAt(n);
            if (nb?.name === oreName) toMine.push(n.clone());
          }
        }
      } catch (e) {
        logger.debug(`[BranchMining] 鉱石採掘失敗: ${e.message}`);
      }
    }

    logger.info(`[BranchMining] 鉱石脈採掘完了: ${minedCount} ブロック (${oreName})`);
    return minedCount;
  }

  /**
   * マイニングを停止して開始地点に戻る
   */
  async stop() {
    logger.info('[BranchMining] 停止コマンド受信');
    this._shouldStop = true;

    if (this._startPos && this.bot.pathfinder) {
      try {
        this.state = STATE.RETREATING;
        const goal = new goals.GoalNear(
          this._startPos.x, this._startPos.y, this._startPos.z, 3
        );
        await this.bot.pathfinder.goto(goal);
        logger.info('[BranchMining] 開始地点に戻りました');
      } catch (e) {
        logger.warn(`[BranchMining] 帰還失敗: ${e.message}`);
      }
    }

    this.state    = STATE.IDLE;
    this._running = false;
  }

  /**
   * 現在のマイニング進捗を返す
   * @returns {object} 進捗情報
   */
  getProgress() {
    const elapsed = this._stats.startTime
      ? Math.floor((Date.now() - this._stats.startTime) / 1000)
      : 0;

    return {
      state:        this.state,
      running:      this._running,
      blocksMined:  this._stats.blocksMined,
      oresFound:    this._stats.oresFound,
      oresByType:   { ...this._stats.oresByType },
      torchesPlaced: this._stats.torchesPlaced,
      branchCount:  this._stats.branchCount,
      elapsedSeconds: elapsed,
      inventoryFull: this._getInventoryUsage(),
    };
  }

  // ── プライベートメソッド: 掘削ロジック ──────────────────────────────────

  /**
   * メイントンネル（1x2 の縦穴）を掘り進む
   * 指定間隔ごとに左右に支線を掘る
   */
  async _digMainTunnel() {
    const dir = DIRECTIONS[this._startDir] || DIRECTIONS.north;
    const startPos = this.bot.entity.position.clone();
    let torchCounter = 0;

    for (let i = 0; i < this.options.mainTunnelLength; i++) {
      if (this._shouldStop) break;

      // インベントリが一定量埋まったら格納しに戻る
      if (this._getInventoryUsage() >= this.options.returnThreshold) {
        logger.info('[BranchMining] インベントリが満杯に近いため一時帰還します');
        await this._returnAndDeposit();
        if (this._shouldStop) break;
      }

      // 進行方向の位置を計算
      const targetX = Math.floor(startPos.x) + dir.x * (i + 1);
      const targetZ = Math.floor(startPos.z) + dir.z * (i + 1);
      const targetY = Math.floor(startPos.y);

      // 1x2 のトンネルを掘る（足元と頭上）
      const digSuccess = await this._digTunnelColumn(targetX, targetY, targetZ);
      if (!digSuccess) continue;

      torchCounter++;

      // 松明設置
      if (this.options.placeTorches && torchCounter >= this.options.torchInterval) {
        await this._placeTorch(targetX, targetY, targetZ);
        torchCounter = 0;
      }

      // 支線を掘るタイミングか確認
      if ((i + 1) % this.options.branchInterval === 0) {
        await this._digBranches(targetX, targetY, targetZ, dir);
      }

      await sleep(50);
    }
  }

  /**
   * 指定位置に左右の支線トンネルを掘る
   * @param {number} x   - 現在の X 座標
   * @param {number} y   - 現在の Y 座標
   * @param {number} z   - 現在の Z 座標
   * @param {object} mainDir - メイン方向ベクトル {x, z}
   */
  async _digBranches(x, y, z, mainDir) {
    this._stats.branchCount++;
    this.state = STATE.DIGGING_BRANCH;

    // 左右の方向を計算（90度回転）
    const leftDir  = { x: -mainDir.z, z:  mainDir.x };
    const rightDir = { x:  mainDir.z, z: -mainDir.x };

    for (const branchDir of [leftDir, rightDir]) {
      if (this._shouldStop) break;

      logger.debug(`[BranchMining] 支線掘削: 方向=(${branchDir.x},${branchDir.z})`);

      let torchCounter = 0;
      for (let j = 1; j <= this.options.branchLength; j++) {
        if (this._shouldStop) break;

        const bx = x + branchDir.x * j;
        const bz = z + branchDir.z * j;

        await this._digTunnelColumn(bx, y, bz);

        torchCounter++;
        if (this.options.placeTorches && torchCounter >= this.options.torchInterval) {
          await this._placeTorch(bx, y, bz);
          torchCounter = 0;
        }

        await sleep(50);
      }
    }

    this.state = STATE.DIGGING_MAIN;
  }

  /**
   * 1x2 のトンネル柱（足元 Y と頭上 Y+1）を掘る
   * 安全チェックを実施してから掘削する
   * @param {number} x - X 座標
   * @param {number} y - 足元の Y 座標
   * @param {number} z - Z 座標
   * @returns {boolean} 掘削に成功したか
   */
  async _digTunnelColumn(x, y, z) {
    // 安全チェック
    if (this.options.safetyChecks) {
      if (this._isDangerous(x, y, z) || this._isDangerous(x, y + 1, z)) {
        logger.warn(`[BranchMining] 危険ブロックを検出: (${x},${y},${z}) をスキップ`);
        return false;
      }
    }

    // 足元と頭上のブロックを掘る
    for (const dy of [0, 1]) {
      const block = this.bot.blockAt({ x, y: y + dy, z });
      if (!block || block.name === 'air' || block.name === 'cave_air') continue;

      // 空気・液体以外のブロックを掘る
      if (block.name === 'water' || block.name === 'lava') continue;

      try {
        // 掘る前に移動
        const goal = new goals.GoalNear(x, y, z, 3);
        if (this.bot.pathfinder) await this.bot.pathfinder.goto(goal);

        await this.bot.dig(block);
        this._stats.blocksMined++;

        // 鉱石なら脈全体を採掘
        if (this.options.targetOres.includes(block.name)) {
          this.state = STATE.MINING_ORE;
          await this.mineOreVein(block);
          this.state = STATE.DIGGING_MAIN;
          // 採掘後に再びピッケルを装備
          await this._equipBestPickaxe();
        }

        await sleep(100);
      } catch (e) {
        logger.debug(`[BranchMining] 掘削失敗 (${x},${y + dy},${z}): ${e.message}`);
      }
    }

    return true;
  }

  /**
   * ストリップマイニング: 指定 Y レベルで幅広い層を掘る
   * @param {number} targetY - マイニング Y レベル
   */
  async _digStripLayer(targetY) {
    const startPos = this.bot.entity.position.clone();
    const halfWidth = Math.floor(this.options.stripWidth / 2);
    const dir = DIRECTIONS[this._startDir] || DIRECTIONS.north;
    const perpDir = { x: -dir.z, z: dir.x };

    for (let i = 0; i < this.options.mainTunnelLength; i++) {
      if (this._shouldStop) break;

      if (this._getInventoryUsage() >= this.options.returnThreshold) {
        await this._returnAndDeposit();
        if (this._shouldStop) break;
      }

      // 幅方向に掘る
      for (let w = -halfWidth; w <= halfWidth; w++) {
        const bx = Math.floor(startPos.x) + dir.x * (i + 1) + perpDir.x * w;
        const bz = Math.floor(startPos.z) + dir.z * (i + 1) + perpDir.z * w;
        await this._digTunnelColumn(bx, targetY, bz);
        await sleep(50);
      }

      // 定期的に松明設置
      if (this.options.placeTorches && (i + 1) % this.options.torchInterval === 0) {
        const mx = Math.floor(startPos.x) + dir.x * (i + 1);
        const mz = Math.floor(startPos.z) + dir.z * (i + 1);
        await this._placeTorch(mx, targetY, mz);
      }
    }
  }

  /**
   * 目標 Y レベルまで縦に掘り下げる
   * @param {number} targetY - 目標 Y レベル
   */
  async _digDown(targetY) {
    logger.info(`[BranchMining] Y=${targetY} まで掘り下げ中...`);
    const currentY = Math.floor(this.bot.entity.position.y);

    for (let y = currentY - 1; y >= targetY; y--) {
      if (this._shouldStop) break;

      // 安全チェック: 下に溶岩がないか
      if (this.options.safetyChecks) {
        const below = this.bot.blockAt({
          x: Math.floor(this.bot.entity.position.x),
          y: y - 1,
          z: Math.floor(this.bot.entity.position.z),
        });
        if (below?.name === 'lava') {
          logger.warn(`[BranchMining] 縦掘り中に溶岩を検出: Y=${y - 1}`);
          break;
        }
      }

      const pos = {
        x: Math.floor(this.bot.entity.position.x),
        y,
        z: Math.floor(this.bot.entity.position.z),
      };
      const block = this.bot.blockAt(pos);
      if (block && !['air', 'cave_air', 'water', 'lava'].includes(block.name)) {
        try {
          await this.bot.dig(block);
          this._stats.blocksMined++;
          await sleep(100);
        } catch (e) {
          logger.debug(`[BranchMining] 縦掘り失敗: ${e.message}`);
          break;
        }
      }
    }
  }

  // ── 安全チェック ─────────────────────────────────────────────────────────

  /**
   * 指定座標が危険（溶岩・水）かどうか確認する
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {boolean} 危険ならtrue
   */
  _isDangerous(x, y, z) {
    const block = this.bot.blockAt({ x, y, z });
    if (!block) return false;

    // 直接チェック
    if (block.name === 'lava' || block.name === 'flowing_lava') return true;

    // 隣接する溶岩もチェック（掘った後に流れてくる危険）
    const adjacent = [
      this.bot.blockAt({ x: x + 1, y, z }),
      this.bot.blockAt({ x: x - 1, y, z }),
      this.bot.blockAt({ x, y, z: z + 1 }),
      this.bot.blockAt({ x, y, z: z - 1 }),
      this.bot.blockAt({ x, y: y + 1, z }),
    ];

    return adjacent.some(b => b?.name === 'lava' || b?.name === 'flowing_lava');
  }

  // ── 松明設置 ──────────────────────────────────────────────────────────────

  /**
   * 指定位置に松明を設置する
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  async _placeTorch(x, y, z) {
    const torch = this.bot.inventory.items().find(
      i => i.name === 'torch' || i.name === 'soul_torch'
    );
    if (!torch) return;

    // 足元のブロックに松明を設置（壁面または床）
    const floorBlock = this.bot.blockAt({ x, y: y - 1, z });
    if (!floorBlock?.isSolid) return;

    try {
      await this.bot.equip(torch, 'hand');
      await this.bot.placeBlock(floorBlock, { x: 0, y: 1, z: 0 });
      this._stats.torchesPlaced++;
      logger.debug(`[BranchMining] 松明設置: (${x},${y},${z})`);
    } catch (e) {
      logger.debug(`[BranchMining] 松明設置失敗: ${e.message}`);
    }

    // 松明設置後にピッケルを再装備
    await this._equipBestPickaxe();
  }

  // ── 帰還・格納 ─────────────────────────────────────────────────────────────

  /**
   * 開始地点に戻り、近くのチェストにアイテムを格納する
   */
  async _returnAndDeposit() {
    if (!this._startPos) return;

    this.state = STATE.RETREATING;
    logger.info('[BranchMining] 一時帰還: 開始地点へ移動中');

    try {
      const goal = new goals.GoalNear(
        this._startPos.x, this._startPos.y, this._startPos.z, 3
      );
      if (this.bot.pathfinder) await this.bot.pathfinder.goto(goal);
    } catch (e) {
      logger.warn(`[BranchMining] 帰還中にエラー: ${e.message}`);
      return;
    }

    this.state = STATE.DEPOSITING;
    await this._depositToNearestChest();
    await this._equipBestPickaxe();
    this.state = STATE.DIGGING_MAIN;
  }

  /**
   * 近くのチェストに採掘物を格納する
   * ピッケル・松明は格納しない
   */
  async _depositToNearestChest() {
    const chestBlocks = this.bot.findBlocks({
      matching: (b) => b.name === 'chest' || b.name === 'trapped_chest',
      maxDistance: 16,
      count: 3,
    });

    if (chestBlocks.length === 0) {
      logger.debug('[BranchMining] 近くにチェストが見つかりません');
      return;
    }

    // 格納しないアイテム
    const keepItems = new Set([
      'torch', 'soul_torch', 'bucket', 'water_bucket',
      ...PICKAXE_TIERS,
    ]);

    const itemsToDeposit = this.bot.inventory.items().filter(
      i => !keepItems.has(i.name) &&
           !i.name.includes('_pickaxe') &&
           !i.name.includes('_axe') &&
           !i.name.includes('_sword')
    );

    if (itemsToDeposit.length === 0) return;

    try {
      await this._gotoBlock(chestBlocks[0]);
      const chestBlock = this.bot.blockAt(chestBlocks[0]);
      if (!chestBlock) return;

      const chest = await this.bot.openContainer(chestBlock);
      await sleep(300);

      for (const item of itemsToDeposit) {
        try {
          await chest.deposit(item.type, null, item.count);
          this._stats.deposited += item.count;
          await sleep(80);
        } catch { /* 個別エラーは無視 */ }
      }

      chest.close();
      logger.info('[BranchMining] アイテムを格納しました');
    } catch (e) {
      logger.warn(`[BranchMining] チェスト格納エラー: ${e.message}`);
    }
  }

  // ── ヘルパーメソッド ──────────────────────────────────────────────────────

  /**
   * インベントリの使用率（0.0〜1.0）を返す
   * @returns {number}
   */
  _getInventoryUsage() {
    const items     = this.bot.inventory.items();
    const totalSlots = 36; // プレイヤーインベントリのスロット数
    return items.length / totalSlots;
  }

  /**
   * インベントリから最良のピッケルを装備する
   */
  async _equipBestPickaxe() {
    for (const pickaxeName of PICKAXE_TIERS) {
      const pickaxe = this.bot.inventory.items().find(i => i.name === pickaxeName);
      if (pickaxe) {
        try {
          await this.bot.equip(pickaxe, 'hand');
          return true;
        } catch (e) {
          logger.debug(`[BranchMining] ピッケル装備失敗 (${pickaxeName}): ${e.message}`);
        }
      }
    }
    logger.debug('[BranchMining] ピッケルが見つかりません');
    return false;
  }

  /**
   * 指定位置に移動する
   * @param {Vec3|object} pos - 目的地座標
   */
  async _gotoBlock(pos) {
    if (!this.bot.pathfinder) return;
    const p = pos.position || pos;
    const goal = new goals.GoalNear(p.x, p.y, p.z, 2);
    await this.bot.pathfinder.goto(goal);
  }
}

module.exports = { BranchMiningModule, STATE, DEFAULT_TARGET_ORES, PICKAXE_TIERS };
