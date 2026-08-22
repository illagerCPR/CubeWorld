// MobManager.js -- 怪物管理：生成/更新/渲染/掉落物
import * as THREE from 'three';
import { Mob } from './Mob.js';
import { MobTypes, generateMobSkinSVGs, mobSkinUV } from './MobTextures.js';
import { SVGTextures } from '../render/SVGTextures.js';
import { EntityPhysics } from './EntityPhysics.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from '../core/Chunk.js';

const MAX_MOBS = 20;
const SPAWN_INTERVAL = 2.5;
const DESPAWN_DISTANCE = 80;

const HIT_FLASH_DURATION = 0.25;   // 怪物受击红光持续时长（秒）
const HEALTH_BAR_FADE = 3.0;       // 怪物头顶血条淡出时长（秒）
const DEATH_ANIM_DURATION = 0.4;   // 死亡缩放动画时长（秒）
const HEALTH_BAR_WIDTH = 1.0;      // 血条世界坐标宽

// 皮肤 atlas 各 face 的 col 索引映射（顶/底面复用 front/back）
const FACE_COL = { front: 0, back: 1, left: 2, right: 3, top: 0, bot: 1 };

// 6 个 face 定义（参考 ChunkMesh FACES）：
//   - corners：4 个顶点用 unit-cube [0/1, 0/1, 0/1] 描述，顺序为 [底,顶,底,顶]，与现有 UV 顺序对齐
//   - name：该 face 对应 mob 皮肤的哪一面（front/back/left/right/top/bot）
const FACE_DEFS = [
  { name: 'right',  corners: [[1,0,0],[1,1,0],[1,0,1],[1,1,1]] }, // +X
  { name: 'left',   corners: [[0,0,1],[0,1,1],[0,0,0],[0,1,0]] }, // -X
  { name: 'top',    corners: [[0,1,1],[1,1,1],[0,1,0],[1,1,0]] }, // +Y
  { name: 'bot',    corners: [[0,0,0],[1,0,0],[0,0,1],[1,0,1]] }, // -Y
  { name: 'front',  corners: [[1,0,1],[1,1,1],[0,0,1],[0,1,1]] }, // +Z
  { name: 'back',   corners: [[0,0,0],[0,1,0],[1,0,0],[1,1,0]] }, // -Z
];

export class MobManager {
  constructor(world, scene, atlasUV, atlasTexture) {
    this.world = world;
    this.scene = scene;
    this.atlasUV = atlasUV;
    this.atlasTexture = atlasTexture;
    this.mobs = [];
    this.physics = new EntityPhysics(world);
    this.spawnTimer = 0;
    this.mobSkins = generateMobSkinSVGs();
    this.mobMaterials = new Map();   // typeName -> master Material（含 master SkinTexture）
    this.mobGeometries = new Map();   // typeName -> master BufferGeometry（cuboid 合并）
    this.mobTextures = new Map();     // typeName -> master CanvasTexture（type 私有，dispose 时一并释放）
    this.droppedItems = [];
    this.pendingExplosions = [];
    this.frame = 0;
    this.spawnEnabled = true; // 联机阶段 0 关闭本地怪物生成
    this.onDropTaken = null;  // 联机拾取回调 (dropId) => void，由 Game 注入（通知服务器移除）
  }

  // 异步初始化：mob 用私有 skin atlas，不再注入全局 atlas
  async init(svgMap) {
    // no-op：mob 皮肤 atlas 由本类的 buildMaterials 单独构建
  }

