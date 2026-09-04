// Crafting.js -- 合成配方系统
// 支持 2x2（背包）和 3x3（工作台）
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';

// 配方表：pattern 是二维数组（每行一个数组），元素为物品/方块名或 null
// shaped: 必须匹配形状（包围盒收缩后比较）；shapeless: 顺序无关
const recipes = [];

function addShaped(output, count, pattern) {
  // pattern 可以是一维数组或二维数组（每行一个数组）
  let grid;
  if (Array.isArray(pattern[0])) {
    // 已经是二维数组
    grid = pattern.map(row => [...row]);
  } else if (pattern.length === 9) {
    grid = [pattern.slice(0,3), pattern.slice(3,6), pattern.slice(6,9)];
  } else if (pattern.length === 4) {
    grid = [pattern.slice(0,2), pattern.slice(2,4)];
  } else if (pattern.length === 1) {
    grid = [pattern];
  } else if (pattern.length === 6) {
    grid = [pattern.slice(0,3), pattern.slice(3,6)];
  } else {
    // 默认按 3 列处理
    const cols = 3;
    const rows = Math.ceil(pattern.length / cols);
    grid = [];
    for (let r = 0; r < rows; r++) grid.push(pattern.slice(r*cols, (r+1)*cols));
  }
  // 收缩到最小包围盒
  const shrunk = shrinkGrid(grid);
  recipes.push({ type: 'shaped', output, count, pattern: shrunk });
}

function addShapeless(output, count, ingredients) {
  recipes.push({ type: 'shapeless', output, count, ingredients });
}

// 将二维网格收缩到最小包围盒（去除全 null 的边缘行列）
function shrinkGrid(grid) {
  let minR = grid.length, maxR = -1, minC = grid[0].length, maxC = -1;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== null && grid[r][c] !== undefined) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (maxR < 0) return [[]];
  const result = [];
  for (let r = minR; r <= maxR; r++) {
    const row = [];
    for (let c = minC; c <= maxC; c++) {
      row.push(grid[r][c] || null);
    }
    result.push(row);
  }
  return result;
}

// --- 基础配方 ---
addShaped('crafting_table', 1, ['oak_planks','oak_planks','oak_planks','oak_planks']);
addShaped('oak_planks', 4, ['oak_log']);
addShaped('spruce_planks', 4, ['spruce_log']);
addShaped('birch_planks', 4, ['birch_log']);
addShaped('stick', 4, [['oak_planks'],['oak_planks']]);

// 工具（需要工作台 3x3，但简化为 2x2 也可）
addShaped('wood_pickaxe', 1, ['oak_planks','oak_planks','oak_planks', null, 'stick', null, null, 'stick', null]);
addShaped('wood_axe', 1, ['oak_planks','oak_planks', null, 'oak_planks','stick', null, null,'stick', null]);
addShaped('wood_shovel', 1, [null,'oak_planks', null, null,'stick', null, null,'stick', null]);
addShaped('wood_sword', 1, [null,'oak_planks', null, null,'oak_planks', null, null,'stick', null]);
addShaped('wood_hoe', 1, ['oak_planks','oak_planks', null, null,'stick', null, null,'stick', null]);

addShaped('stone_pickaxe', 1, ['cobblestone','cobblestone','cobblestone', null,'stick', null, null,'stick', null]);
addShaped('stone_axe', 1, ['cobblestone','cobblestone', null, 'cobblestone','stick', null, null,'stick', null]);
addShaped('stone_sword', 1, [null,'cobblestone', null, null,'cobblestone', null, null,'stick', null]);

addShaped('iron_pickaxe', 1, ['iron_ingot','iron_ingot','iron_ingot', null,'stick', null, null,'stick', null]);
addShaped('iron_axe', 1, ['iron_ingot','iron_ingot', null, 'iron_ingot','stick', null, null,'stick', null]);
addShaped('iron_sword', 1, [null,'iron_ingot', null, null,'iron_ingot', null, null,'stick', null]);

addShaped('gold_pickaxe', 1, ['gold_ingot','gold_ingot','gold_ingot', null,'stick', null, null,'stick', null]);
addShaped('gold_sword', 1, [null,'gold_ingot', null, null,'gold_ingot', null, null,'stick', null]);

addShaped('diamond_pickaxe', 1, ['diamond','diamond','diamond', null,'stick', null, null,'stick', null]);
addShaped('diamond_sword', 1, [null,'diamond', null, null,'diamond', null, null,'stick', null]);

// 防具
addShaped('leather_chestplate', 1, ['leather', null, 'leather','leather','leather','leather','leather','leather','leather']);
addShaped('iron_chestplate', 1, ['iron_ingot', null, 'iron_ingot','iron_ingot','iron_ingot','iron_ingot','iron_ingot','iron_ingot','iron_ingot']);
addShaped('diamond_chestplate', 1, ['diamond', null, 'diamond','diamond','diamond','diamond','diamond','diamond','diamond']);

// 武器
addShaped('bow', 1, ['stick', null,'stick','stick','string','stick', null,'string', null]);
addShaped('arrow', 4, [null,'flint', null, null,'stick', null, null,'feather', null]);

