// tidefire_hearth.js -- 潮火之炉（世界观批次 N2）：下界·火民的主炉遗迹
// 结构：下界砖平台 + 巨型熔炉主体（炉膛岩浆"煮潮" + 炉口长明灯石）+ 炉侧房（箱×2）
//      + 烬纹石碑×3（炉火/熏黑/哀鸣——章节见 steles.js 烬火纪）。
// 不变量与 fortress 同款：布局只由 (seed, cell 锚点) 决定；place 用临时区块探测
//（关闭装饰防递归），solve 纯函数无区块依赖——任意端/任意顺序逐字节一致（联机根基）。
import { blockId } from './StructureManager.js';
import { clearBox, floorBox, wallsBox } from './StructureKit.js';
import { Chunk, CHUNK_SIZE } from '../../core/Chunk.js';
import { steleStack } from '../steles.js';

const LAVA_SEA_TOP = 33; // 与 fortress 同款支撑下限（熔岩海面之上）

// 选址：锚点区块临时生成（关闭装饰），5 列采样找开阔腔地面（fortress 的简化版——
// 炉体占地小于要塞，聚簇门槛放宽到 3 列）。
function placeHearth(gen, ax, az) {
  const cx = Math.floor(ax / CHUNK_SIZE), cz = Math.floor(az / CHUNK_SIZE);
  const c = new Chunk(cx, cz);
  gen.generateChunk(c, false);
  const lx0 = ax - cx * CHUNK_SIZE, lz0 = az - cz * CHUNK_SIZE;
  const floors = [];
  for (const [dx, dz] of [[0, 0], [-8, 0], [8, 0], [0, -8], [0, 8]]) {
    const lx = lx0 + dx, lz = lz0 + dz;
    let y = 150;
    while (y >= LAVA_SEA_TOP + 2) {
      if (c.get(lx, y, lz) !== 0) { y--; continue; }
      while (y >= LAVA_SEA_TOP && c.get(lx, y, lz) === 0) y--;
      if (y < LAVA_SEA_TOP) break;
      floors.push(y);
      break;
    }
  }
  if (floors.length < 3) return -1;
  floors.sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i < floors.length; i++) {
    const members = floors.filter(f => f >= floors[i] && f <= floors[i] + 8);
    if (!best || members.length > best.length) best = members;
  }
  if (!best || best.length < 3) return -1;
  best.sort((a, b) => a - b);
  return best[best.length >> 1] + 1;
}

export const TIDEFIRE_HEARTH_DEF = {
  cell: 24,          // 24 区块网格（384 格）——稀有设施（§10.1 密度预案，实测后可调）
  attempts: 2,
  chance: 0.45,
  radius: 30,        // 覆盖平台 ±11 与炉体
  salt: 7266,        // 与 fortress(5150) 等既有类型错开
  dims: ['nether'],
  place: placeHearth,
  solve: solveHearth,
};

