let socket = null;
let autoRefresh = true;
let refreshTimer = null;
let refreshInFlight = false;
let logStreamActive = false;

const state = {
  lastStatus: null
};

const byId = (id) => document.getElementById(id);
const bySelector = (selector) => document.querySelector(selector);

const els = {
  modeBadge: byId('modeBadge'),
  socketState: byId('socketState'),
  securityHint: byId('securityHint'),
  guiToken: byId('guiToken'),
  reconnectButton: byId('reconnectButton'),
  toggleRefreshButton: byId('toggleRefreshButton'),
  toastContainer: byId('toast-container'),
  statusView: byId('statusView'),
  memoryView: byId('memoryView'),
  inventoryList: byId('inventoryList'),
  searchText: byId('searchText'),
  searchResult: byId('searchResult'),
  commandResult: byId('commandResult'),
  targetBotSelect: byId('targetBotSelect'),
  fleetStatusCards: byId('fleetStatusCards'),
  fleetStatusList: byId('fleetStatusList'),
  serverList: byId('serverList'),
  processSelect: byId('processSelect'),
  processListView: byId('processListView'),
  logView: byId('logView'),
  logProcessSelect: byId('logProcessSelect'),
  logLinesInput: byId('logLinesInput'),
  configEditor: byId('configEditor'),
  doctorView: byId('doctorView'),
  oneclickProgress: byId('oneclickProgress'),
  oneclickProgressText: byId('oneclickProgressText'),
  bulkBotList: byId('bulkBotList'),
  javaServerStatusBadge: byId('javaServerStatusBadge'),
  javaServerStatusText: byId('javaServerStatusText'),
  javaServerProgressText: byId('javaServerProgressText'),
  overviewJavaStatusBadge: byId('overviewJavaStatusBadge'),
  overviewJavaProgressText: byId('overviewJavaProgressText'),
  quickStartPanel: byId('quickStartPanel')
};

function parseCsvIds(text) {
  return String(text || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function formatCurrentAction(status = {}) {
  const action = status.currentAction || status.automation?.mode || 'idle';
  const map = {
    idle: '待機',
    combat: '戦闘',
    'city-mode': '都市モード',
    'auto-mine': '自動採掘',
    'auto-store': '自動保管',
    'auto-sort': '自動仕分け',
    farming: '農業',
    exploring: '探索',
    'branch-mining': 'ブランチ採掘'
  };

  if (typeof action === 'string' && action.startsWith('collect:')) {
    return `採取(${action.split(':').slice(1).join(':')})`;
  }

  return map[action] || String(action);
}

const RECOMMENDED_PRESETS = [
  {
    id: 'solo-player',
    name: 'ソロ運用',
    description: '1体Botで探索・採掘・農業を回す',
    modeConfig: { mode: 'autonomous', autoEat: true, autoStore: true, autoMine: true }
  },
  {
    id: 'farming-focus',
    name: '農業特化',
    description: '収穫と保管を優先',
    modeConfig: { mode: 'autonomous', farmingEnabled: true, miningEnabled: false, autoStore: true }
  },
  {
    id: 'mining-focus',
    name: '採掘特化',
    description: 'ブランチマイニング中心',
    modeConfig: { mode: 'silent-mining', miningEnabled: true, farmingEnabled: false, autoStore: true }
  },
  {
    id: 'multi-bot-cluster',
    name: 'マルチBot',
    description: '複数Botでロール分担',
    modeConfig: { mode: 'autonomous', orchestratorEnabled: true, clusterMode: true }
  }
];

const ROLE_PRESETS = [
  { role: 'primary', name: '主Bot', description: '全体制御', recommendedMode: 'autonomous' },
  { role: 'miner', name: '採掘Bot', description: '鉱石回収', recommendedMode: 'silent-mining' },
  { role: 'farmer', name: '農業Bot', description: '耕作と繁殖', recommendedMode: 'autonomous' },
  { role: 'fighter', name: '戦闘Bot', description: 'MOB/PvP対応', recommendedMode: 'autonomous' },
  { role: 'builder', name: '建築Bot', description: '建築と補充', recommendedMode: 'autonomous' },
  { role: 'assistant', name: '補助Bot', description: '手動支援', recommendedMode: 'player-command' },
  { role: 'worker', name: '汎用Bot', description: '一般作業', recommendedMode: 'hybrid' }
];

function selectedTargetBotId() {
  return els.targetBotSelect?.value || undefined;
}

function showToast(message, type = 'info') {
  if (!els.toastContainer) {
    return;
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  els.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4200);
}

function setSocketState(status, detail = '') {
  if (!els.socketState) {
    return;
  }

  els.socketState.classList.remove('badge-connected', 'badge-connecting', 'badge-disconnected');

  if (status === 'connected') {
    els.socketState.classList.add('badge-connected');
    els.socketState.textContent = detail ? `接続中 (${detail})` : '接続中';
  } else if (status === 'connecting') {
    els.socketState.classList.add('badge-connecting');
    els.socketState.textContent = detail ? `接続中 (${detail})` : '接続中';
  } else {
    els.socketState.classList.add('badge-disconnected');
    els.socketState.textContent = detail ? `切断 (${detail})` : '切断中';
  }
}

function showResult(payload) {
  if (!els.commandResult) {
    return;
  }

  const row = {
    at: new Date().toISOString(),
    ...payload
  };
  els.commandResult.textContent = JSON.stringify(row, null, 2);
}

function bindEnter(id, fn) {
  const el = byId(id);
  if (!el) {
    return;
  }

  el.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      fn();
    }
  });
}

