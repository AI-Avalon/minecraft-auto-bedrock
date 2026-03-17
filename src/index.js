const { loadConfig } = require('./config');
const { logger } = require('./logger');
const { ViaProxyManager } = require('./viaproxy');
const { MemoryStore } = require('./memoryStore');
const { AutonomousBot } = require('./bot');
const { startGuiServer } = require('./guiServer');
const { JavaServerManager } = require('./javaServer');

async function bootstrap() {
  const config = loadConfig();
  const memoryStore = new MemoryStore(config);
  await memoryStore.init();

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

  const botController = new AutonomousBot(config, memoryStore);
  await botController.connect();

  if (config.gui.enabled) {
    startGuiServer(botController, memoryStore, config);
  }

  const shutdown = async (signal) => {
    logger.warn(`${signal} を受信したため停止処理に入ります。`);
    await botController.stop();

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
