/**
 * Integrated Building Workflow Manager
 * Litematica読み込み → 材料計算 → 採掘/クラフト → 建築まで全自動化
 */

const { LitematicaLoader } = require('./litematicaLoader');

class IntegratedBuildingManager {
  constructor(fleetController, buildingPlanner, recipeAnalyzer, options = {}) {
    this.fleet = fleetController;
    this.buildingPlanner = buildingPlanner;
    this.recipeAnalyzer = recipeAnalyzer;
    this.litematicaLoader = new LitematicaLoader();
    this.logger = options.logger || console;
  }

  /**
   * Litematicaファイルから完全な建築ワークフロー実行
   * @param {string} litematicaPath - .litファイルパス
   * @param {object} options - { botAssignments, gatherMode, craftingMode, buildMode }
   */
  async executeCompleteWorkflow(litematicaPath, options = {}) {
    try {
      this.logger.log(`[IntegratedBuilding] Starting complete workflow for ${litematicaPath}`);

      // Step 1: Litematica読み込み
      const schematic = await this.litematicaLoader.loadLitematicaFile(litematicaPath);
      this.logger.log('[IntegratedBuilding] Schematic loaded');

      // Step 2: 材料計算
      const materials = await this.litematicaLoader.extractMaterials(litematicaPath);
      this.logger.log('[IntegratedBuilding] Materials extracted:', Object.keys(materials).length, 'types');

      // Step 3: 必要な材料からレシピ分析
      const requiredRecipes = this.recipeAnalyzer.analyzeRequirements(materials);
      this.logger.log('[IntegratedBuilding] Recipes analyzed:', requiredRecipes.length);

      // Step 4: 採掘タスク生成（既存材料ではなく採掘が必要なもの）
      const miningTasks = this._generateMiningTasks(
        materials,
        options.botAssignments || [],
        options.gatherMode || 'auto-mine'
      );

      // Step 5: クラフトタスク生成
      const craftingTasks = this._generateCraftingTasks(requiredRecipes);

      // Step 6: 建築タスク生成
      const buildingTasks = this._generateBuildingTasks(
        schematic,
        litematicaPath,
        options.botAssignments || [],
        options.buildMode || 'efficient'
      );

      // Step 7: ワークフロー統合
      const fullWorkflow = this._integrateWorkflow({
        phase1: { name: 'gather', tasks: miningTasks },
        phase2: { name: 'craft', tasks: craftingTasks },
        phase3: { name: 'build', tasks: buildingTasks }
      });

      return {
        schematic,
        materials,
        recipes: requiredRecipes,
        workflow: fullWorkflow,
        estimatedTime: this._estimateWorkflowTime(fullWorkflow)
      };
    } catch (error) {
      this.logger.error(`[IntegratedBuilding] Workflow failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 材料リストから採掘タスク生成
   */
  _generateMiningTasks(materials, botAssignments, mode) {
    const tasks = [];
    let botIndex = 0;

    for (const [blockType, count] of Object.entries(materials)) {
      const targetBot = botAssignments[botIndex % botAssignments.length] || 'primary';
      
      tasks.push({
        botId: targetBot,
        phase: 'gather',
        command: 'auto-mine',
        params: {
          blockType,
          targetCount: count,
          mode: mode
        },
        priority: this._calculatePriority(blockType)
      });

      botIndex++;
    }

    return tasks.sort((a, b) => b.priority - a.priority);
  }

  /**
   * レシピからクラフトタスク生成
   */
  _generateCraftingTasks(recipes) {
    const tasks = [];

    for (const recipe of recipes) {
      tasks.push({
        botId: 'primary', // クラフトはプライマリボットが実行
        phase: 'craft',
        command: 'craft-item',
        params: {
          item: recipe.output,
          ingredients: recipe.inputs,
          count: recipe.count
        }
      });
    }

    return tasks;
  }

  /**
   * スキーマティックから建築タスク生成
   */
  _generateBuildingTasks(schematic, path, botAssignments, buildMode) {
    const tasks = [];

    if (botAssignments.length === 0) {
      // 単一ボット建築
      tasks.push({
        botId: 'primary',
        phase: 'build',
        command: 'build-schematic',
        params: {
          schemPath: path,
          buildMode: buildMode,
          parallel: false
        }
      });
    } else {
      // マルチボット建築（リージョン分割）
      const regions = this._divideSchematicRegions(
        schematic.metadata,
        botAssignments.length
      );

      for (let i = 0; i < botAssignments.length; i++) {
        tasks.push({
          botId: botAssignments[i],
          phase: 'build',
          command: 'build-region',
          params: {
            schemPath: path,
            region: regions[i],
            buildMode: buildMode
          }
        });
      }
    }

    return tasks;
  }

  /**
   * スキーマティックを複数リージョンに分割
   */
  _divideSchematicRegions(metadata, numRegions) {
    const regions = [];
    const width = metadata.width;
    const height = metadata.height;
    const length = metadata.length;

    // 単純な3次元均等分割
    const regionsPerSide = Math.ceil(Math.cbrt(numRegions));
    
    for (let x = 0; x < regionsPerSide; x++) {
      for (let z = 0; z < regionsPerSide; z++) {
        if (regions.length >= numRegions) break;

        const x1 = (x * width) / regionsPerSide;
        const z1 = (z * length) / regionsPerSide;
        const x2 = ((x + 1) * width) / regionsPerSide;
        const z2 = ((z + 1) * length) / regionsPerSide;

        regions.push({
          x: Math.floor(x1),
          y: 0,
          z: Math.floor(z1),
          x2: Math.floor(x2),
          y2: height,
          z2: Math.floor(z2)
        });
      }
    }

    return regions.slice(0, numRegions);
  }

  /**
   * ブロック優先度計算
   */
  _calculatePriority(blockType) {
    // ダイアモンド > ゴールド > 鉄 > 石 > 木 などの優先度
    const priorities = {
      'minecraft:diamond_ore': 100,
      'minecraft:emerald_ore': 95,
      'minecraft:gold_ore': 80,
      'minecraft:iron_ore': 70,
      'minecraft:stone': 30,
      'minecraft:oak_log': 20
    };

    return priorities[blockType] || 50;
  }

  /**
   * ワークフロー統合（順序制約の追加）
   */
  _integrateWorkflow(phases) {
    const workflow = [];

    // Phase 1: 採掘を並列実行
    if (phases.phase1.tasks.length > 0) {
      workflow.push({
        phase: 'phase1-gather',
        tasks: phases.phase1.tasks,
        parallel: true,
        waitForCompletion: true
      });
    }

    // Phase 2: クラフトを順序実行
    if (phases.phase2.tasks.length > 0) {
      workflow.push({
        phase: 'phase2-craft',
        tasks: phases.phase2.tasks,
        parallel: false,
        waitForCompletion: true
      });
    }

    // Phase 3: 建築を実行（マルチボット並列可）
    if (phases.phase3.tasks.length > 0) {
      workflow.push({
        phase: 'phase3-build',
        tasks: phases.phase3.tasks,
        parallel: phases.phase3.tasks.length > 1,
        waitForCompletion: true
      });
    }

    return workflow;
  }

  /**
   * ワークフロー実行時間の推定
   */
  _estimateWorkflowTime(workflow) {
    let totalMinutes = 0;

    for (const phase of workflow) {
      let phaseTime = 0;

      if (phase.parallel) {
        // 並列実行は最大タスク時間
        phaseTime = Math.max(...phase.tasks.map(t => this._estimateTaskTime(t)));
      } else {
        // 順序実行は合計時間
        phaseTime = phase.tasks.reduce((sum, t) => sum + this._estimateTaskTime(t), 0);
      }

      totalMinutes += phaseTime;
    }

    return Math.ceil(totalMinutes);
  }

  /**
   * タスク実行時間推定
   */
  _estimateTaskTime(task) {
    const estimates = {
      'auto-mine': (params) => (params.targetCount || 64) / 10, // ブロック/分
      'craft-item': (params) => (params.count || 1) * 0.5,
      'build-region': (params) => 30, // 地域あたり30分
      'build-schematic': (params) => 60
    };

    const estimator = estimates[task.command] || (() => 10);
    return estimator(task.params || {});
  }

  /**
   * Litematicaディレクトリから複数スキーマティック一括処理
   */
  async processBuildingLibrary(directory, options = {}) {
    try {
      const schematics = await this.litematicaLoader.loadFromDirectory(directory);

      const results = [];
      for (const item of schematics) {
        try {
          const workflow = await this.executeCompleteWorkflow(item.path, options);
          results.push({
            filename: item.filename,
            status: 'ready',
            workflow
          });
        } catch (error) {
          results.push({
            filename: item.filename,
            status: 'error',
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      this.logger.error(`[IntegratedBuilding] Library processing failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * キャッシュされた建築プラン一覧
   */
  getAvailablePlans() {
    // TODO: ディスクまたはメモリにキャッシュされたプランを返す
    return [];
  }
}

module.exports = { IntegratedBuildingManager };