  // 构建怪物的 geometry + master material（每 type 的 skin texture 私有）
  async buildMaterials() {
    for (const typeName of Object.keys(MobTypes)) {
      const type = MobTypes[typeName];
      // 1. svg → image → canvas → texture
      const svg = this.mobSkins[typeName];
      const img = await SVGTextures.svgToImage(svg);
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, 64, 32);
      const tex = new THREE.CanvasTexture(canvas);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = false;
      this.mobTextures.set(typeName, tex);

      // 2. 用 parts 拼出 cuboid 的合并 BufferGeometry
      const positions = [];
      const uvs = [];
      const indices = [];
      let idx = 0;
      for (const part of type.model.parts) {
        const [minX, minY, minZ, maxX, maxY, maxZ] = part.box;
        const dimX = maxX - minX;
        const dimY = maxY - minY;
        const dimZ = maxZ - minZ;
        for (const fdef of FACE_DEFS) {
          const col = FACE_COL[fdef.name];
          const uv = mobSkinUV(part.row, col);
          // corners 用 unit [0/1] 缩放到 box 实际尺寸并偏移到 part 位置
          for (let c = 0; c < 4; c++) {
            const cx = fdef.corners[c][0];
            const cy = fdef.corners[c][1];
            const cz = fdef.corners[c][2];
            positions.push(minX + cx * dimX, minY + cy * dimY, minZ + cz * dimZ);
            // UV 顺序跟随 corner [底,顶,底,顶]：底→v0，顶→v1
            uvs.push(c < 2 ? uv.u0 : uv.u1, (c & 1) ? uv.v1 : uv.v0);
          }
          // 索引：两个三角形 (0,1,2)+(0,2,3)
          indices.push(idx, idx + 1, idx + 2, idx, idx + 2, idx + 3);
          idx += 4;
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);

      const mat = new THREE.MeshLambertMaterial({
        map: tex,
        side: THREE.DoubleSide,
        alphaTest: 0.5,
        transparent: false,
      });

      this.mobGeometries.set(typeName, geo);
      this.mobMaterials.set(typeName, mat);
    }
  }

  // 尝试生成怪物
  trySpawn(playerPos, isNight) {
    if (!this.spawnEnabled) return;
    if (this.mobs.length >= MAX_MOBS) return;

    // 在玩家周围 16~48 格内尝试
    const angle = Math.random() * Math.PI * 2;
    const dist = 16 + Math.random() * 32;
    const x = Math.floor(playerPos.x + Math.cos(angle) * dist);
    const z = Math.floor(playerPos.z + Math.sin(angle) * dist);

    // 找地表高度
    let y = -1;
    for (let yy = CHUNK_HEIGHT - 1; yy >= 1; yy--) {
      const id = this.world.getBlock(x, yy, z);
      if (id !== 0) {
        const def = BlockRegistry.getById(id);
        if (def && def.solid) {
          y = yy + 1;
          break;
        }
      }
    }
    if (y < 1 || y >= CHUNK_HEIGHT) return;

    // 上方必须有空间
    const headId = this.world.getBlock(x, y + 1, z);
    if (headId !== 0) return;

    // 亮度检查（简化：夜晚生成）
    if (!isNight && y > SEA_LEVEL + 5) return;

    // 选择怪物类型
    const choices = isNight
      ? ['zombie', 'zombie', 'skeleton', 'creeper', 'spider']
      : ['spider', 'zombie'];
    const typeName = choices[Math.floor(Math.random() * choices.length)];

    const mob = new Mob(typeName, this.world);
    mob.position.set(x + 0.5, y, z + 0.5);
    this.spawnMob(mob);
  }

