// BlockDefs.js -- 方块定义 + 对应 SVG 生成
// 程序化生成 16x16 SVG，全部内联，无外部图片
import { BlockRegistry } from '../core/BlockRegistry.js';
import { SVGTextures } from '../render/SVGTextures.js';

const { pixelSvg, rng } = SVGTextures;

// 工具：生成带噪声的纯色方块 SVG
function noiseBlock(base, variation, seed, density = 0.6) {
  const r = rng(seed);
  const px = new Array(256);
  const [br, bg, bb] = base;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = r();
      const d = r() < density ? 1 : 0.3;
      const cr = Math.max(0, Math.min(255, Math.round(br + (variation[0] - 128) * t * d)));
      const cg = Math.max(0, Math.min(255, Math.round(bg + (variation[1] - 128) * t * d)));
      const cb = Math.max(0, Math.min(255, Math.round(bb + (variation[2] - 128) * t * d)));
      px[y * 16 + x] = `rgb(${cr},${cg},${cb})`;
    }
  }
  return pixelSvg(px);
}

// 草方块顶面：绿色 + 噪声
function grassTopSvg(seed) {
  const r = rng(seed);
  const px = new Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = r();
      const g = Math.round(120 + t * 50);
      px[y * 16 + x] = `rgb(60,${g},40)`;
    }
  }
  return pixelSvg(px);
}

// 草方块侧面：泥土 + 顶部绿色覆盖（3 像素）
function grassSideSvg(seed) {
  const r = rng(seed);
  const px = new Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let cr, cg, cb;
      if (y < 3 + Math.floor(r() * 2)) {
        const t = r();
        cg = Math.round(120 + t * 50);
        cr = 60; cb = 40;
      } else {
        const t = r();
        cr = Math.round(130 + t * 30);
        cg = Math.round(100 + t * 20);
        cb = Math.round(70 + t * 20);
      }
      px[y * 16 + x] = `rgb(${cr},${cg},${cb})`;
    }
  }
  return pixelSvg(px);
}

// 圆石：灰色 + 不规则深色斑点
function cobblestoneSvg(seed) {
  const r = rng(seed);
  const px = new Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = r();
      let v = 100 + Math.round(t * 60);
      // 不规则深色块
      if ((x % 5 === 0 || y % 5 === 0) && r() > 0.4) v -= 40;
      px[y * 16 + x] = `rgb(${v},${v},${v})`;
    }
  }
  return pixelSvg(px);
}

// 矿石：石头底 + 矿物点（如钻石矿）
function oreSvg(oreColor, seed) {
  const r = rng(seed);
  const px = new Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = r();
      let v = 120 + Math.round(t * 40);
      px[y * 16 + x] = `rgb(${v},${v},${v})`;
    }
  }
  // 矿物点
  const spots = [[3,3],[4,3],[3,4],[8,6],[9,6],[8,7],[11,10],[12,10],[11,11],[5,11],[6,12]];
  for (const [x, y] of spots) {
    if (x < 16 && y < 16) px[y * 16 + x] = oreColor;
    if (x + 1 < 16 && r() > 0.5) px[y * 16 + x + 1] = oreColor;
  }
  return pixelSvg(px);
}

// 原木顶面：年轮同心圆
function logTopSvg(ringColor, barkColor) {
  const px = new Array(256);
  const cx = 7.5, cy = 7.5;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const ring = Math.floor(d) % 2;
      px[y * 16 + x] = ring === 0 ? ringColor : barkColor;
    }
  }
  return pixelSvg(px);
}

// 原木侧面：竖纹
function logSideSvg(barkColor, lineColor) {
  const r = rng(42);
  const px = new Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = r();
      let c = x % 3 === 0 ? lineColor : barkColor;
      // 添加竖纹噪声
      if (t > 0.85) c = c === barkColor ? lineColor : barkColor;
      px[y * 16 + x] = c;
    }
  }
  return pixelSvg(px);
}

// 树叶：绿色透光 + 孔洞
function leavesSvg(seed, tone = [40, 120, 30]) {
  const r = rng(seed);
  const px = new Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = r();
      if (t < 0.12) {
        px[y * 16 + x] = null; // 透光孔
      } else {
        const g = tone[1] + Math.round(t * 40 - 20);
        px[y * 16 + x] = `rgb(${tone[0]},${g},${tone[2]})`;
      }
    }
  }
  return pixelSvg(px);
}

