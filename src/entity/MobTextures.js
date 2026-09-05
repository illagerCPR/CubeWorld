// MobTextures.js -- 怪物皮肤 SVG + 模型定义（cuboid box-parts）
// 每种怪用自己的 96×64 皮肤 atlas（4 行 × 6 列，每 cell 16×16 方形像素）：
//   row 0 = head, row 1 = body, row 2 = 前组肢体(臂/前腿), row 3 = 后组肢体(腿/后腿)
//   col 0 = front, col 1 = back, col 2 = left, col 3 = right, col 4 = top, col 5 = bottom
// 阶段 8：top/bottom 不再复用 front/back（此前"脸贴到头顶"的根因），每面独立绘制；
// 皮肤配色/特征按原版 Minecraft 重画（僵尸无发青衫、骷髅全骨肋架、苦力怕经典脸、蜘蛛红眼）。
// 每个 face 生成时按朝向套一层基础明暗（front 基准、back/side 变暗），
// 配合 MobManager 的每面法线 + 场景方向光做出立体感。
import { SVGTextures } from '../render/SVGTextures.js';

const { rng } = SVGTextures;

// === atlas 布局常量（96×64，cell 16×16 方形；MobManager 按 MOB_ATLAS 建画布） ===
export const MOB_ATLAS = { w: 96, h: 64 };
const ATLAS_W = MOB_ATLAS.w;
const ATLAS_H = MOB_ATLAS.h;
const CELL_W = 16;
const CELL_H = 16;

// face 朝向基础亮度（模拟简单体积感；方向光之外再补一层，夜晚也保持辨识）
// 0=front 1=back 2=left 3=right 4=top 5=bottom
const FACE_BRIGHTNESS = { 0: 1.0, 1: 0.80, 2: 1.05, 3: 0.88, 4: 0.96, 5: 0.70 };

// row, col  → { u0, v0, u1, v1 }（atlas UV；flipY=true 时 v1 对应 cell 图像顶行）
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

// 同一部件的 6 个 face 一次性生成（features 可只给部分面：front/back/left/right/top/bot）
function partCells(row, baseFn, features = {}) {
  return [
    makeCell(row, 0, baseFn, features.front),
    makeCell(row, 1, baseFn, features.back),
    makeCell(row, 2, baseFn, features.left),
    makeCell(row, 3, baseFn, features.right),
    makeCell(row, 4, baseFn, features.top),
    makeCell(row, 5, baseFn, features.bot),
  ];
}

// 把所有 cells 序列化为整张 96×64 SVG
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

// 便捷色板（按原版怪物配色校准）
const C = {
  black: [18, 20, 18],
  dark: [16, 16, 20],
  // 僵尸：绿皮 + 青衫 + 蓝紫裤（原版配色，无头发）
  zSkin: [106, 152, 98], zSkinD: [82, 122, 76], zSkinDD: [60, 94, 58],
  zShirt: [40, 116, 116], zShirtD: [30, 90, 90],
  zPants: [58, 64, 122], zPantsD: [44, 48, 94], zShoe: [40, 36, 34],
  // 骷髅：全骨白（原版无衣）
  kBone: [206, 206, 192], kBoneD: [166, 168, 154], kBoneHi: [234, 234, 220],
  kJoint: [130, 132, 120],
  // 苦力怕：斑驳绿
  cGreen: [98, 168, 82], cGreenD: [62, 118, 52], cGreenDk: [40, 82, 36], cGreenHi: [128, 190, 104],
  // 蜘蛛：近黑 + 红眼
  sDark: [40, 34, 42], sDk: [26, 22, 28], sMid: [58, 50, 62], sAbo: [48, 42, 54],
  sRed: [222, 44, 40], sRedD: [150, 24, 24],
  // 村民：棕袍 + 大鼻 + 绿眼（原版平民配色）
  vRobe: [126, 94, 62], vRobeD: [96, 70, 46], vRobeHi: [146, 112, 76],
  vSkin: [188, 142, 100], vSkinD: [160, 116, 80], vSkinDD: [128, 90, 60],
  vPants: [74, 60, 48], vEye: [74, 112, 60],
  // 僵尸猪灵：粉色猪灵皮 + 僵尸化绿腐斑 + 深棕裙裤
  pSkin: [222, 146, 126], pSkinD: [192, 118, 100], pSkinDD: [156, 92, 78],
  pRot: [96, 122, 70], pRotD: [70, 94, 52],
  pCloth: [92, 58, 44], pClothD: [70, 42, 32], pNostril: [60, 30, 26],
  // 凋零骷髅：焦黑骨 + 暗灰关节（原版炭黑骨架）
  wBone: [46, 46, 52], wBoneD: [32, 32, 36], wBoneHi: [66, 66, 72],
  // 烈焰人：金黄头 + 烟黑芯 + 亮黄岩浆杆
  bGold: [222, 172, 50], bGoldD: [180, 130, 34], bGoldHi: [244, 200, 90],
  bCore: [52, 44, 34], bCoreD: [36, 30, 24],
  bRod: [236, 156, 42], bRodD: [196, 116, 30],
  // 末影龙：黑鳞 + 灰紫翼膜 + 紫眼 + 角爪
  dScale: [28, 22, 34], dScaleD: [18, 14, 24], dBelly: [86, 78, 96],
  dWing: [96, 84, 116], dWingD: [64, 54, 82], dEye: [188, 92, 236], dEyeD: [120, 52, 160],
  dHorn: [172, 168, 178],
};

