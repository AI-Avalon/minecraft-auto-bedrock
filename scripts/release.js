#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const simpleGit = require('simple-git');

const ROOT = path.join(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const ARGS = new Set(process.argv.slice(2));

function getArgValue(name) {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return null;
}

const TYPE = getArgValue('--type') || 'patch';
const FIXED_VERSION = getArgValue('--version');
const YES = ARGS.has('--yes') || ARGS.has('-y');
const NO_PUSH = ARGS.has('--no-push');
const NO_GH = ARGS.has('--no-gh');

const allowedTypes = new Set(['patch', 'minor', 'major']);

function color(code, text) {
  return process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
}
const ok = msg => console.log(`${color('32', '✅')} ${msg}`);
const info = msg => console.log(`${color('36', '➜')} ${msg}`);
const warn = msg => console.log(`${color('33', '⚠')} ${msg}`);
const fail = msg => console.log(`${color('31', '❌')} ${msg}`);

function readPkg() {
  return JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
}

function validVersion(ver) {
  return /^\d+\.\d+\.\d+$/.test(ver);
}

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(v => Number(v));
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: options.capture ? 'pipe' : 'inherit',
    shell: false,
    encoding: 'utf-8',
  });
}

function commandExists(cmd) {
  const probe = process.platform === 'win32'
    ? run('where', [cmd], { capture: true })
    : run('which', [cmd], { capture: true });
  return probe.status === 0;
}

async function main() {
  if (!allowedTypes.has(TYPE) && !FIXED_VERSION) {
    fail(`--type は patch/minor/major のいずれかを指定してください。現在値: ${TYPE}`);
    process.exit(1);
  }

  const git = simpleGit(ROOT);
  const status = await git.status();
  if (!status.isClean()) {
    fail('作業ツリーに未コミットの変更があります。先に commit/stash してください。');
    process.exit(1);
  }

  const currentPkg = readPkg();
  const currentVersion = currentPkg.version;
  const nextVersion = FIXED_VERSION || bumpVersion(currentVersion, TYPE);

  if (!validVersion(nextVersion)) {
    fail(`バージョン形式が不正です: ${nextVersion} (例: 2.1.0)`);
    process.exit(1);
  }

  const tag = `v${nextVersion}`;
  info(`現在バージョン: ${currentVersion}`);
  info(`次バージョン: ${nextVersion}`);

  if (!YES) {
    info('実行オプション: --yes を付けると確認なしで実行できます。');
  }

  const npmResult = run('npm', ['version', nextVersion, '--no-git-tag-version']);
  if (npmResult.status !== 0) {
    fail('npm version に失敗しました。');
    process.exit(1);
  }
  ok(`package.json を ${nextVersion} に更新しました。`);

  const addTargets = ['package.json'];
  if (fs.existsSync(path.join(ROOT, 'package-lock.json'))) {
    addTargets.push('package-lock.json');
  }
  await git.add(addTargets);
  await git.commit(`release: ${tag}`);
  ok(`コミット完了: release: ${tag}`);

  await git.addTag(tag);
  ok(`タグ作成完了: ${tag}`);

  if (!NO_PUSH) {
    await git.push('origin', 'main');
    await git.pushTags('origin');
    ok('origin/main とタグを push しました。');
  } else {
    warn('--no-push 指定のため push は実行しませんでした。');
  }

  const notesTmp = path.join(ROOT, `.release-notes-${tag}.md`);
  if (commandExists('python3')) {
    const notes = run('python3', ['scripts/make-release-notes.py', tag], { capture: true });
    if (notes.status === 0 && notes.stdout) {
      fs.writeFileSync(notesTmp, notes.stdout, 'utf-8');
      ok(`リリースノート生成: ${path.basename(notesTmp)}`);
    } else {
      warn('リリースノート生成に失敗しました (python3)。');
    }
  } else {
    warn('python3 が見つからないためリリースノート生成をスキップしました。');
  }

  if (!NO_GH && commandExists('gh') && fs.existsSync(notesTmp)) {
    const rel = run('gh', ['release', 'create', tag, '--title', tag, '--notes-file', notesTmp]);
    if (rel.status === 0) {
      ok(`GitHub Release を作成しました: ${tag}`);
    } else {
      warn('gh release create に失敗しました。手動作成してください。');
    }
  } else if (!NO_GH) {
    warn('gh CLI またはリリースノート未検出のため、GitHub Release 自動作成をスキップしました。');
  }

  info(`完了: ${tag}`);
}

main().catch(error => {
  fail(`release スクリプトでエラー: ${error.message}`);
  process.exit(1);
});
