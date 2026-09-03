// PanoramaBake.js -- 全景图烘焙工具（dev，URL ?bake-panorama=1 触发）
// 在固定种子世界的美景机位，用 6 个 90° 方向各渲染一张 512²，导出 JPEG dataURL。
// 产物保存为 res/panorama/{px,nx,py,ny,pz,nz}.jpg，由 Panorama 播放器加载（贴 cubemap 球面旋转播放）。
// 烘焙时云层隐藏（播放器单独叠加动态云），体素光定格上午。
import * as THREE from 'three';
import { World } from '../core/World.js';
import { CHUNK_SIZE } from '../core/Chunk.js';
import { ChunkMeshBuilder } from './ChunkMesh.js';
import { Sky } from './Sky.js';
import { SVGTextures } from './SVGTextures.js';
import { BlockSVGDefinitions } from '../blocks/BlockDefs.js';
import { ItemSVGDefinitions } from '../items/ItemDefs.js';
import { VoxelLightUniforms } from './VoxelLight.js';

export const PANO_SIZE = 512;
const SEED = 20250903;
const RADIUS = 5;

// 六面拍摄方向（普通 2D 语义：up 正常，天在图上方；py/ny 特殊 up 由播放端 BoxGeometry UV 校准）
const FACES = [
  ['px', [1, 0, 0], [0, 1, 0]],
  ['nx', [-1, 0, 0], [0, 1, 0]],
  ['py', [0, 1, 0], [0, 0, -1]],
  ['ny', [0, -1, 0], [0, 0, 1]],
  ['pz', [0, 0, 1], [0, 1, 0]],
  ['nz', [0, 0, -1], [0, 1, 0]],
];

// 自上而下找第一格非空气（实际地表，含树/植被/雪层）
function surfaceTop(world, x, z) {
  for (let y = 110; y > 30; y--) {
    const id = world.getBlock(x, y, z);
    if (id !== 0) return { y, name: (BlockRegistry.getById(id) || {}).name || '' };
  }
  return { y: 40, name: '' };
}

// 找开阔机位候选（按优先级排序）：baseHeight 陆地、四向 12 格同为陆地且高差小
function pickVantageCandidates(world) {
  const g = world.generator;
  const probe = [[12, 0], [-12, 0], [0, 12], [0, -12]];
  const cands = [];
  for (let r = 0; r <= 16; r += 4) {
    for (let a = 0; a < 16; a++) {
      const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
      const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
      const h = g.getBaseHeight(x, z);
      if (h < 64 || h > 72) continue;
      let ok = true, minH = h, maxH = h;
      for (const [dx, dz] of probe) {
        const hh = g.getBaseHeight(x + dx, z + dz);
        if (hh < 63) { ok = false; break; }
        minH = Math.min(minH, hh); maxH = Math.max(maxH, hh);
      }
      if (ok && maxH - minH <= 6) cands.push({ x, z, h });
    }
  }
  if (!cands.length) cands.push({ x: 8, z: 8, h: g.getBaseHeight(8, 8) });
  return cands;
}

