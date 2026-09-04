// fortress.js -- 下界要塞：锚点网格选址（开阔腔地面探测）+ 确定性布局
// 结构：主平台（熔岩海/空腔之上）→ 主堡（箱子×2）+ 烈焰庭院（无顶开阔区，烈焰人自然生成区）
//      + 东桥→桥头堡（箱子）+ 南桥→尽头脑（箱子）；2×2 支撑柱下探到熔岩海之上。
// 不变量：布局只由 (seed, cell 锚点) 决定；place 用临时区块探测（关闭装饰防递归），
// solve 纯函数无区块依赖——任意端/任意顺序逐字节一致（联机根基）。
import { blockId } from './StructureManager.js';
import { clearBox, floorBox, wallsBox } from './StructureKit.js';
import { Chunk, CHUNK_SIZE } from '../../core/Chunk.js';
import { BlockRegistry } from '../../core/BlockRegistry.js';

const LAVA_SEA_TOP = 33;        // 支撑柱底（熔岩海面之上 2 格）

// 选址：生成锚点所在区块（关闭装饰防递归），9 列采样找开阔腔的可立足地面。
// 每列从 y=150 下探：穿过悬挂实心体（体内不算），落入空气后继续下行到首个实心格
// ——该格上方是刚走过的空气，即"暴露地面"。下界空腔呈多层分布，各列地面高度可能
// 分属不同层：对 9 列地面做 ±8 聚类取最大簇（≥4 列），以簇中位数定位平台
//（groundY = 簇中位数 + 1）；无足够大的簇 → 放弃该尝试（换抖动点重试）。
function placeFortress(gen, ax, az) {
  const cx = Math.floor(ax / CHUNK_SIZE), cz = Math.floor(az / CHUNK_SIZE);
  const c = new Chunk(cx, cz);
  gen.generateChunk(c, false);
  const lx0 = ax - cx * CHUNK_SIZE, lz0 = az - cz * CHUNK_SIZE;
  const floors = [];
  for (const [dx, dz] of [[0, 0], [-6, 0], [6, 0], [0, -6], [0, 6], [-6, -6], [6, 6], [-6, 6], [6, -6]]) {
    const lx = lx0 + dx, lz = lz0 + dz;
    let y = 150;
    while (y >= LAVA_SEA_TOP + 2) {
      if (c.get(lx, y, lz) !== 0) { y--; continue; }           // 实心体内：继续下探
      while (y >= LAVA_SEA_TOP && c.get(lx, y, lz) === 0) y--; // 空气段：下行到首个实心
      if (y < LAVA_SEA_TOP) break;
      floors.push(y);                                          // 首个立足地面（上方是空气）
      break;
    }
  }
  if (floors.length < 4) return -1;
  floors.sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i < floors.length; i++) {
    const members = floors.filter(f => f >= floors[i] && f <= floors[i] + 8);
    if (!best || members.length > best.length) best = members;
  }
  if (!best || best.length < 4) return -1;
  best.sort((a, b) => a - b);
  return best[best.length >> 1] + 1;
}

export const FORTRESS_DEF = {
  cell: 20,          // 20 区块网格（320 格）——与原版下界要塞密度同量级
  attempts: 2,
  chance: 0.6,
  radius: 44,
  salt: 5150,
  dims: ['nether'],  // 仅下界维度参与（StructureManager 按生成器 dimensionId 过滤）
  place: placeFortress,
  solve: solveFortress,
};

