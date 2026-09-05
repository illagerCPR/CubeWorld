// RecipeViewer.js -- JEI 风格配方查询伴随面板（容器界面打开时自动显示于屏幕右缘）
// 左侧收藏夹（A 键收藏，localStorage 全局持久）+ 右侧全物品列表（搜索过滤）
// + 配方详情弹窗（物品列表左侧弹出）：合成（shaped/shapeless）与熔炼（Smelting）配方。
// R 查配方 / U 查用途 / A 收藏 / J 开关面板（无容器界面时按 J 打开背包）。
// 纯查询界面：不改背包、不产生物品；配方内材料图标可点击继续导航；
// 不接管 controls（随容器界面显隐，容器界面自身已处理指针与按键）。
import { getAllRecipes } from '../core/Crafting.js';
import { getAllSmeltingRecipes, getFuelTime, SMELT_TIME } from '../core/Smelting.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { SVGTextures } from '../render/SVGTextures.js';

const FAV_KEY = 'cubeworld-jei-favorites';
const PANEL_KEY = 'cubeworld-jei-panel-enabled';

function getDisplayName(name) {
  const item = ItemRegistry.getByName(name);
  if (item && item.displayName && item.displayName !== name) return item.displayName;
  const block = BlockRegistry.getByName(name);
  if (block && block.displayName && block.displayName !== name) return block.displayName;
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export class RecipeViewer {
  constructor(game) {
    this.game = game;
    this.visible = false;          // 面板当前是否显示（容器界面打开 且 用户未用 J 关闭）
    this.containerVisible = false; // 是否有容器界面打开（每帧从各 screen 同步）
    this.userEnabled = this._loadEnabled(); // J 键开关的面板偏好（全局持久）
    this.mode = 'recipes';    // recipes=查看该物品配方 | usages=查看该物品作为材料的配方
    this.current = null;      // 当前查看的物品名（非空时显示配方弹窗）
    this._hoverName = null;   // 面板内悬浮的物品名（R/U/A 作用目标）
    this._shown = false;      // DOM 显示状态（防每帧重渲染）
    this._searchText = '';
    this.favorites = this._loadFavorites();

    // 主竖条：搜索 + 左收藏夹 + 右全物品
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: fixed; right: 6px; top: 50%; transform: translateY(-50%);
      width: 200px; height: min(86vh, 720px);
      display: none; flex-direction: column; gap: 6px;
      background: #c6c6c6; border: 3px solid #555; box-shadow: 0 0 0 2px #000;
      padding: 6px; box-sizing: border-box; z-index: 35;
      font-family: 'Segoe UI', sans-serif; user-select: none;
    `;
    document.body.appendChild(this.el);

    // 配方详情弹窗（竖条左侧，仅当前有查看物品时显示）
    this.popEl = document.createElement('div');
    this.popEl.style.cssText = `
      position: fixed; right: 214px; top: 50%; transform: translateY(-50%);
      width: 340px; height: min(86vh, 720px);
      display: none; flex-direction: column;
      background: #c6c6c6; border: 3px solid #555; box-shadow: 0 0 0 2px #000;
      padding: 8px; box-sizing: border-box; z-index: 35;
      font-family: 'Segoe UI', sans-serif; user-select: none;
    `;
    this.popTitle = document.createElement('div');
    this.popTitle.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';
    this.popName = document.createElement('div');
    this.popName.style.cssText = 'flex: 1; font-size: 14px; font-weight: bold; color: #333; min-width: 0;';
    this.popTitle.appendChild(this.popName);
    this.popClose = document.createElement('button');
    this.popClose.textContent = '✕';
    this.popClose.title = '关闭配方详情';
    this.popClose.style.cssText = 'padding: 2px 8px; cursor: pointer;';
    this.popClose.addEventListener('click', () => { this.current = null; this.renderRecipe(); });
    this.popTitle.appendChild(this.popClose);
    this.popEl.appendChild(this.popTitle);
    this.popScroll = document.createElement('div');
    this.popScroll.style.cssText = 'overflow-y: auto; flex: 1; min-height: 0;';
    this.popEl.appendChild(this.popScroll);
    document.body.appendChild(this.popEl);
  }

  dispose() {
    this.el.remove();
    this.popEl.remove();
  }

  _loadFavorites() {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(n => typeof n === 'string') : [];
    } catch { return []; }
  }

  _saveFavorites() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(this.favorites)); } catch { /* ignore */ }
  }

  _loadEnabled() {
    try {
      const v = localStorage.getItem(PANEL_KEY);
      return v === null ? true : v === '1';
    } catch { return true; }
  }

  _saveEnabled() {
    try { localStorage.setItem(PANEL_KEY, this.userEnabled ? '1' : '0'); } catch { /* ignore */ }
  }

  // J 键：容器界面打开时切换面板显隐（偏好持久化）
  togglePanel() {
    this.setUserEnabled(!this.userEnabled);
  }

  setUserEnabled(v) {
    this.userEnabled = !!v;
    this._saveEnabled();
    this._syncDisplay();
  }

  // 每帧同步：跟随容器界面（背包/箱子/合成台/熔炉/交易）显隐
  updateFrame() {
    const g = this.game;
    this.containerVisible = !!(
      (g.inventoryScreen && g.inventoryScreen.visible) ||
      (g.chestScreen && g.chestScreen.visible) ||
      (g.furnaceScreen && g.furnaceScreen.visible) ||
      (g.tradeScreen && g.tradeScreen.visible)
    );
    this._syncDisplay();
  }

  _syncDisplay() {
    const want = this.containerVisible && this.userEnabled;
    if (want === this._shown) return;
    this._shown = want;
    this.visible = want;
    if (want) {
      this.el.style.display = 'flex';
      this._buildShell();
    } else {
      this.el.style.display = 'none';
      this._hoverName = null;
    }
    this.renderRecipe(); // 弹窗跟随面板显隐
  }

  // 从物品打开配方视图（容器界面内 hover 按 R）
  showFor(name) {
    if (!name) return;
    this._ensureShown();
    this.mode = 'recipes';
    this.current = name;
    this.renderRecipe();
  }

  // 从物品打开用途视图（按 U）
  showUsages(name) {
    if (!name) return;
    this._ensureShown();
    this.mode = 'usages';
    this.current = name;
    this.renderRecipe();
  }

  // 面板被 J 关闭时，主动查询配方应重新启用（用户意图明确）
  _ensureShown() {
    if (!this.userEnabled && this.containerVisible) this.setUserEnabled(true);
  }

  // R/U/A 的作用目标：面板内悬浮 > 容器界面内悬浮 > 当前查看物品
  _actionTarget() {
    if (this._hoverName) return this._hoverName;
    const g = this.game;
    if (g && typeof g._uiHoverName === 'function') {
      const h = g._uiHoverName();
      if (h) return h;
    }
    return this.current;
  }

  onKeyR() {
    const t = this._actionTarget();
    if (t) { this.mode = 'recipes'; this.current = t; this.renderRecipe(); }
  }

  onKeyU() {
    const t = this._actionTarget();
    if (t) { this.mode = 'usages'; this.current = t; this.renderRecipe(); }
  }

  onKeyA() {
    const t = this._actionTarget();
    if (!t) return;
    const i = this.favorites.indexOf(t);
    if (i >= 0) this.favorites.splice(i, 1);
    else this.favorites.push(t);
    this._saveFavorites();
    this.renderFavorites();
    this.renderList(); // 列表内收藏角标刷新
  }

  // ── 数据 ──
  _allItems() {
    // 方块优先；同名物品跳过（与创造物品栏去重规则一致）
    const blocks = BlockRegistry.all().filter(b => b.name !== 'air');
    const seen = new Set(blocks.map(b => b.name));
    const items = ItemRegistry.all().filter(b => b.name !== 'air' && !seen.has(b.name));
    return [...blocks, ...items];
  }

  // 物品的全部获取配方（合成 + 熔炼）
  _recipesFor(name) {
    const crafting = getAllRecipes().filter(r => r.output === name);
    const smelting = getAllSmeltingRecipes().filter(r => r.output === name);
    return { crafting, smelting };
  }

  // 物品作为材料出现的全部配方
  _usagesFor(name) {
    const crafting = getAllRecipes().filter(r => {
      if (r.type === 'shaped') return r.pattern.some(row => row.includes(name));
      return r.ingredients.includes(name);
    });
    const smelting = getAllSmeltingRecipes().filter(r => r.input === name);
    return { crafting, smelting };
  }

  // ── 渲染 ──
  // 竖条骨架：每次显示时重建（搜索词保留）
  _buildShell() {
    this.el.innerHTML = '';
    this.searchInput = document.createElement('input');
    this.searchInput.placeholder = '搜索物品…';
    this.searchInput.value = this._searchText;
    this.searchInput.style.cssText = `
      padding: 4px 8px; border: 2px solid #555; background: #8b8b8b;
      color: #fff; font-size: 13px; outline: none; box-sizing: border-box;
    `;
    this.searchInput.addEventListener('input', () => {
      this._searchText = this.searchInput.value;
      this.renderList();
    });
    // 阻止按键冒泡到 Game 快捷键（E/J/R/U/A/数字键）
    this.searchInput.addEventListener('keydown', (e) => e.stopPropagation());
    this.el.appendChild(this.searchInput);

    const body = document.createElement('div');
    body.style.cssText = 'display: flex; gap: 6px; flex: 1; min-height: 0;';

    this.favCol = document.createElement('div');
    this.favCol.style.cssText = 'width: 40px; display: flex; flex-direction: column; background: #999; border: 2px solid #555; padding: 2px; box-sizing: border-box;';
    body.appendChild(this.favCol);

    this.listCol = document.createElement('div');
    this.listCol.style.cssText = 'flex: 1; display: flex; flex-direction: column; background: #999; border: 2px solid #555; padding: 4px; box-sizing: border-box; min-width: 0;';
    body.appendChild(this.listCol);

    this.el.appendChild(body);
    this.renderFavorites();
    this.renderList();
  }

  _itemCell(name, size = 36, opts = {}) {
    const cell = document.createElement('div');
    cell.style.cssText = `
      width: ${size}px; height: ${size}px; background: #8b8b8b; border: 2px solid #555;
      position: relative; display: flex; align-items: center; justify-content: center;
      cursor: pointer; image-rendering: pixelated; box-sizing: content-box; flex: none;
    `;
    cell.title = getDisplayName(name);
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    canvas.style.cssText = `width: ${size - 8}px; height: ${size - 8}px; image-rendering: pixelated;`;
    cell.appendChild(canvas);
    this._drawIcon(canvas, name);
    if (opts.count > 1) {
      const c = document.createElement('div');
      c.textContent = opts.count;
      c.style.cssText = 'position: absolute; right: 1px; bottom: 0; color: #fff; font-size: 12px; font-weight: bold; text-shadow: 1px 1px 0 #000;';
      cell.appendChild(c);
    }
    if (opts.fav) {
      const star = document.createElement('div');
      star.textContent = '★';
      star.style.cssText = 'position: absolute; left: 0; top: -2px; color: #ffd700; font-size: 12px; text-shadow: 1px 1px 0 #000; pointer-events: none;';
      cell.appendChild(star);
    }
    // 悬浮记录（R/U/A 目标）+ 点击导航
    cell.addEventListener('mouseenter', () => { this._hoverName = name; });
    cell.addEventListener('mouseleave', () => { if (this._hoverName === name) this._hoverName = null; });
    cell.addEventListener('click', () => {
      this.current = name;
      if (this.mode === 'usages') this.renderRecipe();
      else { this.mode = 'recipes'; this.renderRecipe(); }
    });
    if (!opts.noNav) cell.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.mode = 'usages';
      this.current = name;
      this.renderRecipe();
    });
    return cell;
  }

  async _drawIcon(canvas, name) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 32, 32);
    let svgText = null;
    const item = ItemRegistry.getByName(name);
    if (item && this.game.itemSvgMap[name]) svgText = this.game.itemSvgMap[name];
    if (!svgText) {
      const block = BlockRegistry.getByName(name);
      if (block) {
        const texName = block.side || block.top;
        if (this.game.blockSvgMap[texName]) svgText = this.game.blockSvgMap[texName];
      }
    }
    if (svgText) {
      const img = await SVGTextures.svgToImage(svgText);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, 32, 32);
    }
  }

  renderFavorites() {
    if (!this.favCol) return;
    this.favCol.innerHTML = '';
    const h = document.createElement('div');
    h.textContent = '★';
    h.title = '收藏夹（对物品按 A 收藏/取消）';
    h.style.cssText = 'font-size: 12px; font-weight: bold; color: #333; text-align: center; flex: none;';
    this.favCol.appendChild(h);
    const scroll = document.createElement('div');
    scroll.style.cssText = 'display: flex; flex-direction: column; gap: 3px; overflow-y: auto; flex: 1; align-items: center; padding-top: 3px;';
    if (this.favorites.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'A\n收\n藏';
      empty.title = '对物品按 A 键加入收藏夹';
      empty.style.cssText = 'color: #555; font-size: 10px; text-align: center; line-height: 1.4; padding-top: 4px; white-space: pre-line;';
      scroll.appendChild(empty);
    } else {
      for (const name of this.favorites) scroll.appendChild(this._itemCell(name, 34));
    }
    this.favCol.appendChild(scroll);
  }

  renderList() {
    if (!this.listCol) return;
    this.listCol.innerHTML = '';
    const h = document.createElement('div');
    h.textContent = '全部物品';
    h.title = '点击看配方 / 右键看用途 / A 收藏';
    h.style.cssText = 'font-size: 11px; font-weight: bold; color: #333; margin-bottom: 3px; flex: none;';
    this.listCol.appendChild(h);
    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, 36px); gap: 3px; align-content: start; overflow-y: auto; flex: 1; justify-content: space-around;';
    const filter = this._searchText.trim().toLowerCase();
    const favSet = new Set(this.favorites);
    let shown = 0;
    for (const def of this._allItems()) {
      if (filter && !def.name.includes(filter) &&
          !(def.displayName && def.displayName.toLowerCase().includes(filter))) continue;
      grid.appendChild(this._itemCell(def.name, 36, { fav: favSet.has(def.name) }));
      shown++;
      if (shown >= 400) break; // 搜索未过滤时不至于一次画几千格
    }
    if (shown === 0) {
      const empty = document.createElement('div');
      empty.textContent = '无匹配物品';
      empty.style.cssText = 'color: #444; font-size: 12px; padding: 6px;';
      grid.appendChild(empty);
    } else if (shown >= 400 && !filter) {
      const tip = document.createElement('div');
      tip.textContent = '仅显示前 400 个，搜索可缩小范围';
      tip.style.cssText = 'grid-column: 1 / -1; color: #444; font-size: 10px; padding: 4px;';
      grid.appendChild(tip);
    }
    this.listCol.appendChild(grid);
  }

  renderRecipe() {
    if (!this.popEl) return;
    const show = !!this.current && this._shown;
    this.popEl.style.display = show ? 'flex' : 'none';
    if (!show) return;
    this.popScroll.innerHTML = '';
    const modeLabel = this.mode === 'usages' ? '用途（作为材料）' : '获取配方';
    this.popName.innerHTML = `<b>${getDisplayName(this.current)}</b> · ${modeLabel}`;

    const { crafting, smelting } = this.mode === 'usages'
      ? this._usagesFor(this.current)
      : this._recipesFor(this.current);

    if (crafting.length === 0 && smelting.length === 0) {
      const none = document.createElement('div');
      none.textContent = this.mode === 'usages' ? '没有以该物品为材料的配方' : '没有已注册的配方（可能只能从世界获取）';
      none.style.cssText = 'font-size: 12px; color: #444; padding: 6px;';
      this.popScroll.appendChild(none);
    }

    if (crafting.length > 0) {
      const sec = document.createElement('div');
      sec.textContent = '合成';
      sec.style.cssText = 'font-size: 12px; font-weight: bold; color: #333; margin: 4px 0;';
      this.popScroll.appendChild(sec);
      for (const r of crafting) this.popScroll.appendChild(this._craftingRow(r));
    }

    if (smelting.length > 0) {
      const sec = document.createElement('div');
      sec.textContent = '熔炼（熔炉）';
      sec.style.cssText = 'font-size: 12px; font-weight: bold; color: #333; margin: 8px 0 4px 0;';
      this.popScroll.appendChild(sec);
      for (const r of smelting) this.popScroll.appendChild(this._smeltingRow(r));
    }

    // 操作提示行
    const ops = document.createElement('div');
    ops.style.cssText = 'font-size: 11px; color: #444; margin-top: 6px; flex: none;';
    ops.innerHTML = 'R 配方 · U 用途 · A 收藏当前/悬浮物品';
    this.popScroll.appendChild(ops);
  }

  // 一条合成配方：材料格 → 箭头 → 产出
  _craftingRow(r) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px; background: #8b8b8b; padding: 6px; border: 1px solid #666;';
    const matWrap = document.createElement('div');
    if (r.type === 'shaped') {
      const cols = Math.max(...r.pattern.map(row => row.length));
      const grid = document.createElement('div');
      grid.style.cssText = `display: grid; grid-template-columns: repeat(${cols}, 32px); gap: 2px;`;
      for (const cells of r.pattern) {
        for (let c = 0; c < cols; c++) {
          const name = cells[c] || null;
          grid.appendChild(name ? this._itemCell(name, 32) : this._emptyCell(32));
        }
      }
      matWrap.appendChild(grid);
    } else {
      // shapeless：材料排一行
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display: flex; flex-wrap: wrap; gap: 2px; max-width: 180px;';
      for (const name of r.ingredients) wrap.appendChild(this._itemCell(name, 32));
      matWrap.appendChild(wrap);
    }
    row.appendChild(matWrap);
    row.appendChild(this._arrow());
    row.appendChild(this._itemCell(r.output, 36, { count: r.count }));
    return row;
  }

  // 一条熔炼配方：input → 火焰箭头 → output
  _smeltingRow(r) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px; background: #8b8b8b; padding: 6px; border: 1px solid #666;';
    row.appendChild(this._itemCell(r.input, 36));
    const fuel = document.createElement('div');
    fuel.textContent = '🔥';
    fuel.title = `熔炉 ${SMELT_TIME}s · 燃料如煤炭（煤可烧 ${Math.floor(getFuelTime('coal') / SMELT_TIME)} 个）`;
    fuel.style.cssText = 'font-size: 14px;';
    row.appendChild(fuel);
    row.appendChild(this._itemCell(r.output, 36, { count: r.count }));
    return row;
  }

  _arrow() {
    const a = document.createElement('div');
    a.textContent = '→';
    a.style.cssText = 'font-size: 18px; color: #333;';
    return a;
  }

  _emptyCell(size) {
    const d = document.createElement('div');
    d.style.cssText = `width: ${size}px; height: ${size}px; background: #777; border: 2px solid #555; box-sizing: content-box; flex: none;`;
    return d;
  }
}
