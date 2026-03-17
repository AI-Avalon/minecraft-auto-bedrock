'use strict';
/**
 * multiServerManager.js
 * マルチサーバー接続管理
 *
 * 機能:
 *  - 複数のMinecraftサーバーにBotを同時接続
 *  - サーバーヘルスチェック（ping/応答監視）
 *  - サーバー間でBotを移動（スイッチング）
 *  - 負荷分散（プレイヤー数・ラグ・タスクキューに基づく）
 *  - サーバーダウン時の自動フェイルオーバー
 *  - イベントブリッジ（あるサーバーのイベントを他サーバーに転送）
 *  - サーバー別Bot割り当てポリシー
 */

const EventEmitter = require('events');
const net          = require('net');
const { logger }   = require('./logger');
const { sleep }    = require('./utils');

// サーバーの状態
const SERVER_STATUS = {
  UNKNOWN:      'unknown',
  ONLINE:       'online',
  OFFLINE:      'offline',
  DEGRADED:     'degraded',  // 遅延過大
  MAINTENANCE:  'maintenance',
};

// Bot割り当てポリシー
const ASSIGN_POLICY = {
  ROUND_ROBIN:   'round-robin',    // 順番に割り当て
  LEAST_PLAYERS: 'least-players',  // プレイヤー数が最も少ないサーバー
  SPECIFIED:     'specified',      // config で指定
  FAILOVER:      'failover',       // プライマリが落ちたら移行
};

class MultiServerManager extends EventEmitter {
  /**
   * @param {object} options
   * @param {Array}  options.servers        - サーバー設定の配列
   * @param {string} options.assignPolicy   - Bot割り当てポリシー
   * @param {number} options.pingIntervalMs - ヘルスチェック間隔 (デフォルト: 30000)
   * @param {number} options.pingTimeoutMs  - ping タイムアウト (デフォルト: 5000)
   * @param {number} options.maxLatencyMs   - これ以上遅延したら DEGRADED (デフォルト: 500)
   */
  constructor(options = {}) {
    super();
    this.assignPolicy   = options.assignPolicy   || ASSIGN_POLICY.ROUND_ROBIN;
    this.pingIntervalMs = options.pingIntervalMs || 30_000;
    this.pingTimeoutMs  = options.pingTimeoutMs  || 5_000;
    this.maxLatencyMs   = options.maxLatencyMs   || 500;

    // サーバーレジストリ: Map<serverId, ServerEntry>
    this._servers = new Map();
    // Botレジストリ: Map<botId, { serverId, controller }>
    this._bots    = new Map();
    // ping タイマー
    this._pingTimer = null;
    this._rrIndex   = 0; // round-robin インデックス

    // 初期サーバー登録
    for (const srv of (options.servers || [])) {
      this.addServer(srv);
    }
  }

  // ── サーバー管理 ────────────────────────────────────────────────────────────
  addServer(config) {
    const id = config.id || `${config.host}:${config.port}`;
    if (this._servers.has(id)) {
      logger.warn(`[MSM] サーバー既に登録済み: ${id}`);
      return this._servers.get(id);
    }
    const entry = {
      id,
      host:        config.host,
      port:        config.port        || 25565,
      label:       config.label       || id,
      edition:     config.edition     || 'java',
      status:      SERVER_STATUS.UNKNOWN,
      latencyMs:   null,
      lastPingAt:  null,
      playerCount: null,
      maxPlayers:  null,
      motd:        null,
      priority:    config.priority    || 0,  // 高いほどフェイルオーバー先として優先
      tags:        config.tags        || [], // 例: ['mining', 'pvp', 'creative']
    };
    this._servers.set(id, entry);
    logger.info(`[MSM] サーバー登録: ${id} (${entry.host}:${entry.port})`);
    return entry;
  }

  removeServer(id) {
    // このサーバーに接続中のBotを退避
    for (const [botId, botEntry] of this._bots) {
      if (botEntry.serverId === id) {
        logger.warn(`[MSM] Bot ${botId} がサーバー ${id} から切り離されます`);
        this.emit('bot-orphaned', { botId, reason: 'server-removed' });
      }
    }
    this._servers.delete(id);
    logger.info(`[MSM] サーバー削除: ${id}`);
  }

