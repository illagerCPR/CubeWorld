// BlockDefs.js -- 方块定义 + 对应 SVG 生成
// 程序化生成 16x16 SVG，全部内联，无外部图片
// 阶段 9：材质重绘——原版配色校准 + 结构化像素画（砖缝/木板拼条/圆石砌块/年轮/矿石晶簇），
// 注册名 / textures key / SVG 管线保持不变，仅替换纹理生成实现。
import { BlockRegistry } from '../core/BlockRegistry.js';
import { SVGTextures } from '../render/SVGTextures.js';

const { pixelSvg, rng } = SVGTextures;

// ---------- 像素画基础工具 ----------
function makeTex() { return new Array(256).fill(null); }

function setPx(px, x, y, c) {
  if (x >= 0 && x < 16 && y >= 0 && y < 16) px[y * 16 + x] = c;
}

function fillRect(px, x0, y0, x1, y1, c) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setPx(px, x, y, c);
}

// [r,g,b] × f → 'rgb(...)' 字符串
function rgb(c, f = 1) {
  const r = Math.max(0, Math.min(255, Math.round(c[0] * f)));
  const g = Math.max(0, Math.min(255, Math.round(c[1] * f)));
  const b = Math.max(0, Math.min(255, Math.round(c[2] * f)));
  return `rgb(${r},${g},${b})`;
}

// 确定性散列 [0,1)（与 rng 等价的带坐标记忆版本，噪点分布稳定）
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 974634073) >>> 0;
  h = ((h ^ (h >>> 13)) * 1103515245) >>> 0;
  return (h >>> 16) / 65536;
}

// 三色噪声底（原版风：基色为主 + 少量暗/亮碎点 + 轻微抖动）
function noiseTex(base, seed, opts = {}) {
  const dark = opts.dark ?? 0.86, light = opts.light ?? 1.1;
  const dProb = opts.dProb ?? 0.16, lProb = opts.lProb ?? 0.12;
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x, y, seed);
      let f = 1 + (hash2(x, y, seed + 1) - 0.5) * 0.06;
      if (t < dProb) f *= dark;
      else if (t > 1 - lProb) f *= light;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

// 2×2 块状斑驳（基岩/沙砾/末地石等大颗粒质感）
function blotchTex(base, seed, opts = {}) {
  const dark = opts.dark ?? 0.72, light = opts.light ?? 1.25;
  const dProb = opts.dProb ?? 0.25, lProb = opts.lProb ?? 0.2;
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x >> 1, y >> 1, seed);
      let f;
      if (t < dProb) f = dark;
      else if (t > 1 - lProb) f = light;
      else f = 0.96 + hash2(x, y, seed + 1) * 0.08;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

// ---------- 自然方块 ----------
function stoneTex(seed) {
  return noiseTex([125, 125, 125], seed, { dark: 0.9, light: 1.08, dProb: 0.2, lProb: 0.15 });
}

function grassTopTex(seed) {
  const px = makeTex();
  const g = [124, 178, 80];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x, y, seed);
      let f = 0.9 + hash2(x, y, seed + 1) * 0.2;
      if (t < 0.14) f *= 0.82;
      else if (t > 0.88) f *= 1.15;
      px[y * 16 + x] = rgb(g, f);
    }
  }
  return pixelSvg(px);
}

// 草侧面：泥土 + 顶部锯齿草皮（每列 2~4px 深浅过渡）
function grassSideTex(seed) {
  const px = makeTex();
  const dirt = [134, 96, 67], grass = [110, 158, 72];
  for (let x = 0; x < 16; x++) {
    const depth = 2 + Math.floor(hash2(x, 0, seed) * 3);
    for (let y = 0; y < 16; y++) {
      if (y < depth) px[y * 16 + x] = rgb(grass, 0.9 + hash2(x, y, seed + 1) * 0.2);
      else if (y === depth) px[y * 16 + x] = rgb(grass, 0.62);
      else px[y * 16 + x] = rgb(dirt, 0.9 + hash2(x, y, seed + 2) * 0.2);
    }
  }
  return pixelSvg(px);
}

function waterTex() {
  const px = makeTex();
  const base = [52, 96, 218];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // 周期取 16 的整数分频 → 世界平铺无缝
      const w = Math.sin(x * Math.PI / 8 + y * Math.PI / 4) * 0.5 + 0.5;
      px[y * 16 + x] = rgb(base, 0.85 + w * 0.3);
    }
  }
  return pixelSvg(px);
}

function lavaTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x >> 1, y >> 1, seed);
      let c;
      if (t < 0.3) c = [252, 172, 48];
      else if (t < 0.5) c = [232, 108, 24];
      else c = [200, 62, 16];
      px[y * 16 + x] = rgb(c, 0.94 + hash2(x, y, seed + 1) * 0.12);
    }
  }
  return pixelSvg(px);
}

function obsidianTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x >> 1, y >> 1, seed);
      let c = [28, 22, 40];
      if (t < 0.22) c = [16, 12, 24];
      else if (t > 0.82) c = [52, 40, 78];
      if (hash2(x, y, seed + 3) < 0.05) c = [92, 68, 128];
      px[y * 16 + x] = rgb(c, 0.9 + hash2(x, y, seed + 1) * 0.2);
    }
  }
  return pixelSvg(px);
}

function iceTex(seed, base = [150, 187, 235]) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.92 + hash2(x, y, seed) * 0.16;
      if ((x + y) % 8 === 3) f *= 1.18;
      else if ((x + y) % 8 === 4) f *= 0.9;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

function leavesTex(seed, tone) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x, y, seed);
      if (t < 0.11) continue; // 透光孔
      let f = 0.82 + hash2(x, y, seed + 1) * 0.4;
      if (t > 0.86) f *= 1.2;
      px[y * 16 + x] = rgb(tone, f);
    }
  }
  return pixelSvg(px);
}

function cactusTex(seed) {
  const px = makeTex();
  const g = [58, 118, 44];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.92 + hash2(x, y, seed) * 0.16;
      if (x <= 1 || x >= 14) f *= 0.8;
      else if (x === 2 || x === 13) f *= 1.1;
      if ((x <= 1 || x >= 14) && y % 4 === 2) px[y * 16 + x] = 'rgb(214,214,182)';
      else px[y * 16 + x] = rgb(g, f);
    }
  }
  return pixelSvg(px);
}

function pumpkinSideTex(seed) {
  const px = makeTex();
  const o = [206, 122, 30];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.9 + hash2(x, y, seed) * 0.18;
      if (x % 5 === 0) f *= 0.72;
      else if (x % 5 === 1) f *= 1.12;
      px[y * 16 + x] = rgb(o, f);
    }
  }
  return pixelSvg(px);
}

function pumpkinTopTex(seed) {
  const px = makeTex();
  const o = [206, 122, 30];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.9 + hash2(x, y, seed) * 0.16;
      if (x <= 1 || x >= 14 || y <= 1 || y >= 14) f *= 0.8;
      px[y * 16 + x] = rgb(o, f);
    }
  }
  fillRect(px, 7, 7, 8, 8, rgb([88, 110, 40]));
  return pixelSvg(px);
}

function melonTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const stripe = (x >> 1) % 2 === 0;
      const base = stripe ? [88, 148, 44] : [156, 196, 80];
      px[y * 16 + x] = rgb(base, 0.9 + hash2(x, y, seed) * 0.2);
    }
  }
  return pixelSvg(px);
}

function haySideTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.88 + hash2(x >> 2, y, seed) * 0.24;
      if (y <= 1 || y >= 14) f *= 0.78;
      if ((x + y * 3) % 11 === 0) f *= 0.8;
      px[y * 16 + x] = rgb([200, 168, 60], f);
    }
  }
  return pixelSvg(px);
}

function hayTopTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const weave = ((x >> 2) + (y >> 2)) % 2 === 0;
      const base = weave ? [214, 182, 74] : [188, 152, 48];
      px[y * 16 + x] = rgb(base, 0.92 + hash2(x, y, seed) * 0.16);
    }
  }
  return pixelSvg(px);
}

// ---------- 矿石 / 深板岩 ----------
// 石底 + 4 组晶簇（中心 + 十字 + 高光/阴影点）
function oreTex(stoneBase, ore, seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb(stoneBase, 0.92 + hash2(x, y, seed) * 0.16);
    }
  }
  const clusters = [[3, 3], [9, 6], [12, 11], [5, 12]];
  for (const [cx, cy] of clusters) {
    const pts = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]];
    for (const [dx, dy] of pts) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x > 15 || y < 0 || y > 15) continue;
      px[y * 16 + x] = rgb(ore, 0.9 + hash2(x, y, seed + 9) * 0.25);
    }
    setPx(px, cx - 1, cy - 1, rgb(ore, 1.35));
    setPx(px, cx + 1, cy + 1, rgb(ore, 0.6));
  }
  return pixelSvg(px);
}

function deepslateTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x, y >> 2, seed);
      let f = 0.9 + hash2(x, y, seed + 1) * 0.14;
      if (t < 0.2) f *= 0.8;
      px[y * 16 + x] = rgb([74, 74, 82], f);
    }
  }
  return pixelSvg(px);
}

// ---------- 砖石类 ----------
// 圆石：4×4 砌块，奇数行错位 2px，块间深缝
function cobbleTex(seed) {
  const px = makeTex();
  const r = rng(seed);
  const v = [];
  for (let i = 0; i < 20; i++) v.push(0.86 + r() * 0.3);
  for (let y = 0; y < 16; y++) {
    const row = y >> 2;
    const off = (row % 2) * 2;
    for (let x = 0; x < 16; x++) {
      const xx = (x + off) & 15;
      const isSeam = (xx & 3) === 3 || (y & 3) === 3;
      const f = isSeam ? 0.62 : v[row * 5 + (xx >> 2)] * (0.95 + hash2(x, y, seed) * 0.1);
      px[y * 16 + x] = rgb([126, 126, 126], f);
    }
  }
  return pixelSvg(px);
}

// 石砖：2×2 大砖（8×8），右上/右下 1px 缝 + 上/左受光边
function stoneBricksTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.95 + hash2(x, y, seed) * 0.1;
      if ((x & 7) === 0 || (y & 7) === 0) f *= 1.08;
      if ((x & 7) === 7 || (y & 7) === 7) f = 0.55;
      px[y * 16 + x] = rgb([122, 122, 122], f);
    }
  }
  return pixelSvg(px);
}

// 红砖：4 行交错砖 + 浅灰缝
function brickTex(seed) {
  const px = makeTex();
  const brick = [150, 97, 83], mortar = [172, 165, 160];
  for (let y = 0; y < 16; y++) {
    const row = y >> 2;
    for (let x = 0; x < 16; x++) {
      const xx = (x + (row % 2) * 4) & 15;
      if ((y & 3) === 3 || (xx & 7) === 7) px[y * 16 + x] = rgb(mortar);
      else px[y * 16 + x] = rgb(brick, 0.9 + hash2(xx, y, seed) * 0.2);
    }
  }
  return pixelSvg(px);
}

function sandstoneTex(seed) {
  const px = makeTex();
  const base = [216, 203, 155];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.94 + hash2(x, y, seed) * 0.1;
      if (y <= 1) f *= 1.08;
      else if (y >= 14) f *= 0.82;
      else if (hash2(0, y >> 1, seed + 2) < 0.3) f *= 0.92;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

// ---------- 木质类 ----------
// 木板：4 横板 + 横缝 + 每板 1 条端缝 + 板上沿受光
function planksTex(base, seed, seamF = 0.62) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const row = y >> 2;
      const jointX = (5 + row * 4 + ((row * 7) % 3)) & 15;
      let f = 0.94 + hash2(x, y, seed) * 0.12;
      if ((y & 3) === 3) f = seamF;
      else if (x === jointX) f = seamF * 1.05;
      else if ((y & 3) === 0) f *= 1.08;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

// 原木侧面：竖向断续纹 + 侧棱暗
function logSideTex(bark, seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x, y >> 2, seed);
      let f = 1;
      if (t < 0.18) f = 0.78;
      else if (t > 0.85) f = 1.12;
      f *= 0.95 + hash2(x, y, seed + 1) * 0.1;
      if (x === 0 || x === 15) f *= 0.92;
      px[y * 16 + x] = rgb(bark, f);
    }
  }
  return pixelSvg(px);
}

// 原木顶面：树皮边 + 年轮 + 亮芯
function logTopTex(bark, ring, seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      let c, f;
      if (d > 6.6) {
        c = bark;
        f = 0.9 + hash2(x, y, seed) * 0.2;
      } else {
        const ringIdx = Math.floor(d);
        c = ringIdx % 2 === 0 ? ring : [Math.min(255, ring[0] + 22), Math.min(255, ring[1] + 20), Math.min(255, ring[2] + 16)];
        f = 0.92 + hash2(x, y, seed + 2) * 0.16;
        if (d < 1.6) f *= 1.1;
      }
      px[y * 16 + x] = rgb(c, f);
    }
  }
  return pixelSvg(px);
}

// ---------- 功能方块 ----------
function craftingTopTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([162, 130, 78], 0.92 + hash2(x, y, seed) * 0.14);
    }
  }
  const frame = rgb([96, 72, 40]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  const grid = rgb([110, 84, 48]);
  for (let i = 2; i <= 13; i++) {
    setPx(px, 5, i, grid); setPx(px, 10, i, grid);
    setPx(px, i, 5, grid); setPx(px, i, 10, grid);
  }
  return pixelSvg(px);
}

function craftingSideTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([152, 120, 72], 0.92 + hash2(x, y, seed) * 0.14);
    }
  }
  fillRect(px, 0, 0, 15, 3, rgb([118, 90, 50]));
  fillRect(px, 0, 4, 15, 4, rgb([180, 148, 92]));
  fillRect(px, 3, 6, 7, 7, rgb([126, 98, 56]));
  fillRect(px, 4, 8, 6, 13, rgb([96, 72, 40]));
  fillRect(px, 9, 8, 11, 13, rgb([96, 72, 40]));
  fillRect(px, 10, 6, 12, 7, rgb([126, 98, 56]));
  return pixelSvg(px);
}

function furnaceTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([120, 120, 120], 0.9 + hash2(x, y, seed) * 0.2);
    }
  }
  const frame = rgb([88, 88, 88]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  fillRect(px, 5, 8, 10, 8, rgb([70, 70, 70]));
  fillRect(px, 4, 9, 11, 13, rgb([30, 30, 30]));
  fillRect(px, 5, 12, 10, 13, rgb([58, 44, 36]));
  return pixelSvg(px);
}

// TNT 侧面：红底 + 白带 + TNT 字样
function tntSideTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.9 + hash2(x, y, seed) * 0.2;
      let c = [196, 62, 44];
      if (y <= 1 || y >= 14) c = [124, 40, 32];
      px[y * 16 + x] = rgb(c, f);
    }
  }
  fillRect(px, 0, 6, 15, 9, 'rgb(236,232,224)');
  const ink = 'rgb(40,36,34)';
  fillRect(px, 3, 7, 5, 7, ink); fillRect(px, 4, 8, 4, 9, ink);   // T
  fillRect(px, 7, 7, 7, 9, ink); fillRect(px, 9, 7, 9, 9, ink); fillRect(px, 8, 8, 8, 8, ink); // N
  fillRect(px, 11, 7, 13, 7, ink); fillRect(px, 12, 8, 12, 9, ink); // T
  return pixelSvg(px);
}

function tntTopTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([160, 52, 38], 0.9 + hash2(x, y, seed) * 0.2);
    }
  }
  fillRect(px, 6, 6, 9, 9, rgb([92, 88, 84]));
  fillRect(px, 7, 7, 8, 8, rgb([60, 56, 52]));
  setPx(px, 7, 7, 'rgb(220,216,208)');
  return pixelSvg(px);
}

function glowstoneTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x >> 1, y >> 1, seed);
      let c;
      if (t < 0.32) c = [250, 214, 130];
      else if (t < 0.5) c = [220, 168, 88];
      else c = [148, 110, 72];
      px[y * 16 + x] = rgb(c, 0.94 + hash2(x, y, seed + 1) * 0.12);
    }
  }
  return pixelSvg(px);
}

function seaLanternTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      let c;
      if (d > 6.5) c = [186, 205, 208];
      else if (d > 4.5) c = [205, 224, 226];
      else c = [226, 240, 242];
      px[y * 16 + x] = rgb(c, 0.94 + hash2(x, y, seed) * 0.1);
    }
  }
  return pixelSvg(px);
}

function redstoneLampTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const f = 0.92 + hash2(x, y, seed) * 0.14;
      const c = (x % 4 === 0 || y % 4 === 0) ? [86, 58, 32] : [118, 82, 46];
      px[y * 16 + x] = rgb(c, f);
    }
  }
  fillRect(px, 6, 6, 9, 9, rgb([172, 128, 66]));
  return pixelSvg(px);
}

// 矿物块：斜面受光（上/左亮、下/右暗）
function mineralBlockTex(base, seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.96 + hash2(x, y, seed) * 0.08;
      if (x === 0 || y === 0) f *= 1.12;
      else if (x === 15 || y === 15) f *= 0.82;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

function soulTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([86, 65, 52], 0.9 + hash2(x, y, seed) * 0.2);
    }
  }
  const holes = [[3, 4], [9, 8], [12, 3]];
  for (const [hx, hy] of holes) {
    fillRect(px, hx, hy, hx + 1, hy + 1, rgb([44, 31, 24]));
    setPx(px, hx - 1, hy, rgb([64, 47, 37]));
    setPx(px, hx + 2, hy + 1, rgb([64, 47, 37]));
  }
  return pixelSvg(px);
}

function magmaTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x >> 1, y >> 1, seed);
      let c;
      if (t < 0.22) c = [236, 108, 28];
      else if (t < 0.36) c = [180, 62, 20];
      else c = [52, 30, 26];
      px[y * 16 + x] = rgb(c, 0.92 + hash2(x, y, seed + 1) * 0.16);
    }
  }
  return pixelSvg(px);
}

function glassTex() {
  const px = makeTex();
  const edge = 'rgb(226,245,247)';
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, edge); setPx(px, i, 15, edge);
    setPx(px, 0, i, edge); setPx(px, 15, i, edge);
  }
  const hi = 'rgb(240,252,254)';
  setPx(px, 3, 2, hi); setPx(px, 2, 3, hi);
  setPx(px, 5, 3, hi); setPx(px, 4, 4, hi); setPx(px, 3, 5, hi);
  return pixelSvg(px);
}

// 门：边框 + 中缝 + 上下凹板
function doorTex(base, seed, rivets = false) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb(base, 0.92 + hash2(x, y, seed) * 0.14);
    }
  }
  const frame = rgb([base[0] * 0.55, base[1] * 0.55, base[2] * 0.55]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
    if (i >= 1 && i <= 14) { setPx(px, 7, i, frame); setPx(px, 8, i, frame); }
  }
  fillRect(px, 2, 2, 6, 6, rgb(base, 0.85));
  fillRect(px, 9, 2, 13, 6, rgb(base, 0.85));
  fillRect(px, 2, 9, 6, 13, rgb(base, 0.85));
  fillRect(px, 9, 9, 13, 13, rgb(base, 0.85));
  if (rivets) {
    fillRect(px, 3, 3, 3, 3, rgb([230, 230, 234]));
    fillRect(px, 12, 12, 12, 12, rgb([230, 230, 234]));
  }
  return pixelSvg(px);
}

function trapdoorTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([162, 130, 78], 0.92 + hash2(x, y, seed) * 0.14);
    }
  }
  const frame = rgb([96, 72, 40]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
    setPx(px, i, 5, frame); setPx(px, i, 10, frame);
  }
  setPx(px, 5, 3, frame); setPx(px, 11, 8, frame); setPx(px, 6, 13, frame);
  return pixelSvg(px);
}

// 活塞：top 木板+铁框 / side 压板+槽 / bottom 石板
function pistonTopTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([152, 120, 72], 0.92 + hash2(x, y, seed) * 0.14);
    }
  }
  fillRect(px, 2, 2, 13, 13, rgb([108, 84, 48]));
  fillRect(px, 3, 3, 12, 12, rgb([150, 150, 150]));
  for (let i = 3; i <= 12; i++) {
    setPx(px, i, 3, rgb([172, 172, 172])); setPx(px, i, 12, rgb([126, 126, 126]));
    setPx(px, 3, i, rgb([172, 172, 172])); setPx(px, 12, i, rgb([126, 126, 126]));
  }
  return pixelSvg(px);
}

function stickyTopTex(seed) {
  const px = makeTex();
  const base = pixelPixels(pistonTopTex(seed));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px[y * 16 + x] = base[y * 16 + x];
  fillRect(px, 6, 6, 9, 9, rgb([140, 190, 110]));
  fillRect(px, 7, 7, 8, 8, rgb([170, 214, 140]));
  return pixelSvg(px);
}

// pixelSvg 的逆向辅助（把已生成 SVG 重新解析太绕，直接内部用像素数组版本）
function pixelPixels(svgText) {
  const out = new Array(256).fill(null);
  const re = /<rect x="(\d+)" y="(\d+)" width="1" height="1" fill="([^"]+)"\/>/g;
  let m;
  while ((m = re.exec(svgText)) !== null) {
    out[parseInt(m[2], 10) * 16 + parseInt(m[1], 10)] = m[3];
  }
  return out;
}

function pistonSideTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([140, 110, 66], 0.92 + hash2(x, y, seed) * 0.14);
    }
  }
  fillRect(px, 0, 0, 15, 2, rgb([176, 148, 96]));
  fillRect(px, 0, 3, 15, 5, rgb([96, 74, 42]));
  return pixelSvg(px);
}

function pistonBottomTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[y * 16 + x] = rgb([116, 116, 116], 0.9 + hash2(x, y, seed) * 0.2);
    }
  }
  const frame = rgb([86, 86, 86]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  return pixelSvg(px);
}

function pistonHeadTex(seed) {
  return mineralBlockTex([160, 160, 160], seed);
}

// ---------- 注册 ----------
const svgMap = {};

// 统一注册：textures 字段指定 SVG 文件名
const BlockCN = {
  air: '空气', stone: '石头', grass_block: '草方块', dirt: '泥土', coarse_dirt: '砂土',
  sand: '沙子', red_sand: '红沙', gravel: '沙砾', clay: '粘土块', bedrock: '基岩',
  water: '水', lava: '岩浆',
  ice: '冰', packed_ice: '浮冰', blue_ice: '蓝冰',
  snow_block: '雪块', snow_layer: '雪层', obsidian: '黑曜石',
  coal_ore: '煤矿石', iron_ore: '铁矿石', gold_ore: '金矿石', diamond_ore: '钻石矿石',
  emerald_ore: '绿宝石矿石', redstone_ore: '红石矿石', lapis_ore: '青金石矿石', copper_ore: '铜矿石',
  deepslate: '深板岩',
  deepslate_coal_ore: '深板岩煤矿石', deepslate_iron_ore: '深板岩铁矿石',
  deepslate_gold_ore: '深板岩金矿石', deepslate_diamond_ore: '深板岩钻石矿石',
  oak_log: '橡木原木', spruce_log: '云杉原木', birch_log: '白桦原木', dark_oak_log: '深色橡木原木', acacia_log: '金合欢原木',
  oak_planks: '橡木木板', spruce_planks: '云杉木板', birch_planks: '白桦木板', dark_oak_planks: '深色橡木木板', acacia_planks: '金合欢木板',
  oak_leaves: '橡树树叶', spruce_leaves: '云杉树叶', birch_leaves: '白桦树叶',
  cobblestone: '圆石', stone_bricks: '石砖', mossy_stone_bricks: '苔石砖', cracked_stone_bricks: '裂石砖',
  mossy_cobblestone: '苔石', brick_block: '红砖块', nether_bricks: '下界砖块',
  bookshelf: '书架', end_portal_frame: '末地传送门框架', end_portal_frame_eye: '末地传送门框架（已嵌眼）', end_portal: '末地传送门',
  nether_portal: '下界传送门', aether_portal: '天域传送门',
  sandstone: '砂岩', red_sandstone: '红砂岩', quartz_block: '石英块',
  crafting_table: '工作台', furnace: '熔炉', tnt: 'TNT',
  glass: '玻璃', glowstone: '荧石', sea_lantern: '海晶灯', torch: '火把',
  iron_block: '铁块', gold_block: '金块', diamond_block: '钻石块', emerald_block: '绿宝石块',
  lapis_block: '青金石块', redstone_block: '红石块', coal_block: '煤炭块',
  cactus: '仙人掌', pumpkin: '南瓜', melon: '西瓜', hay_block: '干草块',
  netherrack: '下界岩', end_stone: '末地石', soul_sand: '灵魂沙', magma_block: '岩浆块',
  redstone_lamp: '红石灯', redstone_torch: '红石火把',
  lever: '拉杆', stone_button: '石按钮', oak_button: '橡木按钮', redstone_wire: '红石粉',
  piston: '活塞', piston_head: '活塞头', sticky_piston: '粘性活塞',
  oak_door: '橡木门', iron_door: '铁门', oak_trapdoor: '橡木活板门', note_block: '音符盒',
  white_concrete: '白色混凝土', white_wool: '白色羊毛', white_terracotta: '白色陶瓦', white_bed: '白色床',
  chest: '箱子',
};

function reg(name, def, svgs) {
  BlockRegistry.register({ name, displayName: BlockCN[name] || def.displayName || name, ...def });
  if (svgs) {
    for (const [key, svg] of Object.entries(svgs)) {
      svgMap[key] = svg;
    }
  }
}

// --- 自然方块 ---
reg('air', { id: 0, displayName: '空气', solid: false, transparent: true, hardness: 0 });
reg('stone', { hardness: 1.5, tool: 'pickaxe' }, { stone: stoneTex(1) });
reg('grass_block', { textures: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, hardness: 0.6 },
  { grass_top: grassTopTex(7), grass_side: grassSideTex(8), dirt: noiseTex([134, 96, 67], 9) });
reg('dirt', { hardness: 0.5 }, { dirt: noiseTex([134, 96, 67], 9) });
reg('coarse_dirt', { hardness: 0.5 }, { coarse_dirt: noiseTex([122, 90, 60], 10, { dProb: 0.24 }) });
reg('sand', { hardness: 0.5 }, { sand: noiseTex([219, 207, 163], 11, { dark: 0.93, light: 1.06 }) });
reg('red_sand', { hardness: 0.5 }, { red_sand: noiseTex([190, 105, 60], 12, { dark: 0.93, light: 1.06 }) });
reg('gravel', { hardness: 0.6 }, { gravel: blotchTex([130, 124, 120], 13, { dark: 0.72, light: 1.2 }) });
reg('clay', { hardness: 0.6 }, { clay: noiseTex([163, 166, 179], 14, { dark: 0.94, light: 1.06 }) });
reg('bedrock', { hardness: -1 }, { bedrock: blotchTex([100, 100, 100], 15, { dark: 0.45, light: 1.35, dProb: 0.3, lProb: 0.25 }) });
reg('water', { solid: false, transparent: true, fluid: true, hardness: 100 }, { water: waterTex() });
reg('lava', { displayName: '岩浆', solid: false, transparent: true, fluid: true, light: 15, hardness: 100 }, { lava: lavaTex(17) });
reg('ice', { transparent: true, hardness: 0.5 }, { ice: iceTex(18) });
reg('packed_ice', { hardness: 0.5 }, { packed_ice: iceTex(19, [138, 172, 222]) });
reg('blue_ice', { hardness: 0.5 }, { blue_ice: iceTex(20, [110, 150, 222]) });
reg('snow_block', { hardness: 0.2 }, { snow_block: noiseTex([246, 250, 252], 21, { dark: 0.97, light: 1.03, dProb: 0.1, lProb: 0.1 }) });
reg('snow_layer', { transparent: true, hardness: 0.1 }, { snow_layer: noiseTex([246, 250, 252], 22, { dark: 0.97, light: 1.03, dProb: 0.1, lProb: 0.1 }) });
reg('obsidian', { hardness: 50, tool: 'pickaxe' }, { obsidian: obsidianTex(23) });

