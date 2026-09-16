// Chunk.js -- 区块数据结构 16x16x256
import { BlockRegistry } from '../core/BlockRegistry.js';

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 256;
export const SEA_LEVEL = 64;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
    // 体素光：高 4 位天光 sky，低 4 位方块光 block（0..15）
    this.light = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
    this.hasLight = false; // 光照是否已初始化（生成后由 LightEngine 填充）
    this.dirty = true;
    // 最近一次网格构建时缺失的边界邻居方向位（1=-x 2=+x 4=-z 8=+z）：
    // 缺失方向被当空气构建，会多画本应剔除的边界面（CW-1 直线分界根因）；
    // 邻居加载后由 World._finalizeChunk 据此反向触发本区块重建
    this._meshEdgeMask = 0;
    this.mesh = null;
    this.waterMesh = null;
    this.lightMesh = null;
    this.generated = false;
  }

  static index(x, y, z) {
    return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
  }

  get(x, y, z) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT) return 0;
    return this.blocks[Chunk.index(x, y, z)];
  }

  set(x, y, z, id) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= CHUNK_HEIGHT) return;
    this.blocks[Chunk.index(x, y, z)] = id;
    this.dirty = true;
  }

  getSky(x, y, z) {
    return this.light[Chunk.index(x, y, z)] >> 4;
  }

  getBlockLight(x, y, z) {
    return this.light[Chunk.index(x, y, z)] & 15;
  }

  setSky(x, y, z, v) {
    const i = Chunk.index(x, y, z);
    this.light[i] = (this.light[i] & 15) | ((v & 15) << 4);
  }

  setBlockLight(x, y, z, v) {
    const i = Chunk.index(x, y, z);
    this.light[i] = (this.light[i] & 0xf0) | (v & 15);
  }

  // 全局坐标访问（用于跨区块）
  getGlobal(gx, gy, gz) {
    return this.get(gx - this.cx * CHUNK_SIZE, gy, gz - this.cz * CHUNK_SIZE);
  }

  setGlobal(gx, gy, gz, id) {
    this.set(gx - this.cx * CHUNK_SIZE, gy, gz - this.cz * CHUNK_SIZE, id);
  }
}
