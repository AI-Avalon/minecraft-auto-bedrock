'use strict';
/**
 * test/integration/flying_squid_bot.test.js
 * flying-squid を使ったBot統合テスト
 *
 * 実行条件: devDependencies に flying-squid がインストールされていること
 *   npm install --save-dev flying-squid
 *   node --test test/integration/flying_squid_bot.test.js
 *
 * CI では RUN_INTEGRATION=1 環境変数でスキップ解除
 */

const { test, describe, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const { sleep } = require('../../src/utils');

// flying-squid が入っていなければスキップ
let flyingSquidAvailable = false;
try {
  require('flying-squid');
  flyingSquidAvailable = true;
} catch { /* nothing */ }

const RUN_INTEGRATION = process.env.RUN_INTEGRATION === '1' && flyingSquidAvailable;

// ── テストサーバーのポート（他と被らないよう高ポート） ──
const TEST_PORT = 25670;

describe('flying-squid 統合テスト', { skip: !RUN_INTEGRATION ? '統合テスト無効 (RUN_INTEGRATION=1 かつ flying-squid が必要)' : false }, () => {
  let server;

  before(async () => {
    const { createTestServer } = require('../../src/flyingSquidServer');
    server = await createTestServer({ port: TEST_PORT });
    // サーバー起動待ち
    await sleep(500);
  });

  after(async () => {
    await server?.stop();
  });

  test('flying-squid サーバーが起動している', () => {
    assert.ok(server.isRunning);
  });

  test('mineflayer でサーバーに接続できる', async () => {
    const mineflayer = require('mineflayer');
    return new Promise((resolve, reject) => {
      const bot = mineflayer.createBot({
        host:     '127.0.0.1',
        port:     TEST_PORT,
        username: 'TestBot',
        auth:     'offline',
        version:  '1.21.4',
      });
      const timeout = setTimeout(() => {
        bot.quit();
        reject(new Error('接続タイムアウト'));
      }, 10_000);

      bot.once('spawn', () => {
        clearTimeout(timeout);
        assert.ok(bot.entity !== null);
        bot.quit();
        resolve();
      });

      bot.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  });

  test('Botが正常に切断できる', async () => {
    const mineflayer = require('mineflayer');
    const bot = mineflayer.createBot({
      host:     '127.0.0.1',
      port:     TEST_PORT,
      username: 'DisconnectBot',
      auth:     'offline',
      version:  '1.21.4',
    });

    await new Promise((resolve, reject) => {
      bot.once('spawn', () => {
        bot.quit('disconnect test');
        resolve();
      });
      bot.once('error', reject);
      setTimeout(() => reject(new Error('timeout')), 10_000);
    });

    // 切断後に再度サーバーが生きているか確認
    assert.ok(server.isRunning);
  });

  test('getStatus() がサーバー状態を返す', () => {
    const status = server.getStatus();
    assert.ok(status.started);
    assert.equal(status.port, TEST_PORT);
  });
});

// ── flying-squid なしでも実行できる軽量テスト ────────────────────────────
describe('FlyingSquidServer（モジュール構造テスト）', () => {
  test('flying-squid なしでもモジュール読み込みが可能', () => {
    // require はするが start() を呼ばない
    const { FlyingSquidServer } = require('../../src/flyingSquidServer');
    assert.ok(typeof FlyingSquidServer === 'function');
  });

  test('start() を呼ばなければ isRunning は false', () => {
    const { FlyingSquidServer } = require('../../src/flyingSquidServer');
    const s = new FlyingSquidServer({ port: 25999 });
    assert.equal(s.isRunning, false);
  });

  test('getStatus() が正しい初期値を返す', () => {
    const { FlyingSquidServer } = require('../../src/flyingSquidServer');
    const s = new FlyingSquidServer({ port: 25999, version: '1.21.4' });
    const status = s.getStatus();
    assert.equal(status.started,  false);
    assert.equal(status.port,     25999);
    assert.equal(status.version,  '1.21.4');
  });
});
