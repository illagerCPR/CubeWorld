// Mob.js -- 怪物实体 + AI
import * as THREE from 'three';
import { Entity } from './Entity.js';
import { MobTypes } from './MobTextures.js';
import { BlockRegistry } from '../core/BlockRegistry.js';

export class Mob extends Entity {
  constructor(typeName, world) {
    super();
    const type = MobTypes[typeName];
    this.type = type;
    this.typeName = typeName;
    this.isMob = true;   // 鸭子类型标记：chase 攻击分流用（instanceof 在 HMR 双模块实例下失效）
    this.world = world;
    this.width = type.width;
    this.height = type.height;
    this.maxHealth = type.health;
    this.health = type.health;
    this.attackDamage = type.damage;
    this.speed = type.speed;
    this.attackRange = type.attackRange;
    this.detectionRange = type.detectionRange;
    this.ranged = type.ranged || false;
    this.burningInDay = type.burningInDay || false;
    this.climbing = type.climbing || false;
    this.explosionRadius = type.explosionRadius || 0;

    // AI 状态
    this.target = null;
    this.aiState = 'idle';
    this.aiTimer = 0;
    this.attackCooldown = 0;
    this.fuseTimer = 0;
    this.isBurning = false;
    this.burnTime = 0;
    this.wanderDir = new THREE.Vector3();
    this.wanderTimer = 0;
    this.mesh = null;
    this.knockback = new THREE.Vector3();
    this.hitFlash = 0;          // 受击红光闪烁计时（秒）
    this.dyingAnim = null;      // 死亡动画状态 {progress, total}
    this.home = null;           // 村民：{x, z, radius} 村庄绳拴锚点（生成方注入）
    this.fleeTimer = 0;         // 村民：逃离最短持续时间
  }

  // AI 更新（mobManager 由 MobManager.update 注入，供村民逃敌/敌对索敌村民查询）
  update(dt, player, sky, physics, mobManager) {
    if (this.dead) return;

    this.aiTimer -= dt;
    this.attackCooldown -= dt;
    this.wanderTimer -= dt;

    // 燃烧判定（日光下）
    if (this.burningInDay && sky && sky.isDay() && this.isExposedToSky()) {
      this.isBurning = true;
      this.burnTime = 8;
    }
    if (this.isBurning) {
      this.burnTime -= dt;
      if (this.burnTime <= 0) {
        this.isBurning = false;
      } else {
        this.health -= dt * 1.5;
        if (this.health <= 0) { this.dead = true; }
      }
    }

    if (this.type.passive) {
      // 村民等被动生物：游荡/注视/逃离，永不索敌
      this.updatePassiveAI(dt, player, physics, mobManager);
    } else {
      const distToPlayer = this.position.distanceTo(player.position);

      // 敌对目标选择：玩家与村民（仅僵尸/骷髅，苦力怕/蜘蛛限玩家——防自爆拆村）取最近
      let target = null;
      let targetDist = Infinity;
      if (distToPlayer < this.detectionRange && this.hasLineOfSight(player)) {
        target = player;
        targetDist = distToPlayer;
      }
      const huntsVillagers = this.typeName === 'zombie' || this.typeName === 'skeleton';
      if (huntsVillagers && mobManager) {
        const v = mobManager.findNearestMob(this.position, this.detectionRange, 'villager');
        if (v) {
          const dv = this.position.distanceTo(v.position);
          if (dv < targetDist) { target = v; targetDist = dv; }
        }
      }

      if (target) {
        this.target = target;
        this.aiState = 'chase';
      } else if (this.aiState === 'chase' &&
                 (!this.target || this.target.dead ||
                  this.position.distanceTo(this.target.position) > this.detectionRange * 1.5)) {
        this.aiState = 'idle';
        this.target = null;
      }

      if (this.aiState === 'chase' && this.target) {
        this.chase(dt, this.target, physics, mobManager);
      } else {
        this.wander(dt, physics);
      }

      // 苦力怕爆炸（只对玩家目标——目标是村民时保持追行不引爆，护村）
      if (this.typeName === 'creeper' && this.target === player) {
        if (distToPlayer < this.attackRange) {
          this.fuseTimer += dt;
          if (this.fuseTimer > 1.5) {
            this.explode();
          }
        } else {
          this.fuseTimer = Math.max(0, this.fuseTimer - dt * 2);
        }
      }
    }

    // 重力 + 物理
    physics.collide(this, dt);

    // 掉入虚空
    if (this.position.y < -20) {
      this.dead = true;
    }
  }

