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

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error('config.json が見つかりません。先に npm run setup を実行してください。');
  }

  const text = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(text);
  ensureEdition(config.edition);
  ensureLocalJavaServer(config.localJavaServer);
  ensureBehavior(config.behavior);
  ensureConnectionPolicy(config.connectionPolicy);
  ensureMultiBot(config.multiBot);
  ensureChatControl(config.chatControl);

  return config;
}

module.exports = {
  loadConfig
};
