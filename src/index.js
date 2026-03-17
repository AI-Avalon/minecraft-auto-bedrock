const { loadConfig } = require('./config');
const { logger } = require('./logger');
const { ViaProxyManager } = require('./viaproxy');
const { MemoryStore } = require('./memoryStore');
const { AutonomousBot } = require('./bot');
const { startGuiServer } = require('./guiServer');
const { JavaServerManager } = require('./javaServer');
const { FleetController, FleetMemoryStore } = require('./fleetController');
const { BedrockDataService } = require('./bedrockDataService');
const { checkStartupUpdates } = require('./systemManager');

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return override === undefined ? base : override;
  }

  const merged = { ...(base || {}) };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function buildBotRuntimeConfigs(config) {
  const fleet = config.multiBot || {};
  const bots = Array.isArray(fleet.bots) ? fleet.bots : [];

  if (!fleet.enabled || bots.length === 0) {
    return [
      {
        id: config.bot.username,
        role: 'primary',
        config
      }
    ];
  }

  return bots.map((entry, index) => {
    const override = {
      bot: {
        username: entry.username || `Bot${index + 1}`
      },
      behavior: entry.behavior || undefined,
      chatControl: entry.chatControl || undefined,
      llm: entry.llm || undefined,
      java: entry.java || undefined,
      bedrock: entry.bedrock || undefined,
      memory: {
        file: entry.memoryFile || `memory-${entry.id || entry.username || index + 1}.json`
      }
    };

    return {
      id: entry.id || entry.username || `bot-${index + 1}`,
      role: entry.role || (index === 0 ? 'primary' : 'worker'),
      config: deepMerge(config, override)
    };
  });
}

function buildRuntimeFromSpec(baseConfig, spec = {}, index = 0) {
  const id = spec.id || spec.username || `bot-${index + 1}`;
  const override = {
    bot: {
      username: spec.username || `Bot${index + 1}`,
      password: spec.password,
      auth: spec.auth
    },
    behavior: spec.behavior,
    chatControl: spec.chatControl,
    llm: spec.llm,
    java: spec.java,
    bedrock: spec.bedrock,
    memory: {
      file: spec.memoryFile || `memory-${id}.json`
    }
  };

  return {
    id,
    role: spec.role || 'worker',
    config: deepMerge(baseConfig, override)
  };
}

async function bootstrap() {
  const config = loadConfig();
  try {
    const updateInfo = checkStartupUpdates();
    logger.info(`起動時アップデート確認: current=${updateInfo.currentVersion}, latest=${updateInfo.latestVersion || 'n/a'}, remoteBehind=${updateInfo.gitRemoteBehindCount ?? 'n/a'}`);
  } catch (error) {
    logger.warn('起動時アップデート確認に失敗しました。', error);
  }

  const runtimeBots = buildBotRuntimeConfigs(config);
  const knowledgeService = new BedrockDataService(config.bedrockKnowledge || {});
  if (config.bedrockKnowledge?.enabled !== false) {
    try {
      knowledgeService.load();
    } catch (error) {
      logger.warn('Bedrock知識データのロードに失敗しました。機能を限定して続行します。', error);
    }
  }

  let javaServerManager = null;
  if (config.edition === 'java' && config.localJavaServer?.enabled && config.localJavaServer?.autoStart) {
    javaServerManager = new JavaServerManager(config.localJavaServer, config.java);
    await javaServerManager.start();
  }

  let proxyManager = null;
  if (config.edition === 'bedrock' && config.bedrock.proxy.enabled && config.bedrock.proxy.enableAutoStart) {
    proxyManager = new ViaProxyManager(config);
    await proxyManager.start();
  }

  const entries = [];

  async function createEntryFromRuntime(runtime) {
    const memoryStore = new MemoryStore(runtime.config);
    // eslint-disable-next-line no-await-in-loop
    await memoryStore.init();
    const controller = new AutonomousBot(runtime.config, memoryStore, {
      role: runtime.role,
      knowledgeService
    });
    // eslint-disable-next-line no-await-in-loop
    await controller.connect();
    return { id: runtime.id, role: runtime.role, controller, memoryStore };
  }

  for (const runtime of runtimeBots) {
    // eslint-disable-next-line no-await-in-loop
    const entry = await createEntryFromRuntime(runtime);
    entries.push(entry);
  }

  const fleetController = new FleetController(entries, {
    async createEntryFromSpec(spec) {
      const runtime = buildRuntimeFromSpec(config, spec, entries.length);
      const entry = await createEntryFromRuntime(runtime);
      return entry;
    }
  });
  const fleetMemoryStore = new FleetMemoryStore(entries);

  if (config.gui.enabled) {
    startGuiServer(fleetController, fleetMemoryStore, config);
  }

  const shutdown = async (signal) => {
    logger.warn(`${signal} を受信したため停止処理に入ります。`);
    await fleetController.stopAll();

    if (proxyManager) {
      await proxyManager.stop();
    }

    if (javaServerManager) {
      await javaServerManager.stop();
    }

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  logger.error('起動処理で致命的エラーが発生しました。', error);
  process.exitCode = 1;
});
