// RemotePlayer.js -- 远端玩家实体：方块人模型 + 位置插值 + 昵称标签
// 阶段 3：昵称按玩家 id 着色；阶段 4：插值优化（速度自适应平滑 + 远距瞬移快照 + 行走动画 + 头部俯仰）
import * as THREE from 'three';
import { playerColorHue, playerColorCss } from '../net/playerColor.js';

// 简化方块人部件（局部坐标原点在脚 y=0，单位：格）
// 关节部件（head/arm/leg）用 pivot 支撑：mesh 挂在 pivot 下，旋转 pivot 即旋转肢体
const PARTS = [
  { box: [-0.25, 1.5, -0.25, 0.25, 2.0, 0.25], role: 'head', pivot: [0, 1.5, 0] },
  { box: [-0.3, 0.6, -0.2, 0.3, 1.5, 0.2], role: 'body' },
  { box: [-0.5, 0.6, -0.15, -0.3, 1.45, 0.15], role: 'arm', pivot: [-0.4, 1.45, 0] },
  { box: [0.3, 0.6, -0.15, 0.5, 1.45, 0.15], role: 'arm', pivot: [0.4, 1.45, 0] },
  { box: [-0.28, 0, -0.15, -0.02, 0.6, 0.15], role: 'leg', pivot: [-0.13, 0.6, 0] },
  { box: [0.02, 0, -0.15, 0.28, 0.6, 0.15], role: 'leg', pivot: [0.13, 0.6, 0] },
];

// 远距瞬移阈值：超过则直接快照（respawn/传送时避免"飞天滑行"）
const SNAP_DIST = 4;
// 插值基准速率（每帧收敛比例由速度自适应放大）
const BASE_K = 10;

// 由玩家 id 派生稳定颜色（与聊天/昵称共用同一套色板，区分不同玩家）
function playerColor(id) {
  return new THREE.Color().setHSL(playerColorHue(id) / 360, 0.6, 0.45);
}

export class RemotePlayer {
  constructor(scene, id, name, pos) {
    this.id = id;
    this.name = name;
    this.dead = false;
    this.hitFlash = 0;
    const color = playerColor(id);

    this.group = new THREE.Group();
    this.parts = [];     // 普通 mesh 列表（渲染 / 受击红光）
    this.joints = {};    // role -> { pivot: Group, mesh: Mesh }
    for (const def of PARTS) {
      const [minX, minY, minZ, maxX, maxY, maxZ] = def.box;
      const geo = new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ);
      let c;
      if (def.role === 'head') c = 0xe0b080;
      else if (def.role === 'body') c = color;
      else if (def.role === 'leg') c = color.clone().multiplyScalar(0.75);
      else c = color.clone();
      const mat = new THREE.MeshLambertMaterial({ color: c });
      const mesh = new THREE.Mesh(geo, mat);

      if (def.pivot) {
        // 关节部件：mesh 相对 pivot 放置（原点在脚），旋转 pivot 实现肢体摆动
        const pivot = new THREE.Group();
        pivot.position.set(def.pivot[0], def.pivot[1], def.pivot[2]);
        mesh.position.set((minX + maxX) / 2 - def.pivot[0], (minY + maxY) / 2 - def.pivot[1], (minZ + maxZ) / 2 - def.pivot[2]);
        pivot.add(mesh);
        this.group.add(pivot);
        this.joints[def.role] = { pivot, mesh };
      } else {
        mesh.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
        this.group.add(mesh);
      }
      this.parts.push(mesh);
    }

    this.nameSprite = this._makeNameSprite(name);
    scene.add(this.nameSprite);
    scene.add(this.group);

