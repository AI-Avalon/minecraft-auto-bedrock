const socket = io();

const modeBadge = document.getElementById('modeBadge');
const statusView = document.getElementById('statusView');
const inventoryList = document.getElementById('inventoryList');
const memoryView = document.getElementById('memoryView');
const searchText = document.getElementById('searchText');
const searchButton = document.getElementById('searchButton');
const searchResult = document.getElementById('searchResult');
const commandResult = document.getElementById('commandResult');

const baseName = document.getElementById('baseName');
const setBaseButton = document.getElementById('setBaseButton');
const collectBlock = document.getElementById('collectBlock');
const collectButton = document.getElementById('collectButton');
const schemPath = document.getElementById('schemPath');
const buildButton = document.getElementById('buildButton');

function renderStatus(payload) {
  modeBadge.textContent = `MODE: ${payload.mode.toUpperCase()}`;
  statusView.textContent = JSON.stringify(payload.status, null, 2);
  memoryView.textContent = JSON.stringify(payload.memory, null, 2);

  inventoryList.innerHTML = '';
  for (const item of payload.status.inventory || []) {
    const li = document.createElement('li');
    li.textContent = `${item.displayName} x${item.count}`;
    inventoryList.appendChild(li);
  }
}

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
  commandResult.textContent = JSON.stringify(result, null, 2);
  socket.emit('refresh');
});

searchButton.addEventListener('click', () => {
  socket.emit('search-item', searchText.value);
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

setInterval(() => {
  socket.emit('refresh');
}, 3000);
