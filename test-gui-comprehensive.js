#!/usr/bin/env node
const http = require('http');
const { io } = require('socket.io-client');

// テスト対象ポート
const PORT = 3002;

// テスト結果を保存
const testResults = {
  httpEndpoints: [],
  socketIOEvents: [],
  commands: [],
  errors: []
};

function logSection(title) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(50)}\n`);
}

function log(message, level = 'info') {
  const icons = {
    info: 'ℹ ',
    success: '✓ ',
    error: '✗ ',
    warning: '⚠ '
  };
  console.log(`${icons[level] || '  '}${message}`);
}

async function testHTTPEndpoints() {
  logSection('HTTP エンドポイントテスト');

  const endpoints = [
    { path: '/health', description: 'Health Check' },
    { path: '/api/state', description: 'Bot Status API' },
    { path: '/', description: 'HTML Root' },
    { path: '/style.css', description: 'CSS' },
    { path: '/app.js', description: 'App JavaScript' },
    { path: '/index.html', description: 'HTML Index' }
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${PORT}${endpoint.path}`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({ status: res.statusCode, body: data, contentType: res.headers['content-type'] });
          });
        });
        req.on('error', reject);
        req.setTimeout(3000, () => reject(new Error('Timeout')));
      });

      if ([200, 301, 302, 304].includes(response.status)) {
        log(`${endpoint.path} - HTTP ${response.status}`, 'success');
        testResults.httpEndpoints.push({
          path: endpoint.path,
          description: endpoint.description,
          status: response.status,
          success: true
        });
      } else {
        log(`${endpoint.path} - HTTP ${response.status} (予期しない)`, 'warning');
        testResults.httpEndpoints.push({
          path: endpoint.path,
          description: endpoint.description,
          status: response.status,
          success: false
        });
      }
    } catch (error) {
      log(`${endpoint.path} - Error: ${error.message}`, 'error');
      testResults.httpEndpoints.push({
        path: endpoint.path,
        description: endpoint.description,
        error: error.message,
        success: false
      });
    }
  }
}

