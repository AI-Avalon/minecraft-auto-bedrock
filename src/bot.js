const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const collectBlockPlugin = require('mineflayer-collectblock').plugin;
const toolPlugin = require('mineflayer-tool').plugin;
const { logger } = require('./logger');
const { sleep } = require('./utils');
const { JapaneseLLMResponder } = require('./llmChat');
const { BotStateMachine }         = require('./behaviorStateMachine');
const { HumanBehavior }           = require('./humanBehavior');
const { FarmingModule }           = require('./farmingModule');
const { ExplorerModule }          = require('./explorerModule');
const { BranchMiningModule }      = require('./branchMiningModule');
const { ResourceGatheringModule } = require('./resourceGatheringModule');
const { ArmorAnalyzer }           = require('./armorAnalyzer');
const { RecipeAnalyzer }          = require('./recipeAnalyzer');

let autoEat = null;
let movementPlugin;
let schemPlugin;
let pvpPlugin;

// autoEatをES Moduleから動的にロード
(async () => {
  try {
    const autoEatModule = await import('mineflayer-auto-eat');
    autoEat = autoEatModule.loader;
  } catch (err) {
    logger.warn('mineflayer-auto-eat の読み込みに失敗しました:', err.message);
  }
})();

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

try {
  pvpPlugin = require('mineflayer-pvp').plugin;
} catch {
  pvpPlugin = null;
}