export function solveFortress(rng, ax, groundY, az) {
  const B = blockId('nether_bricks');
  const CH = blockId('chest');
  const blocks = [];
  const meta = { kind: 'fortress', chests: [] };
  const y0 = groundY;

  // ① 清腔：平台 + 建筑带（外墙余量 2 格），高度 8 格
  clearBox(blocks, ax - 19, y0 + 1, az - 13, ax + 40, y0 + 9, az + 13);

  // ② 主平台 34×22
  floorBox(blocks, ax - 17, az - 11, ax + 17, az + 11, y0, B);

  // ③ 平台围栏（高 1）：东段留 5 格桥口
  const fence = (x, z) => blocks.push([x, y0 + 1, z, B]);
  for (let x = ax - 17; x <= ax + 17; x++) {
    fence(x, az - 11);
    fence(x, az + 11);
  }
  for (let z = az - 10; z <= az + 10; z++) {
    fence(ax - 17, z);
    if (z < az - 2 || z > az + 2) fence(ax + 17, z); // 东侧桥口
  }

  // ④ 支撑柱 2×2：平台四角内收 + 桥下，下探到熔岩海之上
  const pillar = (px, pz) => {
    for (let y = LAVA_SEA_TOP; y < y0; y++) {
      for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) {
        blocks.push([px + dx, y, pz + dz, B]);
      }
    }
  };
  for (const px of [ax - 12, ax + 12]) for (const pz of [az - 6, az + 6]) pillar(px, pz);
  pillar(ax + 20, az - 1);
  pillar(ax + 28, az - 1);
  pillar(ax, az + 15);

  // ⑤ 主堡（西端）：外墙高 5 + 顶盖，东墙开门，南北墙开窗
  wallsBox(blocks, ax - 16, y0 + 1, az - 5, ax - 6, y0 + 5, az + 5, B);
  floorBox(blocks, ax - 16, az - 5, ax - 6, az + 5, y0 + 6, B); // 顶盖
  for (let y = y0 + 3; y <= y0 + 4; y++) for (let z = az - 1; z <= az; z++) {
    blocks.push([ax - 6, y, z, 0]);                             // 东门 2 宽 × 2 高
  }
  for (let x = ax - 14; x <= ax - 8; x += 3) {
    blocks.push([x, y0 + 4, az - 5, 0]);                        // 北窗
    blocks.push([x, y0 + 4, az + 5, 0]);                        // 南窗
  }
  meta.chests.push([ax - 14, y0 + 1, az - 3, 'fortress'], [ax - 8, y0 + 1, az + 3, 'fortress']);

  // ⑥ 烈焰庭院（中东段）：clearBox 已清空，保持无顶开阔——烈焰人自然生成区
  for (const [cx2, cz2] of [[ax + 6, az - 4], [ax + 15, az - 4], [ax + 6, az + 4], [ax + 15, az + 4]]) {
    for (let y = y0 + 1; y <= y0 + 3; y++) blocks.push([cx2, y, cz2, B]); // 角柱装饰
  }

  // ⑦ 东桥 → 桥头堡：桥面宽 5 + 两侧栏
  floorBox(blocks, ax + 18, az - 2, ax + 32, az + 2, y0, B);
  for (let x = ax + 18; x <= ax + 32; x++) { blocks.push([x, y0 + 1, az - 2, B]); blocks.push([x, y0 + 1, az + 2, B]); }
  wallsBox(blocks, ax + 33, y0 + 1, az - 2, ax + 37, y0 + 4, az + 2, B);
  floorBox(blocks, ax + 33, az - 2, ax + 37, az + 2, y0 + 5, B);
  meta.chests.push([ax + 35, y0 + 1, az, 'fortress']);

  // ⑧ 南桥 → 尽头脑：桥面宽 3 + 两侧栏 + 尽头 5×5 平台与箱子
  floorBox(blocks, ax - 1, az + 12, ax + 1, az + 20, y0, B);
  for (let z = az + 12; z <= az + 20; z++) { blocks.push([ax - 1, y0 + 1, z, B]); blocks.push([ax + 1, y0 + 1, z, B]); }
  floorBox(blocks, ax - 2, az + 18, ax + 2, az + 22, y0, B);
  for (let x = ax - 2; x <= ax + 2; x++) { blocks.push([x, y0 + 1, az + 22, B]); }
  meta.chests.push([ax, y0 + 1, az + 20, 'fortress']);

  // 箱子方块（chests 声明坐标同步放 chest，T5 打开时按表惰性生成内容）
  for (const c of meta.chests) blocks.push([c[0], c[1], c[2], CH]);

  return { blocks, meta };
}
