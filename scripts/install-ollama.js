#!/usr/bin/env node
'use strict';
/**
 * scripts/install-ollama.js
 * Ollama のインストール・GPU検出・モデルダウンロード自動化スクリプト
 *
 * 使い方:
 *   node scripts/install-ollama.js               # インタラクティブ
 *   node scripts/install-ollama.js --auto         # 自動モード（全てデフォルト）
 *   node scripts/install-ollama.js --model qwen2.5:3b --gpu auto
 *   node scripts/install-ollama.js --check        # インストール状態確認のみ
 *
 * npm スクリプト:
 *   npm run ollama:setup
 *   npm run ollama:check
 */

'use strict';
const { execSync, spawnSync } = require('child_process');
const { createInterface }     = require('readline');
const https  = require('https');
const http   = require('http');
const os     = require('os');
const path   = require('path');
const fs     = require('fs');

// ── デフォルト設定 ──────────────────────────────────────────────────────────
const OLLAMA_API_BASE   = 'http://127.0.0.1:11434';
const DEFAULT_MODEL_GPU = 'qwen2.5:7b';   // GPU使用時の推奨モデル
const DEFAULT_MODEL_CPU = 'qwen2.5:3b';   // CPU使用時の推奨モデル
const OLLAMA_INSTALL_URL = 'https://ollama.com/install.sh';

// おすすめモデル一覧 (日本語対応)
const RECOMMENDED_MODELS = [
  { name: 'qwen2.5:3b',    label: 'Qwen2.5 3B   — 軽量・高速 (RAM 2GB+, CPU可)',    vram: 2 },
  { name: 'qwen2.5:7b',    label: 'Qwen2.5 7B   — バランス (RAM 4GB+, GPU推奨)',     vram: 4 },
  { name: 'qwen2.5:14b',   label: 'Qwen2.5 14B  — 高品質 (RAM 8GB+, GPU必須)',       vram: 8 },
  { name: 'llama3.2:3b',   label: 'Llama3.2 3B  — 英語中心・軽量',                    vram: 2 },
  { name: 'gemma2:2b',     label: 'Gemma2 2B    — Google製・超軽量',                  vram: 2 },
  { name: 'phi3.5:3.8b',   label: 'Phi3.5 3.8B  — Microsoft製・効率重視',             vram: 3 },
];

const args = process.argv.slice(2);

function getArgValue(flag) {
  const idx = args.indexOf(flag);
  if (idx < 0 || idx + 1 >= args.length) {
    return null;
  }
  const value = args[idx + 1];
  if (!value || value.startsWith('--')) {
    return null;
  }
  return value;
}

const AUTO_MODE    = args.includes('--auto');
const CHECK_ONLY   = args.includes('--check');
const CLI_MODEL    = getArgValue('--model');
const CLI_GPU_MODE = getArgValue('--gpu') || 'auto'; // auto/yes/no

// ── ユーティリティ ──────────────────────────────────────────────────────────
function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { stdio: 'pipe', ...opts }).toString().trim();
  } catch { return null; }
}

function runVisible(cmd) {
  return spawnSync(cmd, { shell: true, stdio: 'inherit' });
}

async function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function colorize(text, code) {
  return process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
}
const green  = t => colorize(t, '32');
const yellow = t => colorize(t, '33');
const cyan   = t => colorize(t, '36');
const bold   = t => colorize(t, '1');
const red    = t => colorize(t, '31');

