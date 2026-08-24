// ChatBox.js -- 联机聊天框：消息滚动显示 + T 键打开输入
export class ChatBox {
  constructor(game, onSend) {
    this.game = game;
    this.onSend = onSend;
    this.messages = [];
    this.input = null;
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; left: 16px; bottom: 140px; width: 380px; max-height: 180px;
      overflow: hidden; display: flex; flex-direction: column; gap: 2px;
      pointer-events: none; z-index: 40; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;
    document.body.appendChild(this.el);
    // T 键打开输入框：保存引用以便 dispose 时移除，防止换房/重建世界反复 start() 堆积监听器
    this._onKey = (e) => {
      if (e.code === 'KeyT' && this.game.networkMode && this.game.running && !e.repeat) {
        e.preventDefault();
        this.open();
      }
    };
    document.addEventListener('keydown', this._onKey);
  }

  add(text, color = '#fff') {
    this.messages.push({ text, color });
    if (this.messages.length > 8) this.messages.shift();
    this._render();
  }

  // 分段消息：parts = [{ text, color }, ...]，逐段转义 + 着色（用于"玩家名着色"）
  addSegments(parts) {
    this.messages.push({ parts });
    if (this.messages.length > 8) this.messages.shift();
    this._render();
  }

  _render() {
    this.el.innerHTML = this.messages.map(m => {
      let inner;
      if (m.parts) {
        inner = m.parts.map(p => `<span style="color:${p.color || '#fff'}">${this._esc(p.text)}</span>`).join('');
      } else {
        inner = `<span style="color:${m.color || '#fff'}">${this._esc(m.text)}</span>`;
      }
      return `<div style="font-size:13px; text-shadow:1px 1px 0 #000; line-height:1.4; background:rgba(0,0,0,0.35); padding:2px 6px; border-radius:3px;">${inner}</div>`;
    }).join('');
  }

  _esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // T 键在 _bindKeys 中触发；打开时释放指针锁并暂停，关闭时恢复
  open() {
    if (this.input) return;
    this.game.controls.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.game.paused = true;
    this.input = document.createElement('input');
    this.input.style.cssText = `
      position: absolute; left: 16px; bottom: 118px; width: 360px; padding: 6px 10px;
      background: rgba(0,0,0,0.7); border: 1px solid #666; color: #fff; font-size: 14px;
      z-index: 45; outline: none;
    `;
    document.body.appendChild(this.input);
    this.input.focus();
    this.input.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') {
        const v = this.input.value.trim();
        if (v && this.onSend) this.onSend(v);
        this.close();
      } else if (e.code === 'Escape') {
        this.close();
      }
    });
  }

  close() {
    if (!this.input) return;
    this.input.remove();
    this.input = null;
    this.game.paused = false;
    this.game.controls.enabled = true;
    if (this.game.running) this.game.controls.requestLock();
  }

  toggle() { if (this.input) this.close(); else this.open(); }

  dispose() {
    this.close();
    document.removeEventListener('keydown', this._onKey);
    this.el.remove();
  }
}
