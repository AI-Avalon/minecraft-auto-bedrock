/**
 * Litematica Schematics Loader
 * Litematica形式(.lit)をprismarine互換フォーマットに変換
 * NBT形式で保存されたLitematicaデータを読み込み、建築プランに変換
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);

class LitematicaLoader {
  constructor() {
    this.logger = console;
  }

  /**
   * Litematicaファイルを読み込む
   * @param {string} filePath - .lit ファイルパス
   * @returns {Promise<Object>} パースされたLitematicaデータ
   */
  async loadLitematicaFile(filePath) {
    try {
      const data = fs.readFileSync(filePath);
      
      // Litematicaファイルはバイナリ形式．NBT形式で圧縮されている
      // ファイルフォーマット：[version:int][compressionType:int][NBT data]
      const buffer = Buffer.from(data);
      let offset = 0;

      // バージョン読み込み
      if (buffer.length < 8) {
        throw new Error('Invalid litematica file format - too short');
      }

      const version = buffer.readInt32LE(offset);
      offset += 4;
      
      const compressionType = buffer.readInt32LE(offset);
      offset += 4;

      this.logger.log(`[Litematica] Version: ${version}, Compression: ${compressionType}`);

      // 圧縮データの解凍
      let nbtData;
      if (compressionType === 2) {
        // GZIP圧縮
        nbtData = await gunzip(buffer.slice(offset));
      } else if (compressionType === 0) {
        // 圧縮なし
        nbtData = buffer.slice(offset);
      } else {
        throw new Error(`Unsupported compression type: ${compressionType}`);
      }

      // NBTデータのパース（簡易版）
      const parsed = this._parseNBT(nbtData);
      return this._convertToSchematicFormat(parsed);
    } catch (error) {
      this.logger.error(`[Litematica] Error loading file: ${error.message}`);
      throw error;
    }
  }

  /**
   * NBTデータの簡易パース
   * 完全なNBT実装は複雑なため、Litematica互換の必要部分だけを抽出
   * @param {Buffer} buffer
   * @returns {Object} parsed NBT
   */
  _parseNBT(buffer) {
    // 注: 完全なNBT実装は省略。実際の運用では nbt.js ライブラリを推奨
    // ここでは基本的な構造のみを示す
    
    const root = {
      Regions: [],
      Metadata: {}
    };

    // Litematicaの標準的なNBTフォーマット
    // root.Regions[].BlockStates, root.Regions[].Palette などが存在
    // 簡易的に、バイナリから直接ブロック情報を抽出する場合のロジック
    
    // 実装は nbt.js ライブラリ使用時に以下で置き換え推奨:
    // const nbt = require('nbt');
    // const { parse } = nbt;
    // const result = parse(buffer);
    // return result;

    return root;
  }

  /**
   * NBTフォーマットをprismarine schematic互換に変換
   * @param {Object} nbtData - パースされたNBTデータ
   * @returns {Object} Schematic compatible format
   */
  _convertToSchematicFormat(nbtData) {
    const regions = nbtData.Regions || [];
    
    if (regions.length === 0) {
      throw new Error('No valid regions found in litematica file');
    }

    const region = regions[0]; // 最初のリージョンを使用
    const width = region.Width || 16;
    const height = region.Height || 16;
    const length = region.Length || 16;

    const schematic = {
      palette: this._buildPalette(region),
      blocks: region.BlockStates || [],
      entities: [],
      blockData: region.TileEntities || [],
      metadata: {
        width,
        height,
        length,
        name: region.blockEntityName || 'Litematica Schematic',
        version: 2
      }
    };

    return schematic;
  }

  /**
   * Litematicaパレットをschematic形式に変換
   * @param {Object} region - Litematicaリージョン
   * @returns {Array} Block palette
   */
  _buildPalette(region) {
    const palette = region.Palette || [];
    
    return palette.map((blockState, index) => ({
      id: index,
      name: blockState.Name || 'minecraft:stone',
      properties: blockState.Properties || {}
    }));
  }

  /**
   * Litematicaファイルから材料リストを抽出
   * @param {string} filePath - .lit ファイルパス
   * @returns {Promise<Object>} 材料リスト { blockType: count, ... }
   */
  async extractMaterials(filePath) {
    try {
      const schematic = await this.loadLitematicaFile(filePath);
      const materials = {};

      // パレットから各ブロックの使用数を計算
      const palette = schematic.palette || [];
      const blockStates = schematic.blocks || [];

      // 簡易カウント（実装は詳細なパレットビイントを処理）
      for (const blockState of blockStates) {
        const blockInfo = palette[blockState] || {};
        const blockName = blockInfo.name || 'minecraft:stone';
        materials[blockName] = (materials[blockName] || 0) + 1;
      }

      return materials;
    } catch (error) {
      this.logger.error(`[Litematica] Error extracting materials: ${error.message}`);
      throw error;
    }
  }

  /**
   * 複数のLitematicaファイルをバッチ読み込み
   * @param {string} directory - スキーマティック格納ディレクトリ
   * @returns {Promise<Array>} 読み込まれたスキーマティック
   */
  async loadFromDirectory(directory) {
    try {
      const files = fs.readdirSync(directory)
        .filter(f => f.endsWith('.lit'))
        .map(f => path.join(directory, f));

      const results = [];
      for (const file of files) {
        try {
          const schematic = await this.loadLitematicaFile(file);
          results.push({
            filename: path.basename(file),
            path: file,
            schematic
          });
        } catch (err) {
          this.logger.warn(`[Litematica] Skipping ${file}: ${err.message}`);
        }
      }

      return results;
    } catch (error) {
      this.logger.error(`[Litematica] Error loading directory: ${error.message}`);
      throw error;
    }
  }
}

module.exports = { LitematicaLoader };