// 水：蓝色波纹
function waterSvg(seed) {
  const r = rng(seed);
  const px = new Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const wave = Math.sin((x + y) * 0.8) * 0.5 + 0.5;
      const b = 180 + Math.round(wave * 40 + r() * 20);
      px[y * 16 + x] = `rgb(40,100,${b})`;
    }
  }
  return pixelSvg(px);
}

// 沙子：黄 + 噪声
function sandSvg(seed) {
  return noiseBlock([219, 207, 163], [200, 180, 130], seed);
}

// 玻璃：浅蓝边框 + 半透明中心
function glassSvg() {
  const px = new Array(256).fill(null);
  // 边框
  for (let i = 0; i < 16; i++) {
    px[i] = 'rgb(200,230,255)';
    px[i * 16] = 'rgb(200,230,255)';
    px[i * 16 + 15] = 'rgb(200,230,255)';
    px[15 * 16 + i] = 'rgb(200,230,255)';
  }
  // 高光
  px[2 * 16 + 2] = 'rgb(230,240,255)';
  px[3 * 16 + 2] = 'rgb(230,240,255)';
  px[2 * 16 + 3] = 'rgb(230,240,255)';
  return pixelSvg(px);
}

// 基岩：深灰 + 不规则
function bedrockSvg(seed) {
  const r = rng(seed);
  const px = new Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = r();
      const v = 40 + Math.round(t * 60);
      px[y * 16 + x] = `rgb(${v},${v},${v})`;
    }
  }
  return pixelSvg(px);
}

// 雪：白色 + 微噪声
function snowSvg(seed) {
  return noiseBlock([245, 250, 255], [230, 235, 245], seed, 0.3);
}

// 冰：浅蓝半透明
function iceSvg(seed) {
  const r = rng(seed);
  const px = new Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = r();
      const b = 200 + Math.round(t * 40);
      px[y * 16 + x] = `rgb(150,200,${b})`;
    }
  }
  return pixelSvg(px);
}

// 仙人掌：绿色 + 刺
function cactusSvg(seed) {
  const r = rng(seed);
  const px = new Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = r();
      const g = 100 + Math.round(t * 40);
      let c = `rgb(50,${g},40)`;
      // 边缘深色
      if (x === 0 || x === 15) c = `rgb(30,${g - 20},20)`;
      // 刺
      if ((x === 0 || x === 15) && y % 4 === 2) c = 'rgb(220,220,180)';
      px[y * 16 + x] = c;
    }
  }
  return pixelSvg(px);
}

// 注册所有方块 + 生成 SVG 映射
const svgMap = {};

function regBlock(name, def, svgGen) {
  BlockRegistry.register({ name, ...def });
  if (svgGen) {
    if (typeof svgGen === 'object') {
      if (svgGen.top) svgMap[svgGen.topKey || name + '_top'] = svgGen.top;
      if (svgGen.side) svgMap[svgGen.sideKey || name + '_side'] = svgGen.side;
      if (svgGen.bottom) svgMap[svgGen.bottomKey || name + '_bottom'] = svgGen.bottom;
    } else {
      svgMap[name] = svgGen;
    }
  }
}