// === 各怪皮肤 SVG 生成（原版风） ===

function zombieSkinSVG() {
  const headBase = noisy(C.zSkin, 10, 201);
  const bodyBase = noisy(C.zShirt, 8, 202);
  const armBase = noisy(C.zSkin, 10, 203);
  const legBase = noisy(C.zPants, 8, 204);

  // 脸：黑眼 4×2 + 深绿嘴线（对应原版 8×8 脸的 2 倍尺度，无头发）
  const headFront = (x, y) => {
    if (y >= 8 && y <= 9 && ((x >= 2 && x <= 5) || (x >= 10 && x <= 13))) return C.black;
    if (y >= 12 && y <= 13 && x >= 6 && x <= 9) return C.zSkinDD;
    return null;
  };
  const headBack = (x, y) => (y >= 14 ? C.zSkinD : null);
  const headSide = (x, y) => (y >= 14 ? C.zSkinD : null);
  const headTop = (x, y) => (hash01(x, y, 205) < 0.18 ? C.zSkinD : null);
  const headBot = () => C.zSkinDD;

  // 青衫：领口/下摆暗线（原版全衫）
  const bodyFront = (x, y) => {
    if (y <= 1) return C.zShirtD;
    if (y >= 14) return C.zShirtD;
    return null;
  };
  const bodyBack = (x, y) => (y <= 1 ? C.zShirtD : (y >= 14 ? C.zShirtD : null));
  const bodySide = (x, y) => (y >= 14 ? C.zShirtD : null);
  const bodyTop = (x, y) => (hash01(x, y, 206) < 0.2 ? C.zShirtD : null);
  const bodyBot = () => C.zShirtD;

  // 臂（前伸）：肩端 2 行衬衫袖 + 手端暗皮
  const armFront = (x, y) => (y >= 12 ? C.zSkinD : null);         // 手端（+Z）
  const armBack = (x, y) => (y <= 3 ? C.zShirt : null);           // 肩端（-Z）
  const armSide = (x, y) => (y <= 3 ? C.zShirt : (y >= 12 ? C.zSkinD : null));
  const armTop = (x, y) => (y <= 3 ? C.zShirt : null);
  const armBot = () => C.zSkinD;

  // 腿：裤 + 膝部微暗 + 鞋
  const legAll = (x, y) => {
    if (y >= 13) return C.zShoe;
    if (y >= 7 && y <= 8) return C.zPantsD;
    return null;
  };
  const legTop = () => C.zPantsD;
  const legBot = () => C.zShoe;

  const cells = [
    ...partCells(0, headBase, { front: headFront, back: headBack, left: headSide, right: headSide, top: headTop, bot: headBot }),
    ...partCells(1, bodyBase, { front: bodyFront, back: bodyBack, left: bodySide, right: bodySide, top: bodyTop, bot: bodyBot }),
    ...partCells(2, armBase, { front: armFront, back: armBack, left: armSide, right: armSide, top: armTop, bot: armBot }),
    ...partCells(3, legBase, { front: legAll, back: legAll, left: legAll, right: legAll, top: legTop, bot: legBot }),
  ];
  return buildSkinSVG(cells);
}

function skeletonSkinSVG() {
  const boneBase = noisy(C.kBone, 8, 211);

  // 骷髅脸：大眼窝 + 鼻孔 + 牙列（原版全骨无衣）
  const headFront = (x, y) => {
    if (y >= 6 && y <= 8 && ((x >= 4 && x <= 6) || (x >= 9 && x <= 11))) return C.dark;
    if (y >= 9 && y <= 10 && x >= 7 && x <= 8) return [76, 78, 84];
    if (y >= 12 && y <= 14 && x >= 4 && x <= 11) return (x % 2 === 0) ? C.kBoneHi : C.kBoneD;
    if (y === 15) return C.kBoneD;
    return null;
  };
  const headBack = (x, y) => {
    if (y >= 6 && y <= 12 && hash01(x, y, 212) < 0.25) return C.kBoneD; // 颅后缝
    return null;
  };
  const headSide = (x, y) => {
    if (y >= 7 && y <= 10 && x >= 6 && x <= 9) return C.kBoneD; // 颞窝
    return null;
  };
  const headTop = (x, y) => {
    if (x === 7 || x === 8) return C.kBoneHi; // 颅顶矢状缝高光
    return null;
  };
  const headBot = () => C.kBoneD;

  // 躯干 = 肋骨架：亮肋横条 + 暗间隙 + 胸骨
  const bodyFront = (x, y) => {
    if (y >= 1 && y <= 12 && y % 2 === 0 && x >= 2 && x <= 13) return C.kBoneHi; // 肋
    if (y >= 13) return C.kBoneD; // 骨盆
    return null;
  };
  const bodyBack = (x, y) => {
    if (x >= 6 && x <= 9 && y >= 1 && y <= 13) return C.kBoneD; // 脊柱
    return null;
  };
  const bodySide = (x, y) => {
    if (y >= 1 && y <= 12 && y % 2 === 0) return C.kBoneD; // 肋端
    return null;
  };
  const bodyTop = (x, y) => (x >= 5 && x <= 10 && y >= 5 && y <= 10 ? C.kBoneD : null); // 锁骨围
  const bodyBot = () => C.kBoneD;

  // 骨肢：中段关节暗环
  const limbAll = (x, y) => {
    if (y >= 7 && y <= 8) return C.kJoint;
    if (y >= 14) return C.kBoneD;
    return null;
  };
  const limbTop = () => C.kBoneHi;
  const limbBot = () => C.kBoneD;

  const cells = [
    ...partCells(0, boneBase, { front: headFront, back: headBack, left: headSide, right: headSide, top: headTop, bot: headBot }),
    ...partCells(1, boneBase, { front: bodyFront, back: bodyBack, left: bodySide, right: bodySide, top: bodyTop, bot: bodyBot }),
    ...partCells(2, boneBase, { front: limbAll, back: limbAll, left: limbAll, right: limbAll, top: limbTop, bot: limbBot }),
    ...partCells(3, boneBase, { front: limbAll, back: limbAll, left: limbAll, right: limbAll, top: limbTop, bot: limbBot }),
  ];
  return buildSkinSVG(cells);
}

