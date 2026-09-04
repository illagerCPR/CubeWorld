// World.js -- 世界管理：区块加载/卸载、方块访问、体素光照、容器（箱子）数据
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from './Chunk.js';
import { TerrainGenerator } from '../world/terrain.js';
import { BlockRegistry } from './BlockRegistry.js';
import { LightEngine } from './LightEngine.js';
import { chestLoot } from '../world/loot.js';

export class World {
  constructor(seed = 0) {
    this.seed = seed;
    this.chunks = new Map();
    this.generator = new TerrainGenerator(seed);
    this.modifiedBlocks = new Map(); // 存档：全局坐标 -> 方块 id
    // T5 容器："x,y,z" -> 27 槽数组。打开时惰性生成（结构箱子按 (seed,表名,坐标) 确定性 loot），
    // 玩家改动即落 Map（存档持久化；联机经 container_set 广播收敛）
    this.containers = new Map();
    this.onLocalBlockChange = null;  // 本地发起方块修改回调 (x,y,z,id)，由 NetworkManager 注册（联机上报）
    this.lightEngine = new LightEngine(this); // 体素光照（纯客户端视觉，不进存档/协议）
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

  // 体素光查询（网格构建采样用；未加载区块按露天/无方块光兜底）
  getSkyLight(gx, gy, gz) {
    if (gy >= CHUNK_HEIGHT) return 15;
    if (gy < 0) return 0;
    const cx = Math.floor(gx / CHUNK_SIZE);
    const cz = Math.floor(gz / CHUNK_SIZE);
    const c = this.getChunk(cx, cz);
    if (!c || !c.hasLight) return 15;
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

  // 获取高度图（用于玩家生成位置）
  getHeightAt(wx, wz) {
    return this.generator.getBaseHeight(wx, wz);
  }

  getBiomeAt(wx, wz) {
    return this.generator.getBiome(wx, wz);
  }
}
