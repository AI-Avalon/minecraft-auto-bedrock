let socket;
let refreshTimer = null;
let autoRefresh = true;
let refreshInFlight = false;
let reconnectAttempts = 0;

const modeBadge = document.getElementById('modeBadge');
const socketState = document.getElementById('socketState');
const statusView = document.getElementById('statusView');
const inventoryList = document.getElementById('inventoryList');
const memoryView = document.getElementById('memoryView');
const searchText = document.getElementById('searchText');
const searchButton = document.getElementById('searchButton');
const searchResult = document.getElementById('searchResult');
const commandResult = document.getElementById('commandResult');
const guiToken = document.getElementById('guiToken');
const reconnectButton = document.getElementById('reconnectButton');
const toggleRefreshButton = document.getElementById('toggleRefreshButton');
const quickDiamondButton = document.getElementById('quickDiamondButton');
const collectWoodButton = document.getElementById('collectWoodButton');
const collectTargetCount = document.getElementById('collectTargetCount');
const startAutoCollectButton = document.getElementById('startAutoCollectButton');
const stopAutoCollectButton = document.getElementById('stopAutoCollectButton');
const startAutoMineButton = document.getElementById('startAutoMineButton');
const stopAutoMineButton = document.getElementById('stopAutoMineButton');
const storeInventoryButton = document.getElementById('storeInventoryButton');
const startAutoStoreButton = document.getElementById('startAutoStoreButton');
const stopAutoStoreButton = document.getElementById('stopAutoStoreButton');
const sortChestsButton = document.getElementById('sortChestsButton');
const startAutoSortButton = document.getElementById('startAutoSortButton');
const stopAutoSortButton = document.getElementById('stopAutoSortButton');
const buildWithRefillButton = document.getElementById('buildWithRefillButton');
const fetchItemName = document.getElementById('fetchItemName');
const fetchAmount = document.getElementById('fetchAmount');
const fetchItemButton = document.getElementById('fetchItemButton');
const retreatButton = document.getElementById('retreatButton');
const setBaseQuickButton = document.getElementById('setBaseQuickButton');
const securityHint = document.getElementById('securityHint');

const baseName = document.getElementById('baseName');
const targetBotSelect = document.getElementById('targetBotSelect');
const setBaseButton = document.getElementById('setBaseButton');
const collectBlock = document.getElementById('collectBlock');
const collectButton = document.getElementById('collectButton');
const schemPath = document.getElementById('schemPath');
const buildButton = document.getElementById('buildButton');
const fleetBotId = document.getElementById('fleetBotId');
const fleetBotUsername = document.getElementById('fleetBotUsername');
const fleetBotRole = document.getElementById('fleetBotRole');
const fleetBotMode = document.getElementById('fleetBotMode');
const fleetAddButton = document.getElementById('fleetAddButton');
const fleetRemoveButton = document.getElementById('fleetRemoveButton');
const fleetRoleUpdateButton = document.getElementById('fleetRoleUpdateButton');
const fightNearestMobButton = document.getElementById('fightNearestMobButton');
const fightPlayerName = document.getElementById('fightPlayerName');
const fightPlayerButton = document.getElementById('fightPlayerButton');
const stopFightButton = document.getElementById('stopFightButton');
const combatProfile = document.getElementById('combatProfile');
const combatProfileButton = document.getElementById('combatProfileButton');
const evasionEnabled = document.getElementById('evasionEnabled');
const evasionToggleButton = document.getElementById('evasionToggleButton');
const plannerItemName = document.getElementById('plannerItemName');
const plannerItemCount = document.getElementById('plannerItemCount');
const plannerCalcRecipeButton = document.getElementById('plannerCalcRecipeButton');
const plannerGatherForCraftButton = document.getElementById('plannerGatherForCraftButton');
const craftItemButton = document.getElementById('craftItemButton');
const equipBestArmorButton = document.getElementById('equipBestArmorButton');
const cityModeName = document.getElementById('cityModeName');
const startCityModeButton = document.getElementById('startCityModeButton');
const stopCityModeButton = document.getElementById('stopCityModeButton');
const orchestratorTaskType = document.getElementById('orchestratorTaskType');
const orchestratorRole = document.getElementById('orchestratorRole');
const orchestratorBlockName = document.getElementById('orchestratorBlockName');
const orchestratorItemName = document.getElementById('orchestratorItemName');
const orchestratorCount = document.getElementById('orchestratorCount');
const orchestratorPlayerName = document.getElementById('orchestratorPlayerName');
const orchestratorAssignButton = document.getElementById('orchestratorAssignButton');
const systemDoctorButton = document.getElementById('systemDoctorButton');
const oneclickSetupButton = document.getElementById('oneclickSetupButton');
const oneclickSyncBedrock = document.getElementById('oneclickSyncBedrock');
const oneclickProgress = document.getElementById('oneclickProgress');
const oneclickProgressText = document.getElementById('oneclickProgressText');
const fleetStatusList = document.getElementById('fleetStatusList');

