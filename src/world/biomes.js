// biomes.js -- 群系定义：平原 / 沙漠 / 积雪针叶林 / 河流
export const Biomes = {
  PLAINS: 0,
  DESERT: 1,
  SNOWY_TAIGA: 2,
  RIVER: 3
};

export const BiomeNames = {
  [Biomes.PLAINS]: '平原',
  [Biomes.DESERT]: '沙漠',
  [Biomes.SNOWY_TAIGA]: '积雪针叶林',
  [Biomes.RIVER]: '河流'
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
    flowerChance: 0.05
  },
  [Biomes.DESERT]: {
    name: '沙漠',
    surfaceBlock: 'sand',
    subsurfaceBlock: 'sand',
    undergroundBlock: 'stone',
    topHeight: 3,
    treeChance: 0,
    cactusChance: 0.02,
    deadBushChance: 0.01
  },
  [Biomes.SNOWY_TAIGA]: {
    name: '积雪针叶林',
    surfaceBlock: 'snow_block',
    subsurfaceBlock: 'dirt',
    undergroundBlock: 'stone',
    topHeight: 5,
    treeChance: 0.08,
    treeType: 'spruce',
    snowLayer: true
  },
  [Biomes.RIVER]: {
    name: '河流',
    surfaceBlock: 'sand',
    subsurfaceBlock: 'sand',
    undergroundBlock: 'stone',
    topHeight: 1,
    treeChance: 0,
    isWater: true
  }
};
