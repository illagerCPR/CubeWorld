// ItemDefs.js -- 物品定义（非方块物品）+ SVG 生成
import { ItemRegistry } from '../core/ItemRegistry.js';
import { SVGTextures } from '../render/SVGTextures.js';

const { pixelSvg, rng } = SVGTextures;

// 简单工具/材料物品 SVG（16x16）
function itemSvg(draw) {
  const px = new Array(256).fill(null);
  draw(px);
  return pixelSvg(px);
}

// 工具形状（镐/斧/铲/锄/剑）
function toolHead(tool, materialColor, handleColor = 'rgb(120,80,40)') {
  return (px) => {
    // 木柄（对角线）
    for (let i = 6; i < 15; i++) px[i * 16 + i] = handleColor;
    px[7 * 16 + 8] = handleColor; px[8 * 16 + 9] = handleColor;
    // 头部
    if (tool === 'pickaxe') {
      for (let x = 2; x < 10; x++) px[2 * 16 + x] = materialColor;
      px[3 * 16 + 2] = materialColor; px[3 * 16 + 4] = materialColor;
      px[3 * 16 + 6] = materialColor; px[3 * 16 + 8] = materialColor;
    } else if (tool === 'axe') {
      for (let y = 2; y < 7; y++) for (let x = 2; x < 7 - y + 3; x++) px[y * 16 + x] = materialColor;
    } else if (tool === 'shovel') {
      for (let y = 2; y < 5; y++) for (let x = 3; x < 8; x++) px[y * 16 + x] = materialColor;
    } else if (tool === 'hoe') {
      for (let x = 2; x < 6; x++) px[2 * 16 + x] = materialColor;
      px[3 * 16 + 2] = materialColor;
    } else if (tool === 'sword') {
      for (let i = 2; i < 13; i++) px[i * 16 + (14 - i)] = materialColor;
      px[12 * 16 + 3] = 'rgb(120,80,40)';
      px[13 * 16 + 3] = 'rgb(120,80,40)';
    }
  };
}

const svgMap = {};

const ItemCN = {
  stick: '木棍', coal: '煤炭', charcoal: '木炭',
  iron_ingot: '铁锭', gold_ingot: '金锭', diamond: '钻石', emerald: '绿宝石',
  lapis_lazuli: '青金石', copper_ingot: '铜锭', redstone: '红石', quartz: '下界石英',
  iron_nugget: '铁粒', gold_nugget: '金粒', diamond_nugget: '钻石粒',
  clay_ball: '粘土球', brick: '红砖', nether_brick: '下界砖',
  string: '线', feather: '羽毛', leather: '皮革', bone: '骨头', bone_meal: '骨粉',
  gunpowder: '火药', slime_ball: '粘液球',
  iron_ingot_raw: '粗铁', gold_ingot_raw: '粗金', copper_ingot_raw: '粗铜', dye: '染料',
  apple: '苹果', golden_apple: '金苹果', bread: '面包',
  cooked_beef: '牛排', beef: '生牛肉',
  cooked_chicken: '熟鸡肉', raw_chicken: '生鸡肉',
  cooked_cod: '熟鳕鱼', carrot: '胡萝卜', potato: '马铃薯', baked_potato: '烤马铃薯',
  melon_slice: '西瓜片', cookie: '饼干', sugar: '糖', wheat: '小麦',
  egg: '鸡蛋', rotten_flesh: '腐肉', spider_eye: '蜘蛛眼', milk_bucket: '牛奶桶',
  // 工具（5 材质 × 5 类型）
  wood_pickaxe: '木镐', wood_axe: '木斧', wood_shovel: '木铲', wood_hoe: '木锄', wood_sword: '木剑',
  stone_pickaxe: '石镐', stone_axe: '石斧', stone_shovel: '石铲', stone_hoe: '石锄', stone_sword: '石剑',
  iron_pickaxe: '铁镐', iron_axe: '铁斧', iron_shovel: '铁铲', iron_hoe: '铁锄', iron_sword: '铁剑',
  gold_pickaxe: '金镐', gold_axe: '金斧', gold_shovel: '金铲', gold_hoe: '金锄', gold_sword: '金剑',
  diamond_pickaxe: '钻石镐', diamond_axe: '钻石斧', diamond_shovel: '钻石铲', diamond_hoe: '钻石锄', diamond_sword: '钻石剑',
  // 武器/防具
  bow: '弓', arrow: '箭', shield: '盾牌',
  leather_chestplate: '皮革胸甲', iron_chestplate: '铁胸甲', gold_chestplate: '金胸甲', diamond_chestplate: '钻石胸甲',
  ender_pearl: '末影珍珠', blaze_rod: '烈焰棒', ghast_tear: '恶魂之泪',
  book: '书', enchanted_book: '附魔书', map: '地图', compass: '指南针', clock: '钟',
  bucket: '桶', water_bucket: '水桶', lava_bucket: '岩浆桶',
  saddle: '鞍', name_tag: '命名牌', minecart: '矿车', boat: '船',
  flint_and_steel: '打火石', fishing_rod: '钓鱼竿', shears: '剪刀',
  experience_bottle: '附魔之瓶',
  redstone_torch_item: '红石火把', repeater: '红石中继器', comparator: '红石比较器',
  lever: '拉杆', stone_button: '石按钮',
  oak_sapling: '橡树树苗', spruce_sapling: '云杉树苗', wheat_seeds: '小麦种子',
  bone_meal_item: '骨粉',
};

