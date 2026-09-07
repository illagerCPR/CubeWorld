// PlanarReflection.js -- 光照增强 L4-A：平面真反射
// 镜像相机沿唯一水面平面（世界 y=WATER_Y）翻转，把场景渲到半分辨率 RT；水面片元
// 经 textureMatrix 投影 UV 采样 RT，按菲涅尔替换 L1 的"天空色反射"项（VoxelLightWater 注入）。
// - 全游戏水顶面同高（海平面 SEA_LEVEL=64，顶面 y=65），故反射平面唯一、oblique
//   near-plane 裁剪只需一套参数（近裁剪面斜贴水面，河床/岸壁不入反射）。
// - 水面 mesh 标记 layer 2，反射相机 mask 排除 → 无水面自反射递归；layer 1 天体
//   保留（水面可见太阳/月亮倒影）。
// - 眼睛入水由 Game 逐帧写 enabled=false：RT 跳渲 + uReflOn 归零走 L1 天空色回退。
// - 反射 RT 为线性原始值（渲 RT 不做 sRGB 编码），与水面注入域（opaque_fragment 后、
//   色调映射/编码前）一致；主渲染走 composer 或直渲两条路径语义相同。
// - 反射画面不走 bloom/色调映射链（位置决定），反射里太阳无光晕——廉价反射通病，接受。
import * as THREE from 'three';
import { VoxelLightUniforms } from './VoxelLight.js';

// 唯一反射平面：水面最高方块 y=64，其顶面在世界 y=65（天域/下界无水体，由维度门控关闭）
const WATER_Y = 65;

export class PlanarReflection {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = false;   // Game 逐帧写：完整档 ∧ 设置子开关 ∧ 主世界 ∧ 眼睛未入水
    this._rt = null;
    this._cam = new THREE.PerspectiveCamera();
    this._texMat = new THREE.Matrix4();
    this._dir = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y);
    this._clipPlane = new THREE.Plane();
    this._q4 = new THREE.Vector4();
    this._cp4 = new THREE.Vector4();
    this._size = new THREE.Vector2();
  }

  // 半分辨率 RT（尺寸每帧自查，随窗口/像素比变化自动同步）
  _syncSize() {
    this.renderer.getDrawingBufferSize(this._size);
    const w = Math.max(2, Math.floor(this._size.x / 2));
    const h = Math.max(2, Math.floor(this._size.y / 2));
    if (!this._rt) {
      this._rt = new THREE.WebGLRenderTarget(w, h, {
        // mipmap：水面（尤其掠射区/远处）采样半分辨率 RT 时每像素覆盖多个反射纹素，
        // 无 mip 会产生逐像素高频噪点闪烁（用户实测"倒影频繁闪动"）——开 mip 后按 UV
        // 梯度自动选层平滑；renderer.render 到 RT 后自动生成（generateMipmaps 默认链路）
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: true,
        depthBuffer: true,
        stencilBuffer: false
      });
    } else if (this._rt.width !== w || this._rt.height !== h) {
      this._rt.setSize(w, h);
    }
  }

  // 每帧在主渲染前调用：更新镜像相机 → 渲反射 RT → 写水面采样 uniforms
  render(scene, camera) {
    if (!this.enabled || !scene || !camera) {
      if (VoxelLightUniforms.uReflOn.value !== 0) VoxelLightUniforms.uReflOn.value = 0;
      return;
    }
    // 相机低于水面的保险（正常入水已由 Game 的 inWater 门控提前关断）
    if (camera.position.y <= WATER_Y) {
      VoxelLightUniforms.uReflOn.value = 0;
      return;
    }
    this._syncSize();

    // 镜像相机：位置沿水面翻转；视线方向与 up 同步 y 取反 → 俯仰反向、偏航不变
    const cam = this._cam;
    camera.updateMatrixWorld();
    this._pos.copy(camera.position);
    cam.position.set(this._pos.x, 2 * WATER_Y - this._pos.y, this._pos.z);
    camera.getWorldDirection(this._dir);
    this._dir.y = -this._dir.y;
    this._up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this._up.y = -this._up.y;
    cam.up.copy(this._up);
    this._target.copy(cam.position).add(this._dir);
    cam.lookAt(this._target);
    cam.near = camera.near;
    cam.far = camera.far;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    this._applyOblique(cam);

    // textureMatrix：世界坐标 → 反射 RT 的 [0,1] UV（bias × 反射投影 × 反射视图逆）
    this._texMat.set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1
    );
    this._texMat.multiply(cam.projectionMatrix);
    this._texMat.multiply(cam.matrixWorldInverse);

    // 渲反射 RT：mask 沿用主相机但排除 layer 2（水面自身），雾保留（倒影远景融进雾色）
    const r = this.renderer;
    const oldRT = r.getRenderTarget();
    const oldAutoClear = r.autoClear;
    const oldMask = cam.layers.mask;
    cam.layers.mask = camera.layers.mask & ~(1 << 2);
    try {
      r.setRenderTarget(this._rt);
      r.autoClear = true;
      r.clear();
      r.render(scene, cam);
    } finally {
      cam.layers.mask = oldMask;
      r.autoClear = oldAutoClear;
      r.setRenderTarget(oldRT);
    }

    VoxelLightUniforms.uReflMap.value = this._rt.texture;
    VoxelLightUniforms.uTexMatrix.value = this._texMat;
    VoxelLightUniforms.uReflOn.value = 1;
  }

  // three Reflector 同款 oblique 推导：视空间裁剪平面（法线朝水面上方）烘焙进投影矩阵，
  // 近裁剪面斜贴反射平面——反射视角里水下几何（河床/岸壁）被硬裁
  _applyOblique(cam) {
    this._clipPlane.copy(this._plane).applyMatrix4(cam.matrixWorldInverse);
    const cp = this._cp4.set(
      this._clipPlane.normal.x,
      this._clipPlane.normal.y,
      this._clipPlane.normal.z,
      this._clipPlane.constant
    );
    const p = cam.projectionMatrix;
    const q = this._q4;
    q.x = (Math.sign(cp.x) + p.elements[8]) / p.elements[0];
    q.y = (Math.sign(cp.y) + p.elements[9]) / p.elements[5];
    q.z = -1.0;
    q.w = (1.0 + p.elements[10]) / p.elements[14];
    cp.multiplyScalar(2.0 / cp.dot(q));
    p.elements[2] = cp.x;
    p.elements[6] = cp.y;
    p.elements[10] = cp.z + 1.0;
    p.elements[14] = cp.w;
  }
}
