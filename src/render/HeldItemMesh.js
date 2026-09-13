// HeldItemMesh.js -- 手持物品 3D 模型构建器（阶段10 / Build 7 像素挤出）
// 方块 = 六面贴图小立方体（top/side/bottom SVG 贴图）；
// 物品与 cross 方块 = MC 风格像素挤出（每个不透明像素一个带厚度小立方，只生成暴露面，有真实厚度）；
// portal 类保持双面薄片（半透明动画不适用挤出）。
// 模板按物品名缓存（进程级，几何/材质共享，clone 使用；总上限 = 注册的方块/物品数，无需主动释放）。
import * as THREE from 'three';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { SVGTextures } from './SVGTextures.js';
import { BlockSVGDefinitions } from '../blocks/BlockDefs.js';
import { ItemSVGDefinitions } from '../items/ItemDefs.js';

const cache = new Map(); // name -> Promise<THREE.Group|null> 模板（内部 mesh 尺寸归一为 1，挂载方自行缩放）

// SVG 全缺失时的兜底贴图（中性灰），保证多贴图方块在图集查不到时也不会"隐形"
let fallbackTex = null;
function getFallbackTexture() {
  if (!fallbackTex) {
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 8;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#8a8a8a';
    ctx.fillRect(0, 0, 8, 8);
    ctx.fillStyle = '#777';
    ctx.fillRect(0, 0, 4, 4);
    ctx.fillRect(4, 4, 4, 4);
    fallbackTex = new THREE.CanvasTexture(cv);
    fallbackTex.magFilter = THREE.NearestFilter;
    fallbackTex.minFilter = THREE.NearestFilter;
    fallbackTex.colorSpace = THREE.SRGBColorSpace;
  }
  return fallbackTex;
}

// SVG -> 32×32 canvas（像素风最近邻采样），返回纹理与像素数据（挤出几何用）
async function svgCanvas(svg) {
  if (!svg) return null;
  const img = await SVGTextures.svgToImage(svg);
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 32;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, data: ctx.getImageData(0, 0, 32, 32).data };
}

async function svgTexture(svg) {
  const r = await svgCanvas(svg);
  return r && r.tex;
}

// 手持物材质：白天吃场景光照保留立体感，夜晚用低强度自发光保证可见（MC 手持物同样不会全黑）
// alphaTest：透明像素不渲染（挤出几何对透明像素本就不生成面，双保险）；DoubleSide 兜底绕向误差
function heldMaterial(tex) {
  return new THREE.MeshLambertMaterial({
    map: tex, side: THREE.DoubleSide,
    emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35,
    alphaTest: 0.5,
  });
}

