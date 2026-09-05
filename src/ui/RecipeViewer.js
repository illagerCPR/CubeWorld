// RecipeViewer.js -- JEI 风格配方查询浮层（J 键开关）
// 左侧收藏夹（A 键收藏，localStorage 全局持久）+ 右侧全物品列表（搜索过滤）
// + 配方区：合成（shaped/shapeless）与熔炼（Smelting）配方；R 查配方 / U 查用途。
// 纯查询界面：不改背包、不产生物品；配方内材料图标可点击继续导航。
import { getAllRecipes } from '../core/Crafting.js';
import { getAllSmeltingRecipes, getFuelTime, SMELT_TIME } from '../core/Smelting.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { SVGTextures } from '../render/SVGTextures.js';

const FAV_KEY = 'cubeworld-jei-favorites';

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
    this.visible = false;
    this.mode = 'recipes';    // recipes=查看该物品配方 | usages=查看该物品作为材料的配方
    this.current = null;      // 当前查看的物品名
    this._hoverName = null;   // 浮层内悬浮的物品名（R/U/A 作用对象）
    this._prevControls = false;
    this.favorites = this._loadFavorites();

    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; z-index: 60;
      background: rgba(0,0,0,0.55); align-items: center; justify-content: center;
      font-family: 'Segoe UI', sans-serif;
    `;
    this.el.addEventListener('mousedown', (e) => { if (e.target === this.el) this.hide(); });

    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      background: #c6c6c6; border: 4px solid #555; box-shadow: 0 0 0 2px #000;
      width: min(980px, 94vw); height: min(640px, 88vh);
      display: flex; flex-direction: column; user-select: none; padding: 10px;
    `;
    this.el.appendChild(this.panel);
    document.body.appendChild(this.el);
  }

  dispose() {
    this.el.remove();
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

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  show() {
    this.visible = true;
    this._prevControls = this.game.controls ? this.game.controls.enabled : false;
    this.el.style.display = 'flex';
    this.renderAll();
    if (this.game.controls) {
      this.game.controls.enabled = false;
      this.game.controls.mouseLeft = false;
      this.game.controls.mouseRight = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // 从物品打开配方视图（背包/箱子/熔炉内 hover 按 R）
  showFor(name) {
    if (!name) return;
    this.mode = 'recipes';
    this.current = name;
    this.show();
  }

  // 从物品打开用途视图（按 U）
  showUsages(name) {
    if (!name) return;
    this.mode = 'usages';
    this.current = name;
    this.show();
  }

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
    this._hoverName = null;
    if (this.game.controls) this.game.controls.enabled = this._prevControls;
  }

  // R/U/A 在浮层内的作用目标：优先悬浮格，否则当前物品
  _actionTarget() {
    return this._hoverName || this.current;
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
    const t = this._hoverName || this.current;
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
  renderAll() {
    this.panel.innerHTML = '';
    // 头部：标题 + 搜索 + 关闭
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-bottom: 8px;';
    const title = document.createElement('div');
    title.textContent = '物品与配方查询 (JEI)';
    title.style.cssText = 'font-size: 15px; font-weight: bold; color: #333;';
    header.appendChild(title);
    this.searchInput = document.createElement('input');
    this.searchInput.placeholder = '搜索物品…';
    this.searchInput.style.cssText = `
      flex: 1; padding: 4px 8px; border: 2px solid #555; background: #8b8b8b;
      color: #fff; font-size: 13px; outline: none;
    `;
    this.searchInput.addEventListener('input', () => this.renderList());
    this.searchInput.addEventListener('keydown', (e) => e.stopPropagation());
    header.appendChild(this.searchInput);
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ 关闭';
    closeBtn.style.cssText = 'padding: 4px 10px; cursor: pointer;';
    closeBtn.addEventListener('click', () => this.hide());
    header.appendChild(closeBtn);
    this.panel.appendChild(header);

    // 三列：收藏夹 | 全部物品 | 配方区
    const body = document.createElement('div');
    body.style.cssText = 'display: flex; gap: 8px; flex: 1; min-height: 0;';
    this.favCol = document.createElement('div');
    this.favCol.style.cssText = 'width: 172px; display: flex; flex-direction: column; background: #999; border: 2px solid #555; padding: 4px;';
    body.appendChild(this.favCol);

    this.listCol = document.createElement('div');
    this.listCol.style.cssText = 'flex: 1; display: flex; flex-direction: column; background: #999; border: 2px solid #555; padding: 4px; min-width: 0;';
    body.appendChild(this.listCol);

    this.recipeCol = document.createElement('div');
    this.recipeCol.style.cssText = 'width: 330px; display: flex; flex-direction: column; background: #999; border: 2px solid #555; padding: 4px;';
    body.appendChild(this.recipeCol);

    this.panel.appendChild(body);
    this.renderFavorites();
    this.renderList();
    this.renderRecipe();
  }

  _itemCell(name, size = 36, opts = {}) {
    const cell = document.createElement('div');
    cell.style.cssText = `
      width: ${size}px; height: ${size}px; background: #8b8b8b; border: 2px solid #555;
      position: relative; display: flex; align-items: center; justify-content: center;
      cursor: pointer; image-rendering: pixelated; box-sizing: content-box;
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
    this.favCol.innerHTML = '';
    const h = document.createElement('div');
    h.textContent = '★ 收藏夹';
    h.style.cssText = 'font-size: 13px; font-weight: bold; color: #333; margin-bottom: 4px;';
    this.favCol.appendChild(h);
    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(4, 36px); gap: 3px; align-content: start;';
    for (const name of this.favorites) grid.appendChild(this._itemCell(name, 36));
    this.favCol.appendChild(grid);
    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top: auto; font-size: 11px; color: #444; line-height: 1.6;';
    hint.innerHTML = 'A 收藏/取消<br>R 查看配方<br>U 查看用途<br>右键 = 用途';
    this.favCol.appendChild(hint);
  }

  renderList() {
    this.listCol.innerHTML = '';
    const h = document.createElement('div');
    h.textContent = `全部物品（点击看配方 / A 收藏）`;
    h.style.cssText = 'font-size: 13px; font-weight: bold; color: #333; margin-bottom: 4px;';
    this.listCol.appendChild(h);
    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, 42px); gap: 3px; align-content: start; overflow-y: auto; flex: 1;';
    const filter = (this.searchInput ? this.searchInput.value : '').trim().toLowerCase();
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
    }
    this.listCol.appendChild(grid);
  }

  renderRecipe() {
    if (!this.recipeCol) return;
    this.recipeCol.innerHTML = '';
    const h = document.createElement('div');
    const modeLabel = this.mode === 'usages' ? '用途（作为材料）' : '获取配方';
    h.innerHTML = this.current
      ? `<b>${getDisplayName(this.current)}</b> · ${modeLabel}`
      : '点击左侧物品查看配方';
    h.style.cssText = 'font-size: 13px; color: #333; margin-bottom: 6px;';
    this.recipeCol.appendChild(h);

    if (!this.current) {
      const tip = document.createElement('div');
      tip.style.cssText = 'font-size: 12px; color: #444; line-height: 1.8;';
      tip.innerHTML = '← 点击任意物品<br>R = 配方 · U = 用途 · A = 收藏<br>熔炉配方同样收录（火焰标记）';
      this.recipeCol.appendChild(tip);
      return;
    }

    const scroll = document.createElement('div');
    scroll.style.cssText = 'overflow-y: auto; flex: 1;';
    const { crafting, smelting } = this.mode === 'usages'
      ? this._usagesFor(this.current)
      : this._recipesFor(this.current);

    if (crafting.length === 0 && smelting.length === 0) {
      const none = document.createElement('div');
      none.textContent = this.mode === 'usages' ? '没有以该物品为材料的配方' : '没有已注册的配方（可能只能从世界获取）';
      none.style.cssText = 'font-size: 12px; color: #444; padding: 6px;';
      scroll.appendChild(none);
    }

    if (crafting.length > 0) {
      const sec = document.createElement('div');
      sec.textContent = '合成';
      sec.style.cssText = 'font-size: 12px; font-weight: bold; color: #333; margin: 4px 0;';
      scroll.appendChild(sec);
      for (const r of crafting) scroll.appendChild(this._craftingRow(r));
    }

    if (smelting.length > 0) {
      const sec = document.createElement('div');
      sec.textContent = '熔炼（熔炉）';
      sec.style.cssText = 'font-size: 12px; font-weight: bold; color: #333; margin: 8px 0 4px 0;';
      scroll.appendChild(sec);
      for (const r of smelting) scroll.appendChild(this._smeltingRow(r));
    }
    this.recipeCol.appendChild(scroll);

    // 操作提示行
    const ops = document.createElement('div');
    ops.style.cssText = 'font-size: 11px; color: #444; margin-top: 4px;';
    ops.innerHTML = 'R 配方 · U 用途 · A 收藏当前/悬浮物品';
    this.recipeCol.appendChild(ops);
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
    d.style.cssText = `width: ${size}px; height: ${size}px; background: #777; border: 2px solid #555; box-sizing: content-box;`;
    return d;
  }
}