function reg(name, def, svg) {
  ItemRegistry.register({ name, displayName: ItemCN[name] || def.displayName || name, ...def });
  if (svg) svgMap[name] = svg;
}

// --- 材料 ---
reg('stick', { stack: 64 }, itemSvg(px => {
  for (let i = 4; i < 13; i++) px[i * 16 + (i + 4)] = 'rgb(120,80,40)';
  px[5*16+9] = 'rgb(140,100,60)'; px[6*16+10] = 'rgb(140,100,60)';
}));
reg('coal', { stack: 64 }, itemSvg(px => {
  for (let y = 3; y < 12; y++) for (let x = 3; x < 12; x++) if (Math.random() > 0.3) px[y*16+x] = 'rgb(30,30,30)';
  for (let y = 5; y < 9; y++) for (let x = 5; x < 9; x++) if (Math.random() > 0.4) px[y*16+x] = 'rgb(50,50,50)';
}));
reg('charcoal', { stack: 64 }, itemSvg(px => {
  for (let y = 3; y < 12; y++) for (let x = 3; x < 12; x++) if (Math.random() > 0.3) px[y*16+x] = 'rgb(40,30,20)';
}));
reg('iron_ingot', { stack: 64 }, itemSvg(px => {
  for (let y = 6; y < 11; y++) for (let x = 3; x < 13; x++) px[y*16+x] = 'rgb(220,220,220)';
  for (let x = 3; x < 13; x++) px[6*16+x] = 'rgb(180,180,180)';
}));
reg('gold_ingot', { stack: 64 }, itemSvg(px => {
  for (let y = 6; y < 11; y++) for (let x = 3; x < 13; x++) px[y*16+x] = 'rgb(240,220,80)';
  for (let x = 3; x < 13; x++) px[6*16+x] = 'rgb(200,180,60)';
}));
reg('diamond', { stack: 64 }, itemSvg(px => {
  const pts = [[7,3],[8,3],[6,4],[9,4],[5,5],[10,5],[4,6],[11,6],[5,7],[10,7],[6,8],[9,8],[7,9],[8,9]];
  for (const [x,y] of pts) px[y*16+x] = 'rgb(100,230,230)';
}));
reg('emerald', { stack: 64 }, itemSvg(px => {
  const pts = [[7,3],[8,3],[6,4],[9,4],[5,5],[10,5],[4,6],[11,6],[5,7],[10,7],[6,8],[9,8],[7,9],[8,9]];
  for (const [x,y] of pts) px[y*16+x] = 'rgb(40,220,80)';
}));
reg('lapis_lazuli', { stack: 64 }, itemSvg(px => {
  for (let y = 4; y < 11; y++) for (let x = 4; x < 11; x++) if (Math.random() > 0.3) px[y*16+x] = 'rgb(40,60,200)';
}));
reg('copper_ingot', { stack: 64 }, itemSvg(px => {
  for (let y = 6; y < 11; y++) for (let x = 3; x < 13; x++) px[y*16+x] = 'rgb(200,130,80)';
}));
reg('redstone', { stack: 64 }, itemSvg(px => {
  for (let y = 4; y < 11; y++) for (let x = 4; x < 11; x++) if (Math.random() > 0.3) px[y*16+x] = 'rgb(200,30,30)';
}));
reg('quartz', { stack: 64 }, itemSvg(px => {
  const pts = [[7,3],[8,4],[9,5],[8,6],[7,7],[6,8],[7,9],[8,10]];
  for (const [x,y] of pts) px[y*16+x] = 'rgb(240,235,220)';
}));
reg('iron_nugget', { stack: 64 }, itemSvg(px => {
  for (const [x,y] of [[7,7],[8,7],[7,8],[8,8]]) px[y*16+x] = 'rgb(220,220,220)';
}));
reg('gold_nugget', { stack: 64 }, itemSvg(px => {
  for (const [x,y] of [[7,7],[8,7],[7,8],[8,8]]) px[y*16+x] = 'rgb(240,220,80)';
}));
reg('diamond_nugget', { stack: 64 }, itemSvg(px => {
  for (const [x,y] of [[7,7],[8,7],[7,8],[8,8]]) px[y*16+x] = 'rgb(100,230,230)';
}));
reg('clay_ball', { stack: 64 }, itemSvg(px => {
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) px[y*16+x] = 'rgb(160,165,180)';
}));
reg('brick', { stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(150,60,40)';
}));
reg('nether_brick', { stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(40,20,30)';
}));
reg('string', { stack: 64 }, itemSvg(px => {
  for (let i = 2; i < 14; i++) px[i*16+((i*2)%16)] = 'rgb(220,220,200)';
}));
reg('feather', { stack: 64 }, itemSvg(px => {
  for (let i = 3; i < 13; i++) px[i*16+((14-i))] = 'rgb(220,220,220)';
  px[4*16+11] = 'rgb(200,200,200)';
}));
reg('leather', { stack: 64 }, itemSvg(px => {
  for (let y = 4; y < 11; y++) for (let x = 3; x < 12; x++) px[y*16+x] = 'rgb(120,80,40)';
}));
reg('bone', { stack: 64 }, itemSvg(px => {
  for (let i = 4; i < 12; i++) px[i*16+i] = 'rgb(230,230,220)';
  px[4*16+3] = 'rgb(230,230,220)'; px[11*16+12] = 'rgb(230,230,220)';
}));
reg('bone_meal', { stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) px[y*16+x] = 'rgb(250,250,240)';
}));
reg('gunpowder', { stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) if (Math.random() > 0.4) px[y*16+x] = 'rgb(60,60,60)';
}));
reg('slime_ball', { displayName: '粘液球', stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) {
    const dx = x - 8, dy = y - 8;
    if (dx*dx + dy*dy < 12) px[y*16+x] = 'rgb(120,200,80)';
  }
}));
reg('iron_ingot_raw', { displayName: '粗铁', stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(150,120,90)';
}));
reg('gold_ingot_raw', { displayName: '粗金', stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(180,150,40)';
}));
reg('copper_ingot_raw', { displayName: '粗铜', stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(160,100,60)';
}));

