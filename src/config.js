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

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error('config.json が見つかりません。先に npm run setup を実行してください。');
  }

  const text = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(text);
  ensureEdition(config.edition);
  ensureLocalJavaServer(config.localJavaServer);

  return config;
}

module.exports = {
  loadConfig
};
