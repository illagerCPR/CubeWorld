// terrain.js -- 地形生成
import { SimplexNoise } from './noise.js';
import { Biomes, BiomeConfig } from './biomes.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from '../core/Chunk.js';
import { StructureManager } from './structures/StructureManager.js';

const STONE = () => BlockRegistry.getId('stone');
const DIRT = () => BlockRegistry.getId('dirt');
const GRASS = () => BlockRegistry.getId('grass_block');
const SAND = () => BlockRegistry.getId('sand');
const SNOW_BLOCK = () => BlockRegistry.getId('snow_block');
const SNOW_LAYER = () => BlockRegistry.getId('snow_layer');
const WATER = () => BlockRegistry.getId('water');
const BEDROCK = () => BlockRegistry.getId('bedrock');
const CLAY = () => BlockRegistry.getId('clay');
const GRAVEL = () => BlockRegistry.getId('gravel');

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed;
    this.noise = new SimplexNoise(seed);
    this.tempNoise = new SimplexNoise(seed + 1);
    this.humidNoise = new SimplexNoise(seed + 2);
    this.riverNoise = new SimplexNoise(seed + 3);
    this.detailNoise = new SimplexNoise(seed + 4);
    this.oreNoise = new SimplexNoise(seed + 5);
    this.structureManager = new StructureManager(this, seed);
  }

  // 取群系
  getBiome(wx, wz) {
    const temp = this.tempNoise.fbm2D(wx * 0.004, wz * 0.004, 3);
    const humid = this.humidNoise.fbm2D(wx * 0.005, wz * 0.005, 3);
    const river = this.riverNoise.ridge2D(wx * 0.003, wz * 0.003, 3);
    
    // 河流：ridge 噪声接近 0 时
    if (river < 0.06) return Biomes.RIVER;
    
    if (temp > 0.3 && humid < 0) return Biomes.DESERT;
    if (temp < -0.3 && humid > 0) return Biomes.SNOWY_TAIGA;
    return Biomes.PLAINS;
  }

  // 基础高度（不含河流下切）
  getBaseHeight(wx, wz) {
    const n = this.noise.fbm2D(wx * 0.008, wz * 0.008, 5, 0.5, 2);
    const detail = this.detailNoise.fbm2D(wx * 0.03, wz * 0.03, 3, 0.5, 2);
    let h = SEA_LEVEL + n * 20 + detail * 4;
    
    const biome = this.getBiome(wx, wz);
    if (biome === Biomes.SNOWY_TAIGA) h += 8;
    if (biome === Biomes.DESERT) h -= 2;
    
    // 河流下切
    const river = this.riverNoise.ridge2D(wx * 0.003, wz * 0.003, 3);
    if (river < 0.08) {
      const riverDepth = (0.08 - river) / 0.08;
      h = Math.min(h, SEA_LEVEL - riverDepth * 6);
    }
    
    return Math.max(1, Math.min(CHUNK_HEIGHT - 1, Math.round(h)));
  }

  // 生成区块
  generateChunk(chunk) {
    const { cx, cz } = chunk;
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = cx * CHUNK_SIZE + x;
        const wz = cz * CHUNK_SIZE + z;
        const biome = this.getBiome(wx, wz);
        const cfg = BiomeConfig[biome];
        const height = this.getBaseHeight(wx, wz);
        
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          let blockId = 0;
          if (y === 0) {
            blockId = BEDROCK();
          } else if (y < height - 5) {
            blockId = STONE();
            // 矿石替换
            const ore = this.getOreAt(wx, y, wz);
            if (ore) blockId = BlockRegistry.getId(ore);
          } else if (y < height - 1) {
            blockId = BlockRegistry.getId(cfg.subsurfaceBlock);
          } else if (y < height) {
            blockId = BlockRegistry.getId(cfg.surfaceBlock);
            // 河流区域水位以下
            if (biome === Biomes.RIVER && y < SEA_LEVEL) {
              blockId = SAND();
            }
          } else if (y <= SEA_LEVEL && y >= height) {
            blockId = WATER();
          }
          
          if (blockId !== 0) {
            chunk.set(x, y, z, blockId);
          }
        }
        
        // 雪层
        if (cfg.snowLayer && height < CHUNK_HEIGHT && height > SEA_LEVEL) {
          const above = chunk.get(x, height, z);
          if (above === 0) {
            chunk.set(x, height, z, SNOW_LAYER());
          }
        }
      }
    }
    
    // 结构生成（树等）
    this.generateStructures(chunk);
    // 自然建筑（村庄/要塞等，锚点网格 + 确定性布局 + 逐区块裁剪）
    this.structureManager.decorateChunk(chunk);
    chunk.generated = true;
    chunk.dirty = true;
  }

  // 矿石分布
  getOreAt(wx, wy, wz) {
    const n = this.oreNoise.fbm3D(wx * 0.1, wy * 0.1, wz * 0.1, 2);
    if (wy < 16 && n > 0.6) return 'diamond_ore';
    if (wy < 32 && n > 0.55) return 'gold_ore';
    if (wy < 24 && n > 0.5) return 'lapis_ore';
    if (wy < 48 && n > 0.5) return 'redstone_ore';
    if (wy < 64 && n > 0.45) return 'emerald_ore';
    if (wy < 72 && n > 0.4) return 'copper_ore';
    if (n > 0.3) return 'iron_ore';
    if (n > 0.2) return 'coal_ore';
    return null;
  }

  // 结构：树、仙人掌等
  generateStructures(chunk) {
    const { cx, cz } = chunk;
    let r = (cx * 73856093) ^ (cz * 19349663) ^ (this.seed * 83492791);
    r = r >>> 0;
    const rand = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
    
    for (let x = 2; x < CHUNK_SIZE - 2; x++) {
      for (let z = 2; z < CHUNK_SIZE - 2; z++) {
        const wx = cx * CHUNK_SIZE + x;
        const wz = cz * CHUNK_SIZE + z;
        const biome = this.getBiome(wx, wz);
        const cfg = BiomeConfig[biome];
        
        // 找地表
        let surfaceY = -1;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          const b = chunk.get(x, y, z);
          if (b !== 0 && b !== WATER()) { surfaceY = y; break; }
        }
        if (surfaceY < 0 || surfaceY >= CHUNK_HEIGHT - 8) continue;
        
        const surfaceBlock = chunk.get(x, surfaceY, z);
        const surfaceName = BlockRegistry.getById(surfaceBlock)?.name;
        
        // 树（生成位置若被水方块占据则跳过，避免水中生树）
        if (cfg.treeChance && rand() < cfg.treeChance &&
            surfaceName === cfg.surfaceBlock &&
            chunk.get(x, surfaceY + 1, z) !== WATER()) {
          this.placeTree(chunk, x, surfaceY + 1, z, cfg.treeType, rand);
        }
        // 仙人掌
        if (cfg.cactusChance && rand() < cfg.cactusChance &&
            surfaceName === 'sand' &&
            chunk.get(x, surfaceY + 1, z) !== WATER()) {
          const h = 2 + Math.floor(rand() * 2);
          for (let i = 0; i < h; i++) chunk.set(x, surfaceY + 1 + i, z, BlockRegistry.getId('cactus'));
        }
        // 枯萎灌木
        if (cfg.deadBushChance && rand() < cfg.deadBushChance &&
            surfaceName === 'sand' &&
            chunk.get(x, surfaceY + 1, z) !== WATER()) {
          chunk.set(x, surfaceY + 1, z, BlockRegistry.getId('spruce_log'));
        }
        // 草丛
        if (cfg.grassChance && rand() < cfg.grassChance && surfaceName === 'grass_block') {
          // 简化：用雪层占位
        }
      }
    }
  }

  placeTree(chunk, x, y, z, type, rand) {
    const height = type === 'spruce' ? 5 + Math.floor(rand() * 3) : 4 + Math.floor(rand() * 2);
    const logName = type === 'spruce' ? 'spruce_log' : 'oak_log';
    const leavesName = type === 'spruce' ? 'spruce_leaves' : 'oak_leaves';
    const logId = BlockRegistry.getId(logName);
    const leavesId = BlockRegistry.getId(leavesName);
    
    // 树干
    for (let i = 0; i < height; i++) {
      chunk.set(x, y + i, z, logId);
    }
    
    // 树叶
    const top = y + height;
    if (type === 'spruce') {
      // 云杉：层状
      for (let layer = 0; layer < 3; layer++) {
        const ly = top - 1 - layer * 2;
        const r = 2 - layer;
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) + Math.abs(dz) > r + 1) continue;
            if (dx === 0 && dz === 0 && ly < top - 1) continue;
            const bx = x + dx, by = ly, bz = z + dz;
            if (bx >= 0 && bx < CHUNK_SIZE && bz >= 0 && bz < CHUNK_SIZE && chunk.get(bx, by, bz) === 0) {
              chunk.set(bx, by, bz, leavesId);
            }
          }
        }
      }
      chunk.set(x, top, z, leavesId);
    } else {
      // 橡树：球状
      for (let dy = -2; dy <= 1; dy++) {
        const r = dy >= 0 ? 1 : 2;
        for (let dx = -r; dx <= r; dx++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && rand() < 0.5) continue;
            const bx = x + dx, by = top + dy - 1, bz = z + dz;
            if (bx >= 0 && bx < CHUNK_SIZE && bz >= 0 && bz < CHUNK_SIZE && by < CHUNK_HEIGHT) {
              if (chunk.get(bx, by, bz) === 0) chunk.set(bx, by, bz, leavesId);
            }
          }
        }
      }
    }
  }
}
