#!/usr/bin/env node
'use strict';
/**
 * scripts/full-install.js
 * minecraft-auto-bedrock 全自動インストールスクリプト
 *
 * 実行順序:
 *   1. 前提ツール確認 (Node.js / Java / Git / PM2)
 *   2. npm install
 *   3. 初期設定ファイル生成 (config.json)
 *   4. ViaProxy ダウンロード (Bedrockモード時)
 *   5. Bedrock samples 同期
 *   6. Ollama インストール & GPU検出 & モデルDL
 *   7. PM2 自動起動設定
 *   8. 完了案内
 *
 * 使い方:
 *   node scripts/full-install.js           # インタラクティブ
 *   node scripts/full-install.js --auto    # 全て自動（対話なし）
 *   npm run install:all
 *   npm run install:all:auto
 */

const { execSync, spawnSync } = require('child_process');
const { createInterface }     = require('readline');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const ROOT     = path.join(__dirname, '..');
const AUTO     = process.argv.includes('--auto');

// ── カラー出力 ─────────────────────────────────────────────────────────────
const c = (code, s) => process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
const green  = s => c('32', s);
const yellow = s => c('33', s);
const cyan   = s => c('36', s);
const bold   = s => c('1',  s);
const red    = s => c('31', s);

function run(cmd, opts = {}) {
  try { return execSync(cmd, { cwd: ROOT, stdio: 'pipe', ...opts }).toString().trim(); }
  catch { return null; }
}

function runVisible(cmd) {
  return spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: ROOT });
}

async function ask(rl, q, defaultY = true) {
  if (AUTO) return defaultY ? 'y' : 'n';
  return new Promise(r => rl.question(q, r));
}

// ── ステップ表示 ────────────────────────────────────────────────────────────
let stepNum = 0;
function step(label) {
  stepNum++;
  console.log(`\n${bold(`[${stepNum}]`)} ${cyan(label)}`);
}

function ok(msg)   { console.log(`  ${green('✅')} ${msg}`); }
function warn(msg) { console.log(`  ${yellow('⚠️ ')} ${msg}`); }
function info(msg) { console.log(`  ${cyan('➜')}  ${msg}`); }
function fail(msg) { console.log(`  ${red('❌')} ${msg}`); }

// ── 環境確認 ────────────────────────────────────────────────────────────────
function checkEnv() {
  step('環境確認');
  const platform = os.platform();
  const arch     = os.arch();
  const ram      = Math.round(os.totalmem() / (1024 ** 3));
  console.log(`  OS:  ${platform} (${arch})`);
  console.log(`  RAM: ${ram} GB`);

  // Node.js
  const nodeVer = run('node --version');
  if (!nodeVer) { fail('Node.js が見つかりません'); process.exit(1); }
  const major = parseInt(nodeVer.replace('v', '').split('.')[0], 10);
  if (major < 20) { fail(`Node.js ${nodeVer} は古すぎます。v20以上が必要です`); process.exit(1); }
  ok(`Node.js ${nodeVer}`);

  // Git
  const gitVer = run('git --version');
  gitVer ? ok(gitVer) : warn('Git が見つかりません。一部機能が無効になります。');

  // Java
  const javaVer = run('java -version 2>&1 | head -1');
  javaVer ? ok(`Java: ${javaVer}`) : warn('Java が見つかりません。ローカルサーバー機能が無効になります。');
}

// ── npm install ────────────────────────────────────────────────────────────
function npmInstall() {
  step('npm install (依存関係インストール)');
  info('パッケージをインストール中...');
  const result = runVisible('npm install');
  if (result.status !== 0) { fail('npm install に失敗しました'); process.exit(1); }
  ok('依存関係インストール完了');
}

// ── 設定ファイル生成 ────────────────────────────────────────────────────────
function generateConfig(rl) {
  step('初期設定ファイルの生成');
  const configPath = path.join(ROOT, 'config.json');
  if (fs.existsSync(configPath)) {
    ok('config.json は既に存在します');
    return;
  }
  info('config.template.json から config.json を生成中...');
  runVisible('node setup.js');
  ok('config.json を生成しました');
}

// ── ViaProxy ──────────────────────────────────────────────────────────────
async function setupViaProxy(rl) {
  step('ViaProxy セットアップ (Bedrock対応)');
  let configEdition = 'java';
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8'));
    configEdition = cfg.edition || 'java';
  } catch { /* ignore */ }

  if (configEdition !== 'bedrock') {
    const ans = await ask(rl, '  Bedrock サーバーに接続する予定がありますか? [y/N]: ', false);
    if (ans.trim().toLowerCase() !== 'y') {
      info('ViaProxy のセットアップをスキップしました');
      return;
    }
  }

  const jarPath = path.join(ROOT, 'bin', 'ViaProxy.jar');
  if (fs.existsSync(jarPath)) {
    ok('ViaProxy.jar は既にダウンロード済みです');
    return;
  }

  info('ViaProxy をダウンロード中...');
  runVisible('node setup.js');
  ok('ViaProxy セットアップ完了');
}

