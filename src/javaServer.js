const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { logger } = require('./logger');

const DEFAULTS = {
  enabled: false,
  autoStart: false,
  software: 'paper',
  minecraftVersion: '1.21.4',
  forgeVersion: '',
  directory: 'local-server',
  javaPath: 'java',
  xms: '1G',
  xmx: '2G',
  nogui: true,
  eula: true
};

function resolveConfig(input = {}) {
  return {
    ...DEFAULTS,
    ...input
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'minecraft-auto-bedrock' } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

async function downloadToFile(url, outPath) {
  const response = await fetch(url, { headers: { 'User-Agent': 'minecraft-auto-bedrock' } });
  if (!response.ok) {
    throw new Error(`ダウンロード失敗 (${response.status}): ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(outPath, bytes);
}

function chooseLatestVersion(list) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('利用可能バージョンが見つかりません。');
  }
  return String(list[list.length - 1]);
}

function acceptEula(serverDir) {
  const eulaPath = path.join(serverDir, 'eula.txt');
  fs.writeFileSync(eulaPath, 'eula=true\n', 'utf8');
}

function loadMeta(serverDir) {
  const metaPath = path.join(serverDir, 'server-meta.json');
  if (!fs.existsSync(metaPath)) {
    return null;
  }
  return readJson(metaPath);
}

function saveMeta(serverDir, meta) {
  writeJson(path.join(serverDir, 'server-meta.json'), meta);
}

function resolveForgeArgsFile(serverDir, minecraftVersion, forgeVersion) {
  const artifact = `${minecraftVersion}-${forgeVersion}`;
  const baseDir = path.join(
    serverDir,
    'libraries',
    'net',
    'minecraftforge',
    'forge',
    artifact
  );

  const argsFile = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
  const argsPath = path.join(baseDir, argsFile);
  if (fs.existsSync(argsPath)) {
    return argsPath;
  }

  return null;
}

async function resolveVanillaArtifact(cfg, serverDir) {
  const manifest = await fetchJson('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
  const selected = manifest.versions.find((item) => item.id === cfg.minecraftVersion);
  if (!selected) {
    throw new Error(`Vanilla バージョンが見つかりません: ${cfg.minecraftVersion}`);
  }

  const detail = await fetchJson(selected.url);
  if (!detail.downloads || !detail.downloads.server || !detail.downloads.server.url) {
    throw new Error(`Vanilla サーバーjarが提供されていません: ${cfg.minecraftVersion}`);
  }

  const jarName = `vanilla-${cfg.minecraftVersion}.jar`;
  const jarPath = path.join(serverDir, jarName);
  await downloadToFile(detail.downloads.server.url, jarPath);

  return {
    software: 'vanilla',
    minecraftVersion: cfg.minecraftVersion,
    launchType: 'jar',
    launchTarget: jarName
  };
}

async function resolvePaperArtifact(cfg, serverDir) {
  const versionsJson = await fetchJson('https://api.papermc.io/v2/projects/paper');
  const minecraftVersion = cfg.minecraftVersion || chooseLatestVersion(versionsJson.versions);

  const buildsJson = await fetchJson(`https://api.papermc.io/v2/projects/paper/versions/${minecraftVersion}/builds`);
  const builds = buildsJson.builds || [];
  if (builds.length === 0) {
    throw new Error(`Paper build が見つかりません: ${minecraftVersion}`);
  }

  const latestBuild = builds[builds.length - 1];
  const fileName = latestBuild.downloads?.application?.name;
  if (!fileName) {
    throw new Error(`Paper のダウンロード情報が取得できません: ${minecraftVersion}`);
  }

  const url = `https://api.papermc.io/v2/projects/paper/versions/${minecraftVersion}/builds/${latestBuild.build}/downloads/${fileName}`;
  const jarName = `paper-${minecraftVersion}-${latestBuild.build}.jar`;
  await downloadToFile(url, path.join(serverDir, jarName));

  return {
    software: 'paper',
    minecraftVersion,
    build: latestBuild.build,
    launchType: 'jar',
    launchTarget: jarName
  };
}

async function resolvePurpurArtifact(cfg, serverDir) {
  const versionsJson = await fetchJson('https://api.purpurmc.org/v2/purpur');
  const minecraftVersion = cfg.minecraftVersion || chooseLatestVersion(versionsJson.versions || []);
  const detail = await fetchJson(`https://api.purpurmc.org/v2/purpur/${minecraftVersion}`);
  const build = detail.builds?.latest;
  if (!build) {
    throw new Error(`Purpur build が見つかりません: ${minecraftVersion}`);
  }

  const url = `https://api.purpurmc.org/v2/purpur/${minecraftVersion}/${build}/download`;
  const jarName = `purpur-${minecraftVersion}-${build}.jar`;
  await downloadToFile(url, path.join(serverDir, jarName));

  return {
    software: 'purpur',
    minecraftVersion,
    build,
    launchType: 'jar',
    launchTarget: jarName
  };
}

function runJavaCommand(javaPath, args, cwd) {
  const result = spawnSync(javaPath, args, {
    cwd,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error(`Java コマンドが失敗しました: ${javaPath} ${args.join(' ')}`);
  }
}

async function resolveFabricArtifact(cfg, serverDir) {
  const installerVersions = await fetchJson('https://meta.fabricmc.net/v2/versions/installer');
  const installer = installerVersions.find((v) => v.stable) || installerVersions[0];
  if (!installer) {
    throw new Error('Fabric installer バージョンの取得に失敗しました。');
  }

  const loaderVersions = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${cfg.minecraftVersion}`);
  const loader = loaderVersions.find((v) => v.loader?.stable) || loaderVersions[0];
  if (!loader || !loader.loader?.version) {
    throw new Error(`Fabric loader の取得に失敗しました: ${cfg.minecraftVersion}`);
  }

  const installerJar = path.join(serverDir, `fabric-installer-${installer.version}.jar`);
  await downloadToFile(installer.url, installerJar);

  runJavaCommand(cfg.javaPath, [
    '-jar',
    path.basename(installerJar),
    'server',
    '-mcversion', cfg.minecraftVersion,
    '-loader', loader.loader.version,
    '-downloadMinecraft'
  ], serverDir);

  const launchJar = path.join(serverDir, 'fabric-server-launch.jar');
  if (!fs.existsSync(launchJar)) {
    throw new Error('Fabric サーバー起動jarの生成に失敗しました。');
  }

  return {
    software: 'fabric',
    minecraftVersion: cfg.minecraftVersion,
    loaderVersion: loader.loader.version,
    launchType: 'jar',
    launchTarget: 'fabric-server-launch.jar'
  };
}

async function resolveForgeArtifact(cfg, serverDir) {
  const promotions = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
  const keyRecommended = `${cfg.minecraftVersion}-recommended`;
  const keyLatest = `${cfg.minecraftVersion}-latest`;
  const forgeVersion = cfg.forgeVersion || promotions.promos?.[keyRecommended] || promotions.promos?.[keyLatest];

  if (!forgeVersion) {
    throw new Error(`Forge バージョンが見つかりません。forgeVersion を明示してください: ${cfg.minecraftVersion}`);
  }

  const artifact = `${cfg.minecraftVersion}-${forgeVersion}`;
  const installerName = `forge-${artifact}-installer.jar`;
  const installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${artifact}/${installerName}`;
  await downloadToFile(installerUrl, path.join(serverDir, installerName));

  runJavaCommand(cfg.javaPath, ['-jar', installerName, '--installServer'], serverDir);

  const argsPath = resolveForgeArgsFile(serverDir, cfg.minecraftVersion, forgeVersion);
  if (!argsPath) {
    throw new Error('Forge 起動引数ファイルが見つかりませんでした。');
  }

  return {
    software: 'forge',
    minecraftVersion: cfg.minecraftVersion,
    forgeVersion,
    launchType: 'argsFile',
    launchTarget: path.relative(serverDir, argsPath)
  };
}

async function installServer(configInput) {
  const cfg = resolveConfig(configInput);
  const serverDir = path.resolve(process.cwd(), cfg.directory);
  ensureDir(serverDir);

  logger.info(`ローカルサーバーを準備します: software=${cfg.software}, version=${cfg.minecraftVersion}`);

  let meta;
  switch (cfg.software) {
    case 'vanilla':
      meta = await resolveVanillaArtifact(cfg, serverDir);
      break;
    case 'paper':
      meta = await resolvePaperArtifact(cfg, serverDir);
      break;
    case 'purpur':
      meta = await resolvePurpurArtifact(cfg, serverDir);
      break;
    case 'fabric':
      meta = await resolveFabricArtifact(cfg, serverDir);
      break;
    case 'forge':
      meta = await resolveForgeArtifact(cfg, serverDir);
      break;
    default:
      throw new Error(`未対応ソフトウェアです: ${cfg.software}`);
  }

  if (cfg.eula) {
    acceptEula(serverDir);
  }

  saveMeta(serverDir, {
    ...meta,
    installedAt: new Date().toISOString()
  });

  logger.info(`ローカルサーバー準備完了: ${serverDir}`);
  return { serverDir, meta };
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1200);

    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });

    const onFail = () => {
      socket.destroy();
      resolve(false);
    };

    socket.once('error', onFail);
    socket.once('timeout', onFail);
    socket.connect(port, host);
  });
}