function creeperSkinSVG() {
  const headBase = mottle(C.cGreen, C.cGreenD, 10, 221);
  const bodyBase = mottle(C.cGreen, C.cGreenD, 10, 222);
  const legBase = mottle(C.cGreenD, C.cGreenDk, 8, 223);

  // 经典脸：4×4 黑眼 + 上窄中宽下分叉的裂口嘴（原版 8×8 脸 2 倍尺度）
  const headFront = (x, y) => {
    if (y >= 4 && y <= 7 && ((x >= 2 && x <= 5) || (x >= 10 && x <= 13))) return C.black;
    if (y === 8 || y === 9) { if (x >= 6 && x <= 9) return C.black; }
    else if (y >= 10 && y <= 13) { if (x >= 4 && x <= 11) return C.black; }
    else if (y >= 14) { if ((x >= 4 && x <= 5) || (x >= 10 && x <= 11)) return C.black; }
    return null;
  };
  const headTop = (x, y) => (hash01(x, y, 224) < 0.25 ? C.cGreenHi : null);
  const headBot = () => C.cGreenDk;

  const bodyFront = (x, y) => {
    if (y >= 12) return C.cGreenD;
    return null;
  };
  const bodyTop = (x, y) => (hash01(x, y, 225) < 0.25 ? C.cGreenHi : null);
  const bodyBot = () => C.cGreenDk;

  const legAll = (x, y) => (y >= 14 ? C.cGreenDk : null);
  const legTop = () => C.cGreenD;
  const legBot = () => C.cGreenDk;

  const cells = [
    ...partCells(0, headBase, { front: headFront, top: headTop, bot: headBot }),
    ...partCells(1, bodyBase, { front: bodyFront, top: bodyTop, bot: bodyBot }),
    ...partCells(2, legBase, { front: legAll, back: legAll, left: legAll, right: legAll, top: legTop, bot: legBot }),
    ...partCells(3, legBase, { front: legAll, back: legAll, left: legAll, right: legAll, top: legTop, bot: legBot }),
  ];
  return buildSkinSVG(cells);
}

function spiderSkinSVG() {
  const headBase = mottle(C.sDark, C.sDk, 6, 231);
  const bodyBase = mottle(C.sAbo, C.sDk, 8, 232);
  const legBase = noisy(C.sMid, 8, 233);

  // 脸：1 对大红眼 + 下方 1 对小暗红眼（原版蜘蛛眼位）
  const headFront = (x, y) => {
    if (y >= 6 && y <= 7 && ((x >= 3 && x <= 6) || (x >= 9 && x <= 12))) return C.sRed;
    if (y >= 10 && y <= 11 && ((x >= 5 && x <= 6) || (x >= 9 && x <= 10))) return C.sRedD;
    if (y >= 14 && x >= 6 && x <= 9) return C.sMid; // 口器
    return null;
  };
  const headTop = (x, y) => (hash01(x, y, 234) < 0.2 ? C.sMid : null);
  const headBot = () => C.sDk;

  // 腹部背斑（top 面：浅色斑纹，原版蜘蛛背面的浅灰斑）
  const bodyTop = (x, y) => {
    const t = hash01(x, y, 99);
    if (t < 0.3) return [74, 66, 82];
    if (t < 0.4) return C.sDk;
    return null;
  };
  const bodyBot = () => C.sDk;

  const legAll = (x, y) => {
    if (y >= 7 && y <= 8) return C.sDk; // 腿关节
    return null;
  };
  const legTop = () => C.sMid;
  const legBot = () => C.sDk;

  const cells = [
    ...partCells(0, headBase, { front: headFront, top: headTop, bot: headBot }),
    ...partCells(1, bodyBase, { top: bodyTop, bot: bodyBot }),
    ...partCells(2, legBase, { front: legAll, back: legAll, left: legAll, right: legAll, top: legTop, bot: legBot }),
    ...partCells(3, legBase, { front: legAll, back: legAll, left: legAll, right: legAll, top: legTop, bot: legBot }),
  ];
  return buildSkinSVG(cells);
}

