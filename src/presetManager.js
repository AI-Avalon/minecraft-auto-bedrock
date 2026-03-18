/**
 * Preset Manager
 * 建築・採掘・クラフト・ワークフロー等のプリセット管理
 */

const fs = require('fs');
const path = require('path');

class PresetManager {
  constructor(options = {}) {
    this.presetsDir = options.presetsDir || path.join(process.cwd(), 'presets');
    this.logger = options.logger || console;
    this.presets = {
      building: new Map(),
      mining: new Map(),
      crafting: new Map(),
      workflow: new Map(),
      farming: new Map(),
      exploration: new Map()
    };
    this._ensurePresetsDir();
  }

  /**
   * プリセットディレクトリの作成
   */
  _ensurePresetsDir() {
    const categories = Object.keys(this.presets);
    for (const cat of categories) {
      const dir = path.join(this.presetsDir, cat);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * 建築プリセットの登録
   */
  registerBuildingPreset(name, preset) {
    this.presets.building.set(name, {
      name,
      timestamp: new Date().toISOString(),
      ...preset // { schemPath, description, materials, regions, buildMode, difficulty }
    });
    this._saveToDisk('building', name, preset);
  }

  /**
   * 採掘プリセットの登録
   */
  registerMiningPreset(name, preset) {
    this.presets.mining.set(name, {
      name,
      timestamp: new Date().toISOString(),
      ...preset // { blockTypes, targetCounts, patterns, duration, difficulty }
    });
    this._saveToDisk('mining', name, preset);
  }

  /**
   * クラフトプリセットの登録
   */
  registerCraftingPreset(name, preset) {
    this.presets.crafting.set(name, {
      name,
      timestamp: new Date().toISOString(),
      ...preset // { recipes, targetCounts, ingredients, difficulty }
    });
    this._saveToDisk('crafting', name, preset);
  }

  /**
   * ワークフロープリセット（複数タスク組み合わせ）
   */
  registerWorkflowPreset(name, preset) {
    this.presets.workflow.set(name, {
      name,
      timestamp: new Date().toISOString(),
      ...preset // { tasks, description, estimatedDuration }
    });
    this._saveToDisk('workflow', name, preset);
  }

  /**
   * 農業プリセット
   */
  registerFarmingPreset(name, preset) {
    this.presets.farming.set(name, {
      name,
      timestamp: new Date().toISOString(),
      ...preset // { crops, layout, irrigationType, harvestMode }
    });
    this._saveToDisk('farming', name, preset);
  }

  /**
   * 探索プリセット
   */
  registerExplorationPreset(name, preset) {
    this.presets.exploration.set(name, {
      name,
      timestamp: new Date().toISOString(),
      ...preset // { searchPattern, searchRadius, targetBlocks, duration }
    });
    this._saveToDisk('exploration', name, preset);
  }

  /**
   * プリセット取得
   */
  getPreset(category, name) {
    if (!this.presets[category]) {
      throw new Error(`Unknown category: ${category}`);
    }
    return this.presets[category].get(name);
  }

  /**
   * カテゴリ内の全プリセット取得
   */
  listPresets(category) {
    if (!this.presets[category]) {
      throw new Error(`Unknown category: ${category}`);
    }
    return Array.from(this.presets[category].values());
  }

  /**
   * 全カテゴリ全プリセット取得
   */
  listAllPresets() {
    const result = {};
    for (const [category, map] of Object.entries(this.presets)) {
      result[category] = Array.from(map.values());
    }
    return result;
  }

  /**
   * プリセット削除
   */
  deletePreset(category, name) {
    if (!this.presets[category]) {
      throw new Error(`Unknown category: ${category}`);
    }
    this.presets[category].delete(name);
    this._deleteFromDisk(category, name);
  }

  /**
   * ディスクに保存
   */
  _saveToDisk(category, name, preset) {
    const filePath = path.join(this.presetsDir, category, `${name}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(preset, null, 2));
    } catch (error) {
      this.logger.error(`Failed to save preset: ${error.message}`);
    }
  }

  /**
   * ディスクから削除
   */
  _deleteFromDisk(category, name) {
    const filePath = path.join(this.presetsDir, category, `${name}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /**
   * ディスクからプリセット読み込み
   */
  loadPresetsFromDisk() {
    for (const category of Object.keys(this.presets)) {
      const dir = path.join(this.presetsDir, category);
      if (!fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf8');
          const preset = JSON.parse(content);
          const name = path.basename(file, '.json');
          this.presets[category].set(name, preset);
        } catch (error) {
          this.logger.warn(`Failed to load preset ${file}: ${error.message}`);
        }
      }
    }
    this.logger.log('[PresetManager] Presets loaded from disk');
  }

  /**
   * 公式プリセット一覧（デフォルト）
   */
  initializeDefaultPresets() {
    // 建築プリセット
    this.registerBuildingPreset('simple-house', {
      description: 'Simple wooden house',
      schemPath: './presets/schematics/simple-house.schem',
      materials: { 'minecraft:oak_planks': 128, 'minecraft:oak_log': 32 },
      difficulty: 'easy'
    });

    this.registerBuildingPreset('tower', {
      description: 'Stone tower structure',
      schemPath: './presets/schematics/tower.schem',
      materials: { 'minecraft:stone': 256, 'minecraft:stone_stairs': 64 },
      difficulty: 'medium'
    });

    this.registerBuildingPreset('farm-automatic', {
      description: 'Automatic farm with hoppers',
      schemPath: './presets/schematics/auto-farm.litematic',
      materials: {
        'minecraft:oak_wood': 32,
        'minecraft:oak_leaves': 64,
        'minecraft:hopper': 16,
        'minecraft:redstone_wire': 8
      },
      difficulty: 'hard'
    });

    // 採掘プリセット
    this.registerMiningPreset('branch-mining', {
      description: 'Efficient branch mining pattern',
      blockTypes: [
        'minecraft:diamond_ore',
        'minecraft:gold_ore',
        'minecraft:emerald_ore'
      ],
      targetCounts: [64, 32, 16],
      patterns: ['branch', 'branch', 'branch'],
      duration: 60,
      difficulty: 'medium'
    });

    this.registerMiningPreset('stone-gathering', {
      description: 'Quick stone gathering',
      blockTypes: ['minecraft:stone', 'minecraft:deepslate'],
      targetCounts: [512, 256],
      patterns: ['strip', 'strip'],
      duration: 30,
      difficulty: 'easy'
    });

    this.registerMiningPreset('ore-survey', {
      description: 'Survey mining for all ores',
      blockTypes: [
        'minecraft:coal_ore',
        'minecraft:iron_ore',
        'minecraft:gold_ore',
        'minecraft:diamond_ore',
        'minecraft:emerald_ore',
        'minecraft:lapis_ore'
      ],
      targetCounts: [32, 32, 16, 8, 4, 8],
      patterns: ['cave', 'cave', 'cave', 'cave', 'cave', 'cave'],
      duration: 120,
      difficulty: 'hard'
    });

    // クラフトプリセット
    this.registerCraftingPreset('wooden-tools', {
      description: 'Craft basic wooden tools',
      recipes: [
        { item: 'minecraft:wooden_pickaxe', ingredients: ['minecraft:oak_planks', 'minecraft:stick'] },
        { item: 'minecraft:wooden_axe', ingredients: ['minecraft:oak_planks', 'minecraft:stick'] },
        { item: 'minecraft:wooden_sword', ingredients: ['minecraft:oak_planks', 'minecraft:stick'] }
      ],
      targetCounts: [1, 1, 1],
      difficulty: 'easy'
    });

    this.registerCraftingPreset('stone-tools', {
      description: 'Craft stone tools',
      recipes: [
        { item: 'minecraft:stone_pickaxe', ingredients: ['minecraft:stone', 'minecraft:stick'] },
        { item: 'minecraft:stone_axe', ingredients: ['minecraft:stone', 'minecraft:stick'] },
        { item: 'minecraft:stone_sword', ingredients: ['minecraft:stone', 'minecraft:stick'] }
      ],
      targetCounts: [1, 1, 1],
      difficulty: 'easy'
    });

    this.registerCraftingPreset('iron-tools-full', {
      description: 'Craft full iron tool set',
      recipes: [
        { item: 'minecraft:iron_pickaxe', ingredients: ['minecraft:iron_ingot', 'minecraft:stick'] },
        { item: 'minecraft:iron_axe', ingredients: ['minecraft:iron_ingot', 'minecraft:stick'] },
        { item: 'minecraft:iron_sword', ingredients: ['minecraft:iron_ingot', 'minecraft:stick'] },
        { item: 'minecraft:iron_helmet', ingredients: ['minecraft:iron_ingot'] },
        { item: 'minecraft:iron_chestplate', ingredients: ['minecraft:iron_ingot'] },
        { item: 'minecraft:iron_leggings', ingredients: ['minecraft:iron_ingot'] },
        { item: 'minecraft:iron_boots', ingredients: ['minecraft:iron_ingot'] }
      ],
      targetCounts: [1, 1, 1, 1, 1, 1, 1],
      difficulty: 'hard'
    });

    // 農業プリセット
    this.registerFarmingPreset('wheat-farm-simple', {
      description: 'Simple wheat farm',
      crops: ['minecraft:wheat'],
      layout: '16x8',
      irrigationType: 'channels',
      harvestMode: 'auto'
    });

    this.registerFarmingPreset('multi-crop-farm', {
      description: 'Multi-crop farm with different layouts',
      crops: [
        'minecraft:wheat',
        'minecraft:carrot',
        'minecraft:potato',
        'minecraft:beetroot'
      ],
      layout: '32x16',
      irrigationType: 'channels',
      harvestMode: 'auto'
    });

    // ワークフロープリセット
    this.registerWorkflowPreset('newbie-starter', {
      description: 'Complete starter workflow',
      tasks: [
        { type: 'crafting', preset: 'wooden-tools' },
        { type: 'mining', preset: 'stone-gathering', duration: 30 },
        { type: 'crafting', preset: 'stone-tools' },
        { type: 'building', preset: 'simple-house' }
      ],
      estimatedDuration: 180
    });

    this.registerWorkflowPreset('progression-early', {
      description: 'Early game progression',
      tasks: [
        { type: 'mining', preset: 'stone-gathering' },
        { type: 'crafting', preset: 'stone-tools' },
        { type: 'mining', preset: 'branch-mining', duration: 60 },
        { type: 'crafting', preset: 'iron-tools-full' },
        { type: 'farming', preset: 'wheat-farm-simple' }
      ],
      estimatedDuration: 480
    });

    this.logger.log('[PresetManager] Default presets initialized');
  }
}

module.exports = { PresetManager };
