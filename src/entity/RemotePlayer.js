// RemotePlayer.js -- 远端玩家实体：方块人模型 + 位置插值 + 昵称标签（阶段 3：昵称按玩家 id 着色）
import * as THREE from 'three';
import { playerColorHue, playerColorCss } from '../net/playerColor.js';

// 简化方块人部件（局部坐标原点在脚 y=0，单位：格）
const PARTS = [
  { box: [-0.25, 1.5, -0.25, 0.25, 2.0, 0.25], role: 'head' },
  { box: [-0.3, 0.6, -0.2, 0.3, 1.5, 0.2], role: 'body' },
  { box: [-0.5, 0.6, -0.15, -0.3, 1.45, 0.15], role: 'arm' },
  { box: [0.3, 0.6, -0.15, 0.5, 1.45, 0.15], role: 'arm' },
  { box: [-0.28, 0, -0.15, -0.02, 0.6, 0.15], role: 'leg' },
  { box: [0.02, 0, -0.15, 0.28, 0.6, 0.15], role: 'leg' },
];

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
    this.parts = [];
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
      mesh.position.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      this.group.add(mesh);
      this.parts.push(mesh);
    }

    this.nameSprite = this._makeNameSprite(name);
    scene.add(this.nameSprite);
    scene.add(this.group);

    this.yaw = (pos && pos.yaw) || 0;
    this._target = new THREE.Vector3(pos ? pos.x : 0, pos ? pos.y : 100, pos ? pos.z : 0);
    this._targetYaw = this.yaw;
    this.group.position.copy(this._target);
    this.nameSprite.position.set(this._target.x, this._target.y + 2.3, this._target.z);
    this.flying = false;
    this.inWater = false;
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
    this._target.set(s.x, s.y, s.z);
    this._targetYaw = s.yaw || 0;
    this.flying = !!s.flying;
    this.inWater = !!s.inWater;
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

    // 位置指数插值（平滑远端移动）
    const k = 1 - Math.exp(-dt * 12);
    this.group.position.lerp(this._target, k);

    // yaw 最短角插值
    let d = this._targetYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * k;
    this.group.rotation.y = this.yaw;

    // 昵称标签跟随
    if (this.nameSprite) {
      this.nameSprite.position.set(this.group.position.x, this.group.position.y + 2.3, this.group.position.z);
    }
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const m of this.parts) { m.geometry.dispose(); m.material.dispose(); }
    this.parts = [];
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
