// endCity.js -- 末地城：外岛高原锚点选址（临时区块探测）+ 确定性布局
// 结构：末地砖底台 → 双层紫珀塔（内部阶梯可登）→ 顶层战利品房（箱子×2）
//      + 底台四角紫颂花园；rng 门 40% 附加浮空末地船（货舱箱 + 船长箱保底鞘翅）。
// 不变量：solve 纯函数（布局只由 (seed, cell 锚点) 决定）；place 用临时区块探测
//（generateChunk 关装饰防递归——与下界要塞同款）；dims: ['end'] 仅末地参与。
import { blockId } from './StructureManager.js';
import { fillBox, floorBox, wallsBox } from './StructureKit.js';
import { Chunk, CHUNK_SIZE } from '../../core/Chunk.js';

// 选址：锚点列必须是末地高原（end_highlands），9 列（±6）下探找暴露地面，
// 全距 ≤6 视为平坦（外岛透镜剖面连续单层，无需下界式聚类）。
function placeEndCity(gen, ax, az) {
  if (typeof gen.getBiome !== 'function' || gen.getBiome(ax, az) !== 'end_highlands') return -1;
  const cx = Math.floor(ax / CHUNK_SIZE), cz = Math.floor(az / CHUNK_SIZE);
  const c = new Chunk(cx, cz);
  gen.generateChunk(c, false);
  // 锚点恒在区块局部 (8,8)，±6 采样不出块
  const lx0 = ax - cx * CHUNK_SIZE, lz0 = az - cz * CHUNK_SIZE;
  const floors = [];
  for (const [dx, dz] of [[0, 0], [-6, 0], [6, 0], [0, -6], [0, 6], [-6, -6], [6, 6], [-6, 6], [6, -6]]) {
    const lx = lx0 + dx, lz = lz0 + dz;
    let y = 90;
    let found = -1;
    while (y >= 30) {
      if (c.get(lx, y, lz) !== 0) { y--; continue; }        // 实心体：继续下探
      while (y >= 30 && c.get(lx, y, lz) === 0) y--;        // 空气段：下行到首个实心
      if (y >= 30) found = y;
      break;
    }
    if (found < 0) return -1;
    floors.push(found);
  }
  if (floors.length < 9) return -1;
  floors.sort((a, b) => a - b);
  // 平坦门：全距 ≤8（外岛顶面 fbm 扰动 ±4 的天然落差；结构方块后写覆盖地形，
  // 低侧悬空符合原版末地城的悬浮基座风格，无需逐列地基）
  if (floors[8] - floors[0] > 8) return -1;
  return floors[4] + 1;
}

export const END_CITY_DEF = {
  cell: 16,          // 16 区块网格（256 格）——外岛稀疏 + 群系门双重稀释，网格取小保密度
  attempts: 2,
  chance: 0.6,
  radius: 40,        // 覆盖底台 ±6 与南向末地船（az+18）
  salt: 6260,
  dims: ['end'],     // 仅末地维度参与（StructureManager 按生成器 dimensionId 过滤）
  place: placeEndCity,
  solve: solveEndCity,
};