// ── Bedrock Samples ─────────────────────────────────────────────────────────
async function syncBedrockSamples(rl) {
  step('Bedrock サンプルデータ同期 (任意)');
  const ans = await ask(rl, '  Mojang Bedrock サンプルを同期しますか? (レシピ/ドロップ解析に必要) [Y/n]: ');
  if (ans.trim().toLowerCase() === 'n') {
    info('Bedrock サンプル同期をスキップしました');
    return;
  }
  info('bedrock-samples をシャロークローン中...');
  const result = runVisible('node scripts/sync-bedrock-samples.js');
  result.status === 0 ? ok('Bedrock サンプル同期完了') : warn('Bedrock サンプル同期に失敗しました (スキップ)');
}

// ── Ollama ────────────────────────────────────────────────────────────────
async function setupOllama(rl) {
  step('Ollama (LLM日本語会話) セットアップ');
  const ans = await ask(rl, '  Ollama をセットアップしますか? (日本語AI会話機能に必要) [Y/n]: ');
  if (ans.trim().toLowerCase() === 'n') {
    info('Ollama のセットアップをスキップしました。後で "npm run ollama:setup" で設定できます。');
    return;
  }
  const ollamaArgs = AUTO ? ['--auto'] : [];
  const result = spawnSync('node', ['scripts/install-ollama.js', ...ollamaArgs], {
    stdio: 'inherit', cwd: ROOT, shell: false,
  });
  result.status === 0 ? ok('Ollama セットアップ完了') : warn('Ollama セットアップに問題がありました。後で "npm run ollama:setup" を実行してください。');
}

// ── テスト実行 ────────────────────────────────────────────────────────────
function runTests() {
  step('単体テスト実行');
  info('テスト中...');
  const result = runVisible('npm test');
  result.status === 0 ? ok('全テスト通過') : warn('一部テストが失敗しました（起動自体は可能です）');
}

// ── PM2 自動起動設定 ──────────────────────────────────────────────────────
async function setupPM2(rl) {
  step('PM2 プロセス管理設定');
  if (!run('which pm2') && !run('where pm2')) {
    warn('PM2 が見つかりません。npm install -g pm2 でインストールしてください。');
    return;
  }
  const ans = await ask(rl, '  PM2 でBot自動起動を設定しますか? (OS再起動後も自動復旧) [Y/n]: ');
  if (ans.trim().toLowerCase() === 'n') {
    info('PM2 設定をスキップしました。後で "npm run pm2:start && npm run pm2:save" で設定できます。');
    return;
  }
  runVisible('npm run pm2:start');
  runVisible('npm run pm2:save');
  ok('PM2 設定完了');
  info('OS起動時自動復旧を設定するには: pm2 startup → 表示コマンドをコピーして実行');
}

// ── 完了案内 ────────────────────────────────────────────────────────────────
function showSummary() {
  console.log(`
${bold('════════════════════════════════════════════')}
${bold(green('  セットアップ完了！'))}
${bold('════════════════════════════════════════════')}

${bold('Bot 起動方法:')}
  macOS/Linux:  ${cyan('bash run.sh')}
  Windows:      ${cyan('run.bat')}
  直接起動:      ${cyan('npm start')}

${bold('接続設定 (初回):')}
  Java サーバー:    ${cyan('npm run configure:java')}
  Bedrock サーバー: ${cyan('npm run configure:bedrock')}
  外部サーバー:     ${cyan('npm run configure:java-external')}

${bold('便利なコマンド:')}
  LLM設定:          ${cyan('npm run ollama:setup')}
  セルフホスト:      ${cyan('npm run server:selfhost:start')}
  テスト:           ${cyan('npm test')}
  Web GUI:          ${cyan('npm run gui')}

${bold('設定ファイル:')}  config.json
${bold('ドキュメント:')}: README.md
`);
}

// ── エントリポイント ───────────────────────────────────────────────────────
async function main() {
  console.log(`
${bold('════════════════════════════════════════════')}
${bold('  minecraft-auto-bedrock 全自動インストール')}
${bold('════════════════════════════════════════════')}
`);

  const rl = AUTO ? null : createInterface({ input: process.stdin, output: process.stdout });

  checkEnv();
  npmInstall();
  generateConfig(rl);
  await setupViaProxy(rl);
  await syncBedrockSamples(rl);
  await setupOllama(rl);
  runTests();
  await setupPM2(rl);

  rl?.close();
  showSummary();
}

main().catch(e => {
  console.error(red('\nインストール中にエラーが発生しました: ' + e.message));
  process.exit(1);
});