async function testSocketIOCommands() {
  logSection('Socket.IO コマンド送受信テスト');

  const commands = [
    { event: 'command:set-base', payload: { name: 'test-base' }, description: 'Base 設定' },
    { event: 'command:collect', payload: { blockName: 'stone' }, description: 'ブロック収集' },
    { event: 'command:fetch-item', payload: { itemName: 'diamond', amount: 1 }, description: 'アイテム取得' },
    { event: 'command:retreat-base', payload: {}, description: 'Base へ退却' },
    { event: 'command:fight-nearest-mob', payload: {}, description: '最寄りMob 戦闘' },
    { event: 'command:equip-best-armor', payload: {}, description: '最良防具装備' },
    { event: 'command:start-auto-mine', payload: {}, description: '自動採掘開始' },
    { event: 'command:stop-auto-mine', payload: {}, description: '自動採掘停止' },
    { event: 'command:store-inventory', payload: {}, description: 'インベントリ保存' },
    { event: 'command:fleet-list-bots', payload: {}, description: 'Fleet Bot 一覧' },
    { event: 'command:process-list', payload: {}, description: 'PM2 プロセス一覧' },
    { event: 'command:system-doctor', payload: {}, description: 'システム診断' },
    { event: 'search-item', payload: 'test', response: 'search-result', description: 'アイテム検索' },
    { event: 'refresh', payload: undefined, response: 'status', description: 'ステータス更新' }
  ];

  return new Promise((resolve) => {
    const socket = io(`http://localhost:${PORT}`, {
      reconnection: false,
      forceNew: true,
      transports: ['websocket'],
      timeout: 10000
    });

    let responsesReceived = 0;
    const timeout = setTimeout(() => {
      log(`タイムアウト: ${responsesReceived}/${commands.length} コマンドを受信`, 'warning');
      socket.disconnect();
      resolve();
    }, 15000);

    socket.on('connect', () => {
      log('Socket.IO 接続成功', 'success');
      
      // send each command
      commands.forEach((cmd, idx) => {
        setTimeout(() => {
          socket.emit(cmd.event, cmd.payload);
        }, idx * 100);
      });
    });

    socket.on('command-result', (data) => {
      const result = {
        command: data.action,
        description: commands.find(c => c.event === `command:${data.action}`)?.description || 'Unknown',
        ok: data.ok,
        success: true
      };
      testResults.commands.push(result);
      responsesReceived++;
      
      const statusIcon = data.ok ? 'success' : 'warning';
      log(`${result.command}: ${result.description} (ok: ${data.ok})`, statusIcon);

      if (responsesReceived >= commands.filter(c => c.event.startsWith('command:')).length) {
        let otherEvents = commands.filter(c => !c.event.startsWith('command:'));
        if (responsesReceived >= commands.length - otherEvents.length) {
          clearTimeout(timeout);
          socket.disconnect();
          resolve();
        }
      }
    });

    socket.on('search-result', (data) => {
      testResults.commands.push({
        command: 'search-item',
        description: 'アイテム検索',
        resultsCount: Array.isArray(data) ? data.length : 0,
        success: true
      });
      responsesReceived++;
      log(`search-item: ${Array.isArray(data) ? data.length : 0}件の結果`, 'success');
    });

    socket.on('status', (data) => {
      const keys = data ? Object.keys(data) : [];
      testResults.commands.push({
        command: 'refresh',
        description: 'ステータス更新',
        dataKeys: keys,
        success: true
      });
      responsesReceived++;
      log(`refresh: ${keys.join(', ')}`, 'success');
    });

    socket.on('error', (error) => {
      log(`Socket.IO Error: ${error}`, 'error');
      testResults.errors.push({ type: 'socket-error', message: error });
      clearTimeout(timeout);
    });

    socket.on('disconnect', () => {
      if (responsesReceived < commands.filter(c => !['search-item', 'refresh'].includes(c.event)).length) {
        log(`接続終了: ${responsesReceived}/${commands.length} コマンド受信`, 'warning');
      }
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function testUIFeatures() {
  logSection('WEB UI 機能テスト');

  return new Promise((resolve) => {
    const socket = io(`http://localhost:${PORT}`, {
      reconnection: false,
      forceNew: true,
      transports: ['websocket']
    });

    const features = [];

    socket.on('connect', () => {
      log('Socket.IO 接続成功', 'success');
    });

    socket.on('bootstrap', (data) => {
      log('bootstrap イベント受信', 'success');
      
      // Check available features from bootstrap
      if (data.mode) features.push({ feature: 'Edition Mode', value: data.mode, ok: true });
      if (data.status) features.push({ feature: 'Bot Status Available', ok: true });
      if (data.memory) features.push({ feature: 'Memory System', ok: true });
      if (data.security) features.push({ feature: 'Security Config', value: JSON.stringify(data.security), ok: true });
      
      // Test config management
      socket.emit('command:config-get');
    });

    socket.on('command-result', (data) => {
      if (data.action === 'config-get') {
        if (data.ok && data.result) {
          features.push({ feature: '設定取得', ok: true });
          log('✓ 設定取得機能OK', 'success');
        }
      }
      
      // Check for more features
      setTimeout(() => {
        socket.disconnect();
      }, 500);
    });

    socket.on('disconnect', () => {
      logSection('検出された機能');
      features.forEach(f => {
        const status = f.ok ? 'success' : 'error';
        log(`${f.feature}${f.value ? ': ' + f.value : ''}`, status);
      });
      resolve(features);
    });

    setTimeout(() => {
      socket.disconnect();
      resolve(features);
    }, 5000);
  });
}

async function main() {
  console.clear();
  console.log('\n🎮 Minecraft Auto Bedrock - 統合 WEB UI テスト\n');

  // HTTP テスト
  await testHTTPEndpoints();

  // Socket.IO テスト
  await testSocketIOCommands();

  // UI機能テスト
  await testUIFeatures();

  // テスト結果サマリー
  logSection('テスト結果サマリー');

  const successfulEndpoints = testResults.httpEndpoints.filter(e => e.success).length;
  console.log(`\n📡 HTTP エンドポイント: ${successfulEndpoints}/${testResults.httpEndpoints.length} 成功`);

  const successfulCommands = testResults.commands.filter(c => c.ok !== false).length;
  console.log(`🔌 Socket.IO コマンド: ${successfulCommands}/${testResults.commands.length} 成功`);

  if (testResults.errors.length > 0) {
    console.log(`\n⚠️  エラー検出: ${testResults.errors.length}件`);
    testResults.errors.forEach(err => {
      console.log(`   - ${err.type}: ${err.message}`);
    });
  } else {
    console.log(`\n✓ エラーなし`);
  }

  const totalTests = testResults.httpEndpoints.length + testResults.commands.filter(c => c.ok !== undefined).length;
  const passedTests = successfulEndpoints + testResults.commands.filter(c => c.ok === true).length;
  
  console.log(`\n総テスト数: ${totalTests}`);
  console.log(`合格数: ${passedTests}`);
  console.log(`成功率: ${Math.round(passedTests / totalTests * 100)}%`);
  
  console.log(`\n✓ WEB UI テスト完了\n`);
  
  process.exit(passedTests > totalTests * 0.8 ? 0 : 1);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
