const path = require('path');
const { spawnSync } = require('child_process');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    throw new Error(`command failed: ${command} ${args.join(' ')}`);
  }
}

function main() {
  const root = process.cwd();
  const target = path.join(root, 'data', 'bedrock-samples');
  const repo = 'https://github.com/Mojang/bedrock-samples.git';

  // 初回は shallow clone、以降は pull で更新
  try {
    run('git', ['-C', target, 'rev-parse', '--is-inside-work-tree'], root);
    run('git', ['-C', target, 'pull', '--ff-only', 'origin', 'main'], root);
    console.log('bedrock-samples を更新しました。');
  } catch {
    run('git', ['clone', '--depth', '1', repo, target], root);
    console.log('bedrock-samples を取得しました。');
  }
}

main();