// --- 矿石 ---
reg('coal_ore', { hardness: 3, tool: 'pickaxe' }, { coal_ore: oreTex([125, 125, 125], [42, 42, 42], 31) });
reg('iron_ore', { hardness: 3, tool: 'pickaxe' }, { iron_ore: oreTex([125, 125, 125], [216, 175, 147], 32) });
reg('gold_ore', { hardness: 3, tool: 'pickaxe' }, { gold_ore: oreTex([125, 125, 125], [250, 224, 92], 33) });
reg('diamond_ore', { hardness: 3, tool: 'pickaxe' }, { diamond_ore: oreTex([125, 125, 125], [104, 232, 222], 34) });
reg('emerald_ore', { hardness: 3, tool: 'pickaxe' }, { emerald_ore: oreTex([125, 125, 125], [62, 216, 92], 35) });
reg('redstone_ore', { hardness: 3, tool: 'pickaxe', light: 9 }, { redstone_ore: oreTex([125, 125, 125], [226, 48, 42], 36) });
reg('lapis_ore', { hardness: 3, tool: 'pickaxe' }, { lapis_ore: oreTex([125, 125, 125], [38, 70, 200], 37) });
reg('copper_ore', { hardness: 3, tool: 'pickaxe' }, { copper_ore: oreTex([125, 125, 125], [200, 124, 84], 38) });

// 深板岩变种
reg('deepslate', { hardness: 3, tool: 'pickaxe' }, { deepslate: deepslateTex(41) });
reg('deepslate_coal_ore', { hardness: 4.5, tool: 'pickaxe' }, { deepslate_coal_ore: oreTex([74, 74, 82], [42, 42, 42], 42) });
reg('deepslate_iron_ore', { hardness: 4.5, tool: 'pickaxe' }, { deepslate_iron_ore: oreTex([74, 74, 82], [216, 175, 147], 43) });
reg('deepslate_gold_ore', { hardness: 4.5, tool: 'pickaxe' }, { deepslate_gold_ore: oreTex([74, 74, 82], [250, 224, 92], 44) });
reg('deepslate_diamond_ore', { hardness: 4.5, tool: 'pickaxe' }, { deepslate_diamond_ore: oreTex([74, 74, 82], [104, 232, 222], 45) });

// --- 原木 ---
reg('oak_log', { textures: { top: 'oak_log_top', side: 'oak_log_side', bottom: 'oak_log_top' }, hardness: 2 },
  { oak_log_top: logTopTex([109, 84, 50], [172, 138, 90], 46), oak_log_side: logSideTex([109, 84, 50], 47) });
reg('spruce_log', { textures: { top: 'spruce_log_top', side: 'spruce_log_side', bottom: 'spruce_log_top' }, hardness: 2 },
  { spruce_log_top: logTopTex([70, 45, 20], [120, 80, 40], 48), spruce_log_side: logSideTex([70, 45, 20], 49) });
reg('birch_log', { textures: { top: 'birch_log_top', side: 'birch_log_side', bottom: 'birch_log_top' }, hardness: 2 },
  { birch_log_top: logTopTex([206, 199, 182], [226, 220, 206], 50), birch_log_side: logSideTex([214, 208, 194], 51) });
reg('dark_oak_log', { textures: { top: 'dark_oak_log_top', side: 'dark_oak_log_side', bottom: 'dark_oak_log_top' }, hardness: 2 },
  { dark_oak_log_top: logTopTex([46, 32, 18], [76, 52, 28], 52), dark_oak_log_side: logSideTex([56, 40, 22], 53) });
reg('acacia_log', { textures: { top: 'acacia_log_top', side: 'acacia_log_side', bottom: 'acacia_log_top' }, hardness: 2 },
  { acacia_log_top: logTopTex([110, 62, 24], [172, 100, 44], 54), acacia_log_side: logSideTex([128, 74, 30], 55) });

// --- 木板 ---
reg('oak_planks', { hardness: 2 }, { oak_planks: planksTex([162, 130, 78], 61) });
reg('spruce_planks', { hardness: 2 }, { spruce_planks: planksTex([114, 84, 50], 62) });
reg('birch_planks', { hardness: 2 }, { birch_planks: planksTex([212, 200, 176], 63) });
reg('dark_oak_planks', { hardness: 2 }, { dark_oak_planks: planksTex([68, 50, 30], 64) });
reg('acacia_planks', { hardness: 2 }, { acacia_planks: planksTex([168, 88, 44], 65) });

// --- 树叶 ---
reg('oak_leaves', { transparent: true, solid: true, hardness: 0.2 }, { oak_leaves: leavesTex(71, [64, 118, 38]) });
reg('spruce_leaves', { transparent: true, solid: true, hardness: 0.2 }, { spruce_leaves: leavesTex(72, [46, 86, 50]) });
reg('birch_leaves', { transparent: true, solid: true, hardness: 0.2 }, { birch_leaves: leavesTex(73, [98, 140, 58]) });

// --- 砖/石砖 ---
reg('cobblestone', { hardness: 2, tool: 'pickaxe' }, { cobblestone: cobbleTex(81) });
reg('stone_bricks', { hardness: 1.5, tool: 'pickaxe' }, { stone_bricks: stoneBricksTex(82) });
reg('mossy_stone_bricks', { hardness: 1.5, tool: 'pickaxe' }, { mossy_stone_bricks: stoneBricksMossyTex(89) });
reg('cracked_stone_bricks', { hardness: 1.5, tool: 'pickaxe' }, { cracked_stone_bricks: stoneBricksCrackedTex(90) });
reg('mossy_cobblestone', { hardness: 2, tool: 'pickaxe' }, { mossy_cobblestone: blotchTex([100, 118, 82], 83, { dark: 0.7, light: 1.2 }) });
reg('brick_block', { hardness: 2, tool: 'pickaxe' }, { brick_block: brickTex(84) });
reg('nether_bricks', { hardness: 2, tool: 'pickaxe' }, { nether_bricks: brickTexMagenta(85) });
reg('bookshelf', { hardness: 1.5, tool: 'axe', textures: { top: 'oak_planks', side: 'bookshelf_side', bottom: 'oak_planks' } }, { bookshelf_side: bookshelfSideTex(91) });
reg('end_portal_frame', { hardness: -1, textures: { top: 'end_portal_frame_top', side: 'end_portal_frame_side', bottom: 'stone_bricks' } }, { end_portal_frame_top: endPortalFrameTopTex(92), end_portal_frame_side: endPortalFrameSideTex(93) });

// 末地传送门框架（已嵌末影之眼）：同框架 + 顶面中央眼球（迭代 M3 逐框激活）
function endPortalFrameEyeTopTex(seed) {
  const px = makeTex();
  const stone = [136, 136, 136], green = [86, 178, 132], greenD = [52, 116, 88];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = stone, f = 0.9 + hash2(x, y, seed) * 0.2;
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d <= 4) c = green;
      if (d > 3 && d <= 4) c = greenD;
      if (d > 1.5 && d <= 2) f *= 0.6;
      // 中央眼球：黑绿瞳仁 + 高光（覆盖中心 5×5）
      const e = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (e <= 2) c = [10, 40, 30];
      if (e <= 1) c = [6, 24, 18];
      if ((x === 6 && y === 6) || (x === 5 && y === 7)) c = [160, 240, 200];
      px[y * 16 + x] = rgb(c, f);
    }
  }
  return pixelSvg(px);
}
reg('end_portal_frame_eye', { hardness: -1, textures: { top: 'end_portal_frame_eye_top', side: 'end_portal_frame_side', bottom: 'stone_bricks' } }, { end_portal_frame_eye_top: endPortalFrameEyeTopTex(99) });

