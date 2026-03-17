#!/usr/bin/env node
'use strict';
/**
 * scripts/full-install.js
 * minecraft-auto-bedrock セットアップスクリプト
 *
 * 機能:
 *   - 対話で「何を設定するか」を選択可能
 *   - 常駐運用 (PM2) する/しないを選択可能
 *   - 途中再開用のチェックポイント保存
 *
 * 使い方:
 *   node scripts/full-install.js
 *   node scripts/full-install.js --auto
 *   node scripts/full-install.js --resume
 *   node scripts/full-install.js --auto --resume --with-ollama --with-pm2
 */

const { execSync, spawnSync } = require('child_process');
const { createInterface } = require('readline');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const ARGS = new Set(process.argv.slice(2));

const AUTO = ARGS.has('--auto');
const RESUME = ARGS.has('--resume');
const RESET_PROGRESS = ARGS.has('--reset-progress');
const WITH_BEDROCK_SAMPLES = ARGS.has('--with-bedrock-samples');
const WITH_OLLAMA = ARGS.has('--with-ollama');
const WITH_TESTS = ARGS.has('--with-tests');
const WITH_PM2 = ARGS.has('--with-pm2');
const SHOW_STEPS = ARGS.has('--show-steps');
const USE_VOLTA = ARGS.has('--use-volta');
const PROGRESS_FILE = path.join(ROOT, '.install-progress.json');

function getArgValue(name) {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return null;
}

const REQUIRED_NODE_MAJOR = Number(getArgValue('--node-major') || '20');
const FROM_STEP = getArgValue('--from-step');

const STEP = {
  PREREQS: 'prereqs',
  ENV: 'env',
  NPM_INSTALL: 'npmInstall',
  NODE_ENV: 'nodeEnv',
  CONFIG: 'config',
  VIAPROXY: 'viaProxy',
  BEDROCK_SAMPLES: 'bedrockSamples',
  OLLAMA: 'ollama',
  TESTS: 'tests',
  RESIDENT: 'resident',
};

const STEP_ORDER = [
  STEP.PREREQS,
  STEP.ENV,
  STEP.NPM_INSTALL,
  STEP.NODE_ENV,
  STEP.CONFIG,
  STEP.VIAPROXY,
  STEP.BEDROCK_SAMPLES,
  STEP.OLLAMA,
  STEP.TESTS,
  STEP.RESIDENT,
];

const STEP_LABEL = {
  [STEP.PREREQS]: '前提ツール確認/導入',
  [STEP.ENV]: '環境確認',
  [STEP.NPM_INSTALL]: 'npm install (依存関係インストール)',
  [STEP.NODE_ENV]: 'Node 仮想環境 (Volta) 設定',
  [STEP.CONFIG]: '初期設定ファイルの生成',
  [STEP.VIAPROXY]: 'ViaProxy セットアップ (Bedrock対応)',
  [STEP.BEDROCK_SAMPLES]: 'Bedrock サンプルデータ同期',
  [STEP.OLLAMA]: 'Ollama セットアップ',
  [STEP.TESTS]: '単体テスト実行',
  [STEP.RESIDENT]: '常駐運用 (PM2) 設定',
};

const c = (code, s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = s => c('32', s);
const yellow = s => c('33', s);
const cyan = s => c('36', s);
const bold = s => c('1', s);
const red = s => c('31', s);

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: 'pipe', ...opts }).toString().trim();
  } catch {
    return null;
  }
}

function runVisible(cmd, cwd = ROOT) {
  return spawnSync(cmd, { shell: true, stdio: 'inherit', cwd });
}

async function ask(rl, q, defaultY = true) {
  if (AUTO) return defaultY ? 'y' : 'n';
  return new Promise(resolve => rl.question(q, resolve));
}

function isYes(answer, defaultYes = false) {
  const normalized = (answer || '').trim().toLowerCase();
  if (!normalized) return defaultYes;
  return normalized === 'y' || normalized === 'yes';
}

