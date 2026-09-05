// ParticleSystem.js -- 粒子系统（方块破坏碎屑 / 燃烧火焰 / 烟）
// THREE.Points + 顶点色方案：方块碎屑在生成时从图集 canvas 采样真实贴图像素色，
// 火焰/烟用程序化火色板；亮度按生成点体素光衰减（洞穴碎屑不发亮）。
// 对象池 swap-with-last 压缩，无逐帧分配。densityScale 供视频设置调节发射量。
import * as THREE from 'three';
import { VoxelLightUniforms } from './VoxelLight.js';

const TILE = 16; // 图集 cell 尺寸（TEX_SIZE）

// 火焰色板：亮黄核心 → 橙 → 暗红（按寿命插值）
const FIRE_A = [1.0, 0.92, 0.35];
const FIRE_B = [0.95, 0.45, 0.05];

// 传送门粒子色板（暗 → 亮双色随机插值；自发光不做体素光衰减；亮端高于门幕底色保证可见）
const PORTAL_TINTS = {
  nether_portal: [[0.72, 0.35, 1.00], [1.00, 0.88, 1.00]],
  aether_portal: [[1.00, 0.95, 0.70], [1.00, 1.00, 1.00]],
  end_portal: [[0.45, 0.95, 0.70], [0.85, 1.00, 0.95]],
  end_gateway: [[0.85, 0.75, 1.00], [1.00, 1.00, 1.00]],
};

export class ParticleSystem {
  // size: 点精灵世界尺寸；atlasTexture.image 为图集 canvas（取色源）
  constructor(scene, atlasTexture, atlasUV, size = 0.12, maxParticles = 1600) {
    this.scene = scene;
    this.atlasTexture = atlasTexture;
    this.atlasUV = atlasUV;
    this.max = maxParticles;
    this.count = 0;
    this.densityScale = 1; // 视频设置：1=全部 / 0.5=减少 / 0.15=最少

    this.pos = new Float32Array(maxParticles * 3);
    this.col = new Float32Array(maxParticles * 3);
    this.vel = new Float32Array(maxParticles * 3);
    this.life = new Float32Array(maxParticles);
    this.maxLife = new Float32Array(maxParticles);
    this.grav = new Float32Array(maxParticles);
    this.drag = new Float32Array(maxParticles);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.PointsMaterial({ size, vertexColors: true, sizeAttenuation: true });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);

