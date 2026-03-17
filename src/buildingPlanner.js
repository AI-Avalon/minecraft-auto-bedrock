const fs = require('fs');
const path = require('path');
const { Schematic } = require('prismarine-schematic');

function normalizeVersion(version) {
  if (!version || version === false) {
    return '1.21.4';
  }
  return String(version);
}

function normalizeItemName(name = '') {
  return String(name || '').replace(/^minecraft:/, '');
}

function summarizeRequirements(countMap, inventoryCountMap = new Map()) {
  const requirements = [...countMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, required]) => {
      const inInventory = Number(inventoryCountMap.get(name) || 0);
      return {
        itemName: name,
        required,
        inInventory,
        missing: Math.max(0, required - inInventory)
      };
    });

  const missingItems = requirements.filter((x) => x.missing > 0);
  const totalRequired = requirements.reduce((sum, row) => sum + row.required, 0);
  const totalMissing = missingItems.reduce((sum, row) => sum + row.missing, 0);

  return {
    requirements,
    missingItems,
    summary: {
      uniqueBlocks: requirements.length,
      totalRequired,
      totalMissing
    }
  };
}

async function analyzeBlueprintMaterials(filePath, options = {}) {
  const resolved = path.resolve(process.cwd(), String(filePath || ''));
  if (!filePath || !fs.existsSync(resolved)) {
    return { ok: false, reason: 'file-not-found', filePath: resolved };
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!['.schem', '.schematic', '.litematic', '.nbt'].includes(ext)) {
    return {
      ok: false,
      reason: 'unsupported-extension',
      message: '対応拡張子は .schem/.schematic/.litematic/.nbt です。',
      filePath: resolved
    };
  }

  try {
    const version = normalizeVersion(options.minecraftVersion);
    const schematic = await Schematic.read(await fs.promises.readFile(resolved), version);

    const countMap = new Map();
    let totalBlocks = 0;

    await schematic.forEach((block) => {
      if (!block?.name) {
        return;
      }

      const normalizedName = normalizeItemName(block.name);
      if (normalizedName === 'air' || normalizedName === 'cave_air' || normalizedName === 'void_air') {
        return;
      }

      totalBlocks += 1;
      countMap.set(normalizedName, Number(countMap.get(normalizedName) || 0) + 1);
    });

    const inventoryCountMap = new Map();
    for (const item of options.inventory || []) {
      const itemName = normalizeItemName(item?.name || '');
      if (!itemName) {
        continue;
      }
      inventoryCountMap.set(itemName, Number(inventoryCountMap.get(itemName) || 0) + Number(item?.count || 0));
    }

    const summarized = summarizeRequirements(countMap, inventoryCountMap);

    const start = schematic.start?.();
    const end = schematic.end?.();

    return {
      ok: true,
      filePath: resolved,
      version,
      dimensions: {
        width: Number(schematic?.size?.x || 0),
        height: Number(schematic?.size?.y || 0),
        length: Number(schematic?.size?.z || 0),
        start: start ? { x: start.x, y: start.y, z: start.z } : null,
        end: end ? { x: end.x, y: end.y, z: end.z } : null
      },
      totalBlocks,
      ...summarized
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'blueprint-parse-failed',
      message: error?.message || String(error),
      filePath: resolved
    };
  }
}

module.exports = {
  analyzeBlueprintMaterials
};