// InfoBar.js -- 游戏内左上角信息栏：坐标 / 生物群系 / 时间 / 准星目标 / 所处建筑 /（联机）网络 RTT
import { BiomeNames } from '../world/biomes.js';

const BUILDING_CHECK_INTERVAL = 500; // 建筑归属查询节流（毫秒）——recordsAround 按需求解不宜每帧

export class InfoBar {
  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; top: 8px; left: 8px; z-index: 10;
      padding: 6px 10px; background: rgba(0,0,0,0.45);
      border: 1px solid rgba(255,255,255,0.2); border-radius: 2px;
      color: #fff; font-family: monospace; font-size: 13px;
      line-height: 1.5; pointer-events: none; display: none;
      text-shadow: 1px 1px 0 #000;
    `;
    this.coordLine = document.createElement('div');
    this.biomeLine = document.createElement('div');
    this.biomeLine.style.cssText = 'color: #a0e0ff; margin-top: 2px;';
    this.timeLine = document.createElement('div');
    this.timeLine.style.cssText = 'color: #ffe0a0; margin-top: 2px;';
    this.targetLine = document.createElement('div');
    this.targetLine.style.cssText = 'color: #c0ffc0; margin-top: 2px;';
    this.buildingLine = document.createElement('div'); // W2：所处建筑（荒野时隐藏）
    this.buildingLine.style.cssText = 'color: #ffc0e0; margin-top: 2px; display: none;';
    this.rttLine = document.createElement('div'); // 阶段10：联机 RTT（无数据显示且不占行高）
    this.rttLine.style.cssText = 'color: #c8b8ff; margin-top: 2px; display: none;';
    this.el.appendChild(this.coordLine);
    this.el.appendChild(this.biomeLine);
    this.el.appendChild(this.timeLine);
    this.el.appendChild(this.targetLine);
    this.el.appendChild(this.buildingLine);
    this.el.appendChild(this.rttLine);
    document.body.appendChild(this.el);
    this._biomeCache = new Map();
    this._buildingCheckAt = 0;
    this._building = null;
  }

  show() { this.el.style.display = 'block'; }
  hide() { this.el.style.display = 'none'; }

  // update(player, generator, sky, crosshairInfo, rttMs = null, dimensionName = null)
  //   crosshairInfo: null 或 { type: 'block'|'mob', displayName, name }
  //   rttMs: 阶段10 联机平滑 RTT（毫秒），null=单机/未测得（隐藏该行）
  //   dimensionName: 非主世界维度名（生物群系行加"维度: X ｜"前缀；null=主世界）
  update(player, generator, sky, crosshairInfo, rttMs = null, dimensionName = null) {
    const x = player.position.x;
    const y = player.position.y;
    const z = player.position.z;
    this.coordLine.textContent = `XYZ: ${x.toFixed(2)} / ${y.toFixed(2)} / ${z.toFixed(2)}`;

    // 生物群系全维度显示：维度生成器自带 biomeNames 名表（主世界走 biomes.js 的 BiomeNames）；
    // 非主世界额外前缀"维度: X ｜"
    const biome = generator.getBiome(x, z);
    const biomeLabel = generator.biomeNames ? generator.biomeNames[biome] : BiomeNames[biome];
    this.biomeLine.textContent = dimensionName
      ? `维度: ${dimensionName} ｜ 生物群系: ${biomeLabel || '未知'}`
      : `生物群系: ${biomeLabel || '未知'}`;

    if (sky) {
      if (sky.dimDef && sky.dimDef.sky && sky.dimDef.sky.polarDay) {
        // 永昼维度（天域）：太阳恒亮无时钟语义
        this.timeLine.textContent = '时间: 永昼';
      } else if (sky.dimDef && sky.dimDef.noDayCycle) {
        // 无昼夜维度（下界/末地）：时钟无意义
        this.timeLine.textContent = '时间: 无昼夜';
      } else {
        const t = sky.time;
        const totalMinutes = Math.floor(t * 24 * 60);
        const hh = Math.floor(totalMinutes / 60) % 24;
        const mm = totalMinutes % 60;
        const hhStr = String(hh).padStart(2, '0');
        const mmStr = String(mm).padStart(2, '0');
        this.timeLine.textContent = `时间: ${hhStr}:${mmStr}`;
      }
    }

    if (crosshairInfo) {
      const label = crosshairInfo.type === 'mob' ? '准星实体' : '准星方块';
      this.targetLine.textContent = `${label}: ${crosshairInfo.displayName}`;
    } else {
      this.targetLine.textContent = '';
    }

    // W2：所处建筑（0.5s 节流；荒野隐藏该行）
    const now = performance.now();
    if (now - this._buildingCheckAt > BUILDING_CHECK_INTERVAL) {
      this._buildingCheckAt = now;
      const sm = generator && generator.structureManager;
      this._building = (sm && sm.structureNameAt) ? sm.structureNameAt(x, z) : null;
    }
    if (this._building) {
      this.buildingLine.style.display = 'block';
      this.buildingLine.textContent = `建筑: ${this._building}`;
    } else {
      this.buildingLine.style.display = 'none';
    }

    if (rttMs != null) {
      this.rttLine.style.display = 'block';
      this.rttLine.textContent = `网络: ${Math.round(rttMs)}ms`;
    } else {
      this.rttLine.style.display = 'none';
    }
  }
}