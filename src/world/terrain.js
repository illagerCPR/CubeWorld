// terrain.js -- 地形生成（含确定性 3D 噪声洞穴雕刻）
import { SimplexNoise } from './noise.js';
import { Biomes, BiomeConfig } from './biomes.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from '../core/Chunk.js';
import { StructureManager } from './structures/StructureManager.js';
import './structures/catalog.js';

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
const LAVA = () => BlockRegistry.getId('lava');

// ── 洞穴参数（W3）────────────────────────────────────────────────────────
// 意面通道：两个独立 3D 噪声 a/b 同时接近 0（a²+b²<t）→ 管道腔；y 频率 ×2 压扁通道
const CAVE_NOODLE_FREQ = 0.014;
const CAVE_NOODLE_T = 0.006;
// 奶酪空腔：单噪声高值 → 稀疏大腔
const CAVE_CHEESE_FREQ = 0.02;
const CAVE_CHEESE_T = 0.66;
// 采样网格步长（世界对齐，跨区块连续的根基）
const CAVE_CELL = 4;
// 保护规则
const CAVE_MIN_Y = 4;            // 基岩+保护层，不挖
const CAVE_WATER_SHELL = 6;      // 水面列（height < SEA_LEVEL+2）水下保留壳厚，防倒灌
const CAVE_LAVA_LEVEL = 10;      // 挖空处 y ≤ 此值填岩浆（MC 风格深层岩浆湖）

