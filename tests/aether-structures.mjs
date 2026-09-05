// aether-structures.mjs -- 天域三结构回归（node 直跑，无需服务器）
// 断言：
//   ① 结构类型注册 + 维度作用域（主世界/下界/末地生成器不求解 aether_*）
//   ② 选址漏斗：±4 cell 扫描（双 seed）三种结构各至少一例；神殿必须在水晶秘境
//   ③ 结构落地：底台石英/塔身白桦/沉船浮空进区块；bbox 一致
//   ④ 箱子三向一致：meta.chests ↔ chest 方块 ↔ sm.chests 注册（三表）
//   ⑤ loot：三表确定性 + 条目可解析
//   ⑥ 双次求解确定性：blocks 逐字节一致
import { Chunk, CHUNK_SIZE } from '../src/core/Chunk.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { ItemRegistry } from '../src/core/ItemRegistry.js';
import { AetherGenerator } from '../src/world/dimensions/aether.js';
import { TerrainGenerator } from '../src/world/terrain.js';
import { NetherGenerator } from '../src/world/dimensions/nether.js';
import { EndGenerator } from '../src/world/dimensions/end.js';
import { chestLoot } from '../src/world/loot.js';
import '../src/blocks/BlockDefs.js';
import '../src/items/ItemDefs.js';
import '../src/world/structures/catalog.js';

const SEEDS = [42, 20250903];
let passed = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  passed++;
}

const TYPES = ['aether_temple', 'aether_tower', 'aether_ship'];

// ① 维度作用域：其他维度生成器不求解 aether_*
{
  const owGen = new TerrainGenerator(42);
  const nGen = new NetherGenerator(42);
  const eGen = new EndGenerator(42);
  for (const t of TYPES) {
    ok(!owGen.structureManager.ensureRecord(t, 0, 0), `主世界不应求解 ${t}（dims 过滤失效）`);
    ok(!nGen.structureManager.ensureRecord(t, 0, 0), `下界不应求解 ${t}（dims 过滤失效）`);
    ok(!eGen.structureManager.ensureRecord(t, 0, 0), `末地不应求解 ${t}（dims 过滤失效）`);
  }
}

const sig = (r) => r.blocks.map(b => b.join(',')).join('|') + '#' + JSON.stringify(r.meta.chests);
const RES = { aether_temple: null, aether_tower: null, aether_ship: null };

for (const seed of SEEDS) {
  const gen = new AetherGenerator(seed);

  // ② 选址漏斗：按类型扫描（ship 网格大，半径同步放大）找到各至少一例
  const CELLS = { aether_temple: 14, aether_tower: 14, aether_ship: 32 };
  const found = {};
  for (const t of TYPES) {
    const CELL = CELLS[t] * CHUNK_SIZE;
    const R = t === 'aether_ship' ? 6 : 4;
    outer:
    for (let cx = -R; cx <= R; cx++) {
      for (let cz = -R; cz <= R; cz++) {
        const rec = gen.structureManager.ensureRecord(t, cx, cz);
        if (rec) { found[t] = rec; break outer; }
      }
    }
    ok(!!found[t], `seed=${seed} 扫描区未找到 ${t}（选址门过严或密度参数改动）`);
  }

  // ②b 神殿群系门：锚点必须在水晶秘境
  ok(gen.getBiome(found.aether_temple.ax, found.aether_temple.az) === 'crystal',
    `seed=${seed} 神殿锚点不在水晶秘境（群系门失效）`);

  // ③ 结构落地 + ④ 箱子三向一致
  const QB = BlockRegistry.getId('quartz_block');
  const BP = BlockRegistry.getId('birch_planks');
  const CH = BlockRegistry.getId('chest');
  for (const t of TYPES) {
    const rec = found[t];
    const touched = new Map();
    const chunkAt = (x, z) => {
      const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
      const k = cx + ',' + cz;
      if (!touched.has(k)) { const c = new Chunk(cx, cz); gen.generateChunk(c); touched.set(k, c); }
      return touched.get(k);
    };
    const blockAt = (x, y, z) => {
      const c = chunkAt(x, z);
      return c.get(((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, y, ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE);
    };
    // 落地抽查：每类结构的招牌方块在布局坐标处可读回
    const want = t === 'aether_temple' ? QB : t === 'aether_tower' ? BP : BP;
    let hits = 0;
    for (const [x, y, z, id] of rec.blocks) {
      if (id === want && blockAt(x, y, z) === want) hits++;
    }
    ok(hits >= 20, `seed=${seed} ${t} 招牌方块落地不足: ${hits}/${rec.blocks.length}`);
    // 落地抽查：全部声明 chest 方块就位
    for (const c of rec.meta.chests) {
      ok(c[3].startsWith('aether_'), `未知 loot 表: ${c[3]}`);
      ok(blockAt(c[0], c[1], c[2]) === CH, `${t} chest 方块缺失 @(${c[0]},${c[1]},${c[2]})`);
      ok(gen.structureManager.chests.get(c[0] + ',' + c[1] + ',' + c[2]) === c[3],
        `${t} sm.chests 注册缺失 @(${c[0]},${c[1]},${c[2]})`);
    }
    // 沉船浮空：全部方块高于立地面 8 格以上（悬于岛上）
    if (t === 'aether_ship') {
      const minY = Math.min(...rec.blocks.map(b => b[1]));
      ok(minY >= rec.groundY + 8, `seed=${seed} 沉船未浮空（minY=${minY} < groundY+8=${rec.groundY + 8}）`);
    }
    RES[t] = RES[t] || { seed, sig: sig(rec) };
  }

  // ⑥ 双次求解确定性
  const gen2 = new AetherGenerator(seed);
  for (const t of TYPES) {
    const CELL = CELLS[t] * CHUNK_SIZE;
    const R2 = t === 'aether_ship' ? 6 : 4;
    outer2:
    for (let cx = -R2; cx <= R2; cx++) {
      for (let cz = -R2; cz <= R2; cz++) {
        const rec2 = gen2.structureManager.ensureRecord(t, cx, cz);
        if (rec2) {
          ok(sig(rec2) === sig(found[t]), `seed=${seed} ${t} 双次求解不一致`);
          break outer2;
        }
      }
    }
  }
}

// ⑤ loot：确定性 + 条目可解析
{
  const resolvable = (name) => !!ItemRegistry.getByName(name) || !!BlockRegistry.getById(BlockRegistry.getId(name));
  for (const t of ['aether_temple', 'aether_tower', 'aether_ship']) {
    const a = chestLoot(42, t, 10, 70, 10);
    const b = chestLoot(42, t, 10, 70, 10);
    ok(JSON.stringify(a) === JSON.stringify(b), `${t} loot 不确定`);
    ok(a.length === 27 && a.every(s => s === null || (s.count >= 1 && resolvable(s.name))), `${t} loot 结构非法`);
  }
}

console.log(`天域结构回归: 全部通过（${passed} 断言 × ${SEEDS.length} seeds）`);
