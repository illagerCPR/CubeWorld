// Panorama.js -- 主菜单全景背景播放器（预烘焙六面天空盒）
// 播放 res/panorama/ 六面 90° 贴图：BoxGeometry(BackSide) 内壁 + 盒体自转（原版式旋转）+ 动态云层叠加。
// 烘焙入口见 PanoramaBake.js（?bake-panorama=1）。生命周期：app 级单例，game.running 时早退停渲染并清除画布模糊。
import * as THREE from 'three';
import { makeCloudTexture } from './Sky.js';
import pxImg from '../../res/panorama/px.jpg';
import nxImg from '../../res/panorama/nx.jpg';
import pyImg from '../../res/panorama/py.jpg';
import nyImg from '../../res/panorama/ny.jpg';
import pzImg from '../../res/panorama/pz.jpg';
import nzImg from '../../res/panorama/nz.jpg';

const SPIN_SPEED = 0.045;      // 全景球自转 rad/s（约 2.3 分钟一圈）
const CLOUD_DRIFT = 0.006;     // 云层漂移速度（纹理 offset/秒）

const FACE_SRCS = [pxImg, nxImg, pyImg, nyImg, pzImg, nzImg]; // CubeTexture 面序: px nx py ny pz nz

export class Panorama {
  constructor(game) {
    this.game = game;
    // 必须取底层 THREE.WebGLRenderer：game.renderer 是 Renderer 包装类，
    // 其 render() 无参且固定渲染游戏场景——传 (scene, camera) 会被静默忽略导致菜单白屏
    this.renderer = game.renderer.renderer;
    this.active = true;          // 菜单可见时 true（main.js 经 MenuScreen.onShow/onHide 切换）
    this.ready = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200);
    this._last = performance.now();
    this._filtered = false;
    this._wind = 0;

    // 天空盒：六面贴图内壁（拍摄端 90°/面对齐，天然无缝），盒体自转产生全景旋转
    // 从盒内看各水平面贴图水平镜像（BoxGeometry UV 约定），拍摄帧为正常透视 → flipH 校正
    this.faceTex = {};
    this.box = new THREE.Mesh(
      new THREE.BoxGeometry(160, 160, 160),
      ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map(name => {
        const tex = new THREE.Texture();
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        if (name !== 'py' && name !== 'ny') { // 水平面：内壁左右镜像校正
          tex.wrapS = THREE.RepeatWrapping;
          tex.repeat.x = -1;
        } else { // 天/地面：内外上下颠倒，旋转 180° 校正
          tex.center.set(0.5, 0.5);
          tex.rotation = Math.PI;
        }
        this.faceTex[name] = tex;
        return new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, depthWrite: false, fog: false });
      })
    );
    this.box.renderOrder = -1;
    this.scene.add(this.box);

    // 动态云层：相机上方平面，纹理缓慢漂移（给静态全景找回"活"感）
    this.cloudTex = makeCloudTexture();
    this.cloudTex.wrapS = this.cloudTex.wrapT = THREE.RepeatWrapping;
    this.cloudTex.magFilter = THREE.NearestFilter;
    this.cloudTex.repeat.set(6, 6);
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(360, 360),
      new THREE.MeshBasicMaterial({
        map: this.cloudTex, transparent: true, opacity: 0.5,
        depthWrite: false, fog: false
      })
    );
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = 30;
    this.scene.add(this.clouds);

    this._load();
    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
  }

  async _load() {
    try {
      const names = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
      await Promise.all(FACE_SRCS.map((src, i) => new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => { this.faceTex[names[i]].image = im; this.faceTex[names[i]].needsUpdate = true; resolve(); };
        im.onerror = () => reject(new Error('加载失败: ' + src));
        im.src = src;
      })));
      this.ready = true;
    } catch (e) {
      console.error('[Panorama] 全景贴图加载失败（菜单退回渐变底色）:', e);
    }
  }

  _tick() {
    requestAnimationFrame(this._tick);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this._last) / 1000);
    this._last = now;

    if (!this.ready) return;
    if (!this.active || this.game.running) { this._setCanvasFilter(false); return; }

    // 纵横比跟随窗口
    const w = window.innerWidth, h = window.innerHeight;
    if (Math.abs(this.camera.aspect - w / h) > 1e-3) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    // 天空盒自转 + 云层漂移
    this.box.rotation.y += dt * SPIN_SPEED;
    this._wind += dt * CLOUD_DRIFT;
    this.cloudTex.offset.set(this._wind % 1, (this._wind * 0.6) % 1);

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