// --- 染料（所有颜色合并算 1 种：红色染料代表）---
reg('dye', { displayName: '染料', stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) px[y*16+x] = 'rgb(180,40,180)';
}));

// --- 食物 ---
reg('apple', { stack: 64, food: 4 }, itemSvg(px => {
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) {
    const d = (x-7.5)**2 + (y-7.5)**2;
    if (d < 16) px[y*16+x] = 'rgb(200,40,40)';
  }
  px[3*16+7] = 'rgb(100,60,30)'; px[2*16+8] = 'rgb(60,120,30)';
}));
reg('golden_apple', { stack: 64, food: 4 }, itemSvg(px => {
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) {
    const d = (x-7.5)**2 + (y-7.5)**2;
    if (d < 16) px[y*16+x] = 'rgb(240,220,80)';
  }
  px[3*16+7] = 'rgb(100,60,30)';
}));
reg('bread', { stack: 64, food: 5 }, itemSvg(px => {
  for (let y = 6; y < 10; y++) for (let x = 3; x < 13; x++) px[y*16+x] = 'rgb(180,130,60)';
  px[6*16+5] = 'rgb(150,100,40)'; px[6*16+10] = 'rgb(150,100,40)';
}));
reg('cooked_beef', { stack: 64, food: 8 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(120,70,40)';
  for (let x = 5; x < 11; x++) px[7*16+x] = 'rgb(150,90,50)';
}));
reg('beef', { stack: 64, food: 3 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(150,60,60)';
}));
reg('cooked_chicken', { stack: 64, food: 6 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(200,160,80)';
}));
reg('raw_chicken', { stack: 64, food: 2 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(220,180,160)';
}));
reg('cooked_cod', { stack: 64, food: 5 }, itemSvg(px => {
  for (let i = 3; i < 13; i++) px[i*16+(i+2)] = 'rgb(180,140,80)';
}));
reg('carrot', { stack: 64, food: 3 }, itemSvg(px => {
  for (let i = 5; i < 14; i++) px[i*16+(14-i)] = 'rgb(230,140,30)';
  px[3*16+2] = 'rgb(60,120,30)'; px[4*16+3] = 'rgb(60,120,30)';
}));
reg('potato', { stack: 64, food: 1 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 6; x < 10; x++) px[y*16+x] = 'rgb(200,180,120)';
}));
reg('baked_potato', { stack: 64, food: 5 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 6; x < 10; x++) px[y*16+x] = 'rgb(140,100,60)';
}));
reg('melon_slice', { stack: 64, food: 2 }, itemSvg(px => {
  for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) px[y*16+x] = 'rgb(220,60,60)';
  for (let x = 3; x < 13; x++) px[4*16+x] = 'rgb(60,140,30)';
}));
reg('cookie', { stack: 64, food: 2 }, itemSvg(px => {
  for (let y = 6; y < 10; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(180,130,60)';
  px[7*16+6] = 'rgb(60,30,10)'; px[8*16+9] = 'rgb(60,30,10)';
}));
reg('sugar', { stack: 64 }, itemSvg(px => {
  for (let y = 7; y < 9; y++) for (let x = 5; x < 11; x++) px[y*16+x] = 'rgb(250,250,240)';
}));
reg('wheat', { stack: 64 }, itemSvg(px => {
  for (let i = 4; i < 14; i++) px[i*16+(i-2)] = 'rgb(200,170,60)';
  for (let i = 4; i < 8; i++) { px[i*16+(i-1)] = 'rgb(180,150,40)'; px[i*16+(i-3)] = 'rgb(180,150,40)'; }
}));
reg('egg', { stack: 16 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 6; x < 10; x++) {
    const d = (x-7.5)**2 + ((y-7.5)*1.3)**2;
    if (d < 4) px[y*16+x] = 'rgb(230,220,200)';
  }
}));

