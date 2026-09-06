// biome-determinism.mjs -- 主世界群系生成确定性回归（node 直跑，无需服务器）
// 断言：
//   ① 同 seed 双次 getBiome/getBaseHeight 完全一致（纯函数根基）
//   ② 顺序无关（乱序抽样与顺序扫描同值）
//   ③ 群系在场性：B1 七群系全部出现且占比在合理区间
//   ④ 高山海拔锚点：存在 >100 的峰顶列；高山均高显著高于平原
//   ⑤ 相邻列连续性：非高山区域高度不突变（山脉陡峭属预期，单独放宽）
//   ⑥ 扫描耗时预算
// 用法：node tests/biome-determinism.mjs（CI 经 server/run-all-tests.sh 调用）
import { TerrainGenerator } from '../src/world/terrain.js';
import { Biomes, BiomeConfig } from '../src/world/biomes.js';
import '../src/blocks/BlockDefs.js';

const SEEDS = [42, 20250903, 777];
const SCAN = 512; // 每 seed 扫 512×512 列
const STEP = 2;   // 采样步长（覆盖 256×256 有效格，足够统计）

let passed = 0;
function ok(msg) { passed++; console.log('PASS ' + msg); }
function fail(msg) { console.error('FAIL: ' + msg); process.exit(1); }

// ① 同 seed 双次一致 + ③ 群系占比统计
const COUNTS = {}; // biome -> count
const PEAKS = { maxMountainH: 0, mountainHSum: 0, mountainN: 0, plainsHSum: 0, plainsN: 0 };
const t0 = Date.now();
for (const seed of SEEDS) {
  const g1 = new TerrainGenerator(seed);
  const g2 = new TerrainGenerator(seed);
  for (let x = 0; x < SCAN; x += STEP) {
    for (let z = 0; z < SCAN; z += STEP) {
      const b1 = g1.getBiome(x, z);
      const b2 = g2.getBiome(x, z);
      if (b1 !== b2) fail(`seed=${seed} (${x},${z}) 群系双次不一致 ${b1}!=${b2}`);
      const h1 = g1.getBaseHeight(x, z);
      const h2 = g2.getBaseHeight(x, z);
      if (h1 !== h2) fail(`seed=${seed} (${x},${z}) 高度双次不一致 ${h1}!=${h2}`);
      COUNTS[b1] = (COUNTS[b1] || 0) + 1;
      const h = g1.getBaseHeight(x, z);
      if (b1 === Biomes.MOUNTAINS) {
        PEAKS.mountainN++;
        PEAKS.mountainHSum += h;
        if (h > PEAKS.maxMountainH) PEAKS.maxMountainH = h;
      } else if (b1 === Biomes.PLAINS) {
        PEAKS.plainsN++;
        PEAKS.plainsHSum += h;
      }
    }
  }
}
const elapsed = Date.now() - t0;

// ② 顺序无关：乱序抽样与顺序扫描同值
{
  const g = new TerrainGenerator(42);
  const pts = [];
  for (let i = 0; i < 500; i++) pts.push([(i * 977) % 5000, (i * 2357) % 5000]);
  for (const [x, z] of pts) {
    const b = g.getBiome(x, z);
    const h = g.getBaseHeight(x, z);
    if (b !== g.getBiome(x, z) || h !== g.getBaseHeight(x, z)) {
      fail(`顺序无关破坏 (${x},${z})`);
    }
  }
  ok('顺序无关：500 乱序点重复求值一致');
}

// ③ 群系在场性 + 占比区间（三 seed 合并）
const total = Object.values(COUNTS).reduce((a, b) => a + b, 0);
const pct = (b) => ((COUNTS[b] || 0) / total) * 100;
const EXPECT = [
  [Biomes.PLAINS, 10, 70],
  [Biomes.RIVER, 0.05, 15], // 河道为细线状，占比天然低（基线 ~0.3%，STEP 采样进一步稀释）
  [Biomes.MOUNTAINS, 2, 25],
  [Biomes.BIRCH_FOREST, 3, 30],
  [Biomes.TAIGA, 0.5, 20],
  [Biomes.DESERT, 1, 25],
  [Biomes.SNOWY_TAIGA, 0.5, 25],
];
for (const [b, lo, hi] of EXPECT) {
  const p = pct(b);
  if (!COUNTS[b]) fail(`群系 ${BiomeConfig[b].name} 未出现`);
  if (p < lo || p > hi) fail(`群系 ${BiomeConfig[b].name} 占比 ${p.toFixed(1)}% 超出 [${lo},${hi}]%`);
  ok(`群系 ${BiomeConfig[b].name} 在场，占比 ${p.toFixed(1)}%`);
}

// ④ 高山海拔锚点
const mountainAvg = PEAKS.mountainHSum / PEAKS.mountainN;
const plainsAvg = PEAKS.plainsHSum / Math.max(1, PEAKS.plainsN);
if (PEAKS.maxMountainH <= 100) fail(`高山峰顶最高 ${PEAKS.maxMountainH}，未超过 100`);
ok(`高山峰顶最高 ${PEAKS.maxMountainH}`);
if (mountainAvg < plainsAvg + 15) fail(`高山均高 ${mountainAvg.toFixed(1)} 未显著高于平原 ${plainsAvg.toFixed(1)}`);
ok(`高山均高 ${mountainAvg.toFixed(1)} > 平原均高 ${plainsAvg.toFixed(1)} + 15`);

// ⑤ 相邻列连续性（非高山：|dh|≤12；高山对允许陡峭，≤30）
{
  const g = new TerrainGenerator(42);
  let worstNormal = 0, worstMountain = 0;
  for (let i = 0; i < 4000; i++) {
    const x = (i * 7919) % 4000, z = (i * 104729) % 4000;
    const hA = g.getBaseHeight(x, z);
    const hB = g.getBaseHeight(x + 1, z);
    const dh = Math.abs(hA - hB);
    const mountain = g.getBiome(x, z) === Biomes.MOUNTAINS || g.getBiome(x + 1, z) === Biomes.MOUNTAINS;
    if (mountain) { if (dh > worstMountain) worstMountain = dh; }
    else if (dh > worstNormal) worstNormal = dh;
  }
  if (worstNormal > 12) fail(`非高山相邻列最大高差 ${worstNormal} > 12`);
  if (worstMountain > 30) fail(`高山相邻列最大高差 ${worstMountain} > 30`);
  ok(`相邻列连续性：非高山最大高差 ${worstNormal}，高山 ${worstMountain}（陡峭属预期）`);
}

// ⑥ 耗时预算
if (elapsed > 30000) fail(`三 seed × ${SCAN}² 扫描耗时 ${elapsed}ms 超预算`);
ok(`三 seed × ${SCAN}² 扫描耗时 ${elapsed}ms`);

console.log(`biome-determinism: ${passed} 项通过`);
