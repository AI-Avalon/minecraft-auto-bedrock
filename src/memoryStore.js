const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

function distanceSq(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

const DEFAULT_DATA = () => ({ bases: [], chests: [], deaths: [], history: [] });

class MemoryStore {
  constructor(config) {
    this.config = config;
    this.filePath = path.resolve(process.cwd(), config.memory.file);
    this.data = DEFAULT_DATA();

    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    }
  }

  async init() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.data = { ...DEFAULT_DATA(), ...JSON.parse(raw) };
    } catch {
      this.data = DEFAULT_DATA();
    }
  }

  async save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  compress() {
    const max = this.config.memory.maxRecords;
    if (this.data.history.length > max) this.data.history = this.data.history.slice(-max);
    if (this.data.deaths.length > max)  this.data.deaths  = this.data.deaths.slice(-max);
  }

  async upsertChest(position, items) {
    const key = `${position.x},${position.y},${position.z}`;
    const now = new Date().toISOString();
    const list = this.data.chests;
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

    this.data.history.push({ type: 'chest-scan', at: now, key });
    this.compress();
    await this.save();
  }

  findNearestChestWithItem(origin, itemName) {
    const normalized = itemName.toLowerCase();

    return this.data.chests
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

    for (const chest of this.data.chests) {
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
    this.data.bases.push({ name, position, createdAt: now });
    this.data.history.push({ type: 'base-add', at: now, position, name });
    this.compress();
    await this.save();
  }

  getNearestBase(origin) {
    if (this.data.bases.length === 0) return null;

    return this.data.bases
      .map((base) => ({ base, score: distanceSq(origin, base.position) }))
      .sort((a, b) => a.score - b.score)[0].base;
  }

  async addDeath(position, reason = '') {
    const now = new Date().toISOString();
    this.data.deaths.push({ position, reason, at: now });
    this.data.history.push({ type: 'death', at: now, position, reason });
    this.compress();
    await this.save();
  }

  getLastDeath() {
    const deaths = this.data.deaths;
    return deaths[deaths.length - 1] || null;
  }

  snapshot() {
    return {
      bases: this.data.bases,
      chests: this.data.chests,
      deaths: this.data.deaths,
      historyCount: this.data.history.length
    };
  }
}

module.exports = { MemoryStore };
