// Portals.js -- 传送门系统（原版式）：框校验 / 点火填充 / 坐标换算 / 落点搜门 / 自动返程门
// 纯 World 操作（setBlock 走账本+光照+联机同步）；不含游戏时序（穿越计时在 Game.updatePortals）。
import { BlockRegistry } from './BlockRegistry.js';
import { CHUNK_HEIGHT } from './Chunk.js';

// 传送门种类：框材料 → 门方块。下界=黑曜石框，天域=萤石框（迭代决策：原版方式）
export const PORTAL_KINDS = {
  nether: { frame: 'obsidian', portal: 'nether_portal' },
  aether: { frame: 'glowstone', portal: 'aether_portal' },
};

// 各维度生效的传送门种类（末地仅 stronghold 末地门，不在此表）
export const DIM_PORTAL_KINDS = {
  overworld: ['nether', 'aether'],
  nether: ['nether'],
  aether: ['aether'],
  end: [],
};

// 到达落点无立足面时垫平台的材料/高度（按目标维度）
export const ARRIVAL_PLATFORM = {
  overworld: { y: 64, block: 'obsidian' },
  nether: { y: 40, block: 'obsidian' },
  aether: { y: 90, block: 'glowstone' },
  end: { y: 64, block: 'obsidian' },
};

export function portalBlockId(kind) {
  const k = PORTAL_KINDS[kind];
  return k ? BlockRegistry.getId(k.portal) : 0;
}

// 坐标换算（原版比例）：下界 1:8，天域 1:1
export function portalTargetPos(kind, fromDim, x, z) {
  if (kind === 'nether') {
    const k = fromDim === 'nether' ? 8 : 1 / 8;
    return { x: Math.floor(x * k), z: Math.floor(z * k) };
  }
  return { x: Math.floor(x), z: Math.floor(z) };
}

// 框校验：从门内候选格出发，在 x/y 或 z/y 平面上找最小包围矩形框。
// 返回 { axis, cells: [[x,y,z],...] } 或 null。矩形内 2×3 起，框边必须完整。
export function detectPortalInterior(world, cx, cy, cz, frameId, maxW = 8, maxH = 8) {
  if (cy < 1 || cy >= CHUNK_HEIGHT - 1) return null;
  for (const axis of ['x', 'z']) {
    const det = detectInPlane(world, cx, cy, cz, frameId, axis, maxW, maxH);
    if (det) return det;
  }
  return null;
}

function detectInPlane(world, x, y, z, frameId, axis, maxW, maxH) {
  const dx = axis === 'x' ? 1 : 0, dz = axis === 'x' ? 0 : 1;
  const at = (u, yy) => world.getBlock(x + u * dx, yy, z + u * dz); // u=沿轴有符号偏移
  // 左右边界：从候选格横向走，穿过空气直到碰到框材；碰其他实体块即失败
  let u0 = 0, u1 = 0;
  for (let i = 0; i < maxW; i++) {
    const id = at(u0 - 1, y);
    if (id === frameId) break;
    if (id !== 0) return null;
    u0--;
  }
  for (let i = 0; i < maxW; i++) {
    const id = at(u1 + 1, y);
    if (id === frameId) break;
    if (id !== 0) return null;
    u1++;
  }
  const w = u1 - u0 + 1;
  if (w < 2 || w > maxW) return null; // 原版最小内宽 2

  const rowAir = (yy) => {
    for (let u = u0; u <= u1; u++) if (at(u, yy) !== 0) return false;
    return true;
  };
  const rowFrame = (yy) => {
    for (let u = u0; u <= u1; u++) if (at(u, yy) !== frameId) return false;
    return true;
  };

  // 底边下探：下方整行是空气则底边下移；最终底边下一行必须全是框材
  let by = y;
  while (by > 1 && rowAir(by - 1)) by--;
  if (!rowFrame(by - 1)) return null;
  // 顶边上探：上方整行是空气则顶边上移；最终顶边上一行必须全是框材
  let ty = y;
  while (ty < CHUNK_HEIGHT - 2 && rowAir(ty + 1)) ty++;
  if (!rowFrame(ty + 1)) return null;
  if (ty - by + 1 < 3 || ty - by + 1 > maxH) return null; // 原版最小内高 3
  // 两侧立柱：每行左右外沿必须是框材
  for (let yy = by; yy <= ty; yy++) {
    if (at(u0 - 1, yy) !== frameId) return null;
    if (at(u1 + 1, yy) !== frameId) return null;
  }
  const cells = [];
  for (let yy = by; yy <= ty; yy++) {
    for (let u = u0; u <= u1; u++) cells.push([x + u * dx, yy, z + u * dz]);
  }
  return { axis, cells };
}

