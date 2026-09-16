// PanoramaBake.js -- 全景图烘焙工具（dev，URL ?bake-panorama=1 触发）
// 在固定种子世界的六个群系机位，用 6 个 90° 方向各渲染一张 512²，导出 JPEG dataURL。
// 产物保存为 res/panorama/{px,nx,py,ny,pz,nz}.jpg，由 Panorama 播放器加载（贴 cubemap 球面旋转播放）。
// 烘焙时云层隐藏（播放器单独叠加动态云），体素光定格上午。
// Build 25：机位改为六群系各一面（蘑菇岛/沙漠/向日葵平原/针叶林/积雪针叶林/沼泽），
// 烘焙世界禁用结构生成 → 画面零建筑；每面独立生命周期（加载→建 mesh→拍→释放）。
// 完整光照增强档（ACES+PostFX+真反射+太阳阴影，4 子项全开）沿用 Build 24 接线。
import * as THREE from 'three';
import { World } from '../core/World.js';
import { CHUNK_SIZE } from '../core/Chunk.js';
import { ChunkMeshBuilder } from './ChunkMesh.js';
import { Sky } from './Sky.js';
import { SVGTextures } from './SVGTextures.js';
import { BlockSVGDefinitions } from '../blocks/BlockDefs.js';
import { ItemSVGDefinitions } from '../items/ItemDefs.js';
import { VoxelLightUniforms, GfxState, ShadowUniforms } from './VoxelLight.js';
import { PostFX } from './PostFX.js';
import { SunShadow } from './SunShadow.js';
import { Biomes, BiomeNames } from '../world/biomes.js';

export const PANO_SIZE = 512;
const SEED = 20250903;
const RADIUS = 5;

// 六面拍摄计划（普通 2D 语义：up 正常，天在图上方；py/ny 特殊 up 由播放端 BoxGeometry UV 校准）。
// 每面一个目标群系（互不重复）；面序 = 播放端 CubeTexture 面序 px nx py ny pz nz。
// ny 为俯瞰面（相机抬高拍群系全貌）；fallbacks 依次尝试，全空回落原点。
const FACE_PLANS = [
  { name: 'px', dir: [1, 0, 0], up: [0, 1, 0], biome: Biomes.MUSHROOM_FIELDS, fallbacks: [Biomes.PLAINS, Biomes.SUNFLOWER_PLAINS] },
  { name: 'nx', dir: [-1, 0, 0], up: [0, 1, 0], biome: Biomes.DESERT, fallbacks: [Biomes.MOUNTAINS] },
  { name: 'py', dir: [0, 1, 0], up: [0, 0, -1], biome: Biomes.SUNFLOWER_PLAINS, fallbacks: [Biomes.PLAINS] },
  { name: 'ny', dir: [0, -1, 0], up: [0, 0, 1], biome: Biomes.TAIGA, fallbacks: [Biomes.BIRCH_FOREST] },
  { name: 'pz', dir: [0, 0, 1], up: [0, 1, 0], biome: Biomes.SNOWY_TAIGA, fallbacks: [Biomes.MOUNTAINS] },
  { name: 'nz', dir: [0, 0, -1], up: [0, 1, 0], biome: Biomes.SWAMP, fallbacks: [Biomes.BIRCH_FOREST] },
];

// 自上而下找第一格非空气（实际地表，含树/植被/雪层）
function surfaceTop(world, x, z) {
  for (let y = 110; y > 30; y--) {
    const id = world.getBlock(x, y, z);
    if (id !== 0) return { y, name: (BlockRegistry.getById(id) || {}).name || '' };
  }
  return { y: 40, name: '' };
}

// 群系机位纯函数扫描：从原点向外环形步进（步长 24），找到首个满足
// "本体+八向探针同群系、陆地、平整"的代表点。maxR 上限 6000（蘑菇岛占比 ~2.2% 实测够）。
function pickBiomeSpot(gen, biomeId, maxR = 6000, maxSlope = 10) {
  const probe = [[12, 0], [-12, 0], [0, 12], [0, -12], [8, 8], [-8, 8], [8, -8], [-8, -8]];
  for (let r = 0; r <= maxR; r += 24) {
    const steps = Math.max(1, Math.round((r * Math.PI * 2) / 24));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
      if (gen.getBiome(x, z) !== biomeId) continue;
      const h = gen.getBaseHeight(x, z);
      if (h < 62 || h > 90) continue;
      let ok = true, minH = h, maxH = h;
      for (const [dx, dz] of probe) {
        if (gen.getBiome(x + dx, z + dz) !== biomeId) { ok = false; break; }
        const hh = gen.getBaseHeight(x + dx, z + dz);
        if (hh < 60) { ok = false; break; }
        minH = Math.min(minH, hh); maxH = Math.max(maxH, hh);
      }
      if (ok && maxH - minH <= maxSlope) return { x, z, h };
    }
  }
  return null;
}

