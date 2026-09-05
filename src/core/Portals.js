// Portals.js -- 传送门系统（原版式）：框校验 / 点火填充 / 坐标换算 / 落点搜门 / 自动返程门
// 纯 World 操作（setBlock 走账本+光照+联机同步）；不含游戏时序（穿越计时在 Game.updatePortals）。
import { BlockRegistry } from './BlockRegistry.js';
import { CHUNK_HEIGHT } from './Chunk.js';

// 传送门种类：框材料 → 门方块。下界=黑曜石框，天域=萤石框（迭代决策：原版方式）。
// 末地=end_portal（要塞逐框嵌眼激活，无换算坐标；buildReturnPortal 不适用，用 buildEndReturnPad）
// 折跃门=gateway（龙败后生成，末地同维传送：主岛缘 ↔ 外岛缘，角度配对）
export const PORTAL_KINDS = {
  nether: { frame: 'obsidian', portal: 'nether_portal' },
  aether: { frame: 'glowstone', portal: 'aether_portal' },
  end: { frame: null, portal: 'end_portal' },
  gateway: { frame: 'bedrock', portal: 'end_gateway' },
};

// 各维度生效的传送门种类
export const DIM_PORTAL_KINDS = {
  overworld: ['nether', 'aether', 'end'],
  nether: ['nether'],
  aether: ['aether'],
  end: ['end', 'gateway'],
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

// 下探穿悬挂体找可行走空腔立地面：连续 ≥3 格非固体非流体 + 底部实心 → 返回空气底格 y。
// 流体打断空气段（熔岩海/水下列不立门，交由垫平台分支）。无立地面返回 -1。
// 与 World.findGroundY（从 top 首个实心即停）不同：岩层内部启动扫描时不会被贴顶实心骗到。
export function findOpenFloorY(world, x, z, top = CHUNK_HEIGHT - 2) {
  const bx = Math.floor(x), bz = Math.floor(z);
  let airRun = 0;
  for (let y = Math.min(top, CHUNK_HEIGHT - 2) - 1; y >= 1; y--) {
    const def = BlockRegistry.getById(world.getBlock(bx, y, bz));
    if (def && def.solid) { airRun = 0; continue; }
    if (def && def.fluid) { airRun = 0; continue; }
    airRun++;
    if (airRun >= 3) {
      const below = BlockRegistry.getById(world.getBlock(bx, y - 1, bz));
      if (below && below.solid) return y;
    }
  }
  return -1;
}

// 自动返程门：4 宽 × 5 高（内 2×3），沿 x 轴；优先空腔立地面，无地面则垫平台。
// 门厅（门体±1 圈 × 上方 6 层）一律清空气——垫平台落在实心岩内部时同样清出站立空间
//（修复：下界首次到达门嵌进 netherrack，玩家被埋）。
// 返回玩家站位（门内底格中心，进入即有冷却/武装门控保护）。
export function buildReturnPortal(world, kind, bx, bz, { top = CHUNK_HEIGHT - 2, platform = null } = {}) {
  const frameId = BlockRegistry.getId(PORTAL_KINDS[kind].frame);
  const portalId = BlockRegistry.getId(PORTAL_KINDS[kind].portal);
  let baseY = findOpenFloorY(world, bx + 1, bz, top);
  if (baseY <= 0 || baseY + 6 >= top) {
    // 无可行走空腔（全实心/虚空/熔岩海/海面列）或贴近扫描顶：按维度档案垫 4×5 平台
    const py = platform ? platform.y : 64;
    const platId = BlockRegistry.getId((platform && platform.block) || PORTAL_KINDS[kind].frame);
    for (let ix = -1; ix <= 4; ix++) {
      for (let iz = -1; iz <= 1; iz++) world.setBlock(bx + ix, py - 1, bz + iz, platId);
    }
    baseY = py;
  }
  // 门厅清空：先清后建（门体循环随后回填框/门方块）
  for (let ix = -1; ix <= 4; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      for (let iy = 0; iy <= 5; iy++) world.setBlock(bx + ix, baseY + iy, bz + iz, 0);
    }
  }
  for (let ix = 0; ix < 4; ix++) {
    for (let iy = 0; iy < 5; iy++) {
      const border = ix === 0 || ix === 3 || iy === 0 || iy === 4;
      world.setBlock(bx + ix, baseY + iy, bz, border ? frameId : portalId);
    }
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

// ── 末地传送门（要塞 5×5 环：12 框 + 3×3 心，原版逐框嵌眼激活）───────────────

// 统计 (x,z) 所属的 5×5 环：返回 { w0x, w0z, y, eyes, frames } 或 null。
// 点击格必须落在环位上；角格不计；中心需全空气（未激活）。
export function detectEndRing(world, x, y, z, frameId, frameEyeId) {
  // 窗口原点相对点击格可偏移 -4..0（点击格可能落在环的任一边/角位），扫 [-4..4] 全覆盖
  for (let ox = -4; ox <= 0; ox++) {
    for (let oz = -4; oz <= 0; oz++) {
      const w0x = x + ox, w0z = z + oz;
      const rx = x - w0x, rz = z - w0z;
      const onRing = (rx === 0 || rx === 4) !== (rz === 0 || rz === 4); // 边不含角
      if (!onRing) continue;
      let eyes = 0, frames = 0, bad = false;
      for (let ix = 0; ix < 5 && !bad; ix++) {
        for (let iz = 0; iz < 5; iz++) {
          const corner = (ix === 0 || ix === 4) && (iz === 0 || iz === 4);
          const edge = ix === 0 || ix === 4 || iz === 0 || iz === 4;
          if (!edge || corner) continue;
          const id = world.getBlock(w0x + ix, y, w0z + iz);
          if (id === frameEyeId) eyes++;
          else if (id === frameId) frames++;
          else { bad = true; break; }
        }
      }
      if (bad || eyes + frames !== 12) continue;
      // 中心 3×3 必须全空气（未激活环）
      let centerAir = true;
      for (let ix = 1; ix <= 3 && centerAir; ix++) {
        for (let iz = 1; iz <= 3; iz++) {
          if (world.getBlock(w0x + ix, y, w0z + iz) !== 0) { centerAir = false; break; }
        }
      }
      if (centerAir) return { w0x, w0z, y, eyes, frames };
    }
  }
  return null;
}

// 激活：中心 3×3 填 end_portal（调用方已确认 12 眼齐）
export function fillEndPortalCenter(world, ring, portalId) {
  for (let ix = 1; ix <= 3; ix++) {
    for (let iz = 1; iz <= 3; iz++) world.setBlock(ring.w0x + ix, ring.y, ring.w0z + iz, portalId);
  }
}

// 末地到达回程垫：3×3 end_portal + 12 带眼框环（激活态），落在立地面或垫黑曜石台。
// fountain=true 时中央加基岩喷泉柱（龙败返程门标志），站位偏到门环西列防嵌柱。
export function buildEndReturnPad(world, bx, bz, { top = 140, platformY = 64, fountain = false } = {}) {
  const frameId = BlockRegistry.getId('end_portal_frame_eye');
  const portalId = BlockRegistry.getId('end_portal');
  const obsId = BlockRegistry.getId('obsidian');
  const bedId = BlockRegistry.getId('bedrock');
  let baseY = world.findGroundY(bx + 2, bz + 2, top);
  if (baseY <= 0 || baseY + 4 >= top) {
    for (let ix = -1; ix <= 5; ix++) {
      for (let iz = -1; iz <= 5; iz++) world.setBlock(bx + ix, platformY - 1, bz + iz, obsId);
    }
    baseY = platformY;
  }
  for (let ix = 0; ix < 5; ix++) {
    for (let iz = 0; iz < 5; iz++) {
      const corner = (ix === 0 || ix === 4) && (iz === 0 || iz === 4);
      const edge = ix === 0 || ix === 4 || iz === 0 || iz === 4;
      if (!edge) continue;
      world.setBlock(bx + ix, baseY, bz + iz, corner ? obsId : frameId);
    }
  }
  for (let ix = 1; ix <= 3; ix++) {
    for (let iz = 1; iz <= 3; iz++) world.setBlock(bx + ix, baseY, bz + iz, portalId);
  }
  if (fountain) {
    // 中央基岩喷泉柱（3 高，原版龙败基座喷泉意象）；portal 中心格被柱覆盖
    for (let dy = 1; dy <= 3; dy++) world.setBlock(bx + 2, baseY + dy, bz + 2, bedId);
    return { x: bx + 1.5, y: baseY + 1, z: bz + 2.5 }; // 门环西列站位（不嵌柱）
  }
  return { x: bx + 2.5, y: baseY + 1, z: bz + 2.5 };
}

// 折跃门（单座）：3×3 基岩框环绕 + 中心 end_gateway（嵌地面层，非固体可陷入）。
// 无立地面（虚空/岛缘外）→ 垫 3×3 end_stone 码头平台。返回门格坐标。
export function buildGatewayPad(world, bx, bz, { top = 140, platformY = 64 } = {}) {
  const bedId = BlockRegistry.getId('bedrock');
  const gwId = BlockRegistry.getId('end_gateway');
  const esId = BlockRegistry.getId('end_stone');
  let baseY = world.findGroundY(bx, bz, top);
  if (baseY <= 0 || baseY + 4 >= top) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) world.setBlock(bx + dx, platformY - 1, bz + dz, esId);
    }
    baseY = platformY;
  }
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const id = dx === 0 && dz === 0 ? gwId : bedId;
      world.setBlock(bx + dx, baseY, bz + dz, id);
    }
  }
  return { x: bx, y: baseY, z: bz };
}

// 折跃门配对：账本内除自身（6 格内）外，按"角度最近"取另一座门（两端门角度一致）。
// 返回 { x, y, z } 门格坐标或 null（无配对门）。
export function gatewayTarget(world, x, z) {
  const gwId = BlockRegistry.getId('end_gateway');
  const ang = Math.atan2(z, x);
  let best = null, bestDiff = Infinity;
  for (const [key, id] of world.modifiedBlocks) {
    if (id !== gwId) continue;
    const p = key.split(',');
    const bx = +p[0], by = +p[1], bz = +p[2];
    const dx = bx - x, dz = bz - z;
    if (dx * dx + dz * dz < 36) continue; // 排除自身（及同门邻格）
    let diff = Math.abs(Math.atan2(bz, bx) - ang);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff < bestDiff) { bestDiff = diff; best = { x: bx, y: by, z: bz }; }
  }
  return best;
}
