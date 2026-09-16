// gleaner_ring.js -- 拾遗者石环：末地高原小档证物（世界观批次 E2，worldview.md §6.3/§10.3）
// 结构：中央末地砖圆台 + 界纹石碑（end_gleaner 拾遗章）+ 环立碎岛石柱（部分倾倒/缺席＝「碎」）
//      + 两枚卫星碎岛（紫颂残株）+ 存物箱（拾遗者的收藏）。
// 叙事：折跃门来历的证物——拾遗者把界壁间搬来的碎岛石块立成环，环心界碑刻着他们的行记；
//      石环的残缺本身是叙事（拾遗的路上总有些东西再也拼不回去）。
// 不变量：solve 纯函数（布局只由 (seed, cell 锚点) 决定）；place 用临时区块探测
//（generateChunk 关装饰防递归——与末地城同款）；dims: ['end'] 仅末地参与；
// 密度预案 §10.3：cell 14 / attempts 2 / chance 0.5 / salt 7268（与 end_city 6260 错开）。
import { blockId } from './StructureManager.js';
import { Chunk, CHUNK_SIZE } from '../../core/Chunk.js';
import { steleStack } from '../steles.js';

// 选址：锚点列必须是末地高原（end_highlands），±5 八向 9 列下探找暴露地面，
// 全距 ≤6 视为平坦（与末地城同款外岛透镜剖面门；环体小故探针半径比末地城收小）。
function placeRing(gen, ax, az) {
  if (typeof gen.getBiome !== 'function' || gen.getBiome(ax, az) !== 'end_highlands') return -1;
  const cx = Math.floor(ax / CHUNK_SIZE), cz = Math.floor(az / CHUNK_SIZE);
  const c = new Chunk(cx, cz);
  gen.generateChunk(c, false);
  // 锚点恒在区块局部 (8,8)，±5 采样不出块
  const lx0 = ax - cx * CHUNK_SIZE, lz0 = az - cz * CHUNK_SIZE;
  const floors = [];
  for (const [dx, dz] of [[0, 0], [-5, 0], [5, 0], [0, -5], [0, 5], [-5, -5], [5, 5], [-5, 5], [5, -5]]) {
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
  if (floors[8] - floors[0] > 6) return -1;
  return floors[4] + 1;
}

export const GLEANER_RING_DEF = {
  cell: 14,          // 14 区块网格（224 格）——小档证物（§10.3 密度预案）
  attempts: 2,
  chance: 0.5,
  radius: 16,        // 覆盖柱环半径 8 与卫星碎岛（~15.8）
  salt: 7268,
  dims: ['end'],     // 仅末地维度参与（StructureManager 按生成器 dimensionId 过滤）
  place: placeRing,
  solve: solveRing,
};

export function solveRing(rng, ax, groundY, az) {
  const ES = blockId('end_stone');
  const EB = blockId('end_stone_bricks');
  const CP = blockId('chorus_plant');
  const CF = blockId('chorus_flower');
  const CH = blockId('chest');
  const blocks = [];
  const meta = { kind: 'gleaner_ring', chests: [], steles: [], center: [ax, groundY, az] };
  const y0 = groundY;

  // ① 中央圆台：3×3 末地砖拼面（贴岛面）+ 界纹石碑（拾遗章；Build 20 ① 四格形制：
  //    底座紫珀块压圆台、碑/荧石/顶帽紫珀块立其上——露天圆台净空充足）
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) blocks.push([ax + dx, y0 - 1, az + dz, EB]);
  }
  for (const [bx, by, bz, bid] of steleStack(ax, y0, az, 'end')) blocks.push([bx, by, bz, bid]);
  meta.steles.push([ax, y0, az, 'end_gleaner']);

  // ② 存物箱（拾遗者的收藏）：圆台东侧贴地
  blocks.push([ax + 2, y0, az, CH]);
  meta.chests.push([ax + 2, y0, az, 'gleaner_ring']);

  // ③ 碎岛石柱环：半径 8 七位（角度均分，不耗 rng），每位独立掷签：
  //    站立断柱 55% / 倾倒段石 30% / 缺席 15%——环的残缺是叙事（「碎」）
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 0; i < 7; i++) {
    const ang = (i / 7) * Math.PI * 2;
    const px = ax + Math.round(Math.cos(ang) * 8);
    const pz = az + Math.round(Math.sin(ang) * 8);
    blocks.push([px, y0 - 1, pz, ES]); // 末地石底座
    const roll = rng();
    if (roll < 0.55) {
      // 站立断柱：砖身 3-5（高差参差＝搬运后按原样立起，没人对齐）
      const h = 3 + Math.floor(rng() * 3);
      for (let y = y0; y < y0 + h; y++) blocks.push([px, y, pz, EB]);
    } else if (roll < 0.85) {
      // 倾倒段石：沿掷签方向平躺 2-3 块
      const [ddx, ddz] = DIRS[Math.floor(rng() * 4)];
      const len = 2 + Math.floor(rng() * 2);
      for (let k = 0; k < len; k++) blocks.push([px + ddx * k, y0, pz + ddz * k, EB]);
    }
  }

  // ④ 卫星碎岛 ×2：拾遗者搬来的岛体残片（薄圆片与地面同高，中心略厚；紫颂残株）
  for (const [ix, iz] of [[ax + 11, az - 8], [ax - 9, az + 10]]) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (dx * dx + dz * dz > 5) continue;
        blocks.push([ix + dx, y0 - 1, iz + dz, ES]);
        if (dx * dx + dz * dz <= 1) blocks.push([ix + dx, y0 - 2, iz + dz, ES]);
      }
    }
    const ch = 1 + Math.floor(rng() * 2);
    for (let y = y0; y < y0 + ch; y++) blocks.push([ix, y, iz, CP]);
    blocks.push([ix, y0 + ch, iz, CF]);
  }

  return { blocks, meta };
}