// 像素挤出几何（Build 7）：把 w×h 贴图的不透明像素生成为带厚度的立方面片，尺寸归一 [-0.5,0.5]²。
// 只输出暴露面：前后总暴露；±x/±y 仅当相邻像素透明时生成。侧面 UV 取该像素窄条（边缘色延伸）。
// depth 为厚度（同归一单位，0.125 ≈ MC 物品挤出观感）。
function extrudeSpriteGeometry(data, w, h, depth = 0.125) {
  const solid = new Uint8Array(w * h);
  let any = 0;
  for (let i = 0; i < w * h; i++) { const s = data[i * 4 + 3] >= 128 ? 1 : 0; solid[i] = s; any |= s; }
  if (!any) return null; // 全透明（异常贴图）→ 交给调用方兜底
  const at = (x, y) => (x < 0 || x >= w || y < 0 || y >= h) ? 0 : solid[y * w + x];
  const pos = [], nor = [], uvs = [], idx = [];
  const U = (x) => x / w, V = (y) => 1 - y / h;        // canvas 行号 → UV（原点左下）
  const X = (x) => x / w - 0.5, Y = (y) => 0.5 - y / h; // canvas 行号 → 世界坐标（Y 上为正）
  function quad(a, b, c, d, u0, v0, u1, v1, nx, ny, nz) {
    // a=左下 b=右下 c=右上 d=左上（从面外侧看）；UV 依次 (u0,v0)(u1,v0)(u1,v1)(u0,v1)
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) nor.push(nx, ny, nz);
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const z0 = -depth / 2, z1 = depth / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      const xa = X(x), xb = X(x + 1), ya = Y(y + 1), yb = Y(y); // ya=像素上边 yb=下边
      const u0 = U(x), u1 = U(x + 1), v0 = V(y + 1), v1 = V(y);
      // 前后（厚度方向两侧总暴露）
      quad([xa, yb, z1], [xb, yb, z1], [xb, ya, z1], [xa, ya, z1], u0, v0, u1, v1, 0, 0, 1);
      quad([xb, yb, z0], [xa, yb, z0], [xa, ya, z0], [xb, ya, z0], u0, v0, u1, v1, 0, 0, -1);
      if (!at(x + 1, y)) quad([xb, yb, z1], [xb, yb, z0], [xb, ya, z0], [xb, ya, z1], u0, v0, u1, v1, 1, 0, 0);
      if (!at(x - 1, y)) quad([xa, yb, z0], [xa, yb, z1], [xa, ya, z1], [xa, ya, z0], u0, v0, u1, v1, -1, 0, 0);
      if (!at(x, y - 1)) quad([xa, ya, z1], [xb, ya, z1], [xb, ya, z0], [xa, ya, z0], u0, v0, u1, v1, 0, 1, 0);
      if (!at(x, y + 1)) quad([xa, yb, z0], [xb, yb, z0], [xb, yb, z1], [xa, yb, z1], u0, v0, u1, v1, 0, -1, 0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  return geo;
}

// 方块类：普通方块 = 1×1×1 立方体，六面材质 [+x, -x, +y(top), -y(bottom), +z, -z]；
// cross 方块（火把/拉杆/按钮/线）= 像素挤出（Build 7，与世界内薄片同贴图、手持更立体）；
// portal 类保持双面薄片（半透明动画面）。
// 注意：BlockRegistry.register 会把 def.textures 规范化成平铺的 top/side/bottom 字段
//（原 textures 对象不保留），所以这里必须读 def.top/def.side/def.bottom。
async function buildBlockTemplate(name, def) {
  const t = { top: def.top || name, side: def.side || name, bottom: def.bottom || name };
  const pick = (key) => BlockSVGDefinitions[key] || '';
  const [sideCanvas, topTex, botTex] = await Promise.all([
    svgCanvas(pick(t.side)), svgTexture(pick(t.top)), svgTexture(pick(t.bottom)),
  ]);
  if (!sideCanvas) {
    console.warn(`[HeldItemMesh] 方块 ${name} 找不到贴图 SVG(${t.side})，使用兜底纯色`);
    const fb = getFallbackTexture();
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ map: fb, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
    return group;
  }
  const group = new THREE.Group();
  if (def.renderType === 'cross') {
    const geo = extrudeSpriteGeometry(sideCanvas.data, 32, 32, 0.125);
    if (geo) {
      group.add(new THREE.Mesh(geo, heldMaterial(sideCanvas.tex)));
      return group;
    }
    // 全透明异常 → 回退交叉薄片
  }
  if (def.renderType === 'cross' || def.renderType === 'portal') {
    const mat = heldMaterial(sideCanvas.tex);
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    p2.rotation.y = Math.PI / 2;
    group.add(p1, p2);
    return group;
  }
  const mat = (tex) => heldMaterial(tex || sideCanvas.tex);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [mat(sideCanvas.tex), mat(sideCanvas.tex), mat(topTex), mat(botTex), mat(sideCanvas.tex), mat(sideCanvas.tex)]);
  group.add(mesh);
  return group;
}

// 物品类（工具/食物等）：MC 风格像素挤出——每个不透明像素一个带厚度小立方，真实 3D 观感
async function buildItemTemplate(name) {
  const r = await svgCanvas(ItemSVGDefinitions[name] || '');
  if (!r) return null;
  const geo = extrudeSpriteGeometry(r.data, 32, 32, 0.125);
  if (!geo) return null;
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, heldMaterial(r.tex)));
  return group;
}

// 构建手持物模板（缓存命中直接返回）；未知物品返回 null（调用方回退空手/隐藏）
export async function buildHeldItemTemplate(name) {
  if (!name) return null;
  if (!cache.has(name)) {
    const p = (async () => {
      try {
        const block = BlockRegistry.getByName(name);
        if (block) return await buildBlockTemplate(name, block);
        if (ItemRegistry.getByName(name)) return await buildItemTemplate(name);
      } catch { return null; }
      return null;
    })();
    cache.set(name, p);
  }
  return cache.get(name);
}

// 供测试/重置使用（正常不调用：缓存总量受注册数约束）
export function clearHeldItemCache() {
  cache.clear();
}
