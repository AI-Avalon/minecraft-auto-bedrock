const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const collectBlockPlugin = require('mineflayer-collectblock').plugin;
const toolPlugin = require('mineflayer-tool').plugin;
const autoEat = require('mineflayer-auto-eat').plugin;
const { logger } = require('./logger');
const { sleep } = require('./utils');

let movementPlugin;
let schemPlugin;

try {
  movementPlugin = require('mineflayer-movement').plugin;
} catch {
  movementPlugin = null;
}

try {
  schemPlugin = require('mineflayer-schem').plugin;
} catch {
  schemPlugin = null;
}

class AutonomousBot {
  constructor(config, memoryStore) {
    this.config = config;
    this.memoryStore = memoryStore;
    this.bot = null;
    this.reconnectTimer = null;
    this.isStopping = false;
    this.afkTimer = null;
    this.chatTimer = null;
  }

  get isBedrockMode() {
    return this.config.edition === 'bedrock';
  }

  buildBotOptions() {
    const base = {
      username: this.config.bot.username,
      password: this.config.bot.password || undefined,
      auth: this.config.bot.auth || 'offline'
    };

    if (this.config.edition === 'java') {
      return {
        ...base,
        host: this.config.java.host,
        port: this.config.java.port,
        version: this.config.java.version || false
      };
    }

    return {
      ...base,
      host: this.config.bedrock.proxy.listenHost,
      port: this.config.bedrock.proxy.listenPort,
      version: false
    };
  }

  attachPlugins() {
    this.bot.loadPlugin(pathfinder);
    this.bot.loadPlugin(collectBlockPlugin);
    this.bot.loadPlugin(toolPlugin);
    this.bot.loadPlugin(autoEat);

    if (movementPlugin) {
      this.bot.loadPlugin(movementPlugin);
    }

    if (schemPlugin) {
      this.bot.loadPlugin(schemPlugin);
    }

    this.bot.autoEat.options = {
      priority: 'foodPoints',
      minHunger: 16,
      offhand: true,
      bannedFood: []
    };
  }

  attachEvents() {
    this.bot.once('spawn', async () => {
      logger.info('Bot がスポーンしました。初期化を開始します。');
      this.startAfkJitter();
      this.startChattyLoop();
      this.bot.autoEat.enable();
      await this.scanNearbyChests();
    });

    this.bot.on('health', async () => {
      if (this.bot.health <= 10) {
        await this.retreatToNearestBase();
      }
    });

    this.bot.on('death', async () => {
      const pos = this.bot.entity?.position;
      if (!pos) {
        return;
      }

      const point = {
        x: Math.floor(pos.x),
        y: Math.floor(pos.y),
        z: Math.floor(pos.z)
      };
      await this.memoryStore.addDeath(point, 'bot-death-event');
      logger.warn(`死亡地点を保存しました: ${point.x},${point.y},${point.z}`);
    });

    this.bot.on('respawn', async () => {
      logger.info('リスポーンを検知したため自己復旧フローを開始します。');
      await sleep(1500);
      await this.recoverAfterDeath();
    });

    this.bot.on('kicked', (reason) => {
      logger.warn(`サーバーからキックされました: ${reason}`);
    });

    this.bot.on('end', () => {
      logger.warn('接続が終了しました。再接続を試みます。');
      this.stopRuntimeLoops();
      this.scheduleReconnect();
    });

    this.bot.on('error', (error) => {
      logger.error('Bot でエラーが発生しました。', error);
    });
  }

  async connect() {
    this.isStopping = false;
    const options = this.buildBotOptions();
    logger.info(`接続を開始します: ${options.host}:${options.port} (${this.config.edition})`);

    this.bot = mineflayer.createBot(options);
    this.attachPlugins();
    this.attachEvents();

    return this.bot;
  }