// --- 怪物掉落物 ---
reg('rotten_flesh', { stack: 64, food: 4 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 4; x < 12; x++) {
    if (Math.random() > 0.2) px[y*16+x] = 'rgb(140,70,70)';
  }
  px[6*16+5] = 'rgb(100,50,50)'; px[9*16+10] = 'rgb(100,50,50)';
  px[7*16+8] = 'rgb(160,90,90)';
}));
reg('spider_eye', { stack: 64, food: 2 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) {
    const d = (x-7.5)**2 + (y-7.5)**2;
    if (d < 8) px[y*16+x] = 'rgb(80,20,20)';
    if (d < 3) px[y*16+x] = 'rgb(40,10,10)';
  }
  px[7*16+7] = 'rgb(200,40,40)'; px[7*16+8] = 'rgb(200,40,40)';
}));
reg('milk_bucket', { stack: 1 }, itemSvg(px => {
  for (let y = 5; y < 12; y++) for (let x = 5; x < 11; x++) px[y*16+x] = 'rgb(200,200,200)';
  px[5*16+4] = 'rgb(200,200,200)'; px[6*16+3] = 'rgb(200,200,200)';
}));

// --- 工具（木/石/铁/金/钻石 各 5 级）---
const toolMaterials = {
  wood: { color: 'rgb(160,120,70)', tier: 1 },
  stone: { color: 'rgb(128,128,128)', tier: 2 },
  iron: { color: 'rgb(220,220,220)', tier: 3 },
  gold: { color: 'rgb(240,220,80)', tier: 1 },
  diamond: { color: 'rgb(100,230,230)', tier: 4 }
};
const toolTypes = ['pickaxe', 'axe', 'shovel', 'hoe'];
for (const [matName, mat] of Object.entries(toolMaterials)) {
  for (const tt of toolTypes) {
    reg(`${matName}_${tt}`, { stack: 1, tool: tt, tier: mat.tier, durability: mat.tier * 100 },
      itemSvg(toolHead(tt, mat.color)));
  }
  reg(`${matName}_sword`, { stack: 1, tool: 'sword', tier: mat.tier, durability: mat.tier * 100, damage: 2 + mat.tier },
    itemSvg(toolHead('sword', mat.color)));
}

