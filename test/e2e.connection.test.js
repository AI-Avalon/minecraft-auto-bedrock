const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const mineflayer = require('mineflayer');

function shouldRunE2E() {
  return process.env.RUN_E2E === '1';
}

/**
 * RakNet UnconnectedPing を送信し、UnconnectedPong が返るか確認する。
 * Bedrock サーバーは UDP を使用しているため TCP ではなく dgram で確認する。
 *
 * パケット構造:
 *   0x01          - ID: UnconnectedPing
 *   8 bytes       - timestamp (UInt64BE)
 *   16 bytes      - OFFLINE_MESSAGE_DATA_ID (RakNet magic)
 *   8 bytes       - client GUID
 * 応答の先頭バイトが 0x1c (UnconnectedPong) であれば疎通確認成功とみなす。
 */
function pingBedrockUdp(host, port, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    // RakNet OFFLINE_MESSAGE_DATA_ID マジックバイト
    const MAGIC = Buffer.from([
      0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe,
      0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78
    ]);

    const ping = Buffer.alloc(1 + 8 + 16 + 8);
    ping[0] = 0x01; // UnconnectedPing
    // timestamp (8 bytes) - 簡易的に 0 で埋める
    ping.writeBigUInt64BE(BigInt(Date.now()), 1);
    MAGIC.copy(ping, 9);
    // client GUID (8 bytes) - 固定値
    ping.writeBigUInt64BE(BigInt('0xDEADBEEFCAFEBABE'), 25);

    const socket = dgram.createSocket('udp4');
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new Error(`UDP ping timeout: ${host}:${port} (${timeoutMs}ms)`));
    }, timeoutMs);

    socket.on('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      // 0x1c = UnconnectedPong
      if (msg[0] === 0x1c) {
        resolve({ ok: true, pongLength: msg.length });
      } else {
        reject(new Error(`Unexpected RakNet packet ID: 0x${msg[0].toString(16)}`));
      }
    });

    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.send(ping, 0, ping.length, port, host, (err) => {
      if (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.close();
        reject(err);
      }
    });
  });
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

async function connectViaProxyOnce(options, timeoutMs = 25_000, stableMs = 1200) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let connected = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`timeout: ${options.host}:${options.port}`));
    }, timeoutMs);

    const bot = mineflayer.createBot(options);

    bot.once('connect', () => {
      connected = true;
      setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const username = bot.username;
        bot.quit('e2e-ok');
        resolve({ ok: true, username });
      }, stableMs);
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

    bot.once('end', (reason) => {
      if (settled) {
        return;
      }
      if (!connected) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`disconnected-before-connect: ${reason || 'unknown'}`));
      }
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

// -----------------------------------------------------------------------
// Bedrock UDP 疎通確認
// Bedrock は RakNet (UDP) を使用しているため TCP 接続は不可。
// ViaProxy が TCP→UDP 変換を担うため、生サーバーへの疎通は UDP Ping で確認する。
// 環境変数: E2E_BEDROCK_HOST (例: avalox.f5.si), E2E_BEDROCK_PORT (例: 19132)
// -----------------------------------------------------------------------
test('E2E Bedrock UDP: RakNet Ping が応答すること (UDP:19132)', { timeout: 15_000 }, async (t) => {
  if (!shouldRunE2E()) {
    t.skip('RUN_E2E=1 で有効化');
    return;
  }

  const host = process.env.E2E_BEDROCK_HOST;
  const port = Number(process.env.E2E_BEDROCK_PORT || 19132);

  if (!host) {
    t.skip('E2E_BEDROCK_HOST 未設定 (例: E2E_BEDROCK_HOST=avalox.f5.si)');
    return;
  }

  // Bedrock サーバーは UDP/RakNet。TCP では繋がらないため dgram で Ping する
  const result = await pingBedrockUdp(host, port, 8000);
  assert.equal(result.ok, true, `RakNet Pong が返ってきませんでした: ${host}:${port}`);
});

// -----------------------------------------------------------------------
// ViaProxy 経由 mineflayer 接続
// 事前に ViaProxy を起動し TCP:listenPort でリッスンした状態で実行すること。
// mineflayer → TCP:E2E_BEDROCK_PROXY_PORT → ViaProxy → UDP:E2E_BEDROCK_PORT
// 環境変数: E2E_BEDROCK_PROXY_HOST (例: 127.0.0.1), E2E_BEDROCK_PROXY_PORT (例: 25566)
// -----------------------------------------------------------------------
test('E2E Bedrock: ViaProxy経由エンドポイントへ接続できること (TCP→ViaProxy→UDP)', { timeout: 40_000 }, async (t) => {
  if (!shouldRunE2E()) {
    t.skip('RUN_E2E=1 で有効化');
    return;
  }

  const host = process.env.E2E_BEDROCK_PROXY_HOST;
  const port = Number(process.env.E2E_BEDROCK_PROXY_PORT || 25566);

  if (!host) {
    t.skip('E2E_BEDROCK_PROXY_HOST 未設定 (ViaProxy リスナーホスト。例: 127.0.0.1)');
    return;
  }

  // ViaProxy の TCP リスナーに Java プロトコルで接続 → ViaProxy が UDP 変換して Bedrock へ転送
  const result = await connectViaProxyOnce({
    host,
    port,
    username: process.env.E2E_BEDROCK_USERNAME || process.env.E2E_USERNAME || 'AutoE2EBedrock',
    auth: process.env.E2E_AUTH || 'offline',
    version: false
  });

  assert.equal(result.ok, true);
});
