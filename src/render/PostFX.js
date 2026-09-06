// PostFX.js -- 后处理链（光照增强"完整"档）
// 链路：RenderPass → UnrealBloomPass(半分辨率) → 色彩分级(饱和度+暗角) → OutputPass(色调映射+sRGB)
// - WebGL2 下渲染目标开 4x MSAA 补回抗锯齿（直渲路径 antialias:false 的既有行为不变）
// - composer 创建失败自动回退直渲（低端环境守底）
// - 泛光/体积光为子开关（pass.enabled），色调映射+色彩分级随"完整"档整体生效
// - 主菜单全景（Panorama）自持渲染循环不走此链，零影响
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// 轻量色彩分级：饱和度轻微上抬 + 边缘暗角（电影感，强度克制避免夜景死黑）
const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.12 },
    uVignette: { value: 0.16 }
  },
  vertexShader: [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n'),
  fragmentShader: [
    'uniform sampler2D tDiffuse;',
    'uniform float uSaturation;',
    'uniform float uVignette;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec4 c = texture2D(tDiffuse, vUv);',
    '  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));',
    '  c.rgb = mix(vec3(l), c.rgb, uSaturation);',
    '  vec2 d = vUv - 0.5;',
    '  c.rgb *= 1.0 - uVignette * dot(d, d) * 2.0;',
    '  gl_FragColor = c;',
    '}'
  ].join('\n')
};

// 蓝天掩除版高亮提取：在 LuminosityHighPassShader 基础上剔除"蓝天"——
// 天空 mesh 的 color 是 raw 值直进线性 RT（材质 color 无 sRGB 解码），正午亮度 0.66
// 高于任何合理纹理阈，不掩除会把整片天泛光洗成白屏。掩除判据：b 通道显著高于
// max(r,g)（正午/上午蓝天均命中；日落红橙天亮度 0.62 < 阈值本就不泛光；月亮
// 蓝白色会被掩除，牺牲月亮光晕换取白天纯净天空）。
const BlueMaskedHighPassFragment = [
  'uniform sampler2D tDiffuse;',
  'uniform vec3 defaultColor;',
  'uniform float defaultOpacity;',
  'uniform float luminosityThreshold;',
  'uniform float smoothWidth;',
  'varying vec2 vUv;',
  'void main() {',
  '  vec4 texel = texture2D( tDiffuse, vUv );',
  '  vec3 c = texel.rgb;',
  '  float l = dot( c, vec3( 0.299, 0.587, 0.114 ) );',
  '  float skyMask = step( c.b, max( c.r, c.g ) * 1.05 + 0.02 );',
  '  vec4 outputColor = vec4( defaultColor, defaultOpacity );',
  '  float alpha = smoothstep( luminosityThreshold, luminosityThreshold + smoothWidth, l ) * skyMask;',
  '  gl_FragColor = mix( outputColor, texel, alpha );',
  '}'
].join('\n');

