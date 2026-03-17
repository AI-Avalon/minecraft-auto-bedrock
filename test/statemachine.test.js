'use strict';
/**
 * statemachine.test.js
 * BotStateMachine の単体テスト
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { BotStateMachine, STATE } = require('../src/behaviorStateMachine');
const { HumanBehavior }   = require('../src/humanBehavior');
const { FarmingModule }   = require('../src/farmingModule');
const { ExplorerModule }  = require('../src/explorerModule');
const { MultiServerManager, SERVER_STATUS, ASSIGN_POLICY } = require('../src/multiServerManager');

// ── モック ──────────────────────────────────────────────────────────────────
function makeMockBot(overrides = {}) {
  return {
    health:   20,
    food:     20,
    entity:   { position: { x: 0, y: 64, z: 0, distanceTo: () => 5 }, yaw: 0, pitch: 0 },
    entities: {},
    inventory: {
      slots: new Array(36).fill(null),
      items: () => [],
    },
    time: { timeOfDay: 6000 }, // 昼
    players: {},
    chat: () => {},
    look: () => {},
    lookAt: () => {},
    pathfinder: null,
    registry: { blocksByName: {} },
    findBlocks: () => [],
    blockAt: () => null,
    isABed: () => false,
    ...overrides,
  };
}

function makeMockCtrl(bot, extra = {}) {
  return {
    bot,
    config:       { behavior: { mode: 'hybrid' }, combat: {} },
    combatConfig: { retreatThreshold: 8, healThreshold: 10 },
    mode:         'hybrid',
    farmingModule: null,
    explorerModule: null,
    startAutoMine:          async () => {},
    retreatToBase:          async () => {},
    runAutoStoreOnce:       async () => {},
    startCombatNearestMob:  async () => {},
    ...extra,
  };
}

// ── BotStateMachine テスト ──────────────────────────────────────────────────
describe('BotStateMachine', () => {
  test('初期状態は IDLE', () => {
    const ctrl = makeMockCtrl(makeMockBot());
    const fsm = new BotStateMachine(ctrl, { initialState: STATE.IDLE });
    assert.equal(fsm.current, STATE.IDLE);
  });

  test('STATE 定数が全て文字列', () => {
    for (const [key, val] of Object.entries(STATE)) {
      assert.equal(typeof val, 'string', `STATE.${key} が文字列ではありません`);
    }
  });

  test('getStatus() が current/prev/goal/history を含む', () => {
    const ctrl = makeMockCtrl(makeMockBot());
    const fsm = new BotStateMachine(ctrl);
    const status = fsm.getStatus();
    assert.ok('current'  in status);
    assert.ok('prev'     in status);
    assert.ok('goal'     in status);
    assert.ok('history'  in status);
  });

  test('setGoal() でゴール変更', () => {
    const ctrl = makeMockCtrl(makeMockBot());
    const fsm = new BotStateMachine(ctrl);
    fsm.setGoal('farm');
    assert.equal(fsm.autonomousGoal, 'farm');
  });

  test('setGoal() に不正値を渡すと例外', () => {
    const ctrl = makeMockCtrl(makeMockBot());
    const fsm = new BotStateMachine(ctrl);
    assert.throws(() => fsm.setGoal('invalid_goal'), /不明なゴール/);
  });

  test('forceState() で状態を強制変更', () => {
    const ctrl = makeMockCtrl(makeMockBot());
    const fsm = new BotStateMachine(ctrl);
    fsm.forceState('MINING');
    assert.equal(fsm.current, STATE.MINING);
  });

  test('forceState() に不明な状態を渡すと例外', () => {
    const ctrl = makeMockCtrl(makeMockBot());
    const fsm = new BotStateMachine(ctrl);
    assert.throws(() => fsm.forceState('FLYING'), /不明な状態/);
  });

  test('attach/detach でタイマーが制御される', () => {
    const bot = makeMockBot();
    const ctrl = makeMockCtrl(bot);
    const fsm = new BotStateMachine(ctrl, { tickIntervalMs: 99999 });
    fsm.attach(bot);
    assert.ok(fsm._timer !== null);
    fsm.detach();
    assert.equal(fsm._timer, null);
  });

  test('体力が retreatThreshold 以下なら RETREATING へ遷移', (t, done) => {
    const bot = makeMockBot({ health: 5 }); // 危険体力
    const ctrl = makeMockCtrl(bot);
    const fsm = new BotStateMachine(ctrl, { tickIntervalMs: 50 });
    fsm.attach(bot);
    setTimeout(() => {
      fsm.detach();
      assert.equal(fsm.current, STATE.RETREATING);
      done();
    }, 200);
  });
});

// ── HumanBehavior テスト ────────────────────────────────────────────────────
describe('HumanBehavior', () => {
  test('インスタンス生成', () => {
    const bot = makeMockBot();
    const hb = new HumanBehavior(bot);
    assert.ok(hb);
    assert.equal(hb.enableChat,  true);
    assert.equal(hb.enableJitter, true);
  });

  test('setActivity() でアクティビティ変更', () => {
    const hb = new HumanBehavior(makeMockBot());
    hb.setActivity('mining');
    assert.equal(hb._currentActivity, 'mining');
  });

  test('start/stop でタイマーが制御される', () => {
    const hb = new HumanBehavior(makeMockBot(), {
      chatInterval:   99999,
      jitterInterval: 99999,
      headInterval:   99999,
    });
    hb.start();
    assert.ok(hb._timers.length > 0);
    hb.stop();
    assert.equal(hb._timers.length, 0);
  });
});

// ── FarmingModule テスト ────────────────────────────────────────────────────
describe('FarmingModule', () => {
  test('インスタンス生成', () => {
    const bot = makeMockBot();
    const mem = { addBase: async () => {} };
    const fm = new FarmingModule(bot, mem);
    assert.ok(fm);
    assert.equal(fm._running, false);
  });

  test('getStatus() を呼べる', () => {
    const fm = new FarmingModule(makeMockBot(), {});
    const s = fm.getStatus();
    assert.ok('running' in s);
    assert.ok('scanRadius' in s);
  });

  test('二重起動を防ぐ', async () => {
    const bot = makeMockBot();
    const mem = { addBase: async () => {} };
    const fm = new FarmingModule(bot, mem);
    // 既に running フラグを立てる
    fm._running = true;
    // startCycle を呼んでも問題なく戻る
    await fm.startCycle();
    assert.equal(fm._running, true); // 外部でフラグ立てたので true のまま
    fm._running = false;
  });
});

// ── ExplorerModule テスト ───────────────────────────────────────────────────
describe('ExplorerModule', () => {
  test('インスタンス生成', () => {
    const em = new ExplorerModule(makeMockBot(), {});
    assert.ok(em);
    assert.equal(em._running, false);
    assert.equal(em._visitedChunks.size, 0);
  });

  test('getStatus() を呼べる', () => {
    const em = new ExplorerModule(makeMockBot(), {});
    const s = em.getStatus();
    assert.ok('visitedChunks'  in s);
    assert.ok('discoveredPOIs' in s);
    assert.ok('pois'           in s);
  });

  test('getPOIList() が配列を返す', () => {
    const em = new ExplorerModule(makeMockBot(), {});
    assert.ok(Array.isArray(em.getPOIList()));
  });

  test('stop() で running フラグが落ちる', async () => {
    const em = new ExplorerModule(makeMockBot(), {}, { maxSteps: 0 });
    em._running = true;
    em.stop();
    assert.equal(em._running, false);
  });
});

// ── MultiServerManager テスト ──────────────────────────────────────────────
describe('MultiServerManager', () => {
  test('サーバー追加', () => {
    const msm = new MultiServerManager({ assignPolicy: ASSIGN_POLICY.ROUND_ROBIN });
    msm.addServer({ id: 'srv1', host: '127.0.0.1', port: 25565 });
    const status = msm.getStatus();
    assert.equal(status.servers.length, 1);
    assert.equal(status.servers[0].id, 'srv1');
  });

  test('同じIDのサーバーを二重登録しても増えない', () => {
    const msm = new MultiServerManager();
    msm.addServer({ id: 'srv1', host: '127.0.0.1', port: 25565 });
    msm.addServer({ id: 'srv1', host: '127.0.0.1', port: 25565 });
    assert.equal(msm.getStatus().servers.length, 1);
  });

  test('サーバー削除', () => {
    const msm = new MultiServerManager();
    msm.addServer({ id: 'srv1', host: '127.0.0.1', port: 25565 });
    msm.removeServer('srv1');
    assert.equal(msm.getStatus().servers.length, 0);
  });

  test('Bot 登録と割り当て（オンラインサーバーあり）', () => {
    const msm = new MultiServerManager({ assignPolicy: ASSIGN_POLICY.ROUND_ROBIN });
    msm.addServer({ id: 'srv1', host: '127.0.0.1', port: 25565 });
    // サーバーをオンラインにする
    msm._servers.get('srv1').status = SERVER_STATUS.ONLINE;
    msm.registerBot('bot1', {});
    const srv = msm.assignBot('bot1');
    assert.ok(srv !== null);
    assert.equal(srv.id, 'srv1');
  });

  test('全サーバーがオフラインなら assignBot は null を返す', () => {
    const msm = new MultiServerManager();
    msm.addServer({ id: 'srv1', host: '127.0.0.1', port: 25565 });
    // オフラインのまま（status: 'unknown'）
    msm._servers.get('srv1').status = SERVER_STATUS.OFFLINE;
    msm.registerBot('bot1', {});
    const srv = msm.assignBot('bot1');
    assert.equal(srv, null);
  });

  test('LEAST_PLAYERS ポリシー: プレイヤー数が少ない方を選ぶ', () => {
    const msm = new MultiServerManager({ assignPolicy: ASSIGN_POLICY.LEAST_PLAYERS });
    msm.addServer({ id: 's1', host: '127.0.0.1', port: 25565 });
    msm.addServer({ id: 's2', host: '127.0.0.1', port: 25566 });
    msm._servers.get('s1').status      = SERVER_STATUS.ONLINE;
    msm._servers.get('s1').playerCount = 10;
    msm._servers.get('s2').status      = SERVER_STATUS.ONLINE;
    msm._servers.get('s2').playerCount = 2;
    msm.registerBot('bot1', {});
    const srv = msm.assignBot('bot1');
    assert.equal(srv.id, 's2');
  });

  test('getStatus() に servers と bots キーが含まれる', () => {
    const msm = new MultiServerManager();
    const s = msm.getStatus();
    assert.ok(Array.isArray(s.servers));
    assert.ok(Array.isArray(s.bots));
    assert.ok('policy' in s);
  });

  test('ヘルスチェックの開始・停止', () => {
    const msm = new MultiServerManager({ pingIntervalMs: 99999 });
    msm.startHealthCheck();
    assert.ok(msm._pingTimer !== null);
    msm.stopHealthCheck();
    assert.equal(msm._pingTimer, null);
  });
});
