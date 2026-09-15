// StormColossusAI.js -- 守誓巨像 Boss 状态机（天域批次 C）
// 三阶段（只进不退）：guard 岩卫（贴地横扫 + 跳跃震地）→ storm 风暴（升空悬浮 + 风弹齐射 + 俯冲）
// → rupture 裂心（风拽光环 + 加密齐射）。host/单机权威模拟（与 WitherAI 同款事件同步）；
// 风弹经 mobManager.onColossusShoot 回调生成（复用 wither_skull 协议通道 k:'gale'，
// 各端本地结算本地玩家）；震地经 mobManager.onColossusSlam 回调广播（各端本地结算自己）。
// AI 接管全部速度/朝向（type.flying 不加重力）。

const RISE_TIME = 2.2;          // 苏醒起身时长（从祭坛前地面立起）
const P2_HP = 0.66;             // → 风暴阶段血线
const P3_HP = 0.33;             // → 裂心阶段血线
const SLAM_INTERVAL = 7.0;      // 岩卫震地周期（秒）
const SLAM_LEAP_T = 0.55;       // 跃起段时长
const SLAM_CRASH_T = 0.32;      // 坠砸段时长
const SLAM_RANGE = 10;          // 震地触发距离
const VOLLEY_INTERVAL = 2.6;    // 风暴齐射周期
const VOLLEY_INTERVAL_RUPTURE = 1.7; // 裂心齐射周期
const VOLLEY_RANGE = 32;
const DIVE_INTERVAL = 9.0;      // 风暴俯冲周期
const DIVE_T = 0.6;             // 俯冲时长
const HOVER_R = 9;              // 风暴环绕半径
const HOVER_H = 5;              // 环绕高度（相对玩家）
const HOVER_R_RUPTURE = 7;      // 裂心环绕半径（更贴脸）

