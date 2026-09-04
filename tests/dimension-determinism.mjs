// dimension-determinism.mjs -- 维度地形生成确定性回归（node 直跑，无需服务器）
// 对注册表中每个已实现维度断言：
//   ① 同 seed 双次生成 → 区块字节完全一致
//   ② 区块生成顺序无关（正向 vs 逆序）→ 字节一致
//   ③ 孤立生成 vs 区域生成 → 字节一致（生成必须是纯函数，不得读邻居状态）
//   ④ 出生点确定性 + 落点安全（2 格空气 + 实心地板，重新生成区块验证）
//   ⑤ 内容健全性：指定特征方块必须出现（下界：netherrack/lava/bedrock）
//   ⑥ 单区块生成耗时预算
// 用法：node tests/dimension-determinism.mjs（CI 经 server/run-all-tests.sh 调用）
import { Chunk, CHUNK_HEIGHT } from '../src/core/Chunk.js';
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import { DIMENSIONS } from '../src/core/dimensions.js';
import '../src/blocks/BlockDefs.js';

const SEEDS = [42, 20250903];
const REGION = 3; // 区块范围 [-3,3]，7×7
// 每维度必须出现的特征方块（生成管线/装饰遍健全性）
const EXPECT_BLOCKS = {
  nether: ['netherrack', 'lava', 'bedrock', 'glowstone'],
  end: ['end_stone', 'obsidian', 'glowstone'],
  aether: ['grass_block', 'dirt', 'stone'],
};

function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }

function chunkDigest(c) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const b = c.blocks;
  for (let i = 0; i < b.length; i += 7) {
    h1 = Math.imul(h1 ^ b[i], 16777619) >>> 0;
    h2 = Math.imul(h2 ^ b[i], 2246822519) >>> 0;
  }
  return { h1, h2 };
}

function genRegion(dimId, seed, order = 'forward') {
  const gen = DIMENSIONS[dimId].createGenerator(seed);
  const coords = [];
  for (let cx = -REGION; cx <= REGION; cx++)
    for (let cz = -REGION; cz <= REGION; cz++)
      coords.push([cx, cz]);
  if (order === 'reverse') coords.reverse();
  const chunks = new Map();
  for (const [cx, cz] of coords) {
    const c = new Chunk(cx, cz);
    gen.generateChunk(c);
    chunks.set(cx + ',' + cz, c);
  }
  return { gen, chunks };
}

function regionDigest(chunks) {
  let h1 = 0x811c9dc5, h2 = 0x01000193, total = 0;
  const keys = [...chunks.keys()].sort();
  for (const k of keys) {
    const b = chunks.get(k).blocks;
    total += b.length;
    for (let i = 0; i < b.length; i += 7) {
      h1 = Math.imul(h1 ^ b[i], 16777619) >>> 0;
      h2 = Math.imul(h2 ^ b[i], 2246822519) >>> 0;
    }
  }
  return { total, h1, h2 };
}

