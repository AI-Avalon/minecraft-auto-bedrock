'use strict';
/**
 * behaviorStateMachine.js
 * mineflayer-statemachine を使った自律行動状態機械
 *
 * 状態一覧:
 *   IDLE        - 待機・周辺観察
 *   MINING      - 自動採掘
 *   FARMING     - 農業（種まき・収穫）
 *   EXPLORING   - 未探索エリアへの移動
 *   COMBAT      - 戦闘
 *   RETREATING  - 拠点への退避
 *   STORING     - チェストへのアイテム格納
 *   BUILDING    - schemに従った建築
 *   SLEEPING    - ベッドで就寝（夜間）
 *   TRADING     - 村人との取引
 */

const { logger } = require('./logger');
const { sleep } = require('./utils');

// mineflayer-statemachine は optional（未インストールでもクラッシュしない）
let StateMachineLib = null;
try {
  StateMachineLib = require('mineflayer-statemachine');
} catch {
  logger.warn('[FSM] mineflayer-statemachine が見つかりません。フォールバック動作を使用します。');
}

// ── 状態定数 ──────────────────────────────────────────────────────────────────
const STATE = {
  IDLE:       'IDLE',
  MINING:     'MINING',
  FARMING:    'FARMING',
  EXPLORING:  'EXPLORING',
  COMBAT:     'COMBAT',
  RETREATING: 'RETREATING',
  STORING:    'STORING',
  BUILDING:   'BUILDING',
  SLEEPING:   'SLEEPING',
  TRADING:    'TRADING',
};

// 状態遷移テーブル (from → [{ to, condition, priority }])
// condition(ctx) は AutonomousBot コンテキストを受け取り boolean を返す
const TRANSITIONS = [
  // 高優先度: 体力危機 → 即退避
  { from: '*',            to: STATE.RETREATING, priority: 100,
    condition: (ctx) => ctx.bot.health <= ctx.combatConfig.retreatThreshold && !ctx.isState(STATE.RETREATING) },

  // 戦闘: 近くに敵がいる
  { from: STATE.IDLE,     to: STATE.COMBAT,    priority: 80,
    condition: (ctx) => _hasNearbyHostile(ctx.bot, 16) },
  { from: STATE.MINING,   to: STATE.COMBAT,    priority: 80,
    condition: (ctx) => _hasNearbyHostile(ctx.bot, 12) },
  { from: STATE.FARMING,  to: STATE.COMBAT,    priority: 80,
    condition: (ctx) => _hasNearbyHostile(ctx.bot, 12) },

  // インベントリ満杯 → 保管
  { from: STATE.MINING,   to: STATE.STORING,   priority: 60,
    condition: (ctx) => _inventoryFull(ctx.bot, 0.85) },
  { from: STATE.FARMING,  to: STATE.STORING,   priority: 60,
    condition: (ctx) => _inventoryFull(ctx.bot, 0.9) },

  // 夜間 → 就寝 (PVPモードでは無効)
  { from: STATE.IDLE,     to: STATE.SLEEPING,  priority: 40,
    condition: (ctx) => _isNight(ctx.bot) && !ctx.config.combat?.disableSleep },

  // 農業モード指示
  { from: STATE.IDLE,     to: STATE.FARMING,   priority: 30,
    condition: (ctx) => ctx.autonomousGoal === 'farm' },

  // 探索モード
  { from: STATE.IDLE,     to: STATE.EXPLORING, priority: 20,
    condition: (ctx) => ctx.autonomousGoal === 'explore' },

  // 採掘モード
  { from: STATE.IDLE,     to: STATE.MINING,    priority: 10,
    condition: (ctx) => ctx.autonomousGoal === 'mine' ||
                        ctx.config.behavior?.mode === 'silent-mining' },

  // 退避後・戦闘後 → アイドルへ
  { from: STATE.RETREATING, to: STATE.IDLE,    priority: 5,
    condition: (ctx) => ctx.bot.health > ctx.combatConfig.healThreshold },
  { from: STATE.COMBAT,   to: STATE.IDLE,      priority: 5,
    condition: (ctx) => !_hasNearbyHostile(ctx.bot, 20) },
  { from: STATE.STORING,  to: STATE.IDLE,      priority: 5,
    condition: (ctx) => ctx.storeDoneFlag },
  { from: STATE.SLEEPING, to: STATE.IDLE,      priority: 5,
    condition: (ctx) => !_isNight(ctx.bot) },
];

