// RemotePlayer.js -- 远端玩家实体：方块人模型 + 位置插值 + 昵称标签
// 阶段 3：昵称按玩家 id 着色；阶段 4：插值优化（关节模型 + 行走动画 + 头部俯仰 + 远距瞬移快照）
// 阶段 5：时间戳对齐插值——缓冲服务器带 ts 的状态样本，按"渲染时刻=本地时间+时钟偏移-延迟"线性插值，消除指数平滑的拖影
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

// 远距瞬移阈值：插值目标距当前渲染位置超过该值视为传送，直接快照并丢弃旧样本
const SNAP_DIST = 4;

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
    // 阶段5 时间戳插值：状态样本缓冲 + 时钟偏移估计 + 固定插值延迟
    this._buffer = [];        // {ts, x,y,z,yaw,pitch,flying,inWater,onGround}，按 ts 升序
    this._clockOffset = 0;    // 服务器时钟 - 本地时钟（平滑估计，秒）
    this._interpDelay = 0.12; // 插值延迟（秒）：始终回放"0.12s 前"的状态，平滑网络抖动
    // 行走动画状态：摆动相位 + 估算水平速度（由缓冲段位移算出）
    this._walkPhase = 0;
    this._speed = 0;
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

  // 高频状态（位置/朝向/姿态）：压入带时间戳的样本缓冲（不直接驱动位置，由 update 插值回放）
  applyState(s) {
    const now = performance.now() / 1000;
    const hasTs = typeof s.ts === 'number' && s.ts > 0;
    const ts = hasTs ? s.ts / 1000 : now; // 服务器 ts 单位毫秒；无 ts（旧服务器）退化为本地到达时间
    if (hasTs) {
      // 平滑估计时钟偏移：offset = 服务器时钟 - 本地时钟
      const off = ts - now;
      if (this._clockOffset === 0) this._clockOffset = off;
      else this._clockOffset = this._clockOffset * 0.9 + off * 0.1;
    }
    this._buffer.push({
      ts,
      x: s.x, y: s.y, z: s.z,
      yaw: s.yaw || 0, pitch: s.pitch || 0,
      flying: !!s.flying, inWater: !!s.inWater, onGround: !!s.onGround,
    });
    if (this._buffer.length > 40) this._buffer.shift();
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
    this._buffer.length = 0; // 重生=瞬移，丢弃旧样本避免轨迹回拉
    this._target.set(s.x, s.y, s.z);
    this._targetYaw = s.yaw || this.yaw;
    this._targetPitch = s.pitch || this.pitch;
    this.group.position.copy(this._target);
    this.yaw = this._targetYaw;
    this.pitch = this._targetPitch;
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

    // 阶段5 时间戳对齐插值：从缓冲找包围"渲染时刻"的两个样本，线性插值出目标位姿
    const buf = this._buffer;
    if (buf.length) {
      const now = performance.now() / 1000;
      const renderTime = now + this._clockOffset - this._interpDelay;
      // 裁剪过旧的样本（至少保留两个作边界），避免缓冲无限增长
      while (buf.length > 2 && buf[1].ts < renderTime - 0.5) buf.shift();
      let a = buf[0], b = buf[buf.length - 1];
      if (buf.length >= 2) {
        // 找 renderTime 落在 [a.ts, b.ts] 的那一对；i 最多到 len-2，保证 b 恒有定义
        // （renderTime 晚于最新样本时停在最后两样本，f 被钳到 1 = 停在最新位置）
        let i = 0;
        const maxI = buf.length - 2;
        while (i < maxI && buf[i + 1].ts < renderTime) i++;
        a = buf[i]; b = buf[i + 1];
      }
      const span = b.ts - a.ts;
      let f = span > 0 ? (renderTime - a.ts) / span : 0;
      f = Math.max(0, Math.min(1, f));
      this._target.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
      // yaw 最短角插值
      let dy = b.yaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this._targetYaw = a.yaw + dy * f;
      this._targetPitch = a.pitch + (b.pitch - a.pitch) * f;
      // 移动速度（当前段位移/时间）驱动走路动画；缓冲耗尽时自然归 0（静止停靠）
      this._speed = span > 0.001 ? Math.hypot(b.x - a.x, b.z - a.z) / span : 0;
      this.flying = b.flying; this.inWater = b.inWater; this.onGround = b.onGround;
    }

    // 落位：传送（respawn/远距移动）直接快照并丢弃旧样本，否则置于插值目标
    if (this.group.position.distanceTo(this._target) > SNAP_DIST) {
      this._buffer.length = 0;
    }
    this.group.position.copy(this._target);
    this.yaw = this._targetYaw;
    this.pitch = this._targetPitch;
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