// 点火：把校验出的内部格填满传送门方块
export function fillPortal(world, det, portalId) {
  for (const [x, y, z] of det.cells) world.setBlock(x, y, z, portalId);
}

// 落点搜门：在账本（modifiedBlocks=当前维度桶）中找半径内最近的同类门方块
//（门方块必然经 setBlock 落账：手点或自动建造均如此），返回玩家站位或 null
export function findPortalNear(world, x, z, portalId, r = 24) {
  let best = null, bestD = Infinity;
  for (const [key, id] of world.modifiedBlocks) {
    if (id !== portalId) continue;
    const p = key.split(',');
    const bx = +p[0], bz = +p[2];
    const d = (bx - x) * (bx - x) + (bz - z) * (bz - z);
    if (d <= r * r && d < bestD) {
      bestD = d;
      best = { x: bx + 0.5, y: +p[1], z: bz + 0.5 };
    }
  }
  return best;
}

// 自动返程门：4 宽 × 5 高（内 2×3），沿 x 轴；找落点立地面，无地面则垫平台。
// 返回玩家站位（门内底格中心，进入即有冷却/武装门控保护）。
export function buildReturnPortal(world, kind, bx, bz, { top = CHUNK_HEIGHT - 2, platform = null } = {}) {
  const frameId = BlockRegistry.getId(PORTAL_KINDS[kind].frame);
  const portalId = BlockRegistry.getId(PORTAL_KINDS[kind].portal);
  let baseY = world.findGroundY(bx + 1, bz, top);
  if (baseY <= 0 || baseY + 6 >= top) {
    // 无立足面（虚空/熔岩海/海面列）或贴近扫描顶：按维度档案垫 4×5 平台
    const py = platform ? platform.y : 64;
    const platId = BlockRegistry.getId((platform && platform.block) || PORTAL_KINDS[kind].frame);
    for (let ix = -1; ix <= 4; ix++) {
      for (let iz = -1; iz <= 1; iz++) world.setBlock(bx + ix, py - 1, bz + iz, platId);
    }
    baseY = py;
  }
  for (let ix = 0; ix < 4; ix++) {
    for (let iy = 0; iy < 5; iy++) {
      const border = ix === 0 || ix === 3 || iy === 0 || iy === 4;
      world.setBlock(bx + ix, baseY + iy, bz, border ? frameId : portalId);
    }
  }
  // 两侧清出站立空间（防门嵌进坡体时玩家被埋）
  for (let iy = 1; iy <= 3; iy++) {
    world.setBlock(bx - 1, baseY + iy, bz, 0);
    world.setBlock(bx + 4, baseY + iy, bz, 0);
  }
  return { x: bx + 1.5, y: baseY + 1, z: bz + 0.5 };
}

// 拆门：任一框/门方块被破坏时，洪水清除连通的门方块（防残留半扇门）
export function removeConnectedPortals(world, x, y, z) {
  const ids = new Set(Object.keys(PORTAL_KINDS).map((k) => BlockRegistry.getId(PORTAL_KINDS[k].portal)));
  const stack = [];
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    if (ids.has(world.getBlock(x + dx, y + dy, z + dz))) stack.push([x + dx, y + dy, z + dz]);
  }
  const seen = new Set();
  while (stack.length) {
    const [px, py, pz] = stack.pop();
    const k = `${px},${py},${pz}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!ids.has(world.getBlock(px, py, pz))) continue;
    world.setBlock(px, py, pz, 0);
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      stack.push([px + dx, py + dy, pz + dz]);
    }
  }
}
