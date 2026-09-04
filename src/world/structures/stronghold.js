// stronghold.js -- 要塞：环带 3 座（seed 派生方位/半径）+ 风化地表入口 + 地下房间网络
// 结构：入口竖井（苔化/裂纹混排石砖）→ 十字枢纽 → 四向走廊 → 图书馆/传送门室/石柱厅/储藏室
// 腔体 = 挖空天然石头 + 砖砌地板/顶棚，墙面由天然石头担任 + 局部砖饰 + 火把照明。
import { blockId, hash32 } from './StructureManager.js';
import { clearBox, floorBox } from './StructureKit.js';
import { CHUNK_SIZE } from '../../core/Chunk.js';

const RING_COUNT = 3;

// 环带锚点：seed 派生方位角（120° 间隔 ± 抖动）与半径（700-900）；
// 仅当环带点落在该 cell 的区块范围内时返回锚点（else null）
function ringAnchor(sm, ccx, ccz) {
  const cell = 48;
  for (let k = 0; k < RING_COUNT; k++) {
    const h = hash32(sm.seed, k, 7777, 202);
    const angle = k * (Math.PI * 2 / 3) + (((h & 1023) / 1024) - 0.5) * 0.6;
    const radius = 700 + ((h >>> 10) & 255);
    const wx = Math.round(Math.cos(angle) * radius);
    const wz = Math.round(Math.sin(angle) * radius);
    const ckx = Math.floor(wx / CHUNK_SIZE);
    const ckz = Math.floor(wz / CHUNK_SIZE);
    if (ckx >= ccx * cell && ckx < (ccx + 1) * cell &&
        ckz >= ccz * cell && ckz < (ccz + 1) * cell) {
      return { cx: ckx, cz: ckz };
    }
  }
  return null;
}

export const STRONGHOLD_DEF = {
  cell: 48,          // 扫描粒度（环带点 ~900 格间距，48 区块 cell 保证 3×3 扫描覆盖）
  radius: 46,
  chance: 1,         // anchorForCell 覆盖时概率门不生效
  salt: 202,
  anchorForCell: ringAnchor,
  place: (gen, ax, az) => {
    const ground = gen.getBaseHeight(ax, az);
    if (ground < 60 || ground > 100) return -1; // 深水/极峰不放
    return ground;
  },
  solve: solveStronghold,
};

