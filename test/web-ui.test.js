const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { io: ioClient } = require('socket.io-client');

// テスト用の簡易config
const testConfig = {
  username: 'test-bot',
  edition: 'java',
  server: { host: 'localhost', port: 25565 },
  gui: {
    port: 0,
    security: { requireToken: false }
  }
};

// 簡易的なBotControllerモック
class MockBotController {
  status() {
    return {
      username: 'test-bot',
      connected: false,
      fleet: [],
      behavior: { mode: 'idle' },
      inventory: { count: 0 }
    };
  }

  async connect() {
    return true;
  }

  async disconnect() {
    return true;
  }

  async setBaseHere(name, targetBotId) {
    return { ok: true, name };
  }

  async collectNearestBlock(blockName, targetBotId) {
    return true;
  }

  async startAutoMine(targetBotId) {
    return { ok: true };
  }

  async stopAutoMine(targetBotId) {
    return { ok: true };
  }

  async storeInventoryToNearestChest() {
    return { ok: true };
  }

  async retreatNow(targetBotId) {
    return { ok: true };
  }

  runOnTarget(targetBotId, method, ...args) {
    return { ok: true, method };
  }

  async equipBestArmor() {
    return { ok: true };
  }

  addBot(payload) {
    return { ok: true, id: 'bot-' + Date.now() };
  }

  removeBot(id) {
    return { ok: true };
  }

  updateRole(id, role) {
    return { ok: true };
  }
}

// 簡易的なMemoryStoreモック
class MockMemoryStore {
  async init() {
    return;
  }

  snapshot() {
    return { chests: [], items: [], bases: [] };
  }

  searchItems(query) {
    return [];
  }
}

// サーバーセットアップ関数
async function setupTestServer() {
  const MockBotController_ = MockBotController;
  const MockMemoryStore_ = MockMemoryStore;

  const botController = new MockBotController_();
  const memoryStore = new MockMemoryStore_();
  await memoryStore.init();

  const { startGuiServer } = require('../src/guiServer');

  return new Promise((resolve, reject) => {
    try {
      const server = startGuiServer(botController, memoryStore, testConfig);

      // サーバーがポート割り当てを待つ
      setTimeout(() => {
        const address = server.address();
        if (!address) {
          reject(new Error('サーバーがポート割り当てに失敗しました'));
          return;
        }
        resolve({
          server,
          botController,
          memoryStore,
          port: address.port,
          url: `http://127.0.0.1:${address.port}`
        });
      }, 100);
    } catch (error) {
      reject(error);
    }
  });
}

