const fs = require('fs');
const path = require('path');
const { ensureViaProxy } = require('./src/viaproxy');
const { loadConfig } = require('./src/config');
const { logger } = require('./src/logger');

async function ensureConfigFile() {
  const rootDir = process.cwd();
  const configPath = path.join(rootDir, 'config.json');
  const templatePath = path.join(rootDir, 'config.template.json');

  if (!fs.existsSync(configPath) && fs.existsSync(templatePath)) {
    fs.copyFileSync(templatePath, configPath);
    logger.info('config.json が存在しないためテンプレートから生成しました。');
  }
}

async function main() {
  await ensureConfigFile();
  const config = loadConfig();

  if (config.edition !== 'bedrock' || !config.bedrock.proxy.enabled) {
    logger.info('Javaモード、またはBedrockプロキシ無効のため ViaProxy 準備をスキップします。');
    return;
  }

  if (!config.bedrock.proxy.enableAutoDownload) {
    logger.info('ViaProxy 自動ダウンロードが無効です。手動配置された jar を利用します。');
    return;
  }

  await ensureViaProxy(config);
  logger.info('ViaProxy の準備が完了しました。');
}

main().catch((error) => {
  logger.error('setup でエラーが発生しました。', error);
  process.exitCode = 1;
});
