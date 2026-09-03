// Panorama.js -- 主菜单原版式全景背景
// 独立 scene/camera + 固定种子小型世界，菜单可见时用共享 WebGLRenderer 渲染；
// Game.loop 在 !running 时整条停摆，这里用自持 rAF 补上菜单帧。
// 生命周期：app 级单例（同 Game），开局 setActive(false) 即停渲染并清除画布模糊，回菜单恢复。
// 注意：菜单期体素光共享 uniform 由这里驱动（固定早上），避免沿用上一局深夜亮度把菜单压黑。
import * as THREE from 'three';
import { World } from '../core/World.js';
import { ChunkMeshBuilder } from './ChunkMesh.js';
import { Sky } from './Sky.js';
import { SVGTextures } from './SVGTextures.js';
import { BlockSVGDefinitions } from '../blocks/BlockDefs.js';
import { ItemSVGDefinitions } from '../items/ItemDefs.js';
import { VoxelLightUniforms } from './VoxelLight.js';

const PANO_RADIUS = 3;        // 全景世界半径（区块），固定不随渲染距离设置变化
const PANO_SEED = 20250903;   // 固定种子：菜单每次长得一样
const SPIN_SPEED = 0.04;      // 相机转速 rad/s（约 2.6 分钟一圈）

export class Panorama {
  constructor(game) {
    this.game = game;
    this.renderer = game.renderer;
    this.active = true;          // 菜单可见时 true（main.js 经 MenuScreen.onShow/onHide 切换）
    this.ready = false;
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.rotation.order = 'YXZ';
    this.yaw = 0;
    this.pitch = -0.24;          // 微微俯视地平线
    this.scene = new THREE.Scene();
    this.sky = new Sky(this.scene);  // Sky 构造时给 scene 挂雾，update 时同步天空色
    // 全景雾拉远：默认 far=160 会把半径 3 区块的小世界整个泡进雾里（灰蒙蒙一片）
    if (this.scene.fog) { this.scene.fog.near = 70; this.scene.fog.far = 280; }
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
      const coords = [];
      for (let dx = -PANO_RADIUS; dx <= PANO_RADIUS; dx++) {
        for (let dz = -PANO_RADIUS; dz <= PANO_RADIUS; dz++) {
          coords.push([dx, dz]);
        }
      }
      coords.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]));
      // 全部建完再 ready（无头软渲染帧率低，按帧预算会露出半成品世界）；
      // 生成/建网格是同步重活，定期让出主线程避免卡死页面
      let i = 0;
      for (const [cx, cz] of coords) {
        this.world.ensureChunk(cx, cz);
        if (++i % 4 === 0) await new Promise(r => setTimeout(r, 0));
      }
      for (const [, chunk] of this.world.chunks) {
        this._buildChunkMeshes(chunk);
        if (++i % 4 === 0) await new Promise(r => setTimeout(r, 0));
      }
      const h = this.world.getHeightAt(Math.floor(this.center.x), Math.floor(this.center.z));
      this.center.y = h + 14;
      this.camera.position.copy(this.center);
      this.ready = true;
    } catch (e) {
      console.error('[Panorama] 全景世界构建失败（菜单退回渐变底色）:', e);
    }
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
    this.renderer.domElement.style.filter = on ? 'blur(5px) brightness(0.85)' : '';
  }

  setActive(v) {
    this.active = v;
    if (!v) this._setCanvasFilter(false);
  }
}