// 末地传送门（激活门体）：星空黑面，solid:false 可陷入触发，light:15 自发光
function endPortalTex(seed) {
  const px = makeTex();
  fillRect(px, 0, 0, 15, 15, rgb([4, 4, 12]));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = hash2(x, y, seed);
      if (t > 0.90) px[y * 16 + x] = rgb([190, 210, 255], 0.7 + t * 0.4);
      else if (t > 0.80) px[y * 16 + x] = rgb([110, 130, 210], 0.8 + t * 0.3);
      else if (t > 0.75) px[y * 16 + x] = rgb([40, 60, 120]);
    }
  }
  return pixelSvg(px);
}
reg('end_portal', { displayName: '末地传送门', solid: false, transparent: true, light: 15, hardness: -1 }, { end_portal: endPortalTex(100) });

// 苔石砖：石砖基底 + 苔斑侵蚀（要塞材质）
function stoneBricksMossyTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.95 + hash2(x, y, seed) * 0.1;
      if ((x & 7) === 0 || (y & 7) === 0) f *= 1.08;
      if ((x & 7) === 7 || (y & 7) === 7) f = 0.55;
      const r = hash2(x + 31, y + 17, seed + 5);
      if (r < 0.3) px[y * 16 + x] = rgb([96, 122, 70], 0.85 + r);
      else px[y * 16 + x] = rgb([122, 122, 122], f);
    }
  }
  return pixelSvg(px);
}

// 裂石砖：石砖基底 + 两条贯穿裂纹
function stoneBricksCrackedTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.95 + hash2(x, y, seed) * 0.1;
      if ((x & 7) === 0 || (y & 7) === 0) f *= 1.08;
      if ((x & 7) === 7 || (y & 7) === 7) f = 0.55;
      if (x === ((y * 3 + 4) & 15) || x === ((y * 5 + 11) & 15)) f *= 0.55;
      px[y * 16 + x] = rgb([122, 122, 122], f);
    }
  }
  return pixelSvg(px);
}

// 书架侧面：木框 + 两排彩色书脊
function bookshelfSideTex(seed) {
  const px = makeTex();
  const plank = [162, 130, 78];
  const spines = [[178, 60, 48], [62, 98, 158], [92, 132, 60], [168, 140, 58], [120, 70, 140]];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = plank, f = 0.9 + hash2(x, y, seed) * 0.2;
      const inShelf = (y >= 2 && y <= 6) || (y >= 9 && y <= 13);
      if (inShelf) {
        const shelf = y <= 6 ? 0 : 1;
        if (x === 0 || x === 15 || hash2(x, y + 40, seed + 3) < 0.15) c = [88, 66, 44];
        else c = spines[Math.floor(hash2(x, shelf, seed + 9) * 5) % 5];
        f = 0.85 + hash2(x, y, seed + 5) * 0.3;
      }
      px[y * 16 + x] = rgb(c, f);
    }
  }
  return pixelSvg(px);
}

// 末地传送门框架：顶面绿心石框 / 侧面石身绿带
function endPortalFrameTopTex(seed) {
  const px = makeTex();
  const stone = [136, 136, 136], green = [86, 178, 132], greenD = [52, 116, 88];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = stone, f = 0.9 + hash2(x, y, seed) * 0.2;
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d <= 4) c = green;
      if (d > 3 && d <= 4) c = greenD;
      if (d > 1.5 && d <= 2) f *= 0.6;
      px[y * 16 + x] = rgb(c, f);
    }
  }
  return pixelSvg(px);
}

function endPortalFrameSideTex(seed) {
  const px = makeTex();
  const stone = [136, 136, 136], green = [86, 178, 132], greenD = [52, 116, 88];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = stone, f = 0.9 + hash2(x, y, seed) * 0.2;
      if (y <= 2) { c = green; if (y === 2) c = greenD; }
      if (y === 11) f *= 0.6;
      px[y * 16 + x] = rgb(c, f);
    }
  }
  return pixelSvg(px);
}

reg('sandstone', { hardness: 0.8, tool: 'pickaxe' }, { sandstone: sandstoneTex(86) });
reg('red_sandstone', { hardness: 0.8, tool: 'pickaxe' }, { red_sandstone: sandstoneTexR(87) });
reg('quartz_block', { hardness: 0.8, tool: 'pickaxe' }, { quartz_block: noiseTex([236, 233, 226], 88, { dark: 0.97, light: 1.03, dProb: 0.12, lProb: 0.1 }) });

// 下界砖：深紫红砖 + 深缝（brickTex 的调色变体）
function brickTexMagenta(seed) {
  const px = makeTex();
  const brick = [86, 34, 40], mortar = [52, 20, 26];
  for (let y = 0; y < 16; y++) {
    const row = y >> 2;
    for (let x = 0; x < 16; x++) {
      const xx = (x + (row % 2) * 4) & 15;
      if ((y & 3) === 3 || (xx & 7) === 7) px[y * 16 + x] = rgb(mortar);
      else px[y * 16 + x] = rgb(brick, 0.9 + hash2(xx, y, seed) * 0.2);
    }
  }
  return pixelSvg(px);
}

function sandstoneTexR(seed) {
  const px = makeTex();
  const base = [206, 118, 62];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let f = 0.94 + hash2(x, y, seed) * 0.1;
      if (y <= 1) f *= 1.08;
      else if (y >= 14) f *= 0.82;
      else if (hash2(0, y >> 1, seed + 2) < 0.3) f *= 0.92;
      px[y * 16 + x] = rgb(base, f);
    }
  }
  return pixelSvg(px);
}

// --- 功能方块 ---
reg('crafting_table', { textures: { top: 'crafting_table_top', side: 'crafting_table_side', bottom: 'oak_planks' }, hardness: 2.5 },
  {
    crafting_table_top: craftingTopTex(91),
    crafting_table_side: craftingSideTex(92)
  });
reg('furnace', { textures: { top: 'stone', side: 'furnace_side', bottom: 'stone' }, hardness: 3.5, tool: 'pickaxe' },
  { furnace_side: furnaceTex(93) });
reg('glass', { transparent: true, hardness: 0.3 }, { glass: glassTex() });
reg('glowstone', { displayName: '荧石', light: 15, hardness: 0.3 }, { glowstone: glowstoneTex(95) });
reg('sea_lantern', { displayName: '海晶灯', light: 15, hardness: 0.3 }, { sea_lantern: seaLanternTex(96) });

// --- 传送门（迭代：原版式维度传送门）---
// cross 渲染双面薄片 + 自发光（light:13 走光源 LUT/亮块重绘管线）；solid:false 可穿行。
// 框校验/点火/穿越逻辑在 src/core/Portals.js + Game.js。