function send(eventName, payload) {
  if (!socket || !socket.connected) {
    showResult({ ok: false, action: eventName, reason: 'socket-disconnected' });
    showToast('Socket未接続です。再接続してください。', 'error');
    return;
  }

  socket.emit(eventName, payload);
}

function setAutoRefresh(enabled) {
  autoRefresh = Boolean(enabled);

  if (els.toggleRefreshButton) {
    els.toggleRefreshButton.textContent = autoRefresh ? '自動更新 ON' : '自動更新 OFF';
    els.toggleRefreshButton.classList.toggle('btn-active', autoRefresh);
  }

  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (!autoRefresh) {
    return;
  }

  refreshTimer = setInterval(() => {
    if (!socket || !socket.connected || refreshInFlight) {
      return;
    }

    refreshInFlight = true;
    socket.emit('refresh');
  }, 2500);
}

function renderInventory(items = []) {
  if (!els.inventoryList) {
    return;
  }

  els.inventoryList.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = `${item.displayName || item.name || 'item'} x${item.count || 0}`;
    els.inventoryList.appendChild(li);
  }
}

function roleClass(role = '') {
  const safe = String(role || 'worker').toLowerCase();
  return `role-${safe}`;
}

function renderFleetRows(fleet = []) {
  if (els.targetBotSelect) {
    const current = els.targetBotSelect.value;
    els.targetBotSelect.innerHTML = '';

    const primary = document.createElement('option');
    primary.value = '';
    primary.textContent = '既定Bot (Primary)';
    els.targetBotSelect.appendChild(primary);

    for (const row of fleet) {
      const option = document.createElement('option');
      option.value = row.id;
      option.textContent = `${row.id} (${row.role || 'worker'})`;
      els.targetBotSelect.appendChild(option);
    }

    if ([...els.targetBotSelect.options].some((opt) => opt.value === current)) {
      els.targetBotSelect.value = current;
    }
  }

  if (els.fleetStatusList) {
    els.fleetStatusList.innerHTML = '';
    for (const row of fleet) {
      const hp = row.status?.health ?? '-';
      const food = row.status?.food ?? '-';
      const mode = row.status?.mode || row.status?.automation?.mode || '-';
      const action = formatCurrentAction(row.status || {});
      const pos = row.status?.position ? `${row.status.position.x},${row.status.position.y},${row.status.position.z}` : 'n/a';
      const li = document.createElement('li');
      li.textContent = `${row.id} role=${row.role} mode=${mode} action=${action} hp=${hp} food=${food} pos=${pos}`;
      els.fleetStatusList.appendChild(li);
    }
  }

  if (els.fleetStatusCards) {
    els.fleetStatusCards.innerHTML = '';
    for (const row of fleet) {
      const status = row.status || {};
      const card = document.createElement('article');
      const online = status.connected ? 'online' : 'offline';
      card.className = `bot-card status-${online}`;
      card.innerHTML = [
        `<div class="bot-card-name">${row.id}</div>`,
        `<div class="bot-card-role"><span class="role-badge ${roleClass(row.role)}">${row.role || 'worker'}</span></div>`,
        '<div class="bot-card-stats">',
        `<div class="bot-stat"><span class="bot-stat-label">HP</span><span class="bot-stat-value">${status.health ?? '-'}</span></div>`,
        `<div class="bot-stat"><span class="bot-stat-label">FOOD</span><span class="bot-stat-value">${status.food ?? '-'}</span></div>`,
        `<div class="bot-stat"><span class="bot-stat-label">MODE</span><span class="bot-stat-value">${status.mode || status.automation?.mode || '-'}</span></div>`,
        `<div class="bot-stat"><span class="bot-stat-label">ACT</span><span class="bot-stat-value">${formatCurrentAction(status)}</span></div>`,
        `<div class="bot-stat"><span class="bot-stat-label">ED</span><span class="bot-stat-value">${status.edition || '-'}</span></div>`,
        '</div>'
      ].join('');
      els.fleetStatusCards.appendChild(card);
    }
  }

  if (els.serverList) {
    els.serverList.innerHTML = '';

    if (!fleet.length) {
      els.serverList.innerHTML = '<p class="text-muted">Bot を追加すると接続先が表示されます</p>';
      return;
    }

    for (const row of fleet) {
      const status = row.status || {};
      const edition = status.edition || 'java';
      const host = status.server?.host || status.host || '-';
      const port = status.server?.port || status.port || '-';
      const item = document.createElement('div');
      item.className = 'server-item';
      item.innerHTML = [
        '<div class="server-item-info">',
        `<div class="server-item-host">${row.id}</div>`,
        `<div class="server-item-meta">${edition.toUpperCase()} / ${host}:${port}</div>`,
        '</div>',
        `<span class="role-badge ${roleClass(row.role)}">${row.role || 'worker'}</span>`
      ].join('');
      els.serverList.appendChild(item);
    }
  }
}