let stepNum = 0;
function step(label) {
  stepNum += 1;
  console.log(`\n${bold(`[${stepNum}]`)} ${cyan(label)}`);
}

function ok(msg) {
  console.log(`  ${green('✅')} ${msg}`);
}
function warn(msg) {
  console.log(`  ${yellow('⚠️ ')} ${msg}`);
}
function info(msg) {
  console.log(`  ${cyan('➜')}  ${msg}`);
}
function fail(msg) {
  console.log(`  ${red('❌')} ${msg}`);
}

function defaultSelection() {
  return {
    [STEP.PREREQS]: true,
    [STEP.ENV]: true,
    [STEP.NPM_INSTALL]: true,
    [STEP.NODE_ENV]: AUTO ? USE_VOLTA : false,
    [STEP.CONFIG]: true,
    [STEP.VIAPROXY]: true,
    [STEP.BEDROCK_SAMPLES]: AUTO ? WITH_BEDROCK_SAMPLES : false,
    [STEP.OLLAMA]: AUTO ? WITH_OLLAMA : false,
    [STEP.TESTS]: AUTO ? WITH_TESTS : false,
    [STEP.RESIDENT]: AUTO ? WITH_PM2 : false,
  };
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveProgress(state) {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function resetProgressFile() {
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
  }
}

function createProgressState(selection, previousCompleted = []) {
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    selection,
    requiredNodeMajor: REQUIRED_NODE_MAJOR,
    completedSteps: [...previousCompleted],
  };
}

function normalizeFromStep(fromStep) {
  if (!fromStep) return null;
  if (STEP_ORDER.includes(fromStep)) return fromStep;

  const lowered = String(fromStep).toLowerCase().trim();
  const alias = {
    prereqs: STEP.PREREQS,
    env: STEP.ENV,
    npminstall: STEP.NPM_INSTALL,
    config: STEP.CONFIG,
    viaproxy: STEP.VIAPROXY,
    bedrocksamples: STEP.BEDROCK_SAMPLES,
    ollama: STEP.OLLAMA,
    tests: STEP.TESTS,
    resident: STEP.RESIDENT,
    pm2: STEP.RESIDENT,
  };
  return alias[lowered] || null;
}

function getCompletedUntilStep(fromStep) {
  if (!fromStep) return [];
  const idx = STEP_ORDER.indexOf(fromStep);
  if (idx <= 0) return [];
  return STEP_ORDER.slice(0, idx);
}

function getJavaVersionLine() {
  const result = spawnSync('java', ['-version'], {
    cwd: ROOT,
    shell: false,
    encoding: 'utf-8',
  });
  const output = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
  if (!output) return null;
  return output.split(/\r?\n/)[0] || null;
}

function checkEnv() {
  const platform = os.platform();
  const arch = os.arch();
  const ram = Math.round(os.totalmem() / (1024 ** 3));

  console.log(`  OS:  ${platform} (${arch})`);
  console.log(`  RAM: ${ram} GB`);

  const nodeVer = run('node --version');
  if (!nodeVer) {
    fail('Node.js が見つかりません。');
    if (platform === 'win32') {
      info('対処: setup.bat を実行すると前提ツールの導入を補助できます。');
      info('導入後に setup.bat --resume を実行してください。');
    }
    return false;
  }

  const major = parseInt(nodeVer.replace('v', '').split('.')[0], 10);
  if (Number.isNaN(major) || major < REQUIRED_NODE_MAJOR) {
    fail(`Node.js ${nodeVer} は古すぎます。v${REQUIRED_NODE_MAJOR} 以上が必要です。`);
    if (platform === 'win32') {
      info(`対処1: setup.bat --node-major=${REQUIRED_NODE_MAJOR} を実行して Node.js を導入`);
      info('対処2: scripts\\install-prereqs.bat を実行');
      info('導入後: 新しいターミナルで setup.bat --resume');
    } else {
      info(`対処: bash scripts/install-prereqs.sh --node-major=${REQUIRED_NODE_MAJOR} 実行後、node scripts/full-install.js --resume`);
    }
    return false;
  }
  ok(`Node.js ${nodeVer}`);

  const gitVer = run('git --version');
  if (gitVer) ok(gitVer);
  else warn('Git が見つかりません。一部機能が無効になります。');

  const javaVer = getJavaVersionLine();
  if (javaVer) ok(`Java: ${javaVer}`);
  else warn('Java が見つかりません。ローカルサーバー機能が無効になります。');

  return true;
}

