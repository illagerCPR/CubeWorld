// LocalPlayerModel.js -- 本地玩家第三人称模型（Build 20 ⑤）
// F5 视角切换到第三人称时渲染本地玩家（关节方块人，布局与 RemotePlayer 同源）：
// 直接驱动（零插值延迟），行走摆臂 + 挖掘挥臂 + 头部俯仰 + 右手持物。
// 颜色：联机用自己的玩家 id（与远端看到的一致），单机固定 id=1。
import * as THREE from 'three';
import { PARTS } from './RemotePlayer.js';
import { playerColorHue } from '../net/playerColor.js';
import { buildHeldItemTemplate } from '../render/HeldItemMesh.js';

export class LocalPlayerModel {
  constructor(scene, game) {
    this.game = game;
    this.scene = scene;
    const id = (game.net && game.net.selfId != null) ? game.net.selfId : 1;
    const color = new THREE.Color().setHSL(playerColorHue(id) / 360, 0.6, 0.45);

    this.group = new THREE.Group();
    this.parts = [];
    this.joints = {};
    for (const def of PARTS) {
      const [minX, minY, minZ, maxX, maxY, maxZ] = def.box;
      const geo = new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ);
      let c;
      if (def.role === 'head') c = 0xe0b080;
      else if (def.role === 'body') c = color;
      else if (def.role === 'leg') c = color.clone().multiplyScalar(0.75);
      else c = color.clone();
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: c }));
      if (def.pivot) {
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
    this.group.visible = false; // 第一人称默认隐藏
    scene.add(this.group);

    // 动画状态（与 RemotePlayer 同款相位逻辑，直读本地玩家速度）
    this._walkPhase = 0;
    this._minePhase = 0;
    this._mineAmp = 0;
    // 手持物（右臂挂 3D 模型，随物品切换异步重建）
    this.heldItem = undefined; // undefined=未初始化；null=空手
    this.heldGroup = null;
    this._heldSeq = 0;
  }

  // Game.update 每帧调用；visible 由 Game 按视角模式/观战/死亡决定
  update(dt, player, visible, mining) {
    this.group.visible = !!visible;
    if (!visible) return;
    this.group.position.copy(player.position);
    this.group.rotation.y = player.yaw;
    if (this.joints.head) this.joints.head.pivot.rotation.x = -player.pitch;

    // 行走摆臂：水平速度驱动（飞行/静止缓慢归位）；挖掘挥臂叠加在右臂上
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    const moving = speed > 0.6 && !player.flying;
    this._walkPhase += dt * (moving ? 4 + Math.min(8, speed * 0.8) : 2);
    const swing = moving ? Math.min(0.9, speed * 0.09) : 0;
    const s = Math.sin(this._walkPhase) * swing;
    const s2 = Math.sin(this._walkPhase + Math.PI) * swing;
    if (this.joints.armL) this.joints.armL.pivot.rotation.x = s;
    const mineTarget = (mining && !player.flying) ? 1 : 0;
    this._mineAmp += (mineTarget - this._mineAmp) * Math.min(1, dt * 10);
    if (this._mineAmp > 0.01) {
      this._minePhase += dt * 21;
      if (this._minePhase > Math.PI * 2) this._minePhase -= Math.PI * 2;
    }
    const mineSw = Math.sin(this._minePhase) * 0.8 * this._mineAmp;
    if (this.joints.armR) this.joints.armR.pivot.rotation.x = s2 - mineSw;
    if (this.joints.legL) this.joints.legL.pivot.rotation.x = s2;
    if (this.joints.legR) this.joints.legR.pivot.rotation.x = s;

    // 手持物同步（物品变化时重建）
    const sel = this.game.inventory ? this.game.inventory.getSelected() : null;
    const name = sel ? sel.name : null;
    if (name !== this.heldItem) this._setHeld(name);
  }

  // 与 RemotePlayer._setHeld 同款：右臂末端挂 3D 模型（共享缓存构建）
  async _setHeld(name) {
    this.heldItem = name || null;
    const seq = ++this._heldSeq;
    if (this.heldGroup) {
      if (this.heldGroup.parent) this.heldGroup.parent.remove(this.heldGroup);
      this.heldGroup = null;
    }
    if (!this.heldItem) return;
    const tpl = await buildHeldItemTemplate(this.heldItem);
    if (seq !== this._heldSeq) return;
    if (!tpl) return;
    const g = tpl.clone();
    g.scale.set(0.26, 0.26, 0.26);
    g.position.set(0.10, -0.88, 0.22);
    g.rotation.set(-0.5, 0.35, 0.15);
    const arm = this.joints.armR;
    if (arm) { arm.pivot.add(g); this.heldGroup = g; }
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const m of this.parts) { m.geometry.dispose(); m.material.dispose(); }
    this.parts = [];
    this.joints = {};
    if (this.heldGroup) {
      if (this.heldGroup.parent) this.heldGroup.parent.remove(this.heldGroup);
      this.heldGroup = null;
    }
  }
}