  spawnMob(mob) {
    const geo = this.mobGeometries.get(mob.typeName);
    const mat = this.mobMaterials.get(mob.typeName);
    if (!geo || !mat) return;

    // 每只怪独享一份 material（emissive 是 per-mob 状态，clone 即可）
    const matInst = mat.clone();
    mob.mesh = new THREE.Mesh(geo, matInst);
    this.scene.add(mob.mesh);

    // 头顶血条 sprite（默认隐藏）
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 8;
    const ctx = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    const spriteMat = new THREE.SpriteMaterial({
      map: tex,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(HEALTH_BAR_WIDTH, 0.12, 1);
    sprite.renderOrder = 1000;
    sprite.visible = false;
    this.scene.add(sprite);

    mob.healthBarCanvas = cv;
    mob.healthBarCtx = ctx;
    mob.healthBarTex = tex;
    mob.healthBarSprite = sprite;
    mob.healthBarFadeTimer = 0;

    this.mobs.push(mob);
  }

  // 重绘 mob 头顶血条 canvas（每受击一次调一次）
  _updateHealthBar(mob) {
    const ctx = mob.healthBarCtx;
    const cv = mob.healthBarCanvas;
    const w = cv.width;
    const h = cv.height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(1, 1, w - 2, h - 2);
    const ratio = Math.max(0, mob.health / mob.maxHealth);
    const barW = Math.round((w - 2) * ratio);
    if (barW > 0) {
      // 颜色随血量从绿 → 黄 → 红
      let r, g, b;
      if (ratio > 0.5) {
        const t = (ratio - 0.5) * 2;
        r = Math.round(220 * (1 - t) + 60 * t);
        g = Math.round(220 * (1 - t) + 220 * t);
        b = 30;
      } else {
        const t = ratio * 2;
        r = 220;
        g = Math.round(60 * (1 - t) + 60 * t);
        b = 30;
      }
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(1, 1, barW, h - 2);
    }
    mob.healthBarTex.needsUpdate = true;
  }

  // 更新所有怪物
  update(dt, player, sky) {
    this.frame++;
    this.spawnTimer -= dt;
    const isNight = sky ? sky.isNight() : false;

    if (this.spawnTimer <= 0) {
      this.spawnTimer = SPAWN_INTERVAL;
      this.trySpawn(player.position, isNight);
    }

    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const mob = this.mobs[i];

      // 死亡动画播放阶段：跳过 AI、原地累积动画进度后销毁
      if (mob.dyingAnim) {
        mob.dyingAnim.progress += dt;
        const t = Math.min(1, mob.dyingAnim.progress / mob.dyingAnim.total);
        if (mob.mesh) {
          const scale = Math.max(0.05, 1 - t);
          mob.mesh.scale.setScalar(scale);
          mob.mesh.rotation.y += dt * 8;
          // 渐隐 + 红光淡出
          const mm = mob.mesh.material;
          if (mm) {
            mm.transparent = true;
            mm.opacity = 1 - t;
            if (!mm.emissive) mm.emissive = new THREE.Color();
            mm.emissive.setRGB(0.9, 0.1, 0.1);
            mm.emissiveIntensity = (1 - t) * 0.6;
          }
        }
        if (mob.healthBarSprite) mob.healthBarSprite.visible = false;
        if (t >= 1) {
          this.dropLoot(mob);
          this._removeMobResources(mob);
          this.mobs.splice(i, 1);
        }
        continue;
      }

      // 普通帧
      mob.update(dt, player, sky, this.physics);

      // 处理爆炸请求
      if (mob.pendingExplosion) {
        this.pendingExplosions.push(mob.pendingExplosion);
        mob.pendingExplosion = null;
      }

      // 更新 mesh 位置 + 旋转
      const mesh = mob.mesh;
      if (mesh) {
        mesh.position.copy(mob.position);
        mesh.rotation.y = mob.yaw;

        const mm = mesh.material;
        if (mm) {
          // 受击红光（优先）；否则燃烧ulfilled 火光
          if (mob.hitFlash > 0) {
            mob.hitFlash -= dt;
            if (!mm.emissive) mm.emissive = new THREE.Color();
            mm.emissive.setRGB(0.85, 0.05, 0.05);
            mm.emissiveIntensity = Math.max(0, mob.hitFlash / HIT_FLASH_DURATION) * 0.9;
          } else if (mob.isBurning) {
            if (!mm.emissive) mm.emissive = new THREE.Color();
            mm.emissive.setRGB(1.0, 0.27, 0.0);
            mm.emissiveIntensity = 0.5;
          } else if (mm.emissive) {
            mm.emissive.setRGB(0, 0, 0);
            mm.emissiveIntensity = 0;
          }
        }
      }

      // 头顶血条 fade 计时 + 位置跟随
      if (mob.healthBarSprite) {
        if (mob.healthBarFadeTimer > 0) {
          mob.healthBarFadeTimer -= dt;
          const remaining = mob.healthBarFadeTimer;
          const sprite = mob.healthBarSprite;
          sprite.visible = remaining > 0;
          if (sprite.visible) {
            sprite.position.set(
              mob.position.x,
              mob.position.y + mob.height + 0.35,
              mob.position.z
            );
            // 末 1 秒透明渐隐
            if (remaining < 1.0) {
              sprite.material.opacity = remaining;
              sprite.material.transparent = true;
            } else {
              sprite.material.opacity = 1;
              sprite.material.transparent = true;
            }
          }
        } else {
          mob.healthBarSprite.visible = false;
        }
      }

      // 死亡：触发死亡动画（而非立刻移除）
      const dist = mob.position.distanceTo(player.position);
      if (mob.dead) {
        mob.dyingAnim = { progress: 0, total: DEATH_ANIM_DURATION };
        if (mob.healthBarSprite) mob.healthBarSprite.visible = false;
      } else if (dist > DESPAWN_DISTANCE) {
        // 被卸载而非死亡：直接清理
        this._removeMobResources(mob);
        this.mobs.splice(i, 1);
      }
    }

    // 处理爆炸
    this.processExplosions();

    // 更新掉落物
    this.updateDroppedItems(dt, player);
  }

  // 释放 mob 占用的所有 Three 资源（mesh + 血条 sprite）
  _removeMobResources(mob) {
    if (mob.mesh) {
      this.scene.remove(mob.mesh);
      // material 是 per-mob 实例，释放；geometry 是 type 共享，不动
      if (mob.mesh.material) mob.mesh.material.dispose();
    }
    if (mob.healthBarSprite) {
      this.scene.remove(mob.healthBarSprite);
      if (mob.healthBarSprite.material) mob.healthBarSprite.material.dispose();
      if (mob.healthBarTex) mob.healthBarTex.dispose();
      mob.healthBarSprite = null;
      mob.healthBarTex = null;
      mob.healthBarCanvas = null;
      mob.healthBarCtx = null;
    }
  }

  processExplosions() {
    while (this.pendingExplosions.length > 0) {
      const exp = this.pendingExplosions.shift();
      const r = exp.radius;
      // 破坏方块
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dz = -r; dz <= r; dz++) {
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d > r) continue;
            const bx = Math.floor(exp.x + dx);
            const by = Math.floor(exp.y + dy);
            const bz = Math.floor(exp.z + dz);
            const id = this.world.getBlock(bx, by, bz);
            if (id !== 0) {
              const def = BlockRegistry.getById(id);
              if (def && def.hardness >= 0 && def.name !== 'bedrock') {
                this.world.setBlock(bx, by, bz, 0);
              }
            }
          }
        }
      }
    }
  }

  dropLoot(mob) {
    const type = mob.type;
    for (const drop of type.drops) {
      const chance = drop.chance ?? 1;
      if (Math.random() < chance) {
        const count = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
        if (count > 0) {
          this.spawnDrop(mob.position, drop.name, count);
        }
      }
    }
    if (type.rareDrop && Math.random() < type.rareDrop.chance) {
      this.spawnDrop(mob.position, type.rareDrop.name, 1);
    }
  }

  spawnDrop(pos, name, count) {
    const drop = {
      id: null, // 联机掉落物才有服务器分配的 id
      name,
      count,
      position: pos.clone().add(new THREE.Vector3(0, 0.5, 0)),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        3,
        (Math.random() - 0.5) * 2
      ),
      age: 0,
      pickupDelay: 1.0,
      mesh: null,
    };
    this._createDropMesh(drop);
    this.droppedItems.push(drop);
    return drop;
  }

  // 由服务器广播 drop_spawn 创建掉落物：id 服务器唯一；速度由 id 确定性派生，各端运动一致
  spawnRemoteDrop(id, x, y, z, name, count) {
    if (this.droppedItems.some(d => d.id === id)) return; // 去重（重连回放可能重复广播）
    const drop = {
      id,
      name,
      count,
      position: new THREE.Vector3(x, y, z),
      velocity: new THREE.Vector3(
        (this._hashRand(id) - 0.5) * 2,
        3,
        (this._hashRand(id * 2 + 1) - 0.5) * 2
      ),
      age: 0,
      pickupDelay: 1.0,
      mesh: null,
    };
    this._createDropMesh(drop);
    this.droppedItems.push(drop);
  }

  // 按 id 移除掉落物（drop_taken 广播落地），找不到则忽略
  removeDropById(id) {
    for (let i = this.droppedItems.length - 1; i >= 0; i--) {
      const d = this.droppedItems[i];
      if (d.id === id) {
        if (d.mesh) this.scene.remove(d.mesh);
        this.droppedItems.splice(i, 1);
        return;
      }
    }
  }

  // 确定性伪随机 [0,1)，由整数 id 派生（联机各端掉落物初速度一致）
  _hashRand(n) {
    let h = (n * 2654435761) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  _createDropMesh(drop) {
    const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const mat = new THREE.MeshLambertMaterial({ color: this.getDropColor(drop.name) });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(drop.position);
    drop.mesh = mesh;
    this.scene.add(mesh);
  }

  getDropColor(name) {
    const colors = {
      // 怪物掉落
      rotten_flesh: 0x8a4a4a,
      bone: 0xeeeeee,
      arrow: 0x8a6a3a,
      gunpowder: 0x444444,
      string: 0xeeeeee,
      spider_eye: 0x4a2a2a,
      iron_ingot: 0xdddddd,
      // 方块掉落（联机挖矿）
      stone: 0x8a8a8a,
      cobblestone: 0x777777,
      dirt: 0x79553a,
      grass_block: 0x5a8c3a,
      sand: 0xe6d9a8,
      gravel: 0x9a9a9a,
      oak_log: 0x6b4f2a,
      oak_planks: 0xb8945a,
      oak_leaves: 0x4a7a2a,
      glass: 0xcfecf0,
      coal_ore: 0x333333,
      iron_ore: 0xcc8866,
      gold_ore: 0xddcc44,
      diamond_ore: 0x66ddcc,
      water: 0x3366cc,
      torch: 0xddbb33,
    };
    return colors[name] || 0x888888;
  }

  updateDroppedItems(dt, player) {
    for (let i = this.droppedItems.length - 1; i >= 0; i--) {
      const drop = this.droppedItems[i];
      drop.age += dt;
      drop.pickupDelay = Math.max(0, drop.pickupDelay - dt);

      // 重力
      drop.velocity.y += -32 * dt;
      drop.position.x += drop.velocity.x * dt;
      drop.position.y += drop.velocity.y * dt;
      drop.position.z += drop.velocity.z * dt;

      // 碰撞（简化：只检测下方）
      const bx = Math.floor(drop.position.x);
      const by = Math.floor(drop.position.y);
      const bz = Math.floor(drop.position.z);
      const belowId = this.world.getBlock(bx, by - 1, bz);
      if (belowId !== 0) {
        const def = BlockRegistry.getById(belowId);
        if (def && def.solid) {
          drop.position.y = by;
          drop.velocity.y = 0;
          drop.velocity.x *= 0.7;
          drop.velocity.z *= 0.7;
        }
      }

      if (drop.mesh) {
        drop.mesh.position.copy(drop.position);
        drop.mesh.rotation.y += dt * 2;
      }

      // 拾取
      const dist = drop.position.distanceTo(player.position);
      if (drop.pickupDelay <= 0 && dist < 1.5) {
        if (this.onPickup) {
          // onPickup 返回未放入的剩余数量（0 = 全部拾取）
          const remaining = this.onPickup(drop.name, drop.count);
          drop.count = remaining;
          if (remaining <= 0) {
            // 全部拾取
            if (drop.mesh) this.scene.remove(drop.mesh);
            this.droppedItems.splice(i, 1);
            if (drop.id != null && this.onDropTaken) this.onDropTaken(drop.id); // 联机：通知服务器移除
            continue;
          }
        }
      }

      // 5 分钟后消失
      if (drop.age > 300) {
        if (drop.mesh) this.scene.remove(drop.mesh);
        this.droppedItems.splice(i, 1);
      }
    }
  }

  // 玩家攻击怪物
  attackMob(rayOrigin, rayDir, maxDist, damage) {
    let closest = null;
    let closestDist = maxDist;
    for (const mob of this.mobs) {
      if (mob.dead || mob.dyingAnim) continue;
      // 球体射线检测
      const oc = new THREE.Vector3().subVectors(rayOrigin, mob.position);
      const b = oc.dot(rayDir);
      const c = oc.dot(oc) - (mob.height * 0.5) ** 2;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > closestDist) continue;
      closestDist = t;
      closest = mob;
    }
    if (closest) {
      // 直接改血量（不走 Entity.damage 的无敌帧检查，玩家攻击不卡无敌期）
      closest.health -= damage;
      if (closest.health <= 0) {
        closest.health = 0;
        closest.dead = true;
      }
      // 受击红光
      closest.hitFlash = HIT_FLASH_DURATION;
      // 显示头顶血条 + 立即刷新
      if (closest.healthBarSprite) {
        closest.healthBarFadeTimer = HEALTH_BAR_FADE;
        closest.healthBarSprite.visible = true;
        if (closest.healthBarSprite.material) closest.healthBarSprite.material.opacity = 1;
        this._updateHealthBar(closest);
      }
      // 击退（强化版：水平 6.5、上抛 5，更接近原版击退距离）
      closest.knockback.add(rayDir.clone().multiplyScalar(6.5));
      closest.knockback.y = 5;
      return true;
    }
    return false;
  }

  // 仅查找屏幕中央射线命中的最近怪物（不伤害）。返回 { mob, distance } 或 null。
  findMobByRay(rayOrigin, rayDir, maxDist) {
    let closest = null;
    let closestDist = maxDist;
    for (const mob of this.mobs) {
      if (mob.dead || mob.dyingAnim) continue;
      const oc = new THREE.Vector3().subVectors(rayOrigin, mob.position);
      const b = oc.dot(rayDir);
      const c = oc.dot(oc) - (mob.height * 0.5) ** 2;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > closestDist) continue;
      closestDist = t;
      closest = mob;
    }
    return closest ? { mob: closest, distance: closestDist } : null;
  }

  dispose() {
    // 释放每只 mob 的 per-instance 资源（mesh + 血条）
    for (const mob of this.mobs) {
      if (mob.mesh) {
        this.scene.remove(mob.mesh);
        if (mob.mesh.material) mob.mesh.material.dispose();
      }
      if (mob.healthBarSprite) {
        this.scene.remove(mob.healthBarSprite);
        if (mob.healthBarSprite.material) mob.healthBarSprite.material.dispose();
        if (mob.healthBarTex) mob.healthBarTex.dispose();
      }
    }
    // 释放 type 级共享资源（master geometry + master material + skin texture）
    for (const [name, geo] of this.mobGeometries) geo.dispose();
    this.mobGeometries.clear();
    for (const [name, mat] of this.mobMaterials) {
      if (mat.map) mat.map.dispose();
      mat.dispose();
    }
    this.mobMaterials.clear();
    this.mobTextures.clear();
    // 释放掉落物 mesh
    for (const drop of this.droppedItems) {
      if (drop.mesh) {
        this.scene.remove(drop.mesh);
        if (drop.mesh.geometry) drop.mesh.geometry.dispose();
        if (drop.mesh.material) drop.mesh.material.dispose();
      }
    }
    this.mobs = [];
    this.droppedItems = [];
  }
}
