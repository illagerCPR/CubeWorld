// SunShadow.js -- 光照增强 L4-B：太阳阴影贴图（完整档子开关 gfxShadows）
// - shadow 相机沿太阳方向对准玩家，正交范围随渲染距离；target 做 snap-to-texel
//   量化防移动时影子边缘游移闪烁（批次①用世界 XZ 量化，批次②改 light-space）。
// - renderer.shadowMap.autoUpdate=false：每 N 帧置 needsUpdate=true 摊薄 shadow pass
//   （太阳角速度 2π/1200s，8 帧 @60fps 期间影子边缘移动远小于 1 texel，视觉无差）。
// - **three 0.160 材质管线限制（探针实证，勿回退）**：materialNeedsLights() 只认
//   Lambert/Phong/Standard/ShaderMaterial，MeshBasicMaterial 即使 lights=true 也不会
//   挂载 lights shadow uniforms（directionalShadowMatrix 恒 0 矩阵）。绕法：
//   onBeforeCompile 手工挂载 ShadowUniforms 三件套（共享引用），每帧从
//   sunLight.shadow 同步值（matrix/map.texture/bias/normalBias/radius/mapSize）。
// - 接收面：chunk solid mesh（VoxelLight 注入器内采样 getShadow，影子权重随天光
//   vVoxelLight.x 衰减，防"树冠天光压暗+阴影再压"双重变暗）；怪物 Lambert 原生支持。
// - 关断语义（双层）：uShadowOn=0（shader 侧短路）+ chunk mesh receiveShadow=false
//   （renderer per-object 上传，不进 program cacheKey，零重编译）。
import * as THREE from 'three';
import { ShadowUniforms } from './VoxelLight.js';

const SHADOW_DIST = 200;   // shadow 相机沿太阳方向的退距（正交投影，near/far 只定深度窗）
const MAP_SIZE = 2048;     // shadow map 分辨率（±R 覆盖 2R 格 → texel ≈ 2R/2048）

