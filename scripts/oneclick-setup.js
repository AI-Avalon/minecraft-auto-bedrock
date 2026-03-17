const { oneClickBootstrap } = require('../src/systemManager');
const { logger } = require('../src/logger');

async function main() {
  try {
    const result = oneClickBootstrap({ syncBedrockSamples: true });
    logger.info('oneclick setup 完了');
    // CLI向けに詳細を表示
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    logger.error('oneclick setup 失敗', error);
    process.exitCode = 1;
  }
}

main();
