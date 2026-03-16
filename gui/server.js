const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/memoryStore');
const { AutonomousBot } = require('../src/bot');
const { startGuiServer } = require('../src/guiServer');
const { logger } = require('../src/logger');

async function main() {
  const config = loadConfig();
  const memoryStore = new MemoryStore(config);
  await memoryStore.init();
  const botController = new AutonomousBot(config, memoryStore);

  // GUI単体起動でも bot 接続は有効化し、ブラウザ操作からそのまま制御できるようにする。
  await botController.connect();
  startGuiServer(botController, memoryStore, config);
}

main().catch((error) => {
  logger.error('GUI 起動に失敗しました。', error);
  process.exitCode = 1;
});