// ── GPU 検出 ────────────────────────────────────────────────────────────────
function detectGPU() {
  const platform = os.platform();
  const result = {
    hasGPU:    false,
    vendor:    'none',
    gpuName:   null,
    vramMB:    0,
    cudaAvailable:   false,
    metalAvailable:  false,
    rocmAvailable:   false,
    recommendation:  'cpu',
  };

  // ── NVIDIA (CUDA) ──────────────────────────────────────────────────────────
  const nvidiaSmi = run('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits');
  if (nvidiaSmi) {
    const parts = nvidiaSmi.split(',');
    result.hasGPU  = true;
    result.vendor  = 'nvidia';
    result.gpuName = parts[0]?.trim() || 'NVIDIA GPU';
    result.vramMB  = parseInt(parts[1]?.trim() || '0', 10);
    result.cudaAvailable = true;
    result.recommendation = 'cuda';
  }

  // ── AMD (ROCm) ────────────────────────────────────────────────────────────
  if (!result.hasGPU) {
    const rocmSmi = run('rocm-smi --showproductname');
    if (rocmSmi && !rocmSmi.includes('not found')) {
      result.hasGPU  = true;
      result.vendor  = 'amd';
      result.gpuName = rocmSmi.split('\n')[0]?.trim() || 'AMD GPU (ROCm)';
      result.rocmAvailable = true;
      result.recommendation = 'rocm';
    }
  }

  // ── Apple Silicon (Metal) ─────────────────────────────────────────────────
  if (!result.hasGPU && platform === 'darwin') {
    const sysInfo = run('system_profiler SPHardwareDataType 2>/dev/null');
    if (sysInfo?.includes('Apple M')) {
      const match = sysInfo.match(/Memory:\s+(\d+)\s*GB/i);
      result.hasGPU  = true;
      result.vendor  = 'apple';
      result.gpuName = sysInfo.match(/Chip:\s+(.+)/)?.[1]?.trim() || 'Apple Silicon';
      result.vramMB  = match ? parseInt(match[1], 10) * 1024 : 8192; // 統合メモリ
      result.metalAvailable = true;
      result.recommendation = 'metal';
    }
  }

  // ── Intel GPU / 統合グラフィックス (参考情報のみ) ─────────────────────────
  if (!result.hasGPU && platform === 'linux') {
    const lspci = run('lspci 2>/dev/null | grep -i "vga\\|display\\|3d"');
    if (lspci) {
      result.hasGPU  = true;
      result.vendor  = 'intel';
      result.gpuName = lspci.split('\n')[0]?.trim() || 'Intel GPU';
      result.recommendation = 'cpu'; // Intel GPU は基本CPUモード推奨
    }
  }

  return result;
}

// ── Ollama チェック ──────────────────────────────────────────────────────────
function isOllamaInstalled() {
  return Boolean(run('ollama --version 2>/dev/null'));
}

function isOllamaRunning() {
  return new Promise(resolve => {
    const req = http.get(`${OLLAMA_API_BASE}/api/version`, res => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.abort(); resolve(false); });
  });
}

