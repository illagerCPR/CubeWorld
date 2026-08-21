// DeathScreen.js -- 玩家死亡屏幕
export class DeathScreen {
  constructor(game) {
    this.game = game;
    this.visible = false;

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; flex-direction: column;
      align-items: center; justify-content: center; z-index: 45;
      background: rgba(80,0,0,0.55); color: #fff;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1a0a0a; border: 3px solid #5a0000; padding: 32px 48px;
      display:flex; flex-direction:column; gap:14px; align-items:center;
    `;
    this.el.appendChild(panel);

    const title = document.createElement('div');
    title.textContent = '你死了！';
    title.style.cssText = 'font-size:30px; font-weight:bold; color:#ff6666; text-shadow:2px 2px 0 #000; letter-spacing:4px; margin-bottom:12px;';
    panel.appendChild(title);

    this.respawnBtn = this._mkBtn('重生', '#4a8a4a', '#2a5a2a');
    this.exitBtn = this._mkBtn('返回标题画面', '#8a4a4a', '#5a2a2a');
    panel.appendChild(this.respawnBtn);
    panel.appendChild(this.exitBtn);

    this.respawnBtn.addEventListener('click', () => this.hide());
    this.exitBtn.addEventListener('click', () => {
      this.game.returnToMenu(false);
    });

    document.body.appendChild(this.el);
  }

  _mkBtn(label, bg, border) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `padding:10px 20px; font-size:15px; background:${bg}; color:#fff; border:2px solid ${border}; cursor:pointer; font-weight:bold; min-width:180px;`;
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
    if (this.game.respawn) this.game.respawn();
    if (this.game.paused !== undefined) this.game.paused = false;
    if (this.game.controls) this.game.controls.enabled = true;
  }
}