// MobTextures.js -- 怪物皮肤 SVG + 模型定义（cuboid box-parts）
// 每种怪用自己的 64×64 皮肤 atlas（4 行 × 4 列，每 cell 16×16 像素）：
//   row 0 = head, row 1 = body, row 2 = arm(s), row 3 = leg(s)
//   col 0 = front, col 1 = back, col 2 = left, col 3 = right
// 顶/底面复用 front/back col（视觉上够辨识）。
// 每个 face 生成时按朝向套一层基础明暗（front 基准、back/side 变暗），
// 配合 MobManager 的每面法线 + 场景方向光做出立体感。
import { SVGTextures } from '../render/SVGTextures.js';

const { rng } = SVGTextures;

// === atlas 布局常量（64×64，cell 16×16 方形，修掉原 16×8 拉伸） ===
const ATLAS_W = 64;
const ATLAS_H = 64;
const CELL_W = 16;
const CELL_H = 16;

// face 朝向基础亮度（模拟简单体积感；方向光之外再补一层，夜晚也保持辨识）
const FACE_BRIGHTNESS = { 0: 1.0, 1: 0.80, 2: 1.05, 3: 0.88 };

// row, col  → { u0, v0, u1, v1 }（atlas UV）
export function mobSkinUV(partRow, faceCol) {
  const cx = faceCol * CELL_W;
  const cy = partRow * CELL_H;
  const u0 = cx / ATLAS_W;
  const u1 = (cx + CELL_W) / ATLAS_W;
  const v1 = 1 - cy / ATLAS_H;
  const v0 = 1 - (cy + CELL_H) / ATLAS_H;
  return { u0, v0, u1, v1 };
}

// [r,g,b] 数组按系数调亮/调暗，返回 rgb 字符串
function shade(rgb, f) {
  return `rgb(${Math.max(0, Math.min(255, Math.round(rgb[0] * f)))},${Math.max(0, Math.min(255, Math.round(rgb[1] * f)))},${Math.max(0, Math.min(255, Math.round(rgb[2] * f)))})`;
}

// 像素噪声底色：base ± variation，返回 (x,y) => [r,g,b]（确定性 rng）
function noisy(base, variation, seed) {
  const r = rng(seed);
  return (x, y) => {
    const t = r();
    let v = 0;
    if (t > 0.75) v = -variation;
    else if (t > 0.5) v = -Math.floor(variation / 2);
    else if (t < 0.2) v = Math.floor(variation / 2);
    return [
      Math.max(0, base[0] + v),
      Math.max(0, base[1] + v),
      Math.max(0, base[2] + v),
    ];
  };
}

// 确定性散列 [0,1)，用于斑驳纹理（避免共享 rng 状态）
function hash01(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 974634073) >>> 0;
  h = ((h ^ (h >>> 13)) * 1103515245) >>> 0;
  return (h >>> 16) / 65536;
}

// 斑驳底：base 噪声上叠 dark 色块（苦力怕/蜘蛛的暗斑质感）
function mottle(base, dark, variation, seed) {
  const b = noisy(base, variation, seed);
  return (x, y) => {
    const t = hash01(x, y, seed);
    if (t < 0.20) return dark;
    return b(x, y);
  };
}

// 生成 1 个 atlas cell：底色 baseFn + 特征 paintFn（返回 [r,g,b]|null），按 faceCol 套亮度
function makeCell(row, col, baseFn, paintFn) {
  const px = new Array(CELL_W * CELL_H).fill(null);
  const bf = FACE_BRIGHTNESS[col] ?? 1.0;
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      let c = paintFn ? (paintFn(x, y, baseFn) ?? baseFn(x, y)) : baseFn(x, y);
      if (c) c = shade(c, bf);
      px[y * CELL_W + x] = c;
    }
  }
  return { row, col, x: col * CELL_W, y: row * CELL_H, w: CELL_W, h: CELL_H, pixels: px };
}

// 同一部件的 4 个 face 一次性生成（features 可只给部分面）
function partCells(row, baseFn, features = {}) {
  return [
    makeCell(row, 0, baseFn, features.front),
    makeCell(row, 1, baseFn, features.back),
    makeCell(row, 2, baseFn, features.left),
    makeCell(row, 3, baseFn, features.right),
  ];
}

// 把 16 个 cells 序列化为整张 64×64 SVG
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

