const fs = require('fs');
const path = require('path');

function ensureEdition(edition) {
  if (edition !== 'java' && edition !== 'bedrock') {
    throw new Error(`edition は "java" か "bedrock" のみ指定できます: ${edition}`);
  }
}

function ensureLocalJavaServer(localJavaServer) {
  if (!localJavaServer) {
    return;
  }

  const software = localJavaServer.software;
  const allowed = ['vanilla', 'paper', 'purpur', 'fabric', 'forge'];
  if (!allowed.includes(software)) {
    throw new Error(`localJavaServer.software は次のみ指定できます: ${allowed.join(', ')}`);
  }
}

function ensureBehavior(behavior) {
  if (!behavior) {
    return;
  }

  const allowedModes = ['silent-mining', 'hybrid', 'conversation', 'player-command', 'autonomous'];
  if (behavior.mode && !allowedModes.includes(behavior.mode)) {
    throw new Error(`behavior.mode は次のみ指定できます: ${allowedModes.join(', ')}`);
  }

  if (behavior.autoStoreIntervalMs !== undefined && Number.isNaN(Number(behavior.autoStoreIntervalMs))) {
    throw new Error('behavior.autoStoreIntervalMs は数値で指定してください。');
  }

  if (behavior.autoSortIntervalMs !== undefined && Number.isNaN(Number(behavior.autoSortIntervalMs))) {
    throw new Error('behavior.autoSortIntervalMs は数値で指定してください。');
  }

  if (behavior.keepInInventory !== undefined && !Array.isArray(behavior.keepInInventory)) {
    throw new Error('behavior.keepInInventory は配列で指定してください。');
  }
}

function ensureConnectionPolicy(policy) {
  if (!policy) {
    return;
  }

  if (policy.allowedHosts && !Array.isArray(policy.allowedHosts)) {
    throw new Error('connectionPolicy.allowedHosts は配列で指定してください。');
  }
}

function ensureMultiBot(multiBot) {
  if (!multiBot) {
    return;
  }

  if (multiBot.bots && !Array.isArray(multiBot.bots)) {
    throw new Error('multiBot.bots は配列で指定してください。');
  }
}

function ensureChatControl(chatControl) {
  if (!chatControl) {
    return;
  }

  if (chatControl.playerRoles && typeof chatControl.playerRoles !== 'object') {
    throw new Error('chatControl.playerRoles はオブジェクトで指定してください。');
  }

  if (chatControl.dangerousCommands && !Array.isArray(chatControl.dangerousCommands)) {
    throw new Error('chatControl.dangerousCommands は配列で指定してください。');
  }
}

function ensureBedrockKnowledge(knowledge) {
  if (!knowledge) {
    return;
  }

  if (knowledge.samplesPath && typeof knowledge.samplesPath !== 'string') {
    throw new Error('bedrockKnowledge.samplesPath は文字列で指定してください。');
  }
}

function ensureCombat(combat) {
  if (!combat) {
    return;
  }

  const keys = ['healThreshold', 'retreatThreshold', 'rangedPreferDistance', 'meleeMaxDistance'];
  for (const key of keys) {
    if (combat[key] !== undefined && Number.isNaN(Number(combat[key]))) {
      throw new Error(`combat.${key} は数値で指定してください。`);
    }
  }
}

function ensureGui(gui) {
  if (!gui) {
    return;
  }

  if (gui.port !== undefined && Number.isNaN(Number(gui.port))) {
    throw new Error('gui.port は数値で指定してください。');
  }

  const security = gui.security;
  if (!security) {
    return;
  }

  if (security.allowedCommands && !Array.isArray(security.allowedCommands)) {
    throw new Error('gui.security.allowedCommands は配列で指定してください。');
  }

  if (security.commandCooldownMs !== undefined && Number.isNaN(Number(security.commandCooldownMs))) {
    throw new Error('gui.security.commandCooldownMs は数値で指定してください。');
  }

  if (security.maxCommandsPerMinute !== undefined && Number.isNaN(Number(security.maxCommandsPerMinute))) {
    throw new Error('gui.security.maxCommandsPerMinute は数値で指定してください。');
  }
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('config はオブジェクトで指定してください。');
  }

  ensureEdition(config.edition);
  ensureLocalJavaServer(config.localJavaServer);
  ensureBehavior(config.behavior);
  ensureConnectionPolicy(config.connectionPolicy);
  ensureMultiBot(config.multiBot);
  ensureChatControl(config.chatControl);
  ensureBedrockKnowledge(config.bedrockKnowledge);
  ensureCombat(config.combat);
  ensureGui(config.gui);
  return true;
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error('config.json が見つかりません。先に npm run setup を実行してください。');
  }

  const text = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(text);
  validateConfig(config);

  return config;
}

module.exports = {
  loadConfig,
  validateConfig
};
