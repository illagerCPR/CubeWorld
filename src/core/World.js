// World.js -- 世界管理：区块加载/卸载、方块访问
import { Chunk, CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from './Chunk.js';
import { TerrainGenerator } from '../world/terrain.js';
import { BlockRegistry } from './BlockRegistry.js';

export class World {
  constructor(seed = 0) {
    this.seed = seed;
    this.chunks = new Map();
    this.generator = new TerrainGenerator(seed);
    this.modifiedBlocks = new Map(); // 存档：全局坐标 -> 方块 id
    this.onLocalBlockChange = null;  // 本地发起方块修改回调 (x,y,z,id)，由 NetworkManager 注册（联机上报）
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
    c.set(gx - cx * CHUNK_SIZE, gy, gz - cz * CHUNK_SIZE, id);
    c.dirty = true;
    if (recordMod) this.modifiedBlocks.set(`${gx},${gy},${gz}`, id);
    if (this.onLocalBlockChange) this.onLocalBlockChange(gx, gy, gz, id);
    // 标记邻居区块 dirty（边界方块）
    const lx = gx - cx * CHUNK_SIZE;
    const lz = gz - cz * CHUNK_SIZE;
    if (lx === 0) { const n = this.getChunk(cx - 1, cz); if (n) n.dirty = true; }
    if (lx === CHUNK_SIZE - 1) { const n = this.getChunk(cx + 1, cz); if (n) n.dirty = true; }
    if (lz === 0) { const n = this.getChunk(cx, cz - 1); if (n) n.dirty = true; }
    if (lz === CHUNK_SIZE - 1) { const n = this.getChunk(cx, cz + 1); if (n) n.dirty = true; }
  }

  // 获取高度图（用于玩家生成位置）
  getHeightAt(wx, wz) {
    return this.generator.getBaseHeight(wx, wz);
  }

  getBiomeAt(wx, wz) {
    return this.generator.getBiome(wx, wz);
  }
}