// 统一注册：textures 字段指定 SVG 文件名
const BlockCN = {
  air: '空气', stone: '石头', grass_block: '草方块', dirt: '泥土', coarse_dirt: '砂土',
  sand: '沙子', red_sand: '红沙', gravel: '沙砾', clay: '粘土块', bedrock: '基岩',
  water: '水', lava: '岩浆',
  ice: '冰', packed_ice: '浮冰', blue_ice: '蓝冰',
  snow_block: '雪块', snow_layer: '雪层', obsidian: '黑曜石',
  coal_ore: '煤矿石', iron_ore: '铁矿石', gold_ore: '金矿石', diamond_ore: '钻石矿石',
  emerald_ore: '绿宝石矿石', redstone_ore: '红石矿石', lapis_ore: '青金石矿石', copper_ore: '铜矿石',
  deepslate: '深板岩',
  deepslate_coal_ore: '深板岩煤矿石', deepslate_iron_ore: '深板岩铁矿石',
  deepslate_gold_ore: '深板岩金矿石', deepslate_diamond_ore: '深板岩钻石矿石',
  oak_log: '橡木原木', spruce_log: '云杉原木', birch_log: '白桦原木', dark_oak_log: '深色橡木原木', acacia_log: '金合欢原木',
  oak_planks: '橡木木板', spruce_planks: '云杉木板', birch_planks: '白桦木板', dark_oak_planks: '深色橡木木板', acacia_planks: '金合欢木板',
  oak_leaves: '橡树树叶', spruce_leaves: '云杉树叶', birch_leaves: '白桦树叶',
  cobblestone: '圆石', stone_bricks: '石砖', mossy_cobblestone: '苔石', brick_block: '红砖块', nether_bricks: '下界砖块',
  sandstone: '砂岩', red_sandstone: '红砂岩', quartz_block: '石英块',
  crafting_table: '工作台', furnace: '熔炉', tnt: 'TNT',
  glass: '玻璃', glowstone: '荧石', sea_lantern: '海晶灯', torch: '火把',
  iron_block: '铁块', gold_block: '金块', diamond_block: '钻石块', emerald_block: '绿宝石块',
  lapis_block: '青金石块', redstone_block: '红石块', coal_block: '煤炭块',
  cactus: '仙人掌', pumpkin: '南瓜', melon: '西瓜', hay_block: '干草块',
  netherrack: '下界岩', end_stone: '末地石', soul_sand: '灵魂沙', magma_block: '岩浆块',
  redstone_lamp: '红石灯', redstone_torch: '红石火把',
  lever: '拉杆', stone_button: '石按钮', oak_button: '橡木按钮', redstone_wire: '红石粉',
  piston: '活塞', piston_head: '活塞头', sticky_piston: '粘性活塞',
  oak_door: '橡木门', iron_door: '铁门', oak_trapdoor: '橡木活板门', note_block: '音符盒',
  white_concrete: '白色混凝土', white_wool: '白色羊毛', white_terracotta: '白色陶瓦', white_bed: '白色床',
};

function reg(name, def, svgs) {
  BlockRegistry.register({ name, displayName: BlockCN[name] || def.displayName || name, ...def });
  if (svgs) {
    for (const [key, svg] of Object.entries(svgs)) {
      svgMap[key] = svg;
    }
  }
}

// --- 自然方块 ---
reg('air', { id: 0, displayName: '空气', solid: false, transparent: true, hardness: 0 });
reg('stone', { hardness: 1.5, tool: 'pickaxe' }, { stone: noiseBlock([128,128,128], [100,100,100], 1) });
reg('grass_block', { textures: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, hardness: 0.6 },
  { grass_top: grassTopSvg(7), grass_side: grassSideSvg(8), dirt: noiseBlock([134,96,67], [110,80,50], 9) });
reg('dirt', { hardness: 0.5 }, { dirt: noiseBlock([134,96,67], [110,80,50], 9) });
reg('coarse_dirt', { hardness: 0.5 }, { coarse_dirt: noiseBlock([120,85,55], [90,70,40], 10) });
reg('sand', { hardness: 0.5 }, { sand: sandSvg(11) });
reg('red_sand', { hardness: 0.5 }, { red_sand: noiseBlock([200,100,50], [170,80,30], 12) });
reg('gravel', { hardness: 0.6 }, { gravel: noiseBlock([136,126,126], [100,90,90], 13) });
reg('clay', { hardness: 0.6 }, { clay: noiseBlock([160,165,180], [140,145,160], 14) });
reg('bedrock', { hardness: -1 }, { bedrock: bedrockSvg(15) });
reg('water', { solid: false, transparent: true, fluid: true, hardness: 100 }, { water: waterSvg(16) });
reg('lava', { displayName: '岩浆', solid: false, transparent: true, fluid: true, light: 15, hardness: 100 }, { lava: noiseBlock([220,80,20], [255,160,40], 17, 0.9) });
reg('ice', { transparent: true, hardness: 0.5 }, { ice: iceSvg(18) });
reg('packed_ice', { hardness: 0.5 }, { packed_ice: noiseBlock([140,180,220], [120,160,200], 19) });
reg('blue_ice', { hardness: 0.5 }, { blue_ice: noiseBlock([80,140,220], [60,120,200], 20) });
reg('snow_block', { hardness: 0.2 }, { snow_block: snowSvg(21) });
reg('snow_layer', { transparent: true, hardness: 0.1 }, { snow_layer: snowSvg(22) });
reg('obsidian', { hardness: 50, tool: 'pickaxe' }, { obsidian: noiseBlock([20,15,30], [40,30,60], 23) });