function villagerSkinSVG() {
  const headBase = noisy(C.vSkin, 8, 241);
  const bodyBase = noisy(C.vRobe, 8, 242);
  const armBase = noisy(C.vRobe, 8, 243);
  const legBase = noisy(C.vPants, 6, 244);

  // 脸：一字眉 + 绿眼 + 大鼻子（中央竖条）+ 嘴线（原版村民五官位）
  const headFront = (x, y) => {
    if (y === 7 && x >= 4 && x <= 11) return C.vSkinDD;               // 一字眉
    if (y >= 9 && y <= 10 && ((x >= 4 && x <= 5) || (x >= 10 && x <= 11))) return C.vEye; // 绿眼
    if (y >= 10 && y <= 13 && x >= 7 && x <= 8) return C.vSkinD;      // 大鼻
    if (y === 14 && x >= 6 && x <= 9) return C.vSkinDD;               // 嘴
    return null;
  };
  const headBack = (x, y) => (y <= 6 ? C.vSkinD : null);              // 颅后剃发阴影
  const headSide = (x, y) => (y >= 13 ? C.vSkinD : null);
  const headTop = () => C.vSkinD;                                     // 秃顶
  const headBot = () => C.vSkinDD;

  // 长袍：中缝暗线 + 下摆加深（原版平民袍）
  const bodyFront = (x, y) => {
    if (x === 7 || x === 8) return C.vRobeD;                          // 中缝
    if (y <= 2) return C.vRobeD;                                      // 下摆
    return null;
  };
  const bodyBack = (x, y) => (y <= 2 ? C.vRobeD : null);
  const bodySide = (x, y) => (y <= 2 ? C.vRobeD : null);
  const bodyTop = () => C.vRobeHi;
  const bodyBot = () => C.vRobeD;

  // 臂（垂放）：袍袖 + 下端手
  const armAll = (x, y) => (y <= 3 ? C.vSkin : null);
  const armTop = () => C.vRobeHi;
  const armBot = () => C.vSkinD;

  // 腿：深色裤 + 脚
  const legAll = (x, y) => (y >= 13 ? C.vRobeD : null);
  const legTop = () => C.vPants;
  const legBot = () => C.vRobeD;

  const cells = [
    ...partCells(0, headBase, { front: headFront, back: headBack, left: headSide, right: headSide, top: headTop, bot: headBot }),
    ...partCells(1, bodyBase, { front: bodyFront, back: bodyBack, left: bodySide, right: bodySide, top: bodyTop, bot: bodyBot }),
    ...partCells(2, armBase, { front: armAll, back: armAll, left: armAll, right: armAll, top: armTop, bot: armBot }),
    ...partCells(3, legBase, { front: legAll, back: legAll, left: legAll, right: legAll, top: legTop, bot: legBot }),
  ];
  return buildSkinSVG(cells);
}

function zombifiedPiglinSkinSVG() {
  const headBase = mottle(C.pSkin, C.pRot, 9, 251);
  const bodyBase = mottle(C.pSkin, C.pRot, 9, 252);
  const armBase = mottle(C.pSkin, C.pRot, 9, 253);
  const legBase = noisy(C.pCloth, 8, 254);

  // 脸：猪灵重眉 + 黑眼 + 中央大猪鼻（鼻孔两点）+ 绿腐斑（僵尸化特征）
  const headFront = (x, y) => {
    if (y === 5 && x >= 3 && x <= 12) return C.pSkinDD;                                  // 重眉
    if (y >= 6 && y <= 8 && ((x >= 4 && x <= 5) || (x >= 10 && x <= 11))) return C.black; // 黑眼
    if (y >= 9 && y <= 12 && x >= 5 && x <= 10) return C.pSkinD;                          // 大鼻
    if (y >= 10 && y <= 11 && ((x === 6) || (x === 9))) return C.pNostril;                // 鼻孔
    if (y === 14 && x >= 5 && x <= 10) return C.pSkinDD;                                  // 嘴
    return null;
  };
  const headTop = (x, y) => {
    if (hash01(x, y, 255) < 0.25) return C.pRot;                                          // 头顶腐斑
    if ((y <= 3) && ((x >= 2 && x <= 4) || (x >= 11 && x <= 13))) return C.pSkinD;        // 耳根
    return null;
  };
  const headBot = () => C.pSkinDD;

  // 躯干：裸胸 + 腰布（下摆 3 行深棕布）
  const bodyFront = (x, y) => {
    if (y >= 13) return C.pCloth;
    if (y >= 12) return C.pClothD;
    if (x >= 6 && x <= 9 && hash01(x, y, 256) < 0.3) return C.pRotD;                      // 腐斑条
    return null;
  };
  const bodyBack = (x, y) => (y >= 12 ? C.pCloth : null);
  const bodySide = (x, y) => (y >= 12 ? C.pCloth : (y >= 12 ? C.pCloth : null));
  const bodyTop = () => C.pSkinD;
  const bodyBot = () => C.pClothD;

  // 臂（前伸）：皮肤 + 手端腐化
  const armFront = (x, y) => (y >= 12 ? C.pRotD : null);
  const armSide = (x, y) => (y >= 12 ? C.pRotD : (y <= 3 ? C.pSkinD : null));
  const armBot = () => C.pRotD;

  // 腿：深棕裙裤 + 暗色脚
  const legAll = (x, y) => (y >= 13 ? C.pClothD : null);
  const legTop = () => C.pCloth;
  const legBot = () => C.pClothD;

  const cells = [
    ...partCells(0, headBase, { front: headFront, top: headTop, bot: headBot }),
    ...partCells(1, bodyBase, { front: bodyFront, back: bodyBack, left: bodySide, right: bodySide, top: bodyTop, bot: bodyBot }),
    ...partCells(2, armBase, { front: armFront, left: armSide, right: armSide, bot: armBot }),
    ...partCells(3, legBase, { front: legAll, back: legAll, left: legAll, right: legAll, top: legTop, bot: legBot }),
  ];
  return buildSkinSVG(cells);
}

