// entityLight.js -- 实体体素光染色共享助手（Build 22）
// 背景：火把/荧石等发光方块此前只照亮地形（体素光 shader），怪物有 MobManager 的逐帧
// 染色，但玩家模型（本地第三人称 / 联机远端玩家 / 第一人称手臂）完全不受方块光影响。
// 本文件把"按所在格体素光调制实体颜色"的公式抽成单一来源：怪物与玩家共用，防漂移。
// 公式：亮度 v = 0.55 + 0.45 × max(天光×昼夜系数, 方块光)，方块光附加暖色偏移（火把暖光）。
import * as THREE from 'three';

// 采样世界坐标 pos（实体脚底）所在格的光照染色，写入 out 并返回；world 缺失时原样返回。
// 附带：blkL（方块光 0-1）、skyDay（天光×昼夜，0-1）、glow（火光直发光系数——
// 夜晚/洞穴时方块光对实体的 emissive 贡献，对应地形 shader 的 max(日光, 火光) 火光路）。
export function sampleEntityLight(world, sky, pos, out = { r: 1, g: 1, b: 1 }) {
  if (!world) return out;
  const bx = Math.floor(pos.x), by = Math.floor(pos.y + 0.5), bz = Math.floor(pos.z);
  const skyL = world.getSkyLight(bx, by, bz) / 15;
  const blkL = world.getBlockLightAt(bx, by, bz) / 15;
  const day = 0.10 + 0.90 * (sky ? sky.getLightLevel() : 1);
  const l = Math.max(skyL * day, blkL);
  const v = 0.55 + 0.45 * l;
  out.r = v * (1 + 0.18 * blkL);
  out.g = v;
  out.b = v * (1 - 0.10 * blkL);
  out.blkL = blkL;
  out.skyDay = Math.min(1, skyL * day);
  out.glow = blkL * Math.max(0, 1 - out.skyDay);
  return out;
}

const _tint = { r: 1, g: 1, b: 1 };
const _tintC = new THREE.Color();
const _torchC = new THREE.Color(1.0, 0.82, 0.58); // 与 VoxelLight uTorchTint 同色（地形火光一致观感）
const _glowC = new THREE.Color();

// 单 mesh 染色：首帧把材质基色快照进 userData.entityLightBase（皮肤应用会整体替换材质，
// 新材质无快照 → 自动按当前 color 重新快照），此后每帧 color = 基色 × 光色。
// 受击红光等 emissive 反馈走独立通道（调用方在有临时 emissive 时跳过本函数一帧即可）。
function _tintMesh(mesh, tint) {
  const mat = mesh.material;
  if (!mat || !mat.color) return;
  let base = mat.userData.entityLightBase;
  if (!base) base = mat.userData.entityLightBase = mat.color.clone();
  mat.color.copy(base).multiply(_tintC.setRGB(tint.r, tint.g, tint.b));
  if (mat.emissive) {
    // 方块光直发光：夜晚/洞穴火把照亮实体（否则夜晚 Lambert 场景光≈0，color 调得再亮也渲染不出）。
    // 有贴图的材质（蒙皮模型）把 emissiveMap 指向同一张贴图 → 辉光按纹素 albedo 调制，
    // 暗部少发光、亮部多发光，皮肤纹理不被平光冲掉；纯色兜底部件无 map，走基色调制。
    if (mat.map && mat.emissiveMap !== mat.map) mat.emissiveMap = mat.map;
    mat.emissive.copy(_glowC.copy(_torchC).multiply(base));
    mat.emissiveIntensity = 0.85 * tint.glow;
  }
}

// 对若干 mesh（或 mesh 数组，数组项可为 undefined）逐帧染色。
// world 未就绪（存档切换间隙）时跳过，保持当前颜色不动。
export function applyEntityLight(world, sky, pos, ...entries) {
  if (!world) return;
  sampleEntityLight(world, sky, pos, _tint);
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.isMesh) { _tintMesh(entry, _tint); continue; }
    for (const mesh of entry) {
      if (mesh) _tintMesh(mesh, _tint);
    }
  }
}