// --- 武器/防具 ---
reg('bow', { stack: 1 }, itemSvg(px => {
  for (let i = 3; i < 13; i++) px[i*16+(3 + Math.floor((13-i)*0.7))] = 'rgb(120,80,40)';
  for (let i = 3; i < 13; i++) px[i*16+(13 - Math.floor((i-3)*0.7))] = 'rgb(200,200,200)';
}));
reg('arrow', { stack: 64 }, itemSvg(px => {
  for (let i = 3; i < 13; i++) px[i*16+i] = 'rgb(120,80,40)';
  px[3*16+2] = 'rgb(220,220,220)'; px[4*16+3] = 'rgb(220,220,220)';
  px[12*16+13] = 'rgb(200,40,40)'; px[13*16+12] = 'rgb(200,40,40)';
}));
reg('shield', { stack: 1 }, itemSvg(px => {
  for (let y = 4; y < 12; y++) for (let x = 5; x < 11; x++) px[y*16+x] = 'rgb(120,80,40)';
  for (let y = 6; y < 10; y++) for (let x = 7; x < 9; x++) px[y*16+x] = 'rgb(200,200,200)';
}));
reg('leather_chestplate', { stack: 1 }, itemSvg(px => {
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(120,80,40)';
  for (let x = 4; x < 12; x++) px[4*16+x] = 'rgb(100,60,30)';
}));
reg('iron_chestplate', { stack: 1 }, itemSvg(px => {
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(220,220,220)';
}));
reg('gold_chestplate', { stack: 1 }, itemSvg(px => {
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(240,220,80)';
}));
reg('diamond_chestplate', { stack: 1 }, itemSvg(px => {
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(100,230,230)';
}));

