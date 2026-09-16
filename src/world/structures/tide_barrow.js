// tide_barrow.js -- 潮冢（世界观批次 W2）：主世界·雨土纪的河床遗骸坑
// 结构：河心下挖 2 格的椭圆形坑（显式水填保潜水语义）+ 沉船残骸半页（云杉木）
//      + 骨环（骨白毛块环 + 四正位凋灵骷髅头）+ 星髓碎屑（水下微光）+ 苔纹石碑 + 箱×1。
// 选址（worldview.md §10.2 调研结论，方案 A' 锚点随河）：本生成器无海洋群系、河道最深 -6，
// anchorForCell 全 cell 粗扫河段（区块步进）→ place/solve 共用 findCore 细扫定河心
// （水深≥2 / 3×3 起伏≤2）；概率门 0.5 移入 anchor 函数内（覆盖时管理器 attempts/chance 门不生效）。
// 不变量：布局只由 (seed, cell 锚点) 决定；findCore 纯函数（扫描序固定、严格更深者胜出）——
// 任意端/任意顺序逐字节一致（联机根基）；坑体不改变海床水体语义（坑内显式水填至海平面）。
import { blockId, hash32 } from './StructureManager.js';
import { Biomes } from '../biomes.js';
import { SEA_LEVEL } from '../../core/Chunk.js';
import { steleStack } from '../steles.js';

const CELL = 28;        // 28 区块网格（448 格）——要塞同稀有档
const SALT = 7267;      // 与 fortress(5150)/tidefire_hearth(7266) 等既有类型错开
const CHANCE = 0.5;     // 概率门（anchor 内生效）：半数含河 cell 无冢
const MIN_DEPTH = 2;    // 河心最小水深（保证坑体整体没入水下）
const RX = 6.3, RZ = 4.3;      // 坑体椭圆半径（13×9）
const FINE_R = 8;       // place 细扫半径（覆盖锚点区块全域）

// 河心定位（place 与 solve 共用，保证结构中心与选址验证同源）：
// 以锚点为中心 ±FINE_R 逐步扫描 RIVER 列，取最深者为河心（平局取扫描序首个）。
function findCore(gen, ax, az) {
  let core = null;
  for (let dx = -FINE_R; dx <= FINE_R; dx++) {
    for (let dz = -FINE_R; dz <= FINE_R; dz++) {
      const x = ax + dx, z = az + dz;
      if (gen.getBiome(x, z) !== Biomes.RIVER) continue;
      const bedY = gen.getBaseHeight(x, z);
      const d = SEA_LEVEL - bedY;
      if (d < MIN_DEPTH) continue;
      if (!core || d > core.d) core = { x, z, bedY, d };
    }
  }
  if (!core) return null;
  // 河心 3×3 起伏 ≤2（坑底贴合河床）
  let mn = core.bedY, mx = core.bedY;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const h = gen.getBaseHeight(core.x + dx, core.z + dz);
    if (h < mn) mn = h;
    if (h > mx) mx = h;
  }
  if (mx - mn > 2) return null;
  return core;
}

// 选址覆盖（结构管理器在 place 定义时跳过默认平坦度检查）：
// 锚点即 riverAnchor 选出的最深河段区块中心，这里细扫定河心并返回 groundY = 河床顶 + 1。
function placeBarrow(gen, ax, az) {
  const core = findCore(gen, ax, az);
  if (!core) return -1;
  return core.bedY + 1;
}

// 锚点覆盖（非网格锚点，要塞环带同款）：全 cell 区块步进粗扫 RIVER 列，
// 取水深最深区块；概率门在函数内（0.5）——返回 null 表示该 cell 无结构。
function riverAnchor(sm, ccx, ccz) {
  const h = hash32(sm.seed, ccx, ccz, SALT);
  if ((h >>> 16) / 65536 >= CHANCE) return null;
  const gen = sm.generator;
  let best = null;
  for (let bx = ccx * CELL; bx < (ccx + 1) * CELL; bx++) {
    for (let bz = ccz * CELL; bz < (ccz + 1) * CELL; bz++) {
      const wx = bx * 16 + 8, wz = bz * 16 + 8;
      if (gen.getBiome(wx, wz) !== Biomes.RIVER) continue;
      const d = SEA_LEVEL - gen.getBaseHeight(wx, wz);
      if (d < MIN_DEPTH) continue;
      if (!best || d > best.d) best = { bx, bz, d };
    }
  }
  return best ? { cx: best.bx, cz: best.bz } : null;
}

