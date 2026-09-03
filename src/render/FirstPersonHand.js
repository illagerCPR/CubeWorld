// FirstPersonHand.js -- 第一人称手持物渲染（阶段10）
// 相机子节点：右下角基座 + 空手肤色手臂 + 手持物挂点；走路 bob + 挖掘/放置挥动动画。
import * as THREE from 'three';
import { buildHeldItemTemplate } from './HeldItemMesh.js';

export class FirstPersonHand {
  constructor(game) {
    this.game = game;
    this.camera = game.renderer.camera;
    // camera 必须在场景中其子节点才会被渲染（此前场景图不含 camera）
    if (!this.camera.parent) game.renderer.scene.add(this.camera);

    this.group = new THREE.Group();
    this.basePos = new THREE.Vector3(0.42, -0.38, -0.55); // 右下角
    this.group.position.copy(this.basePos);
    this.group.rotation.set(0, -0.35, 0.05);
    this.camera.add(this.group);

    // 空手手臂（肤色小盒，从右下伸向前方）
    this.armMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.13, 0.48),
      new THREE.MeshLambertMaterial({ color: 0xe0b080 })
    );
    this.armMesh.position.set(0, -0.06, 0.30);
    this.armMesh.rotation.x = 0.55;
    this.group.add(this.armMesh);

    // 手持物挂点（物品斜持姿态）
    this.itemGroup = new THREE.Group();
    this.itemGroup.position.set(0.02, 0.10, -0.10);
    this.itemGroup.rotation.set(0.15, Math.PI * 0.14, 0.1);
    this.group.add(this.itemGroup);

    this.currentName = undefined; // undefined=未初始化；null=空手
    this._buildSeq = 0;           // 异步构建序号（防旧结果覆盖新选择）
    this.swingT = 1;              // 挥动进度 0..1（1=结束）
    this.bobPhase = 0;
    this._autoSwingCd = 0;        // 按住左键的自动挥动冷却
    this.visible = false;         // 默认隐藏（主菜单不显示第一人称手臂），Game.start 里 setVisible(true)
    this.group.visible = false;
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  // 切换手持物（异步构建；重复调用以最后一次为准）
  async setItem(name) {
    if (name === this.currentName) return;
    this.currentName = name;
    const seq = ++this._buildSeq;
    this.itemGroup.clear(); // 模板几何/材质来自共享缓存，clone 不持有独立资源，无需 dispose
    if (!name) return;
    const tpl = await buildHeldItemTemplate(name);
    if (seq !== this._buildSeq) return; // 期间又切换了物品，丢弃旧结果
    if (tpl) {
      const m = tpl.clone();
      m.scale.set(0.30, 0.30, 0.30);
      this.itemGroup.add(m);
    }
  }

  // 触发一次挥动（放置/食用/命中等瞬时机点调用；按住左键的连续挖掘由 update 自动驱动）
  swing() {
    if (this.swingT >= 1) this.swingT = 0;
  }

  update(dt, moving, sprinting) {
    if (!this.visible) return;
    // 走路 bob（移动时幅度更大、频率更高）；视频设置可关
    const bobOn = !(this.game.settings && this.game.settings.viewBobbing === false);
    this.bobPhase += dt * (moving ? (sprinting ? 11 : 8) : 2.5);
    const amp = bobOn ? (moving ? 0.016 : 0.004) : 0;
    const bobY = Math.sin(this.bobPhase * 2) * amp;
    const bobX = Math.cos(this.bobPhase) * amp * 1.4;

    // 挥动动画：swingT 0→1，正弦包络
    let swDown = 0, swRot = 0;
    if (this.swingT < 1) {
      this.swingT = Math.min(1, this.swingT + dt * 3.2);
      swDown = Math.sin(this.swingT * Math.PI);
      swRot = Math.sin(Math.min(1, this.swingT * 1.6) * Math.PI * 0.5) * 0.9;
    }
    // 按住左键（挖掘/攻击中）自动连续挥动
    const mining = this.game.controls.mouseLeft && !(this.game.inventoryScreen && this.game.inventoryScreen.visible);
    if (mining) {
      this._autoSwingCd -= dt;
      if (this._autoSwingCd <= 0) { this._autoSwingCd = 0.3; this.swing(); }
    } else {
      this._autoSwingCd = 0;
    }

    this.group.position.set(this.basePos.x + bobX, this.basePos.y + bobY - swDown * 0.10, this.basePos.z - swDown * 0.16);
    this.group.rotation.set(-swRot * 0.85, -0.35 + swRot * 0.3, 0.05);
  }
}
