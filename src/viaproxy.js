const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resolveWorkspacePath, sleep } = require('./utils');
const { logger } = require('./logger');

async function fetchRelease(repo, fixedVersion) {
  if (fixedVersion) {
    const url = `https://api.github.com/repos/${repo}/releases/tags/${fixedVersion}`;
    const response = await fetch(url, { headers: { 'User-Agent': 'minecraft-auto-bedrock' } });
    if (!response.ok) {
      throw new Error(`ViaProxy 固定バージョン取得に失敗: ${response.status}`);
    }
    return response.json();
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { 'User-Agent': 'minecraft-auto-bedrock' }
  });

  if (!response.ok) {
    throw new Error(`ViaProxy 最新版取得に失敗: ${response.status}`);
  }

  return response.json();
}

function chooseJarAsset(releaseJson) {
  const assets = releaseJson.assets || [];
  const jarAsset = assets.find((asset) => /\\.jar$/i.test(asset.name));

  if (!jarAsset) {
    throw new Error('ViaProxy の jar アセットが見つかりません。');
  }

  return jarAsset;
}

async function ensureViaProxy(config) {
  const proxyConfig = config.bedrock.proxy;
  const jarPath = resolveWorkspacePath(proxyConfig.jarPath);

  if (fs.existsSync(jarPath)) {
    logger.info(`既存の ViaProxy jar を利用します: ${jarPath}`);
    return jarPath;
  }

  fs.mkdirSync(path.dirname(jarPath), { recursive: true });
  const releaseJson = await fetchRelease(proxyConfig.githubRepo, proxyConfig.fixedVersion);
  const jarAsset = chooseJarAsset(releaseJson);

  logger.info(`ViaProxy をダウンロードします: ${jarAsset.browser_download_url}`);
  const response = await fetch(jarAsset.browser_download_url, {
    headers: { 'User-Agent': 'minecraft-auto-bedrock' }
  });

  if (!response.ok || !response.body) {
    throw new Error(`ViaProxy ダウンロード失敗: ${response.status}`);
  }

  const fileStream = fs.createWriteStream(jarPath);
  await new Promise((resolve, reject) => {
    response.body.pipe(fileStream);
    response.body.on('error', reject);
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });

  logger.info(`ViaProxy の保存が完了しました: ${jarPath}`);
  return jarPath;
}

class ViaProxyManager {
  constructor(config) {
    this.config = config;
    this.process = null;
    this.stopping = false;
  }

  buildArgs(jarPath) {
    const proxy = this.config.bedrock.proxy;
    const userArgs = proxy.args || [];

    // カスタム引数があればそのまま使う
    if (userArgs.length > 0) {
      return ['-jar', jarPath, ...userArgs];
    }

    // config から ViaProxy CLI ヘッドレス引数を自動生成
    // Bedrock は UDP(RakNet) なので ViaProxy がプロトコル変換を担う
    // mineflayer → TCP:listenPort → ViaProxy → UDP:targetHost:targetPort
    const listenAddr = `${proxy.listenHost || '127.0.0.1'}:${proxy.listenPort || 25566}`;
    const targetAddr = `${this.config.bedrock.host}:${this.config.bedrock.port}`;
    const targetVersion = proxy.targetVersion || 'bedrocklatest';
    const authMethod = proxy.authMethod || 'none';

    return [
      '-jar', jarPath,
      '--bind-address', listenAddr,
      '--target-address', targetAddr,
      '--version', targetVersion,
      '--auth-method', authMethod
    ];
  }

  async start() {
    if (this.process) {
      return;
    }

    const proxyConfig = this.config.bedrock.proxy;
    const jarPath = await ensureViaProxy(this.config);
    const args = this.buildArgs(jarPath);

    logger.info(`ViaProxy を起動します: java ${args.join(' ')}`);
    this.process = spawn('java', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.process.stdout.on('data', (chunk) => {
      logger.info(`[ViaProxy] ${chunk.toString().trim()}`);
    });

    this.process.stderr.on('data', (chunk) => {
      logger.warn(`[ViaProxy:stderr] ${chunk.toString().trim()}`);
    });

    this.process.on('exit', async (code) => {
      logger.warn(`ViaProxy が終了しました (code=${code})`);
      this.process = null;

      if (!this.stopping) {
        logger.warn('ViaProxy を自動再起動します。');
        await sleep(3000);
        await this.start();
      }
    });

    await sleep(1500);
  }

  async stop() {
    this.stopping = true;
    if (!this.process) {
      return;
    }

    this.process.kill();
    this.process = null;
  }
}

module.exports = {
  ViaProxyManager,
  ensureViaProxy
};
