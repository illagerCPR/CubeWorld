// aether.js -- 天域维度地形生成（四群系浮岛世界；纯函数 of (seed, 坐标)）
// 群系：翡翠浮岛（草岛橡树）/ 水晶秘境（石岛石英晶柱+海晶灯+荧石晶簇）/
//      银霜浮岛（雪顶冰夹层云杉）/ 秋色浮岛（金合欢橙叶林+粗泥斑）；岛外=天穹虚空。
// 原点保底出生岛强制翡翠（出生确定性 + 落点安全）；装饰树冠限缩在块内（lx/lz∈[2,13]），
// per-column hash 门控——任意区块顺序结果逐字节一致（联机根基）。
import { SimplexNoise } from '../noise.js';
import { BlockRegistry } from '../../core/BlockRegistry.js';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from '../../core/Chunk.js';

// ── 天域参数 ─────────────────────────────────────────────────────────
const ISLE_FREQ = 0.008;      // 岛屿场频率（独立岛轮廓，波长 ~125 格）
const ISLE_T = 0.40;          // 岛屿存在阈值（场 > 阈值 → 浮岛；越小岛越密）
const TOP_BASE = 88;          // 岛顶基准高度（高于主世界海面，浮空感）
const SPAWN_ISLE_R = 48;      // 出生岛保底 dome 半径
const SPAWN_ISLE_TOP = 92;    // 出生岛保底顶面

// 群系参数（阈值经 17×17 区块 ×2 seeds 漏斗统计校准）
const BIOME_FREQ = 0.0055;    // 群系场频率（波长 ~180 格，成片分布）
const CRYSTAL_T = 0.28;       // 群系场 > 该值 → 水晶秘境（岛内占比 ~12%，漏斗统计校准）
const FROST_T = -0.26;        // 群系场 < 该值 → 银霜浮岛（岛内占比 ~10%）
const GROVE_FREQ = 0.012;     // 秋色林密度场频率
const GROVE_T = 0.24;         // 密度场 > 该值 → 秋色浮岛（否则翡翠）

