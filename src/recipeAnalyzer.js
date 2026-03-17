'use strict';
/**
 * recipeAnalyzer.js
 * レシピ解析モジュール
 *
 * 機能:
 *  - minecraft-data から全レシピを取得
 *  - アイテムが作成できるか確認（インベントリと比較）
 *  - クラフトプランの生成（ネスト依存関係を解決）
 *  - 実際のクラフト実行
 *  - 作業台の探索
 *  - 不足素材の解析
 *  - タスク別必要ツールの返却
 *
 * サポートするレシピ種別:
 *  - shaped (形が決まったクラフト)
 *  - shapeless (形のないクラフト)
 *  - smelting (かまど精錬)
 *  - smithing (ネザライトアップグレード)
 */

const { goals } = require('mineflayer-pathfinder');
const { logger } = require('./logger');
const { sleep }  = require('./utils');

// ── タスク別必要ツール定義 ──────────────────────────────────────────────────
const TASK_TOOLS = {
  mining:   ['pickaxe', 'shovel', 'torch'],
  farming:  ['hoe', 'shears', 'bucket'],
  combat:   ['sword', 'bow', 'shield', 'crossbow', 'axe'],
  building: ['pickaxe', 'axe', 'shovel', 'shears'],
  fishing:  ['fishing_rod'],
  cooking:  ['flint_and_steel', 'bucket'],
};

// ── 素材名 → 標準アイテム名のエイリアス ───────────────────────────────────
// プランク系は種類に関わらず「oak_planks」を代表として使う
const ITEM_ALIAS = {
  planks:      'oak_planks',
  log:         'oak_log',
  wood:        'oak_log',
  stone:       'stone',
  iron_ingot:  'iron_ingot',
  gold_ingot:  'gold_ingot',
  diamond:     'diamond',
  netherite_ingot: 'netherite_ingot',
};

// ── かまど精錬レシピ（minecraft-data に含まれないケースの補完用） ───────────
const SMELTING_RECIPES = {
  iron_ingot:   { ingredient: 'raw_iron',    fuel: 'coal', time: 10 },
  gold_ingot:   { ingredient: 'raw_gold',    fuel: 'coal', time: 10 },
  copper_ingot: { ingredient: 'raw_copper',  fuel: 'coal', time: 10 },
  cooked_beef:  { ingredient: 'beef',        fuel: 'coal', time: 10 },
  cooked_porkchop: { ingredient: 'porkchop', fuel: 'coal', time: 10 },
  cooked_chicken:  { ingredient: 'chicken',  fuel: 'coal', time: 10 },
  glass:        { ingredient: 'sand',        fuel: 'coal', time: 10 },
  brick:        { ingredient: 'clay_ball',   fuel: 'coal', time: 10 },
  charcoal:     { ingredient: 'oak_log',     fuel: 'coal', time: 10 },
  smooth_stone: { ingredient: 'stone',       fuel: 'coal', time: 10 },
};

// ── スミシングレシピ（ネザライトアップグレード） ──────────────────────────
const SMITHING_RECIPES = {
  netherite_sword:      { base: 'diamond_sword',      addition: 'netherite_ingot' },
  netherite_pickaxe:    { base: 'diamond_pickaxe',    addition: 'netherite_ingot' },
  netherite_axe:        { base: 'diamond_axe',        addition: 'netherite_ingot' },
  netherite_shovel:     { base: 'diamond_shovel',     addition: 'netherite_ingot' },
  netherite_helmet:     { base: 'diamond_helmet',     addition: 'netherite_ingot' },
  netherite_chestplate: { base: 'diamond_chestplate', addition: 'netherite_ingot' },
  netherite_leggings:   { base: 'diamond_leggings',   addition: 'netherite_ingot' },
  netherite_boots:      { base: 'diamond_boots',      addition: 'netherite_ingot' },
};

class RecipeAnalyzer {
  /**
   * @param {object} bot      - mineflayer bot インスタンス
   * @param {object} memStore - MemoryStore インスタンス
   */
  constructor(bot, memStore) {
    this.bot       = bot;
    this.memStore  = memStore;
    this._mcData   = null;   // minecraft-data（bot 接続後に初期化）
    this._recipes  = null;   // キャッシュされたレシピマップ
  }