    this.yaw = (pos && pos.yaw) || 0;
    this.pitch = (pos && pos.pitch) || 0;
    this._target = new THREE.Vector3(pos ? pos.x : 0, pos ? pos.y : 100, pos ? pos.z : 0);
    this._targetYaw = this.yaw;
    this._targetPitch = this.pitch;
    this.group.position.copy(this._target);
    this.nameSprite.position.set(this._target.x, this._target.y + 2.3, this._target.z);
    this.flying = false;
    this.inWater = false;
    this.onGround = false;
    // 行走动画状态：摆动相位 + 估算水平速度
    this._walkPhase = 0;
    this._speed = 0;
    this._lastTarget = this._target.clone();
    this._lastTargetTime = 0;
  }

  _makeNameSprite(name) {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 24;
    const ctx = cv.getContext('2d');
    ctx.font = 'bold 14px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.strokeText(name, 64, 12);
    ctx.fillStyle = playerColorCss(this.id);
    ctx.fillText(name, 64, 12);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(1.6, 0.3, 1);
    sp.renderOrder = 999;
    return sp;
  }

  // 高频状态（位置/朝向/姿态）
  applyState(s) {
    // 速度估算：目标位置变化量 / 本地到达时间差（网络 20Hz）
    const now = performance.now() / 1000;
    const dt = Math.max(0.01, Math.min(0.5, now - this._lastTargetTime));
    const dx = s.x - this._lastTarget.x;
    const dz = s.z - this._lastTarget.z;
    this._speed = Math.hypot(dx, dz) / dt;
    this._lastTarget.set(s.x, s.y, s.z);
    this._lastTargetTime = now;

    this._target.set(s.x, s.y, s.z);
    this._targetYaw = s.yaw || 0;
    this._targetPitch = s.pitch || 0;
    this.flying = !!s.flying;
    this.inWater = !!s.inWater;
    this.onGround = !!s.onGround;
  }

  applyFull(s) {
    if (s.mode) this.setMode(s.mode);
  }

  setMode(mode) { this.flying = mode === 'spectator'; }

  playHit() { this.hitFlash = 0.2; }

  playDeath() {
    this.dead = true;
    this.group.visible = false;
    if (this.nameSprite) this.nameSprite.visible = false;
  }

  respawn(s) {
    this.dead = false;
    this.group.visible = true;
    if (this.nameSprite) this.nameSprite.visible = true;
    this._target.set(s.x, s.y, s.z);
    this._targetYaw = this.yaw;
    this.group.position.copy(this._target);
  }

  update(dt) {
    // 受击红光（per-player 材质 emissive）
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      for (const m of this.parts) {
        m.material.emissive.setRGB(0.8, 0.05, 0.05);
        m.material.emissiveIntensity = Math.max(0, this.hitFlash / 0.2) * 0.8;
      }
    } else if (this.parts.length && this.parts[0].material.emissiveIntensity > 0) {
      for (const m of this.parts) { m.material.emissive.setRGB(0, 0, 0); m.material.emissiveIntensity = 0; }
    }

    // 远距瞬移：目标距当前过远时直接快照，避免"飞天滑行"（respawn/传送）
    if (this.group.position.distanceTo(this._target) > SNAP_DIST) {
      this.group.position.copy(this._target);
      this.yaw = this._targetYaw;
      this.pitch = this._targetPitch;
    } else {
      // 速度自适应插值：速度越快收敛越快（减少拖尾），静止时平滑停靠
      const k = 1 - Math.exp(-dt * (BASE_K + Math.min(30, this._speed * 1.5)));
      this.group.position.lerp(this._target, k);

      // yaw 最短角插值
      let d = this._targetYaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * k;
      this.pitch += (this._targetPitch - this.pitch) * k;
    }
    this.group.rotation.y = this.yaw;

    // 头部俯仰（绕颈部 pivot）
    if (this.joints.head) {
      this.joints.head.pivot.rotation.x = -this.pitch;
    }

    // 行走摆动动画：水平速度驱动腿/手臂相位，飞行/水中/静止不摆动
    const moving = this._speed > 0.6 && !this.flying;
    if (moving) {
      this._walkPhase += dt * (4 + Math.min(8, this._speed * 0.8));
    } else {
      this._walkPhase += dt * 2; // 缓慢归位
    }
    const swing = moving ? Math.min(0.9, this._speed * 0.09) : 0;
    const s = Math.sin(this._walkPhase) * swing;
    const s2 = Math.sin(this._walkPhase + Math.PI) * swing;
    if (this.joints.armL) this.joints.armL.pivot.rotation.x = s;
    if (this.joints.armR) this.joints.armR.pivot.rotation.x = s2;
    if (this.joints.legL) this.joints.legL.pivot.rotation.x = s2;
    if (this.joints.legR) this.joints.legR.pivot.rotation.x = s;

    // 昵称标签跟随
    if (this.nameSprite) {
      this.nameSprite.position.set(this.group.position.x, this.group.position.y + 2.3, this.group.position.z);
    }
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const m of this.parts) { m.geometry.dispose(); m.material.dispose(); }
    this.parts = [];
    this.joints = {};
    if (this.nameSprite) {
      if (this.nameSprite.parent) this.nameSprite.parent.remove(this.nameSprite);
      if (this.nameSprite.material) {
        if (this.nameSprite.material.map) this.nameSprite.material.map.dispose();
        this.nameSprite.material.dispose();
      }
      this.nameSprite = null;
    }
  }
}
