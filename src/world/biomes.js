// biomes.js -- 群系定义：平原 / 沙漠 / 积雪针叶林 / 针叶林 / 高山 / 桦木森林 / 河流
// BiomeConfig 参数化字段（terrain.js 消费）：
//   heightScale  基础 fbm 高度振幅缩放（默认 1.0）
//   heightOffset 群系固定抬升/下压（米）
//   peakBoost    高山专用：超过判定阈值的山地噪声值额外加成（山脊更高更陡）
//   snowLine     表面高度 ≥ 此值时表面铺雪块 + 顶部雪层（高山雪线）
//   gravelPatch  高山砾石斑块（表面层按噪声成片置换为砾石）
export const Biomes = {
  PLAINS: 0,
  DESERT: 1,
  SNOWY_TAIGA: 2,
  RIVER: 3,
  MOUNTAINS: 4,
  BIRCH_FOREST: 5,
  TAIGA: 6,
  SWAMP: 7,
  SUNFLOWER_PLAINS: 8,
  MUSHROOM_FIELDS: 9
};

export const BiomeNames = {
  [Biomes.PLAINS]: '平原',
  [Biomes.DESERT]: '沙漠',
  [Biomes.SNOWY_TAIGA]: '积雪针叶林',
  [Biomes.RIVER]: '河流',
  [Biomes.MOUNTAINS]: '高山',
  [Biomes.BIRCH_FOREST]: '桦木森林',
  [Biomes.TAIGA]: '针叶林',
  [Biomes.SWAMP]: '沼泽',
  [Biomes.SUNFLOWER_PLAINS]: '向日葵平原',
  [Biomes.MUSHROOM_FIELDS]: '蘑菇岛'
};

// 群系配置
export const BiomeConfig = {
  [Biomes.PLAINS]: {
    name: '平原',
    surfaceBlock: 'grass_block',
    subsurfaceBlock: 'dirt',
    undergroundBlock: 'stone',
    topHeight: 4,
    treeChance: 0.02,
    treeType: 'oak',
    grassChance: 0.3,
    flowerChance: 0.05,
    heightScale: 1.0,
    heightOffset: 0
  },
  [Biomes.DESERT]: {
    name: '沙漠',
    surfaceBlock: 'sand',
    subsurfaceBlock: 'sand',
    undergroundBlock: 'stone',
    topHeight: 3,
    treeChance: 0,
    cactusChance: 0.02,
    deadBushChance: 0.01,
    heightScale: 1.0,
    heightOffset: -2
  },
  [Biomes.SNOWY_TAIGA]: {
    name: '积雪针叶林',
    surfaceBlock: 'snow_block',
    subsurfaceBlock: 'dirt',
    undergroundBlock: 'stone',
    topHeight: 5,
    treeChance: 0.08,
    treeType: 'spruce',
    snowLayer: true,
    heightScale: 1.0,
    heightOffset: 8
  },
  [Biomes.RIVER]: {
    name: '河流',
    surfaceBlock: 'sand',
    subsurfaceBlock: 'sand',
    undergroundBlock: 'stone',
    topHeight: 1,
    treeChance: 0,
    isWater: true,
    heightScale: 1.0,
    heightOffset: 0
  },
  [Biomes.MOUNTAINS]: {
    name: '高山',
    surfaceBlock: 'stone',
    subsurfaceBlock: 'stone',
    undergroundBlock: 'stone',
    topHeight: 8,
    treeChance: 0,
    heightScale: 3.2,
    heightOffset: 14,
    peakBoost: 80,
    snowLine: 96,
    gravelPatch: true
  },
  [Biomes.BIRCH_FOREST]: {
    name: '桦木森林',
    surfaceBlock: 'grass_block',
    subsurfaceBlock: 'dirt',
    undergroundBlock: 'stone',
    topHeight: 4,
    treeChance: 0.09,
    treeType: 'birch',
    grassChance: 0.3,
    flowerChance: 0.05,
    heightScale: 1.0,
    heightOffset: 2
  },
  [Biomes.TAIGA]: {
    name: '针叶林',
    surfaceBlock: 'grass_block',
    subsurfaceBlock: 'dirt',
    undergroundBlock: 'stone',
    topHeight: 5,
    treeChance: 0.14,
    treeType: 'spruce',
    heightScale: 1.0,
    heightOffset: 3
  },
  [Biomes.SWAMP]: {
    name: '沼泽',
    surfaceBlock: 'grass_block',
    subsurfaceBlock: 'dirt',
    undergroundBlock: 'stone',
    topHeight: 2,
    treeChance: 0.02,
    treeType: 'oak',
    heightScale: 0.2,   // 压平：n 仅 ±4
    heightOffset: 1,    // 地表贴海平面上沿
    pondClay: true,     // 水下列表面铺粘土
    lilyPadChance: 0.06 // 水面睡莲概率
  },
  [Biomes.SUNFLOWER_PLAINS]: {
    name: '向日葵平原',
    surfaceBlock: 'grass_block',
    subsurfaceBlock: 'dirt',
    undergroundBlock: 'stone',
    topHeight: 4,
    treeChance: 0.01,
    treeType: 'oak',
    heightScale: 1.0,
    heightOffset: 0,
    sunflowerChance: 0.04, // 向日葵密植（群系辨识核心）
    grassChance: 0.1       // 草丛（小麦种子来源之一）
  },
  [Biomes.MUSHROOM_FIELDS]: {
    name: '蘑菇岛',
    surfaceBlock: 'mycelium',
    subsurfaceBlock: 'dirt',
    undergroundBlock: 'stone',
    topHeight: 3,
    treeChance: 0,        // 无普通树（原版语义）
    heightScale: 0.6,     // 平缓丘陵
    heightOffset: 2,
    hugeMushroomChance: 0.03,   // 巨型蘑菇概率（类似树）
    smallMushroomChance: 0.05   // 地面小蘑菇
  }
};

// 生物群系规模档位（world/biome-scale 批次）：freqMul 乘在 getBiome 全部噪声频率上，
// 频率越小斑块越大。small=1.0 必须与旧版逐字节一致（现有世界/确定性测试零变化的锚点）。
// 洞穴频率与基础地形噪声不参与缩放（群系布局 ≠ 地形细节）。
export const BIOME_SCALES = {
  small:  { label: '小', freqMul: 1.0 },
  medium: { label: '中', freqMul: 0.55 },
  large:  { label: '大', freqMul: 0.35 },
  huge:   { label: '巨大', freqMul: 0.22 }
};

export const DEFAULT_BIOME_SCALE = 'small';

// 非法值兜底（存档/联机消息清洗共用）
export function safeBiomeScale(v) {
  return (v && BIOME_SCALES[v]) ? v : DEFAULT_BIOME_SCALE;
}
