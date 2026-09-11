// MenuScreen.js -- 主菜单（主页 / 单人游戏 / 局域网游戏 三页导航）+ 石质按钮
import { SaveSystem } from '../core/SaveSystem.js';
import { BIOME_SCALES, DEFAULT_BIOME_SCALE, safeBiomeScale } from '../world/biomes.js';
import logoUrl from '../../res/logo-cubeworld-js-edition.png';

const MODE_LABEL = { creative: '创造模式', survival: '生存模式', spectator: '旁观模式' };
const MODE_COLOR = {
  creative: { bg: '#4a8a4a', border: '#2a5a2a' },
  survival: { bg: '#8a4a4a', border: '#5a2a2a' },
  spectator: { bg: '#4a4a8a', border: '#2a2a5a' }
};
const DIM_LABEL = { overworld: '主世界', nether: '下界', end: '末地', aether: '天域' };

// ---------- 石质按钮材质 ----------
// 与游戏内 stone 方块同风格的确定性哈希噪点（禁用 Math.random，符合程序化纹理生成约定）
function menuHash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 974634073) >>> 0;
  h = ((h ^ (h >>> 13)) * 1103515245) >>> 0;
  return (h >>> 16) / 65536;
}

function stoneSvgDataUri(seed = 7) {
  const rects = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = menuHash2(x, y, seed);
      let f = 1 + (menuHash2(x, y, seed + 1) - 0.5) * 0.06;
      if (t < 0.2) f *= 0.9;
      else if (t > 0.85) f *= 1.08;
      const c = Math.max(0, Math.min(255, Math.round(125 * f)));
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${c},${c},${c})"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects.join('')}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const STONE_BG = stoneSvgDataUri(7);

// 样式表构造期注入一次（幂等）：hover/active/selected 态必须走 class，内联样式写不了伪类；
// class 选择器不受 render() 重建 innerHTML 影响
function ensureMenuStyles() {
  if (document.getElementById('cw-menu-styles')) return;
  const style = document.createElement('style');
  style.id = 'cw-menu-styles';
  style.textContent = `
    .cw-stone-btn {
      background-image: ${STONE_BG};
      background-size: 64px 64px;
      image-rendering: pixelated;
      border: 2px solid #000;
      box-shadow: inset 2px 2px 0 rgba(255,255,255,0.35), inset -2px -4px 0 rgba(0,0,0,0.45);
      color: #fff;
      text-shadow: 2px 2px 0 rgba(0,0,0,0.55);
      cursor: pointer;
      font-weight: bold;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    }
    .cw-stone-btn:hover { filter: brightness(1.22); border-color: #fff; }
    .cw-stone-btn:active {
      filter: brightness(0.92);
      box-shadow: inset -2px -2px 0 rgba(255,255,255,0.2), inset 2px 2px 0 rgba(0,0,0,0.45);
    }
    .cw-stone-btn.selected {
      border-color: #fff;
      box-shadow: inset 2px 2px 0 rgba(255,255,255,0.35), inset -2px -4px 0 rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.55);
    }
  `;
  document.head.appendChild(style);
}

