class FleetController {
  constructor(entries = [], options = {}) {
    this.entries = entries;
    this.options = options;
  }

  get primaryEntry() {
    return this.entries[0] || null;
  }

  get bot() {
    return this.primaryEntry?.controller?.bot || null;
  }

  status() {
    const primary = this.primaryEntry?.controller?.status?.() || {
      connected: false,
      username: 'none',
      edition: 'unknown'
    };

    return {
      ...primary,
      fleet: this.entries.map((entry) => ({
        id: entry.id,
        role: entry.role,
        status: entry.controller.status()
      }))
    };
  }

  statusAll() {
    return this.entries.map((entry) => ({
      id: entry.id,
      role: entry.role,
      status: entry.controller.status()
    }));
  }

  targetController(targetBotId) {
    if (!targetBotId) {
      return this.primaryEntry?.controller || null;
    }

    const hit = this.entries.find((entry) => entry.id === targetBotId);
    return hit?.controller || null;
  }

  async runOnTarget(targetBotId, fnName, ...args) {
    const target = this.targetController(targetBotId);
    if (!target || typeof target[fnName] !== 'function') {
      throw new Error(`target bot が見つからないか操作未対応です: ${targetBotId || 'primary'} / ${fnName}`);
    }

    return target[fnName](...args);
  }

  async setBaseHere(name, targetBotId) {
    return this.runOnTarget(targetBotId, 'setBaseHere', name);
  }

  async collectNearestBlock(blockName, targetBotId) {
    return this.runOnTarget(targetBotId, 'collectNearestBlock', blockName);
  }

  async buildSchem(schemPath, targetBotId) {
    return this.runOnTarget(targetBotId, 'buildSchem', schemPath);
  }

  async autoBuildWithRefill(schemPath, requiredItems, targetBotId) {
    return this.runOnTarget(targetBotId, 'autoBuildWithRefill', schemPath, requiredItems);
  }

  async startAutoCollect(blockName, targetCount, targetBotId) {
    return this.runOnTarget(targetBotId, 'startAutoCollect', blockName, targetCount);
  }

  async stopAutoCollect(targetBotId) {
    return this.runOnTarget(targetBotId, 'stopAutoCollect');
  }

  async startAutoMine(targetBotId) {
    return this.runOnTarget(targetBotId, 'startAutoMine');
  }

  async stopAutoMine(targetBotId) {
    return this.runOnTarget(targetBotId, 'stopAutoMine');
  }

  async fetchItemFromMemory(itemName, amount, targetBotId) {
    return this.runOnTarget(targetBotId, 'fetchItemFromMemory', itemName, amount);
  }

  async retreatNow(targetBotId) {
    return this.runOnTarget(targetBotId, 'retreatNow');
  }

  async stopAll() {
    for (const entry of this.entries) {
      // eslint-disable-next-line no-await-in-loop
      await entry.controller.stop();
    }
  }

  async addBot(spec = {}) {
    if (typeof this.options.createEntryFromSpec !== 'function') {
      throw new Error('このFleetControllerは動的追加に未対応です。');
    }

    const id = spec.id || spec.username;
    if (!id) {
      throw new Error('id または username が必要です。');
    }

    if (this.entries.some((x) => x.id === id)) {
      throw new Error(`同じ id の Bot が既に存在します: ${id}`);
    }

    const entry = await this.options.createEntryFromSpec(spec);
    this.entries.push(entry);
    return { ok: true, id: entry.id, role: entry.role };
  }

  async removeBot(id) {
    const index = this.entries.findIndex((x) => x.id === id);
    if (index < 0) {
      return { ok: false, reason: 'not-found' };
    }

    const [entry] = this.entries.splice(index, 1);
    await entry.controller.stop();
    return { ok: true, id: entry.id };
  }

  updateRole(id, role) {
    const entry = this.entries.find((x) => x.id === id);
    if (!entry) {
      return { ok: false, reason: 'not-found' };
    }

    entry.role = String(role || 'worker');
    return { ok: true, id: entry.id, role: entry.role };
  }

  async assignTask(task = {}) {
    const role = task.role || 'worker';
    const target = task.targetBotId
      ? this.entries.find((x) => x.id === task.targetBotId)
      : this.entries.find((x) => x.role === role) || this.primaryEntry;

    if (!target) {
      return { ok: false, reason: 'target-not-found' };
    }

    const type = String(task.type || '').toLowerCase();
    if (type === 'mine') {
      const result = await target.controller.startAutoCollect(task.blockName, Number(task.count || 32));
      return { ok: true, assignedTo: target.id, result };
    }

    if (type === 'fight-mob') {
      const result = target.controller.fightNearestMob();
      return { ok: true, assignedTo: target.id, result };
    }

    if (type === 'fight-player') {
      const result = target.controller.fightPlayer(task.playerName);
      return { ok: true, assignedTo: target.id, result };
    }

    if (type === 'gather') {
      const result = await target.controller.gatherForCraft(task.itemName, Number(task.count || 1));
      return { ok: true, assignedTo: target.id, result };
    }

    return { ok: false, reason: 'unknown-task-type' };
  }
}

class FleetMemoryStore {
  constructor(entries = []) {
    this.entries = entries;
  }

  snapshot() {
    return {
      fleet: this.entries.map((entry) => ({
        id: entry.id,
        role: entry.role,
        memory: entry.memoryStore.snapshot()
      }))
    };
  }

  searchItems(query) {
    const q = String(query || '').trim();
    const rows = [];

    for (const entry of this.entries) {
      const hit = entry.memoryStore.searchItems(q).map((row) => ({
        ...row,
        botId: entry.id,
        chestKey: `${entry.id}:${row.chestKey}`
      }));
      rows.push(...hit);
    }

    return rows;
  }
}

module.exports = {
  FleetController,
  FleetMemoryStore
};
