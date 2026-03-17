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