  /**
   * minecraft-data を初期化する（bot のバージョンに合わせる）
   * bot.spawn 後に呼び出すこと
   */
  initialize() {
    try {
      const mcData = require('minecraft-data');
      this._mcData  = mcData(this.bot.version);
      // レシピマップを事前構築
      this._buildRecipeMap();
      logger.info(`[RecipeAnalyzer] 初期化完了: バージョン ${this.bot.version}`);
    } catch (e) {
      logger.warn(`[RecipeAnalyzer] 初期化失敗: ${e.message}`);
    }
  }

  /**
   * レシピマップを構築する
   * キー: 出力アイテム名, 値: レシピ配列
   */
  _buildRecipeMap() {
    this._recipes = new Map();

    if (!this._mcData?.recipes) return;

    for (const [itemId, recipeList] of Object.entries(this._mcData.recipes)) {
      const item = this._mcData.items[itemId];
      if (!item) continue;

      const itemName = item.name;
      if (!this._recipes.has(itemName)) {
        this._recipes.set(itemName, []);
      }

      for (const recipe of recipeList) {
        this._recipes.get(itemName).push(this._normalizeRecipe(recipe, item));
      }
    }

    // かまど精錬レシピを追加
    for (const [outputName, smelt] of Object.entries(SMELTING_RECIPES)) {
      if (!this._recipes.has(outputName)) {
        this._recipes.set(outputName, []);
      }
      this._recipes.get(outputName).push({
        type:        'smelting',
        output:      outputName,
        outputCount: 1,
        ingredients: [{ name: smelt.ingredient, count: 1 }],
        fuel:        smelt.fuel,
        needsFurnace: true,
      });
    }

    // スミシングレシピを追加
    for (const [outputName, smith] of Object.entries(SMITHING_RECIPES)) {
      if (!this._recipes.has(outputName)) {
        this._recipes.set(outputName, []);
      }
      this._recipes.get(outputName).push({
        type:        'smithing',
        output:      outputName,
        outputCount: 1,
        ingredients: [
          { name: smith.base,     count: 1 },
          { name: smith.addition, count: 1 },
        ],
        needsSmithingTable: true,
      });
    }

    logger.info(`[RecipeAnalyzer] レシピマップ構築完了: ${this._recipes.size} アイテム`);
  }

  /**
   * minecraft-data のレシピを標準形式に変換する
   * @param {object} recipe - 生のレシピデータ
   * @param {object} item   - 出力アイテム情報
   * @returns {object} 正規化されたレシピ
   */
  _normalizeRecipe(recipe, item) {
    const normalized = {
      type:        recipe.inShape ? 'shaped' : 'shapeless',
      output:      item.name,
      outputCount: recipe.result?.count || 1,
      ingredients: [],
      needsCraftingTable: false,
    };

    // shaped レシピの素材を抽出
    if (recipe.inShape) {
      // 3x3 のグリッドは作業台が必要
      if (recipe.inShape.length > 2 ||
          (recipe.inShape[0] && recipe.inShape[0].length > 2)) {
        normalized.needsCraftingTable = true;
      }

      for (const row of recipe.inShape) {
        for (const ingredient of (row || [])) {
          if (ingredient == null) continue;
          const ingItem = this._mcData.items[ingredient.id || ingredient];
          if (ingItem) {
            const existing = normalized.ingredients.find(i => i.name === ingItem.name);
            if (existing) {
              existing.count += (ingredient.count || 1);
            } else {
              normalized.ingredients.push({
                name:  ingItem.name,
                count: ingredient.count || 1,
              });
            }
          }
        }
      }
    }

    // shapeless レシピの素材を抽出
    if (recipe.ingredients) {
      for (const ingredient of recipe.ingredients) {
        if (ingredient == null) continue;
        const ingItem = this._mcData.items[ingredient.id || ingredient];
        if (ingItem) {
          const existing = normalized.ingredients.find(i => i.name === ingItem.name);
          if (existing) {
            existing.count += (ingredient.count || 1);
          } else {
            normalized.ingredients.push({
              name:  ingItem.name,
              count: ingredient.count || 1,
            });
          }
        }
      }
      // 9スロット以上使う場合は作業台が必要
      if (recipe.ingredients.length > 4) {
        normalized.needsCraftingTable = true;
      }
    }

    return normalized;
  }