function runPrereqInstaller(selection) {
  const isWin = os.platform() === 'win32';
  const args = [];

  if (AUTO) args.push('--auto');
  if (selection[STEP.OLLAMA]) args.push('--with-ollama');
  args.push(`--node-major=${REQUIRED_NODE_MAJOR}`);

  const cmd = isWin
    ? `scripts\\install-prereqs.bat ${args.join(' ')}`.trim()
    : `bash scripts/install-prereqs.sh ${args.join(' ')}`.trim();

  info(`前提ツールセットアップを実行: ${cmd}`);
  const result = runVisible(cmd);
  return result.status === 0;
}

function npmInstall() {
  info('パッケージをインストール中...');
  const result = runVisible('npm install');
  if (result.status !== 0) {
    fail('npm install に失敗しました');
    return false;
  }
  return true;
}

function setupProjectNodeEnv() {
  const args = ['scripts/setup-node-env.js', `--node-major=${REQUIRED_NODE_MAJOR}`];
  if (AUTO) args.push('--auto');
  const result = spawnSync('node', args, {
    stdio: 'inherit',
    cwd: ROOT,
    shell: false,
  });
  if (result.status !== 0) {
    warn('Node 仮想環境設定に失敗しました。通常の Node 実行は継続可能です。');
  }
  return true;
}

function generateConfig() {
  const configPath = path.join(ROOT, 'config.json');
  if (fs.existsSync(configPath)) {
    info('config.json は既に存在するため生成をスキップ');
    return true;
  }

  info('config.template.json から config.json を生成中...');
  const result = runVisible('node setup.js');
  if (result.status !== 0) {
    fail('config.json 生成に失敗しました');
    return false;
  }
  return true;
}

async function setupViaProxy(rl) {
  let configEdition = 'java';
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8'));
    configEdition = cfg.edition || 'java';
  } catch {
    // config がない場合は後続の質問で吸収
  }

  if (configEdition !== 'bedrock') {
    const ans = await ask(rl, '  Bedrock サーバーに接続する予定がありますか? [y/N]: ', false);
    if (!isYes(ans, false)) {
      info('ViaProxy のセットアップをスキップしました');
      return true;
    }
  }

  const jarPath = path.join(ROOT, 'bin', 'ViaProxy.jar');
  if (fs.existsSync(jarPath)) {
    info('ViaProxy.jar は既にダウンロード済みです');
    return true;
  }

  info('ViaProxy をセットアップ中...');
  const result = runVisible('node setup.js');
  if (result.status !== 0) {
    warn('ViaProxy セットアップに失敗しました（後で npm run setup で再試行可能）');
    return true;
  }
  return true;
}

function syncBedrockSamples() {
  info('bedrock-samples を同期中...');
  const result = runVisible('node scripts/sync-bedrock-samples.js');
  if (result.status !== 0) {
    warn('Bedrock サンプル同期に失敗しました（後で npm run bedrock:sync で再実行可能）');
  }
  return true;
}

function setupOllama() {
  const ollamaArgs = AUTO ? ['--auto'] : [];
  const result = spawnSync('node', ['scripts/install-ollama.js', ...ollamaArgs], {
    stdio: 'inherit',
    cwd: ROOT,
    shell: false,
  });
  if (result.status !== 0) {
    warn('Ollama セットアップに問題がありました。後で npm run ollama:setup を実行してください。');
  }
  return true;
}

function runTests() {
  info('テスト中...');
  const result = runVisible('npm test');
  if (result.status !== 0) {
    warn('一部テストが失敗しました（起動自体は可能です）');
  }
  return true;
}