function renderBulkBotList(rows = []) {
  if (!els.bulkBotList) {
    return;
  }

  els.bulkBotList.innerHTML = '';

  if (!rows.length) {
    els.bulkBotList.innerHTML = '<p class="text-muted">登録されたBotはありません</p>';
    return;
  }

  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'bot-item';
    item.innerHTML = [
      `<div><strong>${row.id}</strong>`,
      ` <span class="role-badge ${roleClass(row.role)}">${row.role || 'worker'}</span>`,
      ` <span class="text-muted">${row.mode || row.status?.mode || '-'}</span></div>`,
      '<div class="bot-item-actions">',
      `<button class="btn btn-sm" data-action="target" data-id="${row.id}">選択</button>`,
      `<button class="btn btn-sm btn-red" data-action="remove" data-id="${row.id}">削除</button>`,
      '</div>'
    ].join('');

    els.bulkBotList.appendChild(item);
  }

  els.bulkBotList.querySelectorAll('button[data-action="target"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (els.targetBotSelect) {
        els.targetBotSelect.value = btn.dataset.id || '';
      }
      showToast(`操作対象を ${btn.dataset.id} に変更`, 'info');
    });
  });

  els.bulkBotList.querySelectorAll('button[data-action="remove"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      send('command:fleet-remove-bot', { id: btn.dataset.id });
    });
  });
}

function renderStatus(payload) {
  refreshInFlight = false;
  state.lastStatus = payload;

  if (els.modeBadge) {
    els.modeBadge.textContent = `MODE: ${(payload.mode || '-').toUpperCase()}`;
  }

  if (els.statusView) {
    els.statusView.textContent = JSON.stringify(payload.status || {}, null, 2);
  }

  if (els.memoryView) {
    els.memoryView.textContent = JSON.stringify(payload.memory || {}, null, 2);
  }

  if (els.securityHint) {
    const sec = payload.security || {};
    els.securityHint.classList.remove('visually-hidden');
    els.securityHint.textContent = `権限制御: readOnly=${Boolean(sec.readOnly)} allowed=${(sec.allowedCommands || []).join(', ')}`;
  }

  renderInventory(payload.status?.inventory || []);
  renderFleetRows(payload.status?.fleet || []);
}

function parseJsonEditor() {
  if (!els.configEditor) {
    return null;
  }

  try {
    return JSON.parse(els.configEditor.value || '{}');
  } catch (error) {
    showToast(`JSON解析エラー: ${error.message}`, 'error');
    return null;
  }
}

function onCommandResult(result) {
  const action = result?.action || 'unknown';
  const ok = Boolean(result?.ok);
  const data = result?.result;

  if (action === 'config-get' && ok && data && els.configEditor) {
    els.configEditor.value = JSON.stringify(data, null, 2);
  }

  if (action === 'config-save') {
    showToast(ok ? '設定を保存しました' : '設定保存に失敗しました', ok ? 'success' : 'error');
  }

  if (action === 'process-list' && ok && Array.isArray(data) && els.processListView) {
    els.processListView.textContent = JSON.stringify(data, null, 2);

    if (els.processSelect) {
      const existing = new Set(Array.from(els.processSelect.options).map((opt) => opt.value));
      for (const proc of data) {
        const name = proc?.name;
        if (!name || existing.has(name)) {
          continue;
        }

        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        els.processSelect.appendChild(option);
      }
    }

    if (els.logProcessSelect) {
      const existing = new Set(Array.from(els.logProcessSelect.options).map((opt) => opt.value));
      for (const proc of data) {
        const name = proc?.name;
        if (!name || existing.has(name)) {
          continue;
        }

        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        els.logProcessSelect.appendChild(option);
      }
    }
  }

  if (action === 'process-logs' && els.logView) {
    els.logView.textContent = data?.logs || result?.reason || 'ログがありません';
  }

  if (action === 'system-doctor' && ok && els.doctorView) {
    els.doctorView.textContent = JSON.stringify(data, null, 2);
  }

  if (action === 'java-server-start' || action === 'java-server-stop') {
    if (els.javaServerProgressText) {
      els.javaServerProgressText.classList.remove('java-server-progress');
      els.javaServerProgressText.style.display = 'none';
    }
    send('command:java-server-status');
    if (ok) {
      send('command:fleet-list-bots');
    }
  }

  if (action === 'bot-connect-local' && ok) {
    send('command:fleet-list-bots');
    send('refresh');
  }

  showResult(result || { ok: false, reason: 'empty-result' });

  if (ok) {
    showToast(`${action} を実行しました`, 'success');
  } else {
    const msg = result?.reason || data?.message || 'エラー';
    showToast(`${action}: ${msg}`, 'error');
  }

  if (socket?.connected) {
    send('refresh');
  }
}

function connectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }

  setSocketState('connecting');

  socket = io({
    auth: {
      token: (els.guiToken?.value || '').trim()
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 5000
  });

  socket.on('connect', () => {
    setSocketState('connected', socket.id);
    showToast('GUIサーバーに接続しました', 'success');
    send('command:fleet-list-bots');
    send('command:java-server-status');
    if (autoRefresh) {
      send('refresh');
    }
  });

  socket.on('disconnect', (reason) => {
    setSocketState('disconnected', reason);
    showToast(`Socket切断: ${reason}`, 'warning');
  });

  socket.io.on('reconnect_attempt', (attempt) => {
    setSocketState('connecting', `retry ${attempt}`);
  });

  socket.on('bootstrap', renderStatus);
  socket.on('status', renderStatus);

  socket.on('search-result', (rows) => {
    if (!els.searchResult) {
      return;
    }

    els.searchResult.innerHTML = '';
    for (const row of rows || []) {
      const li = document.createElement('li');
      li.textContent = `${row.item?.displayName || row.item?.name || '-'} x${row.item?.count || 0} @ ${row.chestKey || '-'}`;
      els.searchResult.appendChild(li);
    }
  });

  socket.on('command-result', onCommandResult);

  socket.on('fleet-bots-list', (botsList) => {
    const rows = Array.isArray(botsList) ? botsList : [];
    renderBulkBotList(rows);

    // Botが0のときクイックスタートパネルを表示、それ以外は非表示
    if (els.quickStartPanel) {
      els.quickStartPanel.style.display = rows.length === 0 ? '' : 'none';
    }
  });

  socket.on('bulk-action-result', (result) => {
    showResult(result);
    showToast(result?.ok ? '一括操作を実行しました' : '一括操作に失敗しました', result?.ok ? 'success' : 'error');
    send('command:fleet-list-bots');
  });

  socket.on('oneclick-progress', (progress) => {
    if (els.oneclickProgress) {
      els.oneclickProgress.value = Number(progress?.percent || 0);
    }

    if (els.oneclickProgressText) {
      const idx = Number(progress?.stepIndex || 0);
      const total = Number(progress?.totalSteps || 0);
      els.oneclickProgressText.textContent = `${progress?.label || '処理中'} (${idx}/${total}) ${progress?.percent || 0}%`;
    }
  });

  socket.on('java-server-status', (payload) => {
    const running = Boolean(payload?.running);
    const pidText = payload?.pid ? ` (PID: ${payload.pid})` : '';

    // サーバータブのバッジ
    if (els.javaServerStatusBadge) {
      els.javaServerStatusBadge.classList.remove('badge-connected', 'badge-disconnected');
      els.javaServerStatusBadge.classList.add(running ? 'badge-connected' : 'badge-disconnected');
      els.javaServerStatusBadge.textContent = running ? `稼働中${pidText}` : '停止中';
    }
    if (els.javaServerStatusText) {
      els.javaServerStatusText.textContent = running
        ? `Javaサーバー稼働中${pidText}`
        : 'Javaサーバーは停止しています。「サーバー起動」を押してから Bot を接続してください。';
    }

    // 概要タブのバッジ
    if (els.overviewJavaStatusBadge) {
      els.overviewJavaStatusBadge.classList.remove('badge-connected', 'badge-disconnected');
      els.overviewJavaStatusBadge.classList.add(running ? 'badge-connected' : 'badge-disconnected');
      els.overviewJavaStatusBadge.textContent = running ? `Javaサーバー: 稼働中${pidText}` : 'Javaサーバー: 停止中';
    }
  });

  socket.on('java-server-progress', (payload) => {
    const msg = payload?.message || '';
    if (els.javaServerProgressText) {
      els.javaServerProgressText.textContent = msg;
      els.javaServerProgressText.style.display = msg ? '' : 'none';
    }
    if (els.overviewJavaProgressText) {
      els.overviewJavaProgressText.textContent = msg;
    }
  });

  socket.on('log-line', (payload) => {
    if (!els.logView) {
      return;
    }

    els.logView.textContent += payload?.text || '';
    els.logView.scrollTop = els.logView.scrollHeight;
  });

  socket.on('log-stream-closed', () => {
    logStreamActive = false;
    const button = byId('logStreamToggleButton');
    if (button) {
      button.textContent = 'ストリーミング: OFF';
      button.classList.remove('btn-active');
    }

    if (els.logView) {
      els.logView.textContent += '\n[ストリーム終了]\n';
    }
  });

  socket.on('unauthorized', (result) => {
    showResult(result);
    setSocketState('disconnected', 'unauthorized');
    showToast('認証エラー: トークンを確認してください', 'error');
  });
}

function setupTabs() {
  const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
  const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

  for (const button of tabButtons) {
    button.addEventListener('click', () => {
      tabButtons.forEach((btn) => btn.classList.remove('active'));
      tabPanels.forEach((panel) => panel.classList.remove('active'));

      button.classList.add('active');
      const tabName = button.dataset.tab;
      byId(`tab-${tabName}`)?.classList.add('active');
    });
  }
}

