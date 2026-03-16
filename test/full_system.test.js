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
