let socket;

const modeBadge = document.getElementById('modeBadge');
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
const fetchItemName = document.getElementById('fetchItemName');
const fetchAmount = document.getElementById('fetchAmount');
const fetchItemButton = document.getElementById('fetchItemButton');
const retreatButton = document.getElementById('retreatButton');
const setBaseQuickButton = document.getElementById('setBaseQuickButton');
const securityHint = document.getElementById('securityHint');

const baseName = document.getElementById('baseName');
const setBaseButton = document.getElementById('setBaseButton');
const collectBlock = document.getElementById('collectBlock');
const collectButton = document.getElementById('collectButton');
const schemPath = document.getElementById('schemPath');
const buildButton = document.getElementById('buildButton');

let refreshTimer = null;
let autoRefresh = true;

function setAutoRefresh(enabled) {
  autoRefresh = enabled;
  toggleRefreshButton.textContent = `自動更新: ${enabled ? 'ON' : 'OFF'}`;

  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (enabled) {
    refreshTimer = setInterval(() => {
      socket?.emit('refresh');
    }, 3000);
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
  commandResult.textContent = JSON.stringify(result, null, 2);
}

function renderStatus(payload) {
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
}

function connectSocket() {
  if (socket) {
    socket.disconnect();
  }

  socket = io({
    auth: {
      token: guiToken.value.trim()
    }
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
    socket.emit('refresh');
  });

  socket.on('unauthorized', (result) => {
    showResult(result);
  });
}

searchButton.addEventListener('click', () => {
  socket.emit('search-item', searchText.value);
});

quickDiamondButton.addEventListener('click', () => {
  searchText.value = 'diamond';
  socket.emit('search-item', 'diamond');
});

setBaseButton.addEventListener('click', () => {
  socket.emit('command:set-base', baseName.value);
});

collectButton.addEventListener('click', () => {
  socket.emit('command:collect', collectBlock.value);
});

buildButton.addEventListener('click', () => {
  socket.emit('command:build', schemPath.value);
});

collectWoodButton.addEventListener('click', () => {
  collectBlock.value = 'oak_log';
  socket.emit('command:collect', 'oak_log');
});

fetchItemButton.addEventListener('click', () => {
  socket.emit('command:fetch-item', {
    itemName: fetchItemName.value,
    amount: Number(fetchAmount.value || 1)
  });
});

retreatButton.addEventListener('click', () => {
  socket.emit('command:retreat-base');
});

setBaseQuickButton.addEventListener('click', () => {
  socket.emit('command:set-base', baseName.value || 'quick-base');
});

toggleRefreshButton.addEventListener('click', () => {
  setAutoRefresh(!autoRefresh);
});

reconnectButton.addEventListener('click', () => {
  connectSocket();
  setAutoRefresh(autoRefresh);
});

bindEnter(searchText, () => socket.emit('search-item', searchText.value));
bindEnter(collectBlock, () => socket.emit('command:collect', collectBlock.value));
bindEnter(fetchItemName, () => {
  socket.emit('command:fetch-item', {
    itemName: fetchItemName.value,
    amount: Number(fetchAmount.value || 1)
  });
});

connectSocket();
setAutoRefresh(true);
