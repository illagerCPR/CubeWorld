// Panorama.js -- 主菜单原版式全景背景
// 独立 scene/camera + 固定种子小型世界，菜单可见时用共享 WebGLRenderer 渲染；
// Game.loop 在 !running 时整条停摆，这里用自持 rAF 补上菜单帧。
// 生命周期：app 级单例（同 Game），开局 setActive(false) 即停渲染并清除画布模糊，回菜单恢复。
// 注意：菜单期体素光共享 uniform 由这里驱动（固定早上），避免沿用上一局深夜亮度把菜单压黑。
import * as THREE from 'three';
import { World } from '../core/World.js';
import { CHUNK_SIZE } from '../core/Chunk.js';
import { ChunkMeshBuilder } from './ChunkMesh.js';
import { Sky } from './Sky.js';
import { SVGTextures } from './SVGTextures.js';
import { BlockSVGDefinitions } from '../blocks/BlockDefs.js';
import { ItemSVGDefinitions } from '../items/ItemDefs.js';
import { VoxelLightUniforms } from './VoxelLight.js';

const PANO_RADIUS = 5;        // 全景世界半径（区块），固定不随渲染距离设置变化
const PANO_SEED = 20250903;   // 固定种子：菜单每次长得一样
const SPIN_SPEED = 0.04;      // 相机转速 rad/s（约 2.6 分钟一圈）
const CAMERA_ABOVE = 12;      // 相机高于机位基准面
const CAMERA_PITCH = -0.36;    // 俯视角（rad）

export class Panorama {
  constructor(game) {
    this.game = game;
    this.renderer = game.renderer;
    this.active = true;          // 菜单可见时 true（main.js 经 MenuScreen.onShow/onHide 切换）
    this.ready = false;
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.rotation.order = 'YXZ';
    this.yaw = 0;
    this.pitch = CAMERA_PITCH;   // 俯视地平线
    this.scene = new THREE.Scene();
    this.sky = new Sky(this.scene);  // Sky 构造时给 scene 挂雾，update 时同步天空色
    // 全景雾拉远：默认 far=160 会把半径 3 区块的小世界整个泡进雾里（灰蒙蒙一片）
    if (this.scene.fog) { this.scene.fog.near = 30; this.scene.fog.far = 90; } // 雾在边缘前收掉：地形远端融进天色，露出±80格的世界边缘
    this.sky.time = 0.4;         // 固定上午光线
    this.center = new THREE.Vector3(8, 90, 8);
    this._last = performance.now();
    this._filtered = false;
    this._build();
    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
  }

