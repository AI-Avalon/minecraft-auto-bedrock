const test = require('node:test');
const assert = require('node:assert/strict');
const { io: createClient } = require('socket.io-client');
const { startGuiServer } = require('../src/guiServer');

function createFakeBotController() {
  return {
    bot: null,
    status() {
      return {
        connected: true,
        health: 20,
        food: 20,
        position: { x: 0, y: 64, z: 0 },
        inventory: [{ displayName: 'Cobblestone', count: 32 }]
      };
    },
    async setBaseHere(name) {
      return { ok: true, name: name || 'base' };
    },
    async collectNearestBlock(blockName) {
      return Boolean(blockName);
    },
    async buildSchem(schemPath) {
      return { ok: true, schemPath };
    },
    async autoBuildWithRefill(schemPath, requiredItems) {
      return { ok: true, schemPath, requiredItems };
    },
    async startAutoCollect(blockName, targetCount) {
      return { ok: true, blockName, targetCount };
    },
    async stopAutoCollect() {
      return { ok: true };
    },
    async startAutoMine() {
      return { ok: true };
    },
    async stopAutoMine() {
      return { ok: true };
    },
    async fetchItemFromMemory(itemName, amount) {
      return Boolean(itemName && amount > 0);
    },
    async retreatNow() {
      return true;
    },
    async runOnTarget(_targetBotId, fnName, ...args) {
      if (fnName === 'setCombatProfile') {
        return { ok: true, profile: args[0] || 'balanced' };
      }
      if (fnName === 'craftItem') {
        return { ok: true, itemName: args[0], count: args[1] };
      }
      if (fnName === 'startCityMode') {
        return { ok: true, started: true, modeName: args[0] || 'village' };
      }
      if (fnName === 'stopCityMode') {
        return { ok: true, stopped: true };
      }
      if (fnName === 'setEvasionEnabled') {
        return { ok: true, evasionEnabled: Boolean(args[0]) };
      }
      return { ok: true, fnName, args };
    }
  };
}

function createFakeMemoryStore() {
  return {
    snapshot() {
      return {
        chests: [],
        bases: [],
        deaths: []
      };
    },
    searchItems(query) {
      if (!query) {
        return [];
      }
      return [{ chestKey: '0,64,0', item: { displayName: String(query), count: 8 } }];
    }
  };
}

async function setupServer({ requireToken = false, token = '', readOnly = false, allowedCommands } = {}) {
  const defaultAllowed = [
    'set-base',
    'collect',
    'set-combat-profile',
    'craft-item',
    'start-city-mode',
    'stop-city-mode',
    'set-evasion',
    'system-doctor'
  ];

  const config = {
    edition: 'bedrock',
    gui: {
      host: '127.0.0.1',
      port: 0,
      security: {
        requireToken,
        token,
        readOnly,
        allowedCommands: allowedCommands || defaultAllowed,
        commandCooldownMs: 0,
        maxCommandsPerMinute: 100,
        auditLogFile: 'logs/gui-audit.test.log'
      }
    }
  };

  const { server, io } = startGuiServer(createFakeBotController(), createFakeMemoryStore(), config);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function close() {
    await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  }

  return { baseUrl, close };
}

test('GUI API: /health と /api/state が応答すること', { timeout: 15_000 }, async () => {
  const ctx = await setupServer();

  try {
    const healthRes = await fetch(`${ctx.baseUrl}/health`);
    assert.equal(healthRes.ok, true);
    const health = await healthRes.json();
    assert.equal(health.ok, true);
    assert.equal(typeof health.mode, 'string');

    const stateRes = await fetch(`${ctx.baseUrl}/api/state`);
    assert.equal(stateRes.ok, true);
    const state = await stateRes.json();
    assert.equal(state.ok, true);
    assert.equal(Array.isArray(state.status.inventory), true);
  } finally {
    await ctx.close();
  }
});

test('GUI Socket: コマンド送信で command-result を受信できること', { timeout: 15_000 }, async () => {
  const ctx = await setupServer();

  try {
    const client = createClient(ctx.baseUrl, {
      transports: ['websocket'],
      reconnection: false
    });

    await new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });

    const resultPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('command-result timeout')), 5000);
      client.once('command-result', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

    client.emit('command:set-base', 'test-base');
    const result = await resultPromise;
    assert.equal(result.action, 'set-base');
    assert.equal(result.ok, true);

    client.close();
  } finally {
    await ctx.close();
  }
});

test('GUI Security: トークン必須時に無効トークンは拒否されること', { timeout: 15_000 }, async () => {
  const ctx = await setupServer({ requireToken: true, token: 'abc123' });

  try {
    const client = createClient(ctx.baseUrl, {
      auth: { token: 'invalid' },
      transports: ['websocket'],
      reconnection: false
    });

    const unauthorized = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('unauthorized timeout')), 5000);
      client.once('unauthorized', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      client.once('connect_error', () => {
        // 接続拒否でも unauthorized が先に飛ぶため、ここでは待機継続
      });
    });

    assert.equal(unauthorized.ok, false);
    assert.equal(unauthorized.reason, 'invalid-token');
    client.close();
  } finally {
    await ctx.close();
  }
});

test('GUI Socket: 新規コマンド(craft/profile/city/system)が実行できること', { timeout: 20_000 }, async () => {
  const ctx = await setupServer();

  try {
    const client = createClient(ctx.baseUrl, {
      transports: ['websocket'],
      reconnection: false
    });

    await new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });

    async function emitAndWait(eventName, payload) {
      const resultPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`command-result timeout: ${eventName}`)), 5000);
        client.once('command-result', (res) => {
          clearTimeout(timer);
          resolve(res);
        });
      });
      client.emit(eventName, payload);
      const result = await resultPromise;
      await new Promise((resolve) => setTimeout(resolve, 820));
      return result;
    }

    const profile = await emitAndWait('command:set-combat-profile', { profile: 'guardian' });
    assert.equal(profile.action, 'set-combat-profile');
    assert.equal(profile.ok, true);

    const craft = await emitAndWait('command:craft-item', { itemName: 'torch', count: 8 });
    assert.equal(craft.action, 'craft-item');
    assert.equal(craft.ok, true, JSON.stringify(craft));

    const city = await emitAndWait('command:start-city-mode', { modeName: 'city' });
    assert.equal(city.action, 'start-city-mode');
    assert.equal(city.ok, true);

    const cityStop = await emitAndWait('command:stop-city-mode', {});
    assert.equal(cityStop.action, 'stop-city-mode');
    assert.equal(cityStop.ok, true);

    const system = await emitAndWait('command:system-doctor', {});
    assert.equal(system.action, 'system-doctor');
    assert.equal(system.ok, true);

    client.close();
  } finally {
    await ctx.close();
  }
});
