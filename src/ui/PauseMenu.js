// PauseMenu.js -- 游戏暂停菜单
import { SaveSystem } from '../core/SaveSystem.js';

export class PauseMenu {
  constructor(game) {
    this.game = game;
    this.visible = false;

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; flex-direction: column;
      align-items: center; justify-content: center; z-index: 40;
      background: rgba(0,0,0,0.6); color: #fff;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #2a2a2a; border: 3px solid #555; padding: 28px 40px;
      display:flex; flex-direction:column; gap:12px; min-width: 240px;
    `;
    this.el.appendChild(panel);

    const title = document.createElement('div');
    title.textContent = '游戏暂停';
    title.style.cssText = 'font-size:24px; font-weight:bold; text-align:center; margin-bottom:8px; letter-spacing:2px;';
    panel.appendChild(title);
    this.title = title;

    // 主视图按钮组（视频设置打开时整组隐藏，面板关闭后恢复）
    this.mainView = document.createElement('div');
    this.mainView.style.cssText = 'display:flex; flex-direction:column; gap:12px;';
    panel.appendChild(this.mainView);

    this.resumeBtn = this._mkBtn('继续游戏', '#4a8a4a', '#2a5a2a');
    this.saveBtn = this._mkBtn('保存游戏', '#2a6a8a', '#1a4a6a');
    this.videoBtn = this._mkBtn('视频设置', '#4a4a6a', '#2a2a4a');
    this.exitBtn = this._mkBtn('保存并回到标题', '#8a4a4a', '#5a2a2a');
    this.mainView.appendChild(this.resumeBtn);
    this.mainView.appendChild(this.saveBtn);
    this.mainView.appendChild(this.videoBtn);
    this.mainView.appendChild(this.exitBtn);

    this.resumeBtn.addEventListener('click', () => this.hide());
    this.saveBtn.addEventListener('click', () => {
      if (this.game.world) SaveSystem.save(this.game);
    });
    // 视频设置：显示共用面板，关闭后回到暂停菜单（保持暂停态）
    this.videoBtn.addEventListener('click', () => {
      if (!this.game.videoSettings) return;
      this.mainView.style.display = 'none';
      this.title.textContent = '视频设置';
      this.game.videoSettings.onHide = () => {
        this.game.videoSettings.onHide = null;
        if (this.visible) {
          this.mainView.style.display = 'flex';
          this.title.textContent = '游戏暂停';
        }
      };
      this.game.videoSettings.show();
    });
    this.exitBtn.addEventListener('click', () => {
      this.game.returnToMenu(true);
    });

    document.body.appendChild(this.el);
  }

  _mkBtn(label, bg, border) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `padding:10px 18px; font-size:15px; background:${bg}; color:#fff; border:2px solid ${border}; cursor:pointer; font-weight:bold;`;
    return b;
  }

  show() {
    this.visible = true;
    this.el.style.display = 'flex';
    if (this.game.inventoryScreen && this.game.inventoryScreen.visible) this.game.inventoryScreen.hide();
    if (this.game.controls) {
      this.game.controls.enabled = false;
      this.game.controls.mouseLeft = false;
      this.game.controls.mouseRight = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.game.paused !== undefined) this.game.paused = true;
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
    if (this.game.paused !== undefined) this.game.paused = false;
    if (this.game.controls) this.game.controls.enabled = true;
    // 复位子视图（视频设置面板打开时被外部关闭等）
    if (this.mainView) this.mainView.style.display = 'flex';
    if (this.title) this.title.textContent = '游戏暂停';
    if (this.game.videoSettings && this.game.videoSettings.visible) this.game.videoSettings.hide();
  }
}