function witherSkeletonSkinSVG() {
  const boneBase = noisy(C.wBone, 6, 261);

  // 脸：焦黑颅骨 + 深眼窝 + 颧骨暗灰高光
  const headFront = (x, y) => {
    if (y >= 6 && y <= 8 && ((x >= 4 && x <= 6) || (x >= 9 && x <= 11))) return C.black;
    if (y >= 9 && y <= 10 && x >= 7 && x <= 8) return C.wBoneHi;
    if (y >= 12 && y <= 14 && x >= 4 && x <= 11) return (x % 2 === 0) ? C.wBoneHi : C.wBoneD; // 牙列
    if (y === 15) return C.wBoneD;
    return null;
  };
  const headBack = (x, y) => (y >= 6 && y <= 12 && hash01(x, y, 262) < 0.25 ? C.wBoneD : null);
  const headSide = (x, y) => (y >= 7 && y <= 10 && x >= 6 && x <= 9 ? C.wBoneD : null);
  const headTop = (x, y) => (x === 7 || x === 8 ? C.wBoneHi : null);
  const headBot = () => C.wBoneD;

  // 躯干：暗肋条（炭黑骨架肋排）
  const bodyFront = (x, y) => {
    if (y >= 1 && y <= 12 && y % 2 === 0 && x >= 2 && x <= 13) return C.wBoneHi;
    if (y >= 13) return C.wBoneD;
    return null;
  };
  const bodyBack = (x, y) => (x >= 6 && x <= 9 && y >= 1 && y <= 13 ? C.wBoneD : null);
  const bodySide = (x, y) => (y >= 1 && y <= 12 && y % 2 === 0 ? C.wBoneD : null);
  const bodyTop = () => C.wBoneHi;
  const bodyBot = () => C.wBoneD;

  // 长肢：关节暗环（高个比例，骨色同头）
  const limbAll = (x, y) => {
    if (y >= 7 && y <= 8) return C.wBoneD;
    if (y >= 14) return C.wBoneD;
    return null;
  };
  const limbTop = () => C.wBoneHi;
  const limbBot = () => C.wBoneD;

  const cells = [
    ...partCells(0, boneBase, { front: headFront, back: headBack, left: headSide, right: headSide, top: headTop, bot: headBot }),
    ...partCells(1, boneBase, { front: bodyFront, back: bodyBack, left: bodySide, right: bodySide, top: bodyTop, bot: bodyBot }),
    ...partCells(2, boneBase, { front: limbAll, back: limbAll, left: limbAll, right: limbAll, top: limbTop, bot: limbBot }),
    ...partCells(3, boneBase, { front: limbAll, back: limbAll, left: limbAll, right: limbAll, top: limbTop, bot: limbBot }),
  ];
  return buildSkinSVG(cells);
}

function blazeSkinSVG() {
  const headBase = noisy(C.bGold, 10, 271);
  const coreBase = mottle(C.bCore, C.bCoreD, 6, 272);
  const rodOuter = noisy(C.bRod, 12, 273);
  const rodInner = noisy(C.bRodD, 10, 274);

  // 脸：竖直黑眼 + 紧闭嘴缝（原版烈焰人面部）
  const headFront = (x, y) => {
    if (y >= 6 && y <= 9 && ((x >= 4 && x <= 5) || (x >= 10 && x <= 11))) return C.black;
    if (y === 12 && x >= 6 && x <= 9) return C.bGoldD;
    return null;
  };
  const headTop = (x, y) => (hash01(x, y, 275) < 0.3 ? C.bGoldHi : null);
  const headBot = () => C.bGoldD;

  // 烟芯：暗色烟雾质感
  const coreFront = (x, y) => (hash01(x, y, 276) < 0.25 ? C.bCoreD : null);
  const coreTop = () => C.bCoreD;
  const coreBot = () => C.bCoreD;

  // 岩浆杆：竖向亮条纹（外杆亮黄纹，内杆暗橙）
  const rodOuterFront = (x) => (x % 4 < 2 ? C.bGoldHi : null);
  const rodInnerFront = (x) => (x % 4 < 2 ? C.bRod : null);
  const rodTop = () => C.bGoldHi;
  const rodBot = () => C.bGoldD;

  const cells = [
    ...partCells(0, headBase, { front: headFront, top: headTop, bot: headBot }),
    ...partCells(1, coreBase, { front: coreFront, top: coreTop, bot: coreBot }),
    ...partCells(2, rodOuter, { front: rodOuterFront, top: rodTop, bot: rodBot }),
    ...partCells(3, rodInner, { front: rodInnerFront, top: rodTop, bot: rodBot }),
  ];
  return buildSkinSVG(cells);
}