// 便捷色板
const C = {
  black: [24, 26, 24],
  dark: [18, 18, 22],
  // 僵尸
  zSkin: [112, 146, 106], zSkinD: [74, 102, 70], zHair: [36, 56, 36],
  zShirt: [52, 92, 94], zShirtD: [36, 70, 72], zBelt: [36, 34, 40], zBuckle: [172, 150, 62],
  zPants: [46, 52, 84], zPantsD: [33, 38, 62], zShoe: [62, 46, 36], zMouth: [66, 40, 34],
  zTeeth: [208, 214, 196],
  // 骷髅
  kBone: [214, 214, 200], kBoneD: [172, 176, 162], kBoneHi: [238, 238, 222],
  kShirt: [96, 96, 96], kShirtD: [72, 72, 72], kRib: [176, 176, 168], kSternum: [212, 212, 196],
  kPants: [70, 70, 80], kPantsD: [52, 52, 60], kShoe: [46, 46, 52],
  // 苦力怕
  cGreen: [96, 146, 76], cGreenD: [58, 94, 50], cGreenDk: [40, 66, 38], cBelly: [80, 124, 62],
  // 蜘蛛
  sDark: [42, 36, 46], sDk: [28, 24, 32], sMid: [60, 54, 68], sAbo: [48, 42, 54],
  sRed: [226, 40, 40],
};

// === 各怪皮肤 SVG 生成 ===

function zombieSkinSVG() {
  const headBase = noisy(C.zSkin, 18, 201);
  const bodyBase = noisy(C.zShirt, 12, 202);
  const armBase = noisy(C.zSkin, 14, 203);
  const legBase = noisy(C.zPants, 10, 204);

  const headFront = (x, y, base) => {
    // 头发帘 + 两侧头发
    if (y <= 2 || x <= 1 || x >= 14) return C.zHair;
    if (y <= 7 && (x <= 2 || x >= 13)) return C.zHair;
    // 眼睛（左/右 2 格黑）
    if (y >= 6 && y <= 7 && ((x >= 4 && x <= 5) || (x >= 10 && x <= 11))) return C.black;
    // 眼下阴影
    if (y === 8 && x >= 3 && x <= 12) return C.zSkinD;
    // 鼻子
    if (y >= 8 && y <= 9 && x >= 7 && x <= 8) return C.zSkinD;
    // 嘴（暗红） + 3 颗牙
    if (y >= 11 && y <= 12 && x >= 5 && x <= 10) return C.zMouth;
    if (y === 11 && (x === 6 || x === 8 || x === 10)) return C.zTeeth;
    // 下巴阴影
    if (y >= 14) return C.zSkinD;
    return null;
  };
  const headBack = (x, y) => (y <= 8 ? C.zHair : null);
  const headSide = (x, y) => {
    if (y <= 3) return C.zHair;
    if (y === 8 && x >= 7 && x <= 8) return C.zSkinD; // 耳朵窝
    return null;
  };

  const bodyFront = (x, y, base) => {
    // 领口
    if (y === 0) return C.zShirtD;
    // 胸前中缝
    if (x >= 7 && x <= 8 && y >= 1 && y <= 11) return C.zShirtD;
    // 破洞露皮
    if ((x === 2 || x === 3) && y >= 8 && y <= 9) return C.zSkin;
    // 皮带 + 扣
    if (y >= 13 && y <= 14) return C.zBelt;
    if (y >= 13 && y <= 14 && x >= 7 && x <= 8) return C.zBuckle;
    return null;
  };
  const bodyBack = (x, y) => (y === 0 ? C.zShirtD : null);
  const bodySide = (x, y) => (y === 0 ? C.zShirtD : null);

  const armAll = (x, y) => {
    // 肩膀衣袖
    if (y <= 2) return C.zShirt;
    if (y === 3 && (x <= 3 || x >= 12)) return C.zShirtD; // 撕裂袖口
    // 手
    if (y >= 13) return C.zSkinD;
    return null;
  };
  const legAll = (x, y) => {
    // 裤腰
    if (y <= 1) return C.zPantsD;
    // 膝盖磨破
    if (y >= 8 && y <= 9) return C.zPantsD;
    // 鞋
    if (y >= 13) return C.zShoe;
    return null;
  };

  const cells = [
    ...partCells(0, headBase, { front: headFront, back: headBack, left: headSide, right: headSide }),
    ...partCells(1, bodyBase, { front: bodyFront, back: bodyBack, left: bodySide, right: bodySide }),
    ...partCells(2, armBase, { front: armAll, back: armAll, left: armAll, right: armAll }),
    ...partCells(3, legBase, { front: legAll, back: legAll, left: legAll, right: legAll }),
  ];
  return buildSkinSVG(cells);
}

