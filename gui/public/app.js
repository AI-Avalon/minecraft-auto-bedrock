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
    // Fleet リストを自動更新
    renderBulkBotList();
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

  // Fleet Bot一覧ハンドラ
  socket.on('fleet-bots-list', (botsList) => {
    console.log('Fleet bots list received:', botsList);
    if (Array.isArray(botsList)) {
      renderBulkBotList(botsList);
    }
  });

  // 一括操作結果ハンドラ
  socket.on('bulk-action-result', (result) => {
    console.log('Bulk action result:', result);
    showResult(result);
    // 実行後にFleetリストを更新
    send('command:fleet-list-bots');
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

// ── Javaバージョン検出 ────────────────────────────────────────────────────
if (document.getElementById('detectJavaButton')) {
  document.getElementById('detectJavaButton').addEventListener('click', () => {
    if (!socket || !socket.connected) {
      alert('接続していません');
      return;
    }
    send('command:detect-java', null);
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 推奨プリセット・役割プリセット・一括Bot管理
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 推奨プリセット定義
const RECOMMENDED_PRESETS = [
  {
    id: 'solo-player',
    name: '🎮 ソロプレイ',
    description: '1体のBotで全て自動化。初心者向け',
    modeConfig: {
      mode: 'autonomous',
      autoEat: true,
      autoStore: true,
      autoMine: true
    }
  },
  {
    id: 'farming-focus',
    name: '🌾 農業強化',
    description: '農業特化。野菜・小麦を大量生産',
    modeConfig: {
      mode: 'autonomous',
      farmingEnabled: true,
      miningEnabled: false,
      autoStore: true
    }
  },
  {
    id: 'mining-focus',
    name: '⛏️ 採掘強化',
    description: '鉱石採掘特化。ダイヤ・ネザライト稼ぎ',
    modeConfig: {
      mode: 'silent-mining',
      miningEnabled: true,
      farmingEnabled: false,
      autoStore: true
    }
  },
  {
    id: 'combat-ready',
    name: '⚔️ 戦闘特化',
    description: 'PvM/PvP対応。敵MOB・プレイヤー討伐',
    modeConfig: {
      mode: 'autonomous',
      combatEnabled: true,
      combatProfile: 'berserker'
    }
  },
  {
    id: 'building-master',
    name: '🏗️ 建築特化',
    description: '大規模建築。自動補充機能付き',
    modeConfig: {
      mode: 'autonomous',
      buildingEnabled: true,
      autoRefill: true
    }
  },
  {
    id: 'multi-bot-cluster',
    name: '🤖 マルチBot運用',
    description: '複数Botの役割分担。効率最大化',
    modeConfig: {
      mode: 'autonomous',
      orchestratorEnabled: true,
      clusterMode: true
    }
  }
];

// 役割プリセット定義
const ROLE_PRESETS = [
  {
    role: 'primary',
    name: '主Bot',
    color: '#4CAF50',
    description: '全機能対応。指令官として機能',
    recommendedMode: 'autonomous',
    specialFeatures: ['全機能', 'AI学習', '他Botの指令']
  },
  {
    role: 'miner',
    name: '採掘Bot',
    color: '#9C27B0',
    description: '鉱石採掘特化',
    recommendedMode: 'silent-mining',
    specialFeatures: ['ブランチマイニング', '自動帰還', '鉱石検知']
  },
  {
    role: 'farmer',
    name: '農業Bot',
    color: '#00BCD4',
    description: '農業・採集特化',
    recommendedMode: 'autonomous',
    specialFeatures: ['自動耕作', '作物収穫', '紙・砂糖生産']
  },
  {
    role: 'fighter',
    name: '戦闘Bot',
    color: '#F44336',
    description: 'PvM/PvP',
    recommendedMode: 'autonomous',
    specialFeatures: ['MOB討伐', 'PvP対応', '回避機能']
  },
  {
    role: 'builder',
    name: '建築Bot',
    color: '#FFEB3B',
    description: '建築・装飾特化',
    recommendedMode: 'autonomous',
    specialFeatures: ['Schematic実行', '自動補充', 'ブロック検知']
  },
  {
    role: 'assistant',
    name: 'アシスタント',
    color: '#FF9800',
    description: '複数Botをサポート',
    recommendedMode: 'player-command',
    specialFeatures: ['マニュアル操作', 'UI連動', 'ログ監視']
  },
  {
    role: 'worker',
    name: 'ワーカー',
    color: '#2196F3',
    description: '汎用作業Bot',
    recommendedMode: 'hybrid',
    specialFeatures: ['混合モード', 'タスク受け付け', '柔軟対応']
  }
];

// 推奨プリセットUIをレンダリング
function renderRecommendedPresets() {
  const container = document.getElementById('recommendedPresets');
  if (!container) return;
  
  container.innerHTML = '';
  RECOMMENDED_PRESETS.forEach(preset => {
    const card = document.createElement('div');
    card.className = 'preset-card';
    card.innerHTML = `<h3>${preset.name}</h3><p>${preset.description}</p>`;
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      showResult({
        action: 'preset-selected',
        preset: preset.id,
        message: `推奨プリセット「${preset.name}」を選択しました`
      });
      // 設定をconfig.jsonに反映
      const configEditor = document.getElementById('configEditor');
      if (configEditor && socket && socket.connected) {
        try {
          const currentConfig = JSON.parse(configEditor.value);
          Object.assign(currentConfig, preset.modeConfig);
          configEditor.value = JSON.stringify(currentConfig, null, 2);
          // 自動保存
          send('command:config-save', currentConfig);
        } catch (e) {
          console.error('プリセット適用エラー:', e);
        }
      }
    });
    container.appendChild(card);
  });
}

// すべての役割プリセットUIをレンダリング
function renderRolePresetsAll() {
  const container = document.getElementById('rolePresetsAll');
  if (!container) return;
  
  container.innerHTML = '';
  ROLE_PRESETS.forEach(preset => {
    const card = document.createElement('div');
    card.className = 'preset-card';
    card.style.borderColor = preset.color;
    card.innerHTML = `
      <h3>${preset.name}</h3>
      <p>${preset.description}</p>
      <small style="color: #666;">推奨: ${preset.recommendedMode}</small>
    `;
    card.addEventListener('click', () => {
      const bulkPresetRole = document.getElementById('bulkPresetRole');
      if (bulkPresetRole) {
        bulkPresetRole.value = preset.role;
      }
      showResult({
        action: 'role-preset-selected',
        role: preset.role,
        message: `役割「${preset.name}」を選択。新規Bot追加時に反映されます。`
      });
    });
    container.appendChild(card);
  });
}

// 一括Bot管理UIをレンダリング
function renderBulkBotList() {
  const container = document.getElementById('bulkBotList');
  if (!container || !socket || !socket.connected) return;
  
  send('command:fleet-list-bots');
}

// 一括Bot追加イベントハンドラ
const bulkBotAddButton = document.getElementById('bulkBotAddButton');
if (bulkBotAddButton) {
  bulkBotAddButton.addEventListener('click', () => {
    const id = document.getElementById('bulkBotId')?.value?.trim();
    const username = document.getElementById('bulkBotUsername')?.value?.trim();
    const role = document.getElementById('bulkPresetRole')?.value || 'worker';
    
    if (!id || !username) {
      showResult({ ok: false, message: 'BoT IDとユーザー名を入力してください' });
      return;
    }
    
    send('command:fleet-add-bot', {
      id,
      username,
      role,
      behavior: { mode: 'hybrid' },
      memoryFile: `memory-${id}.json`
    });
    
    // フォーム初期化
    document.getElementById('bulkBotId').value = '';
    document.getElementById('bulkBotUsername').value = '';
    document.getElementById('bulkPresetRole').value = '';
    
    // リスト更新
    setTimeout(() => renderBulkBotList(), 500);
  });
}

// 一括操作イベントハンドラ
const bulkActionButton = document.getElementById('bulkActionButton');
if (bulkActionButton) {
  bulkActionButton.addEventListener('click', () => {
    const actionType = document.getElementById('bulkActionType')?.value;
    const param = document.getElementById('bulkActionParam')?.value?.trim();
    
    if (!actionType) {
      showResult({ ok: false, message: '操作を選択してください' });
      return;
    }
    
    const bulkPayload = {
      actionType,
      param
    };
    
    send('command:bulk-action', bulkPayload);
  });
}

// 初期化時にUIをレンダリング
setTimeout(() => {
  renderRecommendedPresets();
  renderRolePresetsAll();
  renderBulkBotList();
}, 500);

connectSocket();
setAutoRefresh(true);
