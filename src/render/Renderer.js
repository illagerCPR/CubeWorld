// Renderer.js -- Three.js 渲染器封装
// render() 无参：游戏场景固定走 scene/camera；"完整"光照增强档切换到 PostFX 后处理链，
// 其余档位直渲（现状行为）。主菜单全景自持渲染循环直接用底层 renderer，不经此封装。
import * as THREE from 'three';
import { PostFX } from './PostFX.js';

export class Renderer {
  constructor(container) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // 后处理链（惰性构建；"完整"档才启用）。场景/相机在构造末尾注入。
    this.postfx = new PostFX(this.renderer);
    this.postfx.setSceneCamera(this.scene, this.camera);

    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.postfx.setSize(window.innerWidth, window.innerHeight);
    this.postfx.setPixelRatio(this.renderer.getPixelRatio());
  }

  // 光照增强档位接线：仅"完整"档启用后处理 + ACESFilmic 色调映射（直渲路径必须保持 NoToneMapping）
  setGraphicsMode(mode) {
    const full = mode === 'full';
    this.renderer.toneMapping = full ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.postfx.setSceneCamera(this.scene, this.camera);
    this.postfx.setEnabled(full);
  }

  render() {
    this.postfx.render(this.scene, this.camera);
  }

  get domElement() { return this.renderer.domElement; }
}