// --- 特殊物品 ---
reg('ender_pearl', { stack: 16 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) {
    const d = (x-7.5)**2 + (y-7.5)**2;
    if (d < 9) px[y*16+x] = 'rgb(40,100,60)';
  }
}));
reg('blaze_rod', { stack: 64 }, itemSvg(px => {
  for (let i = 3; i < 13; i++) px[i*16+8] = 'rgb(240,160,40)';
  px[5*16+7] = 'rgb(220,120,20)'; px[8*16+9] = 'rgb(220,120,20)';
}));
reg('ghast_tear', { stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 6; x < 10; x++) px[y*16+x] = 'rgb(220,230,240)';
}));
reg('book', { stack: 64 }, itemSvg(px => {
  for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) px[y*16+x] = 'rgb(150,40,30)';
  for (let x = 3; x < 13; x++) px[7*16+x] = 'rgb(220,220,200)';
}));
reg('enchanted_book', { stack: 64 }, itemSvg(px => {
  for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) px[y*16+x] = 'rgb(40,100,60)';
  for (let x = 3; x < 13; x++) px[7*16+x] = 'rgb(220,220,200)';
}));
reg('map', { stack: 64 }, itemSvg(px => {
  for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) px[y*16+x] = 'rgb(220,210,170)';
  for (let i = 5; i < 11; i++) px[i*16+i] = 'rgb(200,180,120)';
}));
reg('compass', { stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) {
    const d = (x-7.5)**2 + (y-7.5)**2;
    if (d > 4 && d < 10) px[y*16+x] = 'rgb(180,180,180)';
  }
  px[5*16+8] = 'rgb(200,40,40)'; px[6*16+8] = 'rgb(200,40,40)';
}));
reg('clock', { stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) {
    const d = (x-7.5)**2 + (y-7.5)**2;
    if (d < 9) px[y*16+x] = 'rgb(240,230,180)';
  }
  px[7*16+8] = 'rgb(40,30,20)'; px[8*16+9] = 'rgb(40,30,20)';
}));
reg('bucket', { stack: 1 }, itemSvg(px => {
  for (let y = 5; y < 12; y++) for (let x = 5; x < 11; x++) px[y*16+x] = 'rgb(180,180,180)';
  px[5*16+4] = 'rgb(180,180,180)'; px[6*16+3] = 'rgb(180,180,180)';
}));
reg('water_bucket', { stack: 1 }, itemSvg(px => {
  for (let y = 5; y < 12; y++) for (let x = 5; x < 11; x++) px[y*16+x] = 'rgb(40,100,180)';
  px[5*16+4] = 'rgb(180,180,180)'; px[6*16+3] = 'rgb(180,180,180)';
}));
reg('lava_bucket', { stack: 1 }, itemSvg(px => {
  for (let y = 5; y < 12; y++) for (let x = 5; x < 11; x++) px[y*16+x] = 'rgb(220,80,20)';
  px[5*16+4] = 'rgb(180,180,180)'; px[6*16+3] = 'rgb(180,180,180)';
}));
reg('saddle', { stack: 1 }, itemSvg(px => {
  for (let y = 5; y < 10; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(120,80,40)';
  px[5*16+5] = 'rgb(100,60,30)'; px[9*16+10] = 'rgb(100,60,30)';
}));
reg('name_tag', { stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 11; y++) for (let x = 3; x < 13; x++) px[y*16+x] = 'rgb(180,160,120)';
  for (let x = 4; x < 12; x++) px[7*16+x] = 'rgb(60,40,20)';
}));
reg('minecart', { stack: 1 }, itemSvg(px => {
  for (let x = 3; x < 13; x++) px[4*16+x] = 'rgb(120,120,120)';
  for (let x = 3; x < 13; x++) px[10*16+x] = 'rgb(120,120,120)';
  px[5*16+3] = 'rgb(120,120,120)'; px[9*16+3] = 'rgb(120,120,120)';
  px[5*16+12] = 'rgb(120,120,120)'; px[9*16+12] = 'rgb(120,120,120)';
}));
reg('boat', { stack: 1 }, itemSvg(px => {
  for (let i = 4; i < 12; i++) { px[10*16+i] = 'rgb(120,80,40)'; px[11*16+i] = 'rgb(100,60,30)'; }
  px[9*16+4] = 'rgb(120,80,40)'; px[9*16+11] = 'rgb(120,80,40)';
}));
reg('flint_and_steel', { stack: 1 }, itemSvg(px => {
  for (let i = 5; i < 12; i++) px[i*16+i] = 'rgb(80,80,80)';
  px[4*16+4] = 'rgb(200,200,200)';
}));
reg('fishing_rod', { stack: 1 }, itemSvg(px => {
  for (let i = 3; i < 13; i++) px[i*16+(i+2)] = 'rgb(120,80,40)';
  px[12*16+14] = 'rgb(200,200,200)'; px[13*16+13] = 'rgb(200,200,200)';
}));
reg('shears', { stack: 1 }, itemSvg(px => {
  px[3*16+4] = 'rgb(180,180,180)'; px[4*16+5] = 'rgb(180,180,180)';
  px[5*16+6] = 'rgb(180,180,180)'; px[6*16+7] = 'rgb(180,180,180)';
  px[7*16+8] = 'rgb(180,180,180)';
  px[3*16+11] = 'rgb(180,180,180)'; px[4*16+10] = 'rgb(180,180,180)';
}));
reg('experience_bottle', { stack: 64 }, itemSvg(px => {
  for (let y = 6; y < 11; y++) for (let x = 5; x < 10; x++) px[y*16+x] = 'rgb(100,200,100)';
  px[5*16+6] = 'rgb(200,200,200)'; px[5*16+8] = 'rgb(200,200,200)';
}));

