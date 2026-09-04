// nether.js -- 下界维度地形生成（纯函数 of (seed, 坐标)，零 Math.random，联机确定性根基）
// 结构：y0/y255 双层基岩封死天光；netherrack 实心体由三通道 3D 噪声场雕出大空腔（奶酪）
// 与意面通道；y≤31 熔岩海；地板表面 soul_sand/gravel/黑曜石斑块；荧石挂顶照明。
// 空腔场沿用 W3 洞穴的"世界对齐采样网格 + 三线性插值"技法——跨区块连续的根基。
import { SimplexNoise } from '../noise.js';
import { BlockRegistry } from '../../core/BlockRegistry.js';
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT } from '../../core/Chunk.js';

// ── 下界参数 ─────────────────────────────────────────────────────────
const FLOOR_BASE = 38, FLOOR_AMP = 12;      // 地面高度带
const CEIL_BASE = 212, CEIL_AMP = 12;       // 天花高度带
const LAVA_SEA = 31;                        // 熔岩海面（空腔 y≤此值填岩浆）
const SHELL = 2;                            // 基岩上下实心保护壳（不雕刻）
const CELL = 4;                             // 空腔场采样网格步长（世界对齐）
const CHEESE_FREQ = 0.013, CHEESE_T = 0.46; // 奶酪大空腔（单噪声高值 → 稀疏大腔）
const NOODLE_FREQ = 0.014, NOODLE_T = 0.010;// 意面通道：a²+b²<t
const NOODLE_YFREQ = 2.0;                   // 通道 y 频率倍增（压扁管道）
const PATCH_FREQ = 0.03;                    // 表面斑块 2D 噪声频率
const SOUL_T = 0.30, GRAVEL_T = -0.42;      // 灵魂沙 / 砂砾斑块阈值
const OBSIDIAN_P = 0.06;                    // 熔岩缘黑曜石概率（per-block 哈希）
const GLOW_FREQ = 0.055, GLOW_T = 0.52;     // 荧石挂顶 3D 噪声门控
export const SPAWN_SCAN_TOP = 200;          // 天花之下的实体扫描顶（怪物生成共用）
const SPAWN_PREFER_TOP = 130;               // 出生点优先扫描顶（主洞穴带，避免贴天花）
const SPAWN_SCAN_MIN = LAVA_SEA + 2;        // 出生立足点下限（熔岩海之上）