export class TerrainGenerator {
  constructor(seed) {
    this.seed = seed;
    this.dimensionId = 'overworld'; // 结构维度作用域（StructureManager.dimMatches 读取）
    this.noise = new SimplexNoise(seed);
    this.tempNoise = new SimplexNoise(seed + 1);
    this.humidNoise = new SimplexNoise(seed + 2);
    this.riverNoise = new SimplexNoise(seed + 3);
    this.detailNoise = new SimplexNoise(seed + 4);
    this.oreNoise = new SimplexNoise(seed + 5);
    this.caveNoiseA = new SimplexNoise(seed + 6); // 洞穴双通道（意面）+ 奶酪
    this.caveNoiseB = new SimplexNoise(seed + 7);
    this.caveNoiseC = new SimplexNoise(seed + 8);
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
    // 先逐列取地表高度（洞穴场与主循环共用，避免重复噪声求值）
    const heightMap = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    let maxHeight = 0;
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = cx * CHUNK_SIZE + x;
        const wz = cz * CHUNK_SIZE + z;
        const h = this.getBaseHeight(wx, wz);
        heightMap[x + z * CHUNK_SIZE] = h;
        if (h > maxHeight) maxHeight = h;
      }
    }
    // 洞穴密度场（世界对齐采样网格 + 三线性插值；无洞穴高度时跳过）
    const field = this._buildCaveField(cx, cz, maxHeight);

    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const wx = cx * CHUNK_SIZE + x;
        const wz = cz * CHUNK_SIZE + z;
        const height = heightMap[x + z * CHUNK_SIZE];
        const biome = this.getBiome(wx, wz);
        const cfg = BiomeConfig[biome];

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
            // 水下列（列顶在海平面下）：表面铺泥土（草方块不该出现在水下）
            if (y < SEA_LEVEL) {
              const surfName = BlockRegistry.getById(BlockRegistry.getId(cfg.surfaceBlock))?.name;
              if (surfName === 'grass_block' || surfName === 'snow_block') blockId = DIRT();
            }
            // 河流区域水位以下
            if (biome === Biomes.RIVER && y < SEA_LEVEL) {
              blockId = SAND();
            }
          } else if (y <= SEA_LEVEL && y >= height) {
            blockId = WATER();
          }

          // 洞穴雕刻（在实心方块判定后：挖空石头/土层，深层填岩浆）
          if (blockId !== 0 && blockId !== BEDROCK() && blockId !== WATER() &&
              field && y >= CAVE_MIN_Y && y < height &&
              this._isCave(field, wx, y, wz, height)) {
            blockId = y <= CAVE_LAVA_LEVEL ? LAVA() : 0;
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

  // ── 洞穴密度场（W3）：世界对齐采样网格，插值判定跨区块天然连续 ──────────
  // 三个通道各存一张网格（a/b=意面双通道，c=奶酪），返回 null 表示本区块无需雕刻。
  _buildCaveField(cx, cz, maxHeight) {
    const yTop = Math.min(CHUNK_HEIGHT, maxHeight + 2);
    if (yTop <= CAVE_MIN_Y + CAVE_CELL) return null;
    const nx = CHUNK_SIZE / CAVE_CELL + 1; // 5：含 x=0..16（16 为邻区块边界点）
    const nz = nx;
    const ny = Math.ceil(yTop / CAVE_CELL) + 1;
    const aG = new Float32Array(nx * nz * ny);
    const bG = new Float32Array(nx * nz * ny);
    const cG = new Float32Array(nx * nz * ny);
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    const fy = 2; // y 频率倍增：通道竖向压扁（MC 意面洞穴观感）
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        const wx = x0 + ix * CAVE_CELL;
        const wz = z0 + iz * CAVE_CELL;
        for (let iy = 0; iy < ny; iy++) {
          const wy = iy * CAVE_CELL;
          const i = (ix * nz + iz) * ny + iy;
          aG[i] = this.caveNoiseA.noise3D(wx * CAVE_NOODLE_FREQ, wy * CAVE_NOODLE_FREQ * fy, wz * CAVE_NOODLE_FREQ);
          bG[i] = this.caveNoiseB.noise3D(wx * CAVE_NOODLE_FREQ, wy * CAVE_NOODLE_FREQ * fy, wz * CAVE_NOODLE_FREQ);
          cG[i] = this.caveNoiseC.noise3D(wx * CAVE_CHEESE_FREQ, wy * CAVE_CHEESE_FREQ * fy, wz * CAVE_CHEESE_FREQ);
        }
      }
    }
    return { aG, bG, cG, nx, nz, ny, x0, z0 };
  }

  // 采样插值判定：三通道三线性插值 → 意面 a²+b²<t 或 奶酪 c>t；含水面列保护壳。
  _isCave(f, wx, y, wz, height) {
    // 水面列（河/海）保留水下壳，防止湖海倒灌进洞
    if (height < SEA_LEVEL + 2 && y > height - CAVE_WATER_SHELL) return false;
    const gx = (wx - f.x0) / CAVE_CELL, gy = y / CAVE_CELL, gz = (wz - f.z0) / CAVE_CELL;
    const ix = Math.min(Math.floor(gx), f.nx - 2), iy = Math.min(Math.floor(gy), f.ny - 2), iz = Math.min(Math.floor(gz), f.nz - 2);
    const fx = gx - ix, fyv = gy - iy, fz = gz - iz;
    const idx = (X, Y, Z) => ((ix + X) * f.nz + (iz + Z)) * f.ny + (iy + Y);
    // 每通道三线性（8 角 → 7 次 lerp）
    const tri = (G) => {
      const c00 = G[idx(0, 0, 0)] * (1 - fx) + G[idx(1, 0, 0)] * fx;
      const c10 = G[idx(0, 0, 1)] * (1 - fx) + G[idx(1, 0, 1)] * fx;
      const c01 = G[idx(0, 1, 0)] * (1 - fx) + G[idx(1, 1, 0)] * fx;
      const c11 = G[idx(0, 1, 1)] * (1 - fx) + G[idx(1, 1, 1)] * fx;
      const c0 = c00 * (1 - fz) + c10 * fz;
      const c1 = c01 * (1 - fz) + c11 * fz;
      return c0 * (1 - fyv) + c1 * fyv;
    };
    const a = tri(f.aG), b = tri(f.bG), c = tri(f.cG);
    if (a * a + b * b < CAVE_NOODLE_T) return true;
    return c > CAVE_CHEESE_T;
  }

  // 矿石分布（链式窄带：各矿占比=首中即停的带宽分位差×深度带占比，总矿率 ~2%（旧版 38%）；
  // 阈值非单调是有意为之——深带矿先匹配，浅带按剩余窗口校准：煤>铁>铜>红石>金>钻>青金>绿宝）
  getOreAt(wx, wy, wz) {
    const n = this.oreNoise.fbm3D(wx * 0.1, wy * 0.1, wz * 0.1, 2);
    if (wy < 16 && n > 0.738) return 'diamond_ore';
    if (wy < 32 && n > 0.757) return 'gold_ore';
    if (wy < 24 && n > 0.716) return 'lapis_ore';
    if (wy < 48 && n > 0.73) return 'redstone_ore';
    if (wy < 64 && n > 0.773) return 'emerald_ore';
    if (wy < 72 && n > 0.72) return 'copper_ore';
    if (n > 0.66) return 'iron_ore';
    if (n > 0.601) return 'coal_ore';
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