function skeletonSkinSVG() {
  const headBase = noisy(C.kBone, 12, 211);
  const bodyBase = noisy(C.kShirt, 6, 212);
  const armBase = noisy(C.kBone, 10, 213);
  const legBase = noisy(C.kPants, 6, 214);

  const headFront = (x, y, base) => {
    // 头顶高光
    if (y <= 1) return C.kBoneHi;
    // 大眼窝
    if (y >= 4 && y <= 8 && ((x >= 4 && x <= 6) || (x >= 9 && x <= 11))) return C.dark;
    // 鼻孔
    if (y >= 8 && y <= 9 && x >= 7 && x <= 8) return [42, 42, 48];
    // 颧骨
    if (y >= 8 && y <= 11 && (x === 3 || x === 12)) return C.kBoneD;
    // 牙列（白/暗交替竖条）
    if (y >= 12 && y <= 14 && x >= 5 && x <= 10) {
      return (x % 2 === 1) ? [244, 244, 228] : [124, 128, 118];
    }
    // 下颌阴影
    if (y === 15) return C.kBoneD;
    return null;
  };
  const headBack = (x, y) => (y <= 1 ? C.kBoneHi : null);
  const headSide = (x, y) => {
    if (y <= 1) return C.kBoneHi;
    if (y >= 6 && y <= 9 && x >= 6 && x <= 9) return C.kBoneD; // 颞窝
    return null;
  };

  const bodyFront = (x, y, base) => {
    // 肋骨（亮横条）
    if (y === 2 || y === 4 || y === 6 || y === 8 || y === 10) {
      if (x >= 3 && x <= 12) return C.kRib;
    }
    // 胸骨
    if (x >= 7 && x <= 8 && y >= 1 && y <= 11) return C.kSternum;
    // 腰带
    if (y >= 13 && y <= 14) return [46, 46, 50];
    return null;
  };
  const bodyBack = (x, y) => {
    if (x >= 7 && x <= 8 && y >= 1 && y <= 12) return C.kShirtD; // 脊柱
    return null;
  };

  const armAll = (x, y) => {
    // 腕骨 + 手骨
    if (y >= 11) return C.kBoneD;
    return null;
  };
  const legAll = (x, y) => {
    if (y <= 1) return C.kPantsD;
    if (y >= 8 && y <= 9) return C.kPantsD;
    if (y >= 13) return C.kShoe;
    return null;
  };

  const cells = [
    ...partCells(0, headBase, { front: headFront, back: headBack, left: headSide, right: headSide }),
    ...partCells(1, bodyBase, { front: bodyFront, back: bodyBack }),
    ...partCells(2, armBase, { front: armAll, back: armAll, left: armAll, right: armAll }),
    ...partCells(3, legBase, { front: legAll, back: legAll, left: legAll, right: legAll }),
  ];
  return buildSkinSVG(cells);
}

function creeperSkinSVG() {
  const headBase = mottle(C.cGreen, C.cGreenD, 10, 221);
  const bodyBase = mottle(C.cGreen, C.cGreenD, 10, 222);
  const legBase = mottle(C.cGreenD, C.cGreenDk, 8, 223);

  const headFront = (x, y, base) => {
    // 眼睛（4 宽大眼）
    if (y >= 3 && y <= 5 && ((x >= 3 && x <= 6) || (x >= 9 && x <= 12))) return C.black;
    // 标志性嘴（向下渐宽的裂口）
    if (y === 8 && x >= 7 && x <= 8) return C.black;
    if (y === 9 && x >= 6 && x <= 9) return C.black;
    if (y >= 10 && y <= 11 && x >= 5 && x <= 10) return C.black;
    if (y === 12 && x >= 6 && x <= 9) return C.black;
    if (y === 13 && x >= 7 && x <= 8) return C.black;
    // 下巴暗面
    if (y === 15) return C.cGreenD;
    return null;
  };
  const headBack = (x, y) => {
    if (y === 0 || y === 15) return C.cGreenD;
    return null;
  };

  const bodyFront = (x, y, base) => {
    // 腹部偏暗
    if (y >= 9 && y <= 11 && x >= 4 && x <= 11) return C.cBelly;
    if (y >= 13) return C.cGreenD;
    return null;
  };
  const bodyBack = (x, y) => (y >= 13 ? C.cGreenD : null);

  const legAll = (x, y) => (y >= 13 ? C.cGreenDk : null);

  const cells = [
    ...partCells(0, headBase, { front: headFront, back: headBack }),
    ...partCells(1, bodyBase, { front: bodyFront, back: bodyBack }),
    ...partCells(2, legBase, { front: legAll, back: legAll, left: legAll, right: legAll }),
    ...partCells(3, legBase, { front: legAll, back: legAll, left: legAll, right: legAll }),
  ];
  return buildSkinSVG(cells);
}