  // ── パブリック API ─────────────────────────────────────────────────────────

  /**
   * 指定アイテムの全レシピを返す
   * @param {string} itemName - アイテム名
   * @returns {Array} レシピ配列（見つからない場合は空配列）
   */
  getRecipe(itemName) {
    if (!this._recipes) {
      logger.warn('[RecipeAnalyzer] 未初期化です。initialize() を呼び出してください。');
      return [];
    }
    return this._recipes.get(itemName) || [];
  }

  /**
   * 現在のインベントリで指定アイテムをクラフトできるか確認する
   * @param {string} itemName  - クラフトするアイテム名
   * @param {Array}  inventory - インベントリアイテムの配列（省略時は bot のインベントリ）
   * @returns {boolean} クラフト可能か
   */
  canCraft(itemName, inventory = null) {
    const inv = inventory || this._getInventoryMap();
    const recipes = this.getRecipe(itemName);
    if (recipes.length === 0) return false;

    // いずれかのレシピで作れれば true
    return recipes.some(recipe => this._hasIngredients(recipe.ingredients, inv));
  }

  /**
   * 指定アイテムを N 個作るためのクラフトプランを生成する
   * ネスト依存関係（材料の材料）を再帰的に解決する
   *
   * @param {string} itemName  - 作りたいアイテム名
   * @param {number} count     - 必要な個数
   * @param {Array}  inventory - 現在のインベントリ（省略時は bot のインベントリ）
   * @returns {object} クラフトプラン
   */
  getCraftingPlan(itemName, count = 1, inventory = null) {
    const inv = inventory ? this._arrayToMap(inventory) : this._getInventoryMap();
    const steps  = [];
    const needed = new Map();
    const inInv  = new Map(inv);

    this._resolveDependencies(itemName, count, inInv, needed, steps, new Set());

    return {
      target:    itemName,
      count,
      steps,
      needed:    [...needed.entries()].map(([name, n]) => ({ name, count: n })),
      canCraft:  needed.size === 0,
    };
  }

  /**
   * クラフト依存ツリーを再帰的に解決する
   * @param {string} itemName  - 解決するアイテム名
   * @param {number} count     - 必要数
   * @param {Map}    inventory - 現在の（仮想的な）インベントリ
   * @param {Map}    needed    - 採集が必要なアイテム（出力）
   * @param {Array}  steps     - クラフトステップ（出力）
   * @param {Set}    visiting  - 循環参照防止
   */
  _resolveDependencies(itemName, count, inventory, needed, steps, visiting) {
    if (visiting.has(itemName)) return; // 循環参照を防ぐ

    // インベントリにすでにあるか確認
    const inInv = inventory.get(itemName) || 0;
    if (inInv >= count) {
      inventory.set(itemName, inInv - count);
      return;
    }

    const stillNeeded = count - inInv;
    if (inInv > 0) inventory.set(itemName, 0);

    // レシピを探す
    const recipes = this.getRecipe(itemName);
    if (recipes.length === 0) {
      // レシピがない = 採集が必要
      needed.set(itemName, (needed.get(itemName) || 0) + stillNeeded);
      return;
    }

    // 最初のレシピを使用（shaped > shapeless の優先順）
    const recipe = recipes[0];
    const craftTimes = Math.ceil(stillNeeded / recipe.outputCount);

    visiting.add(itemName);

    // 素材の依存関係を再帰的に解決
    for (const ingredient of recipe.ingredients) {
      this._resolveDependencies(
        ingredient.name,
        ingredient.count * craftTimes,
        inventory,
        needed,
        steps,
        visiting
      );
    }

    visiting.delete(itemName);

    // クラフトステップを追加
    steps.push({
      action:    recipe.type,
      output:    itemName,
      count:     craftTimes * recipe.outputCount,
      craftTimes,
      ingredients: recipe.ingredients.map(i => ({
        name:  i.name,
        count: i.count * craftTimes,
      })),
      needsCraftingTable: recipe.needsCraftingTable || false,
      needsFurnace:       recipe.needsFurnace       || false,
      needsSmithingTable: recipe.needsSmithingTable || false,
    });

    // 仮想インベントリを更新
    inventory.set(itemName, (inventory.get(itemName) || 0) + craftTimes * recipe.outputCount - stillNeeded);
  }