// 下界传送门：紫色涡流能量幕
function netherPortalTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // 涡流：绕中心的极角域正弦 + 距离衰减（确定性 hash 抖动）
      const dx = x - 7.5, dy = y - 7.5;
      const ang = Math.atan2(dy, dx), r = Math.hypot(dx, dy);
      const swirl = Math.sin(ang * 3 + r * 1.5 + seed * 0.13) * 0.5 + 0.5;
      const t = hash2(x, y, seed);
      const base = swirl > 0.62 ? [186, 92, 224] : swirl > 0.32 ? [124, 44, 178] : [74, 18, 118];
      px[y * 16 + x] = rgb(base, 0.88 + t * 0.28);
    }
  }
  return pixelSvg(px);
}

// 天域传送门：淡金/天白气流幕（萤石框配色呼应）
function aetherPortalTex(seed) {
  const px = makeTex();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const ang = Math.atan2(dy, dx), r = Math.hypot(dx, dy);
      const swirl = Math.sin(ang * 2.4 - r * 1.1 + seed * 0.17) * 0.5 + 0.5;
      const t = hash2(x, y, seed);
      const base = swirl > 0.6 ? [252, 246, 208] : swirl > 0.3 ? [216, 232, 250] : [150, 190, 236];
      px[y * 16 + x] = rgb(base, 0.9 + t * 0.22);
    }
  }
  return pixelSvg(px);
}

reg('nether_portal', { displayName: '下界传送门', solid: false, transparent: true, renderType: 'cross', light: 13, hardness: 0.1 }, { nether_portal: netherPortalTex(97) });
reg('aether_portal', { displayName: '天域传送门', solid: false, transparent: true, renderType: 'cross', light: 13, hardness: 0.1 }, { aether_portal: aetherPortalTex(98) });
reg('torch', { displayName: '火把', transparent: true, light: 14, hardness: 0, renderType: 'cross', solid: false },
  { torch: (function () { const px = makeTex();
    // 火把：上半黄色火，下半棕色棍
    for (let y = 2; y < 6; y++) for (let x = 7; x < 10; x++) px[y * 16 + x] = 'rgb(255,200,50)';
    for (let y = 6; y < 14; y++) for (let x = 7; x < 10; x++) px[y * 16 + x] = 'rgb(120,80,40)';
    px[1 * 16 + 8] = 'rgb(255,230,100)';
    return pixelSvg(px); })()
  });

// --- 金面方块 ---
reg('iron_block', { hardness: 5, tool: 'pickaxe' }, { iron_block: mineralBlockTex([219, 219, 219], 101) });
reg('gold_block', { hardness: 5, tool: 'pickaxe' }, { gold_block: mineralBlockTex([250, 222, 90], 102) });
reg('diamond_block', { hardness: 5, tool: 'pickaxe' }, { diamond_block: mineralBlockTex([98, 229, 226], 103) });
reg('emerald_block', { hardness: 5, tool: 'pickaxe' }, { emerald_block: mineralBlockTex([62, 216, 92], 104) });
reg('lapis_block', { hardness: 3, tool: 'pickaxe' }, { lapis_block: mineralBlockTex([40, 72, 204], 105) });
reg('coal_block', { hardness: 5, tool: 'pickaxe' }, { coal_block: noiseTex([28, 28, 28], 107, { dark: 0.8, light: 1.35, dProb: 0.3, lProb: 0.12 }) });

// --- 植物 ---
reg('cactus', { transparent: true, solid: true, hardness: 0.4 }, { cactus: cactusTex(111) });
reg('pumpkin', { textures: { top: 'pumpkin_top', side: 'pumpkin_side', bottom: 'pumpkin_top' }, hardness: 1 },
  { pumpkin_top: pumpkinTopTex(112), pumpkin_side: pumpkinSideTex(113) });
reg('melon', { hardness: 1 }, { melon: melonTex(114) });
reg('hay_block', { textures: { top: 'hay_top', side: 'hay_side', bottom: 'hay_top' }, hardness: 0.5 },
  { hay_top: hayTopTex(116), hay_side: haySideTex(117) });

// --- 下界/末地 ---
reg('netherrack', { hardness: 0.4, tool: 'pickaxe' }, { netherrack: blotchTex([102, 38, 38], 121, { dark: 0.65, light: 1.3, dProb: 0.28, lProb: 0.18 }) });
reg('end_stone', { hardness: 3, tool: 'pickaxe' }, { end_stone: blotchTex([219, 222, 167], 122, { dark: 0.86, light: 1.05, dProb: 0.3, lProb: 0.15 }) });
reg('soul_sand', { hardness: 0.5, tool: 'shovel' }, { soul_sand: soulTex(123) });
reg('magma_block', { displayName: '岩浆块', light: 6, hardness: 0.5, tool: 'pickaxe' }, { magma_block: magmaTex(124) });
// 末影水晶：柱顶发光晶体（为龙回血；被击碎时爆炸，Game._breakCrystal 处理）
reg('end_crystal', { displayName: '末影水晶', light: 15, hardness: 0.5 }, { end_crystal: (function () {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const diag = (x + y) % 7;
    let c = 'rgb(96,44,146)';                                   // 深紫底
    if (diag === 0 || diag === 1) c = 'rgb(176,116,236)';       // 晶面斜纹
    if (hash2(x, y, 203) < 0.08) c = 'rgb(236,210,255)';        // 白高光
    if (x === 0 || x === 15 || y === 0 || y === 15) c = 'rgb(62,26,98)'; // 晶棱
    px[y * 16 + x] = c;
  }
  return pixelSvg(px); })()
});
// 龙蛋：末影龙击败掉落（装饰收藏方块）
reg('dragon_egg', { displayName: '龙蛋', hardness: 3, tool: 'pickaxe' }, { dragon_egg: (function () {
  const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const wave = Math.sin((x + y * 0.6) * 0.9) * 0.5 + 0.5;
    let c = wave > 0.72 ? 'rgb(58,36,84)' : 'rgb(26,18,36)';    // 紫波纹鳞面
    if (hash2(x, y, 207) < 0.06) c = 'rgb(140,96,196)';         // 亮斑
    px[y * 16 + x] = c;
  }
  return pixelSvg(px); })()
});
// 末地折跃门：龙败后在主岛缘/外岛缘生成（基岩框内嵌光束；踩入触发同维传送）
reg('end_gateway', { displayName: '末地折跃门', transparent: true, solid: false, light: 15, hardness: -1, renderType: 'cross' },
  { end_gateway: (function () { const px = makeTex();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const beam = Math.abs(x - 8) < 2 + (y % 3);
      let c = beam ? 'rgb(196,140,255)' : 'rgb(120,70,190)';    // 紫白光束
      if (hash2(x, y, 211) < 0.1) c = 'rgb(240,220,255)';       // 星点
      if (!beam && hash2(x, y, 212) < 0.5) c = 'rgb(90,50,150)';
      px[y * 16 + x] = c;
    }
    return pixelSvg(px); })()
  });

