const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { loadConfig } = require('../src/config');
const { MemoryStore } = require('../src/memoryStore');

test('config が java/bedrock のいずれかであること', () => {
  const config = loadConfig();
  assert.ok(['java', 'bedrock'].includes(config.edition));
});

test('memory の初期構造が正しいこと', async () => {
  const config = loadConfig();
  const store = new MemoryStore(config);
  await store.init();

  const snapshot = store.snapshot();
  assert.ok(Array.isArray(snapshot.bases));
  assert.ok(Array.isArray(snapshot.chests));
  assert.ok(Array.isArray(snapshot.deaths));
});

test('run スクリプトが両OS向けに存在すること', () => {
  const root = process.cwd();
  assert.ok(fs.existsSync(path.join(root, 'run.sh')));
  assert.ok(fs.existsSync(path.join(root, 'run.bat')));
});

test('GUI セキュリティ設定が存在すること', () => {
  const config = loadConfig();
  assert.equal(typeof config.gui.security, 'object');
  assert.ok(Array.isArray(config.gui.security.allowedCommands));
  assert.ok(config.gui.security.allowedCommands.includes('fetch-item'));
  assert.ok(config.gui.security.allowedCommands.includes('start-auto-mine'));
  assert.ok(config.gui.security.allowedCommands.includes('start-auto-collect'));
});

test('Bedrock proxy 設定に必要なキーが存在すること', () => {
  const config = loadConfig();
  assert.equal(typeof config.bedrock, 'object');
  assert.equal(typeof config.bedrock.proxy, 'object');
  assert.equal(typeof config.bedrock.proxy.listenHost, 'string');
  assert.equal(typeof config.bedrock.proxy.listenPort, 'number');
  assert.equal(typeof config.bedrock.proxy.targetVersion, 'string');
  assert.equal(typeof config.bedrock.proxy.authMethod, 'string');
});

test('設定プロファイルスクリプトが存在すること', () => {
  const root = process.cwd();
  assert.ok(fs.existsSync(path.join(root, 'scripts/configure-profile.js')));
});

test('ローカルJavaサーバー設定が存在し有効な software を持つこと', () => {
  const config = loadConfig();
  assert.equal(typeof config.localJavaServer, 'object');
  const software = config.localJavaServer.software;
  assert.ok(['vanilla', 'paper', 'purpur', 'fabric', 'forge'].includes(software));
});

test('ローカルJavaサーバー管理スクリプトが存在すること', () => {
  const root = process.cwd();
  assert.ok(fs.existsSync(path.join(root, 'scripts/mc-server-manager.js')));
});

test('会話・プレイヤー制御設定が存在すること', () => {
  const config = loadConfig();
  assert.equal(typeof config.behavior, 'object');
  assert.ok(['silent-mining', 'hybrid', 'conversation', 'player-command', 'autonomous'].includes(config.behavior.mode));
  assert.equal(typeof config.combat, 'object');
  assert.equal(typeof config.combat.healThreshold, 'number');
  assert.equal(typeof config.combat.rangedPreferDistance, 'number');
  assert.equal(typeof config.chatControl, 'object');
  assert.equal(typeof config.chatControl.commandPrefix, 'string');
  assert.equal(typeof config.chatControl.playerRoles, 'object');
  assert.ok(Array.isArray(config.chatControl.dangerousCommands));
  assert.equal(typeof config.llm, 'object');
});

test('複数Bot設定と新規モジュールが存在すること', () => {
  const root = process.cwd();
  const config = loadConfig();
  assert.equal(typeof config.multiBot, 'object');
  assert.ok(Array.isArray(config.multiBot.bots));
  assert.ok(config.gui.security.allowedCommands.includes('fleet-add-bot'));
  assert.ok(config.gui.security.allowedCommands.includes('fleet-remove-bot'));
  assert.ok(config.gui.security.allowedCommands.includes('fleet-update-role'));
  assert.ok(config.gui.security.allowedCommands.includes('planner-calc-recipe'));
  assert.ok(config.gui.security.allowedCommands.includes('planner-gather-for-craft'));
  assert.ok(config.gui.security.allowedCommands.includes('planner-analyze-blueprint'));
  assert.ok(config.gui.security.allowedCommands.includes('fight-nearest-mob'));
  assert.ok(config.gui.security.allowedCommands.includes('fight-player'));
  assert.ok(config.gui.security.allowedCommands.includes('orchestrator-assign-task'));
  assert.ok(config.gui.security.allowedCommands.includes('connection-diagnose'));
  assert.ok(fs.existsSync(path.join(root, 'src/llmChat.js')));
  assert.ok(fs.existsSync(path.join(root, 'src/fleetController.js')));
  assert.ok(fs.existsSync(path.join(root, 'src/bedrockDataService.js')));
  assert.ok(fs.existsSync(path.join(root, 'scripts/sync-bedrock-samples.js')));
});
