// end.js -- 末地维度地形生成（纯函数 of (seed, 坐标)，零 Math.random，联机确定性根基）
// 结构：虚空世界；主岛 = 围绕原点的透镜形 end_stone 岛（半径 ~60，噪声扰动边缘）；
// 黑曜石柱环（6-10 根，角度/高度/半径 per-seed 确定性派生，顶端荧石）；
// 外岛 = 锚点场（模仿原版 island origin：96 格网格 per-cell 确定性派生 0-2 个岛心，
// 每岛圆锥+透镜剖面）；大岛=末地高原（末地城候选），碎岛=末地碎岛；
// 无 bedrock 无天光——掉出岛即坠虚空（hasVoid）。
import { SimplexNoise } from '../noise.js';
import { BlockRegistry } from '../../core/BlockRegistry.js';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from '../../core/Chunk.js';

// ── 末地参数 ─────────────────────────────────────────────────────────
const ISLAND_R = 60;          // 主岛基准半径
const ISLAND_TOP = 64;        // 主岛顶面基准
const ISLAND_DEPTH = 22;      // 主岛中心最大厚度（透镜形，边缘收薄）
const PILLAR_RING_R = 25;     // 黑曜石柱环半径
const PILLAR_MIN_H = 74;      // 柱顶高度下限
// ── 外岛锚点场参数（模仿原版 island origin 网格分布）────────────────
const OUTER_CELL = 96;        // 锚点网格尺寸
const ISLAND_MIN_R = 24;      // 岛半径下限
const ISLAND_MAX_R = 40;      // 岛半径上限
// 末地高原群系分界（≥此半径=高原，末地城候选）；导出供测试/选址共用
export const HIGHLANDS_MIN_R = 28;

