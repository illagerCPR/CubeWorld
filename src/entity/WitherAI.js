// WitherAI.js -- 凋灵 Boss 状态机（rise 召唤升空 / hover 环绕齐射 / 半血狂暴）
// host/单机权威模拟（与 DragonAI 同款事件同步）；AI 接管全部速度/朝向（flying 不加重力）。
// 齐射经 mobManager.onWitherShoot 回调由 Game 生成弹射物（本地+联机广播），AI 不直接碰渲染层。

const RISE_TIME = 4.0;          // 召唤升空蓄能时长（秒）
const RISE_TARGET = 7;          // 升空目标高度增量（相对召唤点）
const HOVER_R = 8;              // 环绕半径（相对玩家）
const HOVER_HEIGHT = 5;         // 环绕高度（相对玩家脚底）
const VOLLEY_INTERVAL = 2.8;    // 齐射周期（秒）
const VOLLEY_INTERVAL_ENRAGED = 1.6; // 狂暴齐射周期
const ENRAGE_HP = 0.5;          // 血量低于此比例进入狂暴（提速 + 射速加快 + 近战冲撞）
const VOLLEY_RANGE = 40;        // 齐射最大索敌距离

// 状态机入口：直接改写 mob.velocity / yaw / witherState
export function updateWitherAI(mob, dt, player, mobManager) {
  if (mob.witherState == null) {
    mob.witherState = 'rise';
    mob.witherTimer = RISE_TIME;
    mob.witherRiseFrom = mob.position.y;
    mob.witherPhase = Math.atan2(mob.position.x - player.position.x, mob.position.z - player.position.z);
    mob.witherShootTimer = 1.0;
  }
  mob.witherTimer -= dt;

  const dx = player.position.x - mob.position.x;
  const dz = player.position.z - mob.position.z;
  const distH = Math.sqrt(dx * dx + dz * dz) || 0.001;
  const enraged = mob.health <= mob.maxHealth * ENRAGE_HP;

  // ── rise 召唤升空：直上目标高度，只升不攻（原版蓄能期的行为简化：高飞难命中）──
  if (mob.witherState === 'rise') {
    const targetY = mob.witherRiseFrom + RISE_TARGET;
    mob.velocity.set(0, Math.min(2.2, (targetY - mob.position.y) * 1.2), 0);
    mob.yaw = Math.atan2(dx / distH, dz / distH);
    if (mob.witherTimer <= 0 || Math.abs(targetY - mob.position.y) < 0.4) {
      mob.witherState = 'hover';
    }
    return;
  }

  // ── hover 环绕悬飞：绕玩家的切向引导点（同 DragonAI circle 套路），正弦浮沉 ──
  mob.witherPhase += dt * (enraged ? 0.9 : 0.55);
  const lead = mob.witherPhase + 0.9; // 引导点前偏（弧度）→ 切向环绕
  const gx = player.position.x + Math.sin(lead) * HOVER_R;
  const gz = player.position.z + Math.cos(lead) * HOVER_R;
  const gy = player.position.y + HOVER_HEIGHT + Math.sin(performance.now() * 0.0016) * 1.2;
  const vx = gx - mob.position.x, vy = gy - mob.position.y, vz = gz - mob.position.z;
  const vd = Math.sqrt(vx * vx + vy * vy + vz * vz) || 0.001;
  const sp = mob.speed * (enraged ? 1.45 : 1.0);
  const k = Math.min(1, sp / vd);
  mob.velocity.set(vx * k, vy * k, vz * k);
  // 局部 +Z 朝脸：yaw=atan2(nx,nz) 面向玩家（同 Mob.chase 公式）
  mob.yaw = Math.atan2(dx / distH, dz / distH);

  // 贴脸近战咬合（狂暴后环绕半径不变但速度更快，冲撞感来自贴近时的咬合）
  const distToPlayer = mob.position.distanceTo(player.position);
  if (distToPlayer < mob.attackRange && mob.attackCooldown <= 0) {
    mob.attack(player);
    mob.attackCooldown = 1.2;
  }

  // 周期齐射：三发扇形凋灵之首（经回调生成；狂暴射速加快）
  mob.witherShootTimer -= dt;
  if (mob.witherShootTimer <= 0 && distToPlayer < VOLLEY_RANGE && !player.dead) {
    mob.witherShootTimer = enraged ? VOLLEY_INTERVAL_ENRAGED : VOLLEY_INTERVAL;
    if (mobManager && mobManager.onWitherShoot) mobManager.onWitherShoot(mob, player);
  }
}
