// BossBar.js -- 末影龙 Boss 血条（屏幕顶部紫色条，跟随龙血量实时刷新）
// 新建型 UI 子系统：Game.start 创建、_disposeWorld 移除（与 MobManager 生命周期一致）
export class BossBar {
  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
      width: min(460px, 60vw); z-index: 20; pointer-events: none; display: none;
    `;
    this.label = document.createElement('div');
    this.label.style.cssText = `
      text-align: center; color: #d9a8ff; font-size: 13px; font-weight: bold;
      text-shadow: 1px 1px 0 #000; margin-bottom: 3px; letter-spacing: 2px;
    `;
    this.label.textContent = '末影龙';
    this.track = document.createElement('div');
    this.track.style.cssText = `
      width: 100%; height: 10px; background: rgba(10, 6, 18, 0.72);
      border: 1px solid #4a2a6a; border-radius: 2px; overflow: hidden;
    `;
    this.fill = document.createElement('div');
    this.fill.style.cssText = `
      width: 100%; height: 100%;
      background: linear-gradient(to bottom, #c86af5 0%, #9a3ad4 55%, #6f1fa8 100%);
    `;
    this.track.appendChild(this.fill);
    this.el.appendChild(this.label);
    this.el.appendChild(this.track);
    document.body.appendChild(this.el);
    this._shown = false;
  }

  // 每帧调用：mob 为当前存活的末影龙（无则隐藏）
  update(mob) {
    const show = !!(mob && !mob.dead && !mob.dyingAnim);
    if (show !== this._shown) {
      this._shown = show;
      this.el.style.display = show ? 'block' : 'none';
    }
    if (show) {
      const ratio = Math.max(0, Math.min(1, mob.health / mob.maxHealth));
      this.fill.style.width = (ratio * 100).toFixed(1) + '%';
    }
  }

  dispose() {
    this.el.remove();
  }
}
