// VideoSettings.js -- 视频设置面板（ESC 暂停菜单与主菜单共用）
// 原版 MC 选项页风格：整屏半透明遮罩 + 居中列按钮（点击循环取值），改动即存 localStorage 并实时生效。
// 平滑光照开关切换时对所有区块 markAllDirty，网格在后续帧内分批重建。
import { loadSettings, saveSettings, applySettings, brightnessToMinLight } from '../core/Settings.js';

const PARTICLE_LABELS = { all: '全部', decreased: '减少', minimal: '最少' };
const PARTICLE_ORDER = ['all', 'decreased', 'minimal'];

export class VideoSettings {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.onHide = null; // 主界面注入：ESC/完成后回调（暂停菜单返回子视图用）

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; flex-direction: column;
      align-items: center; justify-content: center; z-index: 60;
      background: rgba(0,0,0,0.65); color: #fff;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;
    document.body.appendChild(this.el);

    // ESC 关闭并交还父界面（capture 阶段拦截，避免同时触发暂停菜单切换）
    this._onKey = (e) => {
      if (e.key === 'Escape' && this.visible) {
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', this._onKey, true);

    this._build();
  }

  _btnStyle() {
    return `
      width: 310px; padding: 10px 14px; font-size: 14px; cursor: pointer;
      background: #3a3a3a; color: #fff; border: 2px solid #5a5a5a; font-weight: bold;
    `;
  }

  _build() {
    this.el.innerHTML = '';

    const title = document.createElement('div');
    title.textContent = '视频设置';
    title.style.cssText = 'font-size: 24px; font-weight: bold; margin-bottom: 18px; letter-spacing: 2px;';
    this.el.appendChild(title);

    this.rows = {};
    const mkRow = (label) => {
      const b = document.createElement('button');
      b.style.cssText = this._btnStyle() + 'margin-bottom:8px;';
      this.el.appendChild(b);
      this.rows[label] = b;
      return b;
    };

    // 渲染距离
    mkRow('renderDistance').addEventListener('click', () => {
      const s = this.game.settings;
      s.renderDistance = s.renderDistance >= 12 ? 2 : s.renderDistance + 1;
      this._apply();
    });
    // 视野
    mkRow('fov').addEventListener('click', () => {
      const s = this.game.settings;
      s.fov = s.fov >= 110 ? 60 : s.fov + 5;
      this._apply();
    });
    // 亮度
    mkRow('brightness').addEventListener('click', () => {
      const s = this.game.settings;
      s.brightness = s.brightness >= 100 ? 0 : s.brightness + 10;
      this._apply();
    });
    // 云
    mkRow('clouds').addEventListener('click', () => {
      this.game.settings.clouds = !this.game.settings.clouds;
      this._apply();
    });
    // 粒子
    mkRow('particles').addEventListener('click', () => {
      const s = this.game.settings;
      s.particles = PARTICLE_ORDER[(PARTICLE_ORDER.indexOf(s.particles) + 1) % PARTICLE_ORDER.length];
      this._apply();
    });
    // 平滑光照（切换需重建全部区块网格）
    mkRow('smoothLighting').addEventListener('click', () => {
      this.game.settings.smoothLighting = !this.game.settings.smoothLighting;
      this._apply();
      if (this.game.world) this.game.world.markAllDirty();
    });
    // 视角摇晃
    mkRow('viewBobbing').addEventListener('click', () => {
      this.game.settings.viewBobbing = !this.game.settings.viewBobbing;
      this._apply();
    });
    // 鼠标灵敏度
    mkRow('sensitivity').addEventListener('click', () => {
      const s = this.game.settings;
      s.sensitivity = s.sensitivity >= 200 ? 30 : s.sensitivity + 10;
      this._apply();
    });
    // 全屏（不持久化，按浏览器当前状态显示）
    this.fullscreenBtn = document.createElement('button');
    this.fullscreenBtn.style.cssText = this._btnStyle() + 'margin-bottom:8px;';
    this.fullscreenBtn.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch { /* 用户拒绝等忽略 */ }
      this._refresh();
    });
    this.el.appendChild(this.fullscreenBtn);

    // 完成按钮
    const done = document.createElement('button');
    done.textContent = '完成';
    done.style.cssText = `
      width: 310px; padding: 12px 14px; font-size: 15px; cursor: pointer; margin-top: 14px;
      background: #4a8a4a; color: #fff; border: 2px solid #2a5a2a; font-weight: bold;
    `;
    done.addEventListener('click', () => this.hide());
    this.el.appendChild(done);

    this._refresh();
  }

  _apply() {
    saveSettings(this.game.settings);
    applySettings(this.game);
    this._refresh();
  }

  _refresh() {
    const s = this.game.settings;
    this.rows.renderDistance.textContent = `渲染距离: ${s.renderDistance} 区块`;
    this.rows.fov.textContent = `视野: ${s.fov}`;
    this.rows.brightness.textContent = `亮度: ${s.brightness}%（最低亮度 ${brightnessToMinLight(s.brightness).toFixed(2)}）`;
    this.rows.clouds.textContent = `云: ${s.clouds ? '开' : '关'}`;
    this.rows.particles.textContent = `粒子: ${PARTICLE_LABELS[s.particles] || '全部'}`;
    this.rows.smoothLighting.textContent = `平滑光照: ${s.smoothLighting ? '开' : '关'}`;
    this.rows.viewBobbing.textContent = `视角摇晃: ${s.viewBobbing ? '开' : '关'}`;
    this.rows.sensitivity.textContent = `鼠标灵敏度: ${s.sensitivity}%`;
    this.fullscreenBtn.textContent = `全屏: ${document.fullscreenElement ? '开（点击退出）' : '关（点击进入）'}`;
  }

  show() {
    this._refresh(); // 全屏状态等实时量刷新
    this.visible = true;
    this.el.style.display = 'flex';
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
    // 游戏内（暂停菜单）打开时把控制权交还给暂停菜单（保持暂停态），主界面则无需处理
    if (this.onHide) this.onHide();
  }

  dispose() {
    document.removeEventListener('keydown', this._onKey, true);
    this.el.remove();
  }
}