// --- 红石相关 ---
reg('redstone_lamp', { displayName: '红石灯', light: 15, hardness: 0.3 }, { redstone_lamp: redstoneLampTex(131) });
reg('redstone_torch', { displayName: '红石火把', transparent: true, light: 14, hardness: 0, renderType: 'cross', solid: false },
  { redstone_torch: (function () { const px = makeTex();
    for (let y = 2; y < 6; y++) for (let x = 7; x < 10; x++) px[y * 16 + x] = 'rgb(220,40,40)';
    for (let y = 6; y < 14; y++) for (let x = 7; x < 10; x++) px[y * 16 + x] = 'rgb(120,80,40)';
    px[1 * 16 + 8] = 'rgb(255,120,100)';
    return pixelSvg(px); })()
  });
reg('lever', { transparent: true, hardness: 0, solid: false, renderType: 'cross' },
  { lever: (function () { const px = makeTex();
    for (let y = 6; y < 14; y++) for (let x = 7; x < 10; x++) px[y * 16 + x] = 'rgb(100,70,40)';
    for (let y = 4; y < 7; y++) for (let x = 7; x < 10; x++) px[y * 16 + x] = 'rgb(160,160,160)';
    return pixelSvg(px); })()
  });
reg('stone_button', { transparent: true, hardness: 0, solid: false, renderType: 'cross' },
  { stone_button: (function () { const px = makeTex();
    for (let y = 7; y < 9; y++) for (let x = 6; x < 10; x++) px[y * 16 + x] = 'rgb(140,140,140)';
    return pixelSvg(px); })()
  });
reg('oak_button', { transparent: true, hardness: 0, solid: false, renderType: 'cross' },
  { oak_button: (function () { const px = makeTex();
    for (let y = 7; y < 9; y++) for (let x = 6; x < 10; x++) px[y * 16 + x] = 'rgb(160,130,70)';
    return pixelSvg(px); })()
  });
reg('redstone_wire', { transparent: true, hardness: 0, solid: false, renderType: 'cross' },
  { redstone_wire: (function () { const px = makeTex();
    for (let y = 7; y < 9; y++) for (let x = 4; x < 12; x++) px[y * 16 + x] = 'rgb(200,20,20)';
    return pixelSvg(px); })()
  });
// 红石块（仅注册一次；曾双注册被覆盖，light 保持 0 = 不发光）
reg('redstone_block', { light: 0, hardness: 5, tool: 'pickaxe' }, { redstone_block: noiseTex([188, 32, 32], 132, { dark: 0.85, light: 1.15, dProb: 0.3, lProb: 0.2 }) });
reg('piston', { textures: { top: 'piston_top', side: 'piston_side', bottom: 'piston_bottom' }, hardness: 1.5 }, {
  piston_top: pistonTopTex(133),
  piston_side: pistonSideTex(134),
  piston_bottom: pistonBottomTex(135)
});
reg('piston_head', { transparent: true, hardness: 0.5, solid: false }, { piston_head: pistonHeadTex(136) });
reg('sticky_piston', { textures: { top: 'sticky_piston_top', side: 'piston_side', bottom: 'piston_bottom' }, hardness: 1.5 }, {
  sticky_piston_top: stickyTopTex(137),
  piston_side: pistonSideTex(134),
  piston_bottom: pistonBottomTex(135)
});
reg('tnt', { textures: { top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_bottom' }, hardness: 0, transparent: false }, {
  tnt_top: tntTopTex(141),
  tnt_side: tntSideTex(142),
  tnt_bottom: noiseTex([124, 40, 32], 143, { dark: 0.9, light: 1.1 })
});
reg('oak_door', { transparent: true, hardness: 1, solid: false }, { oak_door: doorTex([162, 130, 78], 144) });
reg('iron_door', { transparent: true, hardness: 5, solid: false, tool: 'pickaxe' }, { iron_door: doorTex([198, 198, 202], 145, true) });
reg('oak_trapdoor', { transparent: true, hardness: 1, solid: false }, { oak_trapdoor: trapdoorTex(146) });
reg('note_block', { hardness: 1 }, { note_block: (function () { const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([120, 92, 56], 0.92 + hash2(x, y, 147) * 0.14);
  }
  const frame = rgb([70, 52, 32]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  fillRect(px, 5, 5, 10, 10, rgb([90, 68, 42]));
  fillRect(px, 7, 7, 8, 8, rgb([220, 214, 200]));
  return pixelSvg(px); })()
});

// --- 混凝土（染色算 1 种，以白色代表）---
reg('white_concrete', { hardness: 1.8, tool: 'pickaxe' }, { white_concrete: noiseTex([228, 228, 228], 151, { dark: 0.98, light: 1.02, dProb: 0.1, lProb: 0.1 }) });
reg('white_wool', { hardness: 0.8 }, { white_wool: (function () { const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let f = 0.95 + hash2(x, y, 152) * 0.08;
    if ((x * 3 + y * 7) % 13 === 0) f *= 0.94;
    px[y * 16 + x] = rgb([236, 236, 236], f);
  }
  return pixelSvg(px); })()
});
reg('white_terracotta', { hardness: 1.25, tool: 'pickaxe' }, { white_terracotta: noiseTex([180, 156, 138], 153, { dark: 0.93, light: 1.06 }) });
reg('white_bed', { transparent: true, hardness: 0.2 }, { white_bed: (function () { const px = makeTex();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb([238, 238, 240], 0.95 + hash2(x, y, 154) * 0.08);
  }
  const frame = rgb([200, 200, 206]);
  for (let i = 0; i < 16; i++) {
    setPx(px, i, 0, frame); setPx(px, i, 15, frame);
    setPx(px, 0, i, frame); setPx(px, 15, i, frame);
  }
  fillRect(px, 0, 11, 15, 12, rgb([226, 226, 230]));
  return pixelSvg(px); })()
});

// --- 容器方块（T5：箱子，内容经 loot.js 惰性生成） ---
function chestTex(seed, latch) {
  const px = makeTex();
  const base = [168, 128, 74];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    px[y * 16 + x] = rgb(base, 0.92 + hash2(x, y, seed) * 0.16);
  }
  // 外框与盖缝
  fillRect(px, 0, 0, 15, 0, rgb([94, 62, 32]));
  fillRect(px, 0, 15, 15, 15, rgb([82, 52, 24]));
  fillRect(px, 0, 0, 0, 15, rgb([94, 62, 32]));
  fillRect(px, 15, 0, 15, 15, rgb([82, 52, 24]));
  fillRect(px, 1, 5, 14, 5, rgb([94, 62, 32]));
  // 盖板/底板受光线
  fillRect(px, 1, 1, 14, 1, rgb(base, 1.14));
  fillRect(px, 1, 6, 14, 6, rgb(base, 1.1));
  if (latch) {
    fillRect(px, 7, 4, 8, 7, 'rgb(158,158,158)');
    fillRect(px, 7, 7, 8, 7, 'rgb(96,96,96)');
  }
  return pixelSvg(px);
}
reg('chest', { textures: { top: 'chest_top', side: 'chest_side', bottom: 'chest_bottom' }, hardness: 2.5 },
  {
    chest_top: chestTex(961, false),
    chest_side: chestTex(962, true),
    chest_bottom: chestTex(963, false),
  });

export const BlockSVGDefinitions = svgMap;

export function getBlockCount() {
  return BlockRegistry.all().length;
}
