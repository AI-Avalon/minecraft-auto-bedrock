'use strict';
/**
 * armorAnalyzer.js
 * 防具解析・自動装備モジュール
 *
 * 機能:
 *  - 防具の保護値比較（minecraft-data を使用）
 *  - エンチャント効果の計算
 *    （Protection / Fire Protection / Blast Protection /
 *      Projectile Protection / Unbreaking / Mending）
 *  - 最適な防具セットの選択
 *  - 自動装備
 *  - 防具ギャップの検出
 *  - エリトラの特別処理
 *  - 防具スコアの計算（0〜100）
 *  - アップグレード提案
 *
 * 防具 tier（弱い順）:
 *  leather < chainmail < iron < gold < diamond < netherite
 */

const { logger } = require('./logger');

// ── 防具スロット名 ─────────────────────────────────────────────────────────
const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];

// ── 防具の tier 評価値 ──────────────────────────────────────────────────────
// 数値が大きいほど強い
const ARMOR_TIER = {
  leather:   1,
  chainmail: 2,
  iron:      3,
  gold:      2,         // ゴールドは防御値が低い（エンチャント適性は高い）
  diamond:   5,
  netherite: 6,
  turtle:    3,         // タートルシェルはヘルメット専用
};

// ── スロット別の基本防御値（バニラ値） ─────────────────────────────────────
// キー: "素材_スロット", 値: 防御ポイント
const BASE_DEFENSE = {
  leather_helmet:       1, leather_chestplate:   3, leather_leggings:     2, leather_boots:       1,
  chainmail_helmet:     2, chainmail_chestplate: 5, chainmail_leggings:   4, chainmail_boots:     1,
  iron_helmet:          2, iron_chestplate:      6, iron_leggings:        5, iron_boots:          2,
  gold_helmet:          2, gold_chestplate:      5, gold_leggings:        3, gold_boots:          1,
  diamond_helmet:       3, diamond_chestplate:   8, diamond_leggings:     6, diamond_boots:       3,
  netherite_helmet:     3, netherite_chestplate: 8, netherite_leggings:   6, netherite_boots:     3,
  turtle_helmet:        2,
  elytra:               0,  // 防御なし（飛行用）
};

// ── スロット別の強靭性値（toughness） ─────────────────────────────────────
const BASE_TOUGHNESS = {
  diamond_helmet:       2, diamond_chestplate:   2, diamond_leggings:     2, diamond_boots:       2,
  netherite_helmet:     3, netherite_chestplate: 3, netherite_leggings:   3, netherite_boots:     3,
};

// ── Protection 系エンチャントのダメージ軽減率（最大レベルでの%）─────────────
const ENCHANT_REDUCTION = {
  protection:            { perLevel: 0.04, maxLevel: 4, type: 'all'        },
  fire_protection:       { perLevel: 0.08, maxLevel: 4, type: 'fire'       },
  blast_protection:      { perLevel: 0.08, maxLevel: 4, type: 'blast'      },
  projectile_protection: { perLevel: 0.08, maxLevel: 4, type: 'projectile' },
  feather_falling:       { perLevel: 0.12, maxLevel: 4, type: 'fall'       },
};

// ── 耐久系エンチャントのボーナス係数 ──────────────────────────────────────
const DURABILITY_ENCHANTS = {
  unbreaking: { perLevel: 1, maxLevel: 3 },
  mending:    { bonus: 20,  maxLevel: 1 },
};

class ArmorAnalyzer {
  /**
   * @param {object} bot      - mineflayer bot インスタンス
   * @param {object} memStore - MemoryStore インスタンス
   */
  constructor(bot, memStore) {
    this.bot       = bot;
    this.memStore  = memStore;
    this._mcData   = null;
  }

  /**
   * minecraft-data を初期化する
   * bot.spawn 後に呼び出すこと
   */
  initialize() {
    try {
      const mcData = require('minecraft-data');
      this._mcData = mcData(this.bot.version);
      logger.info('[ArmorAnalyzer] 初期化完了');
    } catch (e) {
      logger.warn(`[ArmorAnalyzer] 初期化失敗: ${e.message}`);
    }
  }

  // ── パブリック API ─────────────────────────────────────────────────────────

