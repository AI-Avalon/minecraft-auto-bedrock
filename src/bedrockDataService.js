const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

function walkJsonFiles(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) {
    return out;
  }

  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        out.push(full);
      }
    }
  }
  return out;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function toItemId(raw) {
  if (!raw) {
    return null;
  }
  return String(raw).replace(/^minecraft:/, '').toLowerCase();
}

class BedrockDataService {
  constructor(config = {}) {
    this.config = {
      enabled: true,
      samplesPath: 'data/bedrock-samples',
      ...config
    };

    this.ready = false;
    this.recipesByOutput = new Map();
    this.lootBySource = new Map();
    this.sourcesByDrop = new Map();
  }

  resolveBaseDir() {
    return path.resolve(process.cwd(), this.config.samplesPath);
  }

  load() {
    if (this.ready) {
      return;
    }

    const baseDir = this.resolveBaseDir();
    const recipeRoot = path.join(baseDir, 'behavior_pack', 'recipes');
    const lootRoot = path.join(baseDir, 'behavior_pack', 'loot_tables');

    this.loadRecipes(recipeRoot);
    this.loadLootTables(lootRoot);

    this.ready = true;
    logger.info(`Bedrockデータをロード: recipes=${this.recipesByOutput.size}, drops=${this.sourcesByDrop.size}`);
  }

  loadRecipes(recipeRoot) {
    const files = walkJsonFiles(recipeRoot);

    for (const filePath of files) {
      const json = safeReadJson(filePath);
      if (!json || typeof json !== 'object') {
        continue;
      }

      const keys = Object.keys(json).filter((k) => k.startsWith('minecraft:recipe_'));
      for (const key of keys) {
        const payload = json[key] || {};
        const parsed = this.parseRecipePayload(key, payload, filePath);
        if (!parsed || !parsed.output?.item) {
          continue;
        }

        const output = parsed.output.item;
        const list = this.recipesByOutput.get(output) || [];
        list.push(parsed);
        this.recipesByOutput.set(output, list);
      }
    }
  }

  parseRecipePayload(type, payload, filePath) {
    const resultRaw = payload.result || payload.results;
    const output = this.normalizeResult(resultRaw);
    if (!output) {
      return null;
    }

    const ingredients = [];

    if (type.includes('shaped')) {
      const key = payload.key || {};
      const pattern = Array.isArray(payload.pattern) ? payload.pattern : [];
      const counts = new Map();
      for (const row of pattern) {
        for (const symbol of String(row).split('')) {
          if (symbol === ' ' || !key[symbol]) {
            continue;
          }
          const item = this.normalizeIngredient(key[symbol]);
          if (!item) {
            continue;
          }
          const current = counts.get(item) || 0;
          counts.set(item, current + 1);
        }
      }
      for (const [item, count] of counts.entries()) {
        ingredients.push({ item, count });
      }
    } else if (type.includes('shapeless') || type.includes('furnace') || type.includes('smithing')) {
      const list = [];
      if (Array.isArray(payload.ingredients)) {
        list.push(...payload.ingredients);
      }
      if (payload.input) {
        list.push(payload.input);
      }
      if (payload.base) {
        list.push(payload.base);
      }
      if (payload.addition) {
        list.push(payload.addition);
      }

      const counts = new Map();
      for (const raw of list) {
        const item = this.normalizeIngredient(raw);
        if (!item) {
          continue;
        }
        counts.set(item, (counts.get(item) || 0) + 1);
      }
      for (const [item, count] of counts.entries()) {
        ingredients.push({ item, count });
      }
    }

    return {
      type,
      output,
      ingredients,
      sourceFile: filePath
    };
  }

  normalizeResult(resultRaw) {
    if (!resultRaw) {
      return null;
    }

    if (Array.isArray(resultRaw)) {
      const first = resultRaw[0];
      if (!first) {
        return null;
      }
      return {
        item: toItemId(first.item || first.name),
        count: Number(first.count || 1)
      };
    }

    return {
      item: toItemId(resultRaw.item || resultRaw.name),
      count: Number(resultRaw.count || 1)
    };
  }

  normalizeIngredient(raw) {
    if (!raw) {
      return null;
    }

    if (typeof raw === 'string') {
      return toItemId(raw);
    }

    if (Array.isArray(raw)) {
      return this.normalizeIngredient(raw[0]);
    }

    return toItemId(raw.item || raw.name);
  }

  loadLootTables(lootRoot) {
    const files = walkJsonFiles(lootRoot);

    for (const filePath of files) {
      const json = safeReadJson(filePath);
      if (!json || !Array.isArray(json.pools)) {
        continue;
      }

      const rel = path.relative(lootRoot, filePath).replace(/\\/g, '/');
      const source = rel.replace(/\.json$/i, '');
      const drops = new Set();

      for (const pool of json.pools) {
        const entries = Array.isArray(pool.entries) ? pool.entries : [];
        for (const entry of entries) {
          const item = toItemId(entry.name);
          if (!item) {
            continue;
          }
          drops.add(item);
          const arr = this.sourcesByDrop.get(item) || [];
          arr.push({ source, chance: pool?.tiers ? 'tiered' : 'unknown' });
          this.sourcesByDrop.set(item, arr);
        }
      }

      this.lootBySource.set(source, [...drops]);
    }
  }

  getRecipeOptions(itemId) {
    this.load();
    const id = toItemId(itemId);
    return this.recipesByOutput.get(id) || [];
  }

  getLootSources(itemId) {
    this.load();
    const id = toItemId(itemId);
    return this.sourcesByDrop.get(id) || [];
  }

  computeBaseRequirements(itemId, count = 1, depth = 0, maxDepth = 6) {
    this.load();
    const id = toItemId(itemId);
    const need = Math.max(1, Number(count || 1));

    if (depth >= maxDepth) {
      return { [id]: need };
    }

    const recipes = this.getRecipeOptions(id);
    if (recipes.length === 0) {
      return { [id]: need };
    }

    const chosen = recipes[0];
    const outCount = Math.max(1, Number(chosen.output.count || 1));
    const batch = Math.ceil(need / outCount);

    const merged = {};
    for (const ing of chosen.ingredients) {
      const subNeed = batch * Math.max(1, Number(ing.count || 1));
      const sub = this.computeBaseRequirements(ing.item, subNeed, depth + 1, maxDepth);
      for (const [k, v] of Object.entries(sub)) {
        merged[k] = (merged[k] || 0) + v;
      }
    }

    return merged;
  }

  buildGatherPlan(itemId, count = 1) {
    const requirements = this.computeBaseRequirements(itemId, count);
    const plan = [];

    for (const [item, amount] of Object.entries(requirements)) {
      const sources = this.getLootSources(item);
      const sourceNames = sources.slice(0, 6).map((x) => x.source);
      const mobSources = sourceNames.filter((s) => s.startsWith('entities/'));
      const blockSources = sourceNames.filter((s) => s.startsWith('blocks/'));

      plan.push({
        item,
        amount,
        sources: sourceNames,
        hints: {
          mobs: mobSources.map((x) => x.replace('entities/', '')),
          blocks: blockSources.map((x) => x.replace('blocks/', ''))
        }
      });
    }

    return plan.sort((a, b) => b.amount - a.amount);
  }
}

module.exports = {
  BedrockDataService
};