// ── ヘルパー ──────────────────────────────────────────────────────────────────
function _hasNearbyHostile(bot, range) {
  if (!bot?.entities) return false;
  return Object.values(bot.entities).some(e =>
    e.type === 'mob' &&
    _isHostile(e.name) &&
    e.position.distanceTo(bot.entity.position) < range
  );
}

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'witch',
  'enderman', 'blaze', 'ghast', 'slime', 'magma_cube', 'phantom',
  'drowned', 'husk', 'stray', 'vindicator', 'evoker', 'pillager',
  'ravager', 'guardian', 'elder_guardian', 'warden', 'piglin_brute',
]);

function _isHostile(name) {
  if (!name) return false;
  return HOSTILE_MOBS.has(name.toLowerCase());
}

function _inventoryFull(bot, threshold = 0.85) {
  if (!bot?.inventory) return false;
  const slots = bot.inventory.slots;
  if (!slots) return false;
  const used = slots.filter(s => s !== null).length;
  const total = 36; // ホットバー + メインインベントリ
  return used / total >= threshold;
}

function _isNight(bot) {
  if (!bot?.time) return false;
  const t = bot.time.timeOfDay;
  // 夜（13000〜23000 tick）
  return t >= 13000 && t <= 23000;
}

// ── BotStateMachine クラス ────────────────────────────────────────────────────
class BotStateMachine {
  /**
   * @param {object} botController - AutonomousBot インスタンス
   * @param {object} options
   * @param {string} options.initialState - 初期状態 (デフォルト: IDLE)
   * @param {number} options.tickIntervalMs - 状態評価間隔 ms (デフォルト: 1500)
   */
  constructor(botController, options = {}) {
    this.ctrl    = botController;
    this.current = options.initialState || STATE.IDLE;
    this.prev    = null;
    this.tickMs  = options.tickIntervalMs || 1500;
    this._timer  = null;
    this._stateHistory = [];  // 直近20件の遷移ログ

    // AutonomousBot への参照（状態からメソッドを呼べるように）
    this.bot      = null; // connect 後に設定される
    this.storeDoneFlag = false;
    this.autonomousGoal = options.initialGoal || 'auto'; // mine / farm / explore / auto

    logger.info(`[FSM] 初期化完了 (初期状態: ${this.current}, 目標: ${this.autonomousGoal})`);
  }

  /** bot インスタンスをアタッチ */
  attach(bot) {
    this.bot = bot;
    logger.info('[FSM] Bot にアタッチしました');
    this._startTick();
    return this;
  }

  detach() {
    this._stopTick();
    this.bot = null;
    logger.info('[FSM] Bot からデタッチしました');
  }

  // ── 状態評価ループ ──────────────────────────────────────────────────────────
  _startTick() {
    this._stopTick();
    this._timer = setInterval(() => this._tick(), this.tickMs);
  }

  _stopTick() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _tick() {
    if (!this.bot) return;
    // ctrl のプロパティをコンテキストとして渡す
    const ctx = this._buildCtx();

    // 適用すべき遷移を優先度順に探す
    const cands = TRANSITIONS
      .filter(t => (t.from === '*' || t.from === this.current) && t.to !== this.current)
      .sort((a, b) => b.priority - a.priority);

    for (const t of cands) {
      try {
        if (t.condition(ctx)) {
          this._transition(t.to);
          return; // 1ティックに1遷移
        }
      } catch (e) {
        logger.warn(`[FSM] 遷移チェックエラー (${t.from}→${t.to}): ${e.message}`);
      }
    }
  }

  _buildCtx() {
    return {
      bot:             this.bot,
      combatConfig:    this.ctrl.combatConfig,
      config:          this.ctrl.config,
      autonomousGoal:  this.autonomousGoal,
      storeDoneFlag:   this.storeDoneFlag,
      isState:         (s) => this.current === s,
    };
  }

