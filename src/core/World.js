// World.js -- 世界管理：区块加载/卸载、方块访问、体素光照、容器（箱子）数据
// 维度化：构造时带 dimension，方块/容器账本按维度分桶（同坐标跨维度互不干扰）
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from './Chunk.js';
import { TerrainGenerator } from '../world/terrain.js';
import { BlockRegistry } from './BlockRegistry.js';
import { LightEngine } from './LightEngine.js';
import { chestLoot } from '../world/loot.js';
import { getDimension, DEFAULT_DIMENSION } from './dimensions.js';

export class World {
  constructor(seed = 0, dimension = DEFAULT_DIMENSION) {
    this.seed = seed;
    this.dimension = dimension;
    this.dimDef = getDimension(dimension) || getDimension(DEFAULT_DIMENSION);
    this.chunks = new Map();
    this.generator = this.dimDef.createGenerator(seed);
    // 维度分桶账本：modifiedBlocks/containers 是"当前维度"桶的指针
    //（切换维度 = 整体重建 World，指针永不跨维度换绑）
    this.dimensionBlocks = new Map();     // dimId -> Map("x,y,z" -> 方块 id)
    this.dimensionContainers = new Map(); // dimId -> Map("x,y,z" -> 27 槽数组)
    this.dimensionFurnaces = new Map();   // dimId -> Map("x,y,z" -> 熔炉状态 {input,fuel,output,burnTime,burnMax,cookTime})
    this.modifiedBlocks = this.dimBucket(this.dimensionBlocks);
    this.containers = this.dimBucket(this.dimensionContainers);
    this.furnaces = this.dimBucket(this.dimensionFurnaces);
    // T5 容器：打开时惰性生成（结构箱子按 (seed,表名,坐标) 确定性 loot），
    // 玩家改动即落 Map（存档持久化；联机经 container_set 广播收敛）
    this.onLocalBlockChange = null;  // 本地发起方块修改回调 (x,y,z,id)，由 NetworkManager 注册（联机上报）
    this.lightEngine = new LightEngine(this); // 体素光照（纯客户端视觉，不进存档/协议）
  }

  // 取（或建）当前维度的账本桶
  dimBucket(store) {
    let m = store.get(this.dimension);
    if (!m) { m = new Map(); store.set(this.dimension, m); }
    return m;
  }

  // 从存档/换维数据装入全部维度桶，并把当前维度指针指向对应桶
  loadDimensionBuckets(blocksObj, containersObj, furnacesObj = null) {
    for (const [dim, entries] of Object.entries(blocksObj || {})) {
      const m = new Map();
      for (const [k, v] of Object.entries(entries || {})) m.set(k, v | 0);
      this.dimensionBlocks.set(dim, m);
    }
    for (const [dim, entries] of Object.entries(containersObj || {})) {
      const m = new Map();
      for (const [k, v] of Object.entries(entries || {})) {
        if (Array.isArray(v) && v.length === 27) m.set(k, v);
      }
      this.dimensionContainers.set(dim, m);
    }
    if (furnacesObj) {
      for (const [dim, entries] of Object.entries(furnacesObj)) {
        const m = new Map();
        for (const [k, v] of Object.entries(entries || {})) {
          if (v && typeof v === 'object') m.set(k, v);
        }
        this.dimensionFurnaces.set(dim, m);
      }
    }
    this.modifiedBlocks = this.dimBucket(this.dimensionBlocks);
    this.containers = this.dimBucket(this.dimensionContainers);
    this.furnaces = this.dimBucket(this.dimensionFurnaces);
  }

  key(cx, cz) { return `${cx},${cz}`; }

  getChunk(cx, cz) {
    return this.chunks.get(this.key(cx, cz));
  }