// 块
addShaped('cobblestone', 1, ['stone']);
addShaped('stone_bricks', 4, ['stone','stone','stone','stone']);
addShaped('glowstone', 1, ['glowstone_dust','glowstone_dust','glowstone_dust','glowstone_dust']);
addShaped('iron_block', 1, ['iron_ingot','iron_ingot','iron_ingot','iron_ingot','iron_ingot','iron_ingot','iron_ingot','iron_ingot','iron_ingot']);
addShaped('gold_block', 1, ['gold_ingot','gold_ingot','gold_ingot','gold_ingot','gold_ingot','gold_ingot','gold_ingot','gold_ingot','gold_ingot']);
addShaped('diamond_block', 1, ['diamond','diamond','diamond','diamond','diamond','diamond','diamond','diamond','diamond']);

// 食物
addShapeless('bread', 1, ['wheat','wheat','wheat']);
addShaped('cookie', 8, ['wheat','wheat','wheat', null, null, null, null, null, null]);

// 功能
addShaped('torch', 4, [['coal'],['stick']]);
// 末地传送门链（迭代 M3）：烈焰棒→2 烈焰粉；烈焰粉+末影珍珠→末影之眼
addShaped('blaze_powder', 2, [['blaze_rod']]);
addShaped('ender_eye', 1, [['blaze_powder'],['ender_pearl']]);
addShaped('furnace', 1, ['cobblestone','cobblestone','cobblestone','cobblestone', null,'cobblestone','cobblestone','cobblestone','cobblestone']);
addShaped('chest', 1, ['oak_planks','oak_planks','oak_planks','oak_planks', null,'oak_planks','oak_planks','oak_planks','oak_planks']);
addShaped('tnt', 1, ['gunpowder','gunpowder','gunpowder','sand','sand','sand','sand','sand','sand']);

// 红石
addShaped('redstone_torch_item', 1, [['redstone'],['stick']]);
addShaped('redstone_block', 1, ['redstone','redstone','redstone','redstone','redstone','redstone','redstone','redstone','redstone']);
addShaped('lever', 1, [['stick'],['cobblestone']]);
addShaped('stone_button', 1, [['cobblestone','cobblestone']]);
addShaped('oak_button', 1, [['oak_planks','oak_planks']]);
addShaped('piston', 1, ['oak_planks','oak_planks','oak_planks','cobblestone','iron_ingot','cobblestone','cobblestone','redstone','cobblestone']);
addShaped('sticky_piston', 1, ['slime_ball', null, null, null, 'piston', null, null, null, null]);
addShaped('oak_door', 3, [['oak_planks','oak_planks'],['oak_planks','oak_planks'],['oak_planks','oak_planks']]);
addShaped('iron_door', 3, [['iron_ingot','iron_ingot'],['iron_ingot','iron_ingot'],['iron_ingot','iron_ingot']]);
addShaped('oak_trapdoor', 2, [['oak_planks','oak_planks','oak_planks'],['oak_planks','oak_planks','oak_planks']]);
addShaped('note_block', 1, [['oak_planks','oak_planks','oak_planks'],['oak_planks','redstone','oak_planks'],['oak_planks','oak_planks','oak_planks']]);

// 还原配方
addShaped('oak_log', 1, ['oak_planks','oak_planks','oak_planks','oak_planks']);

// 匹配函数：输入是 grid 二维数组（每行一个数组），返回匹配结果或 null
export function matchRecipe(grid) {
  // grid 是二维数组 [[a,b,c],[d,e,f],[g,h,i]]，元素为物品名或 null
  // 收缩输入网格到最小包围盒
  const shrunkInput = shrinkGrid(grid);
  
  // 检查是否为空
  let hasItem = false;
  for (const row of shrunkInput) {
    for (const cell of row) {
      if (cell !== null && cell !== undefined) { hasItem = true; break; }
    }
    if (hasItem) break;
  }
  if (!hasItem) return null;
  
  for (const r of recipes) {
    if (r.type === 'shaped') {
      if (matchShaped(r, shrunkInput)) {
        return { name: r.output, count: r.count };
      }
    } else if (r.type === 'shapeless') {
      const items = shrunkInput.flat().filter(x => x !== null && x !== undefined);
      if (matchShapeless(r, items)) {
        return { name: r.output, count: r.count };
      }
    }
  }
  return null;
}

function matchShaped(recipe, inputGrid) {
  const pat = recipe.pattern; // 二维数组（已收缩）
  // 尺寸必须完全一致（两侧都已收缩到最小包围盒）
  if (inputGrid.length !== pat.length) return false;
  for (let r = 0; r < pat.length; r++) {
    if ((inputGrid[r] || []).length !== pat[r].length) return false;
    for (let c = 0; c < pat[r].length; c++) {
      const need = pat[r][c];
      const have = (inputGrid[r] || [])[c];
      if (need === null || need === undefined) {
        if (have !== null && have !== undefined) return false;
      } else {
        if (have !== need) return false;
      }
    }
  }
  return true;
}

function matchShapeless(recipe, items) {
  const ings = [...recipe.ingredients];
  if (ings.length !== items.length) return false;
  for (const it of items) {
    const idx = ings.indexOf(it);
    if (idx < 0) return false;
    ings.splice(idx, 1);
  }
  return true;
}

export function getAllRecipes() {
  return recipes;
}
