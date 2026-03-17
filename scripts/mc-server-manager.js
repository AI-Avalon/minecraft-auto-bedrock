const { loadConfig } = require('../src/config');
const { installServer, JavaServerManager, resolveConfig } = require('../src/javaServer');
const { logger } = require('../src/logger');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function usage() {
  console.log('使い方:');
  console.log('  node scripts/mc-server-manager.js install [--software paper|fabric|forge|purpur|vanilla] [--mc 1.21.4] [--forge 54.0.17] [--dir local-server]');
  console.log('  node scripts/mc-server-manager.js start [--dir local-server]');
  console.log('  node scripts/mc-server-manager.js bootstrap   # install + start');
}

function readConfigFromFile() {
  const config = loadConfig();
  return resolveConfig(config.localJavaServer || {});
}

function applyOverrides(base, flags) {
  const next = { ...base };
  if (flags.software) next.software = String(flags.software);
  if (flags.mc) next.minecraftVersion = String(flags.mc);
  if (flags.forge) next.forgeVersion = String(flags.forge);
  if (flags.dir) next.directory = String(flags.dir);
  if (flags.xms) next.xms = String(flags.xms);
  if (flags.xmx) next.xmx = String(flags.xmx);
  if (flags.java) next.javaPath = String(flags.java);
  if (flags.nogui === 'false') next.nogui = false;
  return next;
}

async function run() {
  const command = process.argv[2] || 'bootstrap';
  const flags = parseArgs(process.argv.slice(3));

  if (command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }

  const projectConfig = loadConfig();
  const base = applyOverrides(readConfigFromFile(), flags);

  if (command === 'install') {
    await installServer(base);
    return;
  }

  if (command === 'start') {
    const manager = new JavaServerManager(base, projectConfig.java);
    await manager.ensureInstalled();
    await manager.start();
    return;
  }

  if (command === 'bootstrap') {
    const manager = new JavaServerManager(base, projectConfig.java);
    await manager.ensureInstalled();
    await manager.start();
    return;
  }

  usage();
  process.exitCode = 1;
}

run().catch((error) => {
  logger.error('mc-server-manager でエラーが発生しました。', error);
  process.exitCode = 1;
});