export function solveStronghold(rng, ax, surfaceY, az, gen) {
  const ID = {
    brick: blockId('stone_bricks'), mossy: blockId('mossy_stone_bricks'),
    cracked: blockId('cracked_stone_bricks'), torch: blockId('torch'),
    shelf: blockId('bookshelf'), frame: blockId('end_portal_frame'),
    chest: blockId('chest'),
  };
  const blocks = [];
  const meta = { kind: 'stronghold', chests: [] };

  // 结构范围内的最低地表（±40 步长 5 采样）：枢纽深度须低于最低地形，否则坡地/崖边
  // 房间会戳出地表（曾实测东侧骤降 38 格导致房间穿出山体——步长 10 的粗网格抓不到局部洼地）
  let minGround = surfaceY;
  for (let dx = -40; dx <= 40; dx += 5) {
    for (let dz = -40; dz <= 40; dz += 5) {
      const h = gen.getBaseHeight(ax + dx, az + dz);
      if (h < minGround) minGround = h;
    }
  }

  // 风化混排：per-block 确定性哈希 → 14% 苔化 / 12% 裂纹 / 其余完好的石砖
  const w = (x, y, z) => {
    const h = hash32(0, x * 31 + y, z * 17 + y, 913) % 100;
    if (h < 14) return ID.mossy;
    if (h < 26) return ID.cracked;
    return ID.brick;
  };
  const set = (x, y, z, id) => blocks.push([x, y, z, id]);

  const hubY = Math.max(14, Math.min(38, Math.min(surfaceY - 26, minGround - 9)));

  // 挖一个砖砌房间：清腔 + 地板/顶棚风化石砖
  const room = (x0, z0, x1, z1, y0, y1) => {
    clearBox(blocks, x0, y0, z0, x1, y1, z1);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        blocks.push([x, y0 - 1, z, w(x, y0 - 1, z)]);
        blocks.push([x, y1 + 1, z, w(x, y1 + 1, z)]);
      }
    }
  };

  // ── 入口：地表风化残迹 + 竖井直通枢纽 ──────────────────────────────────
  clearBox(blocks, ax - 1, surfaceY + 1, az - 1, ax + 1, surfaceY + 8, az + 1); // 清竖井上方（含树）
  clearBox(blocks, ax - 1, hubY, az - 1, ax + 1, surfaceY, az + 1);
  for (let y = hubY; y <= surfaceY; y++) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue; // 井壁（3×3 腔外圈）
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        set(ax + dx, y, az + dz, w(ax + dx, y, az + dz));
      }
    }
  }
  // 井口风化残迹：外圈 5×5 随机残缺（rng 决定缺口），重苔化
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue;
      if (rng() < 0.35) continue; // 风化缺口
      set(ax + dx, surfaceY + 1, az + dz, rng() < 0.6 ? ID.mossy : w(ax + dx, surfaceY + 1, az + dz));
    }
  }
  set(ax + 2, surfaceY + 1, az + 2, ID.torch); // 井口火把（地表可见标识）

  // ── 十字枢纽 9×9×5 ────────────────────────────────────────────────────
  room(ax - 4, az - 4, ax + 4, az + 4, hubY, hubY + 4);
  for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    for (let y = hubY; y <= hubY + 4; y++) set(ax + dx, y, az + dz, w(ax + dx, y, az + dz)); // 四角柱
  }
  // 中央 2×2 石砖柱（腔体已挖空，直接落柱）
  for (let y = hubY; y <= hubY + 3; y++) {
    set(ax, y, az, w(ax, y, az)); set(ax + 1, y, az, w(ax + 1, y, az));
    set(ax, y, az + 1, w(ax, y, az + 1)); set(ax + 1, y, az + 1, w(ax + 1, y, az + 1));
  }
  set(ax - 1, hubY, az, ID.torch); set(ax + 2, hubY, az + 1, ID.torch);
  set(ax, hubY, az - 1, ID.torch); set(ax + 1, hubY, az + 2, ID.torch);
  set(ax - 2, hubY, az - 2, ID.chest); // T5：枢纽补给箱（西北角，与角柱/中央柱不重叠）
  meta.chests.push([ax - 2, hubY, az - 2, 'stronghold_hub']);

  // ── 四向走廊 + 尽头房间（变体固定序：图书馆/传送门/石柱厅/储藏）────────
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const variants = ['library', 'portal', 'hall', 'storage'];
  for (let k = 0; k < 4; k++) {
    const [dx, dz] = dirs[k];
    const len = 14 + Math.floor(rng() * 8);
    const sx = ax + dx * 5, sz = az + dz * 5;
    const ex = ax + dx * (5 + len), ez = az + dz * (5 + len);
    // 走廊：3 宽 4 高
    const cx0 = Math.min(sx, ex) - (dx === 0 ? 1 : 0), cx1 = Math.max(sx, ex) + (dx === 0 ? 1 : 0);
    const cz0 = Math.min(sz, ez) - (dz === 0 ? 1 : 0), cz1 = Math.max(sz, ez) + (dz === 0 ? 1 : 0);
    clearBox(blocks, cx0, hubY, cz0, cx1, hubY + 3, cz1);
    for (let x = cx0; x <= cx1; x++) {
      for (let z = cz0; z <= cz1; z++) {
        blocks.push([x, hubY - 1, z, w(x, hubY - 1, z)]);
        blocks.push([x, hubY + 4, z, w(x, hubY + 4, z)]);
      }
    }
    // 走廊火把（沿一侧每 6 格）
    for (let t = 4; t <= len; t += 6) {
      const px = dx === 0 ? ax + 2 : ax + dx * t;
      const pz = dz === 0 ? az + dz * t : az + 2;
      set(px, hubY, pz, ID.torch);
    }

    // 尽头房间
    const mx = ax + dx * (5 + len + 5), mz = az + dz * (5 + len + 5);
    const variant = variants[k];
    if (variant === 'library') {
      const hw = 5, hh = 6;
      room(mx - hw, mz - hw, mx + hw, mz + hw, hubY, hubY + hh);
      // 书架墙：内圈 y+1..y+3
      for (let x = mx - hw + 1; x <= mx + hw - 1; x++) {
        for (let y = hubY + 1; y <= hubY + 3; y++) {
          set(x, y, mz - hw + 1, ID.shelf);
          set(x, y, mz + hw - 1, ID.shelf);
        }
      }
      for (let z = mz - hw + 2; z <= mz + hw - 2; z++) {
        for (let y = hubY + 1; y <= hubY + 3; y++) {
          set(mx - hw + 1, y, z, ID.shelf);
          set(mx + hw - 1, y, z, ID.shelf);
        }
      }
      for (const [tx, tz] of [[mx - 3, mz - 3], [mx + 3, mz - 3], [mx - 3, mz + 3], [mx + 3, mz + 3]]) {
        set(tx, hubY, tz, ID.torch);
      }
      set(mx, hubY, mz, ID.chest); // T5：图书馆中央战利品
      meta.chests.push([mx, hubY, mz, 'stronghold_library']);
    } else if (variant === 'portal') {
      const hw = 5, hh = 6;
      room(mx - hw, mz - 4, mx + hw, mz + 4, hubY, hubY + hh);
      // 高台 5×5 + 台阶边
      floorBox(blocks, mx - 2, mz - 2, mx + 2, mz + 2, hubY, ID.brick);
      for (let x = mx - 2; x <= mx + 2; x++) {
        for (let z = mz - 2; z <= mz + 2; z++) set(x, hubY, z, w(x, hubY, z));
      }
      // 末地传送门框架环（3×3 心 + 12 框，未激活装饰）
      const py = hubY + 1;
      for (let i = -1; i <= 1; i++) {
        set(mx + i, py, mz - 2, ID.frame);
        set(mx + i, py, mz + 2, ID.frame);
        set(mx - 2, py, mz + i, ID.frame);
        set(mx + 2, py, mz + i, ID.frame);
      }
      meta.portal = [mx, py + 1, mz];
      for (const [tx, tz] of [[mx - 4, mz - 3], [mx + 4, mz - 3], [mx - 4, mz + 3], [mx + 4, mz + 3]]) {
        set(tx, hubY, tz, ID.torch);
      }
    } else if (variant === 'hall') {
      const hw = 4, hh = 3;
      room(mx - hw, mz - hw, mx + hw, mz + hw, hubY, hubY + hh);
      // 石柱阵：每 3 格一根
      for (let x = mx - hw + 2; x <= mx + hw - 2; x += 3) {
        for (let z = mz - hw + 2; z <= mz + hw - 2; z += 3) {
          for (let y = hubY; y <= hubY + hh; y++) set(x, y, z, w(x, y, z));
          set(x, hubY, z + 1, ID.torch);
        }
      }
    } else {
      const hw = 3, hh = 3;
      room(mx - hw, mz - hw, mx + hw, mz + hw, hubY, hubY + hh);
      // 储藏：沿墙书架 + 火把
      for (let x = mx - hw + 1; x <= mx + hw - 1; x++) {
        set(x, hubY, mz - hw + 1, ID.shelf);
        set(x, hubY + 1, mz - hw + 1, ID.shelf);
      }
      set(mx, hubY, mz, ID.torch);
      set(mx - 1, hubY, mz + 1, ID.chest); // T5：储藏室战利品×2（避开局侧书架行）
      set(mx + 1, hubY, mz - 1, ID.chest);
      meta.chests.push([mx - 1, hubY, mz + 1, 'stronghold_storage']);
      meta.chests.push([mx + 1, hubY, mz - 1, 'stronghold_storage']);
    }

    // 支廊 + 死端小室（走廊中点垂直方向，rng 决定左右）
    if (k % 2 === 0) {
      const midT = 5 + Math.floor(len / 2);
      const [pdx, pdz] = dx === 0 ? [rng() < 0.5 ? 1 : -1, 0] : [0, rng() < 0.5 ? 1 : -1];
      const px = ax + dx * midT, pz = az + dz * midT;
      const bx = px + pdx * 6, bz = pz + pdz * 6;
      const bx0 = Math.min(px, bx) - (pdx === 0 ? 1 : 0), bx1 = Math.max(px, bx) + (pdx === 0 ? 1 : 0);
      const bz0 = Math.min(pz, bz) - (pdz === 0 ? 1 : 0), bz1 = Math.max(pz, bz) + (pdz === 0 ? 1 : 0);
      clearBox(blocks, bx0, hubY, bz0, bx1, hubY + 3, bz1);
      for (let x = bx0; x <= bx1; x++) {
        for (let z = bz0; z <= bz1; z++) {
          blocks.push([x, hubY - 1, z, w(x, hubY - 1, z)]);
          blocks.push([x, hubY + 4, z, w(x, hubY + 4, z)]);
        }
      }
      room(bx + pdx * 2 - 2, bz + pdz * 2 - 2, bx + pdx * 2 + 2, bz + pdz * 2 + 2, hubY, hubY + 3);
      set(bx + pdx * 2, hubY, bz + pdz * 2, ID.torch);
    }
  }

  return { blocks, meta };
}
