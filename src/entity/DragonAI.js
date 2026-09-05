// DragonAI.js -- 末影龙 Boss 状态机（circle 盘旋 / dive 俯冲 / perch 栖息回血）
// host/单机权威模拟（与普通怪同款事件同步）；AI 随机性不影响方块账本一致性。
// 柱环与水晶存活全部经 world 实时查询（水晶被打碎 → getBlock 立刻反映）。
import * as THREE from 'three';
import { BlockRegistry } from '../core/BlockRegistry.js';

const CIRCLE_R = 30;        // 盘旋半径（围绕主岛中心）
const CIRCLE_Y = 88;        // 盘旋高度
const ANGULAR = 0.35;       // 盘旋角速度 rad/s
const LEAD = 0.4;           // 引导点前偏（弧度）——朝"前方一点"飞出切向轨迹
const DIVE_INTERVAL = 8;    // 盘旋→俯冲周期基准（±3s 抖动）
const DIVE_SPEED_MUL = 1.7; // 俯冲速度倍率
const DIVE_TIMEOUT = 4.5;   // 俯冲最长持续时间
const PERCH_HEAL = 4;       // 栖息回血 /秒
const PERCH_MAX_TIME = 7;   // 单次栖息最长时长
const PERCH_EXIT_HP = 0.85; // 血量回复到此比例即离开

// 柱环布局缓存（EndGenerator._pillars 纯函数，per-mob 缓存一次）
function pillarsOf(mob) {
  if (!mob._dragonPillars) {
    const gen = mob.world && mob.world.generator;
    mob._dragonPillars = gen && typeof gen._pillars === 'function' ? gen._pillars() : [];
  }
  return mob._dragonPillars;
}

// 该柱顶的末影水晶是否存活（水晶 = 基岩底座上 1 格）
function crystalAlive(mob, p) {
  const id = mob.world.getBlock(p.x, p.top + 2, p.z);
  return id === BlockRegistry.getId('end_crystal');
}

// 最近一根有存活水晶的柱；无则返回 null
function nearestCrystalPillar(mob) {
  let best = null, bestD = Infinity;
  for (const p of pillarsOf(mob)) {
    if (!crystalAlive(mob, p)) continue;
    const dx = p.x - mob.position.x, dz = p.z - mob.position.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// 状态机入口：直接改写 mob.velocity / yaw / dragonState
export function updateDragonAI(mob, dt, player, mobManager) {
  if (mob.dragonState == null) {
    mob.dragonState = 'circle';
    mob.dragonTimer = DIVE_INTERVAL;
    mob.dragonPhase = Math.atan2(mob.position.z, mob.position.x);
    mob.dragonDiveTarget = null;
    mob.dragonPerchPillar = null;
  }
  mob.dragonTimer -= dt;

  // 俯冲接触判定与攻击（dive 与 circle 通用：距离内就咬）
  const distToPlayer = mob.position.distanceTo(player.position);

  if (mob.dragonState === 'dive') {
    const target = mob.dragonDiveTarget;
    const dx = target.x - mob.position.x;
    const dy = target.y + 1 - mob.position.y;
    const dz = target.z - mob.position.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.001;
    const sp = mob.speed * DIVE_SPEED_MUL;
    mob.velocity.x = (dx / d) * sp;
    mob.velocity.y = (dy / d) * sp;
    mob.velocity.z = (dz / d) * sp;
    mob.yaw = Math.atan2(dx / d, dz / d);
    if (distToPlayer < mob.attackRange && mob.attackCooldown <= 0) {
      mob.attack(player);
      mob.attackCooldown = 1.0;
    }
    // 到达目标点附近或超时 → 回盘旋（相位对齐当前角度，避免回绕突进）
    if (d < 3 || mob.dragonTimer <= 0) {
      mob.dragonState = 'circle';
      mob.dragonPhase = Math.atan2(mob.position.z, mob.position.x);
      mob.dragonTimer = DIVE_INTERVAL + (Math.random() - 0.5) * 6;
      mob.dragonDiveTarget = null;
    }
    return;
  }

  if (mob.dragonState === 'perch') {
    const p = mob.dragonPerchPillar;
    const crystalGone = !p || !crystalAlive(mob, p);
    const healed = mob.health >= mob.maxHealth * PERCH_EXIT_HP;
    if (crystalGone || healed || mob.dragonTimer <= 0) {
      mob.dragonState = 'circle';
      mob.dragonPhase = Math.atan2(mob.position.z, mob.position.x);
      mob.dragonTimer = DIVE_INTERVAL * 0.5;
      mob.dragonPerchPillar = null;
      return;
    }
    // 悬停在水晶上方缓慢回血
    const tx = p.x + 0.5, tz = p.z + 0.5, ty = p.top + 6;
    const dx = tx - mob.position.x, dy = ty - mob.position.y, dz = tz - mob.position.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 1.5) {
      const k = Math.min(1, 4 / d);
      mob.velocity.set(dx * k, dy * k, dz * k);
    } else {
      mob.velocity.set(0, Math.sin(performance.now() * 0.002) * 0.5, 0);
      mob.health = Math.min(mob.maxHealth, mob.health + PERCH_HEAL * dt);
    }
    mob.yaw = Math.atan2(player.position.x - mob.position.x, player.position.z - mob.position.z);
    return;
  }

  // ── circle 盘旋 ────────────────────────────────────────────────
  // 低血且有存活水晶 → 栖息回血
  if (mob.health < mob.maxHealth * 0.4) {
    const p = nearestCrystalPillar(mob);
    if (p) {
      mob.dragonState = 'perch';
      mob.dragonPerchPillar = p;
      mob.dragonTimer = PERCH_MAX_TIME;
      return;
    }
  }
  // 周期到 → 向玩家俯冲（仅玩家在主岛附近时，防拉扯到外岛）
  if (mob.dragonTimer <= 0 && distToPlayer < 80) {
    mob.dragonState = 'dive';
    mob.dragonDiveTarget = player.position.clone().add(
      new THREE.Vector3(player.velocity.x * 0.5, 0, player.velocity.z * 0.5)
    );
    mob.dragonTimer = DIVE_TIMEOUT;
    return;
  }

  // 引导点 = 环上相位前方一点；朝引导点飞行 → 近似切向绕圈
  mob.dragonPhase += dt * ANGULAR;
  const gx = Math.cos(mob.dragonPhase + LEAD) * CIRCLE_R;
  const gz = Math.sin(mob.dragonPhase + LEAD) * CIRCLE_R;
  const dx = gx - mob.position.x, dz = gz - mob.position.z;
  const dh = Math.sqrt(dx * dx + dz * dz) || 0.001;
  const k = Math.min(1, mob.speed / dh);
  mob.velocity.x = dx * k;
  mob.velocity.z = dz * k;
  mob.velocity.y = Math.max(-6, Math.min(6, (CIRCLE_Y - mob.position.y) * 1.2));
  // +Z 朝脸：切向朝向（前进方向）
  mob.yaw = Math.atan2(dx / dh, dz / dh);

  // 盘旋中贴脸也咬
  if (distToPlayer < mob.attackRange && mob.attackCooldown <= 0) {
    mob.attack(player);
    mob.attackCooldown = 1.0;
  }
}