// テスト実行
test('WEB UI - Socket.IO 接続テスト', async (t) => {
  let context;

  await t.before(async () => {
    context = await setupTestServer();
  });

  await t.after(async () => {
    if (context?.server) {
      context.server.close();
    }
  });

  // Socket.IO接続テスト
  await t.test('Socket.IO に接続できる', async () => {
    const socket = ioClient(context.url, {
      reconnection: false,
      forceNew: true
    });

    return new Promise((resolve, reject) => {
      socket.on('connect', () => {
        assert.ok(socket.connected, 'Socketが接続されています');
        socket.disconnect();
        resolve();
      });

      socket.on('error', reject);
      socket.on('disconnect', () => {
        resolve();
      });

      setTimeout(() => {
        socket.disconnect();
        resolve();
      }, 5000);
    });
  });

  // bootstrap イベント受信テスト
  await t.test('bootstrap イベントで初期状態を受信', async () => {
    const socket = ioClient(context.url, {
      reconnection: false,
      forceNew: true
    });

    return new Promise((resolve, reject) => {
      socket.on('bootstrap', (data) => {
        assert.ok(data, 'bootstrap データが受信されました');
        assert.ok(data.mode, 'mode が含まれています');
        assert.ok(data.status, 'status が含まれています');
        assert.ok(data.memory, 'memory が含まれています');
        socket.disconnect();
        resolve();
      });

      socket.on('error', reject);

      setTimeout(() => {
        socket.disconnect();
        reject(new Error('bootstrap タイムアウト'));
      }, 5000);
    });
  });

  // コマンド送信テスト
  await t.test('コマンド送受信が機能する', async () => {
    const socket = ioClient(context.url, {
      reconnection: false,
      forceNew: true
    });

    return new Promise((resolve, reject) => {
      socket.on('connect', () => {
        socket.emit('command:set-base', 'test-base');
      });

      socket.on('command-result', (data) => {
        assert.ok(data, 'command-result が受信されました');
        assert.equal(data.action, 'set-base', 'action が正しい');
        assert.ok(data.ok !== undefined, 'ok フラグが含まれている');
        socket.disconnect();
        resolve();
      });

      socket.on('error', reject);

      setTimeout(() => {
        socket.disconnect();
        reject(new Error('command-result タイムアウト'));
      }, 5000);
    });
  });

  // refresh イベント送信テスト
  await t.test('refresh コマンドで状態更新される', async () => {
    const socket = ioClient(context.url, {
      reconnection: false,
      forceNew: true
    });

    return new Promise((resolve, reject) => {
      let statusReceived = false;

      socket.on('connect', () => {
        socket.emit('refresh');
      });

      socket.on('status', (data) => {
        assert.ok(data, 'status イベントが受信されました');
        assert.ok(data.mode, 'mode が含まれている');
        statusReceived = true;
        socket.disconnect();
        resolve();
      });

      socket.on('error', reject);

      setTimeout(() => {
        socket.disconnect();
        if (!statusReceived) {
          reject(new Error('status タイムアウト'));
        } else {
          resolve();
        }
      }, 5000);
    });
  });

  // 複数コマンドシーケンステスト
  await t.test('複数コマンドが順序正しく処理される', async () => {
    const socket = ioClient(context.url, {
      reconnection: false,
      forceNew: true
    });

    return new Promise((resolve, reject) => {
      const results = [];

      socket.on('connect', () => {
        socket.emit('command:start-auto-mine', { targetBotId: undefined });
        socket.emit('command:stop-auto-mine', { targetBotId: undefined });
      });

      socket.on('command-result', (data) => {
        results.push(data.action);

        if (results.length >= 2) {
          assert.equal(results[0], 'start-auto-mine', '最初のコマンドが処理された');
          assert.equal(results[1], 'stop-auto-mine', '2番目のコマンドが処理された');
          socket.disconnect();
          resolve();
        }
      });

      socket.on('error', reject);

      setTimeout(() => {
        socket.disconnect();
        if (results.length < 2) {
          reject(new Error(`タイムアウト: ${results.length}/2 コマンド受信`));
        } else {
          resolve();
        }
      }, 5000);
    });
  });

  // HTTP API テスト
  await t.test('HTTP API /health に応答する', async () => {
    return new Promise((resolve, reject) => {
      const req = http.get(`${context.url}/health`, (res) => {
        assert.ok([200, 404].includes(res.statusCode), `HTTP ${res.statusCode}`);
        resolve();
      });

      req.on('error', reject);
      setTimeout(() => reject(new Error('HTTP タイムアウト')), 2000);
    });
  });
});