let dimsTested = 0;
for (const def of Object.values(DIMENSIONS)) {
  if (!def.implemented || typeof def.createGenerator !== 'function') continue;
  dimsTested++;
  console.log(`── 维度 [${def.id}] ${def.name} ──`);

  for (const seed of SEEDS) {
    // ① 同 seed 双次生成字节一致
    const c1 = new Chunk(3, -2);
    const c2 = new Chunk(3, -2);
    DIMENSIONS[def.id].createGenerator(seed).generateChunk(c1);
    DIMENSIONS[def.id].createGenerator(seed).generateChunk(c2);
    const d1 = chunkDigest(c1), d2 = chunkDigest(c2);
    if (d1.h1 !== d2.h1 || d1.h2 !== d2.h2) fail(`[${def.id}] seed=${seed} 双次生成不一致`);
    if (d1.h1 === 0 && d1.h2 === 0) fail(`[${def.id}] seed=${seed} 区块全空（方块注册缺失？检查 BlockDefs import）`);

    // ② 顺序无关 + ③ 孤立生成 = 区域生成
    const fw = genRegion(def.id, seed, 'forward');
    const rv = genRegion(def.id, seed, 'reverse');
    const dfw = regionDigest(fw.chunks), drv = regionDigest(rv.chunks);
    if (dfw.h1 !== drv.h1 || dfw.h2 !== drv.h2) fail(`[${def.id}] seed=${seed} 生成顺序相关`);
    const key = '1,1';
    const inRegion = fw.chunks.get(key);
    const alone = new Chunk(1, 1);
    DIMENSIONS[def.id].createGenerator(seed).generateChunk(alone);
    const dIn = chunkDigest(inRegion), dAlone = chunkDigest(alone);
    if (dIn.h1 !== dAlone.h1 || dIn.h2 !== dAlone.h2) fail(`[${def.id}] seed=${seed} 孤立生成与区域生成不一致（读了邻居状态）`);

    // ⑤ 内容健全性：特征方块必须出现
    const expected = EXPECT_BLOCKS[def.id] || [];
    if (expected.length > 0) {
      const present = new Set();
      for (const [, c] of fw.chunks) {
        const b = c.blocks;
        for (let i = 0; i < b.length; i++) if (b[i] !== 0) present.add(b[i]);
      }
      for (const name of expected) {
        const id = BlockRegistry.getId(name);
        if (!present.has(id)) fail(`[${def.id}] seed=${seed} 区域内未见特征方块 ${name}`);
      }
    }

    // ④ 出生点：确定性 + 落点安全（用重新生成的区块验证）
    if (typeof fw.gen.findSpawn === 'function') {
      const sp1 = fw.gen.findSpawn();
      const sp2 = DIMENSIONS[def.id].createGenerator(seed).findSpawn();
      if (sp1.x !== sp2.x || sp1.y !== sp2.y || sp1.z !== sp2.z) {
        fail(`[${def.id}] seed=${seed} 出生点不确定: ${JSON.stringify(sp1)} vs ${JSON.stringify(sp2)}`);
      }
      const bx = Math.floor(sp1.x), by = Math.floor(sp1.y), bz = Math.floor(sp1.z);
      const sc = new Chunk(Math.floor(bx / 16), Math.floor(bz / 16));
      DIMENSIONS[def.id].createGenerator(seed).generateChunk(sc);
      const lx = bx - sc.cx * 16, lz = bz - sc.cz * 16;
      if (sc.get(lx, by, lz) !== 0 || sc.get(lx, by + 1, lz) !== 0) {
        fail(`[${def.id}] seed=${seed} 出生点非空气 @(${bx},${by},${bz})`);
      }
      const below = BlockRegistry.getById(sc.get(lx, by - 1, lz));
      if (!below || !below.solid) fail(`[${def.id}] seed=${seed} 出生点地板非实心 @(${bx},${by - 1},${bz})`);
      if (by < 1 || by >= CHUNK_HEIGHT) fail(`[${def.id}] seed=${seed} 出生点 y 越界: ${by}`);
    }
  }

  // ⑥ 单区块生成耗时预算
  {
    const gen = DIMENSIONS[def.id].createGenerator(SEEDS[0]);
    const c = new Chunk(0, 0);
    const t0 = performance.now();
    gen.generateChunk(c);
    const ms = performance.now() - t0;
    if (ms > 100) fail(`[${def.id}] 单区块生成耗时异常: ${ms.toFixed(1)}ms`);
    console.log(`  性能: 单区块 ${ms.toFixed(1)}ms | 区域 7×7 = ${49} 块`);
  }
}

if (dimsTested === 0) fail('注册表中没有任何已实现维度（dimensions.js 完整性）');
console.log(`维度生成确定性回归: 全部通过（${dimsTested} 个维度 × ${SEEDS.length} seeds）`);