// --- 矿石 ---
reg('coal_ore', { hardness: 3, tool: 'pickaxe' }, { coal_ore: oreSvg('rgb(30,30,30)', 31) });
reg('iron_ore', { hardness: 3, tool: 'pickaxe' }, { iron_ore: oreSvg('rgb(200,160,120)', 32) });
reg('gold_ore', { hardness: 3, tool: 'pickaxe' }, { gold_ore: oreSvg('rgb(240,220,80)', 33) });
reg('diamond_ore', { hardness: 3, tool: 'pickaxe' }, { diamond_ore: oreSvg('rgb(100,230,230)', 34) });
reg('emerald_ore', { hardness: 3, tool: 'pickaxe' }, { emerald_ore: oreSvg('rgb(40,220,80)', 35) });
reg('redstone_ore', { hardness: 3, tool: 'pickaxe', light: 9 }, { redstone_ore: oreSvg('rgb(220,40,40)', 36) });
reg('lapis_ore', { hardness: 3, tool: 'pickaxe' }, { lapis_ore: oreSvg('rgb(40,60,200)', 37) });
reg('copper_ore', { hardness: 3, tool: 'pickaxe' }, { copper_ore: oreSvg('rgb(200,130,80)', 38) });

// 深板岩变种
reg('deepslate', { hardness: 3, tool: 'pickaxe' }, { deepslate: noiseBlock([60,60,70], [40,40,50], 41) });
reg('deepslate_coal_ore', { hardness: 4.5, tool: 'pickaxe' }, { deepslate_coal_ore: oreSvg('rgb(30,30,30)', 42) });
reg('deepslate_iron_ore', { hardness: 4.5, tool: 'pickaxe' }, { deepslate_iron_ore: oreSvg('rgb(200,160,120)', 43) });
reg('deepslate_gold_ore', { hardness: 4.5, tool: 'pickaxe' }, { deepslate_gold_ore: oreSvg('rgb(240,220,80)', 44) });
reg('deepslate_diamond_ore', { hardness: 4.5, tool: 'pickaxe' }, { deepslate_diamond_ore: oreSvg('rgb(100,230,230)', 45) });

// --- 原木 ---
reg('oak_log', { textures: { top: 'oak_log_top', side: 'oak_log_side', bottom: 'oak_log_top' }, hardness: 2 },
  { oak_log_top: logTopSvg('rgb(180,140,80)', 'rgb(140,100,50)'), oak_log_side: logSideSvg('rgb(100,70,40)', 'rgb(80,55,25)') });
reg('spruce_log', { textures: { top: 'spruce_log_top', side: 'spruce_log_side', bottom: 'spruce_log_top' }, hardness: 2 },
  { spruce_log_top: logTopSvg('rgb(120,80,40)', 'rgb(80,50,20)'), spruce_log_side: logSideSvg('rgb(70,45,20)', 'rgb(50,30,10)') });
reg('birch_log', { textures: { top: 'birch_log_top', side: 'birch_log_side', bottom: 'birch_log_top' }, hardness: 2 },
  { birch_log_top: logTopSvg('rgb(230,220,200)', 'rgb(200,190,170)'), birch_log_side: logSideSvg('rgb(210,200,180)', 'rgb(180,170,150)') });
reg('dark_oak_log', { textures: { top: 'dark_oak_log_top', side: 'dark_oak_log_side', bottom: 'dark_oak_log_top' }, hardness: 2 },
  { dark_oak_log_top: logTopSvg('rgb(80,55,30)', 'rgb(60,40,20)'), dark_oak_log_side: logSideSvg('rgb(60,40,20)', 'rgb(40,25,10)') });
reg('acacia_log', { textures: { top: 'acacia_log_top', side: 'acacia_log_side', bottom: 'acacia_log_top' }, hardness: 2 },
  { acacia_log_top: logTopSvg('rgb(180,100,40)', 'rgb(140,80,30)'), acacia_log_side: logSideSvg('rgb(140,80,30)', 'rgb(110,60,20)') });

