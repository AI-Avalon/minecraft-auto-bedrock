const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { BedrockDataService } = require('../src/bedrockDataService');

test('BedrockDataService: レシピ計算ができること', () => {
  const service = new BedrockDataService({
    enabled: true,
    samplesPath: 'test/fixtures/bedrock-samples'
  });

  const req = service.computeBaseRequirements('diamond_sword', 2);
  assert.equal(req.diamond, 4);
  assert.equal(req.stick, 2);
});

test('BedrockDataService: ドロップソース検索ができること', () => {
  const service = new BedrockDataService({
    enabled: true,
    samplesPath: 'test/fixtures/bedrock-samples'
  });

  const sources = service.getLootSources('iron_ingot');
  assert.equal(Array.isArray(sources), true);
  assert.equal(sources.some((x) => x.source.includes('entities/zombie')), true);
});

test('BedrockDataService: 収集計画にmob情報が入ること', () => {
  const service = new BedrockDataService({
    enabled: true,
    samplesPath: 'test/fixtures/bedrock-samples'
  });

  const plan = service.buildGatherPlan('diamond_sword', 1);
  assert.equal(Array.isArray(plan), true);
  assert.equal(plan.length > 0, true);

  const iron = service.buildGatherPlan('iron_ingot', 1);
  assert.equal(iron[0].hints.mobs.includes('zombie'), true);
});