async function getInstalledModels() {
  return new Promise(resolve => {
    http.get(`${OLLAMA_API_BASE}/api/tags`, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve((parsed.models || []).map(m => m.name));
        } catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

// ── Ollama インストール ───────────────────────────────────────────────────────
async function installOllama(platform) {
  console.log(cyan('\n[Ollama] インストール中...'));

  if (platform === 'darwin') {
    // Homebrew 経由（推奨）
    if (run('which brew')) {
      console.log('  brew で Ollama をインストール中...');
      runVisible('brew install ollama');
    } else {
      // 公式インストーラー
      console.log('  公式インストーラーを使用中...');
      runVisible(`curl -fsSL ${OLLAMA_INSTALL_URL} | sh`);
    }
  } else if (platform === 'linux') {
    console.log('  公式インストーラーを使用中...');
    runVisible(`curl -fsSL ${OLLAMA_INSTALL_URL} | sh`);
  } else if (platform === 'win32') {
    // Windows: winget または手動
    if (run('where winget')) {
      console.log('  winget で Ollama をインストール中...');
      runVisible('winget install Ollama.Ollama');
    } else {
      console.log(yellow('  Windows 向け Ollama インストーラーを以下からダウンロードしてください:'));
      console.log('  https://ollama.com/download/OllamaSetup.exe');
      console.log('  インストール後、このスクリプトを再実行してください。');
      return false;
    }
  } else {
    console.log(red(`  未知のプラットフォーム: ${platform}`));
    console.log('  https://ollama.com から手動インストールしてください。');
    return false;
  }

  return isOllamaInstalled();
}

// ── Ollama 起動 ──────────────────────────────────────────────────────────────
async function startOllama() {
  const platform = os.platform();
  console.log(cyan('[Ollama] サービス起動中...'));

  if (platform === 'darwin') {
    run('brew services start ollama 2>/dev/null || ollama serve &');
  } else if (platform === 'linux') {
    run('systemctl start ollama 2>/dev/null || ollama serve &');
  } else {
    run('Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden');
  }

  // 起動待ち（最大15秒）
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await isOllamaRunning()) return true;
    process.stdout.write('.');
  }
  console.log();
  return false;
}

// ── GPU モード設定 ───────────────────────────────────────────────────────────
function configureGPUMode(gpu, useGPU) {
  const envFile = path.join(__dirname, '..', '.env');
  let envContent = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf-8') : '';

  if (useGPU) {
    // GPU使用: 環境変数から OLLAMA_NO_GPU を削除
    envContent = envContent.replace(/^OLLAMA_NO_GPU=.*\n?/m, '');
    // CUDA_VISIBLE_DEVICES が未設定なら設定
    if (gpu.vendor === 'nvidia' && !envContent.includes('CUDA_VISIBLE_DEVICES')) {
      envContent += '\nCUDA_VISIBLE_DEVICES=0';
    }
    console.log(green(`[Ollama] GPUモード有効: ${gpu.gpuName} (${gpu.recommendation})`));
  } else {
    // CPU専用: OLLAMA_NO_GPU=1 を設定
    if (!envContent.includes('OLLAMA_NO_GPU')) {
      envContent += '\nOLLAMA_NO_GPU=1';
    } else {
      envContent = envContent.replace(/^OLLAMA_NO_GPU=.*/m, 'OLLAMA_NO_GPU=1');
    }
    console.log(yellow('[Ollama] CPUモードで動作します'));
  }

  fs.writeFileSync(envFile, envContent.trim() + '\n', 'utf-8');
}

// ── config.json の llm セクションを更新 ────────────────────────────────────
function updateConfigLLM(model) {
  const configPath = path.join(__dirname, '..', 'config.json');
  if (!fs.existsSync(configPath)) {
    console.log(yellow('[Ollama] config.json が見つかりません。設定は手動で行ってください。'));
    return;
  }
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.llm = {
      ...(config.llm || {}),
      enabled:          true,
      provider:         'ollama',
      baseUrl:          OLLAMA_API_BASE,
      model:            model,
      timeoutMs:        12000,
      fallbackRuleBased: true,
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    console.log(green(`[Ollama] config.json を更新しました (model: ${model})`));
  } catch (e) {
    console.log(yellow(`[Ollama] config.json 更新失敗: ${e.message}`));
  }
}

// ── メイン処理 ────────────────────────────────────────────────────────────────
async function main() {
  console.log(bold('\n════════════════════════════════════════'));
  console.log(bold('  Ollama セットアップ / GPU 自動検出'));
  console.log(bold('════════════════════════════════════════\n'));

  const platform = os.platform();
  const sysRam   = Math.round(os.totalmem() / (1024 ** 3));
  const gpu      = detectGPU();

  // ── GPU 情報表示 ──────────────────────────────────────────────────────────
  console.log(bold('【システム情報】'));
  console.log(`  OS:     ${platform} (${os.arch()})`);
  console.log(`  RAM:    ${sysRam} GB`);
  if (gpu.hasGPU) {
    console.log(`  GPU:    ${green(gpu.gpuName)}`);
    if (gpu.vramMB > 0) {
      console.log(`  VRAM:   ${green(gpu.vramMB + ' MB')}`);
    }
    const modeLabel = {
      cuda: '✅ NVIDIA CUDA (高速)',
      rocm: '✅ AMD ROCm (高速)',
      metal: '✅ Apple Metal (高速)',
      cpu: '⚠️  CPU フォールバック',
    }[gpu.recommendation] || gpu.recommendation;
    console.log(`  推奨:   ${modeLabel}`);
  } else {
    console.log(`  GPU:    ${yellow('検出されませんでした (CPU動作)')} `);
  }

  // ── CHECK ONLY モード ──────────────────────────────────────────────────────
  if (CHECK_ONLY) {
    const installed = isOllamaInstalled();
    const running   = await isOllamaRunning();
    const models    = running ? await getInstalledModels() : [];
    console.log(`\n【Ollama 状態】`);
    console.log(`  インストール: ${installed ? green('✅') : red('❌')}`);
    console.log(`  サービス:     ${running   ? green('✅ 起動中') : red('❌ 停止中')}`);
    console.log(`  モデル:       ${models.length > 0 ? green(models.join(', ')) : yellow('なし')}`);
    return;
  }

  // ── インタラクティブ / 自動モード ──────────────────────────────────────────
  const rl = AUTO_MODE ? null : createInterface({ input: process.stdin, output: process.stdout });

  // --- 1. インストール確認 ---
  let installed = isOllamaInstalled();
  if (!installed) {
    console.log('\n' + yellow('[Ollama] Ollama がインストールされていません'));
    const doInstall = AUTO_MODE ? 'y' : await ask(rl, '  Ollama をインストールしますか? [Y/n]: ');
    if (doInstall.trim().toLowerCase() !== 'n') {
      installed = await installOllama(platform);
      if (!installed) {
        console.log(red('[Ollama] インストールに失敗しました。手動でインストールしてください:'));
        console.log('  https://ollama.com');
        rl?.close();
        process.exit(1);
      }
      console.log(green('[Ollama] インストール完了'));
    } else {
      console.log(yellow('[Ollama] スキップしました'));
      rl?.close();
      return;
    }
  } else {
    const ver = run('ollama --version 2>/dev/null');
    console.log(green(`\n[Ollama] インストール済み (${ver})`));
  }

  // --- 2. GPUモード選択 ---
  let useGPU = false;
  if (gpu.hasGPU) {
    let gpuChoice;
    if (CLI_GPU_MODE === 'yes') {
      gpuChoice = 'y';
    } else if (CLI_GPU_MODE === 'no') {
      gpuChoice = 'n';
    } else if (AUTO_MODE) {
      // 自動モード: VRAM 2GB 以上なら GPU 使用
      gpuChoice = gpu.vramMB >= 2048 || gpu.vendor === 'apple' ? 'y' : 'n';
    } else {
      console.log('\n' + bold('【GPU モード選択】'));
      console.log(`  検出されたGPU: ${gpu.gpuName}`);
      if (gpu.vramMB > 0) console.log(`  VRAM: ${gpu.vramMB} MB`);
      console.log(`  GPU使用: 高速・高品質 (大きなモデルも動作)`);
      console.log(`  CPU使用: 低速・低消費電力`);
      gpuChoice = await ask(rl, `  GPU (${gpu.recommendation}) を使用しますか? [Y/n]: `);
    }
    useGPU = gpuChoice.trim().toLowerCase() !== 'n';
  }
  configureGPUMode(gpu, useGPU);

  // --- 3. モデル選択 ---
  let selectedModel;
  if (CLI_MODEL) {
    selectedModel = CLI_MODEL;
  } else if (AUTO_MODE) {
    selectedModel = useGPU ? DEFAULT_MODEL_GPU : DEFAULT_MODEL_CPU;
  } else {
    console.log('\n' + bold('【モデル選択】'));
    console.log('  利用可能なRAM/VRAM:', useGPU
      ? `${gpu.vramMB > 0 ? gpu.vramMB + 'MB VRAM' : '統合メモリ'}`
      : `${sysRam}GB RAM (CPU動作)`
    );
    console.log();
    RECOMMENDED_MODELS.forEach((m, i) => {
      const available = useGPU
        ? (gpu.vramMB >= m.vram * 1024 || gpu.vendor === 'apple')
        : (sysRam >= m.vram);
      const label = available ? green(`[${i + 1}]`) : yellow(`[${i + 1}]`);
      console.log(`  ${label} ${m.name.padEnd(16)} ${m.label}`);
    });
    console.log();
    const defaultIdx = useGPU ? 1 : 0;
    const choice = await ask(rl, `  モデル番号を選択 [1-${RECOMMENDED_MODELS.length}] (デフォルト: ${defaultIdx + 1}): `);
    const idx = parseInt(choice.trim(), 10) - 1;
    selectedModel = RECOMMENDED_MODELS[idx]?.name || RECOMMENDED_MODELS[defaultIdx].name;
  }
  console.log(green(`[Ollama] モデル: ${selectedModel}`));

  // --- 4. Ollama サービス起動 ---
  let running = await isOllamaRunning();
  if (!running) {
    console.log(cyan('[Ollama] サービスを起動しています...'));
    running = await startOllama();
    if (!running) {
      console.log(yellow('[Ollama] サービスの自動起動に失敗しました。手動で "ollama serve" を実行してください。'));
    }
  } else {
    console.log(green('[Ollama] サービス稼働中'));
  }

  // --- 5. モデルダウンロード ---
  if (running) {
    const existingModels = await getInstalledModels();
    const modelBase = selectedModel.split(':')[0];
    const alreadyHas = existingModels.some(m => m.startsWith(modelBase));

    if (alreadyHas) {
      console.log(green(`[Ollama] モデル ${selectedModel} は既にダウンロード済みです`));
    } else {
      let doDownload;
      if (AUTO_MODE) {
        doDownload = 'y';
      } else {
        doDownload = await ask(rl, `\n  ${selectedModel} をダウンロードしますか? (数分かかる場合があります) [Y/n]: `);
      }
      if (doDownload.trim().toLowerCase() !== 'n') {
        console.log(cyan(`[Ollama] ${selectedModel} をダウンロード中...`));
        runVisible(`ollama pull ${selectedModel}`);
        console.log(green(`[Ollama] ダウンロード完了: ${selectedModel}`));
      }
    }
  }

  // --- 6. config.json 更新 ---
  updateConfigLLM(selectedModel);

  // --- 完了メッセージ ---
  console.log('\n' + bold('════════════════════════════════════════'));
  console.log(bold(green('  Ollama セットアップ完了!')));
  console.log(bold('════════════════════════════════════════'));
  console.log(`\n  モデル: ${cyan(selectedModel)}`);
  console.log(`  GPU:    ${useGPU ? green(gpu.recommendation + ' (GPU使用)') : yellow('CPU動作')}`);
  console.log(`\n  Bot起動後にプレイヤーがチャットすると`);
  console.log(`  AIが日本語で応答します。\n`);

  rl?.close();
}

main().catch(e => {
  console.error(red('\n[Ollama] エラー: ' + e.message));
  process.exit(1);
});