  /**
   * 目標に対して不足している素材を返す
   * @param {string} goalItem  - 作りたいアイテム名
   * @param {Array}  inventory - 現在のインベントリ
   * @returns {Array<{name, count}>} 不足素材一覧
   */
  analyzeMissingMaterials(goalItem, inventory = null) {
    const plan = this.getCraftingPlan(goalItem, 1, inventory);
    return plan.needed;
  }

  /**
   * 実際にアイテムをクラフトする
   * 必要に応じて作業台を探して使用する
   * @param {string} itemName - クラフトするアイテム名
   * @param {number} count    - 作る個数
   * @returns {object} 結果
   */
  async craftItem(itemName, count = 1) {
    if (!this.bot) return { ok: false, reason: 'no-bot' };

    const recipes = this.getRecipe(itemName);
    if (recipes.length === 0) {
      return { ok: false, reason: 'no-recipe', item: itemName };
    }

    const inv = this._getInventoryMap();
    const recipe = recipes.find(r => this._hasIngredients(r.ingredients, inv));

    if (!recipe) {
      const plan = this.getCraftingPlan(itemName, count);
      return {
        ok:     false,
        reason: 'missing-materials',
        item:   itemName,
        needed: plan.needed,
      };
    }

    try {
      // 作業台が必要な場合は近くの作業台を探す
      if (recipe.needsCraftingTable) {
        const table = await this.findCraftingTable();
        if (!table) {
          return { ok: false, reason: 'no-crafting-table', item: itemName };
        }
      }

      // かまどレシピの場合
      if (recipe.type === 'smelting') {
        return await this._smeltItem(recipe, count);
      }

      // 通常クラフト
      const craftResult = await this.bot.craft(
        this._getRecipeObject(recipe),
        count,
        recipe.needsCraftingTable ? await this.findCraftingTable() : null
      );

      logger.info(`[RecipeAnalyzer] クラフト完了: ${itemName} x${count}`);
      return { ok: true, item: itemName, count, result: craftResult };
    } catch (e) {
      logger.warn(`[RecipeAnalyzer] クラフト失敗 (${itemName}): ${e.message}`);
      return { ok: false, reason: e.message, item: itemName };
    }
  }

  /**
   * かまど精錬を実行する
   * @param {object} recipe - 精錬レシピ
   * @param {number} count  - 精錬する個数
   * @returns {object} 結果
   */
  async _smeltItem(recipe, count) {
    // 近くのかまどを探す
    const furnaceBlocks = this.bot.findBlocks({
      matching: (b) => b.name === 'furnace' || b.name === 'blast_furnace' || b.name === 'smoker',
      maxDistance: 16,
      count: 1,
    });

    if (furnaceBlocks.length === 0) {
      return { ok: false, reason: 'no-furnace', item: recipe.output };
    }

    try {
      const goal = new goals.GoalNear(
        furnaceBlocks[0].x, furnaceBlocks[0].y, furnaceBlocks[0].z, 2
      );
      if (this.bot.pathfinder) await this.bot.pathfinder.goto(goal);

      const furnaceBlock = this.bot.blockAt(furnaceBlocks[0]);
      const furnace = await this.bot.openFurnace(furnaceBlock);
      await sleep(500);

      // 素材を投入
      const ingredient = this.bot.inventory.items().find(
        i => i.name === recipe.ingredients[0].name
      );
      if (ingredient) {
        await furnace.putInput(ingredient.type, null, count);
      }

      // 燃料を投入
      const fuel = this.bot.inventory.items().find(i => i.name === 'coal');
      if (fuel) {
        await furnace.putFuel(fuel.type, null, Math.ceil(count / 8));
      }

      furnace.close();
      logger.info(`[RecipeAnalyzer] 精錬開始: ${recipe.output} x${count}`);
      return { ok: true, item: recipe.output, count, smelting: true };
    } catch (e) {
      return { ok: false, reason: e.message, item: recipe.output };
    }
  }

