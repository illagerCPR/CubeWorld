// SleepOverlay.js -- 睡眠黑屏过渡（纯表现层）
// 渐暗 → 全黑瞬间回调（跳时间/回血在 Game 侧做）→ 渐亮。
// 双层 RAF 启动 transition（display 切换后同帧写 opacity 不会过渡——Hud.flashDamage 同款教训）。
export class SleepOverlay {
  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: #000; pointer-events: none; z-index: 40;
      opacity: 0; display: none; transition: opacity 0.9s ease-in;
    `;
    document.body.appendChild(this.el);
    this._timers = [];
    this._raf = 0;
  }

  // show(onBlack)：渐暗 0.9s → 全黑时调 onBlack（安全跳时间）→ 渐亮 1.4s → 隐藏
  show(onBlack) {
    this.hide(true); // 取消进行中的过渡，防叠加定时器
    this.el.style.transition = 'opacity 0.9s ease-in';
    this.el.style.display = 'block';
    this._raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => { this.el.style.opacity = '1'; });
    });
    this._timers.push(setTimeout(() => {
      if (onBlack) onBlack();
      this.el.style.transition = 'opacity 1.4s ease-out';
      this.el.style.opacity = '0';
    }, 950));
    this._timers.push(setTimeout(() => {
      this.el.style.display = 'none';
    }, 2450));
  }

  hide(immediate = false) {
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    if (this._raf) cancelAnimationFrame(this._raf);
    if (immediate) {
      this.el.style.display = 'none';
      this.el.style.opacity = '0';
    }
  }

  dispose() {
    this.hide(true);
    this.el.remove();
  }
}