  ensureChunk(cx, cz) {
    const k = this.key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = new Chunk(cx, cz);
      this.generator.generateChunk(c);
      // 应用修改
      this.applyModifications(c);
      this.chunks.set(k, c);
      // 光照初始化（含从已加载邻居导入边界光，改动的邻居会被标 dirty）
      this.lightEngine.initChunkLight(c);
    }
    return c;
  }

  applyModifications(chunk) {
    const { cx, cz } = chunk;
    for (const [key, id] of this.modifiedBlocks) {
      const [gx, gy, gz] = key.split(',').map(Number);
      const ccx = Math.floor(gx / CHUNK_SIZE);
      const ccz = Math.floor(gz / CHUNK_SIZE);
      if (ccx === cx && ccz === cz) {
        chunk.set(gx - cx * CHUNK_SIZE, gy, gz - cz * CHUNK_SIZE, id);
      }
    }
  }

  unloadChunk(cx, cz) {
    const k = this.key(cx, cz);
    const c = this.chunks.get(k);
    if (c) {
      if (c.mesh) c.mesh.geometry.dispose();
      if (c.waterMesh) c.waterMesh.geometry.dispose();
      this.chunks.delete(k);
    }
  }

  getBlock(gx, gy, gz) {
    if (gy < 0 || gy >= CHUNK_HEIGHT) return 0;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const c = this.getChunk(cx, cz);
    if (!c) return 0;
    return c.get(gx - cx * CHUNK_SIZE, gy, gz - cz * CHUNK_SIZE);
  }

  setBlock(gx, gy, gz, id, recordMod = true) {
    if (gy < 0 || gy >= CHUNK_HEIGHT) return;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const c = this.ensureChunk(cx, cz);
    const lx = gx - cx * CHUNK_SIZE;
    const lz = gz - cz * CHUNK_SIZE;
    const oldId = c.get(lx, gy, lz);
    c.set(lx, gy, lz, id);
    c.dirty = true;
    if (recordMod) this.modifiedBlocks.set(`${gx},${gy},${gz}`, id);
    if (this.onLocalBlockChange) this.onLocalBlockChange(gx, gy, gz, id);
    // 标记邻居区块 dirty（边界方块）
    if (lx === 0) { const n = this.getChunk(cx - 1, cz); if (n) n.dirty = true; }
    if (lx === CHUNK_SIZE - 1) { const n = this.getChunk(cx + 1, cz); if (n) n.dirty = true; }
    if (lz === 0) { const n = this.getChunk(cx, cz - 1); if (n) n.dirty = true; }
    if (lz === CHUNK_SIZE - 1) { const n = this.getChunk(cx, cz + 1); if (n) n.dirty = true; }
    // 增量光照更新（天光 + 方块光），受影响区块同样被标 dirty
    this.lightEngine.onBlockChanged(gx, gy, gz, oldId, id);
  }

  // 体素光查询（网格构建采样用；未加载区块按维度兜底：主世界露天 15，无天光维度恒定环境光）
  getSkyLight(gx, gy, gz) {
    const amb = this.dimDef.light.hasSkylight ? 15 : (this.dimDef.light.ambientSky || 0);
    if (gy >= CHUNK_HEIGHT) return amb;
    if (gy < 0) return 0;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const c = this.getChunk(cx, cz);
    if (!c || !c.hasLight) return amb;
    return c.getSky(gx - cx * CHUNK_SIZE, gy, gz - cz * CHUNK_SIZE);
  }

  getBlockLightAt(gx, gy, gz) {
    if (gy < 0 || gy >= CHUNK_HEIGHT) return 0;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const c = this.getChunk(cx, cz);
    if (!c || !c.hasLight) return 0;
    return c.getBlockLight(gx - cx * CHUNK_SIZE, gy, gz - cz * CHUNK_SIZE);
  }

  // 全部区块标记脏（视频设置改平滑光照/AO 后重建网格用）
  markAllDirty() {
    for (const [, c] of this.chunks) c.dirty = true;
  }

  // ── 容器（箱子）──
  static containerKey(x, y, z) { return `${x},${y},${z}`; }

  // 打开箱子：优先取已实例化内容；否则确定性生成（结构箱子查 StructureManager 的 chests
  // 注册表拿表名，玩家自放箱子无记录 = 空容器）。生成即写入（打开过的箱子进存档）。
  getOrOpenContainer(x, y, z) {
    const k = World.containerKey(x, y, z);
    if (this.containers.has(k)) return this.containers.get(k);
    const sm = this.generator && this.generator.structureManager;
    const table = (sm && sm.chestTableAt) ? sm.chestTableAt(x, y, z) : null;
    const items = table ? chestLoot(this.seed, table, x, y, z) : new Array(27).fill(null);
    this.containers.set(k, items);
    return items;
  }

  // 远端/账本收敛：直接覆盖容器内容（不触发生成）
  setContainer(x, y, z, items) {
    this.containers.set(World.containerKey(x, y, z), items);
  }

  getContainer(x, y, z) {
    return this.containers.get(World.containerKey(x, y, z)) || null;
  }

  removeContainer(x, y, z) {
    this.containers.delete(World.containerKey(x, y, z));
  }

  // ── 熔炉状态（单机持久化；打开时惰性创建，进度随 Game.update 推进）──
  static furnaceKey(x, y, z) { return `${x},${y},${z}`; }

  getFurnace(x, y, z) {
    return this.furnaces.get(World.furnaceKey(x, y, z)) || null;
  }

  // 取（或建）熔炉状态：新建返回默认空状态并落账本（打开过的熔炉进存档）
  getOrOpenFurnace(x, y, z) {
    const k = World.furnaceKey(x, y, z);
    let st = this.furnaces.get(k);
    if (!st) {
      st = { input: null, fuel: null, output: null, burnTime: 0, burnMax: 0, cookTime: 0 };
      this.furnaces.set(k, st);
    }
    return st;
  }

  removeFurnace(x, y, z) {
    this.furnaces.delete(World.furnaceKey(x, y, z));
  }

  // 获取高度图（用于玩家生成位置；仅主世界生成器有此语义）
  getHeightAt(wx, wz) {
    return this.generator.getBaseHeight(wx, wz);
  }

  getBiomeAt(wx, wz) {
    return this.generator.getBiome(wx, wz);
  }

  // 维度出生点：主世界 (0.5, 地表+2, 0.5)；其他维度由生成器 findSpawn 纯函数求解
  getSpawnPoint() {
    const g = this.generator;
    if (g && typeof g.findSpawn === 'function') return g.findSpawn();
    return { x: 0.5, y: this.getHeightAt(0, 0) + 2, z: 0.5 };
  }

  // 从 top 向下扫描第一个可站立面（实心方块上方的空气格 y；无则 -1）。
  // 维度无关——下界等有天花维度请传 top 限制扫描起点（如 dimDef.spawnScanTop）。
  findGroundY(x, z, top = CHUNK_HEIGHT - 2) {
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let y = Math.min(top, CHUNK_HEIGHT - 2); y >= 1; y--) {
      const def = BlockRegistry.getById(this.getBlock(bx, y, bz));
      if (def && def.solid) return y + 1;
    }
    return -1;
  }
}
