const fs = require('fs');
const path = require('path');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const { logger } = require('./logger');

function distanceSq(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

class MemoryStore {
  constructor(config) {
    this.config = config;
    const memoryPath = path.resolve(process.cwd(), config.memory.file);

    if (!fs.existsSync(memoryPath)) {
      fs.writeFileSync(
        memoryPath,
        JSON.stringify({ bases: [], chests: [], deaths: [], history: [] }, null, 2),
        'utf8'
      );
    }

    this.db = new Low(new JSONFile(memoryPath), {
      bases: [],
      chests: [],
      deaths: [],
      history: []
    });
  }

  async init() {
    await this.db.read();
    this.db.data ||= { bases: [], chests: [], deaths: [], history: [] };
  }

  async save() {
    await this.db.write();
  }

  compress() {
    const maxRecords = this.config.memory.maxRecords;

    if (this.db.data.history.length > maxRecords) {
      this.db.data.history = this.db.data.history.slice(-maxRecords);
    }

    if (this.db.data.deaths.length > maxRecords) {
      this.db.data.deaths = this.db.data.deaths.slice(-maxRecords);
    }
  }

  async upsertChest(position, items) {
    const key = `${position.x},${position.y},${position.z}`;
    const now = new Date().toISOString();
    const list = this.db.data.chests;
    const index = list.findIndex((entry) => entry.key === key);
    const snapshot = items.map((item) => ({
      name: item.name,
      count: item.count,
      displayName: item.displayName
    }));

    if (index >= 0) {
      list[index].items = snapshot;
      list[index].updatedAt = now;
      list[index].history ||= [];
      list[index].history.push({ at: now, items: snapshot });
      list[index].history = list[index].history.slice(-this.config.memory.maxHistoryPerChest);
    } else {
      list.push({
        key,
        position,
        items: snapshot,
        createdAt: now,
        updatedAt: now,
        history: [{ at: now, items: snapshot }]
      });
    }

    this.db.data.history.push({ type: 'chest-scan', at: now, key });
    this.compress();
    await this.save();
  }

  findNearestChestWithItem(origin, itemName) {
    const normalized = itemName.toLowerCase();

    return this.db.data.chests
      .filter((chest) => chest.items.some((item) => item.name.toLowerCase().includes(normalized)))
      .map((chest) => ({
        chest,
        score: distanceSq(origin, chest.position)
      }))
      .sort((a, b) => a.score - b.score)[0]?.chest || null;
  }

  searchItems(query) {
    const normalized = query.toLowerCase();
    const result = [];

    for (const chest of this.db.data.chests) {
      for (const item of chest.items) {
        const hit = item.name.toLowerCase().includes(normalized) ||
          item.displayName.toLowerCase().includes(normalized);

        if (hit) {
          result.push({
            chestKey: chest.key,
            position: chest.position,
            item
          });
        }
      }
    }

    return result;
  }

  async addBase(position, name = 'default') {
    const now = new Date().toISOString();
    this.db.data.bases.push({ name, position, createdAt: now });
    this.db.data.history.push({ type: 'base-add', at: now, position, name });
    this.compress();
    await this.save();
  }

  getNearestBase(origin) {
    if (this.db.data.bases.length === 0) {
      return null;
    }

    return this.db.data.bases
      .map((base) => ({ base, score: distanceSq(origin, base.position) }))
      .sort((a, b) => a.score - b.score)[0].base;
  }

  async addDeath(position, reason = '') {
    const now = new Date().toISOString();
    this.db.data.deaths.push({ position, reason, at: now });
    this.db.data.history.push({ type: 'death', at: now, position, reason });
    this.compress();
    await this.save();
  }

  getLastDeath() {
    const deaths = this.db.data.deaths;
    return deaths[deaths.length - 1] || null;
  }

  snapshot() {
    return {
      bases: this.db.data.bases,
      chests: this.db.data.chests,
      deaths: this.db.data.deaths,
      historyCount: this.db.data.history.length
    };
  }
}

module.exports = {
  MemoryStore
};
