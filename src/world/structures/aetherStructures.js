// aetherStructures.js -- 天域三结构：天空神殿（水晶秘境稀有大型）/ 浮空瞭望塔（草地常见小型）
// / 天域沉船（浮空残骸稀有）。选址走 endCity 同款"临时区块 + 9 列下探 + 平坦门"；
// solve 纯函数 of (rng, ax, groundY, az)——布局只由 (seed, cell 锚点) 决定（联机根基）；
// dims: ['aether'] 仅天域参与（StructureManager.dimMatches 过滤）。
import { blockId } from './StructureManager.js';
import { fillBox, floorBox, wallsBox } from './StructureKit.js';
import { Chunk, CHUNK_SIZE } from '../../core/Chunk.js';

// 浮岛下探选址：锚点列群系门 + 9 列（±probeR）下探取暴露地面，全距 ≤ maxSlope 视为平坦。
// 返回 groundY（立地面首格空气层）或 -1。锚点恒在区块局部 (8,8)，±6 采样不出块。
function probeIsland(gen, ax, az, biomes, maxSlope = 8, probeR = 6) {
  if (typeof gen.getBiome !== 'function') return -1;
  if (!biomes.includes(gen.getBiome(ax, az))) return -1;
  const cx = Math.floor(ax / CHUNK_SIZE), cz = Math.floor(az / CHUNK_SIZE);
  const c = new Chunk(cx, cz);
  gen.generateChunk(c, false); // 关装饰防递归/加速（选址只要岛剖面）
  const lx0 = ax - cx * CHUNK_SIZE, lz0 = az - cz * CHUNK_SIZE;
  if (lx0 < probeR || lx0 >= CHUNK_SIZE - probeR || lz0 < probeR || lz0 >= CHUNK_SIZE - probeR) return -1;
  const floors = [];
  for (const [dx, dz] of [[0, 0], [-probeR, 0], [probeR, 0], [0, -probeR], [0, probeR], [-probeR, -probeR], [probeR, probeR], [-probeR, probeR], [probeR, -probeR]]) {
    const lx = lx0 + dx, lz = lz0 + dz;
    let y = 130, found = -1;
    while (y >= 30) {
      if (c.get(lx, y, lz) !== 0) { y--; continue; }   // 实心体内：继续下探
      while (y >= 30 && c.get(lx, y, lz) === 0) y--;   // 空气段：下行到首个实心
      if (y >= 30) found = y;
      break;
    }
    if (found < 0) return -1;
    floors.push(found);
  }
  if (floors.length < 9) return -1;
  floors.sort((a, b) => a - b);
  if (floors[8] - floors[0] > maxSlope) return -1;
  return floors[4] + 1;
}

function placeTemple(gen, ax, az) { return probeIsland(gen, ax, az, ['crystal']); }
function placeTower(gen, ax, az) { return probeIsland(gen, ax, az, ['verdant', 'autumn']); }
function placeShip(gen, ax, az) { return probeIsland(gen, ax, az, ['verdant', 'autumn', 'frost', 'crystal']); }

