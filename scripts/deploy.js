const path = require('path');
const simpleGit = require('simple-git');
const { loadConfig } = require('../src/config');
const { logger } = require('../src/logger');

async function autoCommitPush(git, config) {
  const status = await git.status();

  if (status.files.length === 0) {
    logger.info('変更が無いため commit/push をスキップします。');
    return;
  }

  const timestamp = new Date().toLocaleString('ja-JP', { hour12: false });
  const message = `${config.automation.commitMessagePrefix}: ${timestamp}`;

  await git.add('.');
  await git.commit(message);
  await git.push('origin', 'main');
  logger.info(`自動 push が完了しました: ${message}`);
}

async function main() {
  const config = loadConfig();
  const git = simpleGit(path.resolve(process.cwd()));

  if (!config.automation.autoGitPush) {
    logger.warn('config.automation.autoGitPush=false のため 1回のみ実行します。');
    await autoCommitPush(git, config);
    return;
  }

  const intervalMs = Math.max(1, config.automation.commitIntervalMinutes) * 60 * 1000;
  logger.info(`自動同期を開始します。間隔: ${intervalMs / 1000} 秒`);

  await autoCommitPush(git, config);
  setInterval(() => {
    autoCommitPush(git, config).catch((error) => {
      logger.error('定期自動同期に失敗しました。', error);
    });
  }, intervalMs);
}

main().catch((error) => {
  logger.error('deploy スクリプトでエラーが発生しました。', error);
  process.exitCode = 1;
});
