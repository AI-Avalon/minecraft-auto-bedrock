'use strict';
/**
 * flyingSquidServer.js
 * flying-squid (PrismarineJS) を使ったテスト用 Minecraft サーバーラッパー
 *
 * 用途:
 *  - CI/テストで本物のMinecraftサーバーなしにBotをテストする
 *  - ローカル開発でサーバーを即起動してデバッグする
 *  - scripts/self-host-server.js から呼び出される
 *
 * flying-squid は devDependencies にのみ含まれています。
 * 本番用コード（src/bot.js など）からはインポートしないでください。
 */

const EventEmitter = require('events');
const { logger }   = require('./logger');
const { sleep }    = require('./utils');

class FlyingSquidServer extends EventEmitter {
  /**
   * @param {object} options
   * @param {number} options.port           - リッスンポート (デフォルト: 25565)
   * @param {string} options.version        - MCバージョン (デフォルト: '1.21.4')
   * @param {number} options.maxPlayers     - 最大プレイヤー数 (デフォルト: 20)
   * @param {string} options.motd           - サーバーMOTD
   * @param {boolean} options.onlineMode    - オンラインモード (デフォルト: false)
   * @param {boolean} options.flatWorld     - フラットワールド (デフォルト: true、テスト用)
   */
  constructor(options = {}) {
    super();
    this.port       = options.port       || 25565;
    this.version    = options.version    || '1.21.4';
    this.maxPlayers = options.maxPlayers || 20;
    this.motd       = options.motd       || 'minecraft-auto-bedrock テストサーバー';
    this.onlineMode = options.onlineMode ?? false;
    this.flatWorld  = options.flatWorld  ?? true;
    this._server    = null;
    this._started   = false;
  }

  // ── サーバー起動 ────────────────────────────────────────────────────────────
  async start() {
    if (this._started) {
      logger.warn('[FlyingSquid] 既に起動中です');
      return;
    }

    let mc;
    try {
      mc = require('flying-squid');
    } catch {
      throw new Error(
        'flying-squid が見つかりません。\n' +
        '  npm install --save-dev flying-squid\n' +
        'でインストールしてください。'
      );
    }

    logger.info(`[FlyingSquid] サーバー起動中 (port=${this.port}, version=${this.version})...`);

    return new Promise((resolve, reject) => {
      try {
        this._server = mc.createMCServer({
          'online-mode':  this.onlineMode,
          port:           this.port,
          version:        this.version,
          'max-players':  this.maxPlayers,
          motd:           this.motd,
          // フラットワールド設定
          ...(this.flatWorld ? { worldFolder: undefined, generation: { name: 'flat', options: {} } } : {}),
        });

        this._server.on('error', (err) => {
          logger.error(`[FlyingSquid] サーバーエラー: ${err.message}`);
          this.emit('error', err);
          reject(err);
        });

        this._server.on('listening', () => {
          this._started = true;
          logger.info(`[FlyingSquid] サーバー起動完了 (port=${this.port})`);
          this.emit('listening', { port: this.port });
          resolve();
        });

        // プレイヤーイベントをリレー
        this._server.on('playerJoin', (player) => {
          logger.info(`[FlyingSquid] プレイヤー接続: ${player.username}`);
          this.emit('playerJoin', player);
        });
        this._server.on('playerLeave', (player) => {
          logger.info(`[FlyingSquid] プレイヤー切断: ${player.username}`);
          this.emit('playerLeave', player);
        });

      } catch (e) {
        reject(e);
      }
    });
  }

  // ── サーバー停止 ────────────────────────────────────────────────────────────
  async stop() {
    if (!this._started || !this._server) {
      return;
    }
    logger.info('[FlyingSquid] サーバー停止中...');
    try {
      this._server.quit('サーバー停止');
      await sleep(1000);
    } catch (e) {
      logger.warn(`[FlyingSquid] 停止エラー: ${e.message}`);
    }
    this._started = false;
    this._server  = null;
    logger.info('[FlyingSquid] サーバー停止完了');
    this.emit('stopped');
  }

  // ── サーバーコマンド実行 ─────────────────────────────────────────────────────
  runCommand(command) {
    if (!this._server) throw new Error('サーバーが起動していません');
    try {
      this._server.emit('command', command);
    } catch (e) {
      logger.warn(`[FlyingSquid] コマンド実行失敗: ${e.message}`);
    }
  }

  // ── チート/OP付与 ──────────────────────────────────────────────────────────
  opPlayer(username) {
    this.runCommand(`op ${username}`);
    logger.info(`[FlyingSquid] OP付与: ${username}`);
  }

  giveItem(username, itemName, count = 1) {
    this.runCommand(`give ${username} ${itemName} ${count}`);
  }

  setGameMode(username, mode) {
    const modes = { survival: 0, creative: 1, adventure: 2, spectator: 3 };
    const m = modes[mode] ?? mode;
    this.runCommand(`gamemode ${m} ${username}`);
  }

  teleport(username, x, y, z) {
    this.runCommand(`tp ${username} ${x} ${y} ${z}`);
  }

  // ── ステータス ─────────────────────────────────────────────────────────────
  getStatus() {
    return {
      started:    this._started,
      port:       this.port,
      version:    this.version,
      maxPlayers: this.maxPlayers,
      motd:       this.motd,
    };
  }

  get isRunning() {
    return this._started;
  }
}

// ── ファクトリ関数（テストから使いやすいように） ─────────────────────────────
async function createTestServer(options = {}) {
  const srv = new FlyingSquidServer({
    port:      options.port    || 25565,
    version:   options.version || '1.21.4',
    flatWorld: options.flatWorld ?? true,
    motd:      'Test Server',
    ...options,
  });
  await srv.start();
  return srv;
}

module.exports = { FlyingSquidServer, createTestServer };