export const TIDE_BARROW_DEF = {
  cell: CELL,
  chance: 1,          // anchorForCell 覆盖时管理器概率门不生效（门在 riverAnchor 内）
  radius: 20,         // 覆盖坑体 ±7 与碑位
  salt: SALT,
  dims: ['overworld'],
  anchorForCell: riverAnchor,
  place: placeBarrow,
  solve: solveBarrow,
};

export function solveBarrow(rng, ax, groundY, az, gen) {
  const SAND = blockId('sand');
  const CLAY = blockId('clay');
  const WATER = blockId('water');
  const WOOL = blockId('white_wool');
  const SKULL = blockId('wither_skeleton_skull');
  const MARROW = blockId('star_marrow_block');
  const CHEST = blockId('chest');
  const LOG = blockId('spruce_log');
  const PLANK = blockId('spruce_planks');

  // 河心与选址同源重解（place 已验证存在；防御回落 = 原地构建）
  const core = (gen && findCore(gen, ax, az)) || { x: ax, z: az, bedY: groundY - 1, d: 0 };
  const cx = core.x, cz = core.z;
  const floorY = groundY - 3;   // 坑底 = 河床顶下 2 格（groundY = bedY+1）
  const blocks = [];
  const meta = { kind: 'tide_barrow', center: [cx, groundY, cz], chests: [], steles: [] };

  // ① 坑体：椭圆 13×9 挖至坑底 + 显式水填至海平面（保潜水语义，坑缘以上交还地形）
  const inPit = (dx, dz) => (dx * dx) / (RX * RX) + (dz * dz) / (RZ * RZ) <= 1;
  for (let dx = -7; dx <= 7; dx++) {
    for (let dz = -5; dz <= 5; dz++) {
      if (!inPit(dx, dz)) continue;
      for (let y = floorY + 1; y <= SEA_LEVEL; y++) blocks.push([cx + dx, y, cz + dz, WATER]);
      blocks.push([cx + dx, floorY, cz + dz, SAND]);
    }
  }
  // 坑底中央铺粘土（泥沙掩埋的旧潮渍迹）
  for (let dx = -1; dx <= 2; dx++) for (let dz = -1; dz <= 1; dz++) {
    blocks.push([cx + dx, floorY, cz + dz, CLAY]);
  }

  // ② 沉船残骸半页（咸雨章：「环着半页沉船的旧木」）——云杉木半埋于坑心
  for (const [dx, dz] of [[-1, 0], [0, 0], [1, 0]]) blocks.push([cx + dx, floorY + 1, cz + dz, PLANK]);
  blocks.push([cx, floorY + 2, cz, LOG]);
  blocks.push([cx + 2, floorY + 1, cz, LOG]);

  // ③ 骨环（12 位椭圆环）：骨白毛块环体 + 四正位凋灵骷髅头（溯洄的溺亡者/炉卫遗骸）
  for (const [dx, dz] of [[4, 0], [-4, 0], [0, 3], [0, -3]]) blocks.push([cx + dx, floorY + 1, cz + dz, SKULL]);
  for (const [dx, dz] of [[3, 2], [3, -2], [-3, 2], [-3, -2]]) blocks.push([cx + dx, floorY + 1, cz + dz, WOOL]);

  // ④ 星髓碎屑（潮的骨头沉在河床，水下微光）——环外散布 6 枚（固定点位不耗 rng）
  for (const [dx, dz] of [[-5, 0], [5, 0], [-3, 3], [3, 3], [-4, -2], [4, -2]]) {
    blocks.push([cx + dx, floorY + 1, cz + dz, MARROW]);
  }

  // ⑤ 苔纹石碑（坑体北缘，正对残骸；Build 20 ① 四格形制：底座苔石压坑底沙、荧石在
  //    水下发亮照亮骨环）+ 箱（tide_barrow 表，FORCED 雨潮残页保底）
  meta.steles.push([cx, floorY + 1, cz + 4, 'rain_salted']);
  meta.chests.push([cx + 3, floorY + 1, cz + 1, 'tide_barrow']);
  for (const s of meta.steles) {
    for (const [bx, by, bz, bid] of steleStack(s[0], s[1], s[2], 'overworld')) blocks.push([bx, by, bz, bid]);
  }
  for (const c of meta.chests) blocks.push([c[0], c[1], c[2], CHEST]);

  return { blocks, meta };
}