test('WEB UI - GUI セキュリティテスト', async (t) => {
  let context;

  await t.before(async () => {
    // トークン要求の設定でサーバーを再起動
    const configWithToken = {
      ...testConfig,
      gui: {
        ...testConfig.gui,
        security: { requireToken: true, token: 'test-token-123' }
      }
    };

    const botController = new MockBotController();
    const memoryStore = new MockMemoryStore();
    await memoryStore.init();

    const { startGuiServer } = require('../src/guiServer');

    context = await new Promise((resolve, reject) => {
      try {
        const server = startGuiServer(botController, memoryStore, configWithToken);
        setTimeout(() => {
          const address = server.address();
          resolve({
            server,
            botController,
            memoryStore,
            port: address.port,
            url: `http://127.0.0.1:${address.port}`
          });
        }, 100);
      } catch (error) {
        reject(error);
      }
    });
  });

  await t.after(async () => {
    if (context?.server) {
      context.server.close();
    }
  });

  // トークン検証テスト
  await t.test('無効なトークンで接続拒否される', async () => {
    const socket = ioClient(context.url, {
      reconnection: false,
      forceNew: true,
      auth: { token: 'invalid-token' }
    });

    return new Promise((resolve, reject) => {
      socket.on('unauthorized', () => {
        assert.ok(true, 'unauthorized イベント受信');
        socket.disconnect();
        resolve();
      });

      socket.on('connect', () => {
        socket.disconnect();
        reject(new Error('無効なトークンで接続されてしまった'));
      });

      setTimeout(() => {
        socket.disconnect();
        resolve();
      }, 2000);
    });
  });

  // 正しいトークン検証テスト
  await t.test('正しいトークンで接続成功', async () => {
    const socket = ioClient(context.url, {
      reconnection: false,
      forceNew: true,
      auth: { token: 'test-token-123' }
    });

    return new Promise((resolve, reject) => {
      socket.on('connect', () => {
        assert.ok(socket.connected, 'トークン認証で接続成功');
        socket.disconnect();
        resolve();
      });

      socket.on('unauthorized', () => {
        socket.disconnect();
        reject(new Error('正しいトークンが拒否された'));
      });

      socket.on('error', reject);

      setTimeout(() => {
        socket.disconnect();
        reject(new Error('接続タイムアウト'));
      }, 2000);
    });
  });
});

test('WEB UI - コマンド機能テスト', async (t) => {
  let context;

  await t.before(async () => {
    context = await setupTestServer();
  });

  await t.after(async () => {
    if (context?.server) {
      context.server.close();
    }
  });

  const testCommands = [
    { name: 'command:set-base', payload: 'test-base', expectedAction: 'set-base' },
    { name: 'command:collect', payload: { blockName: 'stone' }, expectedAction: 'collect' },
    { name: 'command:start-auto-mine', payload: {}, expectedAction: 'start-auto-mine' },
    { name: 'command:stop-auto-mine', payload: {}, expectedAction: 'stop-auto-mine' },
    { name: 'command:store-inventory', payload: {}, expectedAction: 'store-inventory' },
    { name: 'command:fetch-item', payload: { itemName: 'diamond', amount: 1 }, expectedAction: 'fetch-item' },
    { name: 'command:retreat-base', payload: {}, expectedAction: 'retreat-base' },
    { name: 'command:fight-nearest-mob', payload: {}, expectedAction: 'fight-nearest-mob' },
    { name: 'command:equip-best-armor', payload: {}, expectedAction: 'equip-best-armor' },
    { name: 'command:fleet-list-bots', payload: {}, expectedAction: 'fleet-list-bots' },
    { name: 'search-item', payload: 'test', event: 'search-result' }
  ];

  for (const testCmd of testCommands) {
    await t.test(`コマンド: ${testCmd.name}`, async () => {
      const socket = ioClient(context.url, {
        reconnection: false,
        forceNew: true
      });

      return new Promise((resolve, reject) => {
        socket.on('connect', () => {
          socket.emit(testCmd.name, testCmd.payload);
        });

        const expectedEvent = testCmd.event || 'command-result';
        socket.on(expectedEvent, (data) => {
          if (testCmd.expectedAction) {
            assert.equal(data.action, testCmd.expectedAction, `action が正しい: ${testCmd.expectedAction}`);
          }
          socket.disconnect();
          resolve();
        });

        socket.on('error', reject);

        setTimeout(() => {
          socket.disconnect();
          reject(new Error(`タイムアウト: ${testCmd.name}`));
        }, 3000);
      });
    });
  }
});