// ── 天空神殿：白水晶底台 + 石砖殿身 + 石英尖顶 + 四角晶柱 ────────────────
export function solveTemple(rng, ax, y0, az) {
  const QB = blockId('quartz_block');
  const SB = blockId('stone_bricks');
  const GL = blockId('glowstone');
  const SL = blockId('sea_lantern');
  const CH = blockId('chest');
  const blocks = [];
  const meta = { kind: 'aether_temple', chests: [] };

  // ① 底台 15×15 白石英（悬浮感基座）+ 台面 11×11
  floorBox(blocks, ax - 7, az - 7, ax + 7, az + 7, y0 - 1, QB);
  floorBox(blocks, ax - 5, az - 5, ax + 5, az + 5, y0, QB);

  // ② 殿身 9×9 石砖墙高 4 + 白石英角柱 + 东门 2×2
  wallsBox(blocks, ax - 4, y0 + 1, az - 4, ax + 4, y0 + 4, az + 4, SB);
  for (const [px, pz] of [[ax - 4, az - 4], [ax + 4, az - 4], [ax - 4, az + 4], [ax + 4, az + 4]]) {
    for (let y = y0 + 1; y <= y0 + 4; y++) blocks.push([px, y, pz, QB]);
  }
  for (let y = y0 + 1; y <= y0 + 2; y++) {
    blocks.push([ax + 4, y, az, 0]);
    blocks.push([ax + 4, y, az - 1, 0]);
  }

  // ③ 内部：海晶灯地砖十字 + 檐口 11×11 白石英 + 尖顶石英柱（荧石顶）
  for (let d = -2; d <= 2; d++) {
    blocks.push([ax + d, y0, az, SL]);
    blocks.push([ax, y0, az + d, SL]);
  }
  floorBox(blocks, ax - 5, az - 5, ax + 5, az + 5, y0 + 5, QB);
  for (let y = y0 + 6; y <= y0 + 9; y++) blocks.push([ax, y, az, QB]);
  blocks.push([ax, y0 + 10, az, GL]);

  // ④ 四角晶柱（±6，高 4-6，荧石顶）呼应水晶秘境
  for (const [gx, gz] of [[ax - 6, az - 6], [ax + 6, az - 6], [ax - 6, az + 6], [ax + 6, az + 6]]) {
    const h = 4 + Math.floor(rng() * 3);
    for (let y = y0; y <= y0 + h; y++) blocks.push([gx, y, gz, QB]);
    blocks.push([gx, y0 + h + 1, gz, GL]);
  }

  // ⑤ 战利品箱×2（殿内对角）+ 荧石角灯
  meta.chests.push([ax - 2, y0 + 1, az - 2, 'aether_temple'], [ax + 2, y0 + 1, az + 2, 'aether_temple']);
  for (const [lx, lz] of [[ax - 3, az + 3], [ax + 3, az - 3]]) blocks.push([lx, y0 + 4, lz, GL]);
  for (const c of meta.chests) blocks.push([c[0], c[1], c[2], CH]);

  return { blocks, meta };
}

// ── 浮空瞭望塔：白桦木三层塔 + 顶部瞭望台 ────────────────────────────────
export function solveTower(rng, ax, y0, az) {
  const BP = blockId('birch_planks');
  const BL = blockId('birch_log');
  const GL = blockId('glowstone');
  const CH = blockId('chest');
  const TC = blockId('torch');
  const blocks = [];
  const meta = { kind: 'aether_tower', chests: [] };

  // ① 基座 7×7 + 台面 5×5
  floorBox(blocks, ax - 3, az - 3, ax + 3, az + 3, y0 - 1, BP);
  floorBox(blocks, ax - 2, az - 2, ax + 2, az + 2, y0, BP);

  // ② 塔身 5×5 高 8：白桦木板墙 + 原木角柱 + 两层楼板 + 南门
  wallsBox(blocks, ax - 2, y0 + 1, az - 2, ax + 2, y0 + 8, az + 2, BP);
  for (const [px, pz] of [[ax - 2, az - 2], [ax + 2, az - 2], [ax - 2, az + 2], [ax + 2, az + 2]]) {
    for (let y = y0 + 1; y <= y0 + 8; y++) blocks.push([px, y, pz, BL]);
  }
  for (const ly of [y0 + 3, y0 + 6]) floorBox(blocks, ax - 2, az - 2, ax + 2, az + 2, ly, BP);
  for (let y = y0 + 1; y <= y0 + 2; y++) {
    blocks.push([ax, y, az - 2, 0]);
    blocks.push([ax - 1, y, az - 2, 0]);
  }
  // 每层三级阶梯（东南角，上本层楼板）
  for (const ly of [y0 + 1, y0 + 4, y0 + 7]) {
    for (let h = 1; h <= 3; h++) {
      fillBox(blocks, ax + 1, ly, az + 2 - (h - 1), ax + 1, ly + h - 1, az + 2, BP);
    }
  }
  blocks.push([ax - 1, y0 + 2, az + 1, TC]); // 中层照明

  // ③ 瞭望台 y0+9：7×7 地板 + 围边矮柱（荧石顶）+ 箱
  floorBox(blocks, ax - 3, az - 3, ax + 3, az + 3, y0 + 9, BP);
  for (const [px, pz] of [[ax - 3, az - 3], [ax + 3, az - 3], [ax - 3, az + 3], [ax + 3, az + 3], [ax, az - 3], [ax, az + 3], [ax - 3, az], [ax + 3, az]]) {
    blocks.push([px, y0 + 10, pz, BL]);
  }
  for (const [px, pz] of [[ax - 3, az - 3], [ax + 3, az - 3], [ax - 3, az + 3], [ax + 3, az + 3]]) {
    blocks.push([px, y0 + 11, pz, GL]);
  }
  meta.chests.push([ax, y0 + 10, az + 1, 'aether_tower']);
  blocks.push([ax, y0 + 10, az + 1, CH]);
  blocks.push([ax, y0 + 11, az - 2, TC]);

  return { blocks, meta };
}

