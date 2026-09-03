// Hud.js -- 生存模式 HUD：血量/饥饿/经验
export class Hud {
  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; bottom: 86px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 0; z-index: 10; pointer-events: none;
    `;
    this.hearts = document.createElement('div');
    this.hearts.style.cssText = 'display: flex; gap: 1px; margin-right: 80px;';
    this.foods = document.createElement('div');
    this.foods.style.cssText = 'display: flex; gap: 1px;';
    this.el.appendChild(this.hearts);
    this.el.appendChild(this.foods);
    
    this.xpBar = document.createElement('div');
    this.xpBar.style.cssText = `
      position: absolute; bottom: 72px; left: 50%; transform: translateX(-50%);
      width: 360px; height: 8px; background: rgba(0,0,0,0.5); border: 1px solid #333;
      z-index: 9; display: none;
    `;
    this.xpFill = document.createElement('div');
    this.xpFill.style.cssText = 'width: 0%; height: 100%; background: #80ff20;';
    this.xpBar.appendChild(this.xpFill);
    this.xpText = document.createElement('div');
    this.xpText.style.cssText = 'position: absolute; left: 50%; top: -16px; transform: translateX(-50%); color: #80ff20; font-size: 12px; text-shadow: 1px 1px 0 #000;';
    this.xpBar.appendChild(this.xpText);
    
    // 氧气泡（水下显示）
    this.airBar = document.createElement('div');
    this.airBar.style.cssText = `
      position: absolute; bottom: 104px; left: 50%; transform: translateX(-50%);
      display: none; gap: 1px; z-index: 10; pointer-events: none;
    `;
    document.body.appendChild(this.airBar);
    
    document.body.appendChild(this.el);
    document.body.appendChild(this.xpBar);
    
    this.crosshair = document.createElement('div');
    this.crosshair.style.cssText = `
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 20px; height: 20px; z-index: 10; pointer-events: none; display: none;
      background: linear-gradient(to right, transparent 45%, #fff 45%, #fff 55%, transparent 55%),
                  linear-gradient(to bottom, transparent 45%, #fff 45%, #fff 55%, transparent 55%);
      mix-blend-mode: difference;
    `;
    document.body.appendChild(this.crosshair);

    // 受击红屏 vignette（玩家被攻击 / 摔落时短暂闪一下）
    this.damageOverlay = document.createElement('div');
    this.damageOverlay.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 50; opacity: 0;
      background: radial-gradient(ellipse at center,
        rgba(180, 0, 0, 0) 30%,
        rgba(180, 0, 0, 0.35) 75%,
        rgba(140, 0, 0, 0.7) 100%);
      transition: opacity 0.5s ease-out;
    `;
    document.body.appendChild(this.damageOverlay);
    this.damageTimerId = 0;

    // 水下屏幕滤镜（全屏蓝色薄纱，透明度过渡）
    this.underwaterOverlay = document.createElement('div');
    this.underwaterOverlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none; z-index: 5; opacity: 0;
      background: radial-gradient(ellipse at center,
        rgba(20, 70, 130, 0.28) 0%,
        rgba(12, 45, 95, 0.45) 100%);
      transition: opacity 0.3s ease-out;
    `;
    document.body.appendChild(this.underwaterOverlay);

    // 初始全隐藏（主菜单不显示准星/血条）；进游戏后 update()/updateVisibility() 按模式设置
    this.el.style.display = 'none';
    this.xpBar.style.display = 'none';
    this.crosshair.style.display = 'none';
  }

  // 水下滤镜开关（Game.update 按 inWater 每帧调用，on=false 时淡出）
  setUnderwater(on) {
    this.underwaterOverlay.style.opacity = on ? '1' : '0';
  }

  heartSvg(filled, half = false) {
    const color = filled ? '#ff3030' : '#3a0a0a';
    const halfColor = half ? '#7a1818' : color;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" shape-rendering="crispEdges">
      <path d="M2 3h3v1h1v1h1v1h1v1h1V4h1V3h1V2h3v4h-1v1h-1v1h-1v1h-1v1h-1v1h-1v1H7v-1H6v-1H5v-1H4v-1H3V8H2V3z" fill="${color}"/>
      ${half ? `<rect x="8" y="2" width="6" height="12" fill="${color}"/>` : ''}
    </svg>`;
  }

  foodSvg(filled, half = false) {
    const color = filled ? '#a06020' : '#2a1a0a';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" shape-rendering="crispEdges">
      <path d="M3 4h2v1h1v1h1v1h1v1h1v1h1v1h1v1h1v1h-2v1h-2v-1H7v-1H6v-1H5v-1H4v-1H3V4z" fill="${color}"/>
      ${half ? `<rect x="8" y="3" width="6" height="10" fill="${color}"/>` : ''}
    </svg>`;
  }

  update(player) {
    if (player.gamemode === 'spectator' || player.gamemode === 'creative') {
      this.el.style.display = 'none';
      this.xpBar.style.display = 'none';
      this.crosshair.style.display = player.gamemode === 'spectator' ? 'none' : 'block';
      return;
    }
    this.el.style.display = 'flex';
    this.crosshair.style.display = 'block';
    
    // 血量（10 颗心，每颗 2 点）
    this.hearts.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const v = player.health - i * 2;
      const filled = v >= 2;
      const half = v === 1;
      const img = document.createElement('div');
      img.innerHTML = this.heartSvg(filled, half);
      img.style.cssText = 'width: 16px; height: 16px;';
      this.hearts.appendChild(img);
    }
    
    // 饥饿
    this.foods.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const v = player.food - i * 2;
      const filled = v >= 2;
      const half = v === 1;
      const img = document.createElement('div');
      img.innerHTML = this.foodSvg(filled, half);
      img.style.cssText = 'width: 16px; height: 16px;';
      this.foods.appendChild(img);
    }
    
    // 经验
    this.xpBar.style.display = 'block';
    const need = player.xpLevel * 10 + 10;
    this.xpFill.style.width = `${(player.xp / need) * 100}%`;
    this.xpText.textContent = player.xpLevel;
    
    // 氧气（水下且未满时显示）
    if (player.inWater && player.airTicks < 300) {
      this.airBar.style.display = 'flex';
      this.airBar.innerHTML = '';
      const bubbles = Math.ceil((player.airTicks / 300) * 10);
      for (let i = 0; i < bubbles; i++) {
        const b = document.createElement('div');
        b.style.cssText = 'width: 16px; height: 16px;';
        b.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" shape-rendering="crispEdges"><path d="M5 3h6v1h1v1h1v6h-1v1h-1v1H5v-1H4v-1H3V5h1V4h1V3z" fill="#9ad0ff"/></svg>`;
        this.airBar.appendChild(b);
      }
    } else {
      this.airBar.style.display = 'none';
    }
  }

  updateVisibility(mode) {
    if (mode === 'creative') {
      this.el.style.display = 'none';
      this.xpBar.style.display = 'none';
      this.crosshair.style.display = 'block';
    } else if (mode === 'spectator') {
      this.el.style.display = 'none';
      this.xpBar.style.display = 'none';
      this.crosshair.style.display = 'none';
    } else {
      this.el.style.display = 'flex';
      this.xpBar.style.display = 'block';
      this.crosshair.style.display = 'block';
    }
  }

  // 受击红屏：瞬间红色 vignette → 0.5s 内淡出。
  // damage 越高闪得越亮（封顶 0.9），低伤害轻微闪。
  flashDamage(damage = 1) {
    if (!this.damageOverlay) return;
    if (this.damageTimerId) {
      clearTimeout(this.damageTimerId);
      this.damageTimerId = 0;
    }
    const intensity = Math.min(0.9, 0.3 + damage * 0.04);
    this.damageOverlay.style.transition = 'none';
    this.damageOverlay.style.opacity = String(intensity);
    const self = this;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!self.damageOverlay) return;
        self.damageOverlay.style.transition = 'opacity 0.5s ease-out';
        self.damageOverlay.style.opacity = '0';
      });
    });
  }
}
