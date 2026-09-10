// crops.js -- 耕种作物工具：阶段 id 表 / 水分检测（Game 生长驱动与 World 重载扫描共用）
import { BlockRegistry } from './BlockRegistry.js';

export const CROP_MAX_STAGE = 7;

let stageIds = null; // [id0..id7]，惰性解析（BlockDefs 全量注册完成后才有效）

function ensureStageIds() {
  if (stageIds) return;
  stageIds = [];
  for (let s = 0; s <= CROP_MAX_STAGE; s++) {
    const def = BlockRegistry.getByName(`wheat_crop_${s}`);
    stageIds.push(def ? def.id : -1);
  }
}

export function isCropId(id) {
  ensureStageIds();
  return stageIds.includes(id);
}

export function cropStageOf(id) {
  ensureStageIds();
  return stageIds.indexOf(id);
}

export function cropIdAtStage(stage) {
  ensureStageIds();
  return stageIds[stage];
}

// 水分：耕地所在层 9×9 方形域内有水（原版 4 格曼哈顿的简化；命中即生长概率翻倍）
export function isHydrated(world, x, y, z) {
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      if (dx === 0 && dz === 0) continue;
      const id = world.getBlock(x + dx, y, z + dz);
      const def = BlockRegistry.getById(id);
      if (def && def.fluid && def.name === 'water') return true;
    }
  }
  return false;
}
