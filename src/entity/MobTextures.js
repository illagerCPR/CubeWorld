// MobTextures.js -- 怪物皮肤 SVG + 模型定义（cuboid box-parts）
// 每种怪用自己的 64×32 皮肤 atlas（4 行 × 4 列，每 cell 16×8 像素）：
//   row 0 = head, row 1 = body, row 2 = arm(s), row 3 = leg(s)
//   col 0 = front, col 1 = back, col 2 = left, col 3 = right
// 顶/底面复用 front/back col（视觉上够辨识）。
import { SVGTextures } from '../render/SVGTextures.js';

const { rng } = SVGTextures;

// === atlas 布局常量 ===
const ATLAS_W = 64;
const ATLAS_H = 32;
const CELL_W = 16;
const CELL_H = 8;

// row, col  → { u0, v0, u1, v1 }（atlas UV，与 SVGTextures.buildAtlas 同公式）
export function mobSkinUV(partRow, faceCol) {
  const cx = faceCol * CELL_W;
  const cy = partRow * CELL_H;
  const u0 = cx / ATLAS_W;
  const u1 = (cx + CELL_W) / ATLAS_W;
  const v1 = 1 - cy / ATLAS_H;
  const v0 = 1 - (cy + CELL_H) / ATLAS_H;
  return { u0, v0, u1, v1 };
}

// 构建 1 个 atlas cell 描述（16×8 像素，每像素 RGB 字符串或 null）
function makeCell(row, col, colorFn) {
  const px = new Array(CELL_W * CELL_H).fill(null);
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      px[y * CELL_W + x] = colorFn(x, y);
    }
  }
  return {
    row, col,
    x: col * CELL_W,
    y: row * CELL_H,
    w: CELL_W,
    h: CELL_H,
    pixels: px,
  };
}

