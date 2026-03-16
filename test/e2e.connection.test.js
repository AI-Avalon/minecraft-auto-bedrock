const test = require('node:test');
const assert = require('node:assert/strict');
const mineflayer = require('mineflayer');

function shouldRunE2E() {
  return process.env.RUN_E2E === '1';
}

async function connectOnce(options, timeoutMs = 25_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`timeout: ${options.host}:${options.port}`));
    }, timeoutMs);

    const bot = mineflayer.createBot(options);

    bot.once('spawn', () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const username = bot.username;
      bot.quit('e2e-ok');
      resolve({ ok: true, username });
    });

    bot.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    bot.once('kicked', (reason) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new Error(`kicked: ${reason}`));
    });
  });
}

test('E2E Java: 実サーバーに接続できること', { timeout: 40_000 }, async (t) => {
  if (!shouldRunE2E()) {
    t.skip('RUN_E2E=1 で有効化');
    return;
  }

  const host = process.env.E2E_JAVA_HOST;
  const port = Number(process.env.E2E_JAVA_PORT || 25565);

  if (!host) {
    t.skip('E2E_JAVA_HOST 未設定');
    return;
  }

  const result = await connectOnce({
    host,
    port,
    username: process.env.E2E_USERNAME || 'AutoE2EJava',
    auth: process.env.E2E_AUTH || 'offline',
    version: process.env.E2E_JAVA_VERSION || false
  });

  assert.equal(result.ok, true);
});

test('E2E Bedrock: ViaProxy経由エンドポイントへ接続できること', { timeout: 40_000 }, async (t) => {
  if (!shouldRunE2E()) {
    t.skip('RUN_E2E=1 で有効化');
    return;
  }

  const host = process.env.E2E_BEDROCK_PROXY_HOST;
  const port = Number(process.env.E2E_BEDROCK_PROXY_PORT || 25566);

  if (!host) {
    t.skip('E2E_BEDROCK_PROXY_HOST 未設定');
    return;
  }

  const result = await connectOnce({
    host,
    port,
    username: process.env.E2E_BEDROCK_USERNAME || process.env.E2E_USERNAME || 'AutoE2EBedrock',
    auth: process.env.E2E_AUTH || 'offline',
    version: false
  });

  assert.equal(result.ok, true);
});