export class MenuScreen {
  constructor(onStart, net = null) {
    ensureMenuStyles();
    this.onStart = onStart;
    this.net = net;
    this.page = 'main'; // main | single | lan
    this.selectedMode = 'creative';
    this.selectedCheats = false;
    this.selectedBiomeScale = DEFAULT_BIOME_SCALE; // 群系规模（新建世界/建房共用；载入存档不受影响）
    this.mpStatus = null; // { text, color } 联机状态暂存：非 LAN 页先存，进 LAN 页回显
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: flex-start; padding-top: 6vh;
      z-index: 50; overflow-y: auto;
      background: linear-gradient(180deg, rgba(10,25,45,0.16) 0%, rgba(5,15,30,0.34) 100%);
      color: #fff; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    `;
    document.body.appendChild(this.el);
    // 页面导航 + 视频设置入口：事件委托挂构造期（render() 重建 innerHTML 无需重绑）
    this.el.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!btn) return;
      if (btn.id === 'video-settings-btn' && this.videoSettings) {
        this.videoSettings.show();
        return;
      }
      if (btn.id === 'menu-single' || btn.id === 'menu-lan' || btn.classList.contains('back-btn')) {
        this.page = btn.id === 'menu-single' ? 'single' : (btn.id === 'menu-lan' ? 'lan' : 'main');
        this.render();
      }
    });
    this.render();
  }

  render() {
    if (this.page === 'single') this._renderSingle();
    else if (this.page === 'lan') this._renderLan();
    else this._renderMain();
  }

  // ---------- 主页 ----------
  _renderMain() {
    this.el.innerHTML = `
      <img src="${logoUrl}" alt="CubeWorld" style="
        width: 500px; max-width: 92vw; image-rendering: pixelated;
        filter: drop-shadow(5px 6px 0 rgba(0,0,0,0.45)); margin-bottom: 2px;" />
      <div style="font-size: 13px; color: #ccc; margin-bottom: 3vh;">JavaScript 版 3D 沙盒游戏</div>
      <div style="display:flex; flex-direction:column; align-items:center; gap:14px;">
        <button id="menu-single" class="cw-stone-btn" style="width:400px; height:52px; font-size:18px;">单人游戏</button>
        <button id="menu-lan" class="cw-stone-btn" style="width:400px; height:52px; font-size:18px;">局域网游戏</button>
        <button id="video-settings-btn" class="cw-stone-btn" style="width:196px; height:38px; font-size:14px; margin-top:10px;">⚙ 视频设置</button>
      </div>
      <div style="font-size: 11px; color: #aaa; text-align: center; line-height: 1.7; margin-top: 4vh;">
        WASD 移动 / 空格 跳跃 / 双击空格 飞行(创造) / Shift 下蹲<br/>
        鼠标左键 破坏 / 右键 放置 / E 打开背包 / ESC 暂停 / C 命令面板(需启用)<br/>
        滚轮 切换物品 / 1-9 快捷栏 / F5 手动保存
      </div>
    `;
  }

  // ---------- 单人游戏页 ----------
  _slotsHtml() {
    const saves = SaveSystem.listSaves();
    let html = '';
    for (let i = 0; i < saves.length; i++) {
      const s = saves[i];
      if (s.empty) {
        html += `
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
        const dim = s.dimension && s.dimension !== 'overworld' ? ` · ${DIM_LABEL[s.dimension] || s.dimension}` : '';
        const bs = s.biomeScale && s.biomeScale !== 'small' ? ` · 群系:${(BIOME_SCALES[s.biomeScale] || BIOME_SCALES.small).label}` : '';
        html += `
          <div class="slot" data-slot="${s.slot}" style="
            display:flex; align-items:center; gap:12px; width:460px; min-height:60px;
            margin-bottom:8px; padding:8px 16px;
            background: rgba(0,0,0,0.35); border: 2px solid ${c.border}; cursor: pointer;">
            <div style="font-size:20px; color:#5f5;">●</div>
            <div style="flex:1; display:flex; flex-direction:column; gap:2px;">
              <div style="font-size:14px; font-weight:bold; color:#fff;">槽 ${s.slot} · ${MODE_LABEL[s.gamemode] || s.gamemode}${dim}${bs}${s.cheatsEnabled ? ' · <span style="color:#fc5;">作弊</span>' : ''}</div>
              <div style="font-size:11px; color:#bbb;">${time} · 种子 ${s.seed}${s.cheatsEnabled ? ' · 命令已启用' : ''}</div>
            </div>
            <button class="del-btn" data-del="${s.slot}" style="
              background: #8a3a3a; color:#fff; border:1px solid #5a2a2a;
              cursor:pointer; padding:4px 10px; font-size:12px;">删除</button>
          </div>`;
      }
    }
    return html;
  }

  // 生物群系规模四选一（单人页新建设置 / LAN 页建房共用 selectedBiomeScale 状态）
  _biomeScaleHtml() {
    const btns = Object.entries(BIOME_SCALES).map(([key, v]) =>
      `<button data-biome-scale="${key}" class="cw-stone-btn biome-scale-btn" style="padding:6px 14px; font-size:13px;">${v.label}</button>`
    ).join('');
    return `
      <div id="mc-biome-scale" style="margin-bottom: 12px; display:flex; align-items:center; gap:8px;">
        <span style="font-size:13px;">群系规模:</span>
        <span style="display:flex; gap:8px;">${btns}</span>
        <span style="font-size:11px; color:#999;">（越大群系斑块越大，仅对新建世界生效）</span>
      </div>`;
  }

  _bindBiomeScale() {
    const btns = this.el.querySelectorAll('button[data-biome-scale]');
    const refresh = () => {
      btns.forEach(b => b.classList.toggle('selected', b.dataset.biomeScale === this.selectedBiomeScale));
    };
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedBiomeScale = safeBiomeScale(btn.dataset.biomeScale);
        refresh();
      });
    });
    refresh();
  }

  _renderSingle() {
    this.el.innerHTML = `
      <div style="font-size:22px; font-weight:bold; text-shadow: 2px 2px 0 rgba(0,0,0,0.55); margin-bottom:2px;">单人游戏</div>
      <div style="font-size:12px; color:#aaa; margin-bottom:14px;">选择存档继续，或点击空槽新建世界</div>
      <div style="display:flex; flex-direction:column; margin-bottom:16px;">
        ${this._slotsHtml()}
      </div>
      <div style="font-size:12px; color:#aaa; margin-bottom:6px;">—— 新建游戏设置（点击空槽时使用）——</div>
      <div id="mc-seed" style="margin-bottom: 10px;">
        <label style="font-size:13px; margin-right: 8px;">种子(可空):</label>
        <input type="text" id="seed-input" style="padding: 6px 10px; background: rgba(0,0,0,0.4); border: 1px solid #555; color: #fff; width: 180px; font-size: 13px;" placeholder="随机" />
      </div>
      <div style="display: flex; gap: 10px; margin-bottom: 14px;">
        <button data-mode="creative" class="cw-stone-btn mode-btn" style="padding:10px 20px; font-size:14px;"><span style="display:inline-block; width:10px; height:10px; background:${MODE_COLOR.creative.bg}; border:1px solid #000; margin-right:6px; vertical-align:middle;"></span>创造模式</button>
        <button data-mode="survival" class="cw-stone-btn mode-btn" style="padding:10px 20px; font-size:14px;"><span style="display:inline-block; width:10px; height:10px; background:${MODE_COLOR.survival.bg}; border:1px solid #000; margin-right:6px; vertical-align:middle;"></span>生存模式</button>
        <button data-mode="spectator" class="cw-stone-btn mode-btn" style="padding:10px 20px; font-size:14px;"><span style="display:inline-block; width:10px; height:10px; background:${MODE_COLOR.spectator.bg}; border:1px solid #000; margin-right:6px; vertical-align:middle;"></span>旁观模式</button>
      </div>
      ${this._biomeScaleHtml()}
      <div id="mc-cheats" style="margin-bottom: 16px; display:flex; align-items:center; gap:8px;">
        <label style="font-size:14px; cursor:pointer; display:flex; align-items:center; gap:6px;">
          <input type="checkbox" id="cheats-input" ${this.selectedCheats ? 'checked' : ''} style="width:16px; height:16px; cursor:pointer;" />
          <span style="color:#fc5; font-weight:bold;">启用命令</span>
        </label>
        <span style="font-size:11px; color:#999;">（游戏中按 C 打开命令面板：传送 / 切换模式 / 生成实体）</span>
      </div>
      <button class="cw-stone-btn back-btn" style="width:196px; height:36px; font-size:14px;">← 返回</button>
    `;
    this._bindSingle();
  }

  _bindSingle() {
    // 模式选择高亮（.selected 白描边）
    const modeBtns = this.el.querySelectorAll('button[data-mode]');
    const refreshMode = () => {
      modeBtns.forEach(b => b.classList.toggle('selected', b.dataset.mode === this.selectedMode));
    };
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedMode = btn.dataset.mode;
        refreshMode();
      });
    });
    refreshMode();
    this._bindBiomeScale();

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
          this.onStart(this.selectedMode, seed, null, slot, this.selectedCheats, this.selectedBiomeScale);
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
  }

  // ---------- 局域网游戏页 ----------
  _renderLan() {
    const st = this.mpStatus;
    this.el.innerHTML = `
      <div style="font-size:22px; font-weight:bold; text-shadow: 2px 2px 0 rgba(0,0,0,0.55); margin-bottom:2px;">🌐 局域网游戏</div>
      <div style="font-size:12px; color:#aaa; margin-bottom:16px;">与同一局域网的其它电脑共建世界（联机模式不保存本地存档）</div>
      <div style="width:520px; border:2px solid rgba(0,0,0,0.5); background:rgba(0,0,0,0.3); padding:14px 18px; margin-bottom:12px;">
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
        <div style="display:flex; gap:8px; margin-bottom:8px; align-items:center; font-size:13px;">
          <span>群系规模:</span>
          <span style="display:flex; gap:6px;">
            ${Object.entries(BIOME_SCALES).map(([key, v]) =>
              `<button data-biome-scale="${key}" class="cw-stone-btn biome-scale-btn" style="padding:5px 12px; font-size:12px;">${v.label}</button>`
            ).join('')}
          </span>
          <span style="font-size:11px; color:#aaa;">（建房时决定，随房间固定；加入者自动跟随）</span>
        </div>
        <div style="display:flex; gap:10px; align-items:center;">
          <button id="mp-host" class="cw-stone-btn" style="padding:8px 16px; font-size:13px;">创建房间</button>
          <button id="mp-join" class="cw-stone-btn" style="padding:8px 16px; font-size:13px;">加入房间</button>
          <div id="mp-status" style="font-size:12px; color:${st ? st.color : '#9cf'};">${st ? st.text : ''}</div>
        </div>
      </div>
      <div style="width:520px; font-size:11px; color:#aaa; line-height:1.6; margin-bottom:16px;">
        先运行 <b>node server/index.mjs</b> 开启服务器；创建房间决定世界种子，其它电脑填开房机 IP 加入。<br/>
        联机支持：方块共建/破坏、玩家可见与移动、互殴、聊天(T)。联机模式不保存本地存档。<br/>
        服务器按<b>房间名</b>把世界存到磁盘（<b>server/world/</b>），重启服务器后同名房间自动恢复原世界。
      </div>
      <button class="cw-stone-btn back-btn" style="width:196px; height:36px; font-size:14px;">← 返回</button>
    `;
    this._bindLan();
  }

  _bindLan() {
    if (!this.net) return;
    this._bindBiomeScale(); // 与单人页共用 selectedBiomeScale 状态
    const hostBtn = this.el.querySelector('#mp-host');
    const joinBtn = this.el.querySelector('#mp-join');
    if (hostBtn) hostBtn.addEventListener('click', () => this._mpConnect('host'));
    if (joinBtn) joinBtn.addEventListener('click', () => this._mpConnect('join'));
  }

  _mpConnect(kind) {
    const name = this.el.querySelector('#mp-name')?.value.trim() || '玩家';
    const url = this.el.querySelector('#mp-url')?.value.trim() || 'ws://127.0.0.1:3001/ws';
    const room = this.el.querySelector('#mp-room')?.value.trim() || 'default';
    this.setMpStatus('连接中...', '#9cf');
    this.net.connect(url, name);
    // 群系规模随建房上送（服务器首次开房固定；重复开房/加入沿用房间记录）
    if (kind === 'host') this.net.createRoom(this._readSeed(), this.selectedMode, room, this.selectedBiomeScale);
    else this.net.joinRoom(room);
  }

  setMpStatus(text, color = '#9cf') {
    this.mpStatus = { text, color };
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

  // onShow/onHide 由 main.js 注入（切换全景背景的启停）
  hide() { this.el.style.display = 'none'; if (this.onHide) this.onHide(); }
  show() { this.page = 'main'; this.el.style.display = 'flex'; this.render(); if (this.onShow) this.onShow(); }
}