function spiderSkinSVG() {
  const headBase = mottle(C.sDark, C.sDk, 6, 231);
  const bodyBase = mottle(C.sAbo, C.sDk, 8, 232);
  const legBase = noisy(C.sMid, 8, 233);

  const headFront = (x, y, base) => {
    // 8 只红眼（2 行 × 4 列）
    if (y >= 4 && y <= 5 && (x === 5 || x === 7 || x === 9 || x === 11)) return C.sRed;
    // 口器/螯肢
    if (y >= 10 && y <= 12 && x >= 7 && x <= 8) return [78, 70, 86];
    return null;
  };
  const headSide = (x, y) => {
    if (y >= 4 && y <= 5 && x >= 7 && x <= 8) return C.sRed;
    return null;
  };

  const bodyFront = (x, y, base) => {
    // 腹部前端花纹
    if (y === 15) return C.sDk;
    return null;
  };
  const bodyBack = (x, y) => {
    // 腹部背面浅斑
    if (hash01(x, y, 99) < 0.5) return [58, 52, 66];
    return null;
  };

  const legAll = (x, y) => (y >= 13 ? C.sDk : null);

  const cells = [
    ...partCells(0, headBase, { front: headFront, left: headSide, right: headSide }),
    ...partCells(1, bodyBase, { front: bodyFront, back: bodyBack }),
    ...partCells(2, legBase, { front: legAll, back: legAll, left: legAll, right: legAll }),
    ...partCells(3, legBase, { front: legAll, back: legAll, left: legAll, right: legAll }),
  ];
  return buildSkinSVG(cells);
}

// === 部位定义 ===
// box = [minX, minY, minZ, maxX, maxY, maxZ]，局部坐标，原点在脚 y=0，+Z 朝玩家

// humanoid 6 部位：头 / 身 / 2 臂 / 2 腿（臂略细、腿加粗，更接近原版比例）
const HUMANOID_PARTS = [
  { name: 'head',  row: 0, box: [-0.25, 1.50, -0.25,  0.25, 2.00, 0.25] },
  { name: 'body',  row: 1, box: [-0.28, 0.75, -0.16,  0.28, 1.50, 0.16] },
  { name: 'armR',  row: 2, box: [-0.52, 0.75, -0.11, -0.30, 1.50, 0.11] },
  { name: 'armL',  row: 2, box: [ 0.30, 0.75, -0.11,  0.52, 1.50, 0.11] },
  { name: 'legR',  row: 3, box: [-0.20, 0,    -0.11,  0.00, 0.75, 0.11] },
  { name: 'legL',  row: 3, box: [ 0.00, 0,    -0.11,  0.20, 0.75, 0.11] },
];

// 苦力怕：头 / 身 / 4 条腿（身更方更壮，贴近原版 8×12×4 比例）
const CREEPER_PARTS = [
  { name: 'head',  row: 0, box: [-0.25, 1.20, -0.25,  0.25, 1.70, 0.25] },
  { name: 'body',  row: 1, box: [-0.25, 0.50, -0.14,  0.25, 1.20, 0.14] },
  { name: 'legFR', row: 3, box: [-0.24, 0,     0.02,  -0.02, 0.50, 0.24] },
  { name: 'legFL', row: 3, box: [ 0.02, 0,     0.02,   0.24, 0.50, 0.24] },
  { name: 'legBR', row: 3, box: [-0.24, 0,    -0.24,  -0.02, 0.50, -0.02] },
  { name: 'legBL', row: 3, box: [ 0.02, 0,    -0.24,   0.24, 0.50, -0.02] },
];

// 蜘蛛：头胸(前小) + 腹部(后大) + 8 条腿（原版简化前是 4 腿，这次补全 4 对）
// 腿用薄长 box 斜向外摆（无旋转盒的像素风折衷）
const SPIDER_PARTS = [
  { name: 'head',   row: 0, box: [-0.24, 0.22,  0.26,  0.24, 0.58, 0.60] },
  { name: 'body',   row: 1, box: [-0.44, 0.10, -0.44,  0.44, 0.66, 0.26] },
  { name: 'legFL',  row: 2, box: [ 0.24, 0.06,  0.18,  0.56, 0.30, 0.34] },
  { name: 'legFR',  row: 2, box: [-0.56, 0.06,  0.18, -0.24, 0.30, 0.34] },
  { name: 'legML',  row: 2, box: [ 0.24, 0.06,  0.02,  0.58, 0.32, 0.14] },
  { name: 'legMR',  row: 2, box: [-0.58, 0.06,  0.02, -0.24, 0.32, 0.14] },
  { name: 'legML2', row: 3, box: [ 0.24, 0.06, -0.14,  0.58, 0.32, -0.02] },
  { name: 'legMR2', row: 3, box: [-0.58, 0.06, -0.14, -0.24, 0.32, -0.02] },
  { name: 'legBL',  row: 3, box: [ 0.24, 0.06, -0.36,  0.56, 0.30, -0.18] },
  { name: 'legBR',  row: 3, box: [-0.56, 0.06, -0.36, -0.24, 0.30, -0.18] },
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
