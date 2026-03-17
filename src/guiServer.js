const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { logger } = require('./logger');
const { systemDoctor, detectJavaVersion, oneClickBootstrap } = require('./systemManager');

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

  function splitTargetPayload(payload, keyName = 'value') {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return {
        targetBotId: payload.targetBotId,
        value: payload[keyName]
      };
    }

    return {
      targetBotId: undefined,
      value: payload
    };
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
      const { targetBotId, value } = splitTargetPayload(name, 'name');
      await runCommand(socket, 'set-base', { name }, async () => {
        return botController.setBaseHere(value, targetBotId);
      });
    });

    socket.on('command:collect', async (blockName) => {
      const { targetBotId, value } = splitTargetPayload(blockName, 'blockName');
      await runCommand(socket, 'collect', { blockName }, async () => {
        const ok = await botController.collectNearestBlock(value, targetBotId);
        return { ok, blockName: value };
      });
    });

    socket.on('command:build', async (schemPath) => {
      const { targetBotId, value } = splitTargetPayload(schemPath, 'schemPath');
      await runCommand(socket, 'build', { schemPath }, async () => {
        const ok = await botController.buildSchem(value, targetBotId);
        return { ok, schemPath: value };
      });
    });

    socket.on('command:build-with-refill', async (payload) => {
      const targetBotId = payload?.targetBotId;
      const schemPath = payload?.schemPath;
      const requiredItems = payload?.requiredItems;
      await runCommand(socket, 'build-with-refill', { schemPath, requiredItems, targetBotId }, async () => {
        return botController.autoBuildWithRefill(schemPath, requiredItems || [], targetBotId);
      });
    });

    socket.on('command:start-auto-collect', async (payload) => {
      const targetBotId = payload?.targetBotId;
      const blockName = payload?.blockName;
      const targetCount = payload?.targetCount;
      await runCommand(socket, 'start-auto-collect', { blockName, targetCount, targetBotId }, async () => {
        return botController.startAutoCollect(blockName, Number(targetCount || 64), targetBotId);
      });
    });

    socket.on('command:stop-auto-collect', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'stop-auto-collect', {}, async () => {
        return botController.stopAutoCollect(targetBotId);
      });
    });

    socket.on('command:start-auto-mine', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'start-auto-mine', {}, async () => {
        return botController.startAutoMine(targetBotId);
      });
    });

    socket.on('command:stop-auto-mine', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'stop-auto-mine', {}, async () => {
        return botController.stopAutoMine(targetBotId);
      });
    });

    socket.on('command:store-inventory', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'store-inventory', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'storeInventoryToNearestChest');
      });
    });

    socket.on('command:start-auto-store', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'start-auto-store', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'startAutoStoreMode');
      });
    });

    socket.on('command:stop-auto-store', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'stop-auto-store', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'stopAutoStoreMode');
      });
    });

    socket.on('command:sort-chests-once', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'sort-chests-once', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'sortNearestChestsOnce', Number(payload?.maxMoves || 12));
      });
    });

    socket.on('command:start-auto-sort', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'start-auto-sort', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'startAutoSortMode');
      });
    });

    socket.on('command:stop-auto-sort', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'stop-auto-sort', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'stopAutoSortMode');
      });
    });

    socket.on('command:fetch-item', async (payload) => {
      const itemName = payload?.itemName;
      const amount = payload?.amount;
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'fetch-item', { itemName, amount, targetBotId }, async () => {
        const ok = await botController.fetchItemFromMemory(itemName, Number(amount || 1), targetBotId);
        return { ok, itemName, amount: Number(amount || 1) };
      });
    });

    socket.on('command:retreat-base', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'retreat-base', {}, async () => {
        const ok = await botController.retreatNow(targetBotId);
        return { ok };
      });
    });

    socket.on('command:fight-nearest-mob', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'fight-nearest-mob', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'fightNearestMob');
      });
    });

    socket.on('command:fight-player', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'fight-player', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'fightPlayer', payload?.playerName);
      });
    });

    socket.on('command:stop-fight', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'stop-fight', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'stopFight');
      });
    });

    socket.on('command:set-combat-profile', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'set-combat-profile', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'setCombatProfile', payload?.profile);
      });
    });

    socket.on('command:set-evasion', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'set-evasion', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'setEvasionEnabled', Boolean(payload?.enabled));
      });
    });

    socket.on('command:craft-item', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'craft-item', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'craftItem', payload?.itemName, Number(payload?.count || 1));
      });
    });

    socket.on('command:equip-best-armor', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'equip-best-armor', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'equipBestArmor');
      });
    });

    socket.on('command:start-city-mode', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'start-city-mode', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'startCityMode', payload?.modeName || 'village');
      });
    });

    socket.on('command:stop-city-mode', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'stop-city-mode', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'stopCityMode');
      });
    });

    socket.on('command:planner-calc-recipe', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'planner-calc-recipe', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'getRecipePlan', payload?.itemName, Number(payload?.count || 1));
      });
    });

    socket.on('command:planner-gather-for-craft', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'planner-gather-for-craft', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'gatherForCraft', payload?.itemName, Number(payload?.count || 1));
      });
    });

    socket.on('command:orchestrator-assign-task', async (payload) => {
      await runCommand(socket, 'orchestrator-assign-task', payload || {}, async () => {
        return botController.assignTask(payload || {});
      });
    });

    socket.on('command:fleet-add-bot', async (payload) => {
      await runCommand(socket, 'fleet-add-bot', payload || {}, async () => {
        return botController.addBot(payload || {});
      });
    });

    socket.on('command:fleet-remove-bot', async (payload) => {
      await runCommand(socket, 'fleet-remove-bot', payload || {}, async () => {
        return botController.removeBot(payload?.id);
      });
    });

    socket.on('command:fleet-update-role', async (payload) => {
      await runCommand(socket, 'fleet-update-role', payload || {}, async () => {
        return botController.updateRole(payload?.id, payload?.role);
      });
    });

    socket.on('command:system-doctor', async (payload) => {
      await runCommand(socket, 'system-doctor', payload || {}, async () => {
        return systemDoctor();
      });
    });

    socket.on('command:detect-java', async (payload) => {
      await runCommand(socket, 'detect-java', payload || {}, async () => {
        return detectJavaVersion();
      });
    });

    socket.on('command:oneclick-setup', async (payload) => {
      await runCommand(socket, 'oneclick-setup', payload || {}, async () => {
        return oneClickBootstrap({ syncBedrockSamples: Boolean(payload?.syncBedrockSamples ?? true) });
      });
    });

    socket.on('command:oneclick-setup-live', async (payload) => {
      await runCommand(socket, 'oneclick-setup-live', payload || {}, async () => {
        socket.emit('oneclick-progress', {
          stepIndex: 0,
          totalSteps: 1,
          label: '開始',
          percent: 3
        });

        return oneClickBootstrap({
          syncBedrockSamples: Boolean(payload?.syncBedrockSamples ?? true),
          onStep(step) {
            socket.emit('oneclick-progress', step);
          }
        });
      });
    });

    // ── 設定管理コマンド ──────────────────────────────────────────────
    socket.on('command:config-get', async () => {
      await runCommand(socket, 'config-get', {}, async () => {
        const configPath = path.resolve(process.cwd(), 'config.json');
        const configText = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(configText);
      });
    });

    socket.on('command:config-save', async (configData) => {
      await runCommand(socket, 'config-save', { keys: Object.keys(configData || {}) }, async () => {
        const configPath = path.resolve(process.cwd(), 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(configData || {}, null, 2), 'utf-8');
        return { ok: true, message: 'Config saved successfully' };
      });
    });

    // ── プロセス管理コマンド ──────────────────────────────────────────────
    socket.on('command:process-start', async (processName) => {
      await runCommand(socket, 'process-start', { processName }, async () => {
        const { spawnSync } = require('child_process');
        const result = spawnSync('pm2', ['start', processName || 'ecosystem.config.cjs'], {
          encoding: 'utf-8',
          stdio: 'pipe'
        });
        
        if (result.status === 0) {
          // PM2 起動成功後、状態を確認
          const statusResult = spawnSync('pm2', ['describe', processName || 'minecraft-auto-bedrock', '--json'], {
            encoding: 'utf-8',
            stdio: 'pipe'
          });
          
          try {
            const procInfo = JSON.parse(statusResult.stdout || '[]')[0];
            if (procInfo && procInfo.pm2_env && procInfo.pm2_env.status === 'online') {
              return { ok: true, message: `${processName} started successfully`, status: 'online' };
            } else if (procInfo && procInfo.pm2_env && procInfo.pm2_env.status === 'errored') {
              return { ok: false, message: 'Process started but errored immediately. Check logs:', logs: procInfo.pm2_env };
            }
          } catch {
            return { ok: true, message: result.stdout || 'Process started' };
          }
        }
        
        return { ok: false, message: result.stderr || 'Start failed' };
      });
    });

    socket.on('command:process-stop', async (processName) => {
      await runCommand(socket, 'process-stop', { processName }, async () => {
        const { spawnSync } = require('child_process');
        const result = spawnSync('pm2', ['stop', processName || 'minecraft-auto-bedrock'], {
          encoding: 'utf-8',
          stdio: 'pipe'
        });
        return { ok: result.status === 0, message: result.stdout || result.stderr };
      });
    });

    socket.on('command:process-restart', async (processName) => {
      await runCommand(socket, 'process-restart', { processName }, async () => {
        const { spawnSync } = require('child_process');
        const result = spawnSync('pm2', ['restart', processName || 'minecraft-auto-bedrock'], {
          encoding: 'utf-8',
          stdio: 'pipe'
        });
        
        if (result.status === 0) {
          // 再起動後、状態を確認
          const statusResult = spawnSync('pm2', ['describe', processName || 'minecraft-auto-bedrock', '--json'], {
            encoding: 'utf-8',
            stdio: 'pipe'
          });
          
          try {
            const procInfo = JSON.parse(statusResult.stdout || '[]')[0];
            if (procInfo && procInfo.pm2_env && procInfo.pm2_env.status === 'online') {
              return { ok: true, message: `${processName} restarted successfully`, status: 'online' };
            } else if (procInfo && procInfo.pm2_env && procInfo.pm2_env.status === 'errored') {
              return { ok: false, message: 'Process restarted but errored. Check logs:', restart_count: procInfo.pm2_env.restart_time };
            }
          } catch {
            return { ok: true, message: result.stdout || 'Process restarted' };
          }
        }
        
        return { ok: false, message: result.stderr || 'Restart failed' };
      });
    });

    socket.on('command:process-list', async () => {
      await runCommand(socket, 'process-list', {}, async () => {
        const { spawnSync } = require('child_process');
        const result = spawnSync('pm2', ['list', '--json'], {
          encoding: 'utf-8',
          stdio: 'pipe'
        });
        if (result.status === 0) {
          try {
            return JSON.parse(result.stdout || '[]');
          } catch {
            return [];
          }
        }
        return [];
      });
    });

    socket.on('command:process-logs', async (payload) => {
      const processName = payload?.processName || 'minecraft-auto-bedrock';
      const lines = payload?.lines || 50;
      await runCommand(socket, 'process-logs', { processName, lines }, async () => {
        const { spawnSync } = require('child_process');
        const result = spawnSync('pm2', ['logs', processName, '--lines', String(lines), '--nostream'], {
          encoding: 'utf-8',
          stdio: 'pipe',
          maxBuffer: 10 * 1024 * 1024
        });
        if (result.status === 0) {
          return { ok: true, logs: result.stdout || '' };
        }
        return { ok: false, logs: result.stderr || 'ログの取得に失敗しました' };
      });
    });

    // ── リアルタイムログストリーミング ──────────────────────────────
    socket.on('stream:logs-start', async (payload) => {
      const { spawn } = require('child_process');
      const processName = payload?.processName || 'minecraft-auto-bedrock';
      
      const pm2Proc = spawn('pm2', ['logs', processName, '--lines', '0'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const cleanupStream = () => {
        pm2Proc.kill();
      };

      pm2Proc.stdout.on('data', (chunk) => {
        socket.emit('log-line', { text: chunk.toString() });
      });

      pm2Proc.stderr.on('data', (chunk) => {
        socket.emit('log-line', { text: `[ERR] ${chunk.toString()}` });
      });

      pm2Proc.on('close', () => {
        socket.emit('log-stream-closed', { processName });
      });

      socket.on('disconnect', cleanupStream);
      socket.on('stream:logs-stop', cleanupStream);
    });

    // ── Fleet/Bot 一括管理 ──────────────────────────────────────────────
    socket.on('command:fleet-list-bots', async () => {
      try {
        const status = botController.status();
        const botList = (status?.fleet || []).map(bot => ({
          id: bot.id,
          username: bot.username,
          role: bot.role,
          status: bot.status || {},
          mode: bot.status?.mode || bot.behavior?.mode || 'unknown'
        }));
        socket.emit('fleet-bots-list', botList);
        audit({ type: 'fleet-list', count: botList.length, socketId: socket.id });
      } catch (error) {
        logger.error('Fleet list error:', error);
        socket.emit('fleet-bots-list', []);
      }
    });

    // ── 一括操作 ──────────────────────────────────────────────────────────
    socket.on('command:bulk-action', async (payload) => {
      await runCommand(socket, 'bulk-action', payload || {}, async () => {
        const { actionType, param } = payload || {};
        const status = botController.status();
        const botIds = (status?.fleet || []).map(b => b.id).filter(id => id);
        
        if (!botIds.length) {
          return { ok: false, message: '利用可能なBotがありません' };
        }

        const results = {};
        
        switch (actionType) {
          case 'set-role':
            // すべてのBotの役割を変更
            for (const botId of botIds) {
              try {
                await botController.updateRole(botId, param);
                results[botId] = { ok: true, message: `役割を「${param}」に変更しました` };
              } catch (e) {
                results[botId] = { ok: false, message: String(e) };
              }
            }
            break;

          case 'set-mode':
            // すべてのBotのモードを変更
            for (const botId of botIds) {
              try {
                await botController.runOnTarget(botId, 'setMode', param);
                results[botId] = { ok: true, message: `モードを「${param}」に変更しました` };
              } catch (e) {
                results[botId] = { ok: false, message: String(e) };
              }
            }
            break;

          case 'stop-all':
            // すべてのBotを停止
            for (const botId of botIds) {
              try {
                await botController.runOnTarget(botId, 'stop');
                results[botId] = { ok: true, message: '停止コマンド送信済み' };
              } catch (e) {
                results[botId] = { ok: false, message: String(e) };
              }
            }
            break;

          case 'gather-to-base':
            // すべてのBotを拠点に集合
            for (const botId of botIds) {
              try {
                await botController.retreatNow(botId);
                results[botId] = { ok: true, message: '帰還コマンド送信済み' };
              } catch (e) {
                results[botId] = { ok: false, message: String(e) };
              }
            }
            break;

          case 'start-task':
            // すべてのBotにタスク割当（パラメータで指定）
            for (const botId of botIds) {
              try {
                const taskType = param?.taskType || 'auto';
                await botController.assignTask({ botId, type: taskType });
                results[botId] = { ok: true, message: `タスク「${taskType}」を割当しました` };
              } catch (e) {
                results[botId] = { ok: false, message: String(e) };
              }
            }
            break;

          default:
            return { ok: false, message: `未知の一括操作: ${actionType}` };
        }

        const okCount = Object.values(results).filter(r => r.ok).length;
        return {
          ok: okCount > 0,
          message: `${okCount}/${botIds.length} のBotに対して操作を実行しました`,
          results
        };
      });
    });

    socket.on('stream:logs-stop', () => {
      // ストリーム停止はクライアント側で emit される
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

  // ポート衝突時の自動フォールバック
  const originalPort = config.gui.port;
  let listeningPort = originalPort;
  
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`ポート ${listeningPort} は既に使用されています。別のポートを試します...`);
      listeningPort += 1;
      if (listeningPort - originalPort < 20) {
        // 20ポート前後の範囲で試す
        server.listen(listeningPort, config.gui.host);
      } else {
        logger.error(`利用可能なポートが見つかりません (${originalPort}～${listeningPort})`);
      }
    } else {
      logger.error('GUI サーバーのエラー:', err);
    }
  });

  server.listen(originalPort, config.gui.host, () => {
    if (listeningPort !== originalPort) {
      logger.info(`GUI を起動しました: http://${config.gui.host}:${listeningPort} (ポート ${originalPort} は使用中)`);
    } else {
      logger.info(`GUI を起動しました: http://${config.gui.host}:${listeningPort}`);
    }
  });

  attachViewer(botController, listeningPort + 1);

  return { app, server, io };
}

module.exports = {
  startGuiServer
};