// --- 木板 ---
reg('oak_planks', { hardness: 2 }, { oak_planks: noiseBlock([160,120,70], [140,100,50], 51) });
reg('spruce_planks', { hardness: 2 }, { spruce_planks: noiseBlock([100,70,40], [80,55,25], 52) });
reg('birch_planks', { hardness: 2 }, { birch_planks: noiseBlock([210,200,180], [180,170,150], 53) });
reg('dark_oak_planks', { hardness: 2 }, { dark_oak_planks: noiseBlock([70,50,30], [50,35,20], 54) });
reg('acacia_planks', { hardness: 2 }, { acacia_planks: noiseBlock([150,80,30], [120,60,20], 55) });

// --- 树叶 ---
reg('oak_leaves', { transparent: true, solid: true, hardness: 0.2 }, { oak_leaves: leavesSvg(61, [40,110,30]) });
reg('spruce_leaves', { transparent: true, solid: true, hardness: 0.2 }, { spruce_leaves: leavesSvg(62, [30,80,40]) });
reg('birch_leaves', { transparent: true, solid: true, hardness: 0.2 }, { birch_leaves: leavesSvg(63, [80,140,50]) });

// --- 砖/石砖 ---
reg('cobblestone', { hardness: 2, tool: 'pickaxe' }, { cobblestone: cobblestoneSvg(71) });
reg('stone_bricks', { hardness: 1.5, tool: 'pickaxe' }, { stone_bricks: noiseBlock([128,128,128], [100,100,100], 72) });
reg('mossy_cobblestone', { hardness: 2, tool: 'pickaxe' }, { mossy_cobblestone: noiseBlock([80,100,60], [60,80,40], 73) });
reg('brick_block', { hardness: 2, tool: 'pickaxe' }, { brick_block: noiseBlock([150,60,40], [120,40,30], 74) });
reg('nether_bricks', { hardness: 2, tool: 'pickaxe' }, { nether_bricks: noiseBlock([40,20,30], [20,10,20], 75) });
reg('sandstone', { hardness: 0.8, tool: 'pickaxe' }, { sandstone: noiseBlock([220,210,170], [200,190,150], 76) });
reg('red_sandstone', { hardness: 0.8, tool: 'pickaxe' }, { red_sandstone: noiseBlock([200,100,50], [170,80,30], 77) });
reg('quartz_block', { hardness: 0.8, tool: 'pickaxe' }, { quartz_block: noiseBlock([240,235,220], [220,215,200], 78) });

// --- 功能方块 ---
reg('crafting_table', { textures: { top: 'crafting_table_top', side: 'crafting_table_side', bottom: 'oak_planks' }, hardness: 2.5 },
  {
    crafting_table_top: logTopSvg('rgb(180,140,80)', 'rgb(140,100,50)'),
    crafting_table_side: logSideSvg('rgb(120,85,50)', 'rgb(100,70,40)')
  });
reg('furnace', { textures: { top: 'stone', side: 'furnace_side', bottom: 'stone' }, hardness: 3.5, tool: 'pickaxe' },
  { furnace_side: noiseBlock([100,100,100], [80,80,80], 81) });
reg('glass', { transparent: true, hardness: 0.3 }, { glass: glassSvg() });
reg('glowstone', { displayName: '荧石', light: 15, hardness: 0.3 }, { glowstone: noiseBlock([200,170,80], [255,220,120], 85, 0.8) });
reg('sea_lantern', { displayName: '海晶灯', light: 15, hardness: 0.3 }, { sea_lantern: noiseBlock([150,200,220], [120,180,200], 86, 0.7) });
reg('torch', { displayName: '火把', transparent: true, light: 14, hardness: 0, renderType: 'cross', solid: false },
  { torch: (function(){ const px = new Array(256).fill(null);
    // 火把：上半黄色火，下半棕色棍
    for (let y = 2; y < 6; y++) for (let x = 7; x < 10; x++) px[y*16+x] = 'rgb(255,200,50)';
    for (let y = 6; y < 14; y++) for (let x = 7; x < 10; x++) px[y*16+x] = 'rgb(120,80,40)';
    px[1*16+8] = 'rgb(255,230,100)';
    return pixelSvg(px); })()
  });