  scheduleReconnect() {
    if (this.isStopping || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (error) {
        logger.error('再接続に失敗しました。次回再試行します。', error);
        this.scheduleReconnect();
      }
    }, this.config.bot.reconnectDelayMs || 5000);
  }

  async stop() {
    this.isStopping = true;
    this.stopRuntimeLoops();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.bot) {
      this.bot.quit('shutdown');
    }
  }

  stopRuntimeLoops() {
    if (this.afkTimer) {
      clearInterval(this.afkTimer);
      this.afkTimer = null;
    }

    if (this.chatTimer) {
      clearInterval(this.chatTimer);
      this.chatTimer = null;
    }
  }

  startAfkJitter() {
    if (this.afkTimer) {
      clearInterval(this.afkTimer);
    }

    this.afkTimer = setInterval(() => {
      if (!this.bot?.entity) {
        return;
      }

      const yaw = this.bot.entity.yaw + (Math.random() - 0.5) * 0.5;
      const pitch = Math.max(-1.2, Math.min(1.2, this.bot.entity.pitch + (Math.random() - 0.5) * 0.2));
      this.bot.look(yaw, pitch, true).catch(() => {});

      const shouldMove = Math.random() < 0.25;
      if (shouldMove) {
        this.bot.setControlState('jump', Math.random() < 0.2);
        this.bot.setControlState('left', Math.random() < 0.2);
        setTimeout(() => {
          this.bot.setControlState('jump', false);
          this.bot.setControlState('left', false);
        }, 350);
      }
    }, 4000);
  }

  startChattyLoop() {
    if (!this.config.bot.chatty) {
      return;
    }

    const lines = [
      '巡回ログ: 周辺を監視中です。',
      '資材の在庫を確認しています。',
      '安全性チェックを継続中です。',
      '必要なら拠点へ即帰還できます。'
    ];

    if (this.chatTimer) {
      clearInterval(this.chatTimer);
    }

    this.chatTimer = setInterval(() => {
      if (!this.bot || !this.bot.player) {
        return;
      }

      if (Math.random() < 0.35) {
        const line = lines[Math.floor(Math.random() * lines.length)];
        this.bot.chat(line);
      }
    }, 90000);
  }

  async waitForTicks(ticks) {
    const count = Math.max(0, Number(ticks || 0));
    for (let i = 0; i < count; i += 1) {
      await new Promise((resolve) => {
        this.bot.once('physicsTick', resolve);
      });
    }
  }

  async scanNearbyChests(radius = 24) {
    if (!this.bot?.entity) {
      return;
    }

    const blocks = this.bot.findBlocks({
      matching: (block) => block?.name?.includes('chest'),
      maxDistance: radius,
      count: 30
    });

    for (const blockPos of blocks) {
      const block = this.bot.blockAt(blockPos);
      if (!block) {
        continue;
      }

      try {
        const chest = await this.bot.openContainer(block);
        const items = chest.containerItems();
        await this.memoryStore.upsertChest(
          { x: block.position.x, y: block.position.y, z: block.position.z },
          items
        );
        chest.close();
      } catch (error) {
        logger.warn('チェスト走査に失敗したため次へ進みます。', error);
      }
    }
  }

  async retreatToNearestBase() {
    if (!this.bot?.entity) {
      return;
    }

    const origin = {
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y,
      z: this.bot.entity.position.z
    };
    const nearest = this.memoryStore.getNearestBase(origin);

    if (!nearest) {
      logger.warn('退避先拠点が未登録のため退避をスキップします。');
      return;
    }

    try {
      const defaultMove = new Movements(this.bot);
      this.bot.pathfinder.setMovements(defaultMove);
      const goal = new goals.GoalNear(nearest.position.x, nearest.position.y, nearest.position.z, 2);
      await this.bot.pathfinder.goto(goal);
      logger.warn('体力低下のため拠点へ退避しました。');
    } catch (error) {
      logger.warn('拠点退避に失敗しました。', error);
    }
  }

  async recoverAfterDeath() {
    const death = this.memoryStore.getLastDeath();
    if (!death || !this.bot?.entity) {
      return;
    }

    try {
      const goal = new goals.GoalNear(death.position.x, death.position.y, death.position.z, 2);
      await this.bot.pathfinder.goto(goal);
      logger.info('死亡地点へ復帰しました。');
    } catch (error) {
      logger.warn('死亡地点への復帰に失敗しました。', error);
    }
  }

  async safeWithdraw(container, itemType, count) {
    const tickWait = this.isBedrockMode ? this.config.bedrock.waitForTicks : 1;
    await this.waitForTicks(tickWait);
    await container.withdraw(itemType, null, count);
  }

  async fetchItemFromMemory(itemName, amount = 1) {
    if (!this.bot?.entity) {
      return false;
    }

    const origin = {
      x: this.bot.entity.position.x,
      y: this.bot.entity.position.y,
      z: this.bot.entity.position.z
    };
    const chest = this.memoryStore.findNearestChestWithItem(origin, itemName);

    if (!chest) {
      logger.warn(`要求資材が見つかりません: ${itemName}`);
      return false;
    }

    try {
      const target = this.bot.blockAt(chest.position);
      if (!target) {
        return false;
      }

      const goal = new goals.GoalNear(chest.position.x, chest.position.y, chest.position.z, 2);
      await this.bot.pathfinder.goto(goal);
      const container = await this.bot.openContainer(target);
      const hit = container.containerItems().find((item) => item.name.includes(itemName));

      if (!hit) {
        container.close();
        return false;
      }

      await this.safeWithdraw(container, hit.type, Math.min(amount, hit.count));
      container.close();
      logger.info(`資材補充に成功しました: ${itemName}`);
      return true;
    } catch (error) {
      logger.warn(`資材補充に失敗しました: ${itemName}`, error);
      return false;
    }
  }

  async setBaseHere(name) {
    if (!this.bot?.entity) {
      return null;
    }

    const pos = this.bot.entity.position;
    const point = {
      x: Math.floor(pos.x),
      y: Math.floor(pos.y),
      z: Math.floor(pos.z)
    };

    await this.memoryStore.addBase(point, name || 'default');
    return point;
  }

  async collectNearestBlock(blockName) {
    const target = this.bot.findBlock({
      matching: (block) => block?.name === blockName,
      maxDistance: 48
    });

    if (!target) {
      return false;
    }

    try {
      await this.bot.collectBlock.collect(target);
      return true;
    } catch (error) {
      logger.warn(`採取に失敗しました: ${blockName}`, error);
      return false;
    }
  }

  async retreatNow() {
    await this.retreatToNearestBase();
    return true;
  }

  async buildSchem(schemPath) {
    if (!this.bot?.schem?.build) {
      logger.warn('mineflayer-schem が有効化されていないため建築を実行できません。');
      return false;
    }

    try {
      await this.bot.schem.build(schemPath);
      return true;
    } catch (error) {
      logger.warn('建築処理に失敗しました。必要資材補充後に再試行します。', error);
      return false;
    }
  }

  status() {
    const pos = this.bot?.entity?.position;
    return {
      connected: Boolean(this.bot?.player),
      username: this.config.bot.username,
      edition: this.config.edition,
      position: pos
        ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }
        : null,
      health: this.bot?.health || 0,
      food: this.bot?.food || 0,
      inventory: this.bot?.inventory?.items()?.map((item) => ({
        name: item.name,
        count: item.count,
        displayName: item.displayName
      })) || []
    };
  }
}

module.exports = {
  AutonomousBot
};
