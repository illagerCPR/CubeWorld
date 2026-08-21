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
    this.dirty = true;
    this.mesh = null;
    this.waterMesh = null;
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

  // 全局坐标访问（用于跨区块）
  getGlobal(gx, gy, gz) {
    return this.get(gx - this.cx * CHUNK_SIZE, gy, gz - this.cz * CHUNK_SIZE);
  }

  setGlobal(gx, gy, gz, id) {
    this.set(gx - this.cx * CHUNK_SIZE, gy, gz - this.cz * CHUNK_SIZE, id);
  }
}