  // 异步铺底：图集/水体纹理 → 世界 → 区块坐标队列（按离中心距离排序，从脚下向外生长）
  async _build() {
    try {
      const allSvgs = { ...BlockSVGDefinitions, ...ItemSVGDefinitions };
      const { atlasTexture, atlasUV } = await SVGTextures.buildAtlas(allSvgs);
      const waterTexture = await SVGTextures.buildRepeatTexture(allSvgs['water'] || '', 'water');
      this.world = new World(PANO_SEED);
      this.builder = new ChunkMeshBuilder(this.world, atlasTexture, atlasUV, waterTexture);
      // 先把全部数据区块生成好（机位评估需要真实地表数据；此时不建 mesh）
      const cands = this._pickVantage();
      const chunkSet = new Set();
      for (const cand of cands) {
        const cx0 = Math.floor(cand.x / CHUNK_SIZE), cz0 = Math.floor(cand.z / CHUNK_SIZE);
        for (let dx = -PANO_RADIUS; dx <= PANO_RADIUS; dx++) {
          for (let dz = -PANO_RADIUS; dz <= PANO_RADIUS; dz++) {
            chunkSet.add((cx0 + dx) + ',' + (cz0 + dz));
          }
        }
      }
      let i = 0;
      for (const key of chunkSet) {
        const [cx, cz] = key.split(',').map(Number);
        this.world.ensureChunk(cx, cz);
        if (++i % 4 === 0) await new Promise(r => setTimeout(r, 0));
      }
      // 全局地表扫描缓存（step 3）：供机位评估用
      const minX = Math.min(...cands.map(c => c.x)) - PANO_RADIUS * CHUNK_SIZE;
      const maxX = Math.max(...cands.map(c => c.x)) + PANO_RADIUS * CHUNK_SIZE;
      const minZ = Math.min(...cands.map(c => c.z)) - PANO_RADIUS * CHUNK_SIZE;
      const maxZ = Math.max(...cands.map(c => c.z)) + PANO_RADIUS * CHUNK_SIZE;
      const surf = new Map();
      for (let x = minX; x <= maxX; x += 3) {
        for (let z = minZ; z <= maxZ; z += 3) {
          surf.set(x + ',' + z, this._surfaceTop(x, z));
        }
        if ((x / 3) % 8 === 0) await new Promise(r => setTimeout(r, 0));
      }
      const topAt = (x, z) => {
        let best = null, bd = 1e9;
        for (let dx = -3; dx <= 3; dx += 3) {
          for (let dz = -3; dz <= 3; dz += 3) {
            const k = (x + dx) + ',' + (z + dz);
            const s = surf.get(k);
            if (s) { const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = s; } }
          }
        }
        return best || { y: 66, name: '' };
      };
      // 机位评估：近景（±8）平整 + 雪占比低；并记录雪质心方向（初始朝向避开雪山）
      let snowN = 0;
      for (const [, s] of surf) {
        if (s.name === 'snow_layer' || s.name === 'snow' || s.name === 'ice') snowN++;
      }
      let v = null;
      for (const cand of cands) {
        let minTop = 999, maxTop = 0, snow = 0, n = 0;
        for (let dx = -8; dx <= 8; dx += 3) {
          for (let dz = -8; dz <= 8; dz += 3) {
            const t = topAt(cand.x + dx, cand.z + dz);
            minTop = Math.min(minTop, t.y); maxTop = Math.max(maxTop, t.y);
            n++;
            if (t.name === 'snow_layer' || t.name === 'snow' || t.name === 'ice') snow++;
          }
        }
        if (minTop >= 62 && maxTop - minTop <= 6 && snow * 3 < n) { v = cand; v.top = maxTop; break; }
      }
      if (!v) v = { ...cands[0], top: topAt(cands[0].x, cands[0].z).y };
      // 初始朝向：背对全球雪地质心方向（旋转到雪山前有约半圈好风景）
      let snowCx = 0, snowCz = 0;
      for (const [k, s] of surf) {
        if (s.name === 'snow_layer' || s.name === 'snow' || s.name === 'ice') {
          const [sx, sz] = k.split(',').map(Number);
          snowCx += sx; snowCz += sz;
        }
      }
      if (snowN > 0) {
        snowCx /= snowN; snowCz /= snowN;
        this.yaw = Math.atan2(v.x - snowCx, v.z - snowCz); // 朝向远离雪质心
      }
      // 兜底 ensure：确保机位周边完整覆盖（chunkSet 已含全部候选 ±5，正常此处已齐）
      const cx0 = Math.floor(v.x / CHUNK_SIZE), cz0 = Math.floor(v.z / CHUNK_SIZE);
      for (let dx = -PANO_RADIUS; dx <= PANO_RADIUS; dx++) {
        for (let dz = -PANO_RADIUS; dz <= PANO_RADIUS; dz++) {
          this.world.ensureChunk(cx0 + dx, cz0 + dz);
        }
      }
      // 全部建完再 ready（无头软渲染帧率低，按帧预算会露出半成品世界）；
      // 生成/建网格是同步重活，定期让出主线程避免卡死页面
      for (const [, chunk] of this.world.chunks) {
        this._buildChunkMeshes(chunk);
        if (++i % 4 === 0) await new Promise(r => setTimeout(r, 0));
      }
      // 相机架在实测最高点（含树冠）上方：俯瞰草地/水面，四周地形充满画面（原版全景观感）
      let top = v.top;
      for (let dx = -5; dx <= 5; dx += 2) {
        for (let dz = -5; dz <= 5; dz += 2) {
          top = Math.max(top, this._surfaceTop(v.x + dx, v.z + dz).y);
        }
      }
      this.center.set(v.x + 0.5, top + 8, v.z + 0.5);
      this.camera.position.copy(this.center);
      this.ready = true;
    } catch (e) {
      console.error('[Panorama] 全景世界构建失败（菜单退回渐变底色）:', e);
    }
  }

  // 自上而下找第一格非空气（实际地表，含树/植被/雪层）
  _surfaceTop(x, z) {
    for (let y = 110; y > 30; y--) {
      const id = this.world.getBlock(x, y, z);
      if (id !== 0) return { y, name: (BlockRegistry.getById(id) || {}).name || '' };
    }
    return { y: 40, name: '' };
  }

  // 找开阔机位候选（按优先级排序）：baseHeight 在陆地范围、四向 12 格同为陆地且高差小；
  // 只在半径 ≤16 内找（全景世界半径 5 区块 = ±80，机位太偏会看到世界边缘外）
  _pickVantage() {
    const g = this.world.generator;
    const probe = [[12, 0], [-12, 0], [0, 12], [0, -12]];
    const cands = [];
    for (let r = 0; r <= 16; r += 4) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos((a / 16) * Math.PI * 2) * r);
        const z = Math.round(Math.sin((a / 16) * Math.PI * 2) * r);
        const h = g.getBaseHeight(x, z);
        if (h < 64 || h > 72) continue;
        let ok = true, minH = h, maxH = h;
        for (const [dx, dz] of probe) {
          const hh = g.getBaseHeight(x + dx, z + dz);
          if (hh < 63) { ok = false; break; }
          minH = Math.min(minH, hh); maxH = Math.max(maxH, hh);
        }
        if (ok && maxH - minH <= 6) cands.push({ x, z, h });
      }
    }
    if (!cands.length) cands.push({ x: 8, z: 8, h: g.getBaseHeight(8, 8) });
    return cands;
  }

  // 建单个区块的三件套 mesh（solid/water/light）并挂到全景场景
  _buildChunkMeshes(chunk) {
    for (const key of ['mesh', 'waterMesh', 'lightMesh']) {
      if (chunk[key]) { this.scene.remove(chunk[key]); chunk[key].geometry.dispose(); chunk[key] = null; }
    }
    const meshes = this.builder.build(chunk);
    if (meshes.solid) { chunk.mesh = meshes.solid; this.scene.add(meshes.solid); }
    if (meshes.water) { chunk.waterMesh = meshes.water; this.scene.add(meshes.water); }
    if (meshes.light) { chunk.lightMesh = meshes.light; this.scene.add(meshes.light); }
    chunk.dirty = false;
  }

  _tick() {
    requestAnimationFrame(this._tick);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;

    if (!this.ready) return;
    if (!this.active || this.game.running) { this._setCanvasFilter(false); return; }

    // 相机绕中心慢速自旋
    this.yaw = (this.yaw + dt * SPIN_SPEED) % (Math.PI * 2);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.position.copy(this.center);

    // 纵横比跟随窗口
    const w = window.innerWidth, h = window.innerHeight;
    if (Math.abs(this.camera.aspect - w / h) > 1e-3) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    // 天空推进 + 体素光共享 uniform（菜单期间由全景接管）
    this.sky.update(dt, this.camera.position);
    VoxelLightUniforms.uDayLight.value = 0.10 + 0.90 * this.sky.getLightLevel();
    VoxelLightUniforms.uSunTint.value.copy(this.sky.sunTint);

    this._setCanvasFilter(true);
    this.renderer.render(this.scene, this.camera);
  }

  // 全景激活时画布加模糊压暗（原版 MC 全景质感），游戏期必须清掉
  _setCanvasFilter(on) {
    if (this._filtered === on) return;
    this._filtered = on;
    this.renderer.domElement.style.filter = on ? 'blur(4px) brightness(0.9)' : '';
  }

  setActive(v) {
    this.active = v;
    if (!v) this._setCanvasFilter(false);
  }
}
