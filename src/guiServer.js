const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const viewer = require('prismarine-viewer');
const { logger } = require('./logger');

function registerSocketHandlers(io, botController, memoryStore, config) {
  io.on('connection', (socket) => {
    socket.emit('bootstrap', {
      mode: config.edition,
      status: botController.status(),
      memory: memoryStore.snapshot()
    });

    socket.on('refresh', () => {
      socket.emit('status', {
        mode: config.edition,
        status: botController.status(),
        memory: memoryStore.snapshot()
      });
    });

    socket.on('search-item', (query) => {
      const result = memoryStore.searchItems(String(query || '').trim());
      socket.emit('search-result', result);
    });

    socket.on('command:set-base', async (name) => {
      const point = await botController.setBaseHere(name);
      socket.emit('command-result', {
        action: 'set-base',
        ok: Boolean(point),
        point
      });
    });

    socket.on('command:collect', async (blockName) => {
      const ok = await botController.collectNearestBlock(blockName);
      socket.emit('command-result', {
        action: 'collect',
        ok,
        blockName
      });
    });

    socket.on('command:build', async (schemPath) => {
      const ok = await botController.buildSchem(schemPath);
      socket.emit('command-result', {
        action: 'build',
        ok,
        schemPath
      });
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
