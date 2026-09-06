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
  SWAMP: 7
};

export const BiomeNames = {
  [Biomes.PLAINS]: '平原',
  [Biomes.DESERT]: '沙漠',
  [Biomes.SNOWY_TAIGA]: '积雪针叶林',
  [Biomes.RIVER]: '河流',
  [Biomes.MOUNTAINS]: '高山',
  [Biomes.BIRCH_FOREST]: '桦木森林',
  [Biomes.TAIGA]: '针叶林',
  [Biomes.SWAMP]: '沼泽'
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
  }
};
