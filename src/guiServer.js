const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { spawn, spawnSync } = require('child_process');
const { logger } = require('./logger');
const { systemDoctor, detectJavaVersion, oneClickBootstrap } = require('./systemManager');
const { validateConfig } = require('./config');
const { runConnectionDiagnostics } = require('./connectionDiagnostics');

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
  const logStreams = new Map();

  function normalizeError(error) {
    const message = error?.message || String(error || 'unknown-error');
    return {
      message,
      detail: error?.stack || String(error || '')
    };
  }

  function targetController(targetBotId) {
    if (typeof botController.targetController === 'function') {
      return botController.targetController(targetBotId);
    }

    if (!targetBotId) {
      return botController.primaryEntry?.controller || botController;
    }

    return null;
  }

  function stopLogStream(socketId) {
    const proc = logStreams.get(socketId);
    if (!proc) {
      return;
    }

    try {
      proc.kill('SIGTERM');
    } catch {
      // noop
    }
    logStreams.delete(socketId);
  }

  function runPm2(args = []) {
    const result = spawnSync('pm2', args, {
      encoding: 'utf-8',
      stdio: 'pipe',
      maxBuffer: 10 * 1024 * 1024
    });

    if (result.error) {
      throw result.error;
    }

    return result;
  }

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
      const err = normalizeError(error);
      socket.emit('command-result', {
        action,
        ok: false,
        reason: err.message,
        result: { message: err.message }
      });
      audit({ type: 'command-error', action, payload, socketId: socket.id, error: err.message });
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

    socket.on('command:mining-branch', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'mining-branch', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'startBranchMining', payload?.options || {});
      });
    });

    socket.on('command:mining-strip', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'mining-strip', payload || {}, async () => {
        const ctrl = targetController(targetBotId);
        if (!ctrl?.branchMiningModule?.startStripMining) {
          throw new Error('strip-mining-not-available');
        }
        return ctrl.branchMiningModule.startStripMining(payload?.options || {});
      });
    });

    socket.on('command:mining-vein', async (payload) => {
      const targetBotId = payload?.targetBotId;
      const oreName = payload?.oreName || 'diamond_ore';
      await runCommand(socket, 'mining-vein', payload || {}, async () => {
        return botController.startAutoCollect(oreName, Number(payload?.targetCount || 32), targetBotId);
      });
    });

    socket.on('command:mining-stop', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'mining-stop', payload || {}, async () => {
        const ctrl = targetController(targetBotId);
        const stopped = [];
        if (ctrl?.branchMiningModule?.stop) {
          // eslint-disable-next-line no-await-in-loop
          await ctrl.branchMiningModule.stop();
          stopped.push('branch');
        }
        if (ctrl?.stopAutoMine) {
          // eslint-disable-next-line no-await-in-loop
          await ctrl.stopAutoMine();
          stopped.push('auto-mine');
        }
        return { ok: true, stopped };
      });
    });

    socket.on('command:farming-start', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'farming-start', payload || {}, async () => {
        const ctrl = targetController(targetBotId);
        if (!ctrl?.farmingModule?.startCycle) {
          throw new Error('farming-module-not-available');
        }
        return ctrl.farmingModule.startCycle();
      });
    });

    socket.on('command:farming-harvest', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'farming-harvest', payload || {}, async () => {
        const ctrl = targetController(targetBotId);
        if (!ctrl?.farmingModule?.harvestAll) {
          throw new Error('farming-module-not-available');
        }
        const count = await ctrl.farmingModule.harvestAll();
        return { ok: true, harvested: count };
      });
    });

    socket.on('command:farming-expand', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'farming-expand', payload || {}, async () => {
        const ctrl = targetController(targetBotId);
        if (!ctrl?.farmingModule?.expandFarmland) {
          throw new Error('farming-module-not-available');
        }
        const count = await ctrl.farmingModule.expandFarmland();
        return { ok: true, expanded: count };
      });
    });

    socket.on('command:farming-water', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'farming-water', payload || {}, async () => {
        const ctrl = targetController(targetBotId);
        if (!ctrl?.farmingModule) {
          throw new Error('farming-module-not-available');
        }
        ctrl.farmingModule.autoWater = true;
        const count = await ctrl.farmingModule.expandFarmland();
        return { ok: true, watered: count };
      });
    });

    socket.on('command:farming-breed', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'farming-breed', payload || {}, async () => {
        const ctrl = targetController(targetBotId);
        if (!ctrl?.farmingModule?.breedAnimals) {
          throw new Error('farming-module-not-available');
        }
        const count = await ctrl.farmingModule.breedAnimals();
        return { ok: true, actions: count, mob: payload?.mob || 'all' };
      });
    });

    socket.on('command:farming-stop', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'farming-stop', payload || {}, async () => {
        const ctrl = targetController(targetBotId);
        if (!ctrl?.farmingModule) {
          throw new Error('farming-module-not-available');
        }
        ctrl.farmingModule._running = false;
        return { ok: true };
      });
    });

    socket.on('command:explore-start', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'explore-start', payload || {}, async () => {
        const ctrl = targetController(targetBotId);
        if (!ctrl?.explorerModule?.explore) {
          throw new Error('explorer-module-not-available');
        }
        const steps = Number(payload?.steps || ctrl.explorerModule.maxSteps || 20);
        ctrl.explorerModule.explore(steps);
        return { ok: true, steps };
      });
    });

    socket.on('command:explore-stop', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'explore-stop', payload || {}, async () => {
        const ctrl = targetController(targetBotId);
        if (!ctrl?.explorerModule?.stop) {
          throw new Error('explorer-module-not-available');
        }
        ctrl.explorerModule.stop();
        return { ok: true };
      });
    });

    socket.on('command:explore-poi', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'explore-poi', payload || {}, async () => {
        const ctrl = targetController(targetBotId);
        if (!ctrl?.explorerModule?.getPOIList) {
          throw new Error('explorer-module-not-available');
        }
        return { ok: true, pois: ctrl.explorerModule.getPOIList() };
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

    socket.on('command:planner-analyze-blueprint', async (payload) => {
      const targetBotId = payload?.targetBotId;
      await runCommand(socket, 'planner-analyze-blueprint', payload || {}, async () => {
        return botController.runOnTarget(targetBotId, 'analyzeBlueprint', payload?.schemPath);
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

    socket.on('command:external-add-bot', async (payload) => {
      await runCommand(socket, 'external-add-bot', payload || {}, async () => {
        const host = String(payload?.host || '').trim();
        const username = String(payload?.username || '').trim();
        const edition = payload?.edition === 'bedrock' ? 'bedrock' : 'java';

        if (!host || !username) {
          throw new Error('host-and-username-required');
        }

        const port = Number(payload?.port || (edition === 'bedrock' ? 19132 : 25565));
        const role = payload?.role || 'worker';
        const id = payload?.id || `${username}-${Date.now()}`;
        const auth = payload?.authType || 'offline';

        const spec = {
          id,
          username,
          role,
          auth,
          behavior: {
            mode: payload?.mode || 'hybrid'
          },
          memoryFile: `memory-${id}.json`
        };

        if (edition === 'bedrock') {
          spec.bedrock = {
            proxy: {
              listenHost: host,
              listenPort: port,
              enabled: true,
              enableAutoStart: false,
              enableAutoDownload: true
            }
          };
        } else {
          spec.java = {
            host,
            port,
            version: false
          };
        }

        return botController.addBot(spec);
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

    socket.on('command:connection-diagnose', async (payload) => {
      await runCommand(socket, 'connection-diagnose', payload || {}, async () => {
        return runConnectionDiagnostics(config, payload || {});
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
        validateConfig(configData || {});
        const configPath = path.resolve(process.cwd(), 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(configData || {}, null, 2), 'utf-8');
        return { ok: true, message: 'Config saved successfully' };
      });
    });

    // ── プロセス管理コマンド ──────────────────────────────────────────────
    socket.on('command:process-start', async (processName) => {
      await runCommand(socket, 'process-start', { processName }, async () => {
        const result = runPm2(['start', processName || 'ecosystem.config.cjs']);
        
        if (result.status === 0) {
          // PM2 起動成功後、状態を確認
          const statusResult = runPm2(['describe', processName || 'minecraft-auto-bedrock', '--json']);
          
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
        const result = runPm2(['stop', processName || 'minecraft-auto-bedrock']);
        return { ok: result.status === 0, message: result.stdout || result.stderr };
      });
    });

    socket.on('command:process-restart', async (processName) => {
      await runCommand(socket, 'process-restart', { processName }, async () => {
        const result = runPm2(['restart', processName || 'minecraft-auto-bedrock']);
        
        if (result.status === 0) {
          // 再起動後、状態を確認
          const statusResult = runPm2(['describe', processName || 'minecraft-auto-bedrock', '--json']);
          
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
        const result = runPm2(['list', '--json']);
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
        const result = runPm2(['logs', processName, '--lines', String(lines), '--nostream']);
        if (result.status === 0) {
          return { ok: true, logs: result.stdout || '' };
        }
        return { ok: false, logs: result.stderr || 'ログの取得に失敗しました' };
      });
    });

    socket.on('command:process-delete', async (processName) => {
      await runCommand(socket, 'process-delete', { processName }, async () => {
        const target = processName || 'minecraft-auto-bedrock';
        const result = runPm2(['delete', target]);
        try {
          runPm2(['flush', target]);
        } catch {
          // flush 失敗は許容
        }
        return { ok: result.status === 0, message: result.stdout || result.stderr };
      });
    });

    // ── リアルタイムログストリーミング ──────────────────────────────
    socket.on('stream:logs-start', async (payload) => {
      const processName = payload?.processName || 'minecraft-auto-bedrock';
      stopLogStream(socket.id);

      const pm2Proc = spawn('pm2', ['logs', processName, '--lines', '0'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      logStreams.set(socket.id, pm2Proc);

      pm2Proc.stdout.on('data', (chunk) => {
        socket.emit('log-line', { text: chunk.toString() });
      });

      pm2Proc.stderr.on('data', (chunk) => {
        socket.emit('log-line', { text: `[ERR] ${chunk.toString()}` });
      });

      pm2Proc.on('close', () => {
        logStreams.delete(socket.id);
        socket.emit('log-stream-closed', { processName });
      });
    });

    socket.on('stream:logs-stop', () => {
      stopLogStream(socket.id);
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
        const explicitTargetBotIds = Array.isArray(payload?.targetBotIds)
          ? payload.targetBotIds.map((id) => String(id)).filter(Boolean)
          : [];
        const botIds = explicitTargetBotIds.length > 0
          ? explicitTargetBotIds
          : (status?.fleet || []).map(b => b.id).filter(id => id);
        
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
                await botController.assignTask({
                  targetBotId: botId,
                  type: taskType,
                  blockName: param?.blockName,
                  itemName: param?.itemName,
                  playerName: param?.playerName,
                  count: Number(param?.count || 1)
                });
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

    socket.on('disconnect', () => {
      stopLogStream(socket.id);
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

  // staticDirが存在しない場合に警告
  if (!fs.existsSync(staticDir)) {
    logger.warn(`GUI 静的ファイルディレクトリが見つかりません: ${staticDir}`);
  }

  app.use(express.static(staticDir));

  // ルートルートのフォールバック（static が見つからない場合でも index.html を返す）
  app.get('/', (_req, res) => {
    const indexFile = path.join(staticDir, 'index.html');
    if (fs.existsSync(indexFile)) {
      res.sendFile(indexFile);
    } else {
      res.status(503).send('<h1>GUI ファイルが見つかりません</h1><p>gui/public/index.html が存在することを確認してください。</p>');
    }
  });

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