// ── 天域沉船：浮空桦木残骸（舷墙缺口 + 断桅）────────────────────────────
export function solveShip(rng, ax, y0, az) {
  const BP = blockId('birch_planks');
  const BL = blockId('birch_log');
  const QB = blockId('quartz_block');
  const CH = blockId('chest');
  const blocks = [];
  const meta = { kind: 'aether_ship', chests: [] };
  const sy = y0 + 12 + Math.floor(rng() * 5); // 浮空 12-16 格：残骸悬于岛上
  const sz0 = az - 2;

  // ① 甲板 11×5 + 船头收窄 + 船首柱
  floorBox(blocks, ax - 5, sz0, ax + 5, sz0 + 4, sy, BP);
  floorBox(blocks, ax - 2, sz0 + 5, ax + 2, sz0 + 6, sy, BP);
  blocks.push([ax, sy + 1, sz0 + 6, BL]);
  blocks.push([ax, sy + 2, sz0 + 6, BL]);

  // ② 船尾楼 5×3 白桦木板（舱室）+ 顶板
  wallsBox(blocks, ax - 2, sy + 1, sz0, ax + 2, sy + 2, sz0 + 2, BP);
  floorBox(blocks, ax - 2, sz0, ax + 2, sz0 + 2, sy + 3, BP);
  blocks.push([ax + 2, sy + 1, sz0 + 2, 0]); // 东侧舱门

  // ③ 舷墙：两长边 birch_log 高 1，hash 门随机去 30%（残破感，rng 派生确定性流）
  for (let dx = -5; dx <= 5; dx++) {
    if (rng() < 0.3) continue;
    blocks.push([ax + dx, sy + 1, sz0, BL]);
    if (rng() < 0.7) blocks.push([ax + dx, sy + 1, sz0 + 4, BL]);
  }

  // ④ 断桅 + 船底倒挂水晶柱（水晶化残骸感）
  for (let y = sy + 1; y <= sy + 4; y++) blocks.push([ax - 1, y, sz0 + 2, BL]);
  for (let y = sy - 3; y < sy; y++) blocks.push([ax, y, sz0 + 2, QB]);

  // ⑤ 货舱箱（甲板中部）+ 船尾楼箱
  meta.chests.push([ax + 1, sy, sz0 + 3, 'aether_ship'], [ax - 1, sy + 1, sz0 + 1, 'aether_ship']);
  for (const c of meta.chests) blocks.push([c[0], c[1], c[2], CH]);

  return { blocks, meta };
}

// ── 结构类型定义 ─────────────────────────────────────────────────────
// 密度：temple 稀有（crystal 群系门 ~12% 列双重稀释）/ tower 常见（草地门，探索节奏）
// / ship 稀有（全群系门 + 大网格）。salt 与其他结构类型错开（跨类型去相关）。
export const AETHER_TEMPLE_DEF = {
  cell: 14,          // 14 区块网格（224 格）——群系门 × 岛存在门双重稀释，网格取小 + 多次尝试补密度
  attempts: 6,       // 村庄同款：crystal 锚点命中率低（群系场与岛场独立），靠多次尝试提升可放置率
  chance: 0.6,
  radius: 40,        // 覆盖底台 ±7 与四角晶柱 ±6
  salt: 7261,
  dims: ['aether'],  // 仅天域维度参与
  place: placeTemple,
  solve: solveTemple,
};

export const AETHER_TOWER_DEF = {
  cell: 14,          // 14 区块网格（224 格）——小型结构配小网格保探索节奏
  attempts: 2,
  chance: 0.55,
  radius: 24,
  salt: 7262,
  dims: ['aether'],
  place: placeTower,
  solve: solveTower,
};

export const AETHER_SHIP_DEF = {
  cell: 24,          // 24 区块网格（384 格）——稀有残骸
  attempts: 2,
  chance: 0.5,
  radius: 26,
  salt: 7263,
  dims: ['aether'],
  place: placeShip,
  solve: solveShip,
};