// 状态机入口：直接改写 mob.velocity / yaw / colossusState（同 WitherAI 套路）
export function updateColossusAI(mob, dt, player, mobManager) {
  if (mob.colossusState == null) {
    mob.colossusState = 'rise';
    mob.colossusTimer = RISE_TIME;
    mob.colossusRiseFrom = mob.position.y;
    mob.colossusPhase = Math.atan2(mob.position.x - player.position.x, mob.position.z - player.position.z);
    mob.colossusShootTimer = 1.6;
    mob.colossusSlamTimer = SLAM_INTERVAL;
    mob.colossusDiveTimer = DIVE_INTERVAL;
    mob.colossusDiveT = 0;
    mob.colossusSecondVolley = 0;
  }

  const frac = mob.health / mob.maxHealth;
  // 阶段推进（只进不退）
  if (mob.colossusState === 'guard' && frac <= P2_HP) {
    mob.colossusState = 'storm';
    mob.colossusShootTimer = Math.min(mob.colossusShootTimer, 1.2);
  } else if (mob.colossusState === 'storm' && frac <= P3_HP) {
    mob.colossusState = 'rupture';
    mob.colossusShootTimer = Math.min(mob.colossusShootTimer, 0.8);
  }

  const dx = player.position.x - mob.position.x;
  const dz = player.position.z - mob.position.z;
  const distH = Math.sqrt(dx * dx + dz * dz) || 0.001;
  const distToPlayer = mob.position.distanceTo(player.position);
  mob.yaw = Math.atan2(dx / distH, dz / distH);

  // ── rise 苏醒起身：从祭坛前地面缓缓立起（只升不攻，Boss 战开场演出）──
  if (mob.colossusState === 'rise') {
    mob.colossusTimer -= dt;
    mob.velocity.set(0, 1.4, 0);
    if (mob.colossusTimer <= 0 || mob.position.y >= mob.colossusRiseFrom + 0.6) {
      mob.colossusState = 'guard';
    }
    return;
  }

  // ── guard 岩卫（阶段Ⅰ）：贴地行进 + 近战横扫 + 周期跳跃震地 ──
  if (mob.colossusState === 'guard') {
    // 震地流程进行中（跃起→坠砸→冲击）
    if (mob.colossusSlamT != null) {
      mob.colossusSlamT -= dt;
      if (mob.colossusSlamT > SLAM_CRASH_T) {
        // 跃起段：抛物线前扑
        // velocity 已在起跳帧设定；空中保持
      } else if (!mob.colossusCrashed) {
        // 坠砸段：垂直砸下
        mob.colossusCrashed = true;
        mob.velocity.set(0, -18, 0);
      } else if (mob.position.y <= mob.colossusSlamGroundY) {
        // 触底冲击
        mob.position.y = mob.colossusSlamGroundY;
        mob.velocity.set(0, 0, 0);
        mob.colossusSlamT = null;
        mob.colossusSlamTimer = SLAM_INTERVAL;
        if (mobManager && mobManager.onColossusSlam) mobManager.onColossusSlam(mob);
      }
      return;
    }
    // 贴地行进 + 横扫
    if (distToPlayer > mob.attackRange * 0.8) {
      const sp = mob.speed;
      mob.velocity.set(dx / distH * sp, 0, dz / distH * sp);
    } else {
      mob.velocity.set(0, 0, 0);
    }
    if (distToPlayer < mob.attackRange && mob.attackCooldown <= 0) {
      mob.attack(player);
      mob.attackCooldown = 1.4;
    }
    // 周期震地：玩家进入范围 → 跃起前扑
    mob.colossusSlamTimer -= dt;
    if (mob.colossusSlamTimer <= 0 && distToPlayer < SLAM_RANGE && !player.dead) {
      mob.colossusSlamT = SLAM_LEAP_T + SLAM_CRASH_T;
      mob.colossusCrashed = false;
      mob.colossusSlamGroundY = mob.position.y;
      const k = Math.min(1, 7 / distH);
      mob.velocity.set(dx / distH * 7 * k, SLAM_LEAP_T * 16, dz / distH * 7 * k);
    }
    return;
  }

  // ── storm / rupture：升空环绕 + 风弹齐射（裂心更近更快 + 落地阶段Ⅲ风拽由各端光环结算）──
  const rupture = mob.colossusState === 'rupture';
  // 俯冲（仅风暴阶段）
  if (mob.colossusDiveT > 0) {
    mob.colossusDiveT -= dt;
    // 俯冲速度保持（起跳帧已设定）；贴脸咬合
    if (distToPlayer < mob.attackRange && mob.attackCooldown <= 0) {
      mob.attack(player);
      mob.attackCooldown = 1.2;
    }
    if (mob.colossusDiveT <= 0) mob.colossusDiveT = 0;
    return;
  }
  mob.colossusPhase += dt * (rupture ? 1.0 : 0.6);
  const lead = mob.colossusPhase + 0.9;
  const R = rupture ? HOVER_R_RUPTURE : HOVER_R;
  const gx = player.position.x + Math.sin(lead) * R;
  const gz = player.position.z + Math.cos(lead) * R;
  const gy = player.position.y + HOVER_H + Math.sin(Date.now() * 0.0016) * 1.0;
  const vx = gx - mob.position.x, vy = gy - mob.position.y, vz = gz - mob.position.z;
  const vd = Math.sqrt(vx * vx + vy * vy + vz * vz) || 0.001;
  const sp = mob.speed * (rupture ? 1.35 : 1.0);
  const k = Math.min(1, sp / vd);
  mob.velocity.set(vx * k, vy * k, vz * k);
  mob.yaw = Math.atan2(dx / distH, dz / distH);
  // 贴脸咬合
  if (distToPlayer < mob.attackRange && mob.attackCooldown <= 0) {
    mob.attack(player);
    mob.attackCooldown = 1.3;
  }
  // 俯冲发起（仅风暴阶段）
  if (!rupture) {
    mob.colossusDiveTimer -= dt;
    if (mob.colossusDiveTimer <= 0 && distToPlayer < 24 && !player.dead) {
      mob.colossusDiveTimer = DIVE_INTERVAL;
      mob.colossusDiveT = DIVE_T;
      const dir = player.position.clone().add(new (mob.position.constructor)(0, 1, 0)).sub(mob.position).normalize();
      mob.velocity.copy(dir.multiplyScalar(14));
      return;
    }
  }
  // 周期齐射（裂心 = 双段）
  mob.colossusShootTimer -= dt;
  if (mob.colossusSecondVolley > 0) {
    mob.colossusSecondVolley -= dt;
    if (mob.colossusSecondVolley <= 0 && mobManager && mobManager.onColossusShoot) {
      mobManager.onColossusShoot(mob, player, true);
    }
  }
  if (mob.colossusShootTimer <= 0 && distToPlayer < VOLLEY_RANGE && !player.dead) {
    mob.colossusShootTimer = rupture ? VOLLEY_INTERVAL_RUPTURE : VOLLEY_INTERVAL;
    if (mobManager && mobManager.onColossusShoot) mobManager.onColossusShoot(mob, player, false);
    if (rupture) mob.colossusSecondVolley = 0.35; // 双段齐射
  }
}
