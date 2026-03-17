const net = require('net');
const dgram = require('dgram');
const dns = require('dns').promises;

function normalizeHost(host) {
  return String(host || '').trim();
}

function normalizePort(port, fallback) {
  const n = Number(port || fallback);
  return Number.isFinite(n) ? n : fallback;
}

async function probeDns(host) {
  if (!host) {
    return { ok: false, reason: 'host-empty' };
  }

  try {
    const row = await dns.lookup(host);
    return { ok: true, address: row?.address || null, family: row?.family || null };
  } catch (error) {
    return { ok: false, reason: 'dns-lookup-failed', error: error?.message || String(error) };
  }
}

function tcpProbe(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    function done(payload) {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(payload);
    }

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      done({ ok: true, latencyMs: Date.now() - start });
    });

    socket.once('timeout', () => {
      done({ ok: false, reason: 'timeout', message: `${timeoutMs}ms 以内に応答がありません` });
    });

    socket.once('error', (error) => {
      done({ ok: false, reason: error?.code || 'socket-error', message: error?.message || String(error) });
    });

    socket.connect(port, host);
  });
}

function bedrockUdpProbe(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const MAGIC = Buffer.from([
      0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe,
      0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78
    ]);

    const ping = Buffer.alloc(1 + 8 + 16 + 8);
    ping[0] = 0x01;
    ping.writeBigUInt64BE(BigInt(Date.now()), 1);
    MAGIC.copy(ping, 9);
    ping.writeBigUInt64BE(BigInt('0xDEADBEEFCAFEBABE'), 25);

    const socket = dgram.createSocket('udp4');
    const start = Date.now();
    let settled = false;

    function done(payload) {
      if (settled) {
        return;
      }
      settled = true;
      socket.close();
      resolve(payload);
    }

    const timer = setTimeout(() => {
      done({ ok: false, reason: 'timeout', message: `${timeoutMs}ms 以内に RakNet 応答がありません` });
    }, timeoutMs);

    socket.on('message', (msg) => {
      clearTimeout(timer);
      if (msg?.[0] === 0x1c) {
        done({ ok: true, latencyMs: Date.now() - start, packetSize: msg.length });
      } else {
        done({ ok: false, reason: 'unexpected-raknet-packet', message: `packetId=0x${msg?.[0]?.toString(16) || '??'}` });
      }
    });

    socket.on('error', (error) => {
      clearTimeout(timer);
      done({ ok: false, reason: error?.code || 'udp-error', message: error?.message || String(error) });
    });

    socket.send(ping, 0, ping.length, port, host, (error) => {
      if (!error) {
        return;
      }
      clearTimeout(timer);
      done({ ok: false, reason: error?.code || 'udp-send-error', message: error?.message || String(error) });
    });
  });
}

function connectionPolicyDiagnosis(policy = {}, host = '') {
  const rows = [];
  const normalized = String(host || '').toLowerCase();
  const isLocal = ['127.0.0.1', 'localhost', '::1'].includes(normalized);

  if (policy.allowExternalServers === false && !isLocal) {
    rows.push({
      ok: false,
      reason: 'policy-block-external-host',
      message: 'connectionPolicy.allowExternalServers=false のため外部ホスト接続が拒否されます。'
    });
  }

  const allowedHosts = Array.isArray(policy.allowedHosts) ? policy.allowedHosts : [];
  if (allowedHosts.length > 0 && !allowedHosts.includes(host)) {
    rows.push({
      ok: false,
      reason: 'policy-host-not-whitelisted',
      message: 'connectionPolicy.allowedHosts に接続先ホストが含まれていません。'
    });
  }

  return rows;
}

async function runConnectionDiagnostics(config, payload = {}) {
  const edition = payload.edition || config.edition;
  const timeoutMs = normalizePort(payload.timeoutMs, 5000);

  const javaHost = normalizeHost(payload.javaHost || config.java?.host);
  const javaPort = normalizePort(payload.javaPort || config.java?.port, 25565);
  const bedrockHost = normalizeHost(payload.bedrockHost || config.bedrock?.host);
  const bedrockPort = normalizePort(payload.bedrockPort || config.bedrock?.port, 19132);
  const proxyHost = normalizeHost(payload.proxyHost || config.bedrock?.proxy?.listenHost);
  const proxyPort = normalizePort(payload.proxyPort || config.bedrock?.proxy?.listenPort, 25566);

  const checks = [];
  const policyErrors = connectionPolicyDiagnosis(config.connectionPolicy || {}, edition === 'bedrock' ? (bedrockHost || proxyHost) : javaHost);
  checks.push(...policyErrors);

  if (edition === 'java') {
    checks.push({ target: 'java-dns', host: javaHost, result: await probeDns(javaHost) });
    checks.push({ target: 'java-tcp', host: javaHost, port: javaPort, result: await tcpProbe(javaHost, javaPort, timeoutMs) });
  } else {
    checks.push({ target: 'bedrock-dns', host: bedrockHost, result: await probeDns(bedrockHost) });
    checks.push({ target: 'bedrock-udp', host: bedrockHost, port: bedrockPort, result: await bedrockUdpProbe(bedrockHost, bedrockPort, timeoutMs) });

    if (proxyHost) {
      checks.push({ target: 'viaproxy-dns', host: proxyHost, result: await probeDns(proxyHost) });
      checks.push({ target: 'viaproxy-tcp', host: proxyHost, port: proxyPort, result: await tcpProbe(proxyHost, proxyPort, timeoutMs) });
    }
  }

  const failed = checks.filter((row) => row.ok === false || row.result?.ok === false);
  return {
    ok: failed.length === 0,
    edition,
    checkedAt: new Date().toISOString(),
    checks,
    suggestions: buildSuggestions(checks, edition)
  };
}

function buildSuggestions(checks = [], edition = 'java') {
  const list = [];

  for (const row of checks) {
    const reason = row.reason || row.result?.reason;
    if (!reason) {
      continue;
    }

    if (reason === 'dns-lookup-failed') {
      list.push('ホスト名解決に失敗しています。host 設定またはDNSを確認してください。');
    }

    if (reason === 'ECONNREFUSED') {
      list.push('接続先が拒否しています。サーバープロセスが起動中か、ポート番号が正しいかを確認してください。');
    }

    if (reason === 'timeout') {
      list.push('タイムアウトしています。ファイアウォール、VPN、または待受IP/ポートの不一致を確認してください。');
    }

    if (reason === 'policy-block-external-host' || reason === 'policy-host-not-whitelisted') {
      list.push('config.json の connectionPolicy を見直し、許可ホスト設定を調整してください。');
    }
  }

  if (edition === 'bedrock') {
    list.push('Bedrock接続は UDP:19132 の疎通確認が必要です。ViaProxy利用時は TCPリスナーポートも確認してください。');
  }

  return Array.from(new Set(list));
}

module.exports = {
  runConnectionDiagnostics
};