function setupPresetCards() {
  const rec = byId('recommendedPresets');
  if (rec) {
    rec.innerHTML = '';

    for (const preset of RECOMMENDED_PRESETS) {
      const card = document.createElement('div');
      card.className = 'preset-card';
      card.innerHTML = `<h3>${preset.name}</h3><p>${preset.description}</p>`;
      card.addEventListener('click', () => {
        const current = parseJsonEditor();
        if (!current) {
          return;
        }

        const merged = { ...current, behavior: { ...(current.behavior || {}), ...preset.modeConfig } };
        if (els.configEditor) {
          els.configEditor.value = JSON.stringify(merged, null, 2);
        }

        showToast(`推奨プリセット ${preset.name} を適用しました`, 'success');
      });
      rec.appendChild(card);
    }
  }

  const role = byId('rolePresetsAll');
  if (role) {
    role.innerHTML = '';

    for (const preset of ROLE_PRESETS) {
      const card = document.createElement('div');
      card.className = 'preset-card';
      card.innerHTML = `<h3>${preset.name}</h3><p>${preset.description}</p><small>推奨: ${preset.recommendedMode}</small>`;
      card.addEventListener('click', () => {
        const roleSelect = byId('bulkPresetRole');
        if (roleSelect) {
          roleSelect.value = preset.role;
        }
        showToast(`${preset.name} を選択しました`, 'info');
      });
      role.appendChild(card);
    }
  }
}