// 末影龙：黑鳞 + 紫眼 + 灰腹膜翼（原版末影龙配色）
function dragonSkinSVG() {
  const scaleBase = noisy(C.dScale, 12, 291);        // 头/颈/尾：黑鳞
  const bodyBase = noisy(C.dScaleD, 12, 292);        // 躯干：更暗鳞
  const wingBase = mottle(C.dWing, C.dWingD, 7, 293); // 翼膜：灰紫斑驳
  const legBase = noisy(C.dScaleD, 10, 294);         // 爪腿

  // 龙脸：紫色大眼 + 吻部缝 + 头顶双角根（front 视角 16×16）
  const headFront = (x, y) => {
    if (y >= 5 && y <= 7 && ((x >= 2 && x <= 4) || (x >= 11 && x <= 13))) return C.dEye;
    if (y >= 5 && y <= 7 && ((x === 1) || (x === 3) || (x === 12) || (x === 14))) return C.dEyeD;
    if (y >= 11 && y <= 12 && x >= 5 && x <= 10) return C.black;   // 嘴缝
    if (y >= 13 && x >= 6 && x <= 9) return C.dScaleD;             // 下颚
    return null;
  };
  const headTop = (x, y) => {
    if (y >= 3 && y <= 4 && ((x >= 3 && x <= 4) || (x >= 11 && x <= 12))) return C.dHorn; // 角根
    return hash01(x, y, 295) < 0.2 ? C.dScaleD : null;
  };
  const headSide = (x, y) => (y >= 5 && y <= 7 && x <= 3 ? C.dEyeD : null); // 侧脸眼角
  const headBot = () => C.dBelly;

  // 躯干：腹侧灰膜（bot）+ 背脊暗刺
  const bodyTop = (x, y) => (hash01(x, y, 296) < 0.3 ? C.black : null);   // 背脊刺
  const bodyBot = () => C.dBelly;                                          // 腹膜
  const bodyFront = (x, y) => (y >= 12 ? C.dBelly : null);

  // 翼膜：翼骨走向暗纹（front/back 为翼面上下面）
  const wingFront = (x, y) => (x % 5 === 0 ? C.dWingD : (hash01(x, y, 297) < 0.15 ? C.dWingD : null));
  const wingTop = () => C.dScaleD;   // 翼骨侧（top/bot 是骨边）
  const wingBot = () => C.dScaleD;

  // 爪：端部亮爪尖
  const legFront = (x, y) => (y >= 13 ? C.dHorn : null);
  const legBot = () => C.dHorn;

  const cells = [
    ...partCells(0, scaleBase, { front: headFront, left: headSide, right: headSide, top: headTop, bot: headBot }),
    ...partCells(1, bodyBase, { front: bodyFront, top: bodyTop, bot: bodyBot }),
    ...partCells(2, wingBase, { front: wingFront, back: wingFront, top: wingTop, bot: wingBot }),
    ...partCells(3, legBase, { front: legFront, top: null, bot: legBot }),
  ];
  return buildSkinSVG(cells);
}


// === 部件定义 ===
// box = [minX, minY, minZ, maxX, maxY, maxZ]，局部坐标，原点在脚 y=0，+Z 朝脸的方向
// （Mob.js yaw=atan2(nx,nz) 使 +Z 指向移动方向：脸朝玩家、蜘蛛头在前）

// humanoid（僵尸）6 部位：头 / 身 / 2 臂（前伸，原版标志性姿势）/ 2 腿
const HUMANOID_PARTS = [
  { name: 'head',  row: 0, box: [-0.25, 1.50, -0.25,  0.25, 2.00, 0.25] },
  { name: 'body',  row: 1, box: [-0.28, 0.75, -0.16,  0.28, 1.50, 0.16] },
  { name: 'armR',  row: 2, box: [-0.52, 1.28,  0.14, -0.30, 1.50, 0.89] },
  { name: 'armL',  row: 2, box: [ 0.30, 1.28,  0.14,  0.52, 1.50, 0.89] },
  { name: 'legR',  row: 3, box: [-0.20, 0,    -0.11,  0.00, 0.75, 0.11] },
  { name: 'legL',  row: 3, box: [ 0.00, 0,    -0.11,  0.20, 0.75, 0.11] },
];

