// Physics.js -- 玩家物理：AABB 碰撞、重力
import { World } from '../core/World.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { CHUNK_HEIGHT } from '../core/Chunk.js';

const GRAVITY = -32;
const JUMP_VELOCITY = 9;
const WATER_GRAVITY = -8;       // 水中重力（约为陆地的 1/4）
const WATER_DRAG = 0.8;         // 水中垂直阻力（每帧速度衰减）
const WATER_HORZ_DRAG = 0.7;    // 水中水平阻力

export class Physics {
  constructor(world) {
    this.world = world;
  }

  // 玩家 AABB：0.6 x 1.8 x 0.6
  collide(entity, dt) {
    const half = 0.3;
    const height = 1.8;
    
    // 应用重力（水中减弱）
    if (!entity.flying && !entity.spectator) {
      if (entity.inWater) {
        entity.velocity.y += WATER_GRAVITY * dt;
        entity.velocity.y *= Math.pow(WATER_DRAG, dt * 60); // 帧率无关阻力
        // 限制水中垂直速度
        if (entity.velocity.y < -4) entity.velocity.y = -4;
        if (entity.velocity.y > 6) entity.velocity.y = 6;
      } else {
        entity.velocity.y += GRAVITY * dt;
      }
    }
    
    // 限制速度
    const maxVel = 50;
    entity.velocity.x = Math.max(-maxVel, Math.min(maxVel, entity.velocity.x));
    entity.velocity.y = Math.max(-maxVel, Math.min(maxVel, entity.velocity.y));
    entity.velocity.z = Math.max(-maxVel, Math.min(maxVel, entity.velocity.z));
    
    if (entity.spectator) {
      // 旁观：无碰撞
      entity.position.x += entity.velocity.x * dt;
      entity.position.y += entity.velocity.y * dt;
      entity.position.z += entity.velocity.z * dt;
      entity.onGround = false;
      return;
    }
    
    entity.onGround = false;
    
    // 分轴移动 + 碰撞，每轴逐步检测所有可能碰撞的方块
    this.moveAxis(entity, 'y', entity.velocity.y * dt, half, height);
    this.moveAxis(entity, 'x', entity.velocity.x * dt, half, height);
    this.moveAxis(entity, 'z', entity.velocity.z * dt, half, height);
    
    // 防止掉出世界（主世界安全网）；虚空维度（末地/天域）不救援——交给虚空伤害/死亡重生
    if (entity.position.y < -10 && !(this.world && this.world.dimDef && this.world.dimDef.hasVoid)) {
      entity.position.y = 100;
      entity.velocity.y = 0;
    }
  }

  moveAxis(entity, axis, amount, half, height) {
    if (amount === 0) return;

    entity.position[axis] += amount;

    // 玩家 AABB
    const minX = entity.position.x - half;
    const maxX = entity.position.x + half;
    const minY = entity.position.y;
    const maxY = entity.position.y + height;
    const minZ = entity.position.z - half;
    const maxZ = entity.position.z + half;

    // 遍历所有可能碰撞的方块
    const bxMin = Math.floor(minX);
    const bxMax = Math.floor(maxX);
    const byMin = Math.floor(minY);
    const byMax = Math.floor(maxY);
    const bzMin = Math.floor(minZ);
    const bzMax = Math.floor(maxZ);

    // 收集所有碰撞，取最保守的回退位置
    let bestResolve = null;
    // 同时收集最高阻挡方块顶面（用于水中自动上岸）
    let maxBlockTopY = -Infinity;

    for (let bx = bxMin; bx <= bxMax; bx++) {
      for (let by = byMin; by <= byMax; by++) {
        for (let bz = bzMin; bz <= bzMax; bz++) {
          const id = this.world.getBlock(bx, by, bz);
          if (id === 0) continue;
          const def = BlockRegistry.getById(id);
          if (!def || !def.solid) continue;

          // AABB 重叠检测
          if (maxX > bx && minX < bx + 1 &&
              maxY > by && minY < by + 1 &&
              maxZ > bz && minZ < bz + 1) {
            let resolve;
            if (axis === 'y') {
              resolve = amount > 0 ? (by - height - 0.0001) : (by + 1 + 0.0001);
            } else if (axis === 'x') {
              resolve = amount > 0 ? (bx - half - 0.0001) : (bx + 1 + half + 0.0001);
            } else {
              resolve = amount > 0 ? (bz - half - 0.0001) : (bz + 1 + half + 0.0001);
            }
            // 取最保守的回退（向移动方向反方向最远）
            if (bestResolve === null) {
              bestResolve = resolve;
            } else if (amount > 0) {
              bestResolve = Math.min(bestResolve, resolve);
            } else {
              bestResolve = Math.max(bestResolve, resolve);
            }
            // 记录最高阻挡方块顶面（用于水中上岸）
            if (by + 1 > maxBlockTopY) maxBlockTopY = by + 1;
          }
        }
      }
    }

    if (bestResolve !== null) {
      // 自动台阶（auto-jump）：水平碰撞时若阻挡方块顶面只高出 1 个方块以内，
      // 同时玩家头部上方有足够空间，则提升玩家 y 而不阻挡水平移动
      // 适用于陆上台阶和水中上岸
      if (axis !== 'y' &&
          isFinite(maxBlockTopY) &&
          maxBlockTopY - entity.position.y > 0 &&
          maxBlockTopY - entity.position.y <= 1.0 + 0.01) {
        // 验证目标位置 [maxBlockTopY, maxBlockTopY + height] 内无碰撞
        const targetY = maxBlockTopY + 0.0001;
        const tMinX = entity.position.x - half;
        const tMaxX = entity.position.x + half;
        const tMinZ = entity.position.z - half;
        const tMaxZ = entity.position.z + half;
        const tbxMin = Math.floor(tMinX);
        const tbxMax = Math.floor(tMaxX - 0.0001);
        const tbyMin = Math.floor(targetY);
        const tbyMax = Math.floor(targetY + height - 0.0001);
        const tbzMin = Math.floor(tMinZ);
        const tbzMax = Math.floor(tMaxZ - 0.0001);
        let blocked = false;
        for (let bx = tbxMin; bx <= tbxMax; bx++) {
          for (let by = tbyMin; by <= tbyMax; by++) {
            for (let bz = tbzMin; bz <= tbzMax; bz++) {
              const id = this.world.getBlock(bx, by, bz);
              if (id === 0) continue;
              const def = BlockRegistry.getById(id);
              if (!def || !def.solid) continue;
              blocked = true;
              break;
            }
            if (blocked) break;
          }
          if (blocked) break;
        }
        if (!blocked) {
          // 抬升 y 到阻挡方块顶面，保留水平移动
          entity.position.y = targetY;
          return;
        }
      }
      // 否则按碰撞回退
      entity.position[axis] = bestResolve;
      if (axis === 'y') {
        entity.velocity.y = 0;
        if (amount < 0) entity.onGround = true;
      } else if (axis === 'x') {
        entity.velocity.x = 0;
      } else {
        entity.velocity.z = 0;
      }
    }
  }

  jump(entity) {
    if (entity.inWater) return; // 水中由上浮逻辑处理
    if (entity.onGround && !entity.flying) {
      entity.velocity.y = JUMP_VELOCITY;
      entity.onGround = false;
    }
  }
}