  // ── Bot 管理 ────────────────────────────────────────────────────────────────
  registerBot(botId, controller) {
    this._bots.set(botId, { botId, serverId: null, controller });
    logger.info(`[MSM] Bot 登録: ${botId}`);
  }

  unregisterBot(botId) {
    this._bots.delete(botId);
    logger.info(`[MSM] Bot 削除: ${botId}`);
  }

  /**
   * Bot を適切なサーバーに割り当てる（接続は AutonomousBot が行う）
   * @returns {ServerEntry|null} 割り当て先サーバー
   */
  assignBot(botId, options = {}) {
    const entry = this._bots.get(botId);
    if (!entry) throw new Error(`Bot not found: ${botId}`);

    const server = this._selectServer(options);
    if (!server) {
      logger.warn(`[MSM] Bot ${botId} の割り当て先サーバーが見つかりません`);
      return null;
    }

    entry.serverId = server.id;
    logger.info(`[MSM] Bot ${botId} → サーバー ${server.id} に割り当て`);
    this.emit('bot-assigned', { botId, serverId: server.id });
    return server;
  }

  /** Bot をサーバー間で移動 */
  async switchBot(botId, targetServerId) {
    const botEntry = this._bots.get(botId);
    if (!botEntry) throw new Error(`Bot not found: ${botId}`);

    const target = this._servers.get(targetServerId);
    if (!target) throw new Error(`Server not found: ${targetServerId}`);
    if (target.status === SERVER_STATUS.OFFLINE) {
      throw new Error(`対象サーバーがオフライン: ${targetServerId}`);
    }

    const prevServerId = botEntry.serverId;
    logger.info(`[MSM] Bot ${botId} の移動: ${prevServerId} → ${targetServerId}`);

    // 現在の接続を切断
    try {
      botEntry.controller?.disconnect?.();
      await sleep(1000);
    } catch (e) {
      logger.warn(`[MSM] 切断エラー: ${e.message}`);
    }

    // 新サーバーへの接続情報を更新
    botEntry.serverId = targetServerId;
    this.emit('bot-switched', {
      botId,
      fromServerId: prevServerId,
      toServerId:   targetServerId,
    });

    return target;
  }

  // ── サーバー選択ロジック ────────────────────────────────────────────────────
  _selectServer(options = {}) {
    const onlineServers = [...this._servers.values()].filter(s =>
      s.status !== SERVER_STATUS.OFFLINE &&
      s.status !== SERVER_STATUS.MAINTENANCE
    );
    if (onlineServers.length === 0) return null;

    // タグフィルター
    if (options.tags?.length) {
      const filtered = onlineServers.filter(s =>
        options.tags.some(t => s.tags.includes(t))
      );
      if (filtered.length > 0) return this._applyPolicy(filtered);
    }

    // 指定ID
    if (options.serverId) {
      const s = this._servers.get(options.serverId);
      return (s && s.status !== SERVER_STATUS.OFFLINE) ? s : null;
    }

    return this._applyPolicy(onlineServers);
  }

  _applyPolicy(servers) {
    switch (this.assignPolicy) {
      case ASSIGN_POLICY.LEAST_PLAYERS: {
        return servers.reduce((best, s) => {
          const bc = best.playerCount ?? Infinity;
          const sc = s.playerCount   ?? Infinity;
          return sc < bc ? s : best;
        });
      }
      case ASSIGN_POLICY.FAILOVER: {
        return servers.sort((a, b) => b.priority - a.priority)[0];
      }
      case ASSIGN_POLICY.ROUND_ROBIN:
      default: {
        const s = servers[this._rrIndex % servers.length];
        this._rrIndex++;
        return s;
      }
    }
  }

  // ── ヘルスチェック ──────────────────────────────────────────────────────────
  startHealthCheck() {
    if (this._pingTimer) return;
    this._pingTimer = setInterval(() => this._pingAll(), this.pingIntervalMs);
    // 初回即時実行
    this._pingAll();
    logger.info(`[MSM] ヘルスチェック開始 (間隔: ${this.pingIntervalMs}ms)`);
  }

