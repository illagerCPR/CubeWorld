// LightEngine.js -- 体素光传播引擎（天光 0-15 + 方块光 0-15，BFS 泛洪 + 增量更新）
// 光照是纯客户端视觉数据，不进存档、不进联机协议；由方块数据可完全重算
import { CHUNK_SIZE, CHUNK_HEIGHT } from './Chunk.js';
import { BlockRegistry } from './BlockRegistry.js';

const DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
];
const DOWN = 3; // DIRS 中向下方向的下标（天光垂直下落无衰减特例用）

export class LightEngine {
  constructor(world) {
    this.world = world;
    this._op = new Uint8Array(256); // 不透明度 LUT：0 透光 / 1 半透（水、树叶等）/ 15 完全遮挡
  }

  _refreshLUT() {
    const op = this._op;
    op[0] = 0;
    for (let id = 1; id < 256; id++) {
      const def = BlockRegistry.getById(id);
      op[id] = def && !def.transparent && !def.fluid ? 15 : def ? 1 : 0;
    }
  }

  _chunkAt(gx, gz) {
    return this.world.getChunk(Math.floor(gx / CHUNK_SIZE), Math.floor(gz / CHUNK_SIZE));
  }

  // 未加载区块按露天处理（天光 15 / 方块光 0），与网格构建的边界兜底一致
  _getSky(gx, gy, gz) {
    if (gy >= CHUNK_HEIGHT) return 15;
    if (gy < 0) return 0;
    const c = this._chunkAt(gx, gz);
    if (!c || !c.hasLight) return 15;
    return c.getSky(gx - c.cx * CHUNK_SIZE, gy, gz - c.cz * CHUNK_SIZE);
  }

  _setSky(gx, gy, gz, v) {
    const c = this._chunkAt(gx, gz);
    if (!c || !c.hasLight) return;
    const lx = gx - c.cx * CHUNK_SIZE, lz = gz - c.cz * CHUNK_SIZE;
    if (c.getSky(lx, gy, lz) === v) return;
    c.setSky(lx, gy, lz, v);
    c.dirty = true; // 光变了 → 网格要重建
  }

  _getBlockL(gx, gy, gz) {
    if (gy < 0 || gy >= CHUNK_HEIGHT) return 0;
    const c = this._chunkAt(gx, gz);
    if (!c || !c.hasLight) return 0;
    return c.getBlockLight(gx - c.cx * CHUNK_SIZE, gy, gz - c.cz * CHUNK_SIZE);
  }

  _setBlockL(gx, gy, gz, v) {
    const c = this._chunkAt(gx, gz);
    if (!c || !c.hasLight) return;
    const lx = gx - c.cx * CHUNK_SIZE, lz = gz - c.cz * CHUNK_SIZE;
    if (c.getBlockLight(lx, gy, lz) === v) return;
    c.setBlockLight(lx, gy, lz, v);
    c.dirty = true;
  }

  // BFS 泛洪填充：从队列各格向外传播（channel 0=天光 1=方块光）
  _flood(channel, qx, qy, qz) {
    const op = this._op;
    const world = this.world;
    let head = 0;
    while (head < qx.length) {
      const x = qx[head], y = qy[head], z = qz[head];
      head++;
      const lvl = channel === 0 ? this._getSky(x, y, z) : this._getBlockL(x, y, z);
      if (lvl <= 1) continue; // 1 已无法向外传播（可能也被 removal 清过）
      for (let d = 0; d < 6; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
        if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
        const nop = op[world.getBlock(nx, ny, nz)];
        if (nop >= 15) continue;
        // 天光垂直下落且穿过全透格：无衰减（MC 直射光柱规则）
        const target = (channel === 0 && d === DOWN && lvl === 15 && nop === 0)
          ? 15
          : lvl - 1 - nop;
        if (target <= 0) continue;
        const cur = channel === 0 ? this._getSky(nx, ny, nz) : this._getBlockL(nx, ny, nz);
        if (cur >= target) continue;
        if (channel === 0) this._setSky(nx, ny, nz, target);
        else this._setBlockL(nx, ny, nz, target);
        qx.push(nx); qy.push(ny); qz.push(nz);
      }
    }
  }

