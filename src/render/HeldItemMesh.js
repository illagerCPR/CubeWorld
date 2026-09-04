// HeldItemMesh.js -- 手持物品 3D 模型构建器（阶段10）
// 方块 = 六面贴图小立方体（top/side/bottom SVG 贴图）；物品 = 双面贴图薄片。
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

// SVG -> 32×32 CanvasTexture（像素风最近邻采样）
async function svgTexture(svg) {
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
  return tex;
}

// 手持物材质：白天吃场景光照保留立体感，夜晚用低强度自发光保证可见（MC 手持物同样不会全黑）
// alphaTest：物品/十字方块的 SVG 贴图背景透明——不开 alphaTest 时透明像素按 RGB(0,0,0) 渲染成黑底；
// 用 alphaTest（而非 transparent）保持深度写入正确，双面薄片无排序伪影
function heldMaterial(tex) {
  return new THREE.MeshLambertMaterial({
    map: tex, side: THREE.DoubleSide,
    emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35,
    alphaTest: 0.5,
  });
}

// 方块类：普通方块 = 1×1×1 立方体，六面材质 [+x, -x, +y(top), -y(bottom), +z, -z]；
// cross 方块（火把/拉杆/按钮/线）= 两张交叉双面薄片（与 ChunkMesh 的 cross 渲染同构）。
// 注意：BlockRegistry.register 会把 def.textures 规范化成平铺的 top/side/bottom 字段
//（原 textures 对象不保留），所以这里必须读 def.top/def.side/def.bottom。
async function buildBlockTemplate(name, def) {
  const t = { top: def.top || name, side: def.side || name, bottom: def.bottom || name };
  const pick = (key) => BlockSVGDefinitions[key] || '';
  const [sideTex, topTex, botTex] = await Promise.all([
    svgTexture(pick(t.side)), svgTexture(pick(t.top)), svgTexture(pick(t.bottom)),
  ]);
  if (!sideTex) {
    console.warn(`[HeldItemMesh] 方块 ${name} 找不到贴图 SVG(${t.side})，使用兜底纯色`);
    const fb = getFallbackTexture();
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ map: fb, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
    return group;
  }
  const group = new THREE.Group();
  if (def.renderType === 'cross') {
    const mat = heldMaterial(sideTex);
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    p2.rotation.y = Math.PI / 2;
    group.add(p1, p2);
    return group;
  }
  const mat = (tex) => heldMaterial(tex || sideTex);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [mat(sideTex), mat(sideTex), mat(topTex), mat(botTex), mat(sideTex), mat(sideTex)]);
  group.add(mesh);
  return group;
}

// 物品类（工具/食物等）：双面薄片
async function buildItemTemplate(name) {
  const tex = await svgTexture(ItemSVGDefinitions[name] || '');
  if (!tex) return null;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), heldMaterial(tex));
  mesh.rotation.y = Math.PI * 0.08; // 微转出一点厚度感
  const group = new THREE.Group();
  group.add(mesh);
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
