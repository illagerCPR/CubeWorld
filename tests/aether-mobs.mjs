// aether-mobs.mjs -- 天域生物回归（纯 node）：类型注册/模型一致/生成表分布/悬浮与被动标记
import { MobTypes, generateMobSkinSVGs } from '../src/entity/MobTextures.js';
import { Mob } from '../src/entity/Mob.js';
import { pickAetherSpawn } from '../src/entity/MobManager.js';
import { World } from '../src/core/World.js';

let pass = 0;
function ok(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  pass++;
  console.log('PASS ' + msg);
}

// ① 类型注册与模型一致性
for (const name of ['wisp', 'aether_guard']) {
  const t = MobTypes[name];
  ok(!!t, `MobTypes.${name} 已注册`);
  ok(!!t.displayName && !!t.model && t.model.parts.length >= 4, `MobTypes.${name} 有中文名与模型部件`);
  ok(t.drops && t.drops.every(d => d.name && d.max >= d.min), `MobTypes.${name} 掉落表合法`);
  for (const p of t.model.parts) {
    const [x0, y0, z0, x1, y1, z1] = p.box;
    ok(x0 < x1 && y0 < y1 && z0 < z1, `MobTypes.${name} 部件 ${p.name} 盒尺寸合法`);
    ok(y1 <= t.height + 0.06, `MobTypes.${name} 部件 ${p.name} 顶点 ${y1} 与实体高度 ${t.height} 一致`);
  }
  const skins = generateMobSkinSVGs();
  ok(typeof skins[name] === 'string' && skins[name].includes('<svg'), `${name} 皮肤 SVG 已生成`);
}
ok(MobTypes.wisp.flying === true && MobTypes.wisp.passive === true && MobTypes.wisp.damage === 0,
  '风灵 flying+passive+无伤');
ok(MobTypes.aether_guard.flying === true && !MobTypes.aether_guard.passive && MobTypes.aether_guard.damage >= 3,
  '天域守卫 flying+敌对+有伤');
ok(MobTypes.wisp.burningInDay === false && MobTypes.aether_guard.burningInDay === false,
  '天域两生物永昼不燃烧（burningInDay=false）');
ok(MobTypes.villager.passive === true, '村民 passive 标记仍在（威胁过滤通用化不回归）');

// ② Mob 实体标记传递（含生成所需 world 维度）
{
  const world = new World(42, 'aether');
  const wisp = new Mob('wisp', world);
  ok(wisp.flying === true && wisp.type.passive === true && wisp.hoverBaseY === null,
    'Mob(wisp) 悬浮被动标记就位（hoverBaseY 待首帧锚定）');
  const guard = new Mob('aether_guard', world);
  ok(guard.flying === true && guard.attackDamage === 4 && !guard.passive,
    'Mob(aether_guard) 悬浮 4 伤敌对');
}

// ③ 生成表分布（确定性伪随机流统计，阈值宽松防抖）
{
  let seed = 98765;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const tally = (biome, nearTemple, n = 3000) => {
    const c = {};
    for (let i = 0; i < n; i++) {
      const t = pickAetherSpawn(biome, nearTemple, rand);
      c[t] = (c[t] || 0) + 1;
    }
    return c;
  };
  const plain = tally('verdant', false);
  ok(plain.wisp / 3000 > 0.85 && plain.aether_guard / 3000 < 0.12,
    `草原风灵主导、守卫 ~6%（实测守卫 ${(plain.aether_guard / 3000 * 100).toFixed(1)}%）`);
  const crystal = tally('crystal', false);
  ok(crystal.aether_guard / 3000 > 0.30 && crystal.aether_guard / 3000 < 0.50,
    `水晶秘境守卫 ~40%（实测 ${(crystal.aether_guard / 3000 * 100).toFixed(1)}%）`);
  const temple = tally('crystal', true);
  ok(temple.aether_guard / 3000 > 0.45 && temple.aether_guard / 3000 < 0.65,
    `神殿周边守卫主导 ~55%（实测 ${(temple.aether_guard / 3000 * 100).toFixed(1)}%）`);
  const frost = tally('frost', false);
  ok(frost.aether_guard / 3000 > 0.05 && frost.aether_guard / 3000 < 0.20,
    `银霜守卫少量 ~12%（实测 ${(frost.aether_guard / 3000 * 100).toFixed(1)}%）`);
}

// ④ 表覆盖完备性：全部天域群系返回已注册类型
{
  let seed = 24680;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const biome of ['verdant', 'crystal', 'frost', 'autumn', null]) {
    for (let i = 0; i < 50; i++) {
      const t = pickAetherSpawn(biome, false, rand);
      ok(!!MobTypes[t], `群系 ${biome} 生成类型 ${t} 已注册`);
    }
  }
}

console.log(`天域生物回归: 全部通过（${pass} 断言）`);