// 骷髅：同僵尸布局但四肢更细（原版 2px 肢体比例）
const SKELETON_PARTS = [
  { name: 'head',  row: 0, box: [-0.25, 1.50, -0.25,  0.25, 2.00, 0.25] },
  { name: 'body',  row: 1, box: [-0.28, 0.75, -0.16,  0.28, 1.50, 0.16] },
  { name: 'armR',  row: 2, box: [-0.44, 1.30,  0.14, -0.30, 1.44, 0.89] },
  { name: 'armL',  row: 2, box: [ 0.30, 1.30,  0.14,  0.44, 1.44, 0.89] },
  { name: 'legR',  row: 3, box: [-0.21, 0,    -0.07, -0.07, 0.75, 0.07] },
  { name: 'legL',  row: 3, box: [ 0.07, 0,    -0.07,  0.21, 0.75, 0.07] },
];

// 苦力怕：头 / 身 / 4 条腿（身 8×12×4 原版比例：宽 0.5、深 0.28）
const CREEPER_PARTS = [
  { name: 'head',  row: 0, box: [-0.25, 1.20, -0.25,  0.25, 1.70, 0.25] },
  { name: 'body',  row: 1, box: [-0.25, 0.40, -0.14,  0.25, 1.20, 0.14] },
  { name: 'legFR', row: 2, box: [-0.24, 0,     0.02,  -0.02, 0.40, 0.24] },
  { name: 'legFL', row: 2, box: [ 0.02, 0,     0.02,   0.24, 0.40, 0.24] },
  { name: 'legBR', row: 3, box: [-0.24, 0,    -0.24,  -0.02, 0.40, -0.02] },
  { name: 'legBL', row: 3, box: [ 0.02, 0,    -0.24,   0.24, 0.40, -0.02] },
];

// 蜘蛛：头胸(前) + 腹部(后) + 8 条腿（4 对）
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

// 村民：人形，手臂垂放体侧（非僵尸前伸式），长袍身更宽更垂
const VILLAGER_PARTS = [
  { name: 'head',  row: 0, box: [-0.25, 1.50, -0.25,  0.25, 2.00, 0.25] },
  { name: 'body',  row: 1, box: [-0.30, 0.72, -0.18,  0.30, 1.50, 0.18] },
  { name: 'armR',  row: 2, box: [-0.48, 0.90, -0.10, -0.32, 1.42, 0.06] },
  { name: 'armL',  row: 2, box: [ 0.32, 0.90, -0.10,  0.48, 1.42, 0.06] },
  { name: 'legR',  row: 3, box: [-0.20, 0,    -0.11,  0.00, 0.75, 0.11] },
  { name: 'legL',  row: 3, box: [ 0.00, 0,    -0.11,  0.20, 0.75, 0.11] },
];

// 凋零骷髅：骷髅布局的高个变体（2.4 高，腿/身拉长，臂前伸持石剑姿势）
const WITHER_PARTS = [
  { name: 'head',  row: 0, box: [-0.25, 1.90, -0.25,  0.25, 2.40, 0.25] },
  { name: 'body',  row: 1, box: [-0.30, 1.15, -0.18,  0.30, 1.90, 0.18] },
  { name: 'armR',  row: 2, box: [-0.48, 1.62,  0.16, -0.34, 1.84, 1.06] },
  { name: 'armL',  row: 2, box: [ 0.34, 1.62,  0.16,  0.48, 1.84, 1.06] },
  { name: 'legR',  row: 3, box: [-0.22, 0,    -0.09, -0.02, 1.15, 0.09] },
  { name: 'legL',  row: 3, box: [ 0.02, 0,    -0.09,  0.22, 1.15, 0.09] },
];

// 烈焰人：悬浮的金黄头颅 + 烟黑核心 + 4 根岩浆杆（外 2 高杆 row2 / 内 2 短杆 row3）
const BLAZE_PARTS = [
  { name: 'head',   row: 0, box: [-0.25, 1.20, -0.25,  0.25, 1.70, 0.25] },
  { name: 'core',   row: 1, box: [-0.20, 0.50, -0.20,  0.20, 1.20, 0.20] },
  { name: 'rodFR',  row: 2, box: [ 0.22, 0,     0.08,  0.34, 0.90, 0.20] },
  { name: 'rodFL',  row: 2, box: [-0.34, 0,     0.08, -0.22, 0.90, 0.20] },
  { name: 'rodBR',  row: 3, box: [ 0.22, 0,    -0.20,  0.34, 0.72, -0.08] },
  { name: 'rodBL',  row: 3, box: [-0.34, 0,    -0.20, -0.22, 0.72, -0.08] },
];