// 把 16 个 cells 序列化为整张 64×32 SVG
function buildSkinSVG(cells) {
  let rects = '';
  for (const c of cells) {
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const col = c.pixels[y * c.w + x];
        if (col) rects += `<rect x="${c.x + x}" y="${c.y + y}" width="1" height="1" fill="${col}"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ATLAS_W}" height="${ATLAS_H}" viewBox="0 0 ${ATLAS_W} ${ATLAS_H}" shape-rendering="crispEdges">${rects}</svg>`;
}

// 噪声颜色：base + variation
function noisy(base, variation, seed) {
  const r = rng(seed);
  return (x, y) => {
    const t = r();
    let v = 0;
    if (t > 0.75) v = -variation;
    else if (t > 0.5) v = -Math.floor(variation / 2);
    else if (t < 0.2) v = Math.floor(variation / 2);
    return `rgb(${Math.max(0, base[0] + v)},${Math.max(0, base[1] + v)},${Math.max(0, base[2] + v)})`;
  };
}

// 把 features 函数叠在噪声底色上（features 返回非 null 则用 features 的值）
function overlayFeatures(baseFn, featureFn) {
  return (x, y) => featureFn(x, y) ?? baseFn(x, y);
}

// === 各怪皮肤 SVG 生成 ===

function zombieSkinSVG() {
  const skin = [110, 145, 105];
  const shirt = [55, 80, 120];
  const pants = [50, 50, 70];
  const headBase = noisy(skin, 22, 201);
  const bodyBase = noisy(shirt, 15, 202);
  const armBase = noisy(skin, 18, 203);
  const legBase = noisy(pants, 12, 204);

  const headFront = overlayFeatures(headBase, (x, y) => {
    // 眼睛 (y=2..3, x=4..6 和 x=9..11)
    if (y >= 2 && y <= 3 && ((x >= 4 && x <= 6) || (x >= 9 && x <= 11))) return 'rgb(20,20,20)';
    // 嘴 (y=5, x=6..9)
    if (y === 5 && x >= 6 && x <= 9) return 'rgb(40,55,40)';
    return null;
  });
  const bodyFront = overlayFeatures(bodyBase, (x, y) => {
    // 衣服胸前一道竖线领口
    if (x >= 7 && x <= 8 && y >= 1 && y <= 4) return 'rgb(40,55,90)';
    return null;
  });

  const cells = [
    makeCell(0, 0, headFront), makeCell(0, 1, headBase), makeCell(0, 2, headBase), makeCell(0, 3, headBase),
    makeCell(1, 0, bodyFront), makeCell(1, 1, bodyBase), makeCell(1, 2, bodyBase), makeCell(1, 3, bodyBase),
    makeCell(2, 0, armBase),   makeCell(2, 1, armBase),   makeCell(2, 2, armBase), makeCell(2, 3, armBase),
    makeCell(3, 0, legBase),   makeCell(3, 1, legBase),   makeCell(3, 2, legBase), makeCell(3, 3, legBase),
  ];
  return buildSkinSVG(cells);
}

function skeletonSkinSVG() {
  const bone = [220, 220, 200];
  const dark = [180, 180, 160];
  const shirt = [85, 85, 85];
  const pants = [60, 60, 70];
  const headBase = noisy(bone, 15, 211);
  const bodyBase = noisy(shirt, 10, 212);
  const armBase = noisy(bone, 12, 213);
  const legBase = noisy(pants, 8, 214);

  const headFront = overlayFeatures(headBase, (x, y) => {
    if (y >= 2 && y <= 3 && ((x >= 5 && x <= 6) || (x >= 9 && x <= 10))) return 'rgb(10,10,10)';
    if (y >= 5 && y <= 5 && x >= 5 && x <= 10 && x % 2 === 0) return 'rgb(20,20,20)';
    return null;
  });
  const bodyFront = overlayFeatures(bodyBase, (x, y) => {
    // 横条肋骨
    if (y >= 1 && y <= 6 && (y - 1) % 2 === 0 && x >= 3 && x <= 12) return `rgb(${dark[0]},${dark[1]},${dark[2]})`;
    return null;
  });

  const cells = [
    makeCell(0, 0, headFront), makeCell(0, 1, headBase), makeCell(0, 2, headBase), makeCell(0, 3, headBase),
    makeCell(1, 0, bodyFront), makeCell(1, 1, bodyBase), makeCell(1, 2, bodyBase), makeCell(1, 3, bodyBase),
    makeCell(2, 0, armBase),   makeCell(2, 1, armBase),   makeCell(2, 2, armBase), makeCell(2, 3, armBase),
    makeCell(3, 0, legBase),   makeCell(3, 1, legBase),   makeCell(3, 2, legBase), makeCell(3, 3, legBase),
  ];
  return buildSkinSVG(cells);
}

function creeperSkinSVG() {
  const base = [100, 150, 80];
  const dark = [60, 100, 50];
  const headBase = noisy(base, 12, 221);
  const bodyBase = noisy(base, 10, 222);
  const armBase = noisy(dark, 10, 223);
  const legBase = noisy(dark, 10, 224);

  const headFront = overlayFeatures(headBase, (x, y) => {
    // 眼睛 (方形 y=1..3, x=4..6 和 x=9..11)
    if (y >= 1 && y <= 3 && ((x >= 4 && x <= 6) || (x >= 9 && x <= 11))) return 'rgb(25,25,25)';
    // 标志哭脸 嘴
    if (y === 4 && x >= 7 && x <= 8) return 'rgb(25,25,25)';
    if (y === 5 && x >= 6 && x <= 9) return 'rgb(25,25,25)';
    if (y >= 6 && y <= 7 && x >= 7 && x <= 8) return 'rgb(25,25,25)';
    return null;
  });

  const cells = [
    makeCell(0, 0, headFront), makeCell(0, 1, headBase), makeCell(0, 2, headBase), makeCell(0, 3, headBase),
    makeCell(1, 0, bodyBase),   makeCell(1, 1, bodyBase), makeCell(1, 2, bodyBase), makeCell(1, 3, bodyBase),
    makeCell(2, 0, armBase),    makeCell(2, 1, armBase),  makeCell(2, 2, armBase),  makeCell(2, 3, armBase),
    makeCell(3, 0, legBase),    makeCell(3, 1, legBase),  makeCell(3, 2, legBase),  makeCell(3, 3, legBase),
  ];
  return buildSkinSVG(cells);
}

function spiderSkinSVG() {
  // spider parts 都用近 black base 色
  const dark = [40, 35, 45];
  const red = [200, 30, 30];
  const headBase = noisy(dark, 14, 231);
  const bodyBase = noisy(dark, 10, 232);
  const armBase = noisy([60, 55, 70], 10, 233);  // 腿（用 row 2）
  const legBase = noisy(dark, 8, 234);

  const headFront = overlayFeatures(headBase, (x, y) => {
    // 红眼 (左/右)
    if (y >= 3 && y <= 4 && (x === 5 || x === 6 || x === 9 || x === 10)) return `rgb(${red[0]},${red[1]},${red[2]})`;
    return null;
  });

  const cells = [
    makeCell(0, 0, headFront), makeCell(0, 1, headBase), makeCell(0, 2, headBase), makeCell(0, 3, headBase),
    makeCell(1, 0, bodyBase),  makeCell(1, 1, bodyBase), makeCell(1, 2, bodyBase), makeCell(1, 3, bodyBase),
    makeCell(2, 0, armBase),   makeCell(2, 1, armBase),  makeCell(2, 2, armBase),  makeCell(2, 3, armBase),
    makeCell(3, 0, legBase),   makeCell(3, 1, legBase),  makeCell(3, 2, legBase),  makeCell(3, 3, legBase),
  ];
  return buildSkinSVG(cells);
}

// === 部位定义 ===
// box = [minX, minY, minZ, maxX, maxY, maxZ]，局部坐标，原点在脚 y=0，+Z 朝玩家

// humanoid 6 部位：头 / 身 / 2 臂 / 2 腿
const HUMANOID_PARTS = [
  { name: 'head',  row: 0, box: [-0.25, 1.50, -0.25,  0.25, 2.00, 0.25] },
  { name: 'body',  row: 1, box: [-0.30, 0.75, -0.15,  0.30, 1.50, 0.15] },
  { name: 'armR',  row: 2, box: [-0.55, 0.75, -0.10, -0.30, 1.50, 0.10] },
  { name: 'armL',  row: 2, box: [ 0.30, 0.75, -0.10,  0.55, 1.50, 0.10] },
  { name: 'legR',  row: 3, box: [-0.18, 0,    -0.12, -0.02, 0.75, 0.12] },
  { name: 'legL',  row: 3, box: [ 0.02, 0,    -0.12,  0.18, 0.75, 0.12] },
];

// 苦力怕：头 / 身 / 4 条腿（身比 humanoid 矮胖，头低些）
const CREEPER_PARTS = [
  { name: 'head',  row: 0, box: [-0.25, 1.20, -0.25,  0.25, 1.70, 0.25] },
  { name: 'body',  row: 1, box: [-0.20, 0.55, -0.15,  0.20, 1.20, 0.15] },
  { name: 'legFR', row: 3, box: [-0.20, 0,     0.02,  -0.02, 0.55, 0.20] },
  { name: 'legFL', row: 3, box: [ 0.02, 0,     0.02,   0.20, 0.55, 0.20] },
  { name: 'legBR', row: 3, box: [-0.20, 0,    -0.20,  -0.02, 0.55, -0.02] },
  { name: 'legBL', row: 3, box: [ 0.02, 0,    -0.20,   0.20, 0.55, -0.02] },
];

// 蜘蛛：1 头 + 1 身 + 4 腿（简化原版 8 腿为 4）
// 长 X 轴是侧向，+Z 是朝玩家，body 在中后部，head 在前部
const SPIDER_PARTS = [
  { name: 'head',   row: 0, box: [-0.20, 0.25,  0.30,  0.20, 0.65, 0.55] },
  { name: 'body',   row: 1, box: [-0.40, 0.10, -0.30,  0.40, 0.55, 0.30] },
  { name: 'legFL',  row: 2, box: [ 0.40, 0.05,  0.20,  0.65, 0.30, 0.40] },
  { name: 'legFR',  row: 2, box: [-0.65, 0.05,  0.20, -0.40, 0.30, 0.40] },
  { name: 'legBL',  row: 3, box: [ 0.40, 0.05, -0.40,  0.65, 0.30, -0.20] },
  { name: 'legBR',  row: 3, box: [-0.65, 0.05, -0.40, -0.40, 0.30, -0.20] },
];

// === 入口：返回各 type 的 skin SVG + parts ===
export function generateMobSkinSVGs() {
  return {
    zombie:    zombieSkinSVG(),
    skeleton:  skeletonSkinSVG(),
    creeper:   creeperSkinSVG(),
    spider:    spiderSkinSVG(),
  };
}

// === 兼容旧 API：返回空 map（mob atlas 不再合并到全局 atlas）===
export function generateMobTextures() {
  return {};  // 空：mob 用各自独立的 skin atlas，不再占用全局 SVG atlas
}

// === 怪物类型定义 ===
export const MobTypes = {
  zombie: {
    name: 'zombie',
    displayName: '僵尸',
    width: 0.6,
    height: 1.95,
    health: 20,
    damage: 3,
    speed: 2.5,
    attackRange: 1.5,
    detectionRange: 16,
    burningInDay: true,
    model: { parts: HUMANOID_PARTS, kind: 'cuboid' },
    drops: [
      { name: 'rotten_flesh', min: 0, max: 2 },
    ],
    rareDrop: { name: 'iron_ingot', chance: 0.025 },
  },
  skeleton: {
    name: 'skeleton',
    displayName: '骷髅',
    width: 0.6,
    height: 1.99,
    health: 20,
    damage: 2,
    speed: 2.5,
    attackRange: 12,
    detectionRange: 16,
    ranged: true,
    burningInDay: true,
    model: { parts: HUMANOID_PARTS, kind: 'cuboid' },
    drops: [
      { name: 'bone', min: 0, max: 2 },
      { name: 'arrow', min: 0, max: 2 },
    ],
  },
  creeper: {
    name: 'creeper',
    displayName: '苦力怕',
    width: 0.6,
    height: 1.7,
    health: 20,
    damage: 12,
    explosionRadius: 3,
    speed: 2.8,
    attackRange: 2,
    detectionRange: 16,
    burningInDay: false,
    model: { parts: CREEPER_PARTS, kind: 'cuboid' },
    drops: [
      { name: 'gunpowder', min: 0, max: 2 },
    ],
  },
  spider: {
    name: 'spider',
    displayName: '蜘蛛',
    width: 1.4,
    height: 0.9,
    health: 16,
    damage: 2,
    speed: 3.5,
    attackRange: 1.5,
    detectionRange: 16,
    climbing: true,
    burningInDay: false,
    model: { parts: SPIDER_PARTS, kind: 'cuboid' },
    drops: [
      { name: 'string', min: 0, max: 2 },
      { name: 'spider_eye', min: 0, max: 1, chance: 0.5 },
    ],
  },
};