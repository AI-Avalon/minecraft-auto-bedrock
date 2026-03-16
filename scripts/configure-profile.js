const fs = require('fs');
const path = require('path');

const PROFILES = {
  'java-local': {
    edition: 'java',
    java: {
      host: '127.0.0.1',
      port: 25565,
      version: false
    }
  },
  'bedrock-avalox': {
    edition: 'bedrock',
    bedrock: {
      host: 'avalox.f5.si',
      port: 19132,
      waitForTicks: 4,
      proxy: {
        enabled: true,
        enableAutoDownload: true,
        enableAutoStart: true,
        listenHost: '127.0.0.1',
        listenPort: 25566,
        targetVersion: 'bedrocklatest',
        authMethod: 'none',
        jarPath: 'bin/ViaProxy.jar',
        githubRepo: 'ViaVersion/ViaProxy',
        fixedVersion: '',
        args: []
      }
    }
  }
};

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return override === undefined ? base : override;
  }

  const merged = { ...(base || {}) };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function usage() {
  const names = Object.keys(PROFILES).join(', ');
  console.error(`使い方: node scripts/configure-profile.js <profile>\n利用可能: ${names}`);
}

function main() {
  const profileName = process.argv[2];
  const profile = PROFILES[profileName];

  if (!profile) {
    usage();
    process.exitCode = 1;
    return;
  }

  const configPath = path.join(process.cwd(), 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error('config.json が見つかりません。先に npm run setup を実行してください。');
    process.exitCode = 1;
    return;
  }

  const current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const next = deepMerge(current, profile);
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

  console.log(`設定プロファイルを適用しました: ${profileName}`);
  console.log(`edition=${next.edition}`);
  if (next.edition === 'bedrock') {
    console.log(`bedrock=${next.bedrock.host}:${next.bedrock.port}`);
    console.log(`viaProxy=${next.bedrock.proxy.listenHost}:${next.bedrock.proxy.listenPort}`);
  }
}

main();