// 末影龙：头颈朝 +Z、三段尾朝 -Z、双翼横展薄片、4 短爪（Boss 体型 ~7 格长 3.4 高）
// row 复用：row0=鳞色（头/颈/尾），row1=躯干，row2=翼膜，row3=爪腿
const DRAGON_PARTS = [
  { name: 'head',  row: 0, box: [-0.45, 2.55,  1.55,  0.45, 3.35, 2.75] },
  { name: 'neck',  row: 0, box: [-0.30, 2.45,  0.85,  0.30, 3.15, 1.70] },
  { name: 'body',  row: 1, box: [-0.75, 1.85, -1.75,  0.75, 3.10, 1.60] },
  { name: 'tail1', row: 0, box: [-0.35, 2.05, -3.10,  0.35, 2.60, -1.60] },
  { name: 'tail2', row: 0, box: [-0.22, 1.95, -4.50,  0.22, 2.40, -3.00] },
  { name: 'tail3', row: 0, box: [-0.12, 1.90, -5.55,  0.12, 2.25, -4.40] },
  { name: 'wingL', row: 2, box: [-3.60, 2.65, -1.55, -0.60, 2.85,  1.30] },
  { name: 'wingR', row: 2, box: [ 0.60, 2.65, -1.55,  3.60, 2.85,  1.30] },
  { name: 'legFL', row: 3, box: [-0.70, 0.85,  0.75, -0.25, 1.90,  1.45] },
  { name: 'legFR', row: 3, box: [ 0.25, 0.85,  0.75,  0.70, 1.90,  1.45] },
  { name: 'legBL', row: 3, box: [-0.62, 0.85, -1.55, -0.20, 1.90, -0.85] },
  { name: 'legBR', row: 3, box: [ 0.20, 0.85, -1.55,  0.62, 1.90, -0.85] },
];

// === 入口：返回各 type 的 skin SVG + parts ===
export function generateMobSkinSVGs() {
  return {
    zombie:            zombieSkinSVG(),
    skeleton:          skeletonSkinSVG(),
    creeper:           creeperSkinSVG(),
    spider:            spiderSkinSVG(),
    villager:          villagerSkinSVG(),
    zombified_piglin:  zombifiedPiglinSkinSVG(),
    wither_skeleton:   witherSkeletonSkinSVG(),
    blaze:             blazeSkinSVG(),
    dragon:            dragonSkinSVG(),
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
    model: { parts: SKELETON_PARTS, kind: 'cuboid' },
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
  villager: {
    name: 'villager',
    displayName: '村民',
    width: 0.6,
    height: 1.95,
    health: 20,
    damage: 0,           // 被动：无攻击
    speed: 2.4,
    attackRange: 0,
    detectionRange: 0,   // 永不主动索敌玩家
    burningInDay: false,
    passive: true,       // Mob.js 走 passive AI 分支（游荡/注视/逃离）
    model: { parts: VILLAGER_PARTS, kind: 'cuboid' },
    drops: [],
  },
  zombified_piglin: {
    name: 'zombified_piglin',
    displayName: '僵尸猪灵',
    width: 0.6,
    height: 1.95,
    health: 20,
    damage: 4,
    speed: 2.6,
    attackRange: 1.5,
    detectionRange: 16,
    burningInDay: false, // 下界无日光
    neutral: true,       // 中立：受击才激怒（MobManager.attackMob 传播同族仇恨）
    model: { parts: HUMANOID_PARTS, kind: 'cuboid' },
    drops: [
      { name: 'rotten_flesh', min: 0, max: 1 },
      { name: 'gold_nugget', min: 0, max: 2 },
    ],
    rareDrop: { name: 'gold_ingot', chance: 0.05 },
  },
  wither_skeleton: {
    name: 'wither_skeleton',
    displayName: '凋零骷髅',
    width: 0.6,
    height: 2.4,         // 高个（模型头部顶点 2.4）
    health: 20,
    damage: 4,
    speed: 2.4,
    attackRange: 1.7,
    detectionRange: 16,
    burningInDay: false,
    model: { parts: WITHER_PARTS, kind: 'cuboid' },
    drops: [
      { name: 'coal', min: 0, max: 1 },
      { name: 'bone', min: 0, max: 2 },
    ],
  },
  blaze: {
    name: 'blaze',
    displayName: '烈焰人',
    width: 0.6,
    height: 1.7,
    health: 20,
    damage: 4,
    speed: 2.2,
    attackRange: 2.2,
    detectionRange: 16,
    burningInDay: false,
    flying: true,        // 悬浮（EntityPhysics 跳过重力，Mob.update 竖直悬停控制）
    igniteOnHit: true,   // 命中点燃玩家（复用 onFire 通道）
    model: { parts: BLAZE_PARTS, kind: 'cuboid' },
    drops: [
      { name: 'blaze_rod', min: 0, max: 1, chance: 0.6 },
    ],
  },
  dragon: {
    name: 'dragon',
    displayName: '末影龙',
    width: 3.2,          // 水平碰撞体（翼展不含碰撞）
    height: 3.4,         // 头部顶点（attackMob 球体射线半径 = height/2）
    health: 200,
    damage: 8,
    speed: 6,
    attackRange: 3.8,
    detectionRange: 96,
    burningInDay: false,
    flying: true,        // 龙全程飞行（DragonAI 接管全部速度/朝向）
    boss: true,          // Boss 标记：不进自然生成表；死亡触发 onDragonDefeated
    model: { parts: DRAGON_PARTS, kind: 'cuboid' },
    drops: [
      { name: 'dragon_egg', min: 1, max: 1 },
    ],
  },
};