// --- 金面方块 ---
reg('iron_block', { hardness: 5, tool: 'pickaxe' }, { iron_block: noiseBlock([220,220,220], [180,180,180], 91) });
reg('gold_block', { hardness: 5, tool: 'pickaxe' }, { gold_block: noiseBlock([240,220,80], [200,180,60], 92) });
reg('diamond_block', { hardness: 5, tool: 'pickaxe' }, { diamond_block: noiseBlock([100,230,230], [70,200,200], 93) });
reg('emerald_block', { hardness: 5, tool: 'pickaxe' }, { emerald_block: noiseBlock([40,220,80], [30,180,60], 94) });
reg('lapis_block', { hardness: 3, tool: 'pickaxe' }, { lapis_block: noiseBlock([40,60,200], [30,50,160], 95) });
reg('redstone_block', { hardness: 5, tool: 'pickaxe', light: 15 }, { redstone_block: noiseBlock([180,30,30], [140,20,20], 96) });
reg('coal_block', { hardness: 5, tool: 'pickaxe' }, { coal_block: noiseBlock([30,30,30], [20,20,20], 97) });

// --- 植物 ---
reg('cactus', { transparent: true, solid: true, hardness: 0.4 }, { cactus: cactusSvg(101) });
reg('pumpkin', { textures: { top: 'pumpkin_top', side: 'pumpkin_side', bottom: 'pumpkin_top' }, hardness: 1 },
  { pumpkin_top: noiseBlock([180,120,30], [150,100,20], 102), pumpkin_side: noiseBlock([180,120,30], [150,100,20], 103) });
reg('melon', { hardness: 1 }, { melon: noiseBlock([80,160,40], [60,140,30], 104) });
reg('hay_block', { textures: { top: 'hay_top', side: 'hay_side', bottom: 'hay_top' }, hardness: 0.5 },
  { hay_top: logTopSvg('rgb(200,170,60)', 'rgb(180,150,40)'), hay_side: logSideSvg('rgb(200,170,60)', 'rgb(180,150,40)') });

// --- 下界/末地 ---
reg('netherrack', { hardness: 0.4, tool: 'pickaxe' }, { netherrack: noiseBlock([80,40,40], [60,30,30], 111) });
reg('end_stone', { hardness: 3, tool: 'pickaxe' }, { end_stone: noiseBlock([220,220,160], [200,200,140], 112) });
reg('soul_sand', { hardness: 0.5, tool: 'shovel' }, { soul_sand: noiseBlock([80,60,50], [60,40,30], 113) });
reg('magma_block', { displayName: '岩浆块', light: 6, hardness: 0.5, tool: 'pickaxe' }, { magma_block: noiseBlock([180,60,20], [140,40,10], 114, 0.8) });

// --- 红石相关 ---
reg('redstone_lamp', { displayName: '红石灯', light: 15, hardness: 0.3 }, { redstone_lamp: noiseBlock([200,160,80], [180,140,60], 121, 0.4) });
reg('redstone_torch', { displayName: '红石火把', transparent: true, light: 14, hardness: 0, renderType: 'cross', solid: false },
  { redstone_torch: (function(){ const px = new Array(256).fill(null);
    for (let y = 2; y < 6; y++) for (let x = 7; x < 10; x++) px[y*16+x] = 'rgb(220,40,40)';
    for (let y = 6; y < 14; y++) for (let x = 7; x < 10; x++) px[y*16+x] = 'rgb(120,80,40)';
    return pixelSvg(px); })()
  });
reg('lever', { transparent: true, hardness: 0, solid: false, renderType: 'cross' },
  { lever: (function(){ const px = new Array(256).fill(null);
    for (let y = 6; y < 14; y++) for (let x = 7; x < 10; x++) px[y*16+x] = 'rgb(100,70,40)';
    for (let y = 4; y < 7; y++) for (let x = 7; x < 10; x++) px[y*16+x] = 'rgb(160,160,160)';
    return pixelSvg(px); })()
  });
reg('stone_button', { transparent: true, hardness: 0, solid: false, renderType: 'cross' },
  { stone_button: (function(){ const px = new Array(256).fill(null);
    for (let y = 7; y < 9; y++) for (let x = 6; x < 10; x++) px[y*16+x] = 'rgb(140,140,140)';
    return pixelSvg(px); })()
  });
