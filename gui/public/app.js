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
    showResult(result);
    send('refresh');
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

fetchItemButton.addEventListener('click', () => {
  send('command:fetch-item', {
    itemName: fetchItemName.value,
    amount: Number(fetchAmount.value || 1),
    targetBotId: selectedTargetBotId()
  });
});

retreatButton.addEventListener('click', () => send('command:retreat-base', { targetBotId: selectedTargetBotId() }));
setBaseQuickButton.addEventListener('click', () => send('command:set-base', { name: baseName.value || 'quick-base', targetBotId: selectedTargetBotId() }));

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

connectSocket();
setAutoRefresh(true);
