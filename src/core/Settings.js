// Settings.js -- 视频设置存取与应用（localStorage 全局，不按存档隔离）
// applySettings 把当前设置实时套到渲染器/相机/天空/控制/体素光/粒子上；
// 平滑光照/AO 改动由调用方负责 world.markAllDirty()（见 VideoSettings 面板）。
import { RenderQuality } from '../render/ChunkMesh.js';
import { VoxelLightUniforms } from '../render/VoxelLight.js';

const KEY = 'cubeworld-settings';

export const DEFAULT_SETTINGS = {
  renderDistance: 6,   // 2..12 区块
  fov: 75,             // 60..110
  brightness: 6,       // 0..100 → uMinLight 0.02..0.25（6 ≈ 现调校值 0.035）
  clouds: true,
  particles: 'all',    // all | decreased | minimal
  smoothLighting: true,
  viewBobbing: true,
  sensitivity: 100,    // 30..200 (%)
};

const PARTICLE_SCALE = { all: 1, decreased: 0.5, minimal: 0.15 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function loadSettings() {
  const s = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (typeof saved === 'object' && saved) {
        if (saved.renderDistance !== undefined) s.renderDistance = clamp(Math.round(saved.renderDistance), 2, 12);
        if (saved.fov !== undefined) s.fov = clamp(Math.round(saved.fov), 60, 110);
        if (saved.brightness !== undefined) s.brightness = clamp(Math.round(saved.brightness), 0, 100);
        if (saved.clouds !== undefined) s.clouds = !!saved.clouds;
        if (PARTICLE_SCALE[saved.particles]) s.particles = saved.particles;
        if (saved.smoothLighting !== undefined) s.smoothLighting = !!saved.smoothLighting;
        if (saved.viewBobbing !== undefined) s.viewBobbing = !!saved.viewBobbing;
        if (saved.sensitivity !== undefined) s.sensitivity = clamp(Math.round(saved.sensitivity), 30, 200);
      }
    }
  } catch { /* 损坏的设置按默认处理 */ }
  return s;
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 存储满等忽略 */ }
}

// 亮度滑杆值 → 最低环境亮度（uMinLight）
export function brightnessToMinLight(v) {
  return 0.02 + (clamp(v, 0, 100) / 100) * 0.23;
}

// 把设置实时套到游戏对象上（全部判空：主菜单期 game.world/particles 等可为空）
export function applySettings(game) {
  const s = game.settings || DEFAULT_SETTINGS;

  // 视野
  if (game.renderer && game.renderer.camera) {
    game.renderer.camera.fov = s.fov;
    game.renderer.camera.updateProjectionMatrix();
  }
  // 亮度
  VoxelLightUniforms.uMinLight.value = brightnessToMinLight(s.brightness);
  // 雾距必须跟随渲染距离（W1 补修）：旧值 near60/far160 时雾 far(160) > 加载边界
  // (renderDistance×16=96)，方形区块边界在雾起效前硬截断——海景下呈"固定距离直线分界"
  if (game.renderer && game.renderer.scene && game.renderer.scene.fog) {
    const fogProf = game.world && game.world.dimDef && game.world.dimDef.sky ? game.world.dimDef.sky.fog : null;
    applyFogRange(game.renderer.scene.fog, s.renderDistance, fogProf);
  }
  // 云（游戏天空按维度档案联动；主菜单全景天空始终套设置）
  if (game.sky) game.sky.cloudsEnabled = s.clouds;
  if (typeof window !== 'undefined' && window.panorama && window.panorama.sky) {
    window.panorama.sky.clouds.visible = s.clouds;
    if (window.panorama.camera) {
      window.panorama.camera.fov = s.fov;
      window.panorama.camera.updateProjectionMatrix();
    }
  }
  // 鼠标灵敏度
  if (game.controls) game.controls.sensitivityScale = s.sensitivity / 100;
  // 渲染距离（无需立即处理：updateChunks 每帧按此值加载/卸载；雾距已在上方同步）
  // 平滑光照/AO（改动后由面板触发 markAllDirty）
  RenderQuality.smoothLighting = s.smoothLighting;
  RenderQuality.aoEnabled = s.smoothLighting; // AO 随平滑光照开关联动（与原版"平滑光照"语义一致）
  // 粒子密度
  const ds = PARTICLE_SCALE[s.particles] ?? 1;
  if (game.particles) game.particles.densityScale = ds;
  if (game.fireParticles) game.fireParticles.densityScale = ds;
}

// 雾距按渲染距离收口：far 取加载圈半径的 95%（雾 92%+ 才到边界，方形加载边界不可见），
// near 取 50%（给远景留层次）。factor 为维度档案的 { nearK, farK }（下界浓雾）。
// Game.update 出水恢复与此处必须同源（同传维度 factor）。
export function applyFogRange(fog, renderDistance, factor = null) {
  const nearK = (factor && factor.nearK) || 0.5;
  const farK = (factor && factor.farK) || 0.95;
  const dist = Math.max(2, Math.min(12, renderDistance || 6)) * 16;
  fog.near = dist * nearK;
  fog.far = dist * farK;
}