class AutonomousBot {
  constructor(config, memoryStore, runtimeContext = {}) {
    this.config = config;
    this.memoryStore = memoryStore;
    this.runtimeContext = runtimeContext;
    this.bot = null;
    this.reconnectTimer = null;
    this.isStopping = false;
    this.afkTimer = null;
    this.chatTimer = null;
    this.autoCollectTask = null;
    this.autoMineTask = null;
    this.combatTask = null;
    this.autoStoreTask = null;
    this.autoSortTask = null;
    this.cityModeTask = null;
    this.evasionEnabled = Boolean(this.config.combat?.evasionEnabled ?? true);
    this.combatProfile = this.config.combat?.profile || 'balanced';
    this.mode = this.config.behavior?.mode || 'hybrid';
    this.role = this.runtimeContext.role || 'worker';
    this.knowledgeService = this.runtimeContext.knowledgeService || null;
    // 新モジュール（bot接続後に初期化）
    this.stateMachine         = null;
    this.humanBehavior        = null;
    this.farmingModule        = null;
    this.explorerModule       = null;
    this.branchMiningModule   = null;
    this.resourceGathering    = null;
    this.armorAnalyzer        = null;
    this.recipeAnalyzer       = null;
    this.combatConfig = {
      healThreshold: Number(this.config.combat?.healThreshold || 10),
      retreatThreshold: Number(this.config.combat?.retreatThreshold || 8),
      rangedPreferDistance: Number(this.config.combat?.rangedPreferDistance || 9),
      meleeMaxDistance: Number(this.config.combat?.meleeMaxDistance || 3)
    };
    this.chatControl = {
      enabled: Boolean(this.config.chatControl?.enabled ?? true),
      requirePrefix: Boolean(this.config.chatControl?.requirePrefix ?? true),
      commandPrefix: this.config.chatControl?.commandPrefix || '!bot',
      allowAllPlayers: Boolean(this.config.chatControl?.allowAllPlayers ?? true),
      allowedPlayers: this.config.chatControl?.allowedPlayers || [],
      playerRoles: this.config.chatControl?.playerRoles || {},
      dangerousCommands: this.config.chatControl?.dangerousCommands || ['mode', 'stop', 'retreat', 'base']
    };
    this.storageConfig = {
      autoStoreIntervalMs: Number(this.config.behavior?.autoStoreIntervalMs || 12_000),
      autoSortIntervalMs: Number(this.config.behavior?.autoSortIntervalMs || 18_000),
      keepInInventory: this.config.behavior?.keepInInventory || [
        'pickaxe', 'axe', 'sword', 'shield', 'bow', 'crossbow', 'arrow', 'torch', 'bread', 'steak', 'totem'
      ]
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
    
    // autoEatはES Moduleなため非同期で読み込まれる可能性がある
    if (autoEat) {
      this.bot.loadPlugin(autoEat);
    } else {
      logger.warn('[Bot] autoEat プラグインが初期化されていません。後で読み込みを試みます。');
      // autoEat を遅延ロード
      this.ensureAutoEatLoaded();
    }

    if (movementPlugin) {
      this.bot.loadPlugin(movementPlugin);
    }

    if (schemPlugin) {
      this.bot.loadPlugin(schemPlugin);
    }

    if (pvpPlugin) {
      this.bot.loadPlugin(pvpPlugin);
    }

    if (this.bot.autoEat) {
      this.bot.autoEat.options = {
        priority: 'foodPoints',
        minHunger: 16,
        offhand: true,
        bannedFood: []
      };
    }
  }

  async ensureAutoEatLoaded() {
    // autoEatをES Moduleから動的にロード（遅延ロード）
    if (!autoEat) {
      try {
        const autoEatModule = await import('mineflayer-auto-eat');
        autoEat = autoEatModule.loader;
        if (this.bot && autoEat) {
          this.bot.loadPlugin(autoEat);
          logger.info('[Bot] autoEat プラグインを遅延ロードしました');
        }
      } catch (err) {
        logger.error('[Bot] autoEat の遅延ロードに失敗しました:', err.message);
      }
    }
  }

  attachEvents() {
    this.bot.once('spawn', async () => {
      logger.info('Bot がスポーンしました。初期化を開始します。');
      this.startAfkJitter();
      this.startChattyLoop();
      this.bot.autoEat.enable();
      await this.scanNearbyChests();

      // ── 新モジュール初期化 ──────────────────────────────────────────────────
      // 人間らしい行動パターン
      this.humanBehavior = new HumanBehavior(this.bot, {
        enableChat:         Boolean(this.config.bot?.chatty ?? true),
        enableJitter:       true,
        enableHeadMovement: true,
        chatInterval:       this.config.behavior?.humanChatIntervalMs || 90_000,
      });
      this.humanBehavior.start();
      // ダメージリアクションをフック
      this.bot.on('entityHurt', (entity) => {
        if (entity === this.bot.entity) this.humanBehavior?.onDamaged();
      });
      // アイテム拾得リアクション
      this.bot.on('playerCollect', (_collector, item) => {
        this.humanBehavior?.onPickup(item);
      });

      // 農業モジュール
      this.farmingModule = new FarmingModule(this.bot, this.memoryStore, {
        scanRadius:  this.config.behavior?.farmScanRadius  || 32,
        autoExpand:  this.config.behavior?.farmAutoExpand  ?? false,
      });

      // 探索モジュール
      this.explorerModule = new ExplorerModule(this.bot, this.memoryStore, {
        stepDistance: this.config.behavior?.explorerStepDistance || 64,
        maxSteps:     this.config.behavior?.explorerMaxSteps     || 20,
      });

      // レシピ解析モジュール（クラフト依存ツリーの解決）
      this.recipeAnalyzer = new RecipeAnalyzer(this.bot, this.memoryStore);
      this.recipeAnalyzer.initialize();

      // 防具解析モジュール（最適防具の自動装備）
      this.armorAnalyzer = new ArmorAnalyzer(this.bot, this.memoryStore);
      this.armorAnalyzer.initialize();

      // ブランチマイニングモジュール（鉱石採掘の自動化）
      this.branchMiningModule = new BranchMiningModule(this.bot, this.memoryStore, {
        safetyChecks:    this.config.behavior?.miningSafetyChecks    ?? true,
        placeTorches:    this.config.behavior?.miningPlaceTorches     ?? true,
        returnThreshold: this.config.behavior?.miningReturnThreshold  || 0.7,
      });

      // リソース収集モジュール（複合採集戦略の調整）
      this.resourceGathering = new ResourceGatheringModule(this.bot, this.memoryStore, {
        farming: this.farmingModule,
        mining:  this.branchMiningModule,
        recipes: this.recipeAnalyzer,
      });

      // 状態機械 AI（autonomous モードのとき起動）
      if (this.mode === 'autonomous') {
        const goalMap = {
          'autonomous': 'auto',
          'silent-mining': 'mine',
        };
        this.stateMachine = new BotStateMachine(this, {
          initialGoal:    goalMap[this.mode] || 'auto',
          tickIntervalMs: this.config.behavior?.stateMachineTickMs || 2000,
        });
        this.stateMachine.attach(this.bot);
        logger.info('[Bot] 自律状態機械 AI を起動しました');
      }
    });

    this.bot.on('health', async () => {
      await this.tryEmergencyRecovery();

      if (this.bot.health <= this.combatConfig.retreatThreshold) {
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

    if (this.autoStoreTask) {
      this.autoStoreTask.running = false;
      this.autoStoreTask = null;
    }

    if (this.autoSortTask) {
      this.autoSortTask.running = false;
      this.autoSortTask = null;
    }

    if (this.combatTask) {
      this.combatTask.running = false;
      this.combatTask = null;
    }

    if (this.cityModeTask) {
      this.cityModeTask.running = false;
      this.cityModeTask = null;
    }

    if (this.bot?.pvp?.stop) {
      this.bot.pvp.stop();
    }

    // 新モジュールのクリーンアップ
    if (this.stateMachine) {
      this.stateMachine.detach();
      this.stateMachine = null;
    }
    if (this.humanBehavior) {
      this.humanBehavior.stop();
      this.humanBehavior = null;
    }
    if (this.explorerModule) {
      this.explorerModule.stop();
      this.explorerModule = null;
    }
    this.farmingModule = null;

    // 新モジュールのクリーンアップ
    if (this.branchMiningModule?._running) {
      this.branchMiningModule._shouldStop = true;
      this.branchMiningModule._running    = false;
    }
    this.branchMiningModule = null;

    if (this.resourceGathering?._running) {
      this.resourceGathering._running = false;
    }
    this.resourceGathering = null;

    this.armorAnalyzer  = null;
    this.recipeAnalyzer = null;
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
      this.sayJapanese('コマンド: mode mine collect gather recipe fight fightmob stop base fetch retreat status help');
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
      this.stopAutoStoreMode();
      this.stopAutoSortMode();
      this.sayJapanese('自動作業を停止しました。');
      return true;
    }

    if (cmd === 'store' || cmd === '保管') {
      const result = await this.storeInventoryToNearestChest();
      this.sayJapanese(result.ok ? `保管完了: ${result.movedStacks}スタック` : '保管先チェストが見つかりません。');
      return true;
    }

    if (cmd === 'autostore' || cmd === '自動保管') {
      const mode = String(args[0] || 'on').toLowerCase();
      if (mode === 'off' || mode === 'stop') {
        const result = this.stopAutoStoreMode();
        this.sayJapanese(result.stopped ? '自動保管モードを停止しました。' : '自動保管モードは停止中です。');
      } else {
        const result = this.startAutoStoreMode();
        this.sayJapanese(result.ok ? '自動保管モードを開始しました。' : '自動保管モードは既に実行中です。');
      }
      return true;
    }

    if (cmd === 'sortchest' || cmd === '仕分け') {
      const result = await this.sortNearestChestsOnce();
      this.sayJapanese(result.ok ? `仕分け実行: ${result.movedStacks}スタック` : '仕分けに失敗しました。');
      return true;
    }

    if (cmd === 'autosort' || cmd === '自動仕分け') {
      const mode = String(args[0] || 'on').toLowerCase();
      if (mode === 'off' || mode === 'stop') {
        const result = this.stopAutoSortMode();
        this.sayJapanese(result.stopped ? '自動仕分けモードを停止しました。' : '自動仕分けモードは停止中です。');
      } else {
        const result = this.startAutoSortMode();
        this.sayJapanese(result.ok ? '自動仕分けモードを開始しました。' : '自動仕分けモードは既に実行中です。');
      }
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

    if (cmd === 'fightmob' || cmd === 'mob') {
      const result = await this.fightNearestMob();
      this.sayJapanese(result.ok ? '近くの敵MOBへ戦闘開始。' : '敵MOBが見つかりません。');
      return true;
    }

    if (cmd === 'fight' || cmd === 'pvp') {
      const target = args[0];
      if (!target) {
        this.sayJapanese('使い方: fight <playerName>');
        return true;
      }
      const result = await this.fightPlayer(target);
      this.sayJapanese(result.ok ? `${target} へ戦闘開始。` : `${target} が見つかりません。`);
      return true;
    }

    if (cmd === 'recipe' || cmd === 'レシピ') {
      const item = args[0];
      const count = Number(args[1] || 1);
      if (!item) {
        this.sayJapanese('使い方: recipe <itemName> <count>');
        return true;
      }
      const plan = this.getRecipePlan(item, count);
      if (!plan.ok) {
        this.sayJapanese('レシピ計算は未有効です。bedrock-samplesを同期してください。');
        return true;
      }
      const top = plan.plan.slice(0, 3).map((x) => `${x.item}x${x.amount}`).join(', ');
      this.sayJapanese(`${item}x${count} の必要素材: ${top || '計算不可'}`);
      return true;
    }

    if (cmd === 'gather' || cmd === '素材') {
      const item = args[0];
      const count = Number(args[1] || 1);
      if (!item) {
        this.sayJapanese('使い方: gather <itemName> <count>');
        return true;
      }
      const result = await this.gatherForCraft(item, count);
      this.sayJapanese(result.ok ? `${item} 用の収集計画を実行しました。` : '素材収集計画を作成できませんでした。');
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

  async safeDeposit(container, itemType, count) {
    const tickWait = this.isBedrockMode ? this.config.bedrock.waitForTicks : 1;
    await this.waitForTicks(tickWait);
    await container.deposit(itemType, null, count);
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

  classifyItem(name = '') {
    const n = String(name || '').toLowerCase();
    if (/(ore|ingot|raw_|diamond|emerald|lapis|redstone|quartz)/.test(n)) {
      return 'ore';
    }
    if (/(log|planks|wood|stick|sapling)/.test(n)) {
      return 'wood';
    }
    if (/(bread|beef|pork|chicken|fish|apple|potato|carrot|melon|berry|food|stew)/.test(n)) {
      return 'food';
    }
    if (/(sword|pickaxe|axe|shovel|hoe|bow|crossbow|shield)/.test(n)) {
      return 'tool';
    }
    if (/(helmet|chestplate|leggings|boots|armor)/.test(n)) {
      return 'armor';
    }
    if (/(gunpowder|bone|string|spider_eye|rotten_flesh|ender_pearl|slime)/.test(n)) {
      return 'mob';
    }
    if (/(stone|cobblestone|deepslate|dirt|sand|gravel|clay)/.test(n)) {
      return 'block';
    }
    return 'misc';
  }

  isEssentialInventoryItem(itemName = '') {
    const n = String(itemName || '').toLowerCase();
    return this.storageConfig.keepInInventory.some((part) => n.includes(String(part).toLowerCase()));
  }

  getNearbyChests(maxDistance = 12, count = 8) {
    const blocks = this.bot.findBlocks({
      matching: (block) => block?.name?.includes('chest'),
      maxDistance,
      count
    });

    return blocks
      .map((p) => this.bot.blockAt(p))
      .filter(Boolean)
      .sort((a, b) => {
        const da = this.bot.entity.position.distanceTo(a.position);
        const db = this.bot.entity.position.distanceTo(b.position);
        return da - db;
      });
  }

  chooseBestChestForItem(itemName, chestBlocks = []) {
    if (chestBlocks.length === 0) {
      return null;
    }

    const category = this.classifyItem(itemName);
    const snapshot = this.memoryStore.snapshot();
    const scored = chestBlocks.map((block) => {
      const key = `${block.position.x},${block.position.y},${block.position.z}`;
      const chest = (snapshot.chests || []).find((x) => x.key === key);
      const same = (chest?.items || []).filter((x) => this.classifyItem(x.name) === category).length;
      return { block, score: same };
    }).sort((a, b) => b.score - a.score);

    return scored[0]?.block || chestBlocks[0];
  }

  async storeInventoryToNearestChest() {
    if (!this.bot?.entity) {
      return { ok: false, reason: 'bot-not-ready' };
    }

    const chestBlocks = this.getNearbyChests(14, 10);
    if (chestBlocks.length === 0) {
      return { ok: false, reason: 'no-chest-found', movedStacks: 0 };
    }

    let movedStacks = 0;
    const items = this.bot.inventory.items().filter((item) => !this.isEssentialInventoryItem(item.name));
    for (const item of items) {
      const targetBlock = this.chooseBestChestForItem(item.name, chestBlocks);
      if (!targetBlock) {
        continue;
      }

      try {
        const goal = new goals.GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, 2);
        // eslint-disable-next-line no-await-in-loop
        await this.bot.pathfinder.goto(goal);
        // eslint-disable-next-line no-await-in-loop
        const container = await this.bot.openContainer(targetBlock);
        // eslint-disable-next-line no-await-in-loop
        await this.safeDeposit(container, item.type, item.count);
        movedStacks += 1;

        const current = container.containerItems();
        // eslint-disable-next-line no-await-in-loop
        await this.memoryStore.upsertChest(targetBlock.position, current);
        container.close();
      } catch (error) {
        logger.warn('自動保管でチェスト投入に失敗しました。', error);
      }
    }

    return { ok: true, movedStacks };
  }

  startAutoStoreMode() {
    if (this.autoStoreTask?.running) {
      return { ok: false, reason: 'already-running' };
    }

    const task = {
      running: true,
      startedAt: Date.now(),
      lastResult: null
    };
    this.autoStoreTask = task;

    (async () => {
      while (task.running) {
        // eslint-disable-next-line no-await-in-loop
        task.lastResult = await this.storeInventoryToNearestChest();
        // eslint-disable-next-line no-await-in-loop
        await sleep(this.storageConfig.autoStoreIntervalMs);
      }
      this.autoStoreTask = null;
    })().catch((error) => {
      logger.warn('自動保管モードでエラーが発生しました。', error);
      this.autoStoreTask = null;
    });

    return { ok: true, started: true };
  }

  stopAutoStoreMode() {
    if (!this.autoStoreTask) {
      return { ok: true, stopped: false };
    }

    this.autoStoreTask.running = false;
    return { ok: true, stopped: true };
  }

  async moveItemBetweenChests(sourceBlock, targetBlock, item, moveCount) {
    const sourceGoal = new goals.GoalNear(sourceBlock.position.x, sourceBlock.position.y, sourceBlock.position.z, 2);
    await this.bot.pathfinder.goto(sourceGoal);
    const source = await this.bot.openContainer(sourceBlock);
    await this.safeWithdraw(source, item.type, moveCount);
    const sourceItems = source.containerItems();
    await this.memoryStore.upsertChest(sourceBlock.position, sourceItems);
    source.close();

    const targetGoal = new goals.GoalNear(targetBlock.position.x, targetBlock.position.y, targetBlock.position.z, 2);
    await this.bot.pathfinder.goto(targetGoal);
    const target = await this.bot.openContainer(targetBlock);
    const invItem = this.bot.inventory.items().find((x) => x.type === item.type);
    if (invItem) {
      await this.safeDeposit(target, invItem.type, Math.min(moveCount, invItem.count));
    }
    const targetItems = target.containerItems();
    await this.memoryStore.upsertChest(targetBlock.position, targetItems);
    target.close();
  }

  buildChestCategoryMap(chestBlocks = []) {
    const categories = ['ore', 'wood', 'food', 'tool', 'armor', 'mob', 'block', 'misc'];
    const map = new Map();
    const snapshot = this.memoryStore.snapshot();

    chestBlocks.forEach((block, index) => {
      const key = `${block.position.x},${block.position.y},${block.position.z}`;
      const chest = (snapshot.chests || []).find((x) => x.key === key);
      if (!chest?.items?.length) {
        map.set(key, categories[index % categories.length]);
        return;
      }

      const score = new Map();
      for (const item of chest.items) {
        const cat = this.classifyItem(item.name);
        score.set(cat, (score.get(cat) || 0) + Number(item.count || 0));
      }

      const top = [...score.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || categories[index % categories.length];
      map.set(key, top);
    });

    return map;
  }

  async sortNearestChestsOnce(maxMoves = 12) {
    const chestBlocks = this.getNearbyChests(14, 10);
    if (chestBlocks.length < 2) {
      return { ok: false, reason: 'need-multiple-chests', movedStacks: 0 };
    }

    const categoryMap = this.buildChestCategoryMap(chestBlocks);
    let movedStacks = 0;

    for (const sourceBlock of chestBlocks) {
      if (movedStacks >= maxMoves) {
        break;
      }

      try {
        const sourceGoal = new goals.GoalNear(sourceBlock.position.x, sourceBlock.position.y, sourceBlock.position.z, 2);
        // eslint-disable-next-line no-await-in-loop
        await this.bot.pathfinder.goto(sourceGoal);
        // eslint-disable-next-line no-await-in-loop
        const container = await this.bot.openContainer(sourceBlock);
        const sourceKey = `${sourceBlock.position.x},${sourceBlock.position.y},${sourceBlock.position.z}`;
        const sourceCategory = categoryMap.get(sourceKey);
        const items = container.containerItems();
        container.close();

        for (const item of items) {
          if (movedStacks >= maxMoves) {
            break;
          }

          const itemCategory = this.classifyItem(item.name);
          if (itemCategory === sourceCategory) {
            continue;
          }

          const targetBlock = chestBlocks.find((block) => {
            const key = `${block.position.x},${block.position.y},${block.position.z}`;
            return key !== sourceKey && categoryMap.get(key) === itemCategory;
          });

          if (!targetBlock) {
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          await this.moveItemBetweenChests(sourceBlock, targetBlock, item, Math.min(item.count, 16));
          movedStacks += 1;
        }
      } catch (error) {
        logger.warn('チェスト仕分け中の処理に失敗しました。', error);
      }
    }

    return { ok: true, movedStacks };
  }

  startAutoSortMode() {
    if (this.autoSortTask?.running) {
      return { ok: false, reason: 'already-running' };
    }

    const task = {
      running: true,
      startedAt: Date.now(),
      lastResult: null
    };
    this.autoSortTask = task;

    (async () => {
      while (task.running) {
        // eslint-disable-next-line no-await-in-loop
        task.lastResult = await this.sortNearestChestsOnce(8);
        // eslint-disable-next-line no-await-in-loop
        await sleep(this.storageConfig.autoSortIntervalMs);
      }
      this.autoSortTask = null;
    })().catch((error) => {
      logger.warn('自動仕分けモードでエラーが発生しました。', error);
      this.autoSortTask = null;
    });

    return { ok: true, started: true };
  }

  stopAutoSortMode() {
    if (!this.autoSortTask) {
      return { ok: true, stopped: false };
    }

    this.autoSortTask.running = false;
    return { ok: true, stopped: true };
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

  findInventoryItemByNames(nameParts = []) {
    const normalized = nameParts.map((x) => String(x).toLowerCase());
    return this.bot?.inventory?.items()?.find((item) => {
      const itemName = String(item.name || '').toLowerCase();
      return normalized.some((part) => itemName.includes(part));
    }) || null;
  }

  async tryEmergencyRecovery() {
    if (!this.bot?.health) {
      return false;
    }

    if (this.bot.health > this.combatConfig.healThreshold) {
      return false;
    }

    const healItem = this.findInventoryItemByNames(['golden_apple', 'enchanted_golden_apple', 'potion']);
    if (!healItem) {
      return false;
    }

    try {
      await this.bot.equip(healItem, 'hand');
      this.bot.activateItem();
      await sleep(900);
      this.bot.deactivateItem();
      return true;
    } catch (error) {
      logger.warn('緊急回復アイテムの使用に失敗しました。', error);
      return false;
    }
  }

  getEntityTactic(entity) {
    const name = String(entity?.name || '').toLowerCase();
    const rangedKeep = this.combatConfig.rangedPreferDistance;
    const meleeKeep = this.combatConfig.meleeMaxDistance;
    const map = {
      creeper: { style: 'ranged', keepDistance: Math.max(7, rangedKeep), weapon: ['bow', 'crossbow'] },
      witch: { style: 'ranged', keepDistance: Math.max(7, rangedKeep), weapon: ['bow', 'crossbow'] },
      skeleton: { style: 'melee', keepDistance: meleeKeep, weapon: ['sword', 'axe'] },
      spider: { style: 'melee', keepDistance: meleeKeep, weapon: ['sword', 'axe'] },
      enderman: { style: 'melee', keepDistance: meleeKeep, weapon: ['sword', 'axe'] }
    };

    return map[name] || { style: 'melee', keepDistance: meleeKeep, weapon: ['sword', 'axe'] };
  }

  async equipCombatLoadout(entity) {
    const tactic = this.getEntityTactic(entity);
    const weapon = this.findInventoryItemByNames(tactic.weapon);
    if (weapon) {
      try {
        await this.bot.equip(weapon, 'hand');
      } catch {}
    }

    const offhand = this.findInventoryItemByNames(['shield', 'totem']);
    if (offhand) {
      try {
        await this.bot.equip(offhand, 'off-hand');
      } catch {}
    }

    return tactic;
  }

  async tryRangedAttack(entity) {
    const ranged = this.findInventoryItemByNames(['bow', 'crossbow']);
    if (!ranged) {
      return { ok: false, reason: 'ranged-weapon-not-found' };
    }

    try {
      await this.bot.equip(ranged, 'hand');
      await this.bot.lookAt(entity.position.offset(0, 1.4, 0), true);
      this.bot.activateItem();
      await sleep(ranged.name.includes('crossbow') ? 1200 : 900);
      this.bot.deactivateItem();
      return { ok: true, weapon: ranged.name };
    } catch (error) {
      logger.warn('遠距離攻撃に失敗しました。', error);
      return { ok: false, reason: 'ranged-attack-failed' };
    }
  }

  async performEvasionStep() {
    if (!this.evasionEnabled || !this.bot) {
      return;
    }

    const useSneakBack = Math.random() < 0.6;
    const useStrafeLeft = Math.random() < 0.5;

    this.bot.setControlState('sneak', useSneakBack);
    this.bot.setControlState('back', useSneakBack);
    this.bot.setControlState('left', useStrafeLeft);
    this.bot.setControlState('right', !useStrafeLeft && Math.random() < 0.5);

    await sleep(350 + Math.floor(Math.random() * 220));

    this.bot.setControlState('sneak', false);
    this.bot.setControlState('back', false);
    this.bot.setControlState('left', false);
    this.bot.setControlState('right', false);
  }

  setCombatProfile(profileName) {
    const normalized = String(profileName || '').toLowerCase();
    const presets = {
      balanced: { rangedPreferDistance: 9, meleeMaxDistance: 3, evasionEnabled: true },
      berserker: { rangedPreferDistance: 6, meleeMaxDistance: 2, evasionEnabled: false },
      guardian: { rangedPreferDistance: 11, meleeMaxDistance: 3, evasionEnabled: true },
      sniper: { rangedPreferDistance: 14, meleeMaxDistance: 4, evasionEnabled: true }
    };

    const next = presets[normalized];
    if (!next) {
      return { ok: false, reason: 'unknown-profile' };
    }

    this.combatProfile = normalized;
    this.combatConfig.rangedPreferDistance = next.rangedPreferDistance;
    this.combatConfig.meleeMaxDistance = next.meleeMaxDistance;
    this.evasionEnabled = next.evasionEnabled;
    return { ok: true, profile: normalized, config: { ...this.combatConfig, evasionEnabled: this.evasionEnabled } };
  }

  setEvasionEnabled(enabled) {
    this.evasionEnabled = Boolean(enabled);
    return { ok: true, evasionEnabled: this.evasionEnabled };
  }

  async craftItem(itemName, count = 1) {
    if (!this.bot?.registry) {
      return { ok: false, reason: 'bot-not-ready' };
    }

    // recipeAnalyzer が初期化済みの場合はそちらに委譲（より高度なクラフト計画）
    if (this.recipeAnalyzer) {
      return this.recipeAnalyzer.craftItem(itemName, Number(count || 1));
    }

    const target = this.bot.registry.itemsByName[itemName];
    if (!target) {
      return { ok: false, reason: 'unknown-item' };
    }

    const table = this.bot.findBlock({
      matching: (block) => block?.name === 'crafting_table',
      maxDistance: 12
    });

    const recipes = this.bot.recipesFor(target.id, null, 1, table || null);
    if (!recipes || recipes.length === 0) {
      return { ok: false, reason: 'recipe-not-found' };
    }

    const recipe = recipes[0];
    const perCraft = Number(recipe.result?.count || 1);
    const times = Math.max(1, Math.ceil(Number(count || 1) / perCraft));

    try {
      await this.bot.craft(recipe, times, table || null);
      return { ok: true, itemName, count: Number(count || 1), times };
    } catch (error) {
      logger.warn('クラフト処理に失敗しました。', error);
      return { ok: false, reason: 'craft-failed' };
    }
  }

  async equipBestArmor() {
    const priorities = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'];
    const slots = [
      { slot: 'head', suffix: 'helmet' },
      { slot: 'torso', suffix: 'chestplate' },
      { slot: 'legs', suffix: 'leggings' },
      { slot: 'feet', suffix: 'boots' }
    ];

    const equipped = [];
    for (const info of slots) {
      const names = priorities.map((p) => `${p}_${info.suffix}`);
      const item = this.findInventoryItemByNames(names);
      if (!item) {
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.bot.equip(item, info.slot);
        equipped.push(item.name);
      } catch {}
    }

    return { ok: true, equipped };
  }

  async startCityMode(modeName = 'village') {
    if (this.cityModeTask?.running) {
      return { ok: false, reason: 'already-running' };
    }

    const task = {
      running: true,
      modeName,
      startedAt: Date.now()
    };
    this.cityModeTask = task;

    (async () => {
      while (task.running) {
        // 最低限の街づくりループ: 木材収集→装備整備→周回会話
        // eslint-disable-next-line no-await-in-loop
        await this.startAutoCollect('oak_log', 32);
        // eslint-disable-next-line no-await-in-loop
        await this.equipBestArmor();
        this.sayJapanese('街づくりモード: 資材を整えて開発を進めています。');
        // eslint-disable-next-line no-await-in-loop
        await sleep(15_000);
      }

      this.cityModeTask = null;
    })().catch((error) => {
      logger.warn('街づくりモードでエラーが発生しました。', error);
      this.cityModeTask = null;
    });

    return { ok: true, started: true, modeName };
  }

  stopCityMode() {
    if (!this.cityModeTask) {
      return { ok: true, stopped: false };
    }
    this.cityModeTask.running = false;
    return { ok: true, stopped: true };
  }

  async executeCombatTactic(entity, durationMs = 12_000) {
    if (!entity) {
      return { ok: false, reason: 'no-target' };
    }

    const tactic = await this.equipCombatLoadout(entity);
    const startedAt = Date.now();
    this.combatTask = { running: true, target: entity.name, style: tactic.style };

    while (this.combatTask?.running && Date.now() - startedAt < durationMs) {
      if (!entity.isValid) {
        break;
      }

      await this.tryEmergencyRecovery();

      const me = this.bot.entity?.position;
      const targetPos = entity.position;
      if (!me || !targetPos) {
        break;
      }

      const distance = me.distanceTo(targetPos);

      if (tactic.style === 'ranged' && distance >= tactic.keepDistance - 1) {
        // 遠距離戦術: 距離維持して弓攻撃
        // eslint-disable-next-line no-await-in-loop
        await this.tryRangedAttack(entity);
      } else if (this.bot.pvp?.attack) {
        this.bot.pvp.attack(entity);
      } else {
        this.bot.attack(entity);
      }

      // 人間らしい回避: しゃがみ後退とストレイフを混ぜる
      // eslint-disable-next-line no-await-in-loop
      await this.performEvasionStep();

      // eslint-disable-next-line no-await-in-loop
      await sleep(700);
    }

    if (this.bot?.pvp?.stop) {
      this.bot.pvp.stop();
    }

    this.combatTask = null;
    return { ok: true, target: entity.name, style: tactic.style };
  }

  findNearestHostileMob(maxDistance = 24) {
    if (!this.bot?.nearestEntity) {
      return null;
    }

    const hostile = new Set([
      'zombie', 'husk', 'drowned', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'pillager'
    ]);

    return this.bot.nearestEntity((entity) => {
      if (!entity || entity.type !== 'mob') {
        return false;
      }
      if (!hostile.has(entity.name)) {
        return false;
      }

      const me = this.bot.entity?.position;
      const target = entity.position;
      if (!me || !target) {
        return false;
      }

      return me.distanceTo(target) <= maxDistance;
    });
  }

  async attackEntity(entity, durationMs = 12_000) {
    if (!entity || !this.bot) {
      return { ok: false, reason: 'no-target' };
    }
    return this.executeCombatTactic(entity, durationMs);
  }

  async fightNearestMob() {
    const mob = this.findNearestHostileMob(28);
    if (!mob) {
      return { ok: false, reason: 'mob-not-found' };
    }
    return this.attackEntity(mob, 15_000);
  }

  async fightPlayer(playerName) {
    const player = this.bot?.players?.[playerName]?.entity;
    if (!player) {
      return { ok: false, reason: 'player-not-found' };
    }
    return this.attackEntity(player, 15_000);
  }

  stopFight() {
    if (this.bot?.pvp?.stop) {
      this.bot.pvp.stop();
    }
    this.combatTask = null;
    return { ok: true };
  }

  getRecipePlan(itemName, count = 1) {
    if (!this.knowledgeService) {
      return { ok: false, reason: 'knowledge-service-disabled' };
    }

    const plan = this.knowledgeService.buildGatherPlan(itemName, Number(count || 1));
    return {
      ok: true,
      itemName,
      count: Number(count || 1),
      plan
    };
  }

  async gatherForCraft(itemName, count = 1) {
    if (!this.knowledgeService) {
      return { ok: false, reason: 'knowledge-service-disabled' };
    }

    const gatherPlan = this.knowledgeService.buildGatherPlan(itemName, Number(count || 1));
    const actions = [];

    for (const step of gatherPlan.slice(0, 8)) {
      const candidate = step.hints?.blocks?.[0];
      if (candidate) {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.startAutoCollect(candidate, Math.min(64, Number(step.amount || 1)));
        actions.push({ type: 'collect', item: candidate, result });
      } else {
        actions.push({ type: 'manual', item: step.item, reason: 'drop-source-required', sources: step.sources });
      }
    }

    return {
      ok: true,
      itemName,
      count: Number(count || 1),
      actions
    };
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

  // ── ブランチマイニング ────────────────────────────────────────────────────
  /**
   * ブランチマイニングセッションを開始する
   * @param {object} options - BranchMiningModule のオプション
   * @returns {object} 結果
   */
  async startBranchMining(options = {}) {
    if (!this.branchMiningModule) {
      return { ok: false, reason: 'branch-mining-module-not-initialized' };
    }
    return this.branchMiningModule.startBranchMining(options);
  }

  // ── リソース収集 ──────────────────────────────────────────────────────────
  /**
   * 収集プランを実行する
   * @param {Array|string} plan - [{resource, count, strategy}] の配列、またはリソース名
   * @param {number} count      - plan が文字列の場合の収集数
   * @param {object} options    - オプション（strategy など）
   * @returns {object} 収集結果
   */
  async gatherResources(plan, count = 1, options = {}) {
    if (!this.resourceGathering) {
      return { ok: false, reason: 'resource-gathering-module-not-initialized' };
    }
    // 配列なら gatherAll、文字列なら gatherResources
    if (Array.isArray(plan)) {
      return this.resourceGathering.gatherAll(plan);
    }
    return this.resourceGathering.gatherResources(plan, count, options);
  }

  // ── 防具自動装備 ──────────────────────────────────────────────────────────
  /**
   * インベントリから最良の防具を自動装備する
   * @returns {object} 装備結果
   */
  async autoEquipArmor() {
    if (!this.armorAnalyzer) {
      return { ok: false, reason: 'armor-analyzer-not-initialized' };
    }
    return this.armorAnalyzer.autoEquipBestArmor();
  }

  status() {
    const pos = this.bot?.entity?.position;
    return {
      connected: Boolean(this.bot?.player),
      username: this.config.bot.username,
      role: this.role,
      edition: this.config.edition,
      position: pos
        ? { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }
        : null,
      health: this.bot?.health || 0,
      food: this.bot?.food || 0,
      automation: {
        mode: this.mode,
        combatProfile: this.combatProfile,
        evasionEnabled: this.evasionEnabled,
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
        } : null,
        autoStore: this.autoStoreTask ? {
          running: this.autoStoreTask.running,
          startedAt: this.autoStoreTask.startedAt,
          lastResult: this.autoStoreTask.lastResult
        } : null,
        autoSort: this.autoSortTask ? {
          running: this.autoSortTask.running,
          startedAt: this.autoSortTask.startedAt,
          lastResult: this.autoSortTask.lastResult
        } : null,
        combat: this.combatTask ? {
          running: this.combatTask.running,
          target: this.combatTask.target
        } : null,
        cityMode: this.cityModeTask ? {
          running: this.cityModeTask.running,
          modeName: this.cityModeTask.modeName,
          startedAt: this.cityModeTask.startedAt
        } : null
      },
      mode: this.mode,
      knowledgeEnabled: Boolean(this.knowledgeService),
      inventory: this.bot?.inventory?.items()?.map((item) => ({
        name: item.name,
        count: item.count,
        displayName: item.displayName
      })) || [],
      stateMachine:     this.stateMachine?.getStatus()          || null,
      farming:          this.farmingModule?.getStatus()          || null,
      explorer:         this.explorerModule?.getStatus()         || null,
      branchMining:     this.branchMiningModule?.getProgress()   || null,
      resourceGathering: this.resourceGathering?.getStatus()     || null,
      armorScore:       this.armorAnalyzer?.getArmorScore()      ?? null,
    };
  }
}

module.exports = {
  AutonomousBot
};
