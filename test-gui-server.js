#!/usr/bin/env node
const http = require('http');
const { io } = require('socket.io-client');

// テスト対象ポート（複数試行）
const ports = [3002, 3003, 3004, 3005, 8080];

async function testGUIServer(port) {
  console.log(`\n========== ポート ${port} でGUIサーバーテスト ==========\n`);

  // HTTP 接続テスト
  console.log(`[HTTP] GET http://localhost:${port}/health`);
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.get(`http://localhost:${port}/health`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({ status: res.statusCode, body: data });
        });
      });
      req.on('error', reject);
      req.setTimeout(3000, () => reject(new Error('Timeout')));
    });
    console.log(`✓ HTTP ${response.status}`);
  } catch (error) {
    console.log(`✗ HTTP失敗: ${error.message}`);
    return false;
  }

  // HTTP API テスト
  console.log(`\n[HTTP] GET http://localhost:${port}/api/state`);
  try {
    const response = await new Promise((resolve, reject) => {
      const req = http.get(`http://localhost:${port}/api/state`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({ status: res.statusCode, body: data });
        });
      });
      req.on('error', reject);
      req.setTimeout(3000, () => reject(new Error('Timeout')));
    });
    console.log(`✓ HTTP ${response.status}`);
    if (response.status === 200) {
      try {
        const state = JSON.parse(response.body);
        console.log(`✓ State取得成功: ${Object.keys(state).join(', ')}`);
      } catch (e) {
        console.log(`✓ State取得（パース失敗）: ${response.body.substring(0, 100)}`);
      }
    }
  } catch (error) {
    console.log(`✗ HTTP API失敗: ${error.message}`);
  }

  // Socket.IO 接続テスト
  console.log(`\n[Socket.IO] ws://localhost:${port}`);
  return new Promise((resolve) => {
    const socket = io(`http://localhost:${port}`, {
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
      timeout: 5000
    });

    const testResults = {
      connected: false,
      bootstrapReceived: false,
      commandsTestedCount: 0,
      errors: []
    };

    const timeout = setTimeout(() => {
      console.log(`✗ Socket.IO 接続タイムアウト (5秒)`);
      socket.disconnect();
      resolve(false);
    }, 5000);

    socket.on('connect', () => {
      console.log(`✓ Socket.IO 接続成功`);
      testResults.connected = true;
      clearTimeout(timeout);
    });

    socket.on('bootstrap', (data) => {
      console.log(`✓ bootstrap イベント受信`);
      testResults.bootstrapReceived = true;
      
      if (data.mode) console.log(`  - mode: ${data.mode}`);
      if (data.status) console.log(`  - status キー: ${Object.keys(data.status).join(', ')}`);
      if (data.memory) console.log(`  - memory キー: ${Object.keys(data.memory).join(', ')}`);
      if (data.security) console.log(`  - security: ${JSON.stringify(data.security)}`);

      // bootstrap 受け取り後、コマンドテスト
      console.log(`\n[Commands] テストコマンド送信`);
      
      // コマンド1: set-base
      socket.emit('command:set-base', { name: 'test-base' });
      testResults.commandsTestedCount++;
    });

    socket.on('command-result', (data) => {
      console.log(`✓ command-result: ${data.action} (ok: ${data.ok})`);
      
      if (data.action === 'set-base') {
        // コマンド2: collect
        socket.emit('command:collect', { blockName: 'stone' });
        testResults.commandsTestedCount++;
      } else if (data.action === 'collect') {
        // コマンド3: start-auto-mine
        socket.emit('command:start-auto-mine', {});
        testResults.commandsTestedCount++;
      } else if (data.action === 'start-auto-mine') {
        // コマンド4: stop-auto-mine
        socket.emit('command:stop-auto-mine', {});
        testResults.commandsTestedCount++;
      } else if (data.action === 'stop-auto-mine') {
        // コマンド5: fleet-list-bots
        socket.emit('command:fleet-list-bots', {});
        testResults.commandsTestedCount++;
      } else if (data.action === 'fleet-list-bots') {
        // テスト完了
        console.log(`\n✓ ${testResults.commandsTestedCount}個のコマンドを送信成功\n`);
        console.log('===== テスト成功 =====\n');
        socket.disconnect();
        clearTimeout(timeout);
        resolve(true);
      }
    });

    socket.on('fleet-bots-list', (data) => {
      console.log(`✓ fleet-bots-list: ${Array.isArray(data) ? data.length : 0}個のBot`);
    });

    socket.on('error', (error) => {
      console.log(`✗ Socket.IO エラー: ${error}`);
      testResults.errors.push(error);
      clearTimeout(timeout);
    });

    socket.on('disconnect', () => {
      if (testResults.connected && testResults.bootstrapReceived) {
        resolve(true);
      } else {
        console.log(`✗ Socket.IO 予期しない切断`);
        resolve(false);
      }
    });
  });
}

async function main() {
  console.log('🔍 Minecraft Auto Bedrock - WEB UI テスト\n');

  for (const port of ports) {
    try {
      const success = await testGUIServer(port);
      if (success) {
        console.log(`✓ ポート ${port} でGUIサーバーが正常に動作しています\n`);
        process.exit(0);
      }
    } catch (error) {
      // Continue to next port
    }
  }

  console.log('✗ どのポートでも接続できませんでした\n');
  process.exit(1);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
