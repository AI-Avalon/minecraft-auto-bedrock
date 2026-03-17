#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const net = require('net');
const { execSync } = require('child_process');

/**
 * 利用可能なポートを見つける
 * @param {number} startPort - 開始ポート
 * @param {number} maxAttempts - 最大試行回数
 * @returns {Promise<number>}
 */
async function findAvailablePort(startPort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort} after ${maxAttempts} attempts`);
}

/**
 * ポートが利用可能かチェック
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    
    server.listen(port, '127.0.0.1');
  });
}

/**
 * config.json を読み込む
 */
function loadConfig() {
  const configPath = path.resolve(process.cwd(), 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error('[ERROR] config.json not found');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * config.json にポートを保存
 */
function saveConfig(config) {
  const configPath = path.resolve(process.cwd(), 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * GUI を起動
 */
async function startGUI() {
  const config = loadConfig();
  const guiPort = config.gui?.port || 3000;
  
  console.log('[GUI] Checking port availability...');
  
  // GUIのポート確認
  let availableGuiPort = guiPort;
  try {
    if (!await isPortAvailable(guiPort)) {
      console.warn(`[GUI] Port ${guiPort} is in use, finding alternative...`);
      availableGuiPort = await findAvailablePort(guiPort, 10);
      console.log(`[GUI] Using alternative port: ${availableGuiPort}`);
      
      // config.json を更新
      config.gui = config.gui || {};
      config.gui.port = availableGuiPort;
      saveConfig(config);
    }
  } catch (err) {
    console.error(`[GUI] Error finding available port:`, err.message);
    process.exit(1);
  }
  
  // Java サーバーのポート確認（有効な場合）
  if (config.localJavaServer?.autoStart === true) {
    const javaPort = config.java?.port || 25565;
    console.log('[JavaServer] Checking port availability...');
    
    try {
      if (!await isPortAvailable(javaPort)) {
        console.warn(`[JavaServer] Port ${javaPort} is in use`);
        console.warn('[JavaServer] 推奨: config.json で localJavaServer.autoStart を false に設定');
        console.log('[JavaServer] または別のポート番号を指定してください');
      }
    } catch (err) {
      console.error(`[JavaServer] Error checking port:`, err.message);
    }
  }
  
  console.log(`[GUI] Starting on http://localhost:${availableGuiPort}`);
  
  // Java バージョンチェック
  console.log('[Java] Checking Java installation...');
  try {
    const javaOutput = execSync('java -version 2>&1', { encoding: 'utf-8' });
    const versionMatch = javaOutput.match(/version\s+"([^"]+)"/);
    if (versionMatch) {
      const version = versionMatch[1];
      const majorVersion = parseInt(version.split('.')[0]);
      console.log(`[Java] Version: ${version}`);
      
      if (majorVersion < 8) {
        console.warn('[Java] WARNING: Java 8+ required, but lower version detected');
      } else if (majorVersion < 16) {
        console.warn(`[Java] NOTE: Java ${majorVersion} detected, Java 16+ recommended for Paper/Spigot`);
      } else {
        console.log(`[Java] ✓ Java ${majorVersion} is suitable`);
      }
    }
  } catch (err) {
    console.warn('[Java] WARNING: Java not found or version check failed');
    console.warn('[Java] Please install Java 16+ for Paper server, or Java 8+ for Mineflayer');
  }
  
  // PM2 が稼働していない場合の初期化
  try {
    execSync('npx pm2 status', { stdio: 'ignore' });
  } catch {
    console.log('[PM2] Initializing...');
    try {
      execSync('npx pm2 start ecosystem.config.cjs', { stdio: 'pipe' });
    } catch (err) {
      console.error('[PM2] Error starting ecosystem:', err.message);
    }
  }
  
  console.log('[GUI] ✓ Ready');
  console.log(`[GUI] URL: http://localhost:${availableGuiPort}`);
  console.log('[GUI] ブラウザで上記 URL を開いてください');
  
  // ブラウザ自動オープン（Windows）
  if (process.platform === 'win32') {
    try {
      execSync(`start http://localhost:${availableGuiPort}`, { stdio: 'ignore' });
    } catch {
      // ignore
    }
  }
  // macOS
  else if (process.platform === 'darwin') {
    try {
      execSync(`open http://localhost:${availableGuiPort}`, { stdio: 'ignore' });
    } catch {
      // ignore
    }
  }
  // Linux
  else {
    try {
      execSync(`xdg-open http://localhost:${availableGuiPort}`, { stdio: 'ignore' });
    } catch {
      // ignore
    }
  }
}

startGUI().catch((err) => {
  console.error('[ERROR]', err.message);
  process.exit(1);
});