  /**
   * 近くの作業台ブロックを探す
   * @returns {object|null} 作業台ブロック、または null
   */
  async findCraftingTable() {
    const tableBlocks = this.bot.findBlocks({
      matching: (b) => b.name === 'crafting_table',
      maxDistance: 16,
      count: 1,
    });

    if (tableBlocks.length === 0) return null;

    try {
      const goal = new goals.GoalNear(
        tableBlocks[0].x, tableBlocks[0].y, tableBlocks[0].z, 2
      );
      if (this.bot.pathfinder) await this.bot.pathfinder.goto(goal);
      return this.bot.blockAt(tableBlocks[0]);
    } catch (e) {
      logger.debug(`[RecipeAnalyzer] 作業台への移動失敗: ${e.message}`);
      return null;
    }
  }

  /**
   * 指定タスクに必要なツールの一覧を返す
   * @param {string} taskType - タスク種別 ('mining', 'farming', 'combat', 'building')
   * @returns {Array<string>} 必要ツール名の配列
   */
  getToolsNeeded(taskType) {
    return TASK_TOOLS[taskType] || [];
  }

  /**
   * 現在のインベントリで作成できる全アイテムをリストアップする
   * @returns {Array<string>} クラフト可能アイテム名の配列
   */
  getCraftableItems() {
    if (!this._recipes) return [];

    const inv = this._getInventoryMap();
    const craftable = [];

    for (const [itemName] of this._recipes) {
      if (this.canCraft(itemName, inv)) {
        craftable.push(itemName);
      }
    }

    return craftable;
  }

  // ── プライベートヘルパー ──────────────────────────────────────────────────

  /**
   * bot のインベントリを Map<name, count> 形式に変換する
   * @returns {Map<string, number>}
   */
  _getInventoryMap() {
    const map = new Map();
    for (const item of (this.bot.inventory?.items() || [])) {
      map.set(item.name, (map.get(item.name) || 0) + item.count);
    }
    return map;
  }

  /**
   * アイテム配列を Map<name, count> に変換する
   * @param {Array} inventory - [{name, count}] 形式の配列
   * @returns {Map<string, number>}
   */
  _arrayToMap(inventory) {
    const map = new Map();
    for (const item of inventory) {
      map.set(item.name, (map.get(item.name) || 0) + item.count);
    }
    return map;
  }

  /**
   * インベントリマップが素材要件を満たすか確認する
   * @param {Array} ingredients - [{name, count}] 形式
   * @param {Map}   invMap      - インベントリマップ
   * @returns {boolean}
   */
  _hasIngredients(ingredients, invMap) {
    for (const ing of ingredients) {
      // エイリアスを考慮
      const canonical = ITEM_ALIAS[ing.name] || ing.name;
      const have = invMap.get(ing.name) || invMap.get(canonical) || 0;
      if (have < ing.count) return false;
    }
    return true;
  }

  /**
   * 正規化されたレシピから bot.craft() で使える形式に変換する
   * @param {object} recipe - 正規化レシピ
   * @returns {object} bot.craft() 互換オブジェクト
   */
  _getRecipeObject(recipe) {
    // mineflayer の bot.craft は minecraft-data の recipe オブジェクトを必要とする
    // ここでは簡易的に recipe そのものを返す（実際のプロダクションでは
    // minecraft-data の recipe リストから直接取得するのが望ましい）
    if (!this._mcData) return recipe;

    const itemObj = this._mcData.itemsByName[recipe.output];
    if (!itemObj) return recipe;

    const mcRecipes = this._mcData.recipes?.[itemObj.id];
    if (!mcRecipes || mcRecipes.length === 0) return recipe;

    return mcRecipes[0]; // 最初のレシピを返す
  }
}

module.exports = {
  RecipeAnalyzer,
  SMELTING_RECIPES,
  SMITHING_RECIPES,
  TASK_TOOLS,
};