  // 双队列移除：清掉由 (sx,sy,sz) 旧亮度传播出去的全部光，再把"前沿"（有其他来源的格）重新泛洪
  _remove(channel, sx, sy, sz, startLevel) {
    const op = this._op;
    const world = this.world;
    if (channel === 0) this._setSky(sx, sy, sz, 0);
    else this._setBlockL(sx, sy, sz, 0);
    const qx = [sx], qy = [sy], qz = [sz], ql = [startLevel];
    const fx = [], fy = [], fz = [];
    let head = 0;
    while (head < qx.length) {
      const x = qx[head], y = qy[head], z = qz[head], lvl = ql[head];
      head++;
      for (let d = 0; d < 6; d++) {
        const nx = x + DIRS[d][0], ny = y + DIRS[d][1], nz = z + DIRS[d][2];
        if (ny < 0 || ny >= CHUNK_HEIGHT) continue;
        const nl = channel === 0 ? this._getSky(nx, ny, nz) : this._getBlockL(nx, ny, nz);
        if (nl === 0) continue;
        // 天光向下 15 光柱：下方 15 必然由本格直供 → 一并移除
        if (channel === 0 && d === DOWN && nl === lvl && op[world.getBlock(nx, ny, nz)] === 0) {
          this._setSky(nx, ny, nz, 0);
          qx.push(nx); qy.push(ny); qz.push(nz); ql.push(nl);
          continue;
        }
        if (nl < lvl) {
          // 由本格传播而来 → 清除并继续移除
          if (channel === 0) this._setSky(nx, ny, nz, 0);
          else this._setBlockL(nx, ny, nz, 0);
          qx.push(nx); qy.push(ny); qz.push(nz); ql.push(nl);
        } else {
          // nl >= lvl：该格有更强的其他来源 → 前沿，稍后重新泛洪
          fx.push(nx); fy.push(ny); fz.push(nz);
        }
      }
    }
    this._flood(channel, fx, fy, fz);
  }

