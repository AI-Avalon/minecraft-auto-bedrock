#!/usr/bin/env node
'use strict';
/**
 * scripts/self-host-server.js
 * flying-squid を使った Node.js ネイティブ Minecraft サーバーの管理スクリプト
 *
 * 使い方:
 *   node scripts/self-host-server.js           # インタラクティブメニュー
 *   node scripts/self-host-server.js start      # サーバー起動
 *   node scripts/self-host-server.js stop       # 停止シグナルファイル削除
 *   node scripts/self-host-server.js status     # 起動状態確認
 *
 * npm scripts から:
 *   npm run server:selfhost
 *   npm run server:selfhost:start
 *   npm run server:selfhost:stop
 */

const path = require('path');
const fs   = require('fs');

const ROOT    = path.join(__dirname, '..');
const PID_FILE = path.join(ROOT, '.selfhost.pid');

// ── flying-squid 可用性チェック ──────────────────────────────────────────────
function checkFlyingSquid() {
  try {
    require('flying-squid');
    return true;
  } catch {
    return false;
  }
}

async function installFlyingSquid() {
  const { execSync } = require('child_process');
  console.log('[selfhost] flying-squid をインストール中...');
  try {
    execSync('npm install --save-dev flying-squid', {
      cwd: ROOT,
      stdio: 'inherit',
    });
    console.log('[selfhost] インストール完了');
    return true;
  } catch (e) {
    console.error('[selfhost] インストール失敗:', e.message);
    return false;
  }
}

// ── サーバー設定の読み込み ────────────────────────────────────────────────────
function loadConfig() {
  const configPath = path.join(ROOT, 'config.json');
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      console.warn('[selfhost] config.json 読み込み失敗。デフォルト設定を使用します。');
    }
  }
  return {
    port:       config.selfHostServer?.port       || 25565,
    version:    config.selfHostServer?.version    || '1.21.4',
    maxPlayers: config.selfHostServer?.maxPlayers || 20,
    motd:       config.selfHostServer?.motd       || 'minecraft-auto-bedrock セルフホストサーバー',
    onlineMode: config.selfHostServer?.onlineMode ?? false,
    flatWorld:  config.selfHostServer?.flatWorld  ?? true,
  };
}

// ── start コマンド ────────────────────────────────────────────────────────────
async function start() {
  if (!checkFlyingSquid()) {
    console.log('[selfhost] flying-squid が見つかりません。インストールしますか? (Y/n)');
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(r => rl.question('> ', r));
    rl.close();
    if (answer.toLowerCase() === 'n') {
      console.log('[selfhost] 中止しました。');
      return;
    }
    const ok = await installFlyingSquid();
    if (!ok) return;
  }

  const cfg = loadConfig();
  console.log(`
┌─────────────────────────────────────────────┐
│  minecraft-auto-bedrock セルフホストサーバー  │
│  Port:    ${String(cfg.port).padEnd(35)}│
│  Version: ${String(cfg.version).padEnd(35)}│
│  Mode:    ${(cfg.onlineMode ? 'オンライン' : 'オフライン（Offline）').padEnd(35)}│
└─────────────────────────────────────────────┘
`);

  const { FlyingSquidServer } = require('../src/flyingSquidServer');
  const server = new FlyingSquidServer(cfg);

  server.on('listening', () => {
    console.log(`\n✅ サーバー起動完了: localhost:${cfg.port}`);
    console.log('   Ctrl+C で停止\n');
    // PIDファイル書き込み
    fs.writeFileSync(PID_FILE, String(process.pid));
  });

  server.on('playerJoin', (p) => {
    console.log(`🟢 接続: ${p.username}`);
  });
  server.on('playerLeave', (p) => {
    console.log(`🔴 切断: ${p.username}`);
  });
  server.on('error', (e) => {
    console.error(`❌ サーバーエラー: ${e.message}`);
  });

  // Ctrl+C で停止
  process.on('SIGINT', async () => {
    console.log('\n[selfhost] 停止中...');
    await server.stop();
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    process.exit(0);
  });

  try {
    await server.start();
  } catch (e) {
    console.error('[selfhost] 起動失敗:', e.message);
    process.exit(1);
  }
}

// ── stop コマンド ─────────────────────────────────────────────────────────────
function stop() {
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'), 10);
    try {
      process.kill(pid, 'SIGINT');
      console.log(`[selfhost] プロセス ${pid} に停止シグナルを送信しました`);
    } catch (e) {
      console.log('[selfhost] プロセスが見つかりません（既に停止済み？）');
    }
    fs.unlinkSync(PID_FILE);
  } else {
    console.log('[selfhost] サーバーは起動していません（PIDファイルなし）');
  }
}

// ── status コマンド ────────────────────────────────────────────────────────────
function status() {
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'), 10);
    try {
      process.kill(pid, 0); // シグナル0 = 存在チェックのみ
      console.log(`✅ サーバー起動中 (PID: ${pid})`);
    } catch {
      console.log('⚠️  PIDファイルが残っていますが、プロセスは存在しません');
      fs.unlinkSync(PID_FILE);
    }
  } else {
    console.log('🔴 サーバーは停止しています');
  }
  // flying-squid のインストール状態
  console.log(`\nflying-squid: ${checkFlyingSquid() ? '✅ インストール済み' : '❌ 未インストール'}`);
  const cfg = loadConfig();
  console.log(`設定: port=${cfg.port}, version=${cfg.version}, flatWorld=${cfg.flatWorld}`);
}

// ── メイン ────────────────────────────────────────────────────────────────────
const command = process.argv[2] || 'start';

(async () => {
  switch (command) {
    case 'start':
      await start();
      break;
    case 'stop':
      stop();
      break;
    case 'status':
      status();
      break;
    default:
      console.log(`
使い方: node scripts/self-host-server.js [start|stop|status]

  start   flying-squid Minecraft サーバーを起動
  stop    起動中のサーバーを停止
  status  起動状態を確認
`);
  }
})();