  _transition(next) {
    const entry = { from: this.current, to: next, at: new Date().toISOString() };
    logger.info(`[FSM] 状態遷移: ${this.current} → ${next}`);

    this.prev    = this.current;
    this.current = next;
    this._stateHistory.push(entry);
    if (this._stateHistory.length > 20) this._stateHistory.shift();

    this._onEnter(next);
  }

  /** 状態入場時のアクション */
  _onEnter(state) {
    const ctrl = this.ctrl;
    switch (state) {
      case STATE.IDLE:
        // 短い休憩（チャット・周辺観察はhumanBehaviorが担当）
        this.storeDoneFlag = false;
        break;

      case STATE.MINING:
        if (typeof ctrl.startAutoMine === 'function') {
          ctrl.startAutoMine().catch(e =>
            logger.warn(`[FSM] 採掘開始失敗: ${e.message}`)
          );
        }
        break;

      case STATE.FARMING:
        if (ctrl.farmingModule) {
          ctrl.farmingModule.startCycle().catch(e =>
            logger.warn(`[FSM] 農業開始失敗: ${e.message}`)
          );
        }
        break;

      case STATE.EXPLORING:
        if (ctrl.explorerModule) {
          ctrl.explorerModule.explore().catch(e =>
            logger.warn(`[FSM] 探索開始失敗: ${e.message}`)
          );
        }
        break;

      case STATE.COMBAT:
        if (typeof ctrl.startCombatNearestMob === 'function') {
          ctrl.startCombatNearestMob().catch(e =>
            logger.warn(`[FSM] 戦闘開始失敗: ${e.message}`)
          );
        }
        break;

      case STATE.RETREATING:
        if (typeof ctrl.retreatToBase === 'function') {
          ctrl.retreatToBase().catch(e =>
            logger.warn(`[FSM] 退避失敗: ${e.message}`)
          );
        }
        break;

      case STATE.STORING:
        if (typeof ctrl.runAutoStoreOnce === 'function') {
          ctrl.runAutoStoreOnce()
            .then(() => { this.storeDoneFlag = true; })
            .catch(e => {
              logger.warn(`[FSM] 保管失敗: ${e.message}`);
              this.storeDoneFlag = true; // 失敗してもアイドルへ
            });
        } else {
          this.storeDoneFlag = true;
        }
        break;

      case STATE.SLEEPING:
        this._trySleep();
        break;

      case STATE.TRADING:
        // 村人取引は explorerModule が担当
        break;

      default:
        break;
    }
  }

  async _trySleep() {
    if (!this.bot) return;
    try {
      const bed = this.bot.findBlock({
        matching: (b) => this.bot.isABed(b),
        maxDistance: 32,
      });
      if (bed) {
        await this.bot.sleep(bed);
        logger.info('[FSM] ベッドで就寝しました');
      } else {
        logger.info('[FSM] 近くにベッドが見つかりません。就寝スキップ');
        this.current = STATE.IDLE;
      }
    } catch (e) {
      logger.warn(`[FSM] 就寝失敗: ${e.message}`);
      this.current = STATE.IDLE;
    }
  }

  // ── 外部API ────────────────────────────────────────────────────────────────
  setGoal(goal) {
    if (!['mine', 'farm', 'explore', 'auto'].includes(goal)) {
      throw new Error(`不明なゴール: ${goal}`);
    }
    this.autonomousGoal = goal;
    logger.info(`[FSM] ゴール変更: ${goal}`);
    // IDLEに戻してから評価させる
    if (this.current !== STATE.RETREATING && this.current !== STATE.COMBAT) {
      this._transition(STATE.IDLE);
    }
  }

  forceState(state) {
    if (!STATE[state]) throw new Error(`不明な状態: ${state}`);
    this._transition(state);
  }

  getStatus() {
    return {
      current:  this.current,
      prev:     this.prev,
      goal:     this.autonomousGoal,
      history:  this._stateHistory.slice(-5),
    };
  }
}

module.exports = { BotStateMachine, STATE };