reg('oak_button', { transparent: true, hardness: 0, solid: false, renderType: 'cross' },
  { oak_button: (function(){ const px = new Array(256).fill(null);
    for (let y = 7; y < 9; y++) for (let x = 6; x < 10; x++) px[y*16+x] = 'rgb(160,130,70)';
    return pixelSvg(px); })()
  });
reg('redstone_wire', { transparent: true, hardness: 0, solid: false, renderType: 'cross' },
  { redstone_wire: (function(){ const px = new Array(256).fill(null);
    for (let y = 7; y < 9; y++) for (let x = 4; x < 12; x++) px[y*16+x] = 'rgb(200,20,20)';
    return pixelSvg(px); })()
  });
reg('redstone_block', { light: 0, hardness: 5, tool: 'pickaxe' }, { redstone_block: noiseBlock([180,20,20], [140,10,10], 122, 0.3) });
reg('piston', { textures: { top: 'piston_top', side: 'piston_side', bottom: 'piston_bottom' }, hardness: 1.5 }, {
  piston_top: noiseBlock([160,160,160], [130,130,130], 123, 0.2),
  piston_side: noiseBlock([140,110,70], [110,80,50], 124, 0.4),
  piston_bottom: noiseBlock([120,90,60], [90,70,40], 125, 0.4)
});
reg('piston_head', { transparent: true, hardness: 0.5, solid: false }, { piston_head: noiseBlock([160,160,160], [130,130,130], 126, 0.2) });
reg('sticky_piston', { textures: { top: 'sticky_piston_top', side: 'sticky_piston_side', bottom: 'sticky_piston_bottom' }, hardness: 1.5 }, {
  sticky_piston_top: noiseBlock([150,180,120], [120,150,90], 127, 0.2),
  sticky_piston_side: noiseBlock([140,110,70], [110,80,50], 128, 0.4),
  sticky_piston_bottom: noiseBlock([120,90,60], [90,70,40], 129, 0.4)
});
reg('tnt', { textures: { top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_bottom' }, hardness: 0, transparent: false }, {
  tnt_top: noiseBlock([180,60,40], [140,40,30], 130, 0.3),
  tnt_side: (function(){ const px = new Array(256); const r = rng(131);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const t = r();
      if (y < 2 || y > 13) px[y*16+x] = `rgb(${100+Math.round(t*30)},${60+Math.round(t*20)},${40+Math.round(t*10)})`;
      else px[y*16+x] = `rgb(${180+Math.round(t*40)},${60+Math.round(t*20)},${40+Math.round(t*10)})`;
    }
    // 文字条
    for (let y = 6; y < 10; y++) for (let x = 3; x < 13; x++) px[y*16+x] = 'rgb(240,240,240)';
    return pixelSvg(px); })(),
  tnt_bottom: noiseBlock([100,60,40], [80,40,30], 132, 0.3)
});
reg('oak_door', { transparent: true, hardness: 1, solid: false }, { oak_door: noiseBlock([160,130,70], [130,100,50], 133, 0.4) });
reg('iron_door', { transparent: true, hardness: 5, solid: false, tool: 'pickaxe' }, { iron_door: noiseBlock([180,180,180], [140,140,140], 134, 0.2) });
reg('oak_trapdoor', { transparent: true, hardness: 1, solid: false }, { oak_trapdoor: noiseBlock([160,130,70], [130,100,50], 135, 0.4) });
reg('note_block', { hardness: 1 }, { note_block: noiseBlock([160,130,70], [130,100,50], 136, 0.4) });

// --- 混凝土（染色算 1 种，以白色代表）---
reg('white_concrete', { hardness: 1.8, tool: 'pickaxe' }, { white_concrete: noiseBlock([220,220,220], [200,200,200], 131, 0.2) });
reg('white_wool', { hardness: 0.8 }, { white_wool: noiseBlock([230,230,230], [200,200,200], 132, 0.5) });
reg('white_terracotta', { hardness: 1.25, tool: 'pickaxe' }, { white_terracotta: noiseBlock([160,140,120], [140,120,100], 133) });
reg('white_bed', { transparent: true, hardness: 0.2 }, { white_bed: noiseBlock([230,230,230], [200,200,200], 134, 0.5) });

export const BlockSVGDefinitions = svgMap;

export function getBlockCount() {
  return BlockRegistry.all().length;
}
