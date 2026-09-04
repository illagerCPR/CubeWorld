// MobManager.js -- 怪物管理：生成/更新/渲染/掉落物
import * as THREE from 'three';
import { Mob } from './Mob.js';
import { MobTypes, generateMobSkinSVGs, mobSkinUV, MOB_ATLAS } from './MobTextures.js';
import { SVGTextures } from '../render/SVGTextures.js';
import { EntityPhysics } from './EntityPhysics.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from '../core/Chunk.js';
import { villagerTradeSeed } from '../world/loot.js';

const MAX_MOBS = 20;
const SPAWN_INTERVAL = 2.5;
const DESPAWN_DISTANCE = 80;

const HIT_FLASH_DURATION = 0.25;   // 怪物受击红光持续时长（秒）
const HEALTH_BAR_FADE = 3.0;       // 怪物头顶血条淡出时长（秒）
const DEATH_ANIM_DURATION = 0.4;   // 死亡缩放动画时长（秒）
const HEALTH_BAR_WIDTH = 1.0;      // 血条世界坐标宽

// 皮肤 atlas 各 face 的 col 索引映射（96×64 atlas：col 4=top，col 5=bottom 独立 cell，
// 不再复用 front/back——此前 top 复用 front cell 导致"脸贴在头顶"）
const FACE_COL = { front: 0, back: 1, left: 2, right: 3, top: 4, bot: 5 };