export function solveEndCity(rng, ax, groundY, az) {
  const PB = blockId('purpur_block');
  const PP = blockId('purpur_pillar');
  const EB = blockId('end_stone_bricks');
  const CP = blockId('chorus_plant');
  const CF = blockId('chorus_flower');
  const CH = blockId('chest');
  const blocks = [];
  const meta = { kind: 'end_city', chests: [], ship: false, shulkerSpawns: [] };
  const y0 = groundY;

  // ① 底台 13×13 末地砖（贴岛面）
  floorBox(blocks, ax - 6, az - 6, ax + 6, az + 6, y0 - 1, EB);

  // ② 塔身两层：7×7 紫珀墙（每层高 4）+ 角柱 + 楼板 + 南门 + 东北角三级阶梯
  for (let layer = 0; layer < 2; layer++) {
    const ly = y0 + layer * 4;
    wallsBox(blocks, ax - 3, ly, az - 3, ax + 3, ly + 3, az + 3, PB);
    for (const [px, pz] of [[ax - 3, az - 3], [ax + 3, az - 3], [ax - 3, az + 3], [ax + 3, az + 3]]) {
      for (let y = ly + 1; y <= ly + 3; y++) blocks.push([px, y, pz, PP]);
    }
    floorBox(blocks, ax - 3, az - 3, ax + 3, az + 3, ly + 4, PB); // 楼板
    // 南门 2×2（门洞穿透两层墙）
    for (let y = ly + 1; y <= ly + 2; y++) {
      blocks.push([ax, y, az - 3, 0]);
      blocks.push([ax - 1, y, az - 3, 0]);
    }
    // 三级阶梯（东北角，上本层楼板）
    for (let h = 1; h <= 3; h++) {
      fillBox(blocks, ax + 2, ly + 1, az + 2 - (h - 1), ax + 2, ly + h, az + 2, PB);
    }
  }

  // ③ 顶层战利品房：9×9 墙 + 紫珀柱顶盖 + 东门 2×2 + 窗 + 2 箱
  const ty = y0 + 8;
  wallsBox(blocks, ax - 4, ty, az - 4, ax + 4, ty + 4, az + 4, PB);
  floorBox(blocks, ax - 4, az - 4, ax + 4, az + 4, ty + 5, PP);
  for (let y = ty + 1; y <= ty + 2; y++) {
    blocks.push([ax + 4, y, az, 0]);
    blocks.push([ax + 4, y, az - 1, 0]);
  }
  blocks.push([ax - 4, ty + 2, az, 0]);   // 西窗
  blocks.push([ax, ty + 2, az - 4, 0]);   // 北窗
  meta.chests.push([ax - 2, ty, az - 2, 'end_city'], [ax + 2, ty, az + 2, 'end_city']);
  meta.shulkerSpawns.push([ax + 2, ty, az - 2]);   // 战利品房内（守箱）
  meta.shulkerSpawns.push([ax + 5, y0, az + 5]);   // 底台东南角（哨兵）

  // ④ 紫颂花园：底台四角（茎 2-4 高 + 顶花）
  for (const [gx, gz] of [[ax - 5, az - 5], [ax + 5, az - 5], [ax - 5, az + 5], [ax + 5, az + 5]]) {
    const h = 2 + Math.floor(rng() * 3);
    for (let y = y0; y < y0 + h; y++) blocks.push([gx, y, gz, CP]);
    blocks.push([gx, y0 + h, gz, CF]);
  }

  // ⑤ 末地船（rng 门 40%）：南向浮空船（甲板 + 舷墙 + 船头 + 船尾楼 + 桅杆）
  if (rng() < 0.4) {
    const sy = y0 + 10;
    const sz0 = az + 12;
    floorBox(blocks, ax - 5, sz0, ax + 5, sz0 + 4, sy, PB);              // 甲板
    wallsBox(blocks, ax - 5, sy + 1, sz0, ax + 5, sy + 1, sz0 + 4, PP);  // 舷墙
    floorBox(blocks, ax - 2, sz0 + 5, ax + 2, sz0 + 6, sy, PB);          // 船头收窄
    blocks.push([ax, sy + 1, sz0 + 6, PP]);
    blocks.push([ax, sy + 2, sz0 + 6, PP]);
    wallsBox(blocks, ax - 2, sy + 1, sz0, ax + 2, sy + 3, sz0 + 2, PB);  // 船尾楼
    for (let y = sy + 4; y <= sy + 8; y++) blocks.push([ax, y, sz0 + 2, PP]); // 桅杆
    meta.chests.push([ax - 3, sy + 1, sz0 + 1, 'end_ship'], [ax + 2, sy + 2, sz0 + 1, 'end_ship_captain']);
    meta.ship = true;
  }

  // 箱子方块（chests 声明坐标同步放 chest，打开时按表惰性生成内容）
  for (const c of meta.chests) blocks.push([c[0], c[1], c[2], CH]);

  return { blocks, meta };
}
