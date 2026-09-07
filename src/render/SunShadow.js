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
    sh.normalBias = 0.03;                // 1m 立方/cross 薄片的 acne 抑制起点，批次②细调
    sh.camera.updateProjectionMatrix();
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
    // shadow 相机 = 退距处看玩家；target 量化到 texel 网格防游移
    const range = Math.max(96, renderDistance * 16) + 8;
    const texel = (2 * range) / MAP_SIZE;
    const tx = Math.round(playerPos.x / texel) * texel;
    const tz = Math.round(playerPos.z / texel) * texel;
    this._target.set(tx, playerPos.y, tz);
    light.target.position.copy(this._target);
    light.position.copy(this._target).addScaledVector(dir, SHADOW_DIST);
    const cam = light.shadow.camera;
    cam.left = -range; cam.right = range; cam.top = range; cam.bottom = -range;
    cam.updateProjectionMatrix();
    // 节流 shadow pass（renderer.shadowMap.autoUpdate=false，needsUpdate 单帧生效后自动复位）
    this.renderer.shadowMap.needsUpdate = (this._frame++ % 8 === 0);

    // 同步手工挂载的 lights shadow uniforms（three 不为 Basic 材质做这件事）
    const sh = light.shadow;
    if (sh.map) {
      ShadowUniforms.uShadowMap.value = [sh.map.texture];
      this.ready = true;
    }
    ShadowUniforms.uShadowMatrix.value[0].copy(sh.matrix);
    const p = ShadowUniforms.uShadowPar.value[0];
    p.shadowBias = sh.bias;
    p.shadowNormalBias = sh.normalBias;
    p.shadowRadius = sh.radius;
    p.shadowMapSize.set(MAP_SIZE, MAP_SIZE);
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
