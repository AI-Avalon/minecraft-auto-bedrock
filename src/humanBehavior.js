'use strict';
/**
 * humanBehavior.js
 * Bot を「人間らしく見せる」行動パターン集
 *
 * 機能:
 *  - ランダムな首振り・視線移動
 *  - 人間らしいタイピング遅延付きチャット
 *  - AFK対策 Jitter（微細なランダム移動）
 *  - 待機中の独り言・リアクション
 *  - 近くのプレイヤーへの視線追従
 *  - ランダムな小休憩（立ち止まり）
 *  - 感情表現（ダメージを受けたら驚く等）
 */

const { logger } = require('./logger');
const { sleep }  = require('./utils');

// 独り言フレーズ（状況別）
const IDLE_PHRASES = [
  'んー…',
  'どこ行こうかな',
  'ちょっと休憩',
  'なんか落ちてないかな',
  '…',
  'よし',
  'むむ',
];

const MINING_PHRASES = [
  '掘れ掘れ〜',
  'もっと深くか',
  '鉱石どこだ…',
  '採掘中…',
  'ダイヤはどこ',
];

const COMBAT_PHRASES = [
  'やっちまえ！',
  '来るなら来い！',
  'うわっ！',
  'ちっ',
  '逃がさん',
  '危ない！',
];

const FARMING_PHRASES = [
  '成長してるかな',
  '収穫できそう',
  '植えておこう',
  '畑仕事は大事',
];

class HumanBehavior {
  /**
   * @param {object} botInstance - mineflayer bot
   * @param {object} options
   * @param {boolean} options.enableChat         - 独り言チャットを有効化
   * @param {boolean} options.enableJitter       - AFKジッター移動を有効化
   * @param {boolean} options.enableHeadMovement - 首振りを有効化
   * @param {number}  options.chatInterval       - 独り言間隔 ms (デフォルト: 90000 = 1.5分)
   * @param {number}  options.jitterInterval     - ジッター間隔 ms (デフォルト: 30000)
   * @param {number}  options.headInterval       - 首振り間隔 ms (デフォルト: 8000)
   */
  constructor(botInstance, options = {}) {
    this.bot = botInstance;

    this.enableChat         = options.enableChat         ?? true;
    this.enableJitter       = options.enableJitter       ?? true;
    this.enableHeadMovement = options.enableHeadMovement ?? true;

    this.chatIntervalMs  = options.chatInterval   || 90_000;
    this.jitterIntervalMs = options.jitterInterval || 30_000;
    this.headIntervalMs  = options.headInterval   || 8_000;

    this._timers = [];
    this._currentActivity = 'idle'; // idle / mining / combat / farming / etc.
  }

  // ── 起動・停止 ──────────────────────────────────────────────────────────────
  start() {
    if (this.enableHeadMovement) {
      this._timers.push(setInterval(() => this._randomHeadMove(), this.headIntervalMs));
    }
    if (this.enableJitter) {
      this._timers.push(setInterval(() => this._jitter(), this.jitterIntervalMs));
    }
    if (this.enableChat) {
      this._timers.push(setInterval(() => this._randomChat(), this.chatIntervalMs));
    }
    // プレイヤー追視タイマー（5秒ごとに確認）
    this._timers.push(setInterval(() => this._lookAtNearestPlayer(), 5_000));

    logger.info('[Human] 人間らしい行動パターン開始');
  }

  stop() {
    this._timers.forEach(t => clearInterval(t));
    this._timers = [];
    logger.info('[Human] 行動パターン停止');
  }

  /** 現在のアクティビティを更新（チャットフレーズ選択に影響） */
  setActivity(activity) {
    this._currentActivity = activity;
  }

  // ── 首振り ──────────────────────────────────────────────────────────────────
  _randomHeadMove() {
    if (!this.bot?.entity) return;
    try {
      // ランダムな方向を向く（±60°の範囲）
      const yaw   = this.bot.entity.yaw   + (Math.random() - 0.5) * 1.2;
      const pitch = (Math.random() - 0.5) * 0.8; // 上下
      this.bot.look(yaw, pitch, false);
    } catch { /* ignore */ }
  }