// 确定性整数哈希（per-column/per-block 装饰门控，结果可复现）
function hash3(x, y, z) {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export class AetherGenerator {
  constructor(seed) {
    this.seed = seed;
    this.dimensionId = 'aether'; // 结构维度作用域（StructureManager.dimMatches 读取）
    this.isleNoise = new SimplexNoise(seed * 41 + 301);   // 岛屿场
    this.topNoise = new SimplexNoise(seed * 41 + 302);    // 顶面起伏
    this.bottomNoise = new SimplexNoise(seed * 41 + 303); // 岛底起伏
    this.biomeNoise = new SimplexNoise(seed * 41 + 304);  // 群系场（crystal/frost 分带）
    this.groveNoise = new SimplexNoise(seed * 41 + 305);  // 秋色林密度场
    // 生物群系名表（InfoBar 按 generator.biomeNames 读取）
    this.biomeNames = {
      verdant: '翡翠浮岛', crystal: '水晶秘境', frost: '银霜浮岛',
      autumn: '秋色浮岛', void: '天穹虚空',
    };
  }

  // 岛屿场：低频 fbm + 原点保底 dome（max 合成——无论噪声如何原点必有岛）
  _field(wx, wz) {
    const d = Math.hypot(wx, wz);
    const dome = d < SPAWN_ISLE_R ? (1 - d / SPAWN_ISLE_R) * 1.1 - 0.15 : -1;
    return Math.max(this.isleNoise.fbm2D(wx * ISLE_FREQ, wz * ISLE_FREQ, 3), dome);
  }

  // 群系判定（岛内）：由群系场 + 秋色密度场派生；出生岛强制翡翠
  _biomeFromField(wx, wz, n) {
    if (n <= ISLE_T) return 'void';
    if (Math.hypot(wx, wz) < SPAWN_ISLE_R + 8) return 'verdant';
    const b = this.biomeNoise.fbm2D(wx * BIOME_FREQ, wz * BIOME_FREQ, 2);
    if (b > CRYSTAL_T) return 'crystal';
    if (b < FROST_T) return 'frost';
    return this.groveNoise.fbm2D(wx * GROVE_FREQ + 71, wz * GROVE_FREQ, 2) > GROVE_T ? 'autumn' : 'verdant';
  }

  // 生物群系（纯函数 of 列坐标）
  getBiome(wx, wz) {
    return this._biomeFromField(wx, wz, this._field(wx, wz));
  }

  // 表面装饰：树 / 水晶柱（树冠限缩块内——lx/lz∈[2,13]，±2 冠不跨块）
  _decorate(chunk, lx, lz, wx, wz, span, biome, ids) {
    const blocks = chunk.blocks;
    const idx = (y, z, x) => (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
    const setIfAir = (y, z, x, id) => { if (blocks[idx(y, z, x)] === 0) blocks[idx(y, z, x)] = id; };
    const r = hash3(wx, span.top + 1, wz);

    if (biome === 'crystal') {
      // 水晶秘境：石英晶柱（荧石顶）+ 海晶灯地表镶嵌
      if (r < 0.012) {
        const h = 2 + Math.floor(r / 0.012 * 4); // 2~5
        for (let y = span.top + 1; y <= span.top + h; y++) blocks[idx(y, lz, lx)] = ids.QUARTZ;
        blocks[idx(span.top + h + 1, lz, lx)] = ids.GLOWSTONE;
      } else if (r < 0.020) {
        blocks[idx(span.top, lz, lx)] = ids.SEA_LANTERN;
      }
      return;
    }

    // 树木门控（翡翠橡树 1.8% / 秋色金合欢 3.2% / 银霜云杉 2.2%）
    const treeP = biome === 'verdant' ? 0.018 : biome === 'autumn' ? 0.032 : 0.022;
    if (r >= treeP) return;
    const kind = biome === 'verdant' ? 'oak' : biome === 'autumn' ? 'acacia' : 'spruce';
    const h = kind === 'spruce' ? 5 + Math.floor(hash3(wx, span.top + 2, wz) * 2)
      : 3 + Math.floor(hash3(wx, span.top + 2, wz) * 2);
    const log = kind === 'oak' ? ids.OAK_LOG : kind === 'acacia' ? ids.ACACIA_LOG : ids.SPRUCE_LOG;
    const leaf = kind === 'oak' ? ids.OAK_LEAVES : kind === 'acacia' ? ids.ACACIA_LEAVES : ids.SPRUCE_LEAVES;
    const top = span.top;

    if (kind === 'spruce') {
      // 云杉锥形冠：5×5 去角 → 3×3 → 3×3 → 十字 → 顶针
      for (let y = top + 1; y <= top + h; y++) blocks[idx(y, lz, lx)] = log;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        setIfAir(top + h - 2, lz + dz, lx + dx, leaf);
      }
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        setIfAir(top + h - 1, lz + dz, lx + dx, leaf);
        setIfAir(top + h, lz + dz, lx + dx, leaf);
      }
      setIfAir(top + h + 1, lz, lx, leaf);
      setIfAir(top + h + 1, lz + 1, lx, leaf); setIfAir(top + h + 1, lz - 1, lx, leaf);
      setIfAir(top + h + 1, lz, lx + 1, leaf); setIfAir(top + h + 1, lz, lx - 1, leaf);
      setIfAir(top + h + 2, lz, lx, leaf);
    } else {
      // 橡树/金合欢球形冠：两层 5×5（hash 去角）→ 3×3 → 十字
      for (let y = top + 1; y <= top + h; y++) blocks[idx(y, lz, lx)] = log;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (hash3(wx + dx, top + h - 1, wz + dz) < 0.15 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        setIfAir(top + h - 1, lz + dz, lx + dx, leaf);
        if (!(Math.abs(dx) === 2 && Math.abs(dz) === 2)) setIfAir(top + h, lz + dz, lx + dx, leaf);
      }
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue; // 干占据
        setIfAir(top + h + 1, lz + dz, lx + dx, leaf);
      }
      setIfAir(top + h + 1, lz, lx, leaf);
      setIfAir(top + h + 2, lz + 1, lx, leaf); setIfAir(top + h + 2, lz - 1, lx, leaf);
      setIfAir(top + h + 2, lz, lx + 1, leaf); setIfAir(top + h + 2, lz, lx - 1, leaf);
    }
  }

  generateChunk(chunk) {
    const { cx, cz } = chunk;
    const blocks = chunk.blocks;
    const ids = {
      GRASS: BlockRegistry.getId('grass_block'),
      DIRT: BlockRegistry.getId('dirt'),
      STONE: BlockRegistry.getId('stone'),
      SNOW: BlockRegistry.getId('snow_block'),
      ICE: BlockRegistry.getId('packed_ice'),
      COARSE: BlockRegistry.getId('coarse_dirt'),
      QUARTZ: BlockRegistry.getId('quartz_block'),
      GLOWSTONE: BlockRegistry.getId('glowstone'),
      SEA_LANTERN: BlockRegistry.getId('sea_lantern'),
      OAK_LOG: BlockRegistry.getId('oak_log'),
      OAK_LEAVES: BlockRegistry.getId('oak_leaves'),
      ACACIA_LOG: BlockRegistry.getId('acacia_log'),
      ACACIA_LEAVES: BlockRegistry.getId('acacia_leaves'),
      SPRUCE_LOG: BlockRegistry.getId('spruce_log'),
      SPRUCE_LEAVES: BlockRegistry.getId('spruce_leaves'),
    };
    const idx = (y, z, x) => (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = cx * CHUNK_SIZE + x, wz = cz * CHUNK_SIZE + z;
        const n = this._field(wx, wz);
        if (n <= ISLE_T) continue;
        const core = n - ISLE_T;
        const top = Math.min(CHUNK_HEIGHT - 30, TOP_BASE + Math.round(this.topNoise.fbm2D(wx * 0.02, wz * 0.02, 2) * 4 + core * 14));
        const bottomNoise = this.bottomNoise.fbm2D(wx * 0.03 + 37, wz * 0.03, 2) * 4;
        const bottom = Math.max(8, top - Math.round(3 + core * 60 + bottomNoise));
        const span = { top, bottom };
        const biome = this._biomeFromField(wx, wz, n);
        for (let y = bottom; y <= top; y++) {
          let id = ids.STONE;
          if (biome === 'frost') {
            if (y === top) id = ids.SNOW;
            else if (y >= top - 2) id = hash3(wx, y, wz) < 0.35 ? ids.ICE : ids.DIRT;
          } else if (biome !== 'crystal') {
            if (y === top) id = ids.GRASS;
            else if (y >= top - 3) id = (biome === 'autumn' && hash3(wx, y, wz + 7) < 0.30) ? ids.COARSE : ids.DIRT;
          }
          blocks[idx(y, z, x)] = id;
        }
        if (x >= 2 && x <= 13 && z >= 2 && z <= 13) {
          this._decorate(chunk, x, z, wx, wz, span, biome, ids);
        }
      }
    }
  }

  // 出生点：原点保底岛表面（螺旋外推找"2 格空气 + 实心地板"）
  findSpawn() {
    const cache = new Map();
    const chunkAt = (cx, cz) => {
      const k = cx + ',' + cz;
      let c = cache.get(k);
      if (!c) { c = new Chunk(cx, cz); this.generateChunk(c); cache.set(k, c); }
      return c;
    };
    const probe = (x, z) => {
      const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
      const c = chunkAt(cx, cz);
      const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
      for (let y = 130; y >= 40; y--) {
        if (c.get(lx, y, lz) !== 0 || c.get(lx, y + 1, lz) !== 0) continue;
        const def = BlockRegistry.getById(c.get(lx, y - 1, lz));
        if (def && def.solid) return y;
      }
      return -1;
    };
    for (let r = 0; r <= 44; r++) {
      for (let d = -r; d <= r; d++) {
        const ring = [[d, -r], [d, r]];
        if (r > 0) ring.push([-r, d], [r, d]);
        for (const [x, z] of ring) {
          const y = probe(x, z);
          if (y > 0) return { x: x + 0.5, y, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: SPAWN_ISLE_TOP, z: 0.5 }; // 兜底（dome 保证理论不可达）
  }
}
