const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { analyzeBlueprintMaterials } = require('../src/buildingPlanner');

test('building planner: schem を解析できること', { timeout: 20_000 }, async () => {
  const filePath = path.resolve(process.cwd(), 'node_modules/prismarine-schematic/test/schematics/smallhouse1.schem');
  const result = await analyzeBlueprintMaterials(filePath, {
    minecraftVersion: '1.21.4',
    inventory: [{ name: 'oak_planks', count: 128 }]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.totalBlocks > 0, true);
  assert.equal(Array.isArray(result.requirements), true);
  assert.equal(typeof result.summary.totalMissing, 'number');
});

test('building planner: 非対応拡張子はエラーになること', async () => {
  const result = await analyzeBlueprintMaterials('README.md');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported-extension');
});
