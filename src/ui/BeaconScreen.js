// BeaconScreen.js -- 信标界面（Idea-2D-③：右键信标打开，选效果周期给玩家 buff）
// 金字塔等级决定效果强度与作用范围；无完整基座只提示不放效果。
// 生命周期与 ChestScreen 同款：show 设 controls.enabled=false + 退指针锁，hide 恢复。
export class BeaconScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.pos = null;       // 信标方块坐标 {x,y,z}
    this.power = 0;        // 金字塔等级（1-4，0=无基座）
    this.selected = null;  // 当前选中的效果名

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; z-index: 30;
      background: rgba(0,0,0,0.5); align-items: center; justify-content: center;
    `;
    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      background: #2a2a3a; border: 4px solid #555; padding: 16px 20px;
      box-shadow: 0 0 0 2px #000; font-family: 'Segoe UI', sans-serif;
      user-select: none; width: 420px; color: #fff; text-align: center;
    `;
    this.el.appendChild(this.panel);
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });

    // 效果按钮走事件委托（render() 重建 innerHTML 无需重绑）
    this.panel.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!btn) return;
      if (btn.dataset.effect) {
        this.selected = btn.dataset.effect;
        this.render();
        return;
      }
      if (btn.id === 'beacon-confirm' && this.selected && this.pos) {
        this.game.setBeaconEffect(this.pos.x, this.pos.y, this.pos.z, this.selected, Math.min(2, Math.max(1, this.power)));
        this.hide();
        return;
      }
      if (btn.id === 'beacon-cancel') this.hide();
    });
  }

  show(x, y, z) {
    if (!this.game.world) return;
    this.pos = { x, y, z };
    this.power = this.game._getBeaconPower(x, y, z);
    this.selected = null;
    this.visible = true;
    this.el.style.display = 'flex';
    this.render();
    if (this.game.controls) {
      this.game.controls.enabled = false;
      this.game.controls.mouseLeft = false;
      this.game.controls.mouseRight = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
    if (this.game.controls) this.game.controls.enabled = true;
    this.pos = null;
    this.selected = null;
  }

  dispose() { this.el.remove(); }

  render() {
    const EFFECTS = [
      ['speed', '速度', '移速 +20%/级'],
      ['haste', '急迫', '挖掘 +30%/级'],
      ['resistance', '抗性', '受伤 -20%/级'],
      ['jump_boost', '跳跃', '跳高 +25%/级'],
      ['strength', '力量', '近战 +2/级'],
    ];
    const btns = EFFECTS.map(([name, label, desc]) => `
      <button data-effect="${name}" style="
        display:block; width: 100%; margin-bottom: 8px; padding: 9px 12px; text-align: left;
        background: ${this.selected === name ? '#3d5a3d' : '#3a3a4c'};
        border: 2px solid ${this.selected === name ? '#8f8' : '#555'};
        color: #fff; cursor: pointer; font-size: 14px;">
        <b>${label}</b> <span style="font-size: 12px; color: #aab;">${desc}</span>
      </button>`).join('');
    this.panel.innerHTML = `
      <div style="font-size: 19px; font-weight: bold; margin-bottom: 4px;">✦ 信标</div>
      <div style="font-size: 12px; color: #ffb; margin-bottom: 12px;">${
        this.power > 0
          ? `金字塔 ${this.power} 级 · 效果等级 ${Math.min(2, this.power)} · 范围 ${this.power * 10} 格`
          : '需要完整金字塔基座（铁/金/钻石/绿宝石块，1~4 层）'
      }</div>
      ${this.power > 0 ? btns : ''}
      <div style="display:flex; gap: 10px; margin-top: 10px; justify-content: center;">
        ${this.power > 0 ? `<button id="beacon-confirm" style="padding: 8px 22px; background:#3d5a3d; border:2px solid #8f8; color:#fff; cursor:pointer;">确认激活</button>` : ''}
        <button id="beacon-cancel" style="padding: 8px 22px; background:#4a3a3a; border:2px solid #a77; color:#fff; cursor:pointer;">关闭</button>
      </div>
    `;
  }
}
