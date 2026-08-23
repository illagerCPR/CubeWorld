// MenuScreen.js -- 主菜单 + 存档槽选择
import { SaveSystem, MAX_SAVE_SLOTS } from '../core/SaveSystem.js';

const MODE_LABEL = { creative: '创造模式', survival: '生存模式', spectator: '旁观模式' };
const MODE_COLOR = {
  creative: { bg: '#4a8a4a', border: '#2a5a2a' },
  survival: { bg: '#8a4a4a', border: '#5a2a2a' },
  spectator: { bg: '#4a4a8a', border: '#2a2a5a' }
};

export class MenuScreen {
  constructor(onStart, net = null) {
    this.onStart = onStart;
    this.net = net;
    this.selectedMode = 'creative';
    this.selectedCheats = false;
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: flex-start; padding-top: 6vh;
      z-index: 50; overflow-y: auto;
      background: linear-gradient(180deg, #5a8fcf 0%, #1a3a5a 100%);
      color: #fff; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;
    document.body.appendChild(this.el);
    this.render();
  }

  render() {
    const saves = SaveSystem.listSaves();
    let slotsHtml = '';
    for (let i = 0; i < saves.length; i++) {
      const s = saves[i];
      if (s.empty) {
        slotsHtml += `
          <div class="slot" data-slot="${s.slot}" style="
            display:flex; align-items:center; gap:12px; width:460px; min-height:60px;
            margin-bottom:8px; padding:8px 16px;
            background: rgba(0,0,0,0.25); border: 2px dashed rgba(255,255,255,0.3);
            cursor: pointer; opacity: 0.7;">
            <div style="font-size:20px; color:#999;">○</div>
            <div style="flex:1; font-size:14px; color:#ddd;">空存档槽 ${s.slot}</div>
            <div style="font-size:12px; color:#aaa;">点击新建</div>
          </div>`;
      } else {
        const c = MODE_COLOR[s.gamemode] || MODE_COLOR.creative;
        const time = s.timestamp ? new Date(s.timestamp).toLocaleString('zh-CN', { hour12: false }) : '未知';
        slotsHtml += `
          <div class="slot" data-slot="${s.slot}" style="
            display:flex; align-items:center; gap:12px; width:460px; min-height:60px;
            margin-bottom:8px; padding:8px 16px;
            background: rgba(0,0,0,0.35); border: 2px solid ${c.border}; cursor: pointer;">
            <div style="font-size:20px; color:#5f5;">●</div>
            <div style="flex:1; display:flex; flex-direction:column; gap:2px;">
              <div style="font-size:14px; font-weight:bold; color:#fff;">槽 ${s.slot} · ${MODE_LABEL[s.gamemode] || s.gamemode}${s.cheatsEnabled ? ' · <span style="color:#fc5;">作弊</span>' : ''}</div>
              <div style="font-size:11px; color:#bbb;">${time} · 种子 ${s.seed}${s.cheatsEnabled ? ' · 命令已启用' : ''}</div>
            </div>
            <button class="del-btn" data-del="${s.slot}" style="
              background: #8a3a3a; color:#fff; border:1px solid #5a2a2a;
              cursor:pointer; padding:4px 10px; font-size:12px;">删除</button>
          </div>`;
      }
    }

    this.el.innerHTML = `
      <div style="font-size: 44px; font-weight: bold; text-shadow: 3px 3px 0 #000; letter-spacing: 4px; margin-bottom: 4px;">PROJECT-MC</div>
      <div style="font-size: 13px; color: #ccc; margin-bottom: 16px;">网页版 3D Minecraft · 选择存档</div>
      <div style="display:flex; flex-direction:column; margin-bottom:16px;">
        ${slotsHtml}
      </div>
      <div style="font-size:12px; color:#aaa; margin-bottom:6px;">—— 新建游戏设置（点击空槽时使用）——</div>
      <div id="mc-seed" style="margin-bottom: 10px;">
        <label style="font-size:13px; margin-right: 8px;">种子(可空):</label>
        <input type="text" id="seed-input" style="padding: 6px 10px; background: rgba(0,0,0,0.4); border: 1px solid #555; color: #fff; width: 180px; font-size: 13px;" placeholder="随机" />
      </div>
      <div style="display: flex; gap: 10px; margin-bottom: 16px;">
        <button data-mode="creative" style="padding:10px 20px; font-size:14px; background:#4a8a4a; color:#fff; border:2px solid #2a5a2a; cursor:pointer; font-weight:bold;">创造模式</button>
        <button data-mode="survival" style="padding:10px 20px; font-size:14px; background:#8a4a4a; color:#fff; border:2px solid #5a2a2a; cursor:pointer; font-weight:bold;">生存模式</button>
        <button data-mode="spectator" style="padding:10px 20px; font-size:14px; background:#4a4a8a; color:#fff; border:2px solid #2a2a5a; cursor:pointer; font-weight:bold;">旁观模式</button>
      </div>
      <div id="mc-cheats" style="margin-bottom: 16px; display:flex; align-items:center; gap:8px;">
        <label style="font-size:14px; cursor:pointer; display:flex; align-items:center; gap:6px;">
          <input type="checkbox" id="cheats-input" ${this.selectedCheats ? 'checked' : ''} style="width:16px; height:16px; cursor:pointer;" />
          <span style="color:#fc5; font-weight:bold;">启用命令</span>
        </label>
        <span style="font-size:11px; color:#999;">（游戏中按 C 打开命令面板：传送 / 切换模式 / 生成实体）</span>
      </div>
      <div style="font-size: 11px; color: #aaa; text-align: center; line-height: 1.7;">
        WASD 移动 / 空格 跳跃 / 双击空格 飞行(创造) / Shift 下蹲<br/>
        鼠标左键 破坏 / 右键 放置 / E 打开背包 / ESC 暂停 / C 命令面板(需启用)<br/>
        滚轮 切换物品 / 1-9 快捷栏 / F5 手动保存
      </div>
      <div style="margin-top:22px; border-top:1px solid rgba(255,255,255,0.2); padding-top:14px; width:520px;">
        <div style="font-size:15px; font-weight:bold; margin-bottom:8px;">🌐 局域网联机</div>
        <div style="display:flex; gap:8px; margin-bottom:8px; align-items:center; font-size:13px;">
          <label>昵称</label>
          <input type="text" id="mp-name" maxlength="16" style="padding:5px 8px; background:rgba(0,0,0,0.4); border:1px solid #555; color:#fff; width:90px; font-size:13px;" placeholder="玩家" />
          <label>服务器</label>
          <input type="text" id="mp-url" style="padding:5px 8px; background:rgba(0,0,0,0.4); border:1px solid #555; color:#fff; flex:1; font-size:13px;" value="ws://127.0.0.1:3001/ws" />
        </div>
        <div style="display:flex; gap:8px; margin-bottom:8px; align-items:center; font-size:13px;">
          <label>房间名</label>
          <input type="text" id="mp-room" maxlength="24" style="padding:5px 8px; background:rgba(0,0,0,0.4); border:1px solid #555; color:#fff; width:120px; font-size:13px;" value="默认世界" />
          <span style="font-size:11px; color:#aaa;">同名房间共享世界（服务器落盘，重启不丢）；开新世界换个房间名</span>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <button id="mp-host" style="padding:8px 16px; font-size:13px; background:#2a5a8a; color:#fff; border:2px solid #1a3a5a; cursor:pointer; font-weight:bold;">创建房间</button>
          <button id="mp-join" style="padding:8px 16px; font-size:13px; background:#5a3a7a; color:#fff; border:2px solid #3a2a5a; cursor:pointer; font-weight:bold;">加入房间</button>
          <div id="mp-status" style="font-size:12px; color:#9cf;"></div>
        </div>
        <div style="font-size:11px; color:#aaa; margin-top:6px; line-height:1.6;">
          先运行 <b>node server/index.mjs</b> 开启服务器；创建房间决定世界种子，其它电脑填开房机 IP 加入。<br/>
          联机支持：方块共建/破坏、玩家可见与移动、互殴、聊天(T)。联机模式不保存本地存档。<br/>
          服务器按<b>房间名</b>把世界存到磁盘（<b>server/world/</b>），重启服务器后同名房间自动恢复原世界。
        </div>
      </div>
    `;

    // 模式选择高亮
    this.el.querySelectorAll('button[data-mode]').forEach(btn => {
      if (btn.dataset.mode === this.selectedMode) btn.style.outline = '2px solid #fff';
      btn.addEventListener('click', () => {
        this.selectedMode = btn.dataset.mode;
        this.el.querySelectorAll('button[data-mode]').forEach(b => b.style.outline = 'none');
        btn.style.outline = '2px solid #fff';
      });
    });

    // "启用命令"复选框
    const cheatsInput = this.el.querySelector('#cheats-input');
    if (cheatsInput) {
      cheatsInput.addEventListener('change', () => {
        this.selectedCheats = cheatsInput.checked;
      });
    }

    // 槽点击：继续或新建
    this.el.querySelectorAll('.slot').forEach(slotEl => {
      slotEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('del-btn')) return;
        const slot = parseInt(slotEl.dataset.slot);
        if (SaveSystem.hasSave(slot)) {
          const data = SaveSystem.load(slot);
          if (data) { this.hide(); this.onStart(null, 0, data, slot); }
        } else {
          const seed = this._readSeed();
          this.hide();
          this.onStart(this.selectedMode, seed, null, slot, this.selectedCheats);
        }
      });
    });

    // 删除按钮
    this.el.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slot = parseInt(btn.dataset.del);
        if (confirm(`确定删除存档槽 ${slot} 吗？此操作不可撤销。`)) {
          SaveSystem.deleteSave(slot);
          this.render();
        }
      });
    });

    // 局域网联机：创建房间 / 加入房间
    if (this.net) {
      const hostBtn = this.el.querySelector('#mp-host');
      const joinBtn = this.el.querySelector('#mp-join');
      if (hostBtn) hostBtn.addEventListener('click', () => {
        this._mpConnect('host');
      });
      if (joinBtn) joinBtn.addEventListener('click', () => {
        this._mpConnect('join');
      });
    }
  }

  _mpConnect(kind) {
    const name = this.el.querySelector('#mp-name')?.value.trim() || '玩家';
    const url = this.el.querySelector('#mp-url')?.value.trim() || 'ws://127.0.0.1:3001/ws';
    const room = this.el.querySelector('#mp-room')?.value.trim() || 'default';
    this.setMpStatus('连接中...', '#9cf');
    this.net.connect(url, name);
    if (kind === 'host') this.net.createRoom(this._readSeed(), this.selectedMode, room);
    else this.net.joinRoom(room);
  }

  setMpStatus(text, color = '#9cf') {
    const el = this.el.querySelector('#mp-status');
    if (el) { el.textContent = text; el.style.color = color; }
  }

  _readSeed() {
    const txt = document.getElementById('seed-input')?.value.trim();
    if (!txt) return (Math.random() * 4294967296) >>> 0;
    let seed = 0;
    for (let i = 0; i < txt.length; i++) seed = (seed * 31 + txt.charCodeAt(i)) >>> 0;
    return seed;
  }

  hide() { this.el.style.display = 'none'; }
  show() { this.el.style.display = 'flex'; this.render(); }
}