function setupPM2() {
  if (!run('which pm2') && !run('where pm2')) {
    warn('PM2 が見つかりません。npm install -g pm2 でインストールしてください。');
    return true;
  }

  runVisible('npm run pm2:start');
  runVisible('npm run pm2:save');
  info('OS起動時自動復旧を設定するには: pm2 startup → 表示コマンドを実行');
  return true;
}

async function chooseSelection(rl, loadedProgress) {
  const selection = defaultSelection();

  if (AUTO) {
    return selection;
  }

  console.log(`\n${bold('設定項目を選択できます（Enterで既定値）')}`);
  console.log(`  Node.js 必須メジャー: v${REQUIRED_NODE_MAJOR}+`);

  selection[STEP.PREREQS] = isYes(
    await ask(rl, '  前提ツール確認/導入を実行しますか? [Y/n]: ', true),
    true,
  );
  selection[STEP.NPM_INSTALL] = isYes(
    await ask(rl, '  npm install を実行しますか? [Y/n]: ', true),
    true,
  );
  selection[STEP.CONFIG] = isYes(
    await ask(rl, '  config.json を準備しますか? [Y/n]: ', true),
    true,
  );
  selection[STEP.NODE_ENV] = isYes(
    await ask(rl, '  Node をプロジェクト固定(Volta)で管理しますか? [y/N]: ', false),
    false,
  );
  selection[STEP.VIAPROXY] = isYes(
    await ask(rl, '  ViaProxy セットアップを実行しますか? [Y/n]: ', true),
    true,
  );
  selection[STEP.BEDROCK_SAMPLES] = isYes(
    await ask(rl, '  Bedrock サンプルデータを同期しますか? [y/N]: ', false),
    false,
  );
  selection[STEP.OLLAMA] = isYes(
    await ask(rl, '  Ollama をセットアップしますか? [y/N]: ', false),
    false,
  );
  selection[STEP.TESTS] = isYes(
    await ask(rl, '  テストを実行しますか? [y/N]: ', false),
    false,
  );
  selection[STEP.RESIDENT] = isYes(
    await ask(rl, '  常駐運用 (PM2) を設定しますか? [y/N]: ', false),
    false,
  );

  if (loadedProgress) {
    const keep = isYes(
      await ask(rl, '  既存の途中再開情報があります。完了済みステップを引き継ぎますか? [Y/n]: ', true),
      true,
    );
    if (!keep) {
      resetProgressFile();
    }
  }

  return selection;
}

async function runStep(progress, id, label, fn) {
  if (!progress.selection[id]) {
    info(`${label} をスキップ`);
    return;
  }

  if (progress.completedSteps.includes(id)) {
    ok(`途中再開: ${label} は完了済み`);
    return;
  }

  step(label);
  const result = await fn();
  if (!result) {
    throw new Error(`${label} に失敗しました。`);
  }

  progress.completedSteps.push(id);
  saveProgress(progress);
  ok(`${label} 完了 (チェックポイント保存)`);
}

function showSummary(progress) {
  const resident = progress.selection[STEP.RESIDENT];
  console.log(`
${bold('════════════════════════════════════════════')}
${bold(green('  セットアップ完了！'))}
${bold('════════════════════════════════════════════')}

${bold('Bot 起動方法:')}
  macOS/Linux:  ${cyan('bash run.sh')}
  Windows:      ${cyan('run.bat')}
  直接起動:      ${cyan('npm start')}

${bold('運用モード:')}
  ${resident ? cyan('常駐運用 (PM2) を設定済み') : cyan('非常駐運用 (必要時に run.bat / npm start)')}

${bold('途中再開:')}
  チェックポイント: ${cyan('.install-progress.json')}
  再開コマンド:     ${cyan('node scripts/full-install.js --resume')}
  途中開始指定:     ${cyan('node scripts/full-install.js --from-step=config')}
  Node固定有効化:   ${cyan('node scripts/full-install.js --use-volta')}
  Windows推奨:      ${cyan('setup.bat --resume')}

${bold('接続設定 (初回):')}
  Java サーバー:    ${cyan('npm run configure:java')}
  Bedrock サーバー: ${cyan('npm run configure:bedrock')}
  外部サーバー:     ${cyan('npm run configure:java-external')}
`);
}