// --- 红石物品 ---
reg('redstone_torch_item', { displayName: '红石火把', stack: 64 }, itemSvg(px => {
  for (let y = 3; y < 7; y++) for (let x = 7; x < 10; x++) px[y*16+x] = 'rgb(220,40,40)';
  for (let y = 7; y < 14; y++) for (let x = 7; x < 10; x++) px[y*16+x] = 'rgb(120,80,40)';
}));
reg('repeater', { stack: 64 }, itemSvg(px => {
  for (let y = 7; y < 10; y++) for (let x = 3; x < 13; x++) px[y*16+x] = 'rgb(120,80,40)';
  px[7*16+4] = 'rgb(200,200,200)';
  for (let y = 5; y < 8; y++) px[y*16+10] = 'rgb(220,40,40)';
}));
reg('comparator', { stack: 64 }, itemSvg(px => {
  for (let y = 7; y < 10; y++) for (let x = 3; x < 13; x++) px[y*16+x] = 'rgb(120,80,40)';
  for (let y = 4; y < 7; y++) { px[y*16+5] = 'rgb(200,200,200)'; px[y*16+8] = 'rgb(200,200,200)'; px[y*16+11] = 'rgb(200,200,200)'; }
}));
reg('lever', { stack: 64 }, itemSvg(px => {
  for (let y = 8; y < 12; y++) for (let x = 6; x < 10; x++) px[y*16+x] = 'rgb(100,100,100)';
  for (let y = 3; y < 8; y++) px[y*16+8] = 'rgb(120,80,40)';
}));
reg('stone_button', { stack: 64 }, itemSvg(px => {
  for (let y = 7; y < 9; y++) for (let x = 5; x < 11; x++) px[y*16+x] = 'rgb(128,128,128)';
}));

// --- 花苗等 ---
reg('oak_sapling', { stack: 64 }, itemSvg(px => {
  for (let y = 8; y < 14; y++) for (let x = 6; x < 10; x++) px[y*16+x] = 'rgb(120,80,40)';
  for (let y = 3; y < 9; y++) for (let x = 5; x < 11; x++) if (Math.random() > 0.4) px[y*16+x] = 'rgb(60,140,40)';
}));
reg('spruce_sapling', { stack: 64 }, itemSvg(px => {
  for (let y = 8; y < 14; y++) for (let x = 6; x < 10; x++) px[y*16+x] = 'rgb(120,80,40)';
  for (let y = 3; y < 9; y++) for (let x = 5; x < 11; x++) if (Math.random() > 0.4) px[y*16+x] = 'rgb(40,100,50)';
}));
reg('wheat_seeds', { stack: 64 }, itemSvg(px => {
  for (const [x,y] of [[7,7],[8,7],[7,8],[8,8],[6,8],[9,8]]) px[y*16+x] = 'rgb(180,150,40)';
}));
reg('bone_meal_item', { displayName: '骨粉', stack: 64 }, itemSvg(px => {
  for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) px[y*16+x] = 'rgb(250,250,240)';
}));

export const ItemSVGDefinitions = svgMap;

export function getItemCount() {
  return ItemRegistry.all().length;
}