function selectedTargetBotId() {
  return targetBotSelect?.value || undefined;
}

function setSocketState(status, detail = '') {
  socketState.classList.remove('connected', 'connecting', 'disconnected');
  socketState.classList.add(status);
  socketState.textContent = `接続状態: ${status}${detail ? ` (${detail})` : ''}`;
}

function setAutoRefresh(enabled) {
  autoRefresh = enabled;
  toggleRefreshButton.textContent = `自動更新: ${enabled ? 'ON' : 'OFF'}`;

  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (enabled) {
    refreshTimer = setInterval(() => {
      if (!socket || !socket.connected || refreshInFlight) {
        return;
      }
      refreshInFlight = true;
      socket.emit('refresh');
    }, 2500);
  }
}

function bindEnter(input, action) {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      action();
    }
  });
}

function showResult(result) {
  commandResult.textContent = JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2);
}

function renderStatus(payload) {
  refreshInFlight = false;
  modeBadge.textContent = `MODE: ${payload.mode.toUpperCase()}`;
  statusView.textContent = JSON.stringify(payload.status, null, 2);
  memoryView.textContent = JSON.stringify(payload.memory, null, 2);
  securityHint.textContent = `権限制御: readOnly=${payload.security?.readOnly || false}, allowed=${(payload.security?.allowedCommands || []).join(', ')}`;

  inventoryList.innerHTML = '';
  for (const item of payload.status.inventory || []) {
    const li = document.createElement('li');
    li.textContent = `${item.displayName} x${item.count}`;
    inventoryList.appendChild(li);
  }

  if (targetBotSelect && payload.status?.fleet) {
    const current = targetBotSelect.value;
    targetBotSelect.innerHTML = '';

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'primary';
    targetBotSelect.appendChild(defaultOption);

    for (const row of payload.status.fleet) {
      const option = document.createElement('option');
      option.value = row.id;
      option.textContent = `${row.id} (${row.role})`;
      targetBotSelect.appendChild(option);
    }

    if ([...targetBotSelect.options].some((x) => x.value === current)) {
      targetBotSelect.value = current;
    }
  }

  if (fleetStatusList) {
    fleetStatusList.innerHTML = '';
    const rows = payload.status?.fleet || [];
    for (const row of rows) {
      const li = document.createElement('li');
      const hp = row.status?.health ?? '-';
      const food = row.status?.food ?? '-';
      const pos = row.status?.position ? `${row.status.position.x},${row.status.position.y},${row.status.position.z}` : 'n/a';
      const mode = row.status?.mode || row.status?.automation?.mode || 'unknown';
      li.textContent = `${row.id} role=${row.role} mode=${mode} hp=${hp} food=${food} pos=${pos}`;
      fleetStatusList.appendChild(li);
    }
  }
}

function getBuildWithRefillPayload() {
  const requiredItems = [];
  if (fetchItemName.value.trim()) {
    requiredItems.push({
      itemName: fetchItemName.value.trim(),
      amount: Number(fetchAmount.value || 64)
    });
  }

  return {
    schemPath: schemPath.value,
    requiredItems
  };
}

function send(eventName, payload) {
  if (!socket || !socket.connected) {
    showResult({ ok: false, reason: 'socket-disconnected', action: eventName });
    return;
  }
  socket.emit(eventName, payload);
}

