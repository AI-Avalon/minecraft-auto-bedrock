const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { logger } = require('./logger');

function createAuditWriter(config) {
  const security = config.gui.security || {};
  const filePath = path.resolve(process.cwd(), security.auditLogFile || 'logs/gui-audit.log');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  return (event) => {
    const row = `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`;
    fs.appendFile(filePath, row, () => {});
  };
}

function createCommandLimiter(config) {
  const security = config.gui.security || {};
  const commandCooldownMs = Number(security.commandCooldownMs || 800);
  const maxCommandsPerMinute = Number(security.maxCommandsPerMinute || 20);
  const socketState = new Map();

  return {
    canRun(socketId) {
      const now = Date.now();
      const state = socketState.get(socketId) || { lastAt: 0, history: [] };
      const recentHistory = state.history.filter((time) => now - time < 60_000);

      if (now - state.lastAt < commandCooldownMs) {
        socketState.set(socketId, { ...state, history: recentHistory });
        return { ok: false, reason: 'cooldown' };
      }

      if (recentHistory.length >= maxCommandsPerMinute) {
        socketState.set(socketId, { ...state, history: recentHistory });
        return { ok: false, reason: 'rate-limit' };
      }

      recentHistory.push(now);
      socketState.set(socketId, { lastAt: now, history: recentHistory });
      return { ok: true };
    },
    remove(socketId) {
      socketState.delete(socketId);
    }
  };
}

function requireToken(socket, config) {
  const security = config.gui.security || {};
  if (!security.requireToken) {
    return true;
  }

  const token = socket.handshake.auth?.token || socket.handshake.query?.token || '';
  return token && token === security.token;
}

function buildSecurityPayload(config) {
  const security = config.gui.security || {};
  return {
    requireToken: Boolean(security.requireToken),
    readOnly: Boolean(security.readOnly),
    allowedCommands: security.allowedCommands || []
  };
}

