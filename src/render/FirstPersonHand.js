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
    this.miningPeriod = 0.3;      // 阶段11：挖掘挥动周期（秒）——由 Game 按方块硬度/工具速度写入
    this.bobPhase = 0;
    this._autoSwingCd = 0;        // 按住左键的自动挥动冷却
    this.bowDraw = null;          // Idea-2A：拉弓蓄力姿态（null=未拉弓；0..1=蓄力进度）
    this.visible = false;         // 默认隐藏（主菜单不显示第一人称手臂），Game.start 里 setVisible(true)
    this.group.visible = false;
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  // 弓蓄力姿态开关（Game 蓄力通道每帧写入；松手/取消传 null 复位）
  setBowDraw(v) {
    this.bowDraw = (v === null || v === undefined) ? null : Math.min(1, Math.max(0, v));
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
    // 阶段11：挥速随挖掘周期缩放（单次挥动时长 ≈ 周期，连续挖掘节奏贴合实际挖穿耗时）
    const period = Math.min(1.0, Math.max(0.2, this.miningPeriod));
    const swingRate = 3.2 * (0.3 / period);
    // 硬块（长周期）挥得更深更有力
    const swAmp = 0.85 + 0.35 * Math.min(1, Math.max(0, (period - 0.25) / 0.75));
    let swDown = 0, swRot = 0;
    if (this.swingT < 1) {
      this.swingT = Math.min(1, this.swingT + dt * swingRate);
      swDown = Math.sin(this.swingT * Math.PI) * swAmp;
      swRot = Math.sin(Math.min(1, this.swingT * 1.6) * Math.PI * 0.5) * 0.9 * swAmp;
    }
    // 按住左键（挖掘/攻击中）自动连续挥动（周期跟随 miningPeriod）
    const mining = this.game.controls.mouseLeft && !(this.game.inventoryScreen && this.game.inventoryScreen.visible);
    if (mining) {
      this._autoSwingCd -= dt;
      if (this._autoSwingCd <= 0) { this._autoSwingCd = period; this.swing(); }
    } else {
      this._autoSwingCd = 0;
    }

    // 拉弓蓄力（Idea-2A）：手持物向中心回拉 + 略抬，满蓄轻微颤动
    const draw = this.bowDraw == null ? 0 : this.bowDraw;
    const tremble = (this.bowDraw != null && this.bowDraw >= 1) ? Math.sin(this.bobPhase * 12) * 0.0022 : 0;

    this.group.position.set(
      this.basePos.x + bobX - draw * 0.12,
      this.basePos.y + bobY - swDown * 0.10 + draw * 0.04 + tremble,
      this.basePos.z - swDown * 0.16 + draw * 0.14
    );
    this.group.rotation.set(-swRot * 0.85 - draw * 0.15, -0.35 + swRot * 0.3 + draw * 0.25, 0.05);
  }
}