async function main() {
  console.log(`
${bold('════════════════════════════════════════════')}
${bold('  minecraft-auto-bedrock セットアップ')}
${bold('════════════════════════════════════════════')}
`);

  if (SHOW_STEPS) {
    console.log('利用可能なステップID:');
    for (const id of STEP_ORDER) {
      console.log(`  - ${id} : ${STEP_LABEL[id]}`);
    }
    return;
  }

  if (!Number.isInteger(REQUIRED_NODE_MAJOR) || REQUIRED_NODE_MAJOR < 18) {
    fail('--node-major は 18 以上の整数を指定してください。例: --node-major=20');
    process.exit(1);
  }

  const normalizedFromStep = normalizeFromStep(FROM_STEP);
  if (FROM_STEP && !normalizedFromStep) {
    fail(`不正な --from-step です: ${FROM_STEP}`);
    info('利用可能な値を確認するには --show-steps を実行してください。');
    process.exit(1);
  }

  if (RESET_PROGRESS) {
    resetProgressFile();
    info('既存の途中再開情報を削除しました (--reset-progress)');
  }

  const loadedProgress = loadProgress();
  const rl = AUTO ? null : createInterface({ input: process.stdin, output: process.stdout });

  let selection;
  if (RESUME && loadedProgress && loadedProgress.selection) {
    selection = loadedProgress.selection;
    info('途中再開モードで実行します。保存済みの設定を使用します。');
  } else {
    selection = await chooseSelection(rl, loadedProgress);
  }

  let previousCompleted = RESUME && loadedProgress ? loadedProgress.completedSteps || [] : [];
  if (normalizedFromStep) {
    previousCompleted = getCompletedUntilStep(normalizedFromStep);
    info(`途中開始: ${STEP_LABEL[normalizedFromStep]} から実行します。`);
  }
  const progress = createProgressState(selection, previousCompleted);
  saveProgress(progress);

  try {
    await runStep(progress, STEP.PREREQS, STEP_LABEL[STEP.PREREQS], () => runPrereqInstaller(selection));
    await runStep(progress, STEP.ENV, STEP_LABEL[STEP.ENV], () => checkEnv());
    await runStep(progress, STEP.NPM_INSTALL, STEP_LABEL[STEP.NPM_INSTALL], () => npmInstall());
    await runStep(progress, STEP.NODE_ENV, STEP_LABEL[STEP.NODE_ENV], () => setupProjectNodeEnv());
    await runStep(progress, STEP.CONFIG, STEP_LABEL[STEP.CONFIG], () => generateConfig());
    await runStep(progress, STEP.VIAPROXY, STEP_LABEL[STEP.VIAPROXY], () => setupViaProxy(rl));
    await runStep(progress, STEP.BEDROCK_SAMPLES, STEP_LABEL[STEP.BEDROCK_SAMPLES], () => syncBedrockSamples());
    await runStep(progress, STEP.OLLAMA, STEP_LABEL[STEP.OLLAMA], () => setupOllama());
    await runStep(progress, STEP.TESTS, STEP_LABEL[STEP.TESTS], () => runTests());
    await runStep(progress, STEP.RESIDENT, STEP_LABEL[STEP.RESIDENT], () => setupPM2());

    if (fs.existsSync(PROGRESS_FILE)) {
      fs.unlinkSync(PROGRESS_FILE);
    }

    rl?.close();
    showSummary(progress);
  } catch (error) {
    rl?.close();
    fail(`インストール中にエラーが発生しました: ${error.message}`);
    info('途中再開するには: node scripts/full-install.js --resume');
    info('Windows では: setup.bat --resume');
    process.exit(1);
  }
}

main().catch(error => {
  fail(`予期しないエラー: ${error.message}`);
  process.exit(1);
});
