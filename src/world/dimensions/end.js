// end.js -- 末地维度地形生成（纯函数 of (seed, 坐标)，零 Math.random，联机确定性根基）
// 结构：虚空世界；主岛 = 围绕原点的透镜形 end_stone 岛（半径 ~60，噪声扰动边缘）；
// 黑曜石柱环（6-10 根，角度/高度/半径 per-seed 确定性派生，顶端荧石）；
// 外环小岛（r>180，2D 噪声阈值）；无 bedrock 无天光——掉出岛即坠虚空（hasVoid）。
import { SimplexNoise } from '../noise.js';
import { BlockRegistry } from '../../core/BlockRegistry.js';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from '../../core/Chunk.js';

// ── 末地参数 ─────────────────────────────────────────────────────────
const ISLAND_R = 60;          // 主岛基准半径
const ISLAND_TOP = 64;        // 主岛顶面基准
const ISLAND_DEPTH = 22;      // 主岛中心最大厚度（透镜形，边缘收薄）
const PILLAR_RING_R = 25;     // 黑曜石柱环半径
const PILLAR_MIN_H = 74;      // 柱顶高度下限
const OUTER_MIN_R = 180;      // 外环小岛起始半径
const OUTER_FREQ = 0.006, OUTER_T = 0.60; // 外环小岛 2D 噪声阈值

// 确定性整数哈希（per-seed/per-index 派生，结果可复现）
function hashSeed(seed, k) {
  let n = (Math.imul(seed, 374761393) + Math.imul(k, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export class EndGenerator {
  constructor(seed) {
    this.seed = seed;
    this.edgeNoise = new SimplexNoise(seed * 37 + 201);   // 主岛边缘扰动（角度域连续）
    this.topNoise = new SimplexNoise(seed * 37 + 202);    // 顶面高度起伏
    this.bottomNoise = new SimplexNoise(seed * 37 + 203); // 岛底起伏
    this.outerNoise = new SimplexNoise(seed * 37 + 204);  // 外环小岛场
    // 生物群系名表（InfoBar 按 generator.biomeNames 读取）
    this.biomeNames = { main_island: '末地主岛', outer_islands: '末地外岛', void: '末地虚空' };
  }

  // 黑曜石柱布局（纯函数 of seed；每次调用结果一致）
  _pillars() {
    const n = 6 + Math.floor(hashSeed(this.seed, 11) * 5); // 6-10 根
    const pillars = [];
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + (hashSeed(this.seed, 20 + i) - 0.5) * 0.35;
      const r = PILLAR_RING_R + (hashSeed(this.seed, 40 + i) - 0.5) * 8;
      pillars.push({
        x: Math.round(Math.cos(angle) * r),
        z: Math.round(Math.sin(angle) * r),
        top: PILLAR_MIN_H + Math.floor(hashSeed(this.seed, 60 + i) * 22), // 74-95
        rad: 2 + Math.floor(hashSeed(this.seed, 80 + i) * 2.5),           // 2-4
      });
    }
    return pillars;
  }

  // 列的主岛轮廓：topY（顶面）/ bottomY（岛底）；不在主岛内返回 null
  _islandSpan(wx, wz) {
    const r = Math.hypot(wx, wz);
    if (r >= ISLAND_R + 6) return null;
    // 边缘半径按角度扰动（用 (cos,sin) 域噪声保证 ±π 连续）
    const ca = Math.cos(Math.atan2(wz, wx)), sa = Math.sin(Math.atan2(wz, wx));
    const en = this.edgeNoise.noise2D(ca * 2.2, sa * 2.2);
    const edge = ISLAND_R * (0.82 + 0.18 * en);
    if (r >= edge) return null;
    const t = r / edge;
    const top = ISLAND_TOP + Math.round(this.topNoise.fbm2D(wx * 0.02, wz * 0.02, 2) * 3);
    const thickness = (1 - t * t) * ISLAND_DEPTH + 2 + this.bottomNoise.fbm2D(wx * 0.03, wz * 0.03, 2) * 3;
    const bottom = Math.max(8, top - Math.round(thickness));
    return { top, bottom };
  }

  // 列的外环小岛轮廓；不在小岛内返回 null
  _outerSpan(wx, wz) {
    const r = Math.hypot(wx, wz);
    if (r <= OUTER_MIN_R) return null;
    const n = this.outerNoise.fbm2D(wx * OUTER_FREQ, wz * OUTER_FREQ, 3);
    if (n <= OUTER_T) return null;
    const top = 58 + Math.round(this.topNoise.fbm2D(wx * 0.02 + 91, wz * 0.02, 2) * 6);
    const thickness = 4 + Math.round((n - OUTER_T) * 46);
    return { top, bottom: Math.max(8, top - thickness) };
  }

  // 生物群系（纯函数 of 列坐标）：主岛 > 外环小岛 > 虚空
  getBiome(wx, wz) {
    if (this._islandSpan(wx, wz)) return 'main_island';
    if (this._outerSpan(wx, wz)) return 'outer_islands';
    return 'void';
  }

  generateChunk(chunk) {
    const { cx, cz } = chunk;
    const blocks = chunk.blocks;
    const ES = BlockRegistry.getId('end_stone');
    const OBS = BlockRegistry.getId('obsidian');
    const GLOW = BlockRegistry.getId('glowstone');
    const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
    const idx = (y, z, x) => (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;

    // ① 逐列：主岛 + 外环小岛（列区间内填 end_stone，其余保持空气=虚空）
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = ox + x, wz = oz + z;
        const span = this._islandSpan(wx, wz) || this._outerSpan(wx, wz);
        if (!span) continue;
        for (let y = Math.max(0, span.bottom); y <= Math.min(CHUNK_HEIGHT - 1, span.top); y++) {
          blocks[idx(y, z, x)] = ES;
        }
      }
    }

    // ② 黑曜石柱（与区块包围盒相交才逐列扫描，多数区块 O(柱数) 跳过）
    for (const p of this._pillars()) {
      const minX = Math.max(0, p.x - p.rad - ox), maxX = Math.min(CHUNK_SIZE - 1, p.x + p.rad - ox);
      const minZ = Math.max(0, p.z - p.rad - oz), maxZ = Math.min(CHUNK_SIZE - 1, p.z + p.rad - oz);
      if (minX > maxX || minZ > maxZ) continue;
      const r2 = (p.rad + 0.35) * (p.rad + 0.35);
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = ox + x - p.x, dz = oz + z - p.z;
          if (dx * dx + dz * dz > r2) continue;
          for (let y = 58; y <= p.top; y++) blocks[idx(y, z, x)] = OBS;
          if (p.top + 1 < CHUNK_HEIGHT) blocks[idx(p.top + 1, z, x)] = GLOW; // 柱顶荧石
        }
      }
    }
  }

  // 出生点：主岛表面（从原点螺旋外推找"2 格空气 + 实心地板"，临时生成候选区块探测）
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
      // 从 72 向下扫：低于柱群高度（PILLAR_MIN_H），避免出生在黑曜石柱顶
      for (let y = 72; y >= 40; y--) {
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
    return { x: 0.5, y: ISLAND_TOP + 2, z: 0.5 }; // 兜底：主岛顶面（理论不可达）
  }
}