export class SunShadow {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = false;      // Game 每帧写：完整档 ∧ gfxShadows ∧ 天体可见 ∧ 太阳在地平线上
    this.ready = false;        // shadow map 已由 shadow pass 创建（首帧前无纹理，uShadowOn 保持 0）
    this.light = null;         // sky.sunLight（Game.start 注入）
    this._frame = 0;
    this._recvOn = null;       // receiveShadow 批量切换缓存（null=未知）
    this._dir = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._upv = new THREE.Vector3();
  }

  // Game.start 注入：配置 sunLight 阴影参数并把 target 挂进场景
  init(sunLight, scene) {
    this.light = sunLight;
    sunLight.castShadow = true;   // 关闭档 shadowMap.enabled=false 时 shadow pass 不跑，零成本
    const sh = sunLight.shadow;
    sh.mapSize.set(MAP_SIZE, MAP_SIZE);
    sh.camera.near = 1;
    sh.camera.far = SHADOW_DIST + 320;   // 覆盖退距 + 最高地形/建筑
    sh.bias = -0.0004;
    sh.normalBias = 0.15;                // ≈1.5 texel：偏小会让斜面自阴影在边界振荡（边缘抖动）
    sh.camera.updateProjectionMatrix();
    // 阴影参数是静态值（init 一次性同步；矩阵/贴图见 update 的引用式同步）
    const p = ShadowUniforms.uShadowPar.value[0];
    p.shadowBias = sh.bias;
    p.shadowNormalBias = sh.normalBias;
    p.shadowRadius = sh.radius;
    p.shadowMapSize.set(MAP_SIZE, MAP_SIZE);
    if (!sunLight.target.parent) scene.add(sunLight.target);
    this.renderer.shadowMap.autoUpdate = false;  // 由 update() 节流置 needsUpdate
  }

  // 每帧（Game.update 内，sky.update 与 gfx 喂块之后）：摆 shadow 相机 + 节流更新 + 同步 uniform
  update(playerPos, renderDistance) {
    const frameNeeds = this.enabled && this.light;
    if (!frameNeeds) {
      if (this.ready) this.ready = false;
      return;
    }
    const light = this.light;
    const dir = this._dir.copy(light.position);   // Sky.update 刚写入的单位太阳方向
    // shadow 相机 = 退距处看玩家；target 做 light-space snap：在垂直太阳方向的平面内
    // 量化到 texel 网格——玩家连续移动时 target 跳格对齐，影子边缘不游移闪烁
    //（批次②：批次①的世界 XZ 量化在太阳斜照时仍有半 texel 误差）。
    // 太阳近天顶时 up×dir 退化，跳过量化（正午影子最短，游移不可见）。
    const range = Math.max(96, renderDistance * 16) + 8;
    const texel = (2 * range) / MAP_SIZE;
    this._target.copy(playerPos);
    const r = this._right.set(0, 1, 0).cross(dir);
    if (r.lengthSq() > 1e-6) {
      r.normalize();
      const u = this._upv.copy(dir).cross(r).normalize();
      const qx = Math.round(this._target.dot(r) / texel) * texel;
      const qy = Math.round(this._target.dot(u) / texel) * texel;
      // 沿光分量也量化（0.25 格）：玩家站坡上的物理微动若直接进 shadow 相机，
      // 深度比较值逐帧偏移 → 影子边缘 lit/shadow 振荡（边缘抖动的另一来源）
      const qd = Math.round(this._target.dot(dir) / 0.25) * 0.25;
      this._target.set(0, 0, 0)
        .addScaledVector(r, qx)
        .addScaledVector(u, qy)
        .addScaledVector(dir, qd);   // 保留沿光分量：横向对齐量化，depth 窗口贴合场景
    }
    light.target.position.copy(this._target);
    light.position.copy(this._target).addScaledVector(dir, SHADOW_DIST);
    const cam = light.shadow.camera;
    cam.left = -range; cam.right = range; cam.top = range; cam.bottom = -range;
    cam.updateProjectionMatrix();
    // shadow pass 每帧更新：8 帧节流曾致影子阶梯式跳变（用户实测"频繁闪动"，已否决）——
    // map 与 shadow 相机/matrix 必须同帧一致，节流期间影子冻结、更新帧跳格。真机 GPU 上
    // depth-only pass 便宜（MC 影子 mod 同款做法）；autoUpdate=false 保持逐帧显式请求。
    this.renderer.shadowMap.needsUpdate = true;
    this._frame++;

    // 同步手工挂载的 lights shadow uniforms（three 不为 Basic 材质做这件事）。
    // **关键（勿回退成每帧 copy）**：uShadowMatrix 引用 LightShadow.matrix 持久实例——
    // shadow pass 在渲染阶段才 updateMatrices，若这里每帧 copy 旧值，map 与 matrix 错位 1 帧，
    // 玩家/太阳任何移动都会让影子边缘每帧错位抖动（用户实测）。引用实例后同帧读到最新值。
    const sh = light.shadow;
    if (sh.map) {
      if (ShadowUniforms.uShadowMap.value[0] !== sh.map.texture) {
        ShadowUniforms.uShadowMap.value = [sh.map.texture];
      }
      if (ShadowUniforms.uShadowMatrix.value[0] !== sh.matrix) {
        ShadowUniforms.uShadowMatrix.value = [sh.matrix];
      }
      this.ready = true;
    }
  }

  // 接收影子批量切换（仅在开关状态变化时遍历；新建 chunk 由 GfxState.shadowReceive 取初值）
  setReceive(on, world) {
    if (this._recvOn === on) return;
    this._recvOn = on;
    if (!world || !world.chunks) return;
    for (const key of Object.keys(world.chunks)) {
      const c = world.chunks[key];
      if (c && c.mesh) c.mesh.receiveShadow = on;
    }
  }
}