  // 区块光照全量初始化：天光列播种 + 光源 + 邻居边界导入 + 双通道泛洪
  initChunkLight(chunk) {
    this._refreshLUT();
    chunk.light.fill(0);
    const ox = chunk.cx * CHUNK_SIZE, oz = chunk.cz * CHUNK_SIZE;
    const sx = [], sy = [], sz = [];
    const bx = [], by = [], bz = [];
    const blocks = chunk.blocks;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        let cur = 15;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          const id = blocks[(y * CHUNK_SIZE + z) * CHUNK_SIZE + x];
          const op = this._op[id];
          if (op >= 15) cur = 0;
          else if (!(cur === 15 && op === 0)) cur = Math.max(0, cur - 1 - op);
          if (cur > 1) {
            chunk.setSky(x, y, z, cur);
            sx.push(ox + x); sy.push(y); sz.push(oz + z);
          }
          const def = BlockRegistry.getById(id);
          if (def && def.light >= 13) {
            chunk.setBlockLight(x, y, z, def.light);
            bx.push(ox + x); by.push(y); bz.push(oz + z);
          }
        }
      }
    }
    chunk.hasLight = true;
    // 邻居边界光入队（邻居已初始化时）：泛洪会自然完成 双向 导入/导出
    const nbs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dx, dz] of nbs) {
      const n = this.world.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (!n || !n.hasLight) continue;
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        for (let i = 0; i < CHUNK_SIZE; i++) {
          const nlx = dx === -1 ? CHUNK_SIZE - 1 : (dx === 1 ? 0 : i);
          const nlz = dz === -1 ? CHUNK_SIZE - 1 : (dz === 1 ? 0 : i);
          if (n.getSky(nlx, y, nlz) > 1) {
            sx.push(n.cx * CHUNK_SIZE + nlx); sy.push(y); sz.push(n.cz * CHUNK_SIZE + nlz);
          }
          if (n.getBlockLight(nlx, y, nlz) > 1) {
            bx.push(n.cx * CHUNK_SIZE + nlx); by.push(y); bz.push(n.cz * CHUNK_SIZE + nlz);
          }
        }
      }
    }
    this._flood(0, sx, sy, sz);
    this._flood(1, bx, by, bz);
  }

  // setBlock 后的增量更新（光数组仍为改动前的传播结果）
  onBlockChanged(gx, gy, gz, oldId, newId) {
    this._refreshLUT();
    const op = this._op;
    const chunk = this._chunkAt(gx, gz);
    if (!chunk || !chunk.hasLight) return;
    const lx = gx - chunk.cx * CHUNK_SIZE, lz = gz - chunk.cz * CHUNK_SIZE;
    const oldDef = BlockRegistry.getById(oldId);
    const newDef = BlockRegistry.getById(newId);
    const oldOp = oldId === 0 ? 0 : op[oldId];
    const newOp = newId === 0 ? 0 : op[newId];

    // ---- 方块光通道 ----
    const oldBL = chunk.getBlockLight(lx, gy, lz);
    const wasSource = !!(oldDef && oldDef.light >= 13);
    if (wasSource && oldBL > 0) {
      this._remove(1, gx, gy, gz, oldBL);            // 光源移除/更换：清其光域
    } else if (newOp > oldOp && oldBL > 0) {
      this._remove(1, gx, gy, gz, oldBL);            // 放置遮挡物：清格内传播光
    }
    if (newDef && newDef.light >= 13) {
      chunk.setBlockLight(lx, gy, lz, newDef.light); // 新光源
      this._flood(1, [gx], [gy], [gz]);
    } else if (newOp < oldOp) {
      // 挖开：清格后由 6 邻居重新流入
      chunk.setBlockLight(lx, gy, lz, 0);
      const bx = [], by = [], bz = [];
      for (let d = 0; d < 6; d++) {
        bx.push(gx + DIRS[d][0]); by.push(gy + DIRS[d][1]); bz.push(gz + DIRS[d][2]);
      }
      this._flood(1, bx, by, bz);
    }

    // ---- 天光通道 ----
    const oldSL = chunk.getSky(lx, gy, lz);
    if (newOp > oldOp) {
      if (oldSL > 0) this._remove(0, gx, gy, gz, oldSL); // 放置：含向下 15 光柱消除
    } else if (newOp < oldOp) {
      // 挖开：重播种该列直射天光（差异部分走 removal/add），再让邻居横向流入
      this._reseedColumn(gx, gz);
      const sx = [], sy = [], sz = [];
      for (let d = 0; d < 6; d++) {
        sx.push(gx + DIRS[d][0]); sy.push(gy + DIRS[d][1]); sz.push(gz + DIRS[d][2]);
      }
      this._flood(0, sx, sy, sz);
    }
  }

  // 自上而下重算一列的直射天光，与存量差异：增 → 入泛洪队列；减 → 走移除
  _reseedColumn(gx, gz) {
    const op = this._op;
    const world = this.world;
    const ax = [], ay = [], az = [];
    let incoming = 15;
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      const opCur = op[world.getBlock(gx, y, gz)];
      let target;
      if (opCur >= 15) target = 0;
      else if (incoming === 15 && opCur === 0) target = 15;
      else target = Math.max(0, incoming - 1 - opCur);
      const old = this._getSky(gx, y, gz);
      if (target > old) {
        this._setSky(gx, y, gz, target);
        ax.push(gx); ay.push(y); az.push(gz);
      } else if (target < old) {
        this._remove(0, gx, y, gz, old);
      }
      incoming = target;
    }
    this._flood(0, ax, ay, az);
  }
}
