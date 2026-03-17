class FleetController {
  constructor(entries = []) {
    this.entries = entries;
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