  // 被动 AI（村民）：8 格内敌对怪 → 背向逃离；4 格内玩家 → 注视；否则绳拴游荡
  updatePassiveAI(dt, player, physics, mobManager) {
    this.target = null;

    let threat = null;
    let threatDist = Infinity;
    if (mobManager) {
      for (const m of mobManager.mobs) {
        if (m === this || m.dead || m.typeName === 'villager') continue;
        if (m.attackDamage <= 0) continue;
        const d = this.position.distanceTo(m.position);
        if (d < 8 && d < threatDist) { threat = m; threatDist = d; }
      }
    }

    if (threat) {
      this.aiState = 'flee';
      this.fleeTimer = 1.5;   // 脱离威胁后再保持逃跑一小段
    } else if (this.aiState === 'flee') {
      this.fleeTimer -= dt;
      if (this.fleeTimer <= 0) this.aiState = 'idle';
    }

    if (this.aiState === 'flee') {
      // 逃跑方向：有威胁背向逃离，无威胁按上帧方向继续；
      // 离家超过半径+8 时朝家偏置（防被追击怪一路拖离村庄）
      let fx = 0, fz = 0;
      if (threat) {
        fx = this.position.x - threat.position.x;
        fz = this.position.z - threat.position.z;
        const d = Math.sqrt(fx * fx + fz * fz) || 1;
        fx /= d; fz /= d;
      } else {
        fx = Math.sin(this.yaw); fz = Math.cos(this.yaw); // 沿当前朝向
      }
      if (this.home) {
        const dxh = this.home.x - this.position.x;
        const dzh = this.home.z - this.position.z;
        const dh = Math.sqrt(dxh * dxh + dzh * dzh);
        if (dh > this.home.radius + 8) {
          const w = 1.2; // 家向权重 > 1：净位移朝村
          fx = fx + (dxh / dh) * w;
          fz = fz + (dzh / dh) * w;
          const n = Math.sqrt(fx * fx + fz * fz) || 1;
          fx /= n; fz /= n;
        }
      }
      const sp = this.speed * 1.6;
      this.velocity.x = fx * sp + this.knockback.x;
      this.velocity.z = fz * sp + this.knockback.z;
      this.yaw = Math.atan2(fx, fz);   // 同 chase：+Z 朝移动方向（脸朝逃跑方向）
      if (this.isBlocked(fx, fz) && this.onGround) this.velocity.y = 8;
      this.knockback.multiplyScalar(0.85);
      return;
    }

    // 注视：玩家 4 格内站立面向玩家（不移动）
    const dp = this.position.distanceTo(player.position);
    if (dp < 4) {
      this.velocity.x = 0;
      this.velocity.z = 0;
      this.yaw = Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z);
      return;
    }