function registerSocketHandlers(io, botController, memoryStore, config) {
  const security = config.gui.security || {};
  const audit = createAuditWriter(config);
  const limiter = createCommandLimiter(config);

  async function runCommand(socket, action, payload, handler) {
    if (security.readOnly) {
      socket.emit('command-result', { action, ok: false, reason: 'read-only' });
      audit({ type: 'command-denied', action, reason: 'read-only', socketId: socket.id });
      return;
    }

    const allowed = new Set(security.allowedCommands || []);
    if (allowed.size > 0 && !allowed.has(action)) {
      socket.emit('command-result', { action, ok: false, reason: 'not-allowed' });
      audit({ type: 'command-denied', action, reason: 'not-allowed', socketId: socket.id });
      return;
    }

    const limit = limiter.canRun(socket.id);
    if (!limit.ok) {
      socket.emit('command-result', { action, ok: false, reason: limit.reason });
      audit({ type: 'command-denied', action, reason: limit.reason, socketId: socket.id });
      return;
    }

    try {
      const result = await handler();
      socket.emit('command-result', { action, ok: true, result });
      audit({ type: 'command-ok', action, payload, socketId: socket.id });
    } catch (error) {
      socket.emit('command-result', { action, ok: false, reason: 'internal-error' });
      audit({ type: 'command-error', action, payload, socketId: socket.id, error: String(error) });
      logger.warn(`GUI command failed: ${action}`, error);
    }
  }

  io.on('connection', (socket) => {
    if (!requireToken(socket, config)) {
      audit({ type: 'connect-denied', socketId: socket.id });
      socket.emit('unauthorized', { ok: false, reason: 'invalid-token' });
      socket.disconnect(true);
      return;
    }

    audit({ type: 'connect', socketId: socket.id, address: socket.handshake.address });
    socket.emit('bootstrap', {
      mode: config.edition,
      status: botController.status(),
      memory: memoryStore.snapshot(),
      security: buildSecurityPayload(config)
    });

    socket.on('refresh', () => {
      socket.emit('status', {
        mode: config.edition,
        status: botController.status(),
        memory: memoryStore.snapshot(),
        security: buildSecurityPayload(config)
      });
    });

    socket.on('search-item', (query) => {
      const result = memoryStore.searchItems(String(query || '').trim());
      socket.emit('search-result', result);
      audit({ type: 'search', query: String(query || ''), rows: result.length, socketId: socket.id });
    });

    socket.on('command:set-base', async (name) => {
      await runCommand(socket, 'set-base', { name }, async () => {
        return botController.setBaseHere(name);
      });
    });

    socket.on('command:collect', async (blockName) => {
      await runCommand(socket, 'collect', { blockName }, async () => {
        const ok = await botController.collectNearestBlock(blockName);
        return { ok, blockName };
      });
    });

    socket.on('command:build', async (schemPath) => {
      await runCommand(socket, 'build', { schemPath }, async () => {
        const ok = await botController.buildSchem(schemPath);
        return { ok, schemPath };
      });
    });

    socket.on('command:build-with-refill', async ({ schemPath, requiredItems }) => {
      await runCommand(socket, 'build-with-refill', { schemPath, requiredItems }, async () => {
        return botController.autoBuildWithRefill(schemPath, requiredItems || []);
      });
    });

    socket.on('command:start-auto-collect', async ({ blockName, targetCount }) => {
      await runCommand(socket, 'start-auto-collect', { blockName, targetCount }, async () => {
        return botController.startAutoCollect(blockName, Number(targetCount || 64));
      });
    });

    socket.on('command:stop-auto-collect', async () => {
      await runCommand(socket, 'stop-auto-collect', {}, async () => {
        return botController.stopAutoCollect();
      });
    });

    socket.on('command:start-auto-mine', async () => {
      await runCommand(socket, 'start-auto-mine', {}, async () => {
        return botController.startAutoMine();
      });
    });

    socket.on('command:stop-auto-mine', async () => {
      await runCommand(socket, 'stop-auto-mine', {}, async () => {
        return botController.stopAutoMine();
      });
    });

    socket.on('command:fetch-item', async ({ itemName, amount }) => {
      await runCommand(socket, 'fetch-item', { itemName, amount }, async () => {
        const ok = await botController.fetchItemFromMemory(itemName, Number(amount || 1));
        return { ok, itemName, amount: Number(amount || 1) };
      });
    });

    socket.on('command:retreat-base', async () => {
      await runCommand(socket, 'retreat-base', {}, async () => {
        const ok = await botController.retreatNow();
        return { ok };
      });
    });

    socket.on('disconnect', () => {
      limiter.remove(socket.id);
      audit({ type: 'disconnect', socketId: socket.id });
    });
  });
}

function attachViewer(botController, port) {
  const bot = botController.bot;
  if (!bot) {
    return;
  }

  bot.once('spawn', () => {
    try {
      // テスト環境では canvas 依存が未導入の場合があるため遅延ロードする
      const viewer = require('prismarine-viewer');
      viewer.mineflayer(bot, {
        port,
        firstPerson: true,
        viewDistance: 6
      });
      logger.info(`3D viewer を起動しました: http://localhost:${port}`);
    } catch (error) {
      logger.warn('prismarine-viewer の起動に失敗しました。', error);
    }
  });
}

function startGuiServer(botController, memoryStore, config) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  const staticDir = path.resolve(process.cwd(), 'gui/public');
  app.use(express.static(staticDir));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, mode: config.edition, connected: botController.status().connected });
  });

  app.get('/api/state', (_req, res) => {
    res.json({
      ok: true,
      mode: config.edition,
      status: botController.status(),
      memory: memoryStore.snapshot(),
      security: buildSecurityPayload(config)
    });
  });

  registerSocketHandlers(io, botController, memoryStore, config);

  server.listen(config.gui.port, config.gui.host, () => {
    logger.info(`GUI を起動しました: http://${config.gui.host}:${config.gui.port}`);
  });

  attachViewer(botController, config.gui.port + 1);

  return { app, server, io };
}

module.exports = {
  startGuiServer
};
