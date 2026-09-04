// EntityPhysics.js -- 通用实体物理（AABB 碰撞）
import { World } from '../core/World.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { CHUNK_HEIGHT } from '../core/Chunk.js';

const GRAVITY = -32;

export class EntityPhysics {
  constructor(world) {
    this.world = world;
  }

  collide(entity, dt) {
    if (entity.dead) return;

    const half = entity.half;
    const height = entity.height;

    if (!entity.flying && !entity.noClip) {
      entity.velocity.y += GRAVITY * dt;
    }

    const maxVel = 50;
    entity.velocity.x = Math.max(-maxVel, Math.min(maxVel, entity.velocity.x));
    entity.velocity.y = Math.max(-maxVel, Math.min(maxVel, entity.velocity.y));
    entity.velocity.z = Math.max(-maxVel, Math.min(maxVel, entity.velocity.z));

    if (entity.noClip) {
      entity.position.x += entity.velocity.x * dt;
      entity.position.y += entity.velocity.y * dt;
      entity.position.z += entity.velocity.z * dt;
      entity.onGround = false;
      return;
    }

    entity.onGround = false;

    const moveAxis = (axis, amount) => {
      if (amount === 0) return;
      entity.position[axis] += amount;

      const min = [
        entity.position.x - half,
        entity.position.y,
        entity.position.z - half
      ];
      const max = [
        entity.position.x + half,
        entity.position.y + height,
        entity.position.z + half
      ];

      for (let bx = Math.floor(min[0]); bx <= Math.floor(max[0]); bx++) {
        for (let by = Math.floor(min[1]); by <= Math.floor(max[1]); by++) {
          for (let bz = Math.floor(min[2]); bz <= Math.floor(max[2]); bz++) {
            const id = this.world.getBlock(bx, by, bz);
            if (id === 0) continue;
            const def = BlockRegistry.getById(id);
            if (!def || !def.solid) continue;
            if (max[0] > bx && min[0] < bx + 1 &&
                max[1] > by && min[1] < by + 1 &&
                max[2] > bz && min[2] < bz + 1) {
              // 回退坐标取当前轴对应的方块坐标：z 轴必须用 bz（曾误用 bx，
              // 沿 z 撞墙的实体会被瞬移到 z≈x 的远点，村民游荡高频触发）
              const bc = (axis === 'z') ? bz : bx;
              if (amount > 0) {
                entity.position[axis] = (axis === 'y') ? by - height - 0.001 : bc - half - 0.001;
              } else {
                entity.position[axis] = (axis === 'y') ? by + 1 + 0.001 : bc + 1 + half + 0.001;
              }
              if (axis === 'y') {
                if (amount < 0) entity.onGround = true;
                entity.velocity.y = 0;
              } else {
                entity.velocity[axis] = 0;
              }
              return;
            }
          }
        }
      }
    };

    moveAxis('y', entity.velocity.y * dt);
    moveAxis('x', entity.velocity.x * dt);
    moveAxis('z', entity.velocity.z * dt);

    if (entity.position.y < -10) {
      entity.dead = true;
    }
  }

  isStandingOn(entity) {
    const half = entity.half;
    const px = entity.position.x;
    const py = entity.position.y;
    const pz = entity.position.z;
    for (let bx = Math.floor(px - half); bx <= Math.floor(px + half); bx++) {
      for (let bz = Math.floor(pz - half); bz <= Math.floor(pz + half); bz++) {
        const id = this.world.getBlock(bx, Math.floor(py - 0.1), bz);
        if (id !== 0) {
          const def = BlockRegistry.getById(id);
          if (def && def.solid) return true;
        }
      }
    }
    return false;
  }

  isInWater(entity) {
    const id = this.world.getBlock(
      Math.floor(entity.position.x),
      Math.floor(entity.position.y + entity.height * 0.5),
      Math.floor(entity.position.z)
    );
    if (id === 0) return false;
    const def = BlockRegistry.getById(id);
    return def && def.name === 'water';
  }

  isInLava(entity) {
    const id = this.world.getBlock(
      Math.floor(entity.position.x),
      Math.floor(entity.position.y + entity.height * 0.5),
      Math.floor(entity.position.z)
    );
    if (id === 0) return false;
    const def = BlockRegistry.getById(id);
    return def && def.name === 'lava';
  }
}
