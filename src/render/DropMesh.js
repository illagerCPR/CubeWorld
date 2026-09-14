// DropMesh.js -- 掉落物渲染构建（Build 10 原版化）
// 模型复用 HeldItemMesh 模板（方块=六面贴图小立方 / 物品与 cross=像素挤出），掉落组 =
// 模型（自旋+浮动，缩放 0.25）+ 地面阴影贴片 + 数量精灵（≥2 时白字黑影）。
// 几何/材质/贴图全部进程级共享缓存；drop 移除时仅 scene.remove，不 dispose（模板归 HeldItemMesh 缓存管）。
import * as THREE from 'three';
import { buildHeldItemTemplate } from './HeldItemMesh.js';

export const DROP_HALF = 0.125; // 模型半边长（0.25 缩放后，物理点级碰撞半径同值）

let shadowTex = null;
function getShadowTexture() {
  if (!shadowTex) {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    g.addColorStop(0, 'rgba(0,0,0,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(cv);
  }
  return shadowTex;
}

let shadowGeo = null;
let shadowMat = null;
// 阴影贴片：水平放置的径向渐变圆片，跟随地面高度（调用方每帧更新 position.y / visible）
export function makeShadowMesh() {
  if (!shadowGeo) {
    shadowGeo = new THREE.PlaneGeometry(0.55, 0.55);
    shadowMat = new THREE.MeshBasicMaterial({ map: getShadowTexture(), transparent: true, depthWrite: false });
  }
  const m = new THREE.Mesh(shadowGeo, shadowMat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

const countTexCache = new Map(); // count -> CanvasTexture（白字黑影，右下角数量角标）
function getCountTexture(count) {
  if (countTexCache.has(count)) return countTexCache.get(count);
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 16;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 12px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(25,25,25,0.9)';
  ctx.fillText(String(count), 30, 14.5);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(count), 29, 13.5);
  const tex = new THREE.CanvasTexture(cv);
  countTexCache.set(count, tex);
  return tex;
}

// 数量角标精灵（count>=2 时创建；部分拾取/合并后用 updateCountSprite 换贴图）
export function makeCountSprite(count) {
  const mat = new THREE.SpriteMaterial({ map: getCountTexture(count), transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.28, 0.14, 1);
  sp.position.set(0.19, 0.06, 0);
  sp.renderOrder = 2;
  return sp;
}

export function updateCountSprite(sprite, count) {
  if (!sprite) return;
  sprite.material.map = getCountTexture(count);
  sprite.visible = count > 1; // 原版风格：剩 1 个不显示角标
}

// 异步填充模型（HeldItemMesh 模板 clone，尺寸归一 1，内层由调用方缩放 0.25）；返回 Promise<boolean>
// 调用方在 resolve 时须自检 drop 仍存活（拾取/岩浆销毁早于模板就绪的情形）
export function attachDropModel(inner, name) {
  return buildHeldItemTemplate(name).then((tpl) => {
    if (!tpl) return false;
    inner.add(tpl.clone(true));
    return true;
  });
}