// 每面选定机位：目标群系 → fallback 链 → 原点回落（确定性纯函数，不生成区块）
function pickFaceSpots(gen) {
  const out = [];
  for (const plan of FACE_PLANS) {
    let spot = null, used = plan.biome;
    for (const b of [plan.biome, ...plan.fallbacks]) {
      spot = pickBiomeSpot(gen, b);
      if (spot) { used = b; break; }
    }
    if (!spot) { used = null; spot = { x: 8, z: 8, h: gen.getBaseHeight(8, 8) }; }
    const entry = { ...plan, spot, biomeName: used === null ? '原点回落' : BiomeNames[used] };
    out.push(entry);
    console.log('[Bake] 机位 ' + plan.name + ' → ' + entry.biomeName + ' @ (' + spot.x + ',' + spot.z + ')');
  }
  return out;
}

// 避水偏航：8 方向 × 3 距离采样实测地表，选水面占比最低的方向（水平面取景用）
function avoidWaterYaw(world, x0, z0) {
  let bestYaw = 0, bestW = Infinity;
  for (let k = 0; k < 8; k++) {
    const yaw = (k / 8) * Math.PI * 2;
    let w = 0;
    for (const r of [24, 40, 56]) {
      const sx = Math.round(x0 + Math.cos(yaw) * r), sz = Math.round(z0 + Math.sin(yaw) * r);
      if (surfaceTop(world, sx, sz).name === 'water') w++;
    }
    if (w < bestW) { bestW = w; bestYaw = yaw; }
    if (w === 0) break;
  }
  return bestYaw;
}

// 构建烘焙场景（全局一次）：图集/builder/天空 + 六面机位计划。烘焙世界禁用结构。
async function buildWorldScene() {
  const scene = new THREE.Scene();
  const sky = new Sky(scene);
  // 雾在边缘前收掉：地形远端融进天色，遮住 ±80 格的世界边缘
  if (scene.fog) { scene.fog.near = 30; scene.fog.far = 90; }
  sky.time = 0.42; // 上午光线

  const world = new World(SEED);
  world.generator.structureManager.disabled = true; // 全景要求画面零建筑
  const allSvgs = { ...BlockSVGDefinitions, ...ItemSVGDefinitions };
  const { atlasTexture, atlasUV } = await SVGTextures.buildAtlas(allSvgs);
  const waterTexture = await SVGTextures.buildRepeatTexture(allSvgs['water'] || '', 'water');
  const builder = new ChunkMeshBuilder(world, atlasTexture, atlasUV, waterTexture);

  console.log('[Bake] 阶段1: 图集完成(结构生成已禁用)');
  const plans = pickFaceSpots(world.generator);
  console.log('[Bake] 阶段2: 六面机位选定');
  return { scene, sky, world, builder, plans };
}

// 单面生命周期：加载该机位 ±RADIUS 区块 → 定相机(实测最高点+抬升) → 建全部 mesh
async function prepareFace(ctx, plan) {
  const { scene, sky, world, builder } = ctx;
  const { x, z } = plan.spot;
  const cx0 = Math.floor(x / CHUNK_SIZE), cz0 = Math.floor(z / CHUNK_SIZE);
  let i = 0;
  for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    for (let dz = -RADIUS; dz <= RADIUS; dz++) {
      world.ensureChunk(cx0 + dx, cz0 + dz);
      if (++i % 4 === 0) await new Promise(r => setTimeout(r, 0));
    }
  }
  // 机位实测最高点（含树冠/巨型蘑菇）
  let top = 0;
  for (let dx = -10; dx <= 10; dx += 2) {
    for (let dz = -10; dz <= 10; dz += 2) {
      top = Math.max(top, surfaceTop(world, x + dx, z + dz).y);
    }
  }
  // 水平面 top+8；俯瞰面(ny) top+28 拍群系全貌
  const center = new THREE.Vector3(x + 0.5, top + (plan.name === 'ny' ? 28 : 8), z + 0.5);
  const yaw = (plan.dir[1] === 0) ? avoidWaterYaw(world, x, z) : 0;
  sky.clouds.visible = false;
  i = 0;
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
  // 天空状态与体素光按本面机位落地一次
  sky.update(0.016, center);
  VoxelLightUniforms.uDayLight.value = 0.10 + 0.90 * sky.getLightLevel();
  VoxelLightUniforms.uSunTint.value.copy(sky.sunTint);
  console.log('[Bake] 面准备完成 ' + plan.name + ' (' + plan.biomeName + ') center=' + center.x.toFixed(0) + ',' + center.y.toFixed(0) + ',' + center.z.toFixed(0));
  return { center, yaw };
}

// 释放单面全部 mesh 与区块数据（下一面重新加载，控制内存峰值）
function releaseFace(ctx) {
  const { scene, world } = ctx;
  for (const [, chunk] of world.chunks) {
    for (const key of ['mesh', 'waterMesh', 'lightMesh']) {
      if (chunk[key]) { scene.remove(chunk[key]); chunk[key].geometry.dispose(); chunk[key] = null; }
    }
  }
  world.chunks.clear();
}