// 6 个 face 定义：
//   - corners：4 个顶点用 unit-cube [0/1, 0/1, 0/1] 描述，顺序为 [底,顶,底,顶]
//   - uvs：每个 corner 的 [u 选位, v 选位]（0=u0/v0，1=u1/v1）。
//     侧面统一 [[1,0],[1,1],[0,0],[0,1]]：u1 落在"观察者右侧"→ 从外看贴图不镜像；
//     top/bot 用 [[0,0],[1,0],[0,1],[1,1]]：u 随 x、v1 落在 -Z（背面朝上），俯视不镜像。
//     旧写法 `c<2?u0:u1` 把 u0 固定给前两个 corner，4 个侧面全部水平镜像，勿回退。
const SIDE_UVS = [[1, 0], [1, 1], [0, 0], [0, 1]];
const CAP_UVS = [[0, 0], [1, 0], [0, 1], [1, 1]];
const FACE_DEFS = [
  { name: 'right',  corners: [[1,0,0],[1,1,0],[1,0,1],[1,1,1]], uvs: SIDE_UVS }, // +X
  { name: 'left',   corners: [[0,0,1],[0,1,1],[0,0,0],[0,1,0]], uvs: SIDE_UVS }, // -X
  { name: 'top',    corners: [[0,1,1],[1,1,1],[0,1,0],[1,1,0]], uvs: CAP_UVS },  // +Y
  { name: 'bot',    corners: [[0,0,0],[1,0,0],[0,0,1],[1,0,1]], uvs: CAP_UVS },  // -Y
  { name: 'front',  corners: [[1,0,1],[1,1,1],[0,0,1],[0,1,1]], uvs: SIDE_UVS }, // +Z（脸朝向）
  { name: 'back',   corners: [[0,0,0],[0,1,0],[1,0,0],[1,1,0]], uvs: SIDE_UVS }, // -Z
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
    this.getSelfId = null;    // 阶段10：返回本地玩家联机 id（归属锁判定），由 Game 注入；null=单机
    this.mobNet = null;       // 联机怪物事件接口（sendMobSpawn/sendMobAttack/sendMobDied），由 Game 注入
    this.onBlockDestroyed = null; // 爆炸销毁方块回调 (x,y,z,def)，由 Game 注入（碎屑粒子）
    this.spawnedVillages = new Set(); // 已生成村民的村庄锚点 key "ax,az"（本会话去重，死亡不重生）
  }

  // 异步初始化：mob 用私有 skin atlas，不再注入全局 atlas
  async init(svgMap) {
    // no-op：mob 皮肤 atlas 由本类的 buildMaterials 单独构建
  }

  // 构建怪物的 geometry + master material（每 type 的 skin texture 私有）
  async buildMaterials() {
    for (const typeName of Object.keys(MobTypes)) {
      const type = MobTypes[typeName];
      // 1. svg → image → canvas → texture（96×64，每 face 16×16 方形 cell × 6 列）
      const svg = this.mobSkins[typeName];
      const img = await SVGTextures.svgToImage(svg);
      const canvas = document.createElement('canvas');
      canvas.width = MOB_ATLAS.w;
      canvas.height = MOB_ATLAS.h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, MOB_ATLAS.w, MOB_ATLAS.h);
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
            // UV 按每面显式 uvs 表选位（保证从外看不镜像、v1=图像顶部朝上）
            const [us, vs] = fdef.uvs[c];
            uvs.push(us ? uv.u1 : uv.u0, vs ? uv.v1 : uv.v0);
          }
          // 两个三角形使用统一绕序 (0,1,2)(1,3,2)，保证每面两个三角形外法线一致，
          // 否则 computeVertexNormals 会平均出 ~0 法线 → Lambert 方向光失效（"同色纸片"）
          indices.push(idx, idx + 1, idx + 2, idx + 1, idx + 3, idx + 2);
          idx += 4;
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      // 每面顶点不共享 → 生成平坦面法线（每面一个朝向），方向光据此做明暗（立体感关键）
      geo.computeVertexNormals();

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
    // 敌对上限不含村民（村民数量由村庄记录决定，不挤占敌对生成名额）
    let hostileCount = 0;
    for (const m of this.mobs) if (m.typeName !== 'villager') hostileCount++;
    if (hostileCount >= MAX_MOBS) return;

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
    if (this.mobNet) {
      // 联机：host 端生成 → 广播 mob_spawn，实体由广播回执创建（各端同 id 一致）
      this.mobNet.sendMobSpawn(typeName, mob.position.x, mob.position.y, mob.position.z);
    } else {
      this.spawnMob(mob);
    }
  }

  // 由服务器 mob_spawn 广播创建怪物实体（host 权威生成，各端据此创建；去重防重连重复）
  // tradeSeed：T5 村民交易表种子（广播透传；缺省时 spawnMob 内按出生点哈希兜底）
  createMobFromNet(netId, typeName, x, y, z, tradeSeed) {
    if (this.mobs.some(m => m.netId === netId)) return;
    if (!MobTypes[typeName]) return;
    const mob = new Mob(typeName, this.world);
    mob.netId = netId;
    mob.position.set(x, y, z);
    if (typeof tradeSeed === 'number') mob.tradeSeed = tradeSeed >>> 0;
    this.spawnMob(mob);
  }

  findMobByNetId(netId) {
    for (const m of this.mobs) if (m.netId === netId) return m;
    return null;
  }

  // 最近怪物查询（同类型）：敌对索敌村民 / 村民逃敌共用
  findNearestMob(pos, range, typeName) {
    let best = null;
    let bestDist = range;
    for (const m of this.mobs) {
      if (m.dead || m.typeName !== typeName) continue;
      const d = m.position.distanceTo(pos);
      if (d < bestDist) { best = m; bestDist = d; }
    }
    return best;
  }

  // 怪物攻击怪物（僵尸/骷髅咬村民）：伤害+受击反馈+击退；死亡走 update 通用链
  //（mob.dead → diedHandled → sendMobDied 广播 / dropLoot——村民 drops 为空不掉落）
  mobAttackMob(attacker, victim) {
    if (victim.dead) return;
    victim.health -= attacker.attackDamage;
    victim.hitFlash = HIT_FLASH_DURATION;
    if (victim.healthBarSprite) {
      victim.healthBarFadeTimer = HEALTH_BAR_FADE;
      victim.healthBarSprite.visible = true;
      if (victim.healthBarSprite.material) victim.healthBarSprite.material.opacity = 1;
      this._updateHealthBar(victim);
    }
    const dx = victim.position.x - attacker.position.x;
    const dz = victim.position.z - attacker.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.001) {
      victim.knockback.x += (dx / d) * 6;
      victim.knockback.z += (dz / d) * 6;
      victim.knockback.y += 3;
    }
    if (victim.health <= 0) victim.dead = true;
  }

  // 村庄村民生成：就近村庄记录 → 确定性点位（meta.villagerSpawns）生成村民。
  // 单机直接 spawnMob；联机走 mobNet（host 权威广播，实体由回执创建，与 trySpawn 同惯例）。
  // 注意用 recordsAround（按需重求解）而非 recordsNear——后者只读缓存，记录可能被 LRU 挤出。
  updateVillageSpawns(player) {
    if (!this.world || !player) return;
    const sm = this.world.generator && this.world.generator.structureManager;
    if (!sm) return;

    if (this.spawnEnabled) {
      // 生成仅 host/单机：客户端 spawnEnabled=false 跳过（防与 host 广播双生成），
      // 其村民经 mob_spawn 回执创建，home 由下方补挂逻辑本地确定性还原
      const records = sm.recordsAround('village', player.position.x, player.position.z)
        .filter(rec => {
          const dx = Math.max(rec.minX - player.position.x, 0, player.position.x - rec.maxX);
          const dz = Math.max(rec.minZ - player.position.z, 0, player.position.z - rec.maxZ);
          return dx * dx + dz * dz <= 80 * 80;
        });
      for (const rec of records) {
        const key = rec.ax + ',' + rec.az;
        if (this.spawnedVillages.has(key)) continue;
        this.spawnedVillages.add(key);

        const spawns = rec.meta.villagerSpawns || [];
        const houseCount = (rec.meta.houses && rec.meta.houses.length) || 2;
        const count = Math.min(spawns.length, Math.max(2, houseCount));
        for (let i = 0; i < count; i++) {
          const [x, y, z] = spawns[i];
          if (this.mobNet) {
            this.mobNet.sendMobSpawn('villager', x, y + 0.1, z, villagerTradeSeed(rec.ax, rec.az, i));
          } else {
            const mob = new Mob('villager', this.world);
            mob.position.set(x, y + 0.1, z);
            mob.home = { x: rec.ax, z: rec.az, radius: 24 };
            mob.tradeSeed = villagerTradeSeed(rec.ax, rec.az, i); // T5：与广播一致，两端同表
            this.spawnMob(mob);
          }
        }
      }
    }

    // 随村清扫：村庄卸载（玩家离开 ~120 格）→ 其村民一并移除并解除生成标记，
    // 回村时随区块重载重新生成（村庄生命周期 = 区块生命周期）
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if (m.typeName !== 'villager' || !m.home) continue;
      const hd = Math.hypot(m.home.x - player.position.x, m.home.z - player.position.z);
      if (hd > 120) {
        this._removeMobResources(m);
        this.mobs.splice(i, 1);
        this.spawnedVillages.delete(m.home.x + ',' + m.home.z);
      }
    }

    // 远端创建的村民补挂 home（mob_spawn 回执创建时村庄记录可能尚未缓存；记录确定性一致，
    // 各端最终收敛到同一锚点）
    if (this.mobs.length > 0) {
      const nearRecs = sm.recordsAround('village', player.position.x, player.position.z);
      for (const m of this.mobs) {
        if (m.typeName !== 'villager' || m.home || m.dead) continue;
        const rec = nearRecs.find(r =>
          Math.hypot(r.ax - m.position.x, r.az - m.position.z) < 96);
        if (rec) m.home = { x: rec.ax, z: rec.az, radius: 24 };
      }
    }
  }

  // 其它端攻击：本端同步扣血 + 受击反馈 + 位置校正（减少各端 AI 漂移）
  applyRemoteMobAttack(netId, damage, x, y, z) {
    const mob = this.findMobByNetId(netId);
    if (!mob || mob.dead) return;
    mob.health = Math.max(0, mob.health - damage);
    mob.hitFlash = HIT_FLASH_DURATION;
    // 血条显示 + 立即刷新
    if (mob.healthBarSprite) {
      mob.healthBarFadeTimer = HEALTH_BAR_FADE;
      mob.healthBarSprite.visible = true;
      if (mob.healthBarSprite.material) mob.healthBarSprite.material.opacity = 1;
      this._updateHealthBar(mob);
    }
    // 位置校正：向攻击者端位置对齐
    mob.position.set(x, y, z);
    if (mob.health <= 0) {
      mob.dead = true;
      // 远端攻击致死：死亡广播与掉落由攻击端负责，本端只播死亡动画
      mob.diedHandled = true;
      mob.remoteDeath = true;
    }
  }

  // 击杀端广播 mob_died：本端同步死亡（不产掉落、不重复广播）
  applyRemoteMobDeath(netId) {
    const mob = this.findMobByNetId(netId);
    if (!mob || mob.dead) return;
    mob.dead = true;
    mob.diedHandled = true;
    mob.remoteDeath = true;
  }

  spawnMob(mob) {
    const geo = this.mobGeometries.get(mob.typeName);
    const mat = this.mobMaterials.get(mob.typeName);
    if (!geo || !mat) return;

    // T5：村民交易种子兜底（正常路径已在生成处赋值；此为旧广播/命令面板生成村民的兜底）
    if (mob.typeName === 'villager' && mob.tradeSeed == null) {
      mob.tradeSeed = villagerTradeSeed(Math.floor(mob.position.x), Math.floor(mob.position.z), 0);
    }

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

    // 村庄村民生成（host/单机权威；去重由 spawnedVillages 保证，村民死亡本会话不重生）
    this.updateVillageSpawns(player);

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
          this._removeMobResources(mob);
          this.mobs.splice(i, 1);
        }
        continue;
      }

      // 普通帧
      mob.update(dt, player, sky, this.physics, this);

      // 体素光染色：按怪物所在格光照（max(天光×昼夜, 方块光)）调制 material 颜色，
      // 洞穴里变暗、火把旁带暖色；受击/死亡的 emissive 反馈走独立通道不冲突
      if (mob.mesh && mob.mesh.material && this.world) {
        const p = mob.mesh.position;
        const bx = Math.floor(p.x), by = Math.floor(p.y + 0.5), bz = Math.floor(p.z);
        const skyL = this.world.getSkyLight(bx, by, bz) / 15;
        const blkL = this.world.getBlockLightAt(bx, by, bz) / 15;
        const day = 0.10 + 0.90 * (sky ? sky.getLightLevel() : 1);
        const l = Math.max(skyL * day, blkL);
        const v = 0.55 + 0.45 * l;
        mob.mesh.material.color.setRGB(v * (1 + 0.18 * blkL), v, v * (1 - 0.10 * blkL));
      }

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

      // 死亡：击杀端产出掉落 + 广播；触发死亡动画（而非立刻移除）
      const dist = mob.position.distanceTo(player.position);
      if (mob.dead) {
        if (!mob.diedHandled) {
          mob.diedHandled = true; // 只处理一次（防多端重复广播/重复掉落）
          if (mob.netId != null && this.mobNet) this.mobNet.sendMobDied(mob.netId);
          if (!mob.remoteDeath) this.dropLoot(mob); // 击杀端（本地死亡）才产掉落；远端死亡由击杀端产出
        }
        mob.dyingAnim = { progress: 0, total: DEATH_ANIM_DURATION };
        if (mob.healthBarSprite) mob.healthBarSprite.visible = false;
      } else if (dist > DESPAWN_DISTANCE && mob.typeName !== 'villager') {
        // 被卸载而非死亡：直接清理（村民不在此清理——村庄绑定生物由 updateVillageSpawns
        // 的随村清扫管理，否则逃敌被拖远会掏空村庄）
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
                if (this.onBlockDestroyed) this.onBlockDestroyed(bx, by, bz, def); // 碎屑粒子出口（Game 注入）
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
  // 阶段10：owner/ownerLockMs = 死亡掉落归属锁（锁定期内仅 owner 本人可拾取）
  spawnRemoteDrop(id, x, y, z, name, count, owner = null, ownerLockMs = 0) {
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
      owner: owner || null,
      lockedUntil: owner && ownerLockMs > 0 ? Date.now() + ownerLockMs : 0,
    };
    this._createDropMesh(drop);
    this.droppedItems.push(drop);
  }

  // 阶段10：记录本地已发起拾取的远程掉落物（全量拾取并已上报 drop_taken 的）
  // 服务器归属锁拒绝（drop_deny）时凭此记录从背包扣回，配合补发 drop_spawn 重建实体
  recordPendingPickup(id, name, count) {
    if (!this._pendingPickup) this._pendingPickup = new Map();
    this._pendingPickup.set(id, { name, count });
    if (this._pendingPickup.size > 64) {
      // 防御性清理：只保留最近 32 条
      const keys = [...this._pendingPickup.keys()].slice(0, this._pendingPickup.size - 32);
      for (const k of keys) this._pendingPickup.delete(k);
    }
  }

  // 阶段10：取回并删除拾取记录（deny 回滚用；无记录返回 null）
  takePendingPickup(id) {
    if (!this._pendingPickup) return null;
    const info = this._pendingPickup.get(id) || null;
    this._pendingPickup.delete(id);
    return info;
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
        // 阶段10：死亡掉落归属锁——锁定期内仅 owner 本人可拾取（服务器侧同校验兜底）
        const selfId = this.getSelfId ? this.getSelfId() : null;
        if (drop.lockedUntil && Date.now() < drop.lockedUntil && drop.owner !== selfId) continue;
        if (this.onPickup) {
          // onPickup 返回未放入的剩余数量（0 = 全部拾取）
          const remaining = this.onPickup(drop.name, drop.count);
          drop.count = remaining;
          if (remaining <= 0) {
            // 全部拾取
            if (drop.mesh) this.scene.remove(drop.mesh);
            this.droppedItems.splice(i, 1);
            if (drop.id != null && this.onDropTaken) {
              this.recordPendingPickup(drop.id, drop.name, drop.count); // 阶段10：留档供 deny 回滚
              this.onDropTaken(drop.id); // 联机：通知服务器移除
            }
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
      // 联机：上报攻击事件（含位置校正），其它端同步扣血/受击/对齐位置
      if (closest.netId != null && this.mobNet) {
        this.mobNet.sendMobAttack(closest.netId, damage, closest.position.x, closest.position.y, closest.position.z);
      }
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
    this._pendingPickup = new Map(); // 阶段10：拾取留档随世界销毁一并清空
  }
}
