// Portals 逻辑单测（node 直跑，无需服务器）：假 World 内存方块表验证框校验/填充/拆门/建门/搜门
import { BlockRegistry } from '../src/core/BlockRegistry.js';
import '../src/blocks/BlockDefs.js';
import {
  detectPortalInterior, fillPortal, findPortalNear, buildReturnPortal, removeConnectedPortals,
} from '../src/core/Portals.js';

function fakeWorld() {
  const blocks = new Map();
  const ledger = new Map();
  const k = (x, y, z) => `${x},${y},${z}`;
  return {
    blocks, modifiedBlocks: ledger,
    getBlock(x, y, z) { return blocks.get(k(x, y, z)) || 0; },
    setBlock(x, y, z, id) {
      blocks.set(k(x, y, z), id);
      if (id === 0) blocks.delete(k(x, y, z));
      ledger.set(k(x, y, z), id);
    },
    findGroundY(x, z, top = 254) {
      for (let y = Math.min(top, 254); y >= 1; y--) {
        const def = BlockRegistry.getById(this.getBlock(x, y, z));
        if (def && def.solid) return y + 1;
      }
      return -1;
    },
  };
}

let fails = 0;
const assert = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) fails++; };

const OBS = BlockRegistry.getId('obsidian');
const GLOW = BlockRegistry.getId('glowstone');
const NP = BlockRegistry.getId('nether_portal');
const AP = BlockRegistry.getId('aether_portal');

// ── ① x/y 平面 4×5 框（内 2×3）──
{
  const w = fakeWorld();
  // 底/顶行
  for (let x = 0; x < 4; x++) { w.setBlock(x, 0, 0, OBS); w.setBlock(x, 4, 0, OBS); }
  // 左右柱
  for (let y = 1; y <= 3; y++) { w.setBlock(0, y, 0, OBS); w.setBlock(3, y, 0, OBS); }
  const det = detectPortalInterior(w, 1, 1, 0, OBS);
  assert('① x 平面框校验通过', !!det && det.axis === 'x' && det.cells.length === 6);
  fillPortal(w, det, NP);
  assert('① 填充后 6 内格全为 nether_portal',
    [[1, 1], [2, 1], [1, 2], [2, 2], [1, 3], [2, 3]].every(([x, y]) => w.getBlock(x, y, 0) === NP));
}

// ── ② z/y 平面框 ──
{
  const w = fakeWorld();
  for (let z = 0; z < 4; z++) { w.setBlock(0, 10, z, OBS); w.setBlock(0, 14, z, OBS); }
  for (let y = 11; y <= 13; y++) { w.setBlock(0, y, 0, OBS); w.setBlock(0, y, 3, OBS); }
  const det = detectPortalInterior(w, 0, 11, 1, OBS);
  assert('② z 平面框校验通过', !!det && det.axis === 'z' && det.cells.length === 6);
}

// ── ③ 缺口框拒绝 ──
{
  const w = fakeWorld();
  for (let x = 0; x < 4; x++) { w.setBlock(x, 0, 0, OBS); w.setBlock(x, 4, 0, OBS); }
  for (let y = 1; y <= 3; y++) { w.setBlock(0, y, 0, OBS); } // 右柱缺失
  const det = detectPortalInterior(w, 1, 1, 0, OBS);
  assert('③ 右柱缺失 → 校验拒绝', det === null);
}

// ── ④ 荧石框（天域门）──
{
  const w = fakeWorld();
  for (let x = 5; x < 9; x++) { w.setBlock(x, 0, 0, GLOW); w.setBlock(x, 4, 0, GLOW); }
  for (let y = 1; y <= 3; y++) { w.setBlock(5, y, 0, GLOW); w.setBlock(8, y, 0, GLOW); }
  const det = detectPortalInterior(w, 6, 2, 0, GLOW);
  assert('④ 荧石框校验通过（从中间行探测）', !!det && det.cells.length === 6);
  fillPortal(w, det, AP);
  assert('④ 天域门方块填充正确', w.getBlock(6, 2, 0) === AP);
}

// ── ⑤ 大框（3×4 内）也能识别 ──
{
  const w = fakeWorld();
  for (let x = 0; x < 5; x++) { w.setBlock(x, 0, 0, OBS); w.setBlock(x, 5, 0, OBS); }
  for (let y = 1; y <= 4; y++) { w.setBlock(0, y, 0, OBS); w.setBlock(4, y, 0, OBS); }
  const det = detectPortalInterior(w, 1, 1, 0, OBS);
  assert('⑤ 3×4 大内框校验通过', !!det && det.cells.length === 12);
}

// ── ⑥ 拆框洪水清门 ──
{
  const w = fakeWorld();
  for (let x = 0; x < 4; x++) { w.setBlock(x, 0, 0, OBS); w.setBlock(x, 4, 0, OBS); }
  for (let y = 1; y <= 3; y++) { w.setBlock(0, y, 0, OBS); w.setBlock(3, y, 0, OBS); }
  const det = detectPortalInterior(w, 1, 1, 0, OBS);
  fillPortal(w, det, NP);
  assert('⑥ 前置：门已填充', w.getBlock(1, 1, 0) === NP);
  removeConnectedPortals(w, 0, 1, 0); // 打掉左柱一格 → 连通门全清
  const portalLeft = [...w.blocks.values()].filter((id) => id === NP).length;
  assert('⑥ 打掉框柱 → 6 门方块全清', portalLeft === 0);
}

// ── ⑦ 自动返程门（有地面 / 无地面垫平台）──
{
  const w = fakeWorld();
  for (let x = -2; x <= 20; x++) for (let z = -2; z <= 2; z++) w.setBlock(x, 30, z, OBS); // 地板 y30
  const pos = buildReturnPortal(w, 'nether', 10, 0, {});
  assert('⑦ 有地面：门底落在地板上', pos.y === 32 && w.getBlock(10, 31, 0) === OBS && w.getBlock(11, 32, 0) === NP);
  const w2 = fakeWorld(); // 全虚空
  const pos2 = buildReturnPortal(w2, 'aether', 0, 0, { platform: { y: 90, block: 'glowstone' } });
  assert('⑦ 无地面：垫 y90 荧石平台 + 门', pos2.y === 91 && w2.getBlock(-1, 89, 0) === GLOW && w2.getBlock(1, 91, 0) === AP);
}

// ── ⑧ 搜门：账本半径最近 ──
{
  const w = fakeWorld();
  w.setBlock(100, 40, 0, NP);
  w.setBlock(105, 40, 0, NP);
  const near = findPortalNear(w, 101, 0, NP, 24);
  assert('⑧ 半径内最近门命中 (100,40)', !!near && near.x === 100.5 && near.y === 40);
  assert('⑧ 半径外门不命中', findPortalNear(w, 200, 0, NP, 24) === null);
}

console.log(fails ? `FAILED: ${fails}` : 'Portals 逻辑单测全部通过');
process.exit(fails ? 1 : 0);
