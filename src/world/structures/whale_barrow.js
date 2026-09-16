// whale_barrow.js -- 鲸骨冢：天域岛缘的天海巨鲸搁浅遗骸（鲸骨冢篇 K1，worldview.md §10.5）
// 结构：骨粉地 patch + 脊柱线（沿 x 轴 22 列，胸椎双高）+ 肋骨对 ×5（拱高 13→7 递减、
//      顶端内折成弧）+ 头骨拱门（眼窝嵌星髓微光）+ 尾椎渐矮 + 星髓碎屑散点（天海坠物）
//      + 云绒丛 + 归云章碑位（风纹石碑）+ 考古箱 + 风柱 ×2（"风从肋骨间穿过"，
//      纯复用 wind_current 既有机制，零新机制）。
// 叙事：三界海难证据链的最后一块拼图——主世界潮冢沉于海底、下界接住坠落的海，
//      天域这头巨鲸搁浅在天空。留白纪律：不写它在等什么（与守望章同源），龙零出场。
// 不变量：solve 纯函数（布局只由 (seed, cell 锚点) 决定）；选址复用 probeIsland
//      （aetherStructures 导出，单一实现）；dims: ['aether'] 仅天域参与；
//      密度预案：cell 48 / attempts 2 / chance 0.35 / salt 7291（神殿同档稀有，实测调参）。
import { blockId } from './StructureManager.js';
import { probeIsland } from './aetherStructures.js';
import { steleStack } from '../steles.js';

// 选址：四群系大岛皆可，中心 ±5 平坦（maxSlope 8）——肋骨拱悬挑出岛缘 = "搁浅在岸线"
function placeWhale(gen, ax, az) {
  return probeIsland(gen, ax, az, ['verdant', 'autumn', 'frost', 'crystal'], 8, 5);
}

export function solveWhale(rng, ax, y0, az) {
  const WB = blockId('whale_bone_block');
  const SM = blockId('star_marrow_block');
  const CW = blockId('cloud_wool');
  const CH = blockId('chest');
  const WC = blockId('wind_current');
  const blocks = [];
  const meta = { kind: 'whale_barrow', chests: [], steles: [], center: [ax, y0, az] };

  // ① 骨粉地：不规则圆盘 r7（边缘参差掷签）——半埋感
  for (let dx = -7; dx <= 7; dx++) {
    for (let dz = -7; dz <= 7; dz++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > 49) continue;
      if (d2 > 30 && rng() < 0.45) continue;
      blocks.push([ax + dx, y0 - 1, az + dz, WB]);
    }
  }

  // ② 脊柱：沿 x 轴 22 列（胸椎段 ±4 双高）+ 尾椎两列渐矮收尾
  for (let dx = -11; dx <= 11; dx++) {
    blocks.push([ax + dx, y0, az, WB]);
    if (Math.abs(dx) <= 4) blocks.push([ax + dx, y0 + 1, az, WB]);
  }
  blocks.push([ax - 13, y0, az, WB]);
  blocks.push([ax - 14, y0, az, WB]);

  // ③ 肋骨对 ×5：z 对称（offset 3/6/8/11/13），拱高 13→7 递减，顶端向脊柱内折成弧
  const OFFSETS = [3, 6, 8, 11, 13];
  OFFSETS.forEach((off, idx) => {
    const hTop = Math.round(13 - idx * 1.5);
    const fold = off >= 6 ? 2 : 1; // 近脊柱的短肋只折一格，避免撞脊柱
    for (const side of [1, -1]) {
      const pz = az + side * off;
      for (let y = y0; y < y0 + hTop; y++) blocks.push([ax, y, pz, WB]);
      for (let k = 1; k <= fold; k++) {
        blocks.push([ax, y0 + hTop - 1 + k, az + side * (off - k * 2), WB]);
      }
      blocks.push([ax, y0 + hTop + fold, az + side * Math.max(1, off - fold * 2), WB]); // 顶冠
    }
  });

  // ④ 头骨拱门（x = ax+13，入口朝岛心）：颊柱 ×2 + 顶横 + 顶冠 + 眼窝星髓微光
  const hx = ax + 13;
  for (const dz of [-2, 2]) {
    for (let y = y0; y <= y0 + 3; y++) blocks.push([hx, y, az + dz, WB]);
    blocks.push([hx, y0 - 1, az + dz, WB]); // 半埋颊基
  }
  for (let dz = -2; dz <= 2; dz++) blocks.push([hx, y0 + 4, az + dz, WB]);
  blocks.push([hx, y0 + 5, az, WB]);
  blocks.push([hx, y0 + 2, az - 1, SM]);
  blocks.push([hx, y0 + 2, az + 1, SM]);

  // ⑤ 星髓碎屑 4 处（骨粉地掷签散点，天海坠物——后写覆盖 patch 同格）
  for (let i = 0; i < 4; i++) {
    const dx = Math.floor(rng() * 11) - 5;
    const dz = Math.floor(rng() * 11) - 5;
    blocks.push([ax + dx, y0 - 1, az + dz, SM]);
  }

  // ⑥ 云绒丛 3 处（骨缝间，"牧云的孩子在肋骨下躲雨"）
  for (let i = 0; i < 3; i++) {
    const dx = Math.floor(rng() * 13) - 6;
    const dz = Math.floor(rng() * 13) - 6;
    blocks.push([ax + dx, y0, az + dz, CW]);
  }

  // ⑦ 风柱 ×2：头骨拱门内一柱（后写压过顶横中格 = 门心通风口，风从肋骨间穿出）
  //    + 尾端一柱——纯复用 wind_current 既有上升气流机制
  for (let h = 1; h <= 8; h++) blocks.push([hx, y0 + h, az, WC]);
  for (let h = 1; h <= 6; h++) blocks.push([ax - 13, y0 + h, az, WC]);

  // ⑧ 归云章碑位（第一对肋骨内侧；Build 20 ① 四格形制：底座星髓压骨粉地）+ 考古箱（对称位）
  for (const [bx, by, bz, bid] of steleStack(ax, y0, az + 2, 'aether')) blocks.push([bx, by, bz, bid]);
  meta.steles.push([ax, y0, az + 2, 'aether_whale']);
  blocks.push([ax, y0, az - 2, CH]);
  meta.chests.push([ax, y0, az - 2, 'whale_barrow']);

  return { blocks, meta };
}

export const WHALE_BARROW_DEF = {
  cell: 48,          // 48 区块网格（768 格）——神殿同档稀有（实测调参）
  attempts: 2,
  chance: 0.35,
  radius: 20,        // 跨度 x ±14 / z ±13（对角 ~19.1）
  salt: 7291,        // 与既有 salt 全部错开
  dims: ['aether'],  // 仅天域维度参与
  place: placeWhale,
  solve: solveWhale,
};
