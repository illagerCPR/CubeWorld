// dimensions.js -- 维度注册表：生成器 / 天空 / 光照 / 出生点 / 雾档案
// 新增维度 = 加一个注册表项（生成器必须是纯函数 of (seed, 坐标)）；
// implemented:false 的维度不可达（CommandPanel 不展示、switchDimension 拒绝）。
import { TerrainGenerator } from '../world/terrain.js';
import { NetherGenerator, SPAWN_SCAN_TOP } from '../world/dimensions/nether.js';
import { EndGenerator } from '../world/dimensions/end.js';
import { AetherGenerator } from '../world/dimensions/aether.js';

export const DEFAULT_DIMENSION = 'overworld';

export const DIMENSIONS = {
  overworld: {
    id: 'overworld',
    name: '主世界',
    implemented: true,
    createGenerator: (seed) => new TerrainGenerator(seed),
    noDayCycle: false,
    sky: { fixedColor: null, celestials: true, clouds: true, cloudsY: 140, fog: { color: null, nearK: 0.5, farK: 0.95 } },
    light: { hasSkylight: true },
    hasVoid: false,
  },
  nether: {
    id: 'nether',
    name: '下界',
    implemented: true,
    createGenerator: (seed) => new NetherGenerator(seed),
    noDayCycle: true, // 无昼夜：Sky.isDay 恒 false（怪物不燃烧），isNight 恒 true（生成无视昼夜）
    sky: {
      fixedColor: [0.16, 0.05, 0.05], celestials: false, clouds: false, cloudsY: 140,
      fog: { color: null, nearK: 0.30, farK: 0.80 }, // 浓雾收口在加载圈内
    },
    // 无天光：整块恒定环境天光 ambientSky(0-15)；skyLightLevel 覆盖 Sky.getLightLevel
    //（uDayLight 恒定）；sunTint 为恒定天光染色（暗红氛围）
    light: { hasSkylight: false, ambientSky: 5, skyLightLevel: 1.0, sunTint: [1.0, 0.72, 0.60] },
    spawnScanTop: SPAWN_SCAN_TOP, // 怪物生成扫描顶（基岩天花之下）
    hasVoid: false,
  },
  end: {
    id: 'end',
    name: '末地',
    implemented: true,
    createGenerator: (seed) => new EndGenerator(seed),
    noDayCycle: true,
    sky: { fixedColor: [0.05, 0.03, 0.09], celestials: false, clouds: false, cloudsY: 140, fog: { color: null, nearK: 0.40, farK: 0.90 } },
    light: { hasSkylight: false, ambientSky: 6, skyLightLevel: 1.0, sunTint: [0.85, 0.80, 1.0] },
    hasVoid: true,
  },
  aether: {
    id: 'aether',
    name: '天域',
    implemented: true,
    createGenerator: (seed) => new AetherGenerator(seed),
    noDayCycle: false,
    // 永昼：polarDay 让太阳绕天穹打转恒不落（Sky.update）；fixedColor 恒亮天蓝（雾色同步）；
    // skyLightLevel 恒 1 → 体素光 uDayLight 恒定全亮（与下界同款覆盖路径，但天光仍正常传播）
    sky: {
      fixedColor: [0.45, 0.70, 1.0], polarDay: true,
      celestials: true, clouds: true, cloudsY: 190, fog: { color: null, nearK: 0.5, farK: 0.95 },
    },
    light: { hasSkylight: true, skyLightLevel: 1.0 },
    hasVoid: true, // 掉下浮岛坠虚空
  },
};

export function getDimension(id) {
  return Object.prototype.hasOwnProperty.call(DIMENSIONS, id) ? DIMENSIONS[id] : null;
}
