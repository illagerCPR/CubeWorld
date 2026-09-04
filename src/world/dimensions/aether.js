// aether.js -- 天域维度地形生成（主世界风格浮岛；纯函数 of (seed, 坐标)）
// 结构：虚空世界；低频 2D 噪声场圈定独立浮岛轮廓（场 > 阈值才有岛），
// 岛心越厚（场值驱动透镜剖面）；原点保底出生岛（确定性隆起 dome）；
// 草/土/石剖面；正常天光日光（overworld 同款光照路径）；刻意无水体（CW-1 未关）。
import { SimplexNoise } from '../noise.js';
import { BlockRegistry } from '../../core/BlockRegistry.js';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from '../../core/Chunk.js';

// ── 天域参数 ─────────────────────────────────────────────────────────
const ISLE_FREQ = 0.008;      // 岛屿场频率（独立岛轮廓，波长 ~125 格）
const ISLE_T = 0.40;          // 岛屿存在阈值（场 > 阈值 → 浮岛；越小岛越密）
const TOP_BASE = 88;          // 岛顶基准高度（高于主世界海面，浮空感）
const SPAWN_ISLE_R = 48;      // 出生岛保底 dome 半径
const SPAWN_ISLE_TOP = 92;    // 出生岛保底顶面

export class AetherGenerator {
  constructor(seed) {
    this.seed = seed;
    this.dimensionId = 'aether'; // 结构维度作用域（StructureManager.dimMatches 读取）
    this.isleNoise = new SimplexNoise(seed * 41 + 301);   // 岛屿场
    this.topNoise = new SimplexNoise(seed * 41 + 302);    // 顶面起伏
    this.bottomNoise = new SimplexNoise(seed * 41 + 303); // 岛底起伏
    // 生物群系名表（InfoBar 按 generator.biomeNames 读取）
    this.biomeNames = { plains: '浮岛平原', highlands: '浮岛高地', void: '天穹虚空' };
  }

  // 岛屿场：低频 fbm + 原点保底 dome（max 合成——无论噪声如何原点必有岛）
  _field(wx, wz) {
    const d = Math.hypot(wx, wz);
    const dome = d < SPAWN_ISLE_R ? (1 - d / SPAWN_ISLE_R) * 1.1 - 0.15 : -1;
    return Math.max(this.isleNoise.fbm2D(wx * ISLE_FREQ, wz * ISLE_FREQ, 3), dome);
  }

  // 列的岛剖面 { top, bottom }；无岛返回 null
  _span(wx, wz) {
    const n = this._field(wx, wz);
    if (n <= ISLE_T) return null;
    const core = n - ISLE_T; // 0..~0.5：岛心越厚，边缘自然收薄
    const top = TOP_BASE + Math.round(this.topNoise.fbm2D(wx * 0.02, wz * 0.02, 2) * 4 + core * 14);
    const bottom = this.bottomNoise.fbm2D(wx * 0.03 + 37, wz * 0.03, 2) * 4;
    const thickness = 3 + core * 60 + bottom;
    return { top: Math.min(CHUNK_HEIGHT - 30, top), bottom: Math.max(8, top - Math.round(thickness)) };
  }

  // 生物群系（纯函数 of 列坐标）：岛心越厚越高地——浮岛高地 > 浮岛平原 > 天穹虚空
  getBiome(wx, wz) {
    const n = this._field(wx, wz);
    if (n <= ISLE_T) return 'void';
    return n > ISLE_T + 0.20 ? 'highlands' : 'plains';
  }

  generateChunk(chunk) {
    const { cx, cz } = chunk;
    const blocks = chunk.blocks;
    const GRASS = BlockRegistry.getId('grass_block');
    const DIRT = BlockRegistry.getId('dirt');
    const STONE = BlockRegistry.getId('stone');
    const idx = (y, z, x) => (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = cx * CHUNK_SIZE + x, wz = cz * CHUNK_SIZE + z;
        const span = this._span(wx, wz);
        if (!span) continue;
        for (let y = span.bottom; y <= span.top; y++) {
          let id = STONE;
          if (y === span.top) id = GRASS;
          else if (y >= span.top - 3) id = DIRT;
          blocks[idx(y, z, x)] = id;
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