  // ── ジッター（AFK対策） ─────────────────────────────────────────────────────
  async _jitter() {
    if (!this.bot?.entity) return;
    try {
      const dx = (Math.random() - 0.5) * 0.3;
      const dz = (Math.random() - 0.5) * 0.3;
      // スニーク状態で微細移動→元に戻す
      const pos = this.bot.entity.position;
      await this.bot.pathfinder?.goto(
        new (require('mineflayer-pathfinder').goals.GoalNear)(
          pos.x + dx, pos.y, pos.z + dz, 0.5
        )
      ).catch(() => {});
    } catch { /* ignore */ }
  }

  // ── 独り言チャット ──────────────────────────────────────────────────────────
  async _randomChat() {
    if (!this.bot) return;
    // chatty 設定が false なら送信しない
    if (this.bot._humanBehaviorChatty === false) return;

    let pool;
    switch (this._currentActivity) {
      case 'mining':  pool = MINING_PHRASES;  break;
      case 'combat':  pool = COMBAT_PHRASES;  break;
      case 'farming': pool = FARMING_PHRASES; break;
      default:        pool = IDLE_PHRASES;    break;
    }

    const phrase = pool[Math.floor(Math.random() * pool.length)];
    // 人間らしいタイピング遅延（1〜3秒）
    await sleep(1000 + Math.random() * 2000);
    try {
      this.bot.chat(phrase);
      logger.debug(`[Human] 独り言: "${phrase}"`);
    } catch { /* ignore */ }
  }

  // ── 近くのプレイヤーへ視線を向ける ─────────────────────────────────────────
  _lookAtNearestPlayer() {
    if (!this.bot?.entity) return;
    try {
      const players = Object.values(this.bot.players || {})
        .filter(p => p.entity && p.username !== this.bot.username);
      if (players.length === 0) return;

      // 最も近いプレイヤーを探す
      let nearest = null;
      let minDist = Infinity;
      for (const p of players) {
        const d = p.entity.position.distanceTo(this.bot.entity.position);
        if (d < minDist && d < 20) {
          minDist = d;
          nearest = p;
        }
      }
      if (nearest) {
        this.bot.lookAt(nearest.entity.position.offset(0, 1.6, 0), false);
      }
    } catch { /* ignore */ }
  }

  // ── ダメージ反応 ────────────────────────────────────────────────────────────
  onDamaged() {
    if (!this.bot || !this.enableChat) return;
    const reactions = ['うわっ！', 'いたっ！', 'くっ…', '！！'];
    const r = reactions[Math.floor(Math.random() * reactions.length)];
    // すぐに叫ぶ（リアルな反応を演出）
    setTimeout(() => {
      try { this.bot.chat(r); } catch { /* ignore */ }
    }, 300 + Math.random() * 700);
  }

  // ── アイテム拾得反応 ─────────────────────────────────────────────────────────
  onPickup(item) {
    if (!this.bot || !this.enableChat) return;
    // レアアイテムだけリアクション
    const rareItems = ['diamond', 'emerald', 'ancient_debris', 'netherite'];
    const name = item?.name || '';
    if (rareItems.some(r => name.includes(r))) {
      const reactions = ['おっ！', 'やった！', 'これは…！', 'ラッキー'];
      const r = reactions[Math.floor(Math.random() * reactions.length)];
      setTimeout(() => {
        try { this.bot.chat(r); } catch { /* ignore */ }
      }, 500 + Math.random() * 1000);
    }
  }

  // ── タイピング遅延付きチャット送信（外部から呼べる） ────────────────────────
  async sendWithDelay(message, minDelayMs = 800, maxDelayMs = 2500) {
    if (!this.bot) return;
    const delay = minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
    await sleep(delay);
    // 長文は分割して送信
    const chunks = _splitMessage(message, 250);
    for (const chunk of chunks) {
      try {
        this.bot.chat(chunk);
        if (chunks.length > 1) await sleep(500 + Math.random() * 800);
      } catch { /* ignore */ }
    }
  }
}

/** 長いメッセージを指定文字数で分割 */
function _splitMessage(msg, maxLen) {
  const result = [];
  let s = msg;
  while (s.length > maxLen) {
    result.push(s.slice(0, maxLen));
    s = s.slice(maxLen);
  }
  if (s.length > 0) result.push(s);
  return result;
}

module.exports = { HumanBehavior };