async function waitForPort(host, port, timeoutMs = 35_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const open = await isPortOpen(host, port);
    if (open) {
      return true;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

class JavaServerManager {
  constructor(configInput, javaConfig = { host: '127.0.0.1', port: 25565 }) {
    this.config = resolveConfig(configInput);
    this.javaConfig = javaConfig;
    this.process = null;
  }

  get serverDir() {
    return path.resolve(process.cwd(), this.config.directory);
  }

  async ensureInstalled() {
    const meta = loadMeta(this.serverDir);
    if (meta) {
      return { serverDir: this.serverDir, meta };
    }
    return installServer(this.config);
  }

  buildLaunchCommand(meta) {
    const commonJvmArgs = [`-Xms${this.config.xms}`, `-Xmx${this.config.xmx}`];

    if (meta.launchType === 'jar') {
      const args = [
        ...commonJvmArgs,
        '-jar',
        meta.launchTarget
      ];
      if (this.config.nogui) {
        args.push('nogui');
      }
      return {
        command: this.config.javaPath,
        args,
        shell: false
      };
    }

    if (meta.launchType === 'argsFile') {
      const args = [
        ...commonJvmArgs,
        `@${meta.launchTarget}`
      ];
      if (this.config.nogui) {
        args.push('nogui');
      }
      return {
        command: this.config.javaPath,
        args,
        shell: false
      };
    }

    throw new Error(`未知の launchType: ${meta.launchType}`);
  }

  _getProcessFile() {
    return path.resolve(process.cwd(), 'memory.json');
  }

  _savePid() {
    if (!this.process || !this.process.pid) {
      return;
    }
    try {
      const memPath = this._getProcessFile();
      let mem = {};
      if (fs.existsSync(memPath)) {
        mem = readJson(memPath);
      }
      mem.javaServerPid = this.process.pid;
      writeJson(memPath, mem);
    } catch (e) {
      logger.warn(`プロセスPID保存に失敗: ${e.message}`);
    }
  }

  _clearPid() {
    try {
      const memPath = this._getProcessFile();
      if (fs.existsSync(memPath)) {
        const mem = readJson(memPath);
        delete mem.javaServerPid;
        writeJson(memPath, mem);
      }
    } catch (e) {
      logger.warn(`プロセスPID削除に失敗: ${e.message}`);
    }
  }

  async start() {
    if (this.process) {
      return;
    }

    const { meta } = await this.ensureInstalled();
    const launch = this.buildLaunchCommand(meta);

    logger.info(`ローカルJavaサーバーを起動: ${launch.command} ${launch.args.join(' ')}`);
    this.process = spawn(launch.command, launch.args, {
      cwd: this.serverDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: launch.shell
    });

    // プロセスPIDを memory.json に保存
    this._savePid();

    this.process.stdout.on('data', (chunk) => {
      logger.info(`[LocalServer] ${chunk.toString().trim()}`);
    });

    this.process.stderr.on('data', (chunk) => {
      logger.warn(`[LocalServer:stderr] ${chunk.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      logger.warn(`ローカルJavaサーバーが終了しました (code=${code})`);
      this._clearPid();
      this.process = null;
    });

    const ready = await waitForPort(this.javaConfig.host || '127.0.0.1', Number(this.javaConfig.port || 25565));
    if (!ready) {
      logger.warn('ローカルJavaサーバーのポート開放を確認できませんでした。起動ログを確認してください。');
    }
  }

  async stop() {
    if (!this.process) {
      return;
    }

    this.process.kill();
    this._clearPid();
    this.process = null;
  }
}

module.exports = {
  installServer,
  JavaServerManager,
  resolveConfig
};
