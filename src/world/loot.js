// loot.js -- 确定性战利品与村民交易表（T5）
// 纯函数：内容只由 (seed, 表名, 坐标) / (seed, tradeSeed) 决定——与结构布局同一不变量，
// 任意端/任意时刻生成结果逐字节一致（联机两端箱子内容一致、村民交易一致）。
// 结构 solve 只负责放 chest 方块并在 meta.chests 记录表名；内容在首次打开时惰性生成。
import { hash32, makeRng } from './structures/StructureManager.js';

// 加权条目 [物品名, 最小数量, 最大数量, 权重]
const TABLES = {
  // 村庄民居：食物/种子/日用为主
  village_house: [
    ['bread', 1, 3, 18], ['apple', 1, 3, 14], ['wheat', 2, 6, 14],
    ['wheat_seeds', 2, 6, 12], ['carrot', 2, 5, 10], ['potato', 2, 5, 10],
    ['coal', 2, 5, 12], ['torch', 4, 10, 10], ['iron_ingot', 1, 2, 5],
    ['emerald', 1, 2, 4],
  ],
  // 村庄大厅（big）：更丰富，含稀有品
  village_big: [
    ['bread', 2, 5, 16], ['apple', 2, 4, 12], ['cooked_beef', 2, 4, 12],
    ['iron_ingot', 1, 4, 10], ['coal', 3, 8, 10], ['emerald', 1, 3, 8],
    ['compass', 1, 1, 4], ['saddle', 1, 1, 3], ['golden_apple', 1, 1, 2],
    ['bucket', 1, 1, 4], ['oak_sapling', 2, 4, 6],
    ['ender_pearl', 1, 1, 2], ['blaze_powder', 1, 2, 2],
  ],
  // 要塞枢纽：基础补给
  stronghold_hub: [
    ['bread', 1, 4, 14], ['coal', 3, 8, 14], ['iron_ingot', 1, 3, 10],
    ['torch', 6, 12, 12], ['arrow', 4, 10, 8], ['emerald', 1, 2, 6],
    ['stick', 4, 10, 8], ['ender_pearl', 1, 1, 3], ['blaze_rod', 1, 1, 3],
  ],
  // 要塞图书馆：书类与经验
  stronghold_library: [
    ['book', 1, 3, 20], ['enchanted_book', 1, 1, 4], ['compass', 1, 1, 6], ['book', 1, 2, 12], ['experience_bottle', 1, 3, 8],
    ['emerald', 1, 3, 8], ['apple', 1, 3, 8], ['map', 1, 1, 3],
    ['ender_pearl', 1, 2, 5], ['blaze_rod', 1, 1, 4],
  ],
  // 要塞储藏室：矿物/弹药
  stronghold_storage: [
    ['iron_ingot', 1, 5, 16], ['gold_ingot', 1, 3, 10], ['coal', 3, 10, 14],
    ['bread', 1, 3, 10], ['arrow', 6, 14, 12], ['string', 1, 4, 8],
    ['emerald', 1, 3, 8], ['bucket', 1, 1, 4], ['redstone', 2, 6, 8],
    ['golden_apple', 1, 1, 2], ['ender_pearl', 1, 2, 5], ['blaze_rod', 1, 2, 4],
  ],
  // 下界要塞：金饰/烈焰系/稀有矿物（箱子在主堡×2、桥头堡、南桥尽头脑）
  fortress: [
    ['gold_nugget', 2, 6, 14], ['gold_ingot', 1, 3, 10], ['iron_ingot', 1, 3, 8],
    ['coal', 3, 8, 12], ['bone', 1, 4, 10], ['obsidian', 2, 4, 8],
    ['flint', 1, 2, 6], ['blaze_rod', 1, 2, 4], ['golden_apple', 1, 1, 2],
    ['diamond', 1, 1, 2], ['saddle', 1, 1, 2],
  ],
};

// 生成箱子内容：27 槽数组（索引 0-26），空槽为 null
export function chestLoot(seed, tableName, x, y, z) {
  const slots = new Array(27).fill(null);
  const table = TABLES[tableName];
  if (!table) return slots;
  const live = table.filter(e => e[3] > 0);
  if (!live.length) return slots;
  const rng = makeRng(hash32(seed | 0, x * 31 + y, z * 17 + y, 4242));
  const totalW = live.reduce((s, e) => s + e[3], 0);
  const groups = 4 + Math.floor(rng() * 4); // 4-7 组
  const used = new Set();
  for (let k = 0; k < groups; k++) {
    let roll = rng() * totalW;
    let pick = live[live.length - 1];
    for (const e of live) { roll -= e[3]; if (roll <= 0) { pick = e; break; } }
    const n = pick[1] + Math.floor(rng() * (pick[2] - pick[1] + 1));
    // 槽位重摇 24 次必终止（确定性：重摇也走同一 rng 流）
    let slot = -1;
    for (let t = 0; t < 24; t++) {
      const cand = Math.floor(rng() * 27);
      if (!used.has(cand)) { slot = cand; break; }
    }
    if (slot < 0) continue;
    used.add(slot);
    slots[slot] = { name: pick[0], count: n, data: null };
  }
  return slots;
}

// ── 村民交易 ─────────────────────────────────────────────────────────────
// 每个村民固定 3 收购（玩家给物品换绿宝石）+ 3 出售（绿宝石换物品）。
// tradeSeed 由 (村庄锚点, 生成序号) 派生，随 mob_spawn 广播（客户端无需反查村庄）。

// 交易种子派生：单机与 host 广播共用同一函数（联机一致性关键——勿在调用处各自造哈希）
export function villagerTradeSeed(ax, az, index) {
  return hash32(ax | 0, az | 0, index | 0, 555) >>> 0;
}

const BUY_POOL = [   // [给村民的物品, min, max]
  ['wheat', 16, 24], ['coal', 12, 20], ['carrot', 14, 22],
  ['potato', 14, 22], ['beef', 6, 10], ['white_wool', 10, 16],
  ['apple', 8, 14],
];
const SELL_POOL = [  // [村民给的物品, emerald 价, min, max]
  ['bread', 1, 4, 6], ['arrow', 1, 8, 16], ['torch', 2, 16, 24],
  ['iron_ingot', 3, 2, 4], ['apple', 1, 3, 5], ['compass', 4, 1, 1],
  ['golden_apple', 5, 1, 1], ['cooked_beef', 2, 4, 8], ['experience_bottle', 2, 2, 4],
];

function pickUnique(rng, pool, used, count) {
  const out = [];
  for (let t = 0; t < 40 && out.length < count; t++) {
    const e = pool[Math.floor(rng() * pool.length)];
    if (used.has(e[0])) continue;
    used.add(e[0]);
    out.push(e);
  }
  return out;
}

export function villagerTrades(seed, tradeSeed) {
  const rng = makeRng(hash32(seed | 0, tradeSeed | 0, (tradeSeed | 0) ^ 0x9e37, 4747));
  const buys = pickUnique(rng, BUY_POOL, new Set(), 3).map(([name, lo, hi]) => {
    const n = lo + Math.floor(rng() * (hi - lo + 1));
    return { give: { name, count: n }, get: { name: 'emerald', count: 1 } };
  });
  const sells = pickUnique(rng, SELL_POOL, new Set(), 3).map(([name, price, lo, hi]) => {
    const n = lo + Math.floor(rng() * (hi - lo + 1));
    return { give: { name: 'emerald', count: price }, get: { name, count: n } };
  });
  return [...buys, ...sells];
}