    this.wanderVillage(dt, physics);
  }

  // 村庄绳拴游荡：超出 home 半径 → 朝家折返
  wanderVillage(dt, physics) {
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 3 + Math.random() * 4;
      const angle = Math.random() * Math.PI * 2;
      this.wanderDir.set(Math.cos(angle), 0, Math.sin(angle));
      if (Math.random() < 0.4) {
        this.wanderDir.set(0, 0, 0);   // 常态驻足
      }
    }
    if (this.home) {
      const dxh = this.home.x - this.position.x;
      const dzh = this.home.z - this.position.z;
      const dh = Math.sqrt(dxh * dxh + dzh * dzh);
      if (dh > this.home.radius) {
        this.wanderDir.set(dxh / dh, 0, dzh / dh);
      }
    }
    this.velocity.x = this.wanderDir.x * this.speed * 0.5;
    this.velocity.z = this.wanderDir.z * this.speed * 0.5;
    if (this.wanderDir.lengthSq() > 0) {
      this.yaw = Math.atan2(this.wanderDir.x, this.wanderDir.z); // 同 chase：+Z 朝移动方向
    }
  }

  chase(dt, target, physics, mobManager) {
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    let nx = 0, nz = 0;
    if (dist > 0.001) {
      nx = dx / dist;
      nz = dz / dist;
      this.velocity.x = nx * this.speed + this.knockback.x;
      this.velocity.z = nz * this.speed + this.knockback.z;
      // mesh 局部 +Z 是脸/头朝向：rotation.y=yaw 把 +Z 旋到 (sin yaw, cos yaw)，
      // yaw=atan2(nx,nz) 使 +Z 指向移动方向（脸朝目标、蜘蛛头在前）。
      // 旧公式 atan2(-nx,-nz) 会让脸背对移动方向（蜘蛛头拖在身后），勿回退。
      this.yaw = Math.atan2(nx, nz);
    }

    // 蜘蛛可以攀爬
    if (this.climbing && this.isAgainstWall()) {
      this.velocity.y = 3;
    }

    // 跳跃跨越障碍
    if ((nx !== 0 || nz !== 0) && this.isBlocked(nx, nz) && this.onGround) {
      this.velocity.y = 8;
    }

    // 攻击：目标是怪物（村民）走怪物伤害路径，目标是玩家走 player.hurt
    if (dist < this.attackRange && this.attackCooldown <= 0) {
      if (target.isMob) {
        if (mobManager) mobManager.mobAttackMob(this, target);
      } else {
        this.attack(target);
      }
      this.attackCooldown = 1.0;
    }

    this.knockback.multiplyScalar(0.85);
  }

  isBlocked(nx, nz) {
    const checkX = this.position.x + nx * 0.6;
    const checkZ = this.position.z + nz * 0.6;
    const id = this.world.getBlock(
      Math.floor(checkX),
      Math.floor(this.position.y + 0.1),
      Math.floor(checkZ)
    );
    if (id === 0) return false;
    const def = BlockRegistry.getById(id);
    return def && def.solid;
  }

  isAgainstWall() {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
      const id = this.world.getBlock(
        Math.floor(this.position.x + dx * 0.5),
        Math.floor(this.position.y + 0.5),
        Math.floor(this.position.z + dz * 0.5)
      );
      if (id !== 0) return true;
    }
    return false;
  }

  wander(dt, physics) {
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 3 + Math.random() * 4;
      const angle = Math.random() * Math.PI * 2;
      this.wanderDir.set(Math.cos(angle), 0, Math.sin(angle));
      if (Math.random() < 0.3) {
        this.wanderDir.set(0, 0, 0);
      }
    }
    this.velocity.x = this.wanderDir.x * this.speed * 0.5;
    this.velocity.z = this.wanderDir.z * this.speed * 0.5;
    if (this.wanderDir.lengthSq() > 0) {
      this.yaw = Math.atan2(this.wanderDir.x, this.wanderDir.z); // 同 chase：+Z 朝移动方向
    }
  }

  attack(player) {
    if (this.typeName === 'creeper') return;
    if (this.ranged) {
      // 骷髅射箭（简化：直接造成伤害）
      const dist = this.position.distanceTo(player.position);
      if (dist < this.attackRange) {
        const hit = player.hurt(this.attackDamage, 'mob', true);
        if (hit) this.knockbackPlayer(player);
      }
    } else {
      const hit = player.hurt(this.attackDamage, 'mob', true);
      if (hit) this.knockbackPlayer(player);
    }
  }

  knockbackPlayer(player) {
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.001) {
      player.velocity.x += (dx / d) * 8;
      player.velocity.z += (dz / d) * 8;
      player.velocity.y += 5;
    }
  }

  hasLineOfSight(target) {
    // 简化：检查中间是否有实心方块阻挡
    const from = this.position.clone();
    from.y += this.height * 0.5;
    const to = target.position.clone();
    to.y += 1.0;
    const steps = Math.ceil(from.distanceTo(to));
    const step = to.clone().sub(from).divideScalar(steps);
    for (let i = 1; i < steps; i++) {
      const p = from.clone().add(step.clone().multiplyScalar(i));
      const id = this.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      if (id !== 0) {
        const def = BlockRegistry.getById(id);
        if (def && def.solid && !def.transparent) return false;
      }
    }
    return true;
  }

  isExposedToSky() {
    const x = Math.floor(this.position.x);
    const z = Math.floor(this.position.z);
    const y = Math.floor(this.position.y + this.height);
    for (let yy = y; yy < 256; yy++) {
      const id = this.world.getBlock(x, yy, z);
      if (id !== 0) {
        return false;
      }
    }
    return true;
  }

  explode() {
    this.dead = true;
    this.pendingExplosion = {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      radius: this.explosionRadius,
    };
  }
}
