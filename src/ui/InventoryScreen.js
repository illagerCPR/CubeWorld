// InventoryScreen.js -- 背包界面（E 键打开）
// 支持创造模式物品列表 + 生存模式拖放物品 + 2x2/3x3 合成
import { SVGTextures } from '../render/SVGTextures.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { matchRecipe } from '../core/Crafting.js';

function getDisplayName(name) {
  const item = ItemRegistry.getByName(name);
  if (item && item.displayName && item.displayName !== name) return item.displayName;
  const block = BlockRegistry.getByName(name);
  if (block && block.displayName && block.displayName !== name) return block.displayName;
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export class InventoryScreen {
  constructor(inventory, player, game) {
    this.inventory = inventory;
    this.player = player;
    this.game = game;
    this.visible = false;
    this.creativeScroll = 0;
    this.craftSize = 2; // 2x2 背包合成，3x3 工作台合成
    this.craftGrid = []; // 合成网格物品 {name,count,data} | null
    
    this.el = document.createElement('div');
    this.el.style.cssText = `
      position: absolute; inset: 0; display: none; z-index: 30;
      background: rgba(0,0,0,0.5); align-items: center; justify-content: center;
    `;
    
    this.panel = document.createElement('div');
    this.panel.style.cssText = `
      background: #c6c6c6; border: 4px solid #555; padding: 12px;
      box-shadow: 0 0 0 2px #000; font-family: 'Segoe UI', sans-serif;
      user-select: none; display: inline-block; width: max-content;
    `;
    this.el.appendChild(this.panel);
    document.body.appendChild(this.el);
    
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.hide();
    });
    
    // 拖拽中的物品（鼠标跟随）
    this.cursorItem = null; // {name, count, data}
    this.cursorEl = document.createElement('div');
    this.cursorEl.style.cssText = `
      position: fixed; width: 44px; height: 44px; pointer-events: none;
      z-index: 100; display: none; image-rendering: pixelated;
    `;
    document.body.appendChild(this.cursorEl);

    // 物品悬浮提示框
    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText = `
      position: fixed; padding: 4px 8px; background: rgba(10,10,10,0.92);
      color: #fff; font-family: monospace; font-size: 13px; z-index: 200;
      pointer-events: none; display: none; border: 1px solid rgba(255,255,255,0.3);
      text-shadow: 1px 1px 0 #000; max-width: 220px;
    `;
    document.body.appendChild(this.tooltip);
    
    document.addEventListener('mousemove', (e) => {
      if (this.cursorItem) {
        this.cursorEl.style.left = (e.clientX - 22) + 'px';
        this.cursorEl.style.top = (e.clientY - 22) + 'px';
      }
    });
    
    // 右键拖拽时放置单个
    document.addEventListener('contextmenu', (e) => {
      if (this.visible) e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.visible) { this.tooltip.style.display = 'none'; return; }
      if (this._hoverEl && this._hoverEl.contains(e.target)) {
        this.tooltip.style.left = (e.clientX + 14) + 'px';
        this.tooltip.style.top = (e.clientY + 14) + 'px';
      }
    });
  }

  _bindHover(slot, name) {
    slot.onmouseenter = () => {
      if (!name) { this.tooltip.style.display = 'none'; return; }
      this.tooltip.textContent = getDisplayName(name);
      this.tooltip.style.display = 'block';
      this._hoverEl = slot;
    };
    slot.onmouseleave = () => {
      this.tooltip.style.display = 'none';
      this._hoverEl = null;
    };
  }

  show(craftSize = 2) {
    this.visible = true;
    this.craftSize = craftSize;
    this.craftGrid = new Array(craftSize * craftSize).fill(null);
    this.el.style.display = 'flex';
    this.render();
    if (this.game && this.game.controls) {
      this.game.controls.enabled = false;
      this.game.controls.mouseLeft = false;
      this.game.controls.mouseRight = false;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  hide() {
    this.returnCraftGrid();
    this.returnCursorItem();
    this.visible = false;
    this.el.style.display = 'none';
    if (this.game && this.game.controls) {
      this.game.controls.enabled = true;
    }
  }

  toggle(craftSize = 2) {
    if (this.visible) this.hide();
    else this.show(craftSize);
  }

  returnCraftGrid() {
    if (!this.craftGrid) return;
    for (let i = 0; i < this.craftGrid.length; i++) {
      if (this.craftGrid[i]) {
        this.inventory.add(this.craftGrid[i].name, this.craftGrid[i].count, this.craftGrid[i].data);
        this.craftGrid[i] = null;
      }
    }
    this.game.hotbar.update();
  }

  returnCursorItem() {
    if (this.cursorItem) {
      this.inventory.add(this.cursorItem.name, this.cursorItem.count, this.cursorItem.data);
      this.cursorItem = null;
      this.cursorEl.style.display = 'none';
      this.cursorEl.innerHTML = '';
      this.game.hotbar.update();
    }
    this.tooltip.style.display = 'none';
    this._hoverEl = null;
  }

  render() {
    if (this.player.creative) {
      this.renderCreative();
    } else {
      this.renderSurvival();
    }
  }

  renderSurvival() {
    this.panel.innerHTML = '';
    this.panel.style.width = 'max-content';
    
    const title = document.createElement('div');
    title.textContent = this.craftSize === 3 ? '工作台' : '背包';
    title.style.cssText = 'font-size: 14px; margin-bottom: 8px; color: #333;';
    this.panel.appendChild(title);
    
    // 合成区
    const craftArea = document.createElement('div');
    craftArea.style.cssText = 'display: flex; gap: 16px; margin-bottom: 12px; align-items: center;';
    
    const gridCols = this.craftSize;
    const gridRows = this.craftSize;
    const grid = this.makeGrid(gridCols, gridRows, 'craft');
    craftArea.appendChild(grid);
    
    const arrow = document.createElement('div');
    arrow.textContent = '->';
    arrow.style.cssText = 'font-size: 20px; color: #555;';
    craftArea.appendChild(arrow);
    
    const out = document.createElement('div');
    out.dataset.slot = 'craft-output';
    out.style.cssText = `
      width: 44px; height: 44px; background: #8b8b8b; border: 2px solid #555;
      position: relative; display: flex; align-items: center; justify-content: center;
      cursor: pointer; image-rendering: pixelated;
    `;
    craftArea.appendChild(out);
    
    this.panel.appendChild(craftArea);
    
    // 主背包 27 格（索引 9~35）
    const main = this.makeGrid(9, 3, 'main');
    this.panel.appendChild(main);
    
    // 快捷栏（索引 0~8）
    const hb = this.makeGrid(9, 1, 'hotbar');
    hb.style.marginTop = '8px';
    this.panel.appendChild(hb);
    
    this.bindSlots();
    this.updateCraftOutput();
  }

  renderCreative() {
    this.panel.innerHTML = '';
    this.panel.style.width = 'max-content';
    
    const title = document.createElement('div');
    title.textContent = '创造模式 - 点击取物品';
    title.style.cssText = 'font-size: 14px; margin-bottom: 8px; color: #333;';
    this.panel.appendChild(title);
    
    // 所有物品列表
    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: repeat(9, 44px); gap: 2px; max-height: 320px; overflow-y: auto; background: #8b8b8b; padding: 4px;';
    
    // 方块优先；同名物品（lever/stone_button 在 Block/Item 双侧都注册）跳过避免重复
    const blocks = BlockRegistry.all().filter(b => b.name !== 'air');
    const seen = new Set(blocks.map(b => b.name));
    const items = ItemRegistry.all().filter(b => b.name !== 'air' && !seen.has(b.name));
    const allItems = [...blocks, ...items];
    for (const item of allItems) {
      const slot = this.makeSlotEl();
      this.fillSlotEl(slot, item.name, 64);
      slot.addEventListener('click', () => {
        // 左键直接放入选中快捷栏
        this.inventory.slots[this.inventory.hotbarSelected] = { name: item.name, count: 64, data: null };
        this.game.hotbar.update();
        this.bindSlots();
      });
      slot.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // 右键拿一个到光标
        this.setCursorItem(item.name, 1);
      });
      this._bindHover(slot, item.name);
      grid.appendChild(slot);
    }
    this.panel.appendChild(grid);
    
    // 快捷栏
    const hb = this.makeGrid(9, 1, 'hotbar');
    hb.style.marginTop = '8px';
    this.panel.appendChild(hb);
    this.bindSlots();
  }

  makeGrid(cols, rows, prefix) {
    const g = document.createElement('div');
    g.style.cssText = `display: grid; grid-template-columns: repeat(${cols}, 44px); gap: 2px; background: #8b8b8b; padding: 4px;`;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const slot = this.makeSlotEl();
        slot.dataset.slot = `${prefix}-${idx}`;
        g.appendChild(slot);
      }
    }
    return g;
  }

  makeSlotEl() {
    const slot = document.createElement('div');
    slot.style.cssText = `
      width: 44px; height: 44px; background: #8b8b8b; border: 2px solid #555;
      position: relative; display: flex; align-items: center; justify-content: center;
      cursor: pointer; image-rendering: pixelated;
    `;
    return slot;
  }

  // 填充 slot 元素的内容（图标+数量）
  fillSlotEl(slot, name, count) {
    slot.innerHTML = '';
    if (!name) return;
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    canvas.style.cssText = 'width: 32px; height: 32px;';
    slot.appendChild(canvas);
    this.drawIcon(canvas, name);
    if (count > 1) {
      const c = document.createElement('div');
      c.textContent = count;
      c.style.cssText = 'position: absolute; right: 2px; bottom: 0; color: #fff; font-size: 14px; font-weight: bold; text-shadow: 1px 1px 0 #000;';
      slot.appendChild(c);
    }
  }

  async drawIcon(canvas, name) {
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

  // 绑定所有 slot 的事件和显示
  bindSlots() {
    // 合成网格
    const craftSlots = this.panel.querySelectorAll('[data-slot^="craft-"]');
    craftSlots.forEach((el, i) => {
      const idx = parseInt(el.dataset.slot.split('-')[1]);
      this.renderSlotContent(el, this.craftGrid[idx]);
      this.bindSlotEvents(el, 'craft', idx);
      this._bindHover(el, this.craftGrid[idx] ? this.craftGrid[idx].name : null);
    });

    // 合成输出槽
    const outEl = this.panel.querySelector('[data-slot="craft-output"]');
    if (outEl) {
      this.bindOutputSlot(outEl);
      const result = this.getCurrentRecipeMatch();
      this._bindHover(outEl, result ? result.name : null);
    }

    // 主背包 slots 9~35
    const mainSlots = this.panel.querySelectorAll('[data-slot^="main-"]');
    mainSlots.forEach((el, i) => {
      const slotIdx = 9 + i;
      this.renderSlotContent(el, this.inventory.slots[slotIdx]);
      this.bindSlotEvents(el, 'inv', slotIdx);
      this._bindHover(el, this.inventory.slots[slotIdx] ? this.inventory.slots[slotIdx].name : null);
    });

    // 快捷栏 slots 0~8
    const hbSlots = this.panel.querySelectorAll('[data-slot^="hotbar-"]');
    hbSlots.forEach((el, i) => {
      this.renderSlotContent(el, this.inventory.slots[i]);
      this.bindSlotEvents(el, 'inv', i);
      this._bindHover(el, this.inventory.slots[i] ? this.inventory.slots[i].name : null);
    });
  }

  renderSlotContent(el, stack) {
    // 内容签名：未变化的槽位跳过重建（移动物品时 bindSlots 会全量刷新，
    // 重建 canvas + 异步图标绘制的空窗期就是"物品栏内拖动物品闪烁"的来源）
    const sig = stack ? `${stack.name}|${stack.count}` : '';
    if (el._sig === sig) return;
    el._sig = sig;
    if (stack) {
      this.fillSlotEl(el, stack.name, stack.count);
    } else {
      el.innerHTML = '';
    }
  }

  // 绑定普通槽位事件（背包或合成网格）
  bindSlotEvents(el, type, idx) {
    el.onmousedown = (e) => {
      e.preventDefault();
      if (e.button === 0) {
        // 左键：交换光标物品和槽位物品
        this.swapCursorWithSlot(type, idx);
      } else if (e.button === 2) {
        // 右键：放置/取出单个
        this.rightClickSlot(type, idx);
      }
    };
  }

  swapCursorWithSlot(type, idx) {
    let currentStack;
    if (type === 'craft') {
      currentStack = this.craftGrid[idx];
    } else {
      currentStack = this.inventory.slots[idx];
    }
    
    if (this.cursorItem && currentStack && this.cursorItem.name === currentStack.name) {
      // 同类物品：合并
      const total = this.cursorItem.count + currentStack.count;
      if (total <= 64) {
        currentStack.count = total;
        this.cursorItem = null;
      } else {
        currentStack.count = 64;
        this.cursorItem.count = total - 64;
      }
    } else {
      // 交换
      if (type === 'craft') {
        this.craftGrid[idx] = this.cursorItem;
      } else {
        this.inventory.slots[idx] = this.cursorItem;
      }
      this.cursorItem = currentStack;
    }
    
    this.updateCursorEl();
    this.bindSlots();
    if (type === 'inv') this.game.hotbar.update();
    this.updateCraftOutput();
  }

  rightClickSlot(type, idx) {
    let currentStack;
    if (type === 'craft') {
      currentStack = this.craftGrid[idx];
    } else {
      currentStack = this.inventory.slots[idx];
    }
    
    if (this.cursorItem) {
      // 光标有物品：放置一个
      if (!currentStack || (currentStack.name === this.cursorItem.name && currentStack.count < 64)) {
        if (!currentStack) {
          if (type === 'craft') {
            this.craftGrid[idx] = { name: this.cursorItem.name, count: 1, data: this.cursorItem.data };
          } else {
            this.inventory.slots[idx] = { name: this.cursorItem.name, count: 1, data: this.cursorItem.data };
          }
        } else {
          currentStack.count++;
        }
        this.cursorItem.count--;
        if (this.cursorItem.count <= 0) this.cursorItem = null;
      }
    } else if (currentStack) {
      // 光标空：拿起一半
      const half = Math.ceil(currentStack.count / 2);
      this.cursorItem = { name: currentStack.name, count: half, data: currentStack.data };
      currentStack.count -= half;
      if (currentStack.count <= 0) {
        if (type === 'craft') {
          this.craftGrid[idx] = null;
        } else {
          this.inventory.slots[idx] = null;
        }
      }
    }
    
    this.updateCursorEl();
    this.bindSlots();
    if (type === 'inv') this.game.hotbar.update();
    this.updateCraftOutput();
  }

  // 绑定合成输出槽
  bindOutputSlot(el) {
    el.onmousedown = (e) => {
      e.preventDefault();
      if (e.button !== 0) return;
      
      const result = this.getCurrentRecipeMatch();
      if (!result) return;
      
      // 如果光标有物品，必须与输出同类且能堆叠
      if (this.cursorItem) {
        if (this.cursorItem.name !== result.name) return;
        if (this.cursorItem.count + result.count > 64) return;
        this.cursorItem.count += result.count;
      } else {
        this.setCursorItem(result.name, result.count);
      }
      
      // 消耗合成网格中每个槽位一个物品
      for (let i = 0; i < this.craftGrid.length; i++) {
        if (this.craftGrid[i]) {
          this.craftGrid[i].count--;
          if (this.craftGrid[i].count <= 0) this.craftGrid[i] = null;
        }
      }
      
      this.updateCursorEl();
      this.bindSlots();
      this.updateCraftOutput();
    };
  }

  // 获取当前合成网格匹配的配方
  getCurrentRecipeMatch() {
    // 构建二维网格
    const size = this.craftSize;
    const grid2d = [];
    for (let r = 0; r < size; r++) {
      const row = [];
      for (let c = 0; c < size; c++) {
        const stack = this.craftGrid[r * size + c];
        row.push(stack ? stack.name : null);
      }
      grid2d.push(row);
    }
    return matchRecipe(grid2d);
  }

  // 更新合成输出槽显示
  updateCraftOutput() {
    const outEl = this.panel.querySelector('[data-slot="craft-output"]');
    if (!outEl) return;
    this.renderSlotContent(outEl, this.getCurrentRecipeMatch());
  }

  // 设置光标物品
  setCursorItem(name, count, data = null) {
    this.cursorItem = { name, count, data };
    this.updateCursorEl();
  }

  updateCursorEl() {
    if (this.cursorItem) {
      this.cursorEl.style.display = 'block';
      this.cursorEl.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      canvas.style.cssText = 'width: 32px; height: 32px;';
      this.cursorEl.appendChild(canvas);
      this.drawIcon(canvas, this.cursorItem.name);
      if (this.cursorItem.count > 1) {
        const c = document.createElement('div');
        c.textContent = this.cursorItem.count;
        c.style.cssText = 'position: absolute; right: 2px; bottom: 0; color: #fff; font-size: 14px; font-weight: bold; text-shadow: 1px 1px 0 #000;';
        this.cursorEl.appendChild(c);
      }
    } else {
      this.cursorEl.style.display = 'none';
      this.cursorEl.innerHTML = '';
    }
  }
}