// 渲染一帧并导出 JPEG dataURL（skipRead=true 仅渲染预热，不读像素）
function renderFace(renderer, scene, camera, postfx, sunShadow, sky, face, skipRead) {
  const { center, yaw } = face;
  const plan = face.plan;
  camera.position.copy(center);
  camera.rotation.set(0, 0, 0);
  camera.up.set(plan.up[0], plan.up[1], plan.up[2]);
  // 水平面按避水 yaw 旋转取景方向；py/ny 保持天顶/天底
  const d = plan.dir[1] !== 0 ? plan.dir : [Math.cos(yaw), 0, Math.sin(yaw)];
  camera.lookAt(center.x + d[0], center.y + d[1], center.z + d[2]);
  // 逐面刷新体积光投影与 shadow 相机（map 与矩阵同帧），PostFX 链完成反射/泛光/分级
  postfx.updateGodRays(sky, camera);
  sunShadow.update(center, 5);
  postfx.render(scene, camera);
  if (skipRead) return null;
  const gl = renderer.getContext();
  const px = new Uint8Array(PANO_SIZE * PANO_SIZE * 4);
  gl.readPixels(0, 0, PANO_SIZE, PANO_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const cv = document.createElement('canvas');
  cv.width = PANO_SIZE; cv.height = PANO_SIZE;
  const ctx2d = cv.getContext('2d');
  const img = ctx2d.createImageData(PANO_SIZE, PANO_SIZE);
  for (let y = 0; y < PANO_SIZE; y++) {
    img.data.set(px.subarray(y * PANO_SIZE * 4, (y + 1) * PANO_SIZE * 4), (PANO_SIZE - 1 - y) * PANO_SIZE * 4);
  }
  ctx2d.putImageData(img, 0, 0);
  return cv.toDataURL('image/jpeg', 0.88);
}

// 渲染 6 面并返回 { faces: { px: dataURL, ... }, plans }
export async function bakePanorama(rendererWrapper) {
  const renderer = rendererWrapper.renderer; // Game.renderer 是封装类，THREE 实例在 .renderer
  const ctx = await buildWorldScene();
  const { scene, sky, world, builder, plans } = ctx;
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 1000);
  // 完整档：体积光天体在 layer 1、反射排除层水面在 layer 2（与 Game 相机分层一致）
  camera.layers.enable(1);
  camera.layers.enable(2);
  const oldSize = new THREE.Vector2();
  renderer.getSize(oldSize);
  const oldPixelRatio = renderer.getPixelRatio();
  const oldToneMapping = renderer.toneMapping;
  const oldShadowEnabled = renderer.shadowMap.enabled;
  renderer.setPixelRatio(1);
  renderer.setSize(PANO_SIZE, PANO_SIZE);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
  console.log('[Bake] 完整档接线: ACES + PostFX + 真反射 + 太阳阴影');
  // ---- 光照增强完整档（4 子项全开）----
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  const postfx = new PostFX(renderer);          // 泛光 + 体积光 + 色彩分级（512² RT 同步尺寸）
  postfx.setSceneCamera(scene, camera);
  postfx.setEnabled(true);
  postfx.reflectionEnabled = true;              // 水面真反射（planar RT）
  const sunShadow = new SunShadow(renderer);
  sunShadow.init(sky.sunLight, scene);
  sunShadow.enabled = true;
  sunShadow.setReceive(true, world);
  GfxState.shadowReceive = true;
  // HDR 提亮供泛光取源（与 Game.update 完整档同参）：光源块 2.2 / 太阳盘 1.25；日晕隐藏
  GfxState.lightBoost = 2.2;
  builder.lightMaterial.color.setScalar(2.2);
  if (sky.sun) sky.sun.material.color.setScalar(1.25);
  if (sky.sunGlow) sky.sunGlow.visible = false;
  VoxelLightUniforms.uCloudShadow.value = 0;    // 云已隐藏（播放器动态叠加），云影关闭
  console.log('[Bake] 阶段3: 六面渲染开始');
  const out = {};
  try {
    for (const plan of plans) {
      const faceCtx = await prepareFace(ctx, plan);
      faceCtx.plan = plan;
      // 预热一帧：机位变化后首次 shadow pass 重建 map，之后 uShadowOn 生效
      renderFace(renderer, scene, camera, postfx, sunShadow, sky, faceCtx, true);
      ShadowUniforms.uShadowOn.value = sunShadow.ready ? 1 : 0;
      out[plan.name] = renderFace(renderer, scene, camera, postfx, sunShadow, sky, faceCtx, false);
      releaseFace(ctx);
      await new Promise(r => setTimeout(r, 0));
    }
  } finally {
    renderer.setPixelRatio(oldPixelRatio);
    renderer.setSize(oldSize.x, oldSize.y);
    renderer.toneMapping = oldToneMapping;
    renderer.shadowMap.enabled = oldShadowEnabled;
  }
  return {
    faces: out,
    plans: plans.map(p => ({ name: p.name, biomeName: p.biomeName, x: p.spot.x, z: p.spot.z })),
  };
}
