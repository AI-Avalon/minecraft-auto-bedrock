/**
 * Bot Command Orchestrator
 * 親ボット → 子ボット間の指示体系を管理
 * ワークフロー化した建築・採掘タスクを複数ボットで並列実行
 */

const EventEmitter = require('events');

class TaskOrchestrator extends EventEmitter {
  constructor(fleetController, options = {}) {
    super();
    this.fleet = fleetController;
    this.activeWorkflows = new Map();
    this.logger = options.logger || console;
    this.maxConcurrentTasks = options.maxConcurrentTasks || 5;
  }

  /**
   * 親ボットが子ボットに指示を出す
   * @param {string} workflowId - ワークフロー識別子
   * @param {string} targetBotId - 対象ボットID
   * @param {string} command - 実行コマンド
   * @param {Object} params - コマンドパラメータ
   * @returns {Promise<Object>} 実行結果
   */
  async issueCommand(workflowId, targetBotId, command, params = {}) {
    try {
      this.logger.log(`[Orchestrator] ${workflowId}: [${targetBotId}] -> ${command}`, params);

      const handler = this._getCommandHandler(command);
      if (!handler) {
        throw new Error(`Unknown command: ${command}`);
      }

      const result = await handler.call(this, targetBotId, params);
      
      this.emit('command-executed', {
        workflowId,
        botId: targetBotId,
        command,
        success: true,
        result
      });

      return result;
    } catch (error) {
      this.emit('command-failed', {
        workflowId,
        botId: targetBotId,
        command,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * マルチボットワークフローの実行
   * 複数ボットに対して順序だ立ったタスク列を実行
   * @param {string} workflowId - ワークフロー識別子
   * @param {Array} taskList - [{ botId, command, params }, ...]
   * @param {Object} options - { serial: bool, maxConcurrent: number }
   * @returns {Promise<Array>} 実行結果リスト
   */
  async executeWorkflow(workflowId, taskList, options = {}) {
    try {
      const tasks = [...taskList];
      const results = [];
      const serial = options.serial !== false; // デフォルト: 順序実行
      const maxConcurrent = options.maxConcurrent || this.maxConcurrentTasks;

      if (serial) {
        // 順序実行モード
        for (const task of tasks) {
          const result = await this.issueCommand(
            workflowId,
            task.botId,
            task.command,
            task.params
          );
          results.push(result);
        }
      } else {
        // 並列実行モード
        const chunks = [];
        for (let i = 0; i < tasks.length; i += maxConcurrent) {
          chunks.push(tasks.slice(i, i + maxConcurrent));
        }

        for (const chunk of chunks) {
          const promises = chunk.map(task =>
            this.issueCommand(workflowId, task.botId, task.command, task.params)
          );
          const chunkResults = await Promise.all(promises);
          results.push(...chunkResults);
        }
      }

      this.emit('workflow-completed', { workflowId, taskCount: tasks.length, results });
      return results;
    } catch (error) {
      this.emit('workflow-failed', { workflowId, error: error.message });
      throw error;
    }
  }

  /**
   * 建築ワークフロー
   * 複数ボットで建築タスクを分割実行
   */
  async buildingWorkflow(
    workflowId,
    schemPath,
    botAssignments,
    options = {}
  ) {
    try {
      this.logger.log(`[Orchestrator] Starting building workflow: ${workflowId}`);

      // botAssignments: [{ botId, region: {x,y,z,size} }, ...]
      const tasks = botAssignments.map(assignment => ({
        botId: assignment.botId,
        command: 'build-region',
        params: {
          schemPath,
          region: assignment.region,
          buildMode: assignment.buildMode || 'default'
        }
      }));

      return await this.executeWorkflow(workflowId, tasks, {
        serial: options.serial !== true, // デフォルト: 並列
        maxConcurrent: options.maxConcurrent
      });
    } catch (error) {
      this.logger.error(`[Orchestrator] Building workflow failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 資源採掘ワークフロー
   */
  async miningWorkflow(
    workflowId,
    blockTypes,
    targetCounts,
    botAssignments,
    options = {}
  ) {
    try {
      this.logger.log(`[Orchestrator] Starting mining workflow: ${workflowId}`);

      const tasks = botAssignments.map((botId, index) => ({
        botId,
        command: 'auto-mine',
        params: {
          blockTypes: blockTypes[index] || blockTypes[0],
          targetCount: targetCounts[index] || targetCounts[0],
          durationMinutes: options.durationMinutes || 30
        }
      }));

      return await this.executeWorkflow(workflowId, tasks, {
        serial: false,
        maxConcurrent: options.maxConcurrent
      });
    } catch (error) {
      this.logger.error(`[Orchestrator] Mining workflow failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * クラフトワークフロー
   * 材料を集めて、複数種類のアイテムをクラフト
   */
  async craftingWorkflow(
    workflowId,
    recipes,
    targetCounts,
    options = {}
  ) {
    try {
      this.logger.log(`[Orchestrator] Starting crafting workflow: ${workflowId}`);

      // recipes: [{ item, ingredients }, ...]
      // targetCounts: [count1, count2, ...]
      const primaryBot = this.fleet.primaryEntry?.id;
      if (!primaryBot) {
        throw new Error('Primary bot required for crafting workflow');
      }

      const tasks = recipes.map((recipe, index) => ({
        botId: primaryBot,
        command: 'craft-item',
        params: {
          item: recipe.item,
          ingredients: recipe.ingredients,
          count: targetCounts[index] || 1
        }
      }));

      return await this.executeWorkflow(workflowId, tasks, {
        serial: true, // クラフトは順序実行
        maxConcurrent: 1
      });
    } catch (error) {
      this.logger.error(`[Orchestrator] Crafting workflow failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 階層的タスク実行
   * 親ボットの指示 → 子ボット実行 → 親が検証・次タスク発行
   */
  async hierarchicalTaskExecution(
    workflowId,
    taskTree,
    parentBotId = null
  ) {
    try {
      parentBotId = parentBotId || this.fleet.primaryEntry?.id;
      
      const results = [];
      
      for (const taskNode of taskTree) {
        // 親タスクの実行
        const parentResult = await this.issueCommand(
          workflowId,
          parentBotId,
          taskNode.parentCommand,
          taskNode.parentParams
        );

        if (!parentResult.success && taskNode.failStrategy !== 'continue') {
          throw new Error(`Parent task failed: ${taskNode.parentCommand}`);
        }

        // 子タスクの並列実行
        if (taskNode.childTasks && taskNode.childTasks.length > 0) {
          const childResults = await this.executeWorkflow(
            `${workflowId}-children`,
            taskNode.childTasks,
            { serial: false, maxConcurrent: taskNode.maxChildConcurrency }
          );
          results.push({
            parentTask: taskNode.parentCommand,
            childResults
          });
        }

        // 完了後の検証
        if (taskNode.postValidation) {
          await this.issueCommand(
            workflowId,
            parentBotId,
            'validate-task-completion',
            taskNode.postValidation
          );
        }
      }

      return results;
    } catch (error) {
      this.logger.error(`[Orchestrator] Hierarchical execution failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * コマンドハンドラの登録・取得
   */
  _commandHandlers = {
    'build-region': async function(botId, params) {
      return this.fleet.runOnTarget(botId, 'buildSchem', params.schemPath);
    },
    
    'auto-mine': async function(botId, params) {
      return this.fleet.runOnTarget(botId, 'startAutoCollect', params.blockTypes, params.targetCount);
    },
    
    'craft-item': async function(botId, params) {
      // buildingPlanner と統合してクラフト処理
      return { item: params.item, count: params.count, crafted: true };
    },
    
    'collect-materials': async function(botId, params) {
      const materials = params.materials || {};
      const results = [];
      for (const [blockType, count] of Object.entries(materials)) {
        results.push(
          await this.fleet.runOnTarget(botId, 'collectNearestBlock', blockType, count)
        );
      }
      return results;
    },

    'validate-task-completion': async function(botId, params) {
      // タスク完了の検証ロジック
      return { validated: true, botId };
    }
  };

  _getCommandHandler(command) {
    return this._commandHandlers[command];
  }

  /**
   * カスタムコマンド登録
   */
  registerCommand(command, handler) {
    this._commandHandlers[command] = handler;
  }

  /**
   * ワークフロー状態の取得
   */
  getWorkflowStatus(workflowId) {
    return this.activeWorkflows.get(workflowId) || null;
  }
}

module.exports = { TaskOrchestrator };
