const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const collectBlockPlugin = require('mineflayer-collectblock').plugin;
const toolPlugin = require('mineflayer-tool').plugin;
const autoEat = require('mineflayer-auto-eat').plugin;
const { logger } = require('./logger');
const { sleep } = require('./utils');
const { JapaneseLLMResponder } = require('./llmChat');

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
    this.autoCollectTask = null;
    this.autoMineTask = null;
    this.mode = this.config.behavior?.mode || 'hybrid';
    this.chatControl = {
      enabled: Boolean(this.config.chatControl?.enabled ?? true),
      requirePrefix: Boolean(this.config.chatControl?.requirePrefix ?? true),
      commandPrefix: this.config.chatControl?.commandPrefix || '!bot',
      allowAllPlayers: Boolean(this.config.chatControl?.allowAllPlayers ?? true),
      allowedPlayers: this.config.chatControl?.allowedPlayers || [],
      playerRoles: this.config.chatControl?.playerRoles || {},
      dangerousCommands: this.config.chatControl?.dangerousCommands || ['mode', 'stop', 'retreat', 'base']
    };
    this.llmResponder = new JapaneseLLMResponder(this.config.llm || {}, this.config.bot.username);
  }

  get isBedrockMode() {
    return this.config.edition === 'bedrock';
  }

  assertConnectionAllowed(host) {
    const policy = this.config.connectionPolicy || {};
    if (policy.allowExternalServers === false) {
      const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(String(host || '').toLowerCase());
      if (!isLocal) {
        throw new Error(`外部サーバー接続が無効化されています: ${host}`);
      }
    }

    const allowedHosts = Array.isArray(policy.allowedHosts) ? policy.allowedHosts : [];
    if (allowedHosts.length > 0 && !allowedHosts.includes(host)) {
      throw new Error(`接続先ホストが許可リスト外です: ${host}`);
    }
  }

  buildBotOptions() {
    const base = {
      username: this.config.bot.username,
      password: this.config.bot.password || undefined,
      auth: this.config.bot.auth || 'offline'
    };

    if (this.config.edition === 'java') {
      this.assertConnectionAllowed(this.config.java.host);
      return {
        ...base,
        host: this.config.java.host,
        port: this.config.java.port,
        version: this.config.java.version || false
      };
    }

    this.assertConnectionAllowed(this.config.bedrock.proxy.listenHost);

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

    this.bot.on('chat', async (username, message) => {
      if (!this.bot || username === this.bot.username) {
        return;
      }

      await this.handlePlayerChat(username, String(message || ''));
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

    if (this.autoCollectTask) {
      this.autoCollectTask.running = false;
      this.autoCollectTask = null;
    }

    if (this.autoMineTask) {
      this.autoMineTask.running = false;
      this.autoMineTask = null;
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
    if (!this.config.bot.chatty || !this.isChattyEnabled()) {
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
        this.sayJapanese(line);
      }
    }, 90000);
  }

  isChattyEnabled() {
    return ['hybrid', 'autonomous', 'conversation'].includes(this.mode);
  }

  isPlayerControlEnabled() {
    return this.chatControl.enabled && ['hybrid', 'player-command', 'conversation'].includes(this.mode);
  }

  isConversationEnabled() {
    return this.llmResponder.isEnabled && ['hybrid', 'conversation'].includes(this.mode);
  }

  sayJapanese(text) {
    if (!this.bot?.player) {
      return;
    }
    if (this.mode === 'silent-mining') {
      return;
    }
    this.bot.chat(String(text));
  }

  isPlayerAuthorized(username) {
    if (this.chatControl.allowAllPlayers) {
      return true;
    }
    const normalized = String(username || '').toLowerCase();
    return this.chatControl.allowedPlayers.map((x) => String(x).toLowerCase()).includes(normalized);
  }

  getPlayerRole(username) {
    const normalized = String(username || '').toLowerCase();
    const entries = Object.entries(this.chatControl.playerRoles || {});
    for (const [name, role] of entries) {
      if (String(name).toLowerCase() === normalized) {
        return String(role || 'general').toLowerCase();
      }
    }
    return 'general';
  }

  canExecuteCommand(username, cmd) {
    const dangerous = new Set((this.chatControl.dangerousCommands || []).map((x) => String(x).toLowerCase()));
    if (!dangerous.has(String(cmd || '').toLowerCase())) {
      return true;
    }

    return this.getPlayerRole(username) === 'admin';
  }

  parseCommandText(message) {
    const text = String(message || '').trim();
    if (!text) {
      return null;
    }

    if (this.chatControl.requirePrefix) {
      const prefix = this.chatControl.commandPrefix;
      if (!text.startsWith(prefix)) {
        return null;
      }
      return text.slice(prefix.length).trim();
    }

    return text;
  }

  parseModeName(raw) {
    const m = String(raw || '').toLowerCase();
    const map = {
      silent: 'silent-mining',
      'silent-mining': 'silent-mining',
      mining: 'silent-mining',
      hybrid: 'hybrid',
      conversation: 'conversation',
      chat: 'conversation',
      control: 'player-command',
      'player-command': 'player-command',
      autonomous: 'autonomous'
    };
    return map[m] || null;
  }

  async handleControlCommand(username, commandLine) {
    const [cmdRaw, ...args] = commandLine.split(/\s+/).filter(Boolean);
    const cmd = String(cmdRaw || '').toLowerCase();

    if (!cmd) {
      return false;
    }

    if (!this.canExecuteCommand(username, cmd)) {
      this.sayJapanese(`${username}さん、そのコマンドは管理者のみ実行できます。`);
      return true;
    }

    if (cmd === 'help' || cmd === 'ヘルプ') {
      this.sayJapanese('コマンド: mode mine collect stop base fetch retreat status help');
      return true;
    }

    if (cmd === 'mode' || cmd === 'モード') {
      const nextMode = this.parseModeName(args[0]);
      if (!nextMode) {
        this.sayJapanese('モード指定が不正です。silent-mining / hybrid / conversation / player-command / autonomous');
        return true;
      }
      this.mode = nextMode;
      this.sayJapanese(`モードを ${nextMode} に変更しました。`);
      return true;
    }

    if (cmd === 'status' || cmd === '状態') {
      const s = this.status();
      this.sayJapanese(`状態: mode=${s.mode}, hp=${s.health}, food=${s.food}`);
      return true;
    }

    if (cmd === 'stop' || cmd === '停止') {
      this.stopAutoCollect();
      this.stopAutoMine();
      this.sayJapanese('自動作業を停止しました。');
      return true;
    }

    if (cmd === 'base' || cmd === '拠点') {
      const point = await this.setBaseHere(args[0] || `${username}-base`);
      if (point) {
        this.sayJapanese(`拠点登録: ${point.x}, ${point.y}, ${point.z}`);
      }
      return true;
    }

    if (cmd === 'fetch' || cmd === '補充') {
      const itemName = args[0];
      const amount = Number(args[1] || 1);
      if (!itemName) {
        this.sayJapanese('使い方: fetch <itemName> <amount>');
        return true;
      }
      const ok = await this.fetchItemFromMemory(itemName, amount);
      this.sayJapanese(ok ? `${itemName} を補充しました。` : `${itemName} の補充に失敗しました。`);
      return true;
    }

    if (cmd === 'retreat' || cmd === '退避') {
      await this.retreatNow();
      this.sayJapanese('退避を実行します。');
      return true;
    }

    if (cmd === 'mine' || cmd === '採掘' || cmd === 'collect' || cmd === '採取') {
      const blockName = args[0];
      const count = Number(args[1] || 32);
      if (!blockName) {
        this.sayJapanese('使い方: mine <blockName> <count>');
        return true;
      }
      const result = await this.startAutoCollect(blockName, count);
      this.sayJapanese(`${blockName} 採取: ${result.finalCount}/${result.targetCount}`);
      return true;
    }

    return false;
  }

  async handlePlayerChat(username, message) {
    if (!this.isPlayerAuthorized(username)) {
      return;
    }

    const commandText = this.parseCommandText(message);
    if (this.isPlayerControlEnabled() && commandText) {
      const consumed = await this.handleControlCommand(username, commandText);
      if (consumed) {
        return;
      }
    }

    if (!this.isConversationEnabled()) {
      return;
    }

    const mention = message.includes(this.bot.username) || message.startsWith('@bot');
    if (!mention) {
      return;
    }

    const s = this.status();
    const snapshot = this.memoryStore.snapshot();
    const inventoryText = (s.inventory || [])
      .slice(0, 8)
      .map((item) => `${item.displayName}x${item.count}`)
      .join(', ');
    const chestText = (snapshot.chests || [])
      .slice(0, 3)
      .map((chest) => {
        const top = (chest.items || []).slice(0, 3).map((it) => `${it.displayName}x${it.count}`).join(', ');
        return `${chest.position.x},${chest.position.y},${chest.position.z}[${top}]`;
      })
      .join(' | ');

    const contextText = [
      `mode=${s.mode}`,
      `hp=${s.health}`,
      `food=${s.food}`,
      `pos=${s.position ? `${s.position.x},${s.position.y},${s.position.z}` : 'n/a'}`,
      `inv=${inventoryText || 'empty'}`,
      `memoryChests=${snapshot.chests?.length || 0}`,
      `nearChests=${chestText || 'none'}`
    ].join(', ');
    const reply = await this.llmResponder.generateReply(username, message, contextText);
    if (reply) {
      this.sayJapanese(reply.slice(0, 120));
    }
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

  countInventoryItems(namePart) {
    const normalized = String(namePart || '').toLowerCase();
    return this.bot?.inventory?.items()?.reduce((sum, item) => {
      return item.name.toLowerCase().includes(normalized) ? sum + item.count : sum;
    }, 0) || 0;
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
      if (this.bot.tool?.equipForBlock) {
        await this.bot.tool.equipForBlock(target);
      }
      await this.bot.collectBlock.collect(target);
      return true;
    } catch (error) {
      logger.warn(`採取に失敗しました: ${blockName}`, error);
      return false;
    }
  }

  async startAutoCollect(blockName, targetCount = 64) {
    if (this.autoCollectTask?.running) {
      return { ok: false, reason: 'already-running' };
    }

    const task = {
      running: true,
      blockName,
      targetCount: Number(targetCount || 64),
      collected: 0,
      attempts: 0
    };
    this.autoCollectTask = task;

    while (task.running && this.countInventoryItems(blockName) < task.targetCount) {
      task.attempts += 1;
      const ok = await this.collectNearestBlock(blockName);
      if (!ok) {
        await sleep(1200);
      }
      task.collected = this.countInventoryItems(blockName);

      if (task.attempts > 120) {
        break;
      }
    }

    const finalCount = this.countInventoryItems(blockName);
    const completed = finalCount >= task.targetCount;
    this.autoCollectTask = null;

    return {
      ok: completed,
      blockName,
      targetCount: task.targetCount,
      finalCount,
      attempts: task.attempts
    };
  }

  stopAutoCollect() {
    if (!this.autoCollectTask) {
      return { ok: true, stopped: false };
    }

    this.autoCollectTask.running = false;
    this.autoCollectTask = null;
    return { ok: true, stopped: true };
  }

  async startAutoMine() {
    if (this.autoMineTask?.running) {
      return { ok: false, reason: 'already-running' };
    }

    const task = {
      running: true,
      plan: [
        { block: 'coal_ore', count: 32 },
        { block: 'iron_ore', count: 32 },
        { block: 'cobblestone', count: 128 }
      ],
      completed: []
    };

    this.autoMineTask = task;

    for (const step of task.plan) {
      if (!task.running) {
        break;
      }
      const result = await this.startAutoCollect(step.block, step.count);
      task.completed.push(result);
      await sleep(300);
    }

    const summary = { ok: true, completed: task.completed };
    this.autoMineTask = null;
    return summary;
  }

  stopAutoMine() {
    if (!this.autoMineTask) {
      return { ok: true, stopped: false };
    }

    this.autoMineTask.running = false;
    return { ok: true, stopped: true };
  }

  async autoBuildWithRefill(schemPath, requiredItems = []) {
    const first = await this.buildSchem(schemPath);
    if (first) {
      return { ok: true, attempt: 1 };
    }

    // 建築失敗時は記憶チェストから必要資材を補充して1回だけリトライする。
    for (const req of requiredItems) {
      await this.fetchItemFromMemory(req.itemName, req.amount || 64);
      await sleep(150);
    }

    const second = await this.buildSchem(schemPath);
    return { ok: second, attempt: 2 };
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
      automation: {
        mode: this.mode,
        playerControlEnabled: this.isPlayerControlEnabled(),
        conversationEnabled: this.isConversationEnabled(),
        autoCollect: this.autoCollectTask ? {
          blockName: this.autoCollectTask.blockName,
          targetCount: this.autoCollectTask.targetCount,
          collected: this.autoCollectTask.collected,
          attempts: this.autoCollectTask.attempts
        } : null,
        autoMine: this.autoMineTask ? {
          running: this.autoMineTask.running,
          plan: this.autoMineTask.plan
        } : null
      },
      mode: this.mode,
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
