// PortalOverlay.js -- 传送门站入屏幕特效（纯表现层）
// 只读 Game.updatePortals 的判定状态（kind + 计时进度），不干预穿越三件套
//（_portalTimer/_portalArmed/_portalCooldown）逻辑。配色按门种类：
// 下界=紫、天域=金白、末地门/折跃门=暗紫星点；传送瞬间白闪。
export class PortalOverlay {
  constructor() {
    // 一次性注入 CSS 动画（多实例/多存档重复挂载安全：同 id 只挂一次）
    if (!document.getElementById('portal-overlay-style')) {
      const style = document.createElement('style');
      style.id = 'portal-overlay-style';
      style.textContent = `
        @keyframes portal-swirl-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes portal-flash-fade { 0% { opacity: 0.9; } 100% { opacity: 0; } }
      `;
      document.head.appendChild(style);
    }

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 15; opacity: 0;
      transition: opacity 0.18s ease-out; overflow: hidden;
    `;

    // 漩涡层：conic-gradient 旋转（叠加 screen 混合，中心亮外缘淡）
    this.swirl = document.createElement('div');
    this.swirl.style.cssText = `
      position: absolute; top: 50%; left: 50%; width: 160vmax; height: 160vmax;
      margin: -80vmax 0 0 -80vmax; opacity: 0;
      background: repeating-conic-gradient(from 0deg,
        rgba(255,255,255,0.10) 0deg 18deg, rgba(255,255,255,0.02) 18deg 36deg);
      mix-blend-mode: screen;
      animation: portal-swirl-spin 4s linear infinite;
      transition: opacity 0.18s ease-out;
    `;
    this.el.appendChild(this.swirl);

    // vignette 层：径向渐变（颜色随门种类）
    this.vignette = document.createElement('div');
    this.vignette.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      background: radial-gradient(ellipse at center,
        rgba(0,0,0,0) 32%, rgba(90,20,160,0.35) 75%, rgba(60,10,120,0.72) 100%);
    `;
    this.el.appendChild(this.vignette);

    // 星点层：末地/折跃门专属（确定性伪随机撒点）
    this.stars = document.createElement('div');
    this.stars.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0;
      transition: opacity 0.18s ease-out;
    `;
    {
      let dots = '';
      for (let i = 0; i < 42; i++) {
        const x = (Math.sin(i * 127.1) * 0.5 + 0.5) * 100;
        const y = (Math.sin(i * 311.7) * 0.5 + 0.5) * 100;
        const s = 2 + (i % 3);
        dots += `<div style="position:absolute;left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;width:${s}px;height:${s}px;border-radius:50%;background:rgba(230,200,255,0.8);"></div>`;
      }
      this.stars.innerHTML = dots;
    }
    this.el.appendChild(this.stars);

    // 白闪层：传送触发瞬间（独立于主层 opacity，一次性动画）
    this.flashEl = document.createElement('div');
    this.flashEl.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 16; opacity: 0; background: #fff;
    `;
    this.flashEl.addEventListener('animationend', () => {
      this.flashEl.style.animation = '';
      this.flashEl.style.opacity = '0';
    });

    document.body.appendChild(this.el);
    document.body.appendChild(this.flashEl);
    this._kind = null;
  }

  // 每帧喂状态：kind=null 表示不在门内（渐隐）；progress 0-1 为站门计时进度
  update(kind, progress) {
    if (kind !== this._kind) {
      this._kind = kind;
      this._applyPalette(kind);
    }
    const on = !!kind && progress > 0.02;
    this.el.style.opacity = on ? String(Math.min(1, 0.25 + progress * 0.75)) : '0';
    this.swirl.style.opacity = on ? String(Math.min(0.55, progress * 0.55)) : '0';
    this.stars.style.opacity = (kind === 'end' || kind === 'gateway') && on
      ? String(Math.min(0.8, progress * 0.9)) : '0';
  }

  _applyPalette(kind) {
    const palettes = {
      nether: ['rgba(0,0,0,0) 32%', 'rgba(120,30,180,0.38) 75%', 'rgba(80,10,140,0.74) 100%'],
      aether: ['rgba(0,0,0,0) 30%', 'rgba(255,226,150,0.30) 75%', 'rgba(210,170,90,0.60) 100%'],
      end: ['rgba(0,0,0,0) 30%', 'rgba(40,10,70,0.55) 75%', 'rgba(16,4,32,0.85) 100%'],
      gateway: ['rgba(0,0,0,0) 30%', 'rgba(60,20,100,0.55) 75%', 'rgba(24,6,48,0.85) 100%'],
    };
    const p = palettes[kind] || palettes.nether;
    this.vignette.style.background =
      `radial-gradient(ellipse at center, ${p[0]}, ${p[1]}, ${p[2]})`;
  }

  // 传送触发瞬间白闪（_usePortal / _useGatewayPortal 调用）
  flash() {
    this.flashEl.style.animation = '';
    void this.flashEl.offsetWidth; // 重启动画
    this.flashEl.style.animation = 'portal-flash-fade 0.3s ease-out forwards';
  }

  dispose() {
    this.el.remove();
    this.flashEl.remove();
  }
}