// 确定性整数哈希（per-block 装饰门控，结果可复现）
function hash3(x, y, z) {
  let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const NX = CHUNK_SIZE / CELL + 1;  // xz 网格点数 5
const NY = CHUNK_HEIGHT / CELL;    // y 网格点数 64（y 0..252；≥253 属保护壳无需场）
const lerp = (a, b, t) => a + (b - a) * t;

export class NetherGenerator {
  constructor(seed) {
    this.seed = seed;
    this.floorNoise = new SimplexNoise(seed * 31 + 101);
    this.ceilNoise = new SimplexNoise(seed * 31 + 102);
    this.cheeseNoise = new SimplexNoise(seed * 31 + 103);
    this.noodleA = new SimplexNoise(seed * 31 + 104);
    this.noodleB = new SimplexNoise(seed * 31 + 105);
    this.patchNoise = new SimplexNoise(seed * 31 + 106);
    this.glowNoise = new SimplexNoise(seed * 31 + 107);
  }

  getFloorY(wx, wz) {
    const n = this.floorNoise.fbm2D(wx * 0.012, wz * 0.012, 3, 0.5, 2);
    return Math.floor(FLOOR_BASE + n * FLOOR_AMP);
  }

  getCeilY(wx, wz) {
    const n = this.ceilNoise.fbm2D(wx * 0.01, wz * 0.01, 3, 0.5, 2);
    return Math.floor(CEIL_BASE + n * CEIL_AMP);
  }

  // 空腔判定（场插值后的三通道）：奶酪 >t 或意面 a²+b²<t
  _isCave(a, b, c) {
    return c > CHEESE_T || (a * a + b * b) < NOODLE_T;
  }

  // 世界对齐采样网格上的三通道噪声场（网格点 = 世界坐标 4 的倍数 → 跨区块连续）
  _buildCaveField(cx, cz) {
    const fA = new Float32Array(NX * NY * NX);
    const fB = new Float32Array(NX * NY * NX);
    const fC = new Float32Array(NX * NY * NX);
    const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
    for (let gy = 0; gy < NY; gy++) {
      const wy = gy * CELL;
      for (let gz = 0; gz < NX; gz++) {
        const wz = oz + gz * CELL;
        for (let gx = 0; gx < NX; gx++) {
          const wx = ox + gx * CELL;
          const i = (gy * NX + gz) * NX + gx;
          fA[i] = this.noodleA.noise3D(wx * NOODLE_FREQ, wy * NOODLE_FREQ * NOODLE_YFREQ, wz * NOODLE_FREQ);
          fB[i] = this.noodleB.noise3D(wx * NOODLE_FREQ, wy * NOODLE_FREQ * NOODLE_YFREQ, wz * NOODLE_FREQ);
          fC[i] = this.cheeseNoise.noise3D(wx * CHEESE_FREQ, wy * CHEESE_FREQ, wz * CHEESE_FREQ);
        }
      }
    }
    return { fA, fB, fC };
  }

  // 生成区块（两遍：① 高度带 + 空腔雕刻 + 熔岩海；② 表面斑块 + 荧石挂顶）
  generateChunk(chunk) {
    const { cx, cz } = chunk;
    const blocks = chunk.blocks;
    const NR = BlockRegistry.getId('netherrack');
    const BEDROCK = BlockRegistry.getId('bedrock');
    const LAVA = BlockRegistry.getId('lava');
    const SOUL = BlockRegistry.getId('soul_sand');
    const GRAVEL = BlockRegistry.getId('gravel');
    const OBS = BlockRegistry.getId('obsidian');
    const GLOW = BlockRegistry.getId('glowstone');
    const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
    const idx = (y, z, x) => (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;

    // ① 空腔场 + 主循环
    const { fA, fB, fC } = this._buildCaveField(cx, cz);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = ox + x, wz = oz + z;
        const fx = (x % CELL) / CELL, fz = (z % CELL) / CELL;
        const gx0 = x >> 2, gz0 = z >> 2;
        const gx1 = Math.min(gx0 + 1, NX - 1), gz1 = Math.min(gz0 + 1, NX - 1);
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          let id = NR;
          if (y === 0 || y === CHUNK_HEIGHT - 1) id = BEDROCK;
          else if (y > SHELL && y < CHUNK_HEIGHT - 1 - SHELL) {
            // 空腔雕刻（保护壳范围外）
            const gy0 = y >> 2, fy = (y % CELL) / CELL;
            const gy1 = Math.min(gy0 + 1, NY - 1);
            // 网格 y 用 clamp 后的 gy1 参与（y=252..254 落在最后一段）
            const b000 = (Math.min(gy0, NY - 1) * NX + gz0) * NX + gx0;
            const b001 = (gy1 * NX + gz0) * NX + gx0;
            const b010 = (Math.min(gy0, NY - 1) * NX + gz1) * NX + gx0;
            const b011 = (gy1 * NX + gz1) * NX + gx0;
            const gdx = gx1 - gx0;
            const av = triLerp8(fA, b000, b000 + gdx, b001, b001 + gdx, b010, b010 + gdx, b011, b011 + gdx, fx, fy, fz);
            const bv = triLerp8(fB, b000, b000 + gdx, b001, b001 + gdx, b010, b010 + gdx, b011, b011 + gdx, fx, fy, fz);
            const cv = triLerp8(fC, b000, b000 + gdx, b001, b001 + gdx, b010, b010 + gdx, b011, b011 + gdx, fx, fy, fz);
            if (this._isCave(av, bv, cv)) id = 0;
          }
          if (id === 0 && y <= LAVA_SEA) id = LAVA;
          blocks[idx(y, z, x)] = id;
        }
      }
    }

    // ② 装饰遍：荧石挂顶（空气格 + 上方实心 netherrack）+ 地板表面斑块
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = ox + x, wz = oz + z;
        const patch = this.patchNoise.fbm2D(wx * PATCH_FREQ, wz * PATCH_FREQ, 2);
        for (let y = SHELL + 1; y < CHUNK_HEIGHT - 1 - SHELL; y++) {
          const id = blocks[idx(y, z, x)];
          if (id === 0) {
            if (blocks[idx(y + 1, z, x)] === NR) {
              const g = this.glowNoise.noise3D(wx * GLOW_FREQ, y * GLOW_FREQ, wz * GLOW_FREQ);
              if (g > GLOW_T) blocks[idx(y, z, x)] = GLOW;
            }
          } else if (id === NR) {
            // 地板表面 = 上方露天（排除天花底面）；下方为空腔或熔岩（熔岩岸线也做斑块）
            const below = blocks[idx(y - 1, z, x)];
            if (blocks[idx(y + 1, z, x)] === 0 && (below === 0 || below === LAVA)) {
              if (y > LAVA_SEA && y <= LAVA_SEA + 6 && hash3(wx, y, wz) < OBSIDIAN_P) {
                blocks[idx(y, z, x)] = OBS;
              } else if (patch > SOUL_T) {
                blocks[idx(y, z, x)] = SOUL;
              } else if (patch < GRAVEL_T) {
                blocks[idx(y, z, x)] = GRAVEL;
              }
            }
          }
        }
      }
    }
  }

  // 出生点：从原点螺旋外推找"2 格空气 + 实心地板"（熔岩海之上）。
  // 临时生成候选区块做探测——与实际生成走同一条代码路径，天然逐字节一致。
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
      for (let y = SPAWN_PREFER_TOP; y >= SPAWN_SCAN_MIN; y--) {
        if (c.get(lx, y, lz) !== 0 || c.get(lx, y + 1, lz) !== 0) continue;
        const def = BlockRegistry.getById(c.get(lx, y - 1, lz));
        if (def && def.solid) return y;
      }
      return -1;
    };
    for (let r = 0; r <= 48; r++) {
      for (let d = -r; d <= r; d++) {
        const ring = [[d, -r], [d, r]];
        if (r > 0) ring.push([-r, d], [r, d]);
        for (const [x, z] of ring) {
          const y = probe(x, z);
          if (y > 0) return { x: x + 0.5, y, z: z + 0.5 };
        }
      }
    }
    // 兜底：空腔密度下理论不可达；返回天花下方空中，玩家自行落地
    return { x: 0.5, y: SPAWN_SCAN_TOP, z: 0.5 };
  }
}

// 八角三线性插值（b* 为 8 个角索引；b*b 为 gx1 侧）
function triLerp8(f, b000, b100, b001, b101, b010, b110, b011, b111, fx, fy, fz) {
  const x00 = lerp(f[b000], f[b100], fx);
  const x10 = lerp(f[b010], f[b110], fx);
  const x0 = lerp(x00, x10, fz);
  const y00 = lerp(f[b001], f[b101], fx);
  const y10 = lerp(f[b011], f[b111], fx);
  const y0 = lerp(y00, y10, fz);
  return lerp(x0, y0, fy);
}
