const test = require('node:test');
const assert = require('node:assert/strict');

const { runConnectionDiagnostics } = require('../src/connectionDiagnostics');

const baseConfig = {
  edition: 'java',
  java: { host: '127.0.0.1', port: 65535 },
  bedrock: {
    host: '127.0.0.1',
    port: 19132,
    proxy: { listenHost: '127.0.0.1', listenPort: 25566 }
  },
  connectionPolicy: {
    allowExternalServers: false,
    allowedHosts: ['127.0.0.1', 'localhost']
  }
};

test('connection diagnostics: Java 診断結果が返ること', { timeout: 15_000 }, async () => {
  const result = await runConnectionDiagnostics(baseConfig, {
    edition: 'java',
    javaHost: '127.0.0.1',
    javaPort: 65535,
    timeoutMs: 300
  });

  assert.equal(typeof result.ok, 'boolean');
  assert.equal(result.edition, 'java');
  assert.equal(Array.isArray(result.checks), true);
  assert.equal(result.checks.some((x) => x.target === 'java-tcp'), true);
});

test('connection diagnostics: ポリシー違反を検知できること', { timeout: 15_000 }, async () => {
  const result = await runConnectionDiagnostics(baseConfig, {
    edition: 'java',
    javaHost: 'example.com',
    javaPort: 25565,
    timeoutMs: 200
  });

  assert.equal(Array.isArray(result.checks), true);
  assert.equal(result.checks.some((x) => x.reason === 'policy-block-external-host'), true);
});