// 确定性整数哈希（per-seed/per-index 派生，结果可复现）
function hashSeed(seed, k) {
  let n = (Math.imul(seed, 374761393) + Math.imul(k, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export class EndGenerator {
  constructor(seed) {
    this.seed = seed;
    this.dimensionId = 'end'; // 结构维度作用域（StructureManager.dimMatches 读取）
    this.edgeNoise = new SimplexNoise(seed * 37 + 201);   // 主岛边缘扰动（角度域连续）
    this.topNoise = new SimplexNoise(seed * 37 + 202);    // 顶面高度起伏
    this.bottomNoise = new SimplexNoise(seed * 37 + 203); // 岛底起伏
    this.outerNoise = new SimplexNoise(seed * 37 + 204);  // 外岛边缘扰动
    // 外岛锚点缓存（memoization：键到值纯派生，不影响确定性；上限保护防长跑膨胀）
    this._anchorCache = new Map();
    // 生物群系名表（InfoBar 按 generator.biomeNames 读取）
    this.biomeNames = {
      main_island: '末地主岛',
      end_highlands: '末地高原',
      small_end_islands: '末地碎岛',
      void: '末地虚空',
    };
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

  // ── 外岛锚点场（模仿原版 island origin）────────────────────────────
  // per-cell 确定性哈希（组合键，与 hashSeed 同域）
  _cellHash(gx, gz) {
    return (Math.imul(gx, 668265263) ^ Math.imul(gz, 374761393)) >>> 0;
  }

  // 某锚点网格 cell 的岛心列表（纯函数 of (seed, cell)，缓存 memoization）
  _anchorsFor(gx, gz) {
    const key = gx + ',' + gz;
    const hit = this._anchorCache.get(key);
    if (hit) return hit;
    const k = this._cellHash(gx, gz);
    const draw = (salt) => hashSeed(k, salt);
    const h0 = draw(300);
    const count = h0 < 0.42 ? 0 : (h0 < 0.85 ? 1 : 2); // 58% cell 至少一岛
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({
        x: gx * OUTER_CELL + Math.round(draw(310 + i * 8) * OUTER_CELL),
        z: gz * OUTER_CELL + Math.round(draw(330 + i * 8) * OUTER_CELL),
        rad: ISLAND_MIN_R + Math.floor(draw(350 + i * 8) * (ISLAND_MAX_R - ISLAND_MIN_R + 1)), // 24-40
        top: 55 + Math.floor(draw(370 + i * 8) * 20), // 顶面 55-74
      });
    }
    if (this._anchorCache.size > 4096) this._anchorCache.clear();
    this._anchorCache.set(key, list);
    return list;
  }

  // 主岛外圈锚点表（按角度排序，折跃门→外岛映射用；纯函数 of seed）
  outerAnchors() {
    const list = [];
    const R1 = Math.ceil((ISLAND_R + 120) / OUTER_CELL); // 覆盖主岛外的 cell 扫描半径
    for (let gx = -R1; gx <= R1; gx++) {
      for (let gz = -R1; gz <= R1; gz++) {
        for (const a of this._anchorsFor(gx, gz)) {
          const d = Math.hypot(a.x, a.z);
          if (d > ISLAND_R + 40 && d < OUTER_CELL * (R1 + 1)) list.push(a);
        }
      }
    }
    list.sort((p, q) => Math.atan2(p.z, p.x) - Math.atan2(q.z, q.x));
    return list;
  }

  // 列的外岛轮廓（锚点场）：扫描 3×3 邻域 cell 的岛心，重叠取顶面最高者；
  // 不在外岛内返回 null。返回 { top, bottom, rad }（rad=岛基准半径，群系分界用）
  _outerSpan(wx, wz) {
    const gx = Math.floor(wx / OUTER_CELL), gz = Math.floor(wz / OUTER_CELL);
    let best = null;
    for (let ix = gx - 1; ix <= gx + 1; ix++) {
      for (let iz = gz - 1; iz <= gz + 1; iz++) {
        for (const a of this._anchorsFor(ix, iz)) {
          const dx = wx - a.x, dz = wz - a.z;
          const d2 = dx * dx + dz * dz;
          const rMax = a.rad + 4; // 快速剔除（扰动最多放大 ~12%）
          if (d2 > rMax * rMax) continue;
          const d = Math.sqrt(d2);
          // 边缘半径按角度域 (cos,sin) 噪声扰动（per-anchor 偏移保证岛间独立）
          const ca = d > 0.01 ? dx / d : 1, sa = d > 0.01 ? dz / d : 0;
          const wob = this.outerNoise.fbm2D(ca * 2.4 + a.x * 0.013, sa * 2.4 + a.z * 0.013, 2);
          const rad = a.rad * (0.88 + 0.12 * wob);
          if (d >= rad) continue;
          const t = d / rad; // 0 中心 → 1 边缘
          const top = a.top + Math.round(this.topNoise.fbm2D(wx * 0.02 + 91, wz * 0.02, 2) * 4);
          // 圆锥+透镜剖面：中心厚（~rad×0.32+2）边缘收薄到 2
          const thickness = Math.max(2, Math.round((1 - t * t) * a.rad * 0.32) + 2
            + Math.round(this.bottomNoise.fbm2D(wx * 0.03 + 55, wz * 0.03, 2) * 2));
          const bottom = Math.max(8, top - thickness);
          if (!best || top > best.top) best = { top, bottom, rad: a.rad };
        }
      }
    }
    return best;
  }

  // 生物群系（纯函数 of 列坐标）：主岛 > 外岛（大岛=高原 / 碎岛）> 虚空
  getBiome(wx, wz) {
    if (this._islandSpan(wx, wz)) return 'main_island';
    const outer = this._outerSpan(wx, wz);
    if (outer) return outer.rad >= HIGHLANDS_MIN_R ? 'end_highlands' : 'small_end_islands';
    return 'void';
  }

  generateChunk(chunk) {
    const { cx, cz } = chunk;
    const blocks = chunk.blocks;
    const ES = BlockRegistry.getId('end_stone');
    const OBS = BlockRegistry.getId('obsidian');
    const BED = BlockRegistry.getId('bedrock');
    const CRYSTAL = BlockRegistry.getId('end_crystal');
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
          // 柱顶：基岩底座 + 末影水晶（原版龙战回血源；CrystalAlive 按此坐标查询）
          if (p.top + 2 < CHUNK_HEIGHT) {
            blocks[idx(p.top + 1, z, x)] = BED;
            blocks[idx(p.top + 2, z, x)] = CRYSTAL;
          }
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

// 龙败折跃门选址（纯函数 of 锚点表）：角度均布取样 n 个锚点，
// 每锚点给一对门位——主岛缘（inner，r=50）与外岛锚点朝主岛一侧边缘（outer）。
// 两端门角度一致 → 运行时 gatewayTarget 按"角度最近"配对传送（Portals.js）。
export const GATEWAY_INNER_R = 50;
export function gatewayPlacements(anchors, n = 4) {
  const list = [];
  const count = Math.min(n, anchors.length);
  for (let i = 0; i < count; i++) {
    const a = anchors[Math.floor((i * anchors.length) / count)];
    const d = Math.hypot(a.x, a.z) || 1;
    list.push({
      angle: Math.atan2(a.z, a.x),
      outer: {
        x: Math.round(a.x - (a.x / d) * (a.rad - 3)),
        z: Math.round(a.z - (a.z / d) * (a.rad - 3)),
      },
      inner: { x: Math.round((a.x / d) * GATEWAY_INNER_R), z: Math.round((a.z / d) * GATEWAY_INNER_R) },
    });
  }
  return list;
}