// 构建烘焙场景：返回 { scene, center, yaw }
async function buildWorldScene() {
  const scene = new THREE.Scene();
  const sky = new Sky(scene);
  // 雾在边缘前收掉：地形远端融进天色，遮住 ±80 格的世界边缘
  if (scene.fog) { scene.fog.near = 30; scene.fog.far = 90; }
  sky.time = 0.42; // 上午光线

  const world = new World(SEED);
  const allSvgs = { ...BlockSVGDefinitions, ...ItemSVGDefinitions };
  const { atlasTexture, atlasUV } = await SVGTextures.buildAtlas(allSvgs);
  const waterTexture = await SVGTextures.buildRepeatTexture(allSvgs['water'] || '', 'water');
  const builder = new ChunkMeshBuilder(world, atlasTexture, atlasUV, waterTexture);

  console.log('[Bake] 阶段1: 图集完成');
  const cands = pickVantageCandidates(world);
  console.log('[Bake] 阶段2: 候选', cands.length);
  const chunkSet = new Set();
  for (const cand of cands) {
    const cx0 = Math.floor(cand.x / CHUNK_SIZE), cz0 = Math.floor(cand.z / CHUNK_SIZE);
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      for (let dz = -RADIUS; dz <= RADIUS; dz++) {
        chunkSet.add((cx0 + dx) + ',' + (cz0 + dz));
      }
    }
  }
  let i = 0;
  for (const key of chunkSet) {
    const [cx, cz] = key.split(',').map(Number);
    world.ensureChunk(cx, cz);
    if (++i % 4 === 0) await new Promise(r => setTimeout(r, 0));
  }
  console.log('[Bake] 阶段3: 数据区块完成', world.chunks.size);
  // 全局地表扫描缓存（step 3）
  const minX = Math.min(...cands.map(c => c.x)) - RADIUS * CHUNK_SIZE;
  const maxX = Math.max(...cands.map(c => c.x)) + RADIUS * CHUNK_SIZE;
  const minZ = Math.min(...cands.map(c => c.z)) - RADIUS * CHUNK_SIZE;
  const maxZ = Math.max(...cands.map(c => c.z)) + RADIUS * CHUNK_SIZE;
  const surf = new Map();
  for (let x = minX; x <= maxX; x += 3) {
    for (let z = minZ; z <= maxZ; z += 3) {
      surf.set(x + ',' + z, surfaceTop(world, x, z));
    }
    if ((x / 3) % 8 === 0) await new Promise(r => setTimeout(r, 0));
  }
  console.log('[Bake] 阶段4: 地表扫描完成', surf.size);
  const topAt = (x, z) => {
    let best = null, bd = 1e9;
    for (let dx = -3; dx <= 3; dx += 3) {
      for (let dz = -3; dz <= 3; dz += 3) {
        const s = surf.get((x + dx) + ',' + (z + dz));
        if (s) { const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = s; } }
      }
    }
    return best || { y: 66, name: '' };
  };
  // 机位评估：近景（±8）平整 + 雪占比低
  let snowN = 0;
  for (const [, s] of surf) {
    if (s.name === 'snow_layer' || s.name === 'snow' || s.name === 'ice') snowN++;
  }
  let v = null;
  for (const cand of cands) {
    let minTop = 999, maxTop = 0, snow = 0, n = 0;
    for (let dx = -8; dx <= 8; dx += 3) {
      for (let dz = -8; dz <= 8; dz += 3) {
        const t = topAt(cand.x + dx, cand.z + dz);
        minTop = Math.min(minTop, t.y); maxTop = Math.max(maxTop, t.y);
        n++;
        if (t.name === 'snow_layer' || t.name === 'snow' || t.name === 'ice') snow++;
      }
    }
    if (minTop >= 62 && maxTop - minTop <= 6 && snow * 3 < n) { v = cand; v.top = maxTop; break; }
  }
  if (!v) v = { ...cands[0], top: topAt(cands[0].x, cands[0].z).y };
  // 全部建完 mesh（云层由播放器动态叠加，烘焙时隐藏）
  console.log('[Bake] 阶段5: 机位选定', v.x, v.z, 'top', v.top);
  sky.clouds.visible = false;
  for (const [, chunk] of world.chunks) {
    for (const key of ['mesh', 'waterMesh', 'lightMesh']) {
      if (chunk[key]) { scene.remove(chunk[key]); chunk[key].geometry.dispose(); chunk[key] = null; }
    }
    const meshes = builder.build(chunk);
    if (meshes.solid) { chunk.mesh = meshes.solid; scene.add(meshes.solid); }
    if (meshes.water) { chunk.waterMesh = meshes.water; scene.add(meshes.water); }
    if (meshes.light) { chunk.lightMesh = meshes.light; scene.add(meshes.light); }
    chunk.dirty = false;
    if (++i % 6 === 0) await new Promise(r => setTimeout(r, 0));
  }
  console.log('[Bake] 阶段6: mesh 完成');
  // 相机架在实测最高点（含树冠）上方
  let top = v.top;
  for (let dx = -5; dx <= 5; dx += 2) {
    for (let dz = -5; dz <= 5; dz += 2) {
      top = Math.max(top, surfaceTop(world, v.x + dx, v.z + dz).y);
    }
  }
  const center = new THREE.Vector3(v.x + 0.5, top + 8, v.z + 0.5);
  // 初始朝向：背对雪质心（有雪山时让起始画面避开）
  let snowCx = 0, snowCz = 0;
  for (const [k, s] of surf) {
    if (s.name === 'snow_layer' || s.name === 'snow' || s.name === 'ice') {
      const [sx, sz] = k.split(',').map(Number);
      snowCx += sx; snowCz += sz;
    }
  }
  let yaw = 0;
  if (snowN > 0) {
    snowCx /= snowN; snowCz /= snowN;
    yaw = Math.atan2(v.x - snowCx, v.z - snowCz);
  }
  // 天空状态落地一次：skyMesh 颜色 / 雾色 / 太阳月亮位置 / sunTint 都在 update 里初始化
  sky.update(0.016, center);
  // 体素光定格上午
  VoxelLightUniforms.uDayLight.value = 0.10 + 0.90 * sky.getLightLevel();
  VoxelLightUniforms.uSunTint.value.copy(sky.sunTint);
  return { scene, center, yaw };
}

// 渲染 6 面并返回 { px: dataURL, ... }
export async function bakePanorama(rendererWrapper) {
  const renderer = rendererWrapper.renderer; // Game.renderer 是封装类，THREE 实例在 .renderer
  const { scene, center, yaw } = await buildWorldScene();
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 1000);
  const oldSize = new THREE.Vector2();
  renderer.getSize(oldSize);
  const oldPixelRatio = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setSize(PANO_SIZE, PANO_SIZE);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  console.log('[Bake] 阶段7: 六面渲染开始');
  const out = {};
  try {
    for (const [name, dir, up] of FACES) {
      camera.position.copy(center);
      camera.rotation.set(0, 0, 0);
      camera.up.set(up[0], up[1], up[2]);
      camera.lookAt(center.x + dir[0], center.y + dir[1], center.z + dir[2]);
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const px = new Uint8Array(PANO_SIZE * PANO_SIZE * 4);
      gl.readPixels(0, 0, PANO_SIZE, PANO_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const cv = document.createElement('canvas');
      cv.width = PANO_SIZE; cv.height = PANO_SIZE;
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(PANO_SIZE, PANO_SIZE);
      for (let y = 0; y < PANO_SIZE; y++) {
        img.data.set(px.subarray(y * PANO_SIZE * 4, (y + 1) * PANO_SIZE * 4), (PANO_SIZE - 1 - y) * PANO_SIZE * 4);
      }
      ctx.putImageData(img, 0, 0);
      out[name] = cv.toDataURL('image/jpeg', 0.88);
      await new Promise(r => setTimeout(r, 0));
    }
  } finally {
    renderer.setPixelRatio(oldPixelRatio);
    renderer.setSize(oldSize.x, oldSize.y);
  }
  return { faces: out, center: center.toArray(), yaw };
}
