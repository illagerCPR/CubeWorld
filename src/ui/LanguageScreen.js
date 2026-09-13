// LanguageScreen.js -- 语言切换界面（Build 7：从视频设置独立出来）
// 主界面与暂停菜单的地球小按钮进入；列出全部语言（各语言自称），点击即切换并持久化。
// 生命周期同 VideoSettings：show 设 controls.enabled=false + 退指针锁，hide 恢复 + onHide 回调。
import { LOCALES, setLocale, getLocale } from '../i18n/index.js';
import { saveSettings } from '../core/Settings.js';
import { ensureStoneStyles } from './StoneStyle.js';
import { t } from '../i18n/index.js';

// 像素风地球图标（多语言通用符号）：蓝底圆 + 经纬线 + 大陆块，SVG data-URI 背景用
export function globeIconDataUri() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">
    <circle cx="8" cy="8" r="7" fill="#3b6ea5"/>
    <rect x="2" y="4" width="4" height="2" fill="#6aa84f"/>
    <rect x="3" y="6" width="3" height="2" fill="#6aa84f"/>
    <rect x="9" y="3" width="4" height="2" fill="#6aa84f"/>
    <rect x="10" y="5" width="3" height="3" fill="#6aa84f"/>
    <rect x="5" y="10" width="5" height="2" fill="#6aa84f"/>
    <rect x="6" y="12" width="3" height="1" fill="#6aa84f"/>
    <line x1="1" y1="8" x2="15" y2="8" stroke="#d8e8f8" stroke-width="1" opacity="0.85"/>
    <ellipse cx="8" cy="8" rx="3.2" ry="7" fill="none" stroke="#d8e8f8" stroke-width="0.9" opacity="0.85"/>
    <circle cx="8" cy="8" r="7" fill="none" stroke="#d8e8f8" stroke-width="1.1"/>
  </svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

export class LanguageScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;
    this.onHide = null; // 暂停菜单注入：关闭后交还父界面

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; flex-direction: column;
      align-items: center; justify-content: center; z-index: 60;
      background: rgba(0,0,0,0.65); color: #fff;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;

    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      background: #2a2a2a; border: 3px solid #555; padding: 20px 24px;
      display: flex; flex-direction: column; gap: 10px; align-items: center;
      min-width: 320px;
    `;
    this.el.appendChild(this.panel);

    // ESC 关闭（capture 拦截，避免同时触发暂停菜单切换）
    this._onKey = (e) => {
      if (e.key === 'Escape' && this.visible) {
        e.stopPropagation();
        this.hide();
      }
    };
    document.addEventListener('keydown', this._onKey, true);

    this.render();
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });

    document.body.appendChild(this.el);
  }

  render() {
    ensureStoneStyles();
    this.panel.innerHTML = '';
    const title = document.createElement('div');
    title.textContent = t('语言');
    title.style.cssText = 'font-size: 20px; font-weight: bold; letter-spacing: 2px; margin-bottom: 4px;';
    this.panel.appendChild(title);

    // 语言列表：各语言自称（label 为常量不走 t()）；当前语言 .selected 白描边
    for (const l of LOCALES) {
      const b = document.createElement('button');
      b.className = 'cw-stone-btn' + (l.id === getLocale() ? ' selected' : '');
      b.textContent = l.label;
      b.style.cssText = 'width: 260px; padding: 10px 14px; font-size: 15px;';
      b.addEventListener('click', () => {
        if (l.id === getLocale()) return;
        this.game.settings.language = l.id;
        saveSettings(this.game.settings);
        setLocale(l.id); // onLocaleChange 通知全部常驻 UI 重绘（含本面板高亮）
        this.render();
      });
      this.panel.appendChild(b);
    }

    const back = document.createElement('button');
    back.className = 'cw-stone-btn';
    back.textContent = t('← 返回');
    back.style.cssText = 'width: 260px; padding: 8px 14px; font-size: 14px; margin-top: 6px;';
    back.addEventListener('click', () => this.hide());
    this.panel.appendChild(back);
  }

  show() {
    this.render();
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
    // 游戏内（暂停菜单）打开时交还控制权给暂停菜单（保持暂停态）
    if (this.onHide) this.onHide();
  }

  dispose() {
    document.removeEventListener('keydown', this._onKey, true);
    this.el.remove();
  }
}