  /**
   * 2つの防具アイテムを比較して優劣を返す
   * @param {object} item1 - mineflayer アイテム（または null）
   * @param {object} item2 - mineflayer アイテム（または null）
   * @returns {object} 比較結果 { better: item1|item2|'equal', scoreDiff: number }
   */
  compareArmor(item1, item2) {
    const score1 = item1 ? this._calcItemScore(item1) : 0;
    const score2 = item2 ? this._calcItemScore(item2) : 0;
    const diff   = score1 - score2;

    if (Math.abs(diff) < 0.01) {
      return { better: 'equal', scoreDiff: 0, score1, score2 };
    }

    return {
      better:    diff > 0 ? item1 : item2,
      betterName: diff > 0 ? item1?.name : item2?.name,
      scoreDiff: Math.abs(diff),
      score1,
      score2,
    };
  }

  /**
   * インベントリ内のアイテムから最良の防具セットを選ぶ
   * @param {Array} inventory - mineflayer アイテムの配列（省略時は bot のインベントリ）
   * @returns {object} スロット別の最良アイテム { helmet, chestplate, leggings, boots }
   */
  getBestArmorSet(inventory = null) {
    const items = inventory || this.bot.inventory?.items() || [];
    const result = {};

    for (const slot of ARMOR_SLOTS) {
      // そのスロットに対応するアイテムを全て集める
      const candidates = items.filter(item => {
        if (!item?.name) return false;
        // elytra は chestplate スロット扱いだが別途処理
        if (item.name === 'elytra') return slot === 'chestplate';
        return item.name.endsWith(`_${slot}`) || item.name === `turtle_helmet` && slot === 'helmet';
      });

      if (candidates.length === 0) {
        result[slot] = null;
        continue;
      }

      // スコアが最大のアイテムを選択
      result[slot] = candidates.reduce((best, current) => {
        const bestScore = this._calcItemScore(best);
        const curScore  = this._calcItemScore(current);
        return curScore > bestScore ? current : best;
      });
    }

    return result;
  }

  /**
   * インベントリから最良の防具を自動装備する
   * @returns {object} 装備結果
   */
  async autoEquipBestArmor() {
    const bestSet  = this.getBestArmorSet();
    const equipped = [];
    const skipped  = [];

    for (const [slot, item] of Object.entries(bestSet)) {
      if (!item) {
        skipped.push({ slot, reason: 'no-item' });
        continue;
      }

      // 現在装備している防具と比較
      const currentArmor = this._getCurrentArmorInSlot(slot);
      if (currentArmor) {
        const comparison = this.compareArmor(item, currentArmor);
        if (comparison.better === currentArmor || comparison.better === 'equal') {
          skipped.push({ slot, reason: 'already-best', current: currentArmor.name });
          continue;
        }
      }

      try {
        // mineflayer のスロット名に変換
        const mfSlot = this._toMineflayerSlot(slot);
        await this.bot.equip(item, mfSlot);
        equipped.push({ slot, item: item.name });
        logger.info(`[ArmorAnalyzer] 装備: ${slot} <- ${item.name}`);
      } catch (e) {
        logger.debug(`[ArmorAnalyzer] 装備失敗 (${slot}): ${e.message}`);
        skipped.push({ slot, reason: e.message });
      }
    }

    return {
      ok:       equipped.length > 0 || skipped.length > 0,
      equipped,
      skipped,
      newScore: this.getArmorScore(),
    };
  }

  /**
   * 空または弱い防具スロットを返す
   * @returns {Array<{slot, reason, current}>}
   */
  getArmorGaps() {
    const gaps = [];

    for (const slot of ARMOR_SLOTS) {
      const current = this._getCurrentArmorInSlot(slot);

      if (!current) {
        gaps.push({ slot, reason: 'empty', current: null });
        continue;
      }

      const tier = this._getTier(current.name);
      if (tier <= ARMOR_TIER.leather) {
        gaps.push({ slot, reason: 'weak', current: current.name, tier });
      }
    }

    return gaps;
  }

