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
  }

  // AI 更新
  update(dt, player, sky, physics) {
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

    const distToPlayer = this.position.distanceTo(player.position);

    if (distToPlayer < this.detectionRange && this.hasLineOfSight(player)) {
      this.target = player;
      this.aiState = 'chase';
    } else if (this.aiState === 'chase' && distToPlayer > this.detectionRange * 1.5) {
      this.aiState = 'idle';
      this.target = null;
    }

    if (this.aiState === 'chase' && this.target) {
      this.chase(dt, player, physics);
    } else {
      this.wander(dt, physics);
    }

    // 苦力怕爆炸
    if (this.typeName === 'creeper' && this.target) {
      if (distToPlayer < this.attackRange) {
        this.fuseTimer += dt;
        if (this.fuseTimer > 1.5) {
          this.explode();
        }
      } else {
        this.fuseTimer = Math.max(0, this.fuseTimer - dt * 2);
      }
    }

    // 重力 + 物理
    physics.collide(this, dt);

    // 掉入虚空
    if (this.position.y < -20) {
      this.dead = true;
    }
  }

  chase(dt, player, physics) {
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    let nx = 0, nz = 0;
    if (dist > 0.001) {
      nx = dx / dist;
      nz = dz / dist;
      this.velocity.x = nx * this.speed + this.knockback.x;
      this.velocity.z = nz * this.speed + this.knockback.z;
      // mesh 局部 +Z 是脸/头朝向：rotation.y=yaw 把 +Z 旋到 (sin yaw, cos yaw)，
      // yaw=atan2(nx,nz) 使 +Z 指向移动方向（脸朝玩家、蜘蛛头在前）。
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

    // 攻击
    if (dist < this.attackRange && this.attackCooldown <= 0) {
      this.attack(player);
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