  stopHealthCheck() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  async _pingAll() {
    for (const [id, server] of this._servers) {
      try {
        const latency = await this._tcpPing(server.host, server.port);
        const prevStatus = server.status;
        server.latencyMs  = latency;
        server.lastPingAt = new Date().toISOString();

        if (latency > this.maxLatencyMs) {
          server.status = SERVER_STATUS.DEGRADED;
        } else {
          server.status = SERVER_STATUS.ONLINE;
        }

        if (prevStatus !== server.status) {
          logger.info(`[MSM] サーバー状態変化: ${id} ${prevStatus} → ${server.status} (${latency}ms)`);
          this.emit('server-status-changed', { serverId: id, prevStatus, status: server.status, latency });

          // オフラインから復帰したらフェイルオーバーBotを再割り当て
          if (prevStatus === SERVER_STATUS.OFFLINE && server.status === SERVER_STATUS.ONLINE) {
            this.emit('server-recovered', { serverId: id });
          }
        }
      } catch {
        const prevStatus = server.status;
        server.status     = SERVER_STATUS.OFFLINE;
        server.latencyMs  = null;
        server.lastPingAt = new Date().toISOString();

        if (prevStatus !== SERVER_STATUS.OFFLINE) {
          logger.warn(`[MSM] サーバーオフライン検出: ${id}`);
          this.emit('server-offline', { serverId: id });
          // フェイルオーバー処理
          await this._handleFailover(id);
        }
      }
    }
  }

  _tcpPing(host, port) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const socket = new net.Socket();
      socket.setTimeout(this.pingTimeoutMs);
      socket.connect(port, host, () => {
        socket.destroy();
        resolve(Date.now() - start);
      });
      socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
      socket.on('error', (e) => { socket.destroy(); reject(e); });
    });
  }

  async _handleFailover(offlineServerId) {
    // このサーバーに割り当てられているBotをフェイルオーバー先へ移動
    const affectedBots = [...this._bots.values()].filter(b => b.serverId === offlineServerId);
    if (affectedBots.length === 0) return;

    // フォールバックサーバーを選択（オフラインサーバー以外）
    const fallback = this._selectServer({ excludeId: offlineServerId });
    if (!fallback) {
      logger.warn('[MSM] フェイルオーバー先サーバーが見つかりません');
      return;
    }

    for (const botEntry of affectedBots) {
      logger.info(`[MSM] フェイルオーバー: Bot ${botEntry.botId} → ${fallback.id}`);
      try {
        await this.switchBot(botEntry.botId, fallback.id);
        this.emit('bot-failover', {
          botId:          botEntry.botId,
          fromServerId:   offlineServerId,
          toServerId:     fallback.id,
        });
      } catch (e) {
        logger.warn(`[MSM] フェイルオーバー失敗 (Bot ${botEntry.botId}): ${e.message}`);
      }
    }
  }

  // ── イベントブリッジ ────────────────────────────────────────────────────────
  /**
   * あるサーバーのメッセージを別サーバーに転送（Bot同士のリレーチャット等）
   * @param {string} fromBotId  - 送信元Bot
   * @param {string} toBotId    - 送信先Bot
   * @param {string} message
   */
  async bridgeMessage(fromBotId, toBotId, message) {
    const toEntry = this._bots.get(toBotId);
    if (!toEntry?.controller) {
      logger.warn(`[MSM] ブリッジ失敗: Bot ${toBotId} が見つかりません`);
      return;
    }
    try {
      toEntry.controller.bot?.chat?.(`[${fromBotId}→] ${message}`);
    } catch (e) {
      logger.warn(`[MSM] ブリッジメッセージ送信失敗: ${e.message}`);
    }
  }

  // ── ステータス取得 ──────────────────────────────────────────────────────────
  getStatus() {
    return {
      servers: [...this._servers.values()].map(s => ({
        id:          s.id,
        label:       s.label,
        host:        s.host,
        port:        s.port,
        status:      s.status,
        latencyMs:   s.latencyMs,
        lastPingAt:  s.lastPingAt,
        playerCount: s.playerCount,
        tags:        s.tags,
      })),
      bots: [...this._bots.values()].map(b => ({
        botId:    b.botId,
        serverId: b.serverId,
      })),
      policy: this.assignPolicy,
    };
  }
}

module.exports = { MultiServerManager, SERVER_STATUS, ASSIGN_POLICY };