export function solveHearth(rng, ax, groundY, az) {
  const NB = blockId('nether_bricks');
  const CH = blockId('chest');
  const GS = blockId('glowstone');
  const SS = blockId('soul_sand');
  const MG = blockId('magma_block');
  const blocks = [];
  const meta = { kind: 'tidefire_hearth', chests: [], steles: [] };
  const y0 = groundY;

  // ① 清腔：平台 + 建筑带（外墙余量 2 格），高度 10 格（含烟囱）
  clearBox(blocks, ax - 13, y0 + 1, az - 10, ax + 13, y0 + 10, az + 10);

  // ② 平台 23×17（下界砖）
  floorBox(blocks, ax - 11, az - 8, ax + 11, az + 8, y0, NB);

  // ③ 坠潮沉积：平台西北隅与炉后掺灵魂沙（火民旧河道的暗示，固定点位不耗 rng）
  for (const [sx, sz] of [[ax - 10, az - 7], [ax - 9, az - 7], [ax - 10, az - 6], [ax - 8, az - 8], [ax - 4, az + 7], [ax - 5, az + 7]]) {
    blocks.push([sx, y0, sz, SS]);
  }

  // ④ 围栏（高 1）+ 四角长明灯石柱头
  const fence = (x, z) => blocks.push([x, y0 + 1, z, NB]);
  for (let x = ax - 11; x <= ax + 11; x++) { fence(x, az - 8); fence(x, az + 8); }
  for (let z = az - 7; z <= az + 7; z++) { fence(ax - 11, z); fence(ax + 11, z); }
  for (const [cx2, cz2] of [[ax - 11, az - 8], [ax + 11, az - 8], [ax - 11, az + 8], [ax + 11, az + 8]]) {
    blocks.push([cx2, y0 + 1, cz2, GS]);
  }

  // ⑤ 主炉体（炉心在 ax-4）：7×7 外壳 高 5 + 顶盖，炉门朝东 2×2
  wallsBox(blocks, ax - 7, y0 + 1, az - 3, ax - 1, y0 + 5, az + 3, NB);
  floorBox(blocks, ax - 7, az - 3, ax - 1, az + 3, y0 + 6, NB); // 顶盖
  for (let y = y0 + 1; y <= y0 + 2; y++) for (let z = az - 1; z <= az; z++) {
    blocks.push([ax - 1, y, z, 0]);                             // 东炉门 2 宽 × 2 高
  }
  // 炉膛：3×3 下凹潮面——y0 层挖空、y0-1 铺岩浆块（凝固的"煮沸坠潮"，微光无流动陷阱）
  for (let x = ax - 6; x <= ax - 4; x++) for (let z = az - 1; z <= az + 1; z++) {
    blocks.push([x, y0, z, 0]);
    blocks.push([x, y0 - 1, z, MG]);
  }
  // 炉口长明灯石：顶盖中央开口，荧石悬于膛上方（长明灯石煮潮的意象 + 光源）
  for (const gx of [ax - 6, ax - 5]) {
    blocks.push([gx, y0 + 5, az, 0]);
    blocks.push([gx, y0 + 4, az, GS]);
  }
  // 烟囱：2×2 从顶盖上探 3 格，正对炉口留烟道
  for (let y = y0 + 7; y <= y0 + 9; y++) {
    for (const [tx, tz] of [[ax - 6, az], [ax - 5, az], [ax - 6, az - 1], [ax - 5, az - 1]]) {
      if (y === y0 + 7 && tx === ax - 6 && tz === az) continue;
      blocks.push([tx, y, tz, NB]);
    }
  }

  // ⑥ 烬纹石碑×3（炉前左/右 + 平台南缘临海向）
  meta.steles.push(
    [ax + 1, y0 + 1, az - 2, 'ember_hearth'],
    [ax + 1, y0 + 1, az + 2, 'ember_sooted'],
    [ax - 6, y0 + 1, az + 7, 'ember_mourning'],
  );

  // ⑦ 炉侧房（东侧 5×5）：外墙高 3 + 顶盖，东墙开门，箱×2（tidefire_hearth 表）
  wallsBox(blocks, ax + 7, y0 + 1, az - 2, ax + 11, y0 + 3, az + 2, NB);
  floorBox(blocks, ax + 7, az - 2, ax + 11, az + 2, y0 + 4, NB);
  for (let y = y0 + 1; y <= y0 + 2; y++) blocks.push([ax + 7, y, az, 0]); // 西门
  meta.chests.push([ax + 10, y0 + 1, az - 1, 'tidefire_hearth'], [ax + 10, y0 + 1, az + 1, 'tidefire_hearth']);

  // 支撑柱 2×2：平台四角内收下探到熔岩海之上（fortress 同款）
  const pillar = (px, pz) => {
    for (let y = LAVA_SEA_TOP; y < y0; y++) {
      for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) {
        blocks.push([px + dx, y, pz + dz, NB]);
      }
    }
  };
  for (const px of [ax - 8, ax + 8]) for (const pz of [az - 5, az + 5]) pillar(px, pz);

  // 箱子与石碑方块（声明坐标同步放置；碑位批次 N2 起有真实章节；Build 20 ① 四格形制——
  // 底座岩浆块嵌平台、碑/荧石/顶帽立于其上，clearBox 已清至 y0+10 净空充足）
  for (const c of meta.chests) blocks.push([c[0], c[1], c[2], CH]);
  for (const s of meta.steles) {
    for (const [bx, by, bz, bid] of steleStack(s[0], s[1], s[2], 'nether')) blocks.push([bx, by, bz, bid]);
  }

  return { blocks, meta };
}