  /**
   * 現在装備している防具の総合スコアを返す（0〜100）
   * @returns {number}
   */
  getArmorScore() {
    let totalScore   = 0;
    const maxScore   = this._calcMaxPossibleScore();

    for (const slot of ARMOR_SLOTS) {
      const armor = this._getCurrentArmorInSlot(slot);
      if (armor) totalScore += this._calcItemScore(armor);
    }

    if (maxScore === 0) return 0;
    return Math.min(100, Math.round((totalScore / maxScore) * 100));
  }

  /**
   * 現在装備している防具の詳細解析を返す
   * @returns {object} スロット別の詳細情報
   */
  analyzeCurrentArmor() {
    const analysis = {};

    for (const slot of ARMOR_SLOTS) {
      const armor = this._getCurrentArmorInSlot(slot);
      if (!armor) {
        analysis[slot] = { equipped: false };
        continue;
      }

      const score       = this._calcItemScore(armor);
      const tier        = this._getTier(armor.name);
      const defense     = BASE_DEFENSE[armor.name] || 0;
      const toughness   = BASE_TOUGHNESS[armor.name] || 0;
      const enchants    = this._getEnchantments(armor);
      const enchBonus   = this._calcEnchantBonus(enchants);
      const isElytra    = armor.name === 'elytra';

      analysis[slot] = {
        equipped:     true,
        name:         armor.name,
        tier,
        tierName:     this._getTierName(tier),
        defense,
        toughness,
        enchants,
        enchantBonus: enchBonus,
        score,
        isElytra,
        durability: armor.durabilityUsed,
      };
    }

    return {
      slots:      analysis,
      totalScore: this.getArmorScore(),
      gaps:       this.getArmorGaps(),
    };
  }

  /**
   * インベントリから防具のアップグレード提案を返す
   * @param {Array} inventory - 利用可能なインベントリ（省略時は bot のインベントリ）
   * @returns {Array<{slot, current, suggested, improvement}>}
   */
  suggestUpgrades(inventory = null) {
    const suggestions = [];
    const items = inventory || this.bot.inventory?.items() || [];

    for (const slot of ARMOR_SLOTS) {
      const current = this._getCurrentArmorInSlot(slot);

      // そのスロットのアイテム候補
      const candidates = items.filter(item => {
        if (!item?.name) return false;
        if (item.name === 'elytra') return slot === 'chestplate';
        return item.name.endsWith(`_${slot}`) || (item.name === 'turtle_helmet' && slot === 'helmet');
      });

      for (const candidate of candidates) {
        const comparison = this.compareArmor(candidate, current);
        if (comparison.better === candidate) {
          suggestions.push({
            slot,
            current:     current?.name || null,
            suggested:   candidate.name,
            improvement: comparison.scoreDiff,
          });
          break; // 最良の候補のみ提案
        }
      }
    }

    return suggestions;
  }

  // ── プライベートメソッド ──────────────────────────────────────────────────

  /**
   * アイテムの防具スコアを計算する（防御値 + エンチャント + 強靭性）
   * @param {object} item - mineflayer アイテム
   * @returns {number}
   */
  _calcItemScore(item) {
    if (!item?.name) return 0;

    // エリトラは飛行ツールとして別スコア体系
    if (item.name === 'elytra') return 5;

    const defense   = BASE_DEFENSE[item.name] || 0;
    const toughness = (BASE_TOUGHNESS[item.name] || 0) * 0.5;
    const tier      = this._getTier(item.name) * 2;
    const enchants  = this._getEnchantments(item);
    const enchBonus = this._calcEnchantBonus(enchants);

    return defense + toughness + tier + enchBonus;
  }

  /**
   * エンチャント効果のボーナス値を計算する
   * @param {object} enchants - エンチャントの Map
   * @returns {number}
   */
  _calcEnchantBonus(enchants) {
    let bonus = 0;

    for (const [enchName, level] of Object.entries(enchants)) {
      // Protection 系
      const protData = ENCHANT_REDUCTION[enchName];
      if (protData) {
        bonus += protData.perLevel * level * 20; // スコアに換算
        continue;
      }
      // Unbreaking
      if (enchName === 'unbreaking') {
        bonus += level * 1.5;
      }
      // Mending
      if (enchName === 'mending') {
        bonus += DURABILITY_ENCHANTS.mending.bonus;
      }
    }

    return bonus;
  }