// 体积光合成：以 tDiffuse 为底，向太阳屏幕位置径向模糊采样 tSun（亮源掩码）并叠加。
// 掩码里地形为纯黑、天体为亮色——被山体遮挡的太阳在掩码中不存在，光柱天然穿不透山。
const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    tSun: { value: null },
    uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
    uIntensity: { value: 0.0 }
  },
  vertexShader: [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n'),
  fragmentShader: [
    'uniform sampler2D tDiffuse;',
    'uniform sampler2D tSun;',
    'uniform vec2 uSunPos;',
    'uniform float uIntensity;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec4 base = texture2D(tDiffuse, vUv);',
    '  vec2 delta = (uSunPos - vUv) / 24.0 * 0.55;',
    '  vec2 uv = vUv;',
    '  float decay = 1.0;',
    '  vec3 acc = vec3(0.0);',
    '  for (int i = 0; i < 24; i++) {',
    '    uv += delta;',
    '    acc += texture2D(tSun, clamp(uv, 0.0, 1.0)).rgb * decay;',
    '    decay *= 0.93;',
    '  }',
    '  acc /= 24.0;',
    '  gl_FragColor = vec4(base.rgb + acc * uIntensity, base.a);',
    '}'
  ].join('\n')
};

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;          // 底层 THREE.WebGLRenderer
    this.enabled = false;
    this.composer = null;
    this.bloomPass = null;
    this.godRaysPass = null;           // 体积光合成 pass（composer 链内）
    this.godRaysEnabled = false;       // 设置子开关
    this._godRaysBuilt = false;
    this.sunRT = null;                 // 亮源掩码 RT（256²，含地形遮挡深度）
    this._blackMat = null;             // 遮挡通道覆盖材质
    this._failed = false;              // 创建失败后不再重试
  }

  // 惰性构建 composer（首次启用"完整"档才付出构建成本）
  _ensure() {
    if (this.composer || this._failed) return;
    try {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      let rt = null;
      if (this.renderer.capabilities.isWebGL2) {
        rt = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType });
      }
      this.composer = new EffectComposer(this.renderer, rt);
      this.composer.addPass(new RenderPass(this._scene, this._camera));
      // 泛光：内部半分辨率。阈值 0.65（RT 线性亮度）+ 蓝天掩除高亮提取——
      // 正午/上午蓝天(b 通道显著高于 r/g)与黄昏天空(0.62)均不过阈不洗白；
      // 太阳盘(~1.0)与光源块(lightMaterial 提亮 1.5 后 ~0.72)稳定发光。
      // 实测 strength<0.8 时增量低于视觉差分阈（形同未开），取 0.9。
      const res = new THREE.Vector2(size.x / 2, size.y / 2);
      this.bloomPass = new UnrealBloomPass(res, 0.9, 0.5, 0.65);
      this.bloomPass.materialHighPassFilter.fragmentShader = BlueMaskedHighPassFragment;
      this.bloomPass.materialHighPassFilter.needsUpdate = true;
      this.composer.addPass(this.bloomPass);
      // 体积光合成 pass：置于泛光之后、色彩分级之前（光柱同样被分级/色调映射统一处理）
      this.godRaysPass = new ShaderPass(GodRaysShader);
      this.godRaysPass.enabled = false;
      this.composer.addPass(this.godRaysPass);
      this._godRaysBuilt = true;
      this.sunRT = new THREE.WebGLRenderTarget(256, 256);
      this._blackMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
      this.composer.addPass(new ShaderPass(ColorGradeShader));
      this.composer.addPass(new OutputPass());
    } catch (e) {
      console.error('[PostFX] 创建失败，回退直渲:', e);
      this._failed = true;
      this.composer = null;
      this.enabled = false;
    }
  }

  // 场景/相机由 Renderer 包装类在 setGraphicsMode 时注入（构造期两者可能尚未定稿）
  setSceneCamera(scene, camera) {
    this._scene = scene;
    this._camera = camera;
    if (this.composer && this.composer.passes[0]) this.composer.passes[0].scene = scene;
    if (this.composer && this.composer.passes[0]) this.composer.passes[0].camera = camera;
  }

  setEnabled(on) {
    if (on) {
      this._ensure();
      if (!this.composer) return; // 创建失败保持直渲
      this.enabled = true;
    } else {
      this.enabled = false;
    }
  }

  setBloom(on) {
    if (this.bloomPass) this.bloomPass.enabled = !!on;
  }

  setGodRays(on) {
    this.godRaysEnabled = !!on;
    if (this.godRaysPass) this.godRaysPass.enabled = false; // 实际启停在 updateGodRays 逐帧判定
  }

  // 体积光逐帧状态：源选择（白天太阳/夜晚月亮）、屏幕投影、强度（低角度更强）。
  // 维度无天体（下界/末地 celestials=false）时 sky.sun.visible=false 自动关闭。
  updateGodRays(sky, camera) {
    if (!this._godRaysBuilt || !this.godRaysPass) return;
    const active = this.enabled && this.godRaysEnabled && sky && sky.sun && sky.sun.visible;
    if (!active) {
      this.godRaysPass.enabled = false;
      return;
    }
    const useMoon = sky.sunLight.position.y <= 0;
    const obj = useMoon ? sky.moon : sky.sun;
    const v = obj.position.clone().project(camera);
    // 太阳/月亮不在视锥内（含少量出屏余量）则不产生光柱
    if (v.z > 1 || Math.abs(v.x) > 1.3 || Math.abs(v.y) > 1.3) {
      this.godRaysPass.enabled = false;
      return;
    }
    this.godRaysPass.uniforms.uSunPos.value.set((v.x + 1) / 2, (v.y + 1) / 2);
    const elev = Math.min(1, Math.abs(sky.sunLight.position.y) * 1.3);
    const strength = useMoon ? 0.12 : 0.35 * (1.15 - elev * 0.75);
    this.godRaysPass.uniforms.uIntensity.value = Math.max(0.08, strength);
    this.godRaysPass.enabled = true;
  }

  // 亮源掩码预渲染：256² 小 RT，先以黑色覆盖材质渲全部不透明几何（写入深度+黑底），
  // 再关自动清除只渲 layer 1 天体（深度测试保留遮挡关系）——太阳被山体挡住时掩码无亮源。
  _renderSunMask(scene, camera) {
    const r = this.renderer;
    if (!this._sunMaskCameraMask) this._sunMaskCameraMask = 0;
    const oldMask = camera.layers.mask;
    const oldOverride = scene.overrideMaterial;
    const oldRT = r.getRenderTarget();
    const oldAutoClear = r.autoClear;
    const oldClearColor = new THREE.Color();
    r.getClearColor(oldClearColor);
    const oldClearAlpha = r.getClearAlpha();
    try {
      camera.layers.set(0);
      scene.overrideMaterial = this._blackMat;
      r.setRenderTarget(this.sunRT);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.render(scene, camera);
      scene.overrideMaterial = null;
      camera.layers.set(1);
      r.autoClear = false;
      r.render(scene, camera);
    } finally {
      scene.overrideMaterial = oldOverride;
      camera.layers.mask = oldMask;
      r.autoClear = oldAutoClear;
      r.setClearColor(oldClearColor, oldClearAlpha);
      r.setRenderTarget(oldRT);
    }
  }

  setSize(width, height) {
    if (this.composer) this.composer.setSize(width, height);
  }

  setPixelRatio(ratio) {
    if (this.composer) this.composer.setPixelRatio(ratio);
  }

  render(scene, camera) {
    if (!this.enabled || !this.composer) {
      this.renderer.render(scene, camera);
      return;
    }
    if (this.godRaysPass && this.godRaysPass.enabled && this.sunRT) {
      this.godRaysPass.uniforms.tSun.value = this.sunRT.texture;
      this._renderSunMask(scene, camera);
    }
    this.composer.render();
  }
}
