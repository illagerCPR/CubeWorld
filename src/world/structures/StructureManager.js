// StructureManager.js -- 自然建筑生成：锚点网格选址 + 确定性布局求解 + 逐区块裁剪
// 核心不变量：建筑布局只由 (seed, 结构类型, 锚点 cell) 决定——布局求解与区块裁剪严格分离，
// 任意端 / 任意区块生成顺序下，同一锚点的求解结果逐字节一致（联机"各端同世界"的根基）。
// 管线：TerrainGenerator.generateChunk -> decorateChunk(chunk)：
//   ① 扫描锚点网格 cell（哈希门控 + 抖动）→ ② 纯函数选址（群系/平坦度/海拔窗）
//   → ③ 布局求解（每锚点独立 RNG，结果按 cell 缓存 LRU）→ ④ 包围盒相交测试 + 逐块裁剪写入。
import { CHUNK_SIZE, CHUNK_HEIGHT } from '../../core/Chunk.js';
import { BlockRegistry } from '../../core/BlockRegistry.js';
import { fillBox } from './StructureKit.js';

// 32 位确定性哈希（seed/坐标/盐 → uint32），不同盐的流互不相关
function hash32(seed, a, b, salt) {
  let h = ((seed | 0) ^ Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(salt, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// LCG 随机数（与 terrain.js 树木生成同族），返回 [0,1)
function makeRng(seed) {
  let r = seed >>> 0;
  return () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
}

export { makeRng, hash32 };

// 注册结构类型。def 字段：
//   cell        网格边长（区块数），每 cell 至多一个候选锚点
//   radius      结构最大水平半径（方块），决定扫描范围与包围盒
//   chance      cell 候选通过概率（0-1，哈希门控，用 h 高 16 位与抖动位分离）
//   salt        整型盐，跨类型去相关
//   biomes      允许的群系数组（null = 不限）
//   minTop/maxTop 地表海拔窗（可选）；maxSlope 平坦度容差（默认 4）
//   solve(rng, ax, groundY, az) -> { blocks: [[wx,wy,wz,id],...], meta }  纯函数布局求解
//   place(gen, ax, az) -> groundY | -1   可选选址覆盖（要塞等非地表逻辑用），默认走平坦度检查
const structureTypes = new Map();

export function registerStructureType(name, def) {
  structureTypes.set(name, def);
}

export class StructureManager {
  constructor(generator, seed) {
    this.generator = generator;
    this.seed = seed;
    // 布局缓存：key = "type|ccx|ccz" -> record | null（null=选址未通过，同样缓存避免重复评估）
    this.cache = new Map();
    this.maxCache = 64;
  }

  // 由 cell 推导锚点记录（带缓存）。record: { name, ax, az, groundY, blocks, meta, minX..maxZ }
  _cellRecord(typeName, def, ccx, ccz) {
    const key = typeName + '|' + ccx + '|' + ccz;
    if (this.cache.has(key)) return this.cache.get(key);

    let rec = null;
    const h = hash32(this.seed, ccx, ccz, def.salt);
    // 概率门用高 16 位，抖动用低 16 位（各 8 位，互不侵占）
    if ((h >>> 16) / 65536 < def.chance) {
      const jx = h & 255, jz = (h >>> 8) & 255;
      const anchorCx = ccx * def.cell + (jx % def.cell);
      const anchorCz = ccz * def.cell + (jz % def.cell);
      const ax = anchorCx * CHUNK_SIZE + 8;
      const az = anchorCz * CHUNK_SIZE + 8;
      const groundY = def.place
        ? def.place(this.generator, ax, az)
        : this._surfacePlacement(def, ax, az);
      if (groundY >= 0) {
        const rng = makeRng(hash32(this.seed, anchorCx, anchorCz, def.salt + 1));
        const layout = def.solve(rng, ax, groundY, az);
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const b of layout.blocks) {
          if (b[0] < minX) minX = b[0]; if (b[0] > maxX) maxX = b[0];
          if (b[2] < minZ) minZ = b[2]; if (b[2] > maxZ) maxZ = b[2];
        }
        rec = {
          name: typeName, ax, az, groundY,
          blocks: layout.blocks, meta: layout.meta || {},
          minX, maxX, minZ, maxZ,
        };
      }
    }

    this.cache.set(key, rec);
    if (this.cache.size > this.maxCache) {
      this.cache.delete(this.cache.keys().next().value); // LRU：丢最旧（重求解结果不变）
    }
    return rec;
  }

  // 默认地表选址：群系白名单 + 海拔窗 + 12 样点平坦度/群系一致性（全部纯函数，零区块依赖）
  _surfacePlacement(def, ax, az) {
    const gen = this.generator;
    const biome = gen.getBiome(ax, az);
    if (def.biomes && !def.biomes.includes(biome)) return -1;
    const y = gen.getBaseHeight(ax, az);
    if (def.minTop !== undefined && y < def.minTop) return -1;
    if (def.maxTop !== undefined && y > def.maxTop) return -1;
    const maxSlope = def.maxSlope !== undefined ? def.maxSlope : 4;
    let min = y, max = y;
    // 12 样点：r=16 八向 + r=32 四正向
    const probes = [];
    for (const [dx, dz] of [[16,0],[-16,0],[0,16],[0,-16],[16,16],[-16,16],[16,-16],[-16,-16]]) probes.push([dx, dz]);
    probes.push([32, 0], [-32, 0], [0, 32], [0, -32]);
    for (const [dx, dz] of probes) {
      if (gen.getBiome(ax + dx, az + dz) !== biome) return -1;
      const h = gen.getBaseHeight(ax + dx, az + dz);
      if (h < min) min = h;
      if (h > max) max = h;
    }
    if (max - min > maxSlope) return -1;
    return y;
  }

  // 区块装饰入口：树之后调用。绝大多数区块在包围盒测试处 O(cell数) 跳过。
  decorateChunk(chunk) {
    if (structureTypes.size === 0) return;
    const { cx, cz } = chunk;
    for (const [name, def] of structureTypes) {
      const rChunks = Math.ceil(def.radius / CHUNK_SIZE) + 1;
      const c0x = Math.floor((cx - rChunks) / def.cell);
      const c1x = Math.floor((cx + rChunks) / def.cell);
      const c0z = Math.floor((cz - rChunks) / def.cell);
      const c1z = Math.floor((cz + rChunks) / def.cell);
      for (let ccx = c0x; ccx <= c1x; ccx++) {
        for (let ccz = c0z; ccz <= c1z; ccz++) {
          const rec = this._cellRecord(name, def, ccx, ccz);
          if (!rec) continue;
          // 包围盒相交测试（区块块坐标范围）
          if (rec.maxX < cx * CHUNK_SIZE || rec.minX > cx * CHUNK_SIZE + CHUNK_SIZE - 1) continue;
          if (rec.maxZ < cz * CHUNK_SIZE || rec.minZ > cz * CHUNK_SIZE + CHUNK_SIZE - 1) continue;
          this._writeChunk(chunk, rec);
        }
      }
    }
  }

  // 逐块裁剪：只写落在当前区块内的方块；同坐标后写覆盖先写（求解方的追加顺序即绘制优先级）
  _writeChunk(chunk, rec) {
    const x0 = chunk.cx * CHUNK_SIZE, z0 = chunk.cz * CHUNK_SIZE;
    const blocks = rec.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const lx = blocks[i][0] - x0;
      if (lx < 0 || lx >= CHUNK_SIZE) continue;
      const lz = blocks[i][2] - z0;
      if (lz < 0 || lz >= CHUNK_SIZE) continue;
      const wy = blocks[i][1];
      if (wy < 1 || wy >= CHUNK_HEIGHT) continue;
      chunk.set(lx, wy, lz, blocks[i][3]);
    }
  }

  // 查询：位置附近 radius 内的结构记录（村民生成等运行时逻辑用，不触发求解）
  recordsNear(x, z, radius, typeName = null) {
    const out = [];
    for (const rec of this.cache.values()) {
      if (!rec) continue;
      if (typeName && rec.name !== typeName) continue;
      const dx = Math.max(rec.minX - x, 0, x - rec.maxX);
      const dz = Math.max(rec.minZ - z, 0, z - rec.maxZ);
      if (dx * dx + dz * dz <= radius * radius) out.push(rec);
    }
    return out;
  }

  // 调试用：当前缓存中的全部记录（确定性测试断言用）
  debugRecords() {
    return [...this.cache.values()].filter(Boolean);
  }
}

// 便捷导出：布局求解里常用的方块 id 解析（懒取，避免模块加载顺序问题）
export function blockId(name) { return BlockRegistry.getId(name); }

export { fillBox };
