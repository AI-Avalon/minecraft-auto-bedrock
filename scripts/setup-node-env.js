#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function getArgValue(name) {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return null;
}

const AUTO = process.argv.includes('--auto');
const nodeMajorRaw = getArgValue('--node-major') || '20';
const requestedNode = nodeMajorRaw === 'latest' ? 'lts' : nodeMajorRaw;

function c(code, s) {
  return process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
}
const ok = s => console.log(`${c('32', '✅')} ${s}`);
const info = s => console.log(`${c('36', '➜')} ${s}`);
const warn = s => console.log(`${c('33', '⚠')} ${s}`);
const fail = s => console.log(`${c('31', '❌')} ${s}`);

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    shell: false,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf-8',
    ...options,
  });
}

function commandExists(cmd) {
  const probe = os.platform() === 'win32'
    ? run('where', [cmd], { capture: true })
    : run('which', [cmd], { capture: true });
  return probe.status === 0;
}

function resolveVoltaPath() {
  if (commandExists('volta')) return 'volta';

  if (os.platform() === 'win32') {
    const p = path.join(process.env.LOCALAPPDATA || '', 'Volta', 'bin', 'volta.exe');
    return p;
  }

  return path.join(process.env.HOME || '', '.volta', 'bin', 'volta');
}

function installVolta() {
  if (commandExists('volta')) {
    ok('Volta は既にインストール済みです。');
    return true;
  }

  info('Volta をインストールします。');
  if (os.platform() === 'win32') {
    if (!commandExists('winget')) {
      fail('winget が見つからないため Volta 自動導入できません。');
      warn('https://volta.sh から Volta を手動インストールしてください。');
      return false;
    }
    const r = run('winget', ['install', 'Volta.Volta', '--silent', '--accept-source-agreements', '--accept-package-agreements']);
    if (r.status !== 0) return false;
    return true;
  }

  const r = run('bash', ['-lc', 'curl -fsSL https://get.volta.sh | bash']);
  return r.status === 0;
}

function runVolta(voltaCmd, args) {
  return run(voltaCmd, args);
}

function main() {
  if (!AUTO) {
    info('Node 仮想環境 (Volta) を設定します。');
  }

  if (!installVolta()) {
    process.exit(1);
  }

  const volta = resolveVoltaPath();
  const target = requestedNode === 'lts' ? 'node@lts' : `node@${requestedNode}`;

  info(`Node を導入: ${target}`);
  const installNode = runVolta(volta, ['install', target]);
  if (installNode.status !== 0) {
    fail('volta install に失敗しました。');
    process.exit(1);
  }

  info(`このプロジェクトに pin: ${target}`);
  const pinNode = runVolta(volta, ['pin', target]);
  if (pinNode.status !== 0) {
    fail('volta pin に失敗しました。');
    process.exit(1);
  }

  const check = runVolta(volta, ['run', 'node', '--version'], { capture: true });
  if (check.status === 0) {
    ok(`Volta Node 有効化完了: ${(check.stdout || '').trim()}`);
  } else {
    warn('Volta Node のバージョン確認に失敗しました。新しいターミナルで確認してください。');
  }

  info('以後、このプロジェクトでは Volta が pin した Node を優先利用します。');
}

main();