function connectSocket() {
  if (socket) {
    socket.disconnect();
  }

  setSocketState('connecting');

  socket = io({
    auth: {
      token: guiToken.value.trim()
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 5000
  });

  socket.on('connect', () => {
    reconnectAttempts = 0;
    setSocketState('connected', socket.id);
    if (autoRefresh) {
      send('refresh');
    }
  });

  socket.on('disconnect', (reason) => {
    setSocketState('disconnected', reason);
  });

  socket.io.on('reconnect_attempt', (attempt) => {
    reconnectAttempts = attempt;
    setSocketState('connecting', `retry ${attempt}`);
  });

  socket.on('bootstrap', renderStatus);
  socket.on('status', renderStatus);

  socket.on('search-result', (rows) => {
    searchResult.innerHTML = '';
    for (const row of rows) {
      const li = document.createElement('li');
      li.textContent = `${row.item.displayName} x${row.item.count} @ ${row.chestKey}`;
      searchResult.appendChild(li);
    }
  });

  socket.on('command-result', (result) => {
    const { action, ok, result: resultData } = result;
    
    // ── 新しいコマンド結果の処理 ──────────────────────────────────────
    if (action === 'config-get' && ok && resultData) {
      const configEditor = document.getElementById('configEditor');
      if (configEditor) {
        configEditor.value = JSON.stringify(resultData, null, 2);
      }
    }
    
    if (action === 'config-save' && ok) {
      alert('設定を保存しました');
    }
    
    if (action === 'process-list' && ok && resultData) {
      const processListView = document.getElementById('processListView');
      if (processListView) {
        processListView.textContent = JSON.stringify(resultData, null, 2);
        // プロセス選択ボックスも更新
        const processSelect = document.getElementById('processSelect');
        if (processSelect && Array.isArray(resultData)) {
          resultData.forEach(proc => {
            if (!Array.from(processSelect.options).some(opt => opt.value === proc.name)) {
              const option = document.createElement('option');
              option.value = proc.name;
              option.textContent = proc.name;
              processSelect.appendChild(option);
            }
          });
        }
      }
    }
    
    if (action === 'process-logs' && resultData) {
      const logView = document.getElementById('logView');
      if (logView) {
        if (resultData.ok) {
          logView.textContent = resultData.logs || 'ログが見つかりません';
        } else {
          logView.textContent = resultData.logs || 'エラー: ログの取得に失敗しました';
        }
      }
    }
    
    if (action === 'system-doctor' && ok && resultData) {
      const doctorView = document.getElementById('doctorView');
      if (doctorView) {
        doctorView.textContent = JSON.stringify(resultData, null, 2);
      }
    }
    
    // ── 既存のコマンド結果処理 ──────────────────────────────────────
    showResult(result);
    send('refresh');
  });

  socket.on('oneclick-progress', (progress) => {
    if (oneclickProgress) {
      oneclickProgress.value = Number(progress?.percent || 0);
    }
    if (oneclickProgressText) {
      const current = Number(progress?.stepIndex || 0);
      const total = Number(progress?.totalSteps || 0);
      oneclickProgressText.textContent = `${progress?.label || '処理中'} (${current}/${total}) ${progress?.percent || 0}%`;
    }
  });

  socket.on('unauthorized', (result) => {
    showResult(result);
    setSocketState('disconnected', 'unauthorized');
  });
}

searchButton.addEventListener('click', () => send('search-item', searchText.value));

quickDiamondButton.addEventListener('click', () => {
  searchText.value = 'diamond';
  send('search-item', 'diamond');
});

setBaseButton.addEventListener('click', () => send('command:set-base', { name: baseName.value, targetBotId: selectedTargetBotId() }));
collectButton.addEventListener('click', () => send('command:collect', { blockName: collectBlock.value, targetBotId: selectedTargetBotId() }));
buildButton.addEventListener('click', () => send('command:build', { schemPath: schemPath.value, targetBotId: selectedTargetBotId() }));
buildWithRefillButton.addEventListener('click', () => send('command:build-with-refill', { ...getBuildWithRefillPayload(), targetBotId: selectedTargetBotId() }));

collectWoodButton.addEventListener('click', () => {
  collectBlock.value = 'oak_log';
  send('command:collect', { blockName: 'oak_log', targetBotId: selectedTargetBotId() });
});

startAutoCollectButton.addEventListener('click', () => {
  send('command:start-auto-collect', {
    blockName: collectBlock.value,
    targetCount: Number(collectTargetCount.value || 64),
    targetBotId: selectedTargetBotId()
  });
});

stopAutoCollectButton.addEventListener('click', () => send('command:stop-auto-collect', { targetBotId: selectedTargetBotId() }));
startAutoMineButton.addEventListener('click', () => send('command:start-auto-mine', { targetBotId: selectedTargetBotId() }));
stopAutoMineButton.addEventListener('click', () => send('command:stop-auto-mine', { targetBotId: selectedTargetBotId() }));
storeInventoryButton?.addEventListener('click', () => send('command:store-inventory', { targetBotId: selectedTargetBotId() }));
startAutoStoreButton?.addEventListener('click', () => send('command:start-auto-store', { targetBotId: selectedTargetBotId() }));
stopAutoStoreButton?.addEventListener('click', () => send('command:stop-auto-store', { targetBotId: selectedTargetBotId() }));
sortChestsButton?.addEventListener('click', () => send('command:sort-chests-once', { targetBotId: selectedTargetBotId() }));
startAutoSortButton?.addEventListener('click', () => send('command:start-auto-sort', { targetBotId: selectedTargetBotId() }));
stopAutoSortButton?.addEventListener('click', () => send('command:stop-auto-sort', { targetBotId: selectedTargetBotId() }));

fetchItemButton.addEventListener('click', () => {
  send('command:fetch-item', {
    itemName: fetchItemName.value,
    amount: Number(fetchAmount.value || 1),
    targetBotId: selectedTargetBotId()
  });
});

retreatButton.addEventListener('click', () => send('command:retreat-base', { targetBotId: selectedTargetBotId() }));
setBaseQuickButton.addEventListener('click', () => send('command:set-base', { name: baseName.value || 'quick-base', targetBotId: selectedTargetBotId() }));

fleetAddButton?.addEventListener('click', () => {
  const id = fleetBotId?.value?.trim();
  const username = fleetBotUsername?.value?.trim();
  if (!id || !username) {
    showResult({ ok: false, reason: 'id-and-username-required' });
    return;
  }
  send('command:fleet-add-bot', {
    id,
    username,
    role: fleetBotRole?.value || 'worker',
    behavior: { mode: fleetBotMode?.value || 'hybrid' },
    memoryFile: `memory-${id}.json`
  });
});

fleetRemoveButton?.addEventListener('click', () => {
  const id = fleetBotId?.value?.trim() || selectedTargetBotId();
  if (!id) {
    showResult({ ok: false, reason: 'id-required' });
    return;
  }
  send('command:fleet-remove-bot', { id });
});

fleetRoleUpdateButton?.addEventListener('click', () => {
  const id = fleetBotId?.value?.trim() || selectedTargetBotId();
  if (!id) {
    showResult({ ok: false, reason: 'id-required' });
    return;
  }
  send('command:fleet-update-role', {
    id,
    role: fleetBotRole?.value || 'worker'
  });
});

fightNearestMobButton?.addEventListener('click', () => {
  send('command:fight-nearest-mob', { targetBotId: selectedTargetBotId() });
});

fightPlayerButton?.addEventListener('click', () => {
  send('command:fight-player', {
    targetBotId: selectedTargetBotId(),
    playerName: fightPlayerName?.value?.trim()
  });
});

stopFightButton?.addEventListener('click', () => {
  send('command:stop-fight', { targetBotId: selectedTargetBotId() });
});

combatProfileButton?.addEventListener('click', () => {
  send('command:set-combat-profile', {
    targetBotId: selectedTargetBotId(),
    profile: combatProfile?.value || 'balanced'
  });
});

evasionToggleButton?.addEventListener('click', () => {
  send('command:set-evasion', {
    targetBotId: selectedTargetBotId(),
    enabled: Boolean(evasionEnabled?.checked)
  });
});

plannerCalcRecipeButton?.addEventListener('click', () => {
  send('command:planner-calc-recipe', {
    targetBotId: selectedTargetBotId(),
    itemName: plannerItemName?.value?.trim(),
    count: Number(plannerItemCount?.value || 1)
  });
});

plannerGatherForCraftButton?.addEventListener('click', () => {
  send('command:planner-gather-for-craft', {
    targetBotId: selectedTargetBotId(),
    itemName: plannerItemName?.value?.trim(),
    count: Number(plannerItemCount?.value || 1)
  });
});

craftItemButton?.addEventListener('click', () => {
  send('command:craft-item', {
    targetBotId: selectedTargetBotId(),
    itemName: plannerItemName?.value?.trim(),
    count: Number(plannerItemCount?.value || 1)
  });
});

equipBestArmorButton?.addEventListener('click', () => {
  send('command:equip-best-armor', {
    targetBotId: selectedTargetBotId()
  });
});

startCityModeButton?.addEventListener('click', () => {
  send('command:start-city-mode', {
    targetBotId: selectedTargetBotId(),
    modeName: cityModeName?.value?.trim() || 'village'
  });
});

stopCityModeButton?.addEventListener('click', () => {
  send('command:stop-city-mode', {
    targetBotId: selectedTargetBotId()
  });
});

orchestratorAssignButton?.addEventListener('click', () => {
  send('command:orchestrator-assign-task', {
    type: orchestratorTaskType?.value,
    role: orchestratorRole?.value || 'worker',
    blockName: orchestratorBlockName?.value?.trim(),
    itemName: orchestratorItemName?.value?.trim(),
    playerName: orchestratorPlayerName?.value?.trim(),
    count: Number(orchestratorCount?.value || 1)
  });
});

systemDoctorButton?.addEventListener('click', () => {
  send('command:system-doctor', {});
});

oneclickSetupButton?.addEventListener('click', () => {
  if (oneclickProgress) {
    oneclickProgress.value = 0;
  }
  if (oneclickProgressText) {
    oneclickProgressText.textContent = '準備中...';
  }

  send('command:oneclick-setup-live', {
    syncBedrockSamples: Boolean(oneclickSyncBedrock?.checked)
  });
});

toggleRefreshButton.addEventListener('click', () => {
  setAutoRefresh(!autoRefresh);
  send('refresh');
});

reconnectButton.addEventListener('click', () => {
  connectSocket();
  setAutoRefresh(autoRefresh);
});

bindEnter(searchText, () => send('search-item', searchText.value));
bindEnter(collectBlock, () => send('command:collect', { blockName: collectBlock.value, targetBotId: selectedTargetBotId() }));
bindEnter(fetchItemName, () => {
  send('command:fetch-item', {
    itemName: fetchItemName.value,
    amount: Number(fetchAmount.value || 1),
    targetBotId: selectedTargetBotId()
  });
});

// ── プロセス管理 ────────────────────────────────────────────────────
const processSelect = document.getElementById('processSelect');
const logProcessSelect = document.getElementById('logProcessSelect');
const configEditor = document.getElementById('configEditor');

if (document.getElementById('processRefreshButton')) {
  document.getElementById('processRefreshButton').addEventListener('click', () => {
    send('command:process-list', null);
  });
}
if (document.getElementById('processStartButton')) {
  document.getElementById('processStartButton').addEventListener('click', () => {
    send('command:process-start', processSelect.value);
  });
}
if (document.getElementById('processStopButton')) {
  document.getElementById('processStopButton').addEventListener('click', () => {
    send('command:process-stop', processSelect.value);
  });
}
if (document.getElementById('processRestartButton')) {
  document.getElementById('processRestartButton').addEventListener('click', () => {
    send('command:process-restart', processSelect.value);
  });
}

// ── ログ表示 ────────────────────────────────────────────────────────
let logStreamActive = false;

if (document.getElementById('logLoadButton')) {
  document.getElementById('logLoadButton').addEventListener('click', () => {
    const logView = document.getElementById('logView');
    logView.textContent = 'ログ読み込み中...';
    send('command:process-logs', {
      processName: logProcessSelect.value,
      lines: Number(document.getElementById('logLinesInput').value || 50)
    });
  });
}

if (document.getElementById('logStreamToggleButton')) {
  document.getElementById('logStreamToggleButton').addEventListener('click', () => {
    const btn = document.getElementById('logStreamToggleButton');
    if (!logStreamActive) {
      logStreamActive = true;
      btn.textContent = 'ストリーミング: ON';
      btn.style.backgroundColor = '#4CAF50';
      const logView = document.getElementById('logView');
      logView.textContent = 'ストリーミング開始...\n';
      socket.emit('stream:logs-start', { processName: logProcessSelect.value });
    } else {
      logStreamActive = false;
      btn.textContent = 'ストリーミング: OFF';
      btn.style.backgroundColor = '';
      socket.emit('stream:logs-stop');
    }
  });
}

socket.on('log-line', (payload) => {
  const logView = document.getElementById('logView');
  logView.textContent += payload.text;
  logView.scrollTop = logView.scrollHeight;
});

socket.on('log-stream-closed', (payload) => {
  logStreamActive = false;
  const btn = document.getElementById('logStreamToggleButton');
  if (btn) {
    btn.textContent = 'ストリーミング: OFF';
    btn.style.backgroundColor = '';
  }
  const logView = document.getElementById('logView');
  logView.textContent += '\n[ストリーム終了]\n';
});

// ── 設定管理 ────────────────────────────────────────────────────────
if (document.getElementById('configLoadButton')) {
  document.getElementById('configLoadButton').addEventListener('click', () => {
    send('command:config-get', null);
  });
}
if (document.getElementById('configSaveButton')) {
  document.getElementById('configSaveButton').addEventListener('click', () => {
    try {
      const configData = JSON.parse(configEditor.value);
      send('command:config-save', configData);
    } catch (e) {
      alert('JSON解析エラー: ' + e.message);
    }
  });
}
if (document.getElementById('configResetButton')) {
  document.getElementById('configResetButton').addEventListener('click', () => {
    configEditor.value = '';
    send('command:config-get', null);
  });
}

// ── システム診断 ────────────────────────────────────────────────────
if (document.getElementById('doctorButton')) {
  document.getElementById('doctorButton').addEventListener('click', () => {
    const doctorView = document.getElementById('doctorView');
    doctorView.textContent = '診断実行中...';
    send('command:system-doctor', null);
  });
}

connectSocket();
setAutoRefresh(true);