function setupHandlers() {
  byId('refreshBotsButton')?.addEventListener('click', () => send('refresh'));
  byId('refreshFleetButton')?.addEventListener('click', () => send('command:fleet-list-bots'));
  byId('serverListRefreshButton')?.addEventListener('click', () => send('refresh'));
  byId('clearResultButton')?.addEventListener('click', () => {
    if (els.commandResult) {
      els.commandResult.textContent = '';
    }
  });

  byId('searchButton')?.addEventListener('click', () => send('search-item', els.searchText?.value || ''));
  byId('quickDiamondSearchButton')?.addEventListener('click', () => {
    if (els.searchText) {
      els.searchText.value = 'diamond';
    }
    send('search-item', 'diamond');
  });

  byId('setBaseButton')?.addEventListener('click', () => {
    send('command:set-base', {
      name: byId('baseName')?.value,
      targetBotId: selectedTargetBotId()
    });
  });

  byId('setBaseQuickButton')?.addEventListener('click', () => {
    send('command:set-base', {
      name: byId('baseName')?.value || 'quick-base',
      targetBotId: selectedTargetBotId()
    });
  });

  byId('retreatButton')?.addEventListener('click', () => {
    send('command:retreat-base', { targetBotId: selectedTargetBotId() });
  });

  byId('collectButton')?.addEventListener('click', () => {
    send('command:collect', {
      blockName: byId('collectBlock')?.value,
      targetBotId: selectedTargetBotId()
    });
  });

  byId('collectWoodButton')?.addEventListener('click', () => {
    if (byId('collectBlock')) {
      byId('collectBlock').value = 'oak_log';
    }
    send('command:collect', {
      blockName: 'oak_log',
      targetBotId: selectedTargetBotId()
    });
  });

  byId('startAutoCollectButton')?.addEventListener('click', () => {
    send('command:start-auto-collect', {
      blockName: byId('collectBlock')?.value,
      targetCount: Number(byId('collectTargetCount')?.value || 64),
      targetBotId: selectedTargetBotId()
    });
  });

  byId('stopAutoCollectButton')?.addEventListener('click', () => send('command:stop-auto-collect', { targetBotId: selectedTargetBotId() }));
  byId('startAutoMineButton')?.addEventListener('click', () => send('command:start-auto-mine', { targetBotId: selectedTargetBotId() }));
  byId('stopAutoMineButton')?.addEventListener('click', () => send('command:stop-auto-mine', { targetBotId: selectedTargetBotId() }));

  byId('mineBranchButton')?.addEventListener('click', () => send('command:mining-branch', { targetBotId: selectedTargetBotId() }));
  byId('mineStripButton')?.addEventListener('click', () => send('command:mining-strip', { targetBotId: selectedTargetBotId() }));
  byId('mineVeinButton')?.addEventListener('click', () => send('command:mining-vein', {
    targetBotId: selectedTargetBotId(),
    oreName: byId('collectBlock')?.value || 'diamond_ore'
  }));
  byId('mineStopButton')?.addEventListener('click', () => send('command:mining-stop', { targetBotId: selectedTargetBotId() }));

  byId('farmStartButton')?.addEventListener('click', () => send('command:farming-start', { targetBotId: selectedTargetBotId() }));
  byId('farmHarvestButton')?.addEventListener('click', () => send('command:farming-harvest', { targetBotId: selectedTargetBotId() }));
  byId('farmExpandButton')?.addEventListener('click', () => send('command:farming-expand', { targetBotId: selectedTargetBotId() }));
  byId('farmWaterButton')?.addEventListener('click', () => send('command:farming-water', { targetBotId: selectedTargetBotId() }));
  byId('farmStopButton')?.addEventListener('click', () => send('command:farming-stop', { targetBotId: selectedTargetBotId() }));
  byId('farmBreedButton')?.addEventListener('click', () => send('command:farming-breed', {
    targetBotId: selectedTargetBotId(),
    mob: byId('breedAnimalSelect')?.value
  }));

  byId('exploreStartButton')?.addEventListener('click', () => send('command:explore-start', { targetBotId: selectedTargetBotId() }));
  byId('exploreStopButton')?.addEventListener('click', () => send('command:explore-stop', { targetBotId: selectedTargetBotId() }));
  byId('explorePOIButton')?.addEventListener('click', () => send('command:explore-poi', { targetBotId: selectedTargetBotId() }));

  byId('quickMineBranchButton')?.addEventListener('click', () => send('command:mining-branch', { targetBotId: selectedTargetBotId() }));
  byId('quickFarmButton')?.addEventListener('click', () => send('command:farming-start', { targetBotId: selectedTargetBotId() }));
  byId('quickExploreButton')?.addEventListener('click', () => send('command:explore-start', { targetBotId: selectedTargetBotId() }));
  byId('quickStopAllButton')?.addEventListener('click', () => send('command:bulk-action', { actionType: 'stop-all' }));
  byId('quickRetreatButton')?.addEventListener('click', () => send('command:bulk-action', { actionType: 'gather-to-base' }));
  byId('quickDiamondButton')?.addEventListener('click', () => {
    if (els.searchText) {
      els.searchText.value = 'diamond';
    }
    send('search-item', 'diamond');
  });

  byId('buildButton')?.addEventListener('click', () => {
    send('command:build', {
      schemPath: byId('schemPath')?.value,
      targetBotId: selectedTargetBotId()
    });
  });

  byId('buildWithRefillButton')?.addEventListener('click', () => {
    const requiredItems = [];
    const fetchName = byId('fetchItemName')?.value?.trim();
    if (fetchName) {
      requiredItems.push({ itemName: fetchName, amount: Number(byId('fetchAmount')?.value || 64) });
    }

    send('command:build-with-refill', {
      schemPath: byId('schemPath')?.value,
      requiredItems,
      targetBotId: selectedTargetBotId()
    });
  });

  byId('fetchItemButton')?.addEventListener('click', () => {
    send('command:fetch-item', {
      itemName: byId('fetchItemName')?.value,
      amount: Number(byId('fetchAmount')?.value || 1),
      targetBotId: selectedTargetBotId()
    });
  });

  byId('storeInventoryButton')?.addEventListener('click', () => send('command:store-inventory', { targetBotId: selectedTargetBotId() }));
  byId('startAutoStoreButton')?.addEventListener('click', () => send('command:start-auto-store', { targetBotId: selectedTargetBotId() }));
  byId('stopAutoStoreButton')?.addEventListener('click', () => send('command:stop-auto-store', { targetBotId: selectedTargetBotId() }));
  byId('sortChestsButton')?.addEventListener('click', () => send('command:sort-chests-once', { targetBotId: selectedTargetBotId() }));
  byId('startAutoSortButton')?.addEventListener('click', () => send('command:start-auto-sort', { targetBotId: selectedTargetBotId() }));
  byId('stopAutoSortButton')?.addEventListener('click', () => send('command:stop-auto-sort', { targetBotId: selectedTargetBotId() }));

  byId('fightNearestMobButton')?.addEventListener('click', () => send('command:fight-nearest-mob', { targetBotId: selectedTargetBotId() }));
  byId('fightPlayerButton')?.addEventListener('click', () => send('command:fight-player', {
    targetBotId: selectedTargetBotId(),
    playerName: byId('fightPlayerName')?.value
  }));
  byId('stopFightButton')?.addEventListener('click', () => send('command:stop-fight', { targetBotId: selectedTargetBotId() }));
  byId('combatProfileButton')?.addEventListener('click', () => send('command:set-combat-profile', {
    targetBotId: selectedTargetBotId(),
    profile: byId('combatProfile')?.value || 'balanced'
  }));
  byId('evasionToggleButton')?.addEventListener('click', () => send('command:set-evasion', {
    targetBotId: selectedTargetBotId(),
    enabled: Boolean(byId('evasionEnabled')?.checked)
  }));

  byId('plannerCalcRecipeButton')?.addEventListener('click', () => send('command:planner-calc-recipe', {
    targetBotId: selectedTargetBotId(),
    itemName: byId('plannerItemName')?.value,
    count: Number(byId('plannerItemCount')?.value || 1)
  }));
  byId('plannerGatherForCraftButton')?.addEventListener('click', () => send('command:planner-gather-for-craft', {
    targetBotId: selectedTargetBotId(),
    itemName: byId('plannerItemName')?.value,
    count: Number(byId('plannerItemCount')?.value || 1)
  }));
  byId('craftItemButton')?.addEventListener('click', () => send('command:craft-item', {
    targetBotId: selectedTargetBotId(),
    itemName: byId('plannerItemName')?.value,
    count: Number(byId('plannerItemCount')?.value || 1)
  }));
  byId('equipBestArmorButton')?.addEventListener('click', () => send('command:equip-best-armor', { targetBotId: selectedTargetBotId() }));

  byId('startCityModeButton')?.addEventListener('click', () => send('command:start-city-mode', {
    targetBotId: selectedTargetBotId(),
    modeName: byId('cityModeName')?.value || 'village'
  }));
  byId('stopCityModeButton')?.addEventListener('click', () => send('command:stop-city-mode', { targetBotId: selectedTargetBotId() }));

  byId('bulkBotAddButton')?.addEventListener('click', () => {
    const id = byId('bulkBotId')?.value?.trim();
    const username = byId('bulkBotUsername')?.value?.trim();
    const role = byId('bulkPresetRole')?.value || 'worker';
    const mode = byId('bulkBotMode')?.value || 'hybrid';
    const host = byId('botAddServerHost')?.value?.trim();
    const portValue = Number(byId('botAddServerPort')?.value || 0);

    if (!id || !username) {
      showToast('Bot ID とユーザー名を入力してください', 'error');
      return;
    }

    const payload = {
      id,
      username,
      role,
      behavior: { mode },
      memoryFile: `memory-${id}.json`
    };

    if (host) {
      payload.java = {
        host,
        port: portValue > 0 ? portValue : 25565
      };
    }

    send('command:fleet-add-bot', payload);
  });

  byId('fleetRemoveButton')?.addEventListener('click', () => {
    const id = byId('removeFleetBotId')?.value?.trim() || byId('fleetBotId')?.value?.trim() || selectedTargetBotId();
    if (!id) {
      showToast('削除する Bot ID を入力してください', 'error');
      return;
    }

    send('command:fleet-remove-bot', { id });
  });

  byId('fleetRoleUpdateButton')?.addEventListener('click', () => {
    const id = byId('updateRoleBotId')?.value?.trim() || byId('fleetBotId')?.value?.trim() || selectedTargetBotId();
    const role = byId('updateRoleValue')?.value || byId('fleetBotRole')?.value || 'worker';
    if (!id) {
      showToast('役割変更する Bot ID を入力してください', 'error');
      return;
    }

    send('command:fleet-update-role', { id, role });
  });

  byId('bulkActionButton')?.addEventListener('click', () => {
    const actionType = byId('bulkActionType')?.value;
    const paramRaw = byId('bulkActionParam')?.value?.trim();
    const targetBotIds = parseCsvIds(byId('bulkTargetBotIds')?.value);
    if (!actionType) {
      showToast('一括操作を選択してください', 'error');
      return;
    }

    let param = paramRaw;
    if (actionType === 'start-task') {
      param = {
        taskType: paramRaw || 'mine',
        blockName: byId('bulkTaskBlockName')?.value?.trim(),
        itemName: byId('bulkTaskItemName')?.value?.trim(),
        playerName: byId('bulkTaskPlayerName')?.value?.trim(),
        count: Number(byId('bulkTaskCount')?.value || 1)
      };
    }

    send('command:bulk-action', { actionType, param, targetBotIds });
  });

  byId('orchestratorAssignButton')?.addEventListener('click', () => send('command:orchestrator-assign-task', {
    type: byId('orchestratorTaskType')?.value,
    role: byId('orchestratorRole')?.value || 'worker',
    blockName: byId('orchestratorBlockName')?.value,
    itemName: byId('orchestratorItemName')?.value,
    playerName: byId('orchestratorPlayerName')?.value,
    count: Number(byId('orchestratorCount')?.value || 1)
  }));

  // 概要タブのクイックスタートボタン（サーバータブと共通処理）
  function startJavaServer() {
    if (els.javaServerProgressText) {
      els.javaServerProgressText.textContent = 'サーバーを起動中...';
      els.javaServerProgressText.style.display = '';
    }
    if (els.overviewJavaProgressText) {
      els.overviewJavaProgressText.textContent = 'サーバーを起動中...';
    }
    send('command:java-server-start', null);
  }

  function connectDefaultBot() {
    const role = byId('localBotRole')?.value || 'primary';
    send('command:bot-connect-local', { role });
  }

  byId('overviewJavaStartButton')?.addEventListener('click', startJavaServer);
  byId('overviewJavaStopButton')?.addEventListener('click', () => send('command:java-server-stop', null));
  byId('overviewConnectBotButton')?.addEventListener('click', connectDefaultBot);

  byId('javaServerStartButton')?.addEventListener('click', startJavaServer);

  byId('javaServerStopButton')?.addEventListener('click', () => {
    send('command:java-server-stop', null);
  });

  byId('javaServerStatusButton')?.addEventListener('click', () => {
    send('command:java-server-status');
  });

  byId('connectLocalBotButton')?.addEventListener('click', () => {
    const username = byId('localBotUsername')?.value?.trim() || '';
    const role = byId('localBotRole')?.value || 'primary';
    const payload = { role };
    if (username) {
      payload.username = username;
      payload.id = username;
    }
    send('command:bot-connect-local', payload);
  });

  // 定期的にJavaサーバー状態を確認（30秒ごと）
  setInterval(() => {
    if (socket?.connected) {
      send('command:java-server-status');
    }
  }, 30_000);

  byId('extConnectButton')?.addEventListener('click', () => {
    const host = byId('extServerHost')?.value?.trim();
    const username = byId('extBotUsername')?.value?.trim();
    const role = byId('extBotRole')?.value || 'worker';
    const edition = byId('extEdition')?.value || 'java';
    const authType = byId('extAuthType')?.value || 'offline';
    const port = Number(byId('extServerPort')?.value || (edition === 'bedrock' ? 19132 : 25565));

    if (!host || !username) {
      showToast('外部サーバー接続にはホストとユーザー名が必要です', 'error');
      return;
    }

    send('command:external-add-bot', {
      host,
      port,
      username,
      role,
      edition,
      authType
    });
  });

  byId('processRefreshButton')?.addEventListener('click', () => send('command:process-list', null));
  byId('processStartButton')?.addEventListener('click', () => send('command:process-start', els.processSelect?.value));
  byId('processStopButton')?.addEventListener('click', () => send('command:process-stop', els.processSelect?.value));
  byId('processRestartButton')?.addEventListener('click', () => send('command:process-restart', els.processSelect?.value));
  byId('processDeleteButton')?.addEventListener('click', () => send('command:process-delete', els.processSelect?.value));

  byId('logLoadButton')?.addEventListener('click', () => {
    if (els.logView) {
      els.logView.textContent = 'ログ読み込み中...';
    }

    send('command:process-logs', {
      processName: els.logProcessSelect?.value,
      lines: Number(els.logLinesInput?.value || 100)
    });
  });

  byId('logStreamToggleButton')?.addEventListener('click', () => {
    const button = byId('logStreamToggleButton');
    if (!button) {
      return;
    }

    if (!logStreamActive) {
      logStreamActive = true;
      button.textContent = 'ストリーミング: ON';
      button.classList.add('btn-active');
      if (els.logView) {
        els.logView.textContent = 'ストリーミング開始...\n';
      }
      send('stream:logs-start', { processName: els.logProcessSelect?.value });
      return;
    }

    logStreamActive = false;
    button.textContent = 'ストリーミング: OFF';
    button.classList.remove('btn-active');
    send('stream:logs-stop', {});
  });

  byId('logClearButton')?.addEventListener('click', () => {
    if (els.logView) {
      els.logView.textContent = '';
    }
  });

  byId('configLoadButton')?.addEventListener('click', () => send('command:config-get', null));
  byId('configSaveButton')?.addEventListener('click', () => {
    const config = parseJsonEditor();
    if (!config) {
      return;
    }
    send('command:config-save', config);
  });
  byId('configResetButton')?.addEventListener('click', () => send('command:config-get', null));

  byId('systemDoctorButton')?.addEventListener('click', () => {
    if (els.doctorView) {
      els.doctorView.textContent = '診断実行中...';
    }
    send('command:system-doctor', null);
  });
  byId('detectJavaButton')?.addEventListener('click', () => send('command:detect-java', null));
  byId('connectionDiagnoseButton')?.addEventListener('click', () => send('command:connection-diagnose', {
    edition: byId('diagnoseEdition')?.value || undefined,
    javaHost: byId('diagnoseHost')?.value?.trim() || undefined,
    javaPort: Number(byId('diagnosePort')?.value || 0) || undefined,
    bedrockHost: byId('diagnoseHost')?.value?.trim() || undefined,
    bedrockPort: Number(byId('diagnosePort')?.value || 0) || undefined
  }));

  byId('oneclickSetupButton')?.addEventListener('click', () => {
    if (els.oneclickProgress) {
      els.oneclickProgress.value = 0;
    }
    if (els.oneclickProgressText) {
      els.oneclickProgressText.textContent = '準備中...';
    }

    send('command:oneclick-setup-live', {
      syncBedrockSamples: Boolean(byId('oneclickSyncBedrock')?.checked)
    });
  });

  byId('plannerAnalyzeBlueprintButton')?.addEventListener('click', () => send('command:planner-analyze-blueprint', {
    targetBotId: selectedTargetBotId(),
    schemPath: byId('schemPath')?.value
  }));

  els.toggleRefreshButton?.addEventListener('click', () => {
    setAutoRefresh(!autoRefresh);
    send('refresh');
  });

  els.reconnectButton?.addEventListener('click', () => {
    connectSocket();
    setAutoRefresh(autoRefresh);
  });

  bindEnter('searchText', () => send('search-item', els.searchText?.value || ''));
  bindEnter('collectBlock', () => send('command:collect', {
    blockName: byId('collectBlock')?.value,
    targetBotId: selectedTargetBotId()
  }));
  bindEnter('fetchItemName', () => send('command:fetch-item', {
    itemName: byId('fetchItemName')?.value,
    amount: Number(byId('fetchAmount')?.value || 1),
    targetBotId: selectedTargetBotId()
  }));
}

setupTabs();
setupPresetCards();
setupHandlers();
connectSocket();
setAutoRefresh(true);
