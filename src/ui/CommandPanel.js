// CommandPanel.js -- 命令面板（启用作弊的存档专享，按 C 呼出）
import { Mob } from '../entity/Mob.js';
import { ringPoints } from '../world/structures/stronghold.js';

// 探索列表：玩家周围村庄扫描 cell 半径（cell=20 区块 → ±960 格）；要塞环带 3 点全局 O(1)
const EXPLORE_VILLAGE_CELL_R = 3;

const MODES = [
  { name: 'creative', label: '创造', bg: '#4a8a4a', border: '#2a5a2a' },
  { name: 'survival', label: '生存', bg: '#8a4a4a', border: '#5a2a2a' },
  { name: 'spectator', label: '旁观', bg: '#4a4a8a', border: '#2a2a5a' }
];

const MOB_TYPES = [
  { name: 'zombie', label: '僵尸' },
  { name: 'skeleton', label: '骷髅' },
  { name: 'creeper', label: '苦力怕' },
  { name: 'spider', label: '蜘蛛' }
];

export class CommandPanel {
  constructor(game) {
    this.game = game;
    this.visible = false;

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; z-index: 35;
      background: rgba(0,0,0,0.6); align-items: center; justify-content: center;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; color: #fff;
    `;

    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      background: #2a2a2a; border: 3px solid #555; padding: 22px 28px;
      display: flex; flex-direction: column; gap: 14px; min-width: 360px;
    `;
    this.el.appendChild(this.panel);

    this._build();
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.hide(); });

    document.body.appendChild(this.el);
  }

  _mkLabel(text) {
    const l = document.createElement('div');
    l.textContent = text;
    l.style.cssText = 'font-size:13px; color:#bbd; font-weight:bold; letter-spacing:1px; margin-top:4px;';
    return l;
  }

  _mkBtn(label, bg, border) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `padding:8px 12px; font-size:13px; background:${bg}; color:#fff; border:2px solid ${border}; cursor:pointer; font-weight:bold;`;
    return b;
  }

  _mkInput(id, value) {
    const i = document.createElement('input');
    i.type = 'number';
    i.id = id;
    i.value = value;
    i.step = '0.5';
    i.style.cssText = 'padding:6px 8px; font-size:13px; background:rgba(0,0,0,0.4); border:1px solid #555; color:#fff; width:80px;';
    return i;
  }

  _build() {
    const title = document.createElement('div');
    title.textContent = '命令面板';
    title.style.cssText = 'font-size:20px; font-weight:bold; text-align:center; letter-spacing:2px; margin-bottom:4px;';
    this.panel.appendChild(title);

    // 1) 传送
    this.panel.appendChild(this._mkLabel('— 传送至坐标 —'));
    const tpRow = document.createElement('div');
    tpRow.style.cssText = 'display:flex; gap:8px; align-items:center;';
    tpRow.appendChild(this._mkLabel('X:'));
    this.tpX = this._mkInput('cmd-tp-x', 0);
    tpRow.appendChild(this.tpX);
    tpRow.appendChild(this._mkLabel('Y:'));
    this.tpY = this._mkInput('cmd-tp-y', 64);
    tpRow.appendChild(this.tpY);
    tpRow.appendChild(this._mkLabel('Z:'));
    this.tpZ = this._mkInput('cmd-tp-z', 0);
    tpRow.appendChild(this.tpZ);
    this.panel.appendChild(tpRow);

    const tpBtns = document.createElement('div');
    tpBtns.style.cssText = 'display:flex; gap:8px; margin-top:4px;';
    const tpBtn = this._mkBtn('传送', '#2a6a8a', '#1a4a6a');
    tpBtn.addEventListener('click', () => this._teleport());
    tpBtns.appendChild(tpBtn);
    const spawnBtn = this._mkBtn('返回出生点', '#4a6a8a', '#2a4a6a');
    spawnBtn.addEventListener('click', () => {
      const h = this.game.world.getHeightAt(0, 0);
      this.tpX.value = 0.5; this.tpY.value = (h + 2).toFixed(1); this.tpZ.value = 0.5;
      this._teleport();
    });
    tpBtns.appendChild(spawnBtn);
    const hereBtn = this._mkBtn('填入当前位置', '#555', '#333');
    hereBtn.addEventListener('click', () => {
      const p = this.game.player.position;
      this.tpX.value = p.x.toFixed(1);
      this.tpY.value = p.y.toFixed(1);
      this.tpZ.value = p.z.toFixed(1);
    });
    tpBtns.appendChild(hereBtn);
    this.panel.appendChild(tpBtns);

    // 1.5) 探索：附近建筑坐标（W2，show() 时刷新；点击行内按钮直接传送）
    this.panel.appendChild(this._mkLabel('— 探索：附近建筑 —'));
    this.exploreBox = document.createElement('div');
    this.exploreBox.style.cssText = `
      display: flex; flex-direction: column; gap: 3px; font-size: 12px;
      max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.25);
      padding: 6px 8px; border: 1px solid #444;
    `;
    this.panel.appendChild(this.exploreBox);

    // 2) 切换游戏模式
    this.panel.appendChild(this._mkLabel('— 切换游戏模式 —'));
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex; gap:8px;';
    this.modeBtns = [];
    for (const m of MODES) {
      const b = this._mkBtn(m.label, m.bg, m.border);
      b.addEventListener('click', () => {
        this.game.player.setMode(m.name);
        this._refreshModeHighlight();
      });
      modeRow.appendChild(b);
      this.modeBtns.push({ name: m.name, el: b });
    }
    this.panel.appendChild(modeRow);

    // 3) 生成实体（在玩家前方 3 格）
    this.panel.appendChild(this._mkLabel('— 生成实体（玩家前方 3 格）—'));
    const mobRow = document.createElement('div');
    mobRow.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap;';
    for (const mt of MOB_TYPES) {
      const b = this._mkBtn(mt.label, '#6a3a6a', '#4a2a4a');
      b.addEventListener('click', () => this._spawnMob(mt.name));
      mobRow.appendChild(b);
    }
    this.panel.appendChild(mobRow);

    // 4) 时间控制（0=半夜 0.25=日出 0.5=正午 0.75=日落）
    this.panel.appendChild(this._mkLabel('— 时间控制 (0=半夜 0.25=日出 0.5=正午 0.75=日落) —'));
    const timeRow = document.createElement('div');
    timeRow.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap;';
    const TIME_PRESETS = [
      { label: '日出', value: 0.25, bg: '#8a6a3a', border: '#5a4a2a' },
      { label: '正午', value: 0.50, bg: '#8a8a3a', border: '#5a5a2a' },
      { label: '日落', value: 0.75, bg: '#8a4a3a', border: '#5a2a2a' },
      { label: '半夜', value: 0.00, bg: '#3a3a6a', border: '#2a2a4a' }
    ];
    for (const tp of TIME_PRESETS) {
      const b = this._mkBtn(tp.label, tp.bg, tp.border);
      b.addEventListener('click', () => this._setTime(tp.value));
      timeRow.appendChild(b);
    }
    this.panel.appendChild(timeRow);

    const timeCustomRow = document.createElement('div');
    timeCustomRow.style.cssText = 'display:flex; gap:8px; align-items:center; margin-top:4px;';
    timeCustomRow.appendChild(this._mkLabel('Time:'));
    this.timeInput = this._mkInput('cmd-time', 0.5);
    this.timeInput.step = '0.05';
    this.timeInput.min = '0';
    this.timeInput.max = '1';
    timeCustomRow.appendChild(this.timeInput);
    const setBtn = this._mkBtn('设为', '#2a6a8a', '#1a4a6a');
    setBtn.addEventListener('click', () => this._setTime(parseFloat(this.timeInput.value)));
    timeCustomRow.appendChild(setBtn);
    const curTimeLabel = document.createElement('span');
    curTimeLabel.style.cssText = 'font-size:12px; color:#9ab; min-width:140px;';
    timeCustomRow.appendChild(curTimeLabel);
    this.curTimeLabel = curTimeLabel;
    this.panel.appendChild(timeCustomRow);

    // 关闭
    this.panel.appendChild(this._mkLabel(''));
    const closeBtn = this._mkBtn('关闭 (C / ESC)', '#555', '#333');
    closeBtn.addEventListener('click', () => this.hide());
    this.panel.appendChild(closeBtn);
  }

  _setTime(t) {
    if (typeof t !== 'number' || isNaN(t)) return;
    t = Math.max(0, Math.min(1, t));
    this.game.sky.time = t;
    this.timeInput.value = t.toFixed(2);
    this._refreshTimeLabel();
  }

  // W2：探索列表 —— 村庄（recordsAround ±3 cell）+ 要塞环带 3 点（seed 直接派生），
  // 按距离排序；每行带"传送"按钮（落地地表 +2）
  _refreshExplore() {
    const box = this.exploreBox;
    box.innerHTML = '';
    const world = this.game.world;
    const sm = world && world.generator && world.generator.structureManager;
    if (!sm) return;
    const p = this.game.player.position;
    const items = [];
    for (const rec of sm.recordsAround('village', p.x, p.z, EXPLORE_VILLAGE_CELL_R)) {
      const d = Math.hypot(rec.ax - p.x, rec.az - p.z);
      items.push({
        name: rec.meta && rec.meta.variant === 'desert' ? '沙漠村庄' : '村庄',
        x: rec.ax, z: rec.az, d,
      });
    }
    for (const pt of ringPoints(world.seed)) {
      items.push({ name: '要塞', x: pt.x, z: pt.z, d: Math.hypot(pt.x - p.x, pt.z - p.z) });
    }
    items.sort((a, b) => a.d - b.d);
    for (const it of items) {
      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px;';
      const label = document.createElement('span');
      label.style.cssText = 'color: #dde; white-space: nowrap;';
      label.textContent = `${it.name} (${it.x}, ${it.z}) · ${Math.round(it.d)}m · ${CommandPanel._compass(p.x, p.z, it.x, it.z)}`;
      row.appendChild(label);
      const btn = document.createElement('button');
      btn.textContent = '传送';
      btn.style.cssText = 'padding: 2px 8px; font-size: 11px; background: #2a6a8a; color: #fff; border: 1px solid #1a4a6a; cursor: pointer;';
      btn.addEventListener('click', () => {
        const h = world.getHeightAt(it.x, it.z);
        this.tpX.value = (it.x + 0.5).toFixed(1);
        this.tpY.value = (h + 3).toFixed(1);
        this.tpZ.value = (it.z + 0.5).toFixed(1);
        this._teleport();
        this.hide();
      });
      row.appendChild(btn);
      box.appendChild(row);
    }
  }

  // 8 方位（本作 -z 为北、+x 为东）
  static _compass(px, pz, tx, tz) {
    const dirs = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    const angle = Math.atan2(tx - px, -(tz - pz));
    const idx = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
    return dirs[idx];
  }

  _refreshTimeLabel() {
    const t = this.game.sky.time;
    let label;
    if (t < 0.05 || t >= 0.95) label = '半夜';
    else if (t < 0.20) label = '黎明前';
    else if (t < 0.30) label = '日出';
    else if (t < 0.45) label = '上午';
    else if (t < 0.55) label = '正午';
    else if (t < 0.70) label = '下午';
    else if (t < 0.80) label = '日落';
    else if (t < 0.90) label = '黄昏';
    else label = '入夜';
    this.curTimeLabel.textContent = '(当前: ' + t.toFixed(3) + ' ' + label + ')';
  }

  _refreshModeHighlight() {
    const cur = this.game.player.gamemode;
    for (const mb of this.modeBtns) {
      mb.el.style.outline = (mb.name === cur) ? '2px solid #fff' : 'none';
    }
  }

  _teleport() {
    const x = parseFloat(this.tpX.value) || 0;
    const y = parseFloat(this.tpY.value) || 0;
    const z = parseFloat(this.tpZ.value) || 0;
    this.game.player.position.set(x, y, z);
    this.game.player.velocity?.set(0, 0, 0);
  }

  _spawnMob(typeName) {
    const p = this.game.player;
    // 玩家前方 3 格的水平位置
    const yaw = p.yaw || 0;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const sx = p.position.x + fx * 3;
    const sz = p.position.z + fz * 3;
    const sy = this.game.world.getHeightAt(Math.floor(sx), Math.floor(sz)) + 1;
    const mob = new Mob(typeName, this.game.world);
    mob.position.set(sx, sy, sz);
    this.game.mobManager.spawnMob(mob);
  }

  show() {
    this.visible = true;
    // 进入时填入当前坐标
    const p = this.game.player.position;
    this.tpX.value = p.x.toFixed(1);
    this.tpY.value = p.y.toFixed(1);
    this.tpZ.value = p.z.toFixed(1);
    this.timeInput.value = this.game.sky.time.toFixed(2);
    this._refreshModeHighlight();
    this._refreshTimeLabel();
    this._refreshExplore();
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
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }
}