    this._tileCache = new Map(); // 纹理名 -> Uint8ClampedArray 像素
    this._scratch = new THREE.Color();
  }

  dispose() {
    this.scene.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
    this._tileCache.clear();
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); this.points.visible = false; }

  // 读取某纹理 cell 的像素数据（缓存）
  _tilePixels(texName) {
    let px = this._tileCache.get(texName);
    if (px) return px;
    const canvas = this.atlasTexture && this.atlasTexture.image;
    const uv = this.atlasUV && this.atlasUV.get(texName);
    if (!canvas || !uv) return null;
    const ctx = canvas.getContext('2d');
    const sx = Math.floor(uv.u0 * canvas.width);
    const sy = Math.floor((1 - uv.v1) * canvas.height);
    try {
      px = ctx.getImageData(sx, sy, TILE, TILE).data;
    } catch { return null; }
    this._tileCache.set(texName, px);
    return px;
  }

  // 生成点处的体素光亮度（与区块着色同式），碎屑在暗处不发亮
  _lightAt(x, y, z, world) {
    if (!world) return 1;
    const sky = world.getSkyLight(Math.floor(x), Math.floor(y), Math.floor(z)) / 15;
    const blk = world.getBlockLightAt(Math.floor(x), Math.floor(y), Math.floor(z)) / 15;
    const u = VoxelLightUniforms;
    const day = u.uDayLight.value;
    const t = u.uSunTint.value, tor = u.uTorchTint.value, m = u.uMinLight.value;
    const sr = Math.max(t.r * sky * day, tor.r * blk);
    const sg = Math.max(t.g * sky * day, tor.g * blk);
    const sb = Math.max(t.b * sky * day, tor.b * blk);
    return Math.max(m, m + (1 - m) * Math.max(sr, Math.max(sg, sb))) * 1.15;
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, life, grav, dragF) {
    if (this.count >= this.max) return; // 池满丢弃（视觉可接受）
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = dragF;
  }

  // 方块破坏爆发：从 def 侧面贴图采样 n 个像素色，向外抛洒
  burstBlockBreak(x, y, z, def, world, n = 20) {
    const count = Math.max(2, Math.round(n * this.densityScale));
    const px = this._tilePixels(def.top || def.name) || this._tilePixels(def.name);
    const light = this._lightAt(x, y + 0.5, z, world);
    for (let k = 0; k < count; k++) {
      let r = 0.6, g = 0.6, b = 0.6;
      if (px) {
        const pi = ((Math.random() * TILE) | 0) * TILE + ((Math.random() * TILE) | 0);
        r = px[pi * 4] / 255; g = px[pi * 4 + 1] / 255; b = px[pi * 4 + 2] / 255;
      }
      const vx = (Math.random() - 0.5) * 5;
      const vy = Math.random() * 4.5 + 1.5;
      const vz = (Math.random() - 0.5) * 5;
      this.spawn(
        x + (Math.random() - 0.5) * 0.7, y + Math.random() * 0.7, z + (Math.random() - 0.5) * 0.7,
        vx, vy, vz,
        Math.min(1, r * light), Math.min(1, g * light), Math.min(1, b * light),
        0.45 + Math.random() * 0.35, -13, 0.985
      );
    }
  }

  // 挖掘中小碎粒（进度中每 0.25s 蹦一两粒）
  puffMining(x, y, z, def, world, n = 2) {
    const count = Math.max(1, Math.round(n * this.densityScale));
    const px = this._tilePixels(def.top || def.name) || this._tilePixels(def.name);
    const light = this._lightAt(x, y + 0.5, z, world);
    for (let k = 0; k < count; k++) {
      let r = 0.6, g = 0.6, b = 0.6;
      if (px) {
        const pi = ((Math.random() * TILE) | 0) * TILE + ((Math.random() * TILE) | 0);
        r = px[pi * 4] / 255; g = px[pi * 4 + 1] / 255; b = px[pi * 4 + 2] / 255;
      }
      this.spawn(
        x + (Math.random() - 0.5) * 0.8, y + Math.random() * 0.8, z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 2, Math.random() * 2 + 0.5, (Math.random() - 0.5) * 2,
        Math.min(1, r * light), Math.min(1, g * light), Math.min(1, b * light),
        0.3 + Math.random() * 0.25, -13, 0.99
      );
    }
  }

  // 传送门环境粒子（M3）：方块格内随机飘动上浮，自发光（夜里也可见）
  portalAmbient(bx, by, bz, name) {
    const tint = PORTAL_TINTS[name] || [[0.8, 0.5, 0.95], [1, 1, 1]];
    const n = Math.max(1, Math.round(2 * this.densityScale));
    for (let k = 0; k < n; k++) {
      const t = Math.random();
      const r = tint[0][0] + (tint[1][0] - tint[0][0]) * t;
      const g = tint[0][1] + (tint[1][1] - tint[0][1]) * t;
      const b = tint[0][2] + (tint[1][2] - tint[0][2]) * t;
      this.spawn(
        bx + 0.15 + Math.random() * 0.7, by + 0.15 + Math.random() * 0.7, bz + 0.15 + Math.random() * 0.7,
        (Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4,
        r, g, b, 0.6 + Math.random() * 0.8, 0.15, 0.96
      );
    }
  }

  // 火焰（沿包围盒上升）+ 偶发烟（火焰系统用，不做体素光衰减——火焰自身发光）
  flameBox(cx, cy, cz, w, h, d, withSmoke = true) {
    const n = Math.max(1, Math.round((withSmoke ? 2 : 1) * this.densityScale));
    for (let k = 0; k < n; k++) {
      const t = Math.random();
      const r = FIRE_A[0] + (FIRE_B[0] - FIRE_A[0]) * t;
      const g = FIRE_A[1] + (FIRE_B[1] - FIRE_A[1]) * t;
      const b = FIRE_A[2] + (FIRE_B[2] - FIRE_A[2]) * t;
      this.spawn(
        cx + (Math.random() - 0.5) * w, cy + Math.random() * h, cz + (Math.random() - 0.5) * d,
        (Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4,
        r, g, b, 0.35 + Math.random() * 0.3, 1.8, 0.92
      );
    }
    if (withSmoke && Math.random() < 0.35 * this.densityScale) {
      this.spawn(
        cx + (Math.random() - 0.5) * w, cy + h * 0.8, cz + (Math.random() - 0.5) * d,
        (Math.random() - 0.5) * 0.3, 1.5 + Math.random(), (Math.random() - 0.5) * 0.3,
        0.25, 0.25, 0.25, 0.8 + Math.random() * 0.5, 1.2, 0.96
      );
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-with-last 压缩
        const last = --this.count;
        if (i !== last) {
          for (let c = 0; c < 3; c++) {
            this.pos[i * 3 + c] = this.pos[last * 3 + c];
            this.col[i * 3 + c] = this.col[last * 3 + c];
            this.vel[i * 3 + c] = this.vel[last * 3 + c];
          }
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.grav[i] = this.grav[last];
          this.drag[i] = this.drag[last];
        }
        continue; // 不递增，检查换过来的粒子
      }
      const drag = Math.pow(this.drag[i], dt * 60);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + this.grav[i] * dt;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      // 末段淡出（写回颜色属性）
      const fade = Math.min(1, this.life[i] / (this.maxLife[i] * 0.4));
      const base = (i * 3);
      this.geo.attributes.color.array[base] = this.col[base] * fade;
      this.geo.attributes.color.array[base + 1] = this.col[base + 1] * fade;
      this.geo.attributes.color.array[base + 2] = this.col[base + 2] * fade;
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.points.visible = this.count > 0;
  }
}