  /**
   * アイテムのエンチャントを取得する
   * @param {object} item - mineflayer アイテム
   * @returns {object} エンチャント名 → レベル のオブジェクト
   */
  _getEnchantments(item) {
    if (!item?.nbt) return {};

    try {
      // mineflayer のアイテム NBT から enchantments を取得
      const enchList = item.nbt?.value?.Enchantments?.value?.value ||
                       item.nbt?.value?.StoredEnchantments?.value?.value || [];
      const result = {};

      for (const ench of enchList) {
        const enchId = ench.id?.value;
        const level  = ench.lvl?.value;

        if (enchId && level) {
          // minecraft-data からエンチャント名を取得
          const enchData = this._mcData?.enchantmentsByName?.[enchId] ||
                           Object.values(this._mcData?.enchantments || {}).find(
                             e => e.id === enchId || e.name === enchId
                           );
          const name = enchData?.name || enchId;
          result[name] = level;
        }
      }

      return result;
    } catch {
      return {};
    }
  }

  /**
   * アイテム名から素材 tier を返す
   * @param {string} itemName
   * @returns {number}
   */
  _getTier(itemName) {
    for (const [material, tier] of Object.entries(ARMOR_TIER)) {
      if (itemName.startsWith(material + '_')) return tier;
    }
    return 0;
  }

  /**
   * tier 数値を文字列に変換する
   * @param {number} tier
   * @returns {string}
   */
  _getTierName(tier) {
    const names = ['unknown', 'leather', 'chainmail/gold', 'iron', 'iron+', 'diamond', 'netherite'];
    return names[tier] || 'unknown';
  }

  /**
   * 現在装備しているスロットのアイテムを返す
   * @param {string} slot - 'helmet'|'chestplate'|'leggings'|'boots'
   * @returns {object|null}
   */
  _getCurrentArmorInSlot(slot) {
    if (!this.bot?.inventory) return null;

    // mineflayer の armor スロット番号
    const slotMap = {
      helmet:     5,
      chestplate: 6,
      leggings:   7,
      boots:      8,
    };

    const slotNum = slotMap[slot];
    if (slotNum == null) return null;

    return this.bot.inventory.slots[slotNum] || null;
  }

  /**
   * スロット名を mineflayer が期待する装備スロット名に変換する
   * @param {string} slot - 'helmet'|'chestplate'|'leggings'|'boots'
   * @returns {string}
   */
  _toMineflayerSlot(slot) {
    // mineflayer の equip() は 'head'|'torso'|'legs'|'feet' を受け付ける
    const map = {
      helmet:     'head',
      chestplate: 'torso',
      leggings:   'legs',
      boots:      'feet',
    };
    return map[slot] || slot;
  }

  /**
   * フルネザライト防具 + Protection IV の最大スコアを計算する（スケーリング用）
   * @returns {number}
   */
  _calcMaxPossibleScore() {
    // ネザライト フル装備 + Protection IV 全スロットの想定最大スコア
    const maxDefensePerSlot = {
      helmet:     BASE_DEFENSE.netherite_helmet     + (BASE_TOUGHNESS.netherite_helmet || 0) * 0.5,
      chestplate: BASE_DEFENSE.netherite_chestplate + (BASE_TOUGHNESS.netherite_chestplate || 0) * 0.5,
      leggings:   BASE_DEFENSE.netherite_leggings   + (BASE_TOUGHNESS.netherite_leggings || 0) * 0.5,
      boots:      BASE_DEFENSE.netherite_boots      + (BASE_TOUGHNESS.netherite_boots || 0) * 0.5,
    };

    const tierBonus     = ARMOR_TIER.netherite * 2;  // 12
    const maxEnchBonus  = (ENCHANT_REDUCTION.protection.perLevel * 4) * 20 + // Protection IV
                          DURABILITY_ENCHANTS.mending.bonus;                 // Mending

    return ARMOR_SLOTS.reduce((sum, slot) => {
      return sum + (maxDefensePerSlot[slot] || 0) + tierBonus + maxEnchBonus;
    }, 0);
  }
}

module.exports = {
  ArmorAnalyzer,
  ARMOR_SLOTS,
  ARMOR_TIER,
  BASE_DEFENSE,
};
