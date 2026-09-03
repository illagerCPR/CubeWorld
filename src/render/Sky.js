// Sky.js -- 天空、太阳、月亮、云层、星空、雾
import * as THREE from 'three';

// 确定性整数 hash（云纹理网格噪声用，结果可复现）
function hash2i(i, j) {
  let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// 周期化 value noise：格点坐标对 period 取模，保证纹理 RepeatWrapping 无缝
function periodicValueNoise(x, y, period) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const g = (i, j) => hash2i(((i % period) + period) % period, ((j % period) + period) % period);
  const v00 = g(xi, yi), v10 = g(xi + 1, yi), v01 = g(xi, yi + 1), v11 = g(xi + 1, yi + 1);
  return v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
}

function makeCanvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 方形太阳（MC 风格亮盘 + 柔边）
function makeSunTexture() {
  return makeCanvasTexture(32, (ctx) => {
    ctx.fillStyle = 'rgba(255, 244, 170, 0.30)'; ctx.fillRect(1, 1, 30, 30);
    ctx.fillStyle = 'rgba(255, 240, 150, 0.85)'; ctx.fillRect(4, 4, 24, 24);
    ctx.fillStyle = '#fffbe0'; ctx.fillRect(8, 8, 16, 16);
  });
}

// 方形月亮（浅灰盘 + 陨石坑暗斑）
function makeMoonTexture() {
  return makeCanvasTexture(32, (ctx) => {
    ctx.fillStyle = 'rgba(205, 214, 238, 0.25)'; ctx.fillRect(2, 2, 28, 28);
    ctx.fillStyle = 'rgba(216, 224, 244, 0.9)'; ctx.fillRect(5, 5, 22, 22);
    ctx.fillStyle = '#e8ecf8'; ctx.fillRect(8, 8, 16, 16);
    ctx.fillStyle = 'rgba(150, 158, 185, 0.55)';
    ctx.fillRect(10, 11, 4, 4); ctx.fillRect(17, 15, 5, 3); ctx.fillRect(13, 19, 3, 3);
  });
}

// 日出/日落光晕（径向渐变，加法混合）
function makeGlowTexture() {
  return makeCanvasTexture(64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, 'rgba(255, 200, 120, 0.55)');
    g.addColorStop(0.4, 'rgba(255, 160, 90, 0.22)');
    g.addColorStop(1, 'rgba(255, 140, 70, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

// 云纹理：64x64 周期化两八度噪声阈值成块状云（无缝平铺）
function makeCloudTexture() {
  const size = 64;
  return makeCanvasTexture(size, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const n = periodicValueNoise(x / 8, y / 8, s / 8) * 0.62
          + periodicValueNoise(x / 4 + 17.3, y / 4 + 9.7, s / 4) * 0.38;
        const i = (y * s + x) * 4;
        img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
        img.data[i + 3] = n > 0.60 ? 235 : 0;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.time = 0.35; // 0~1 (0=半夜, 0.25=日出, 0.5=正午, 0.75=日落, 1=半夜)，新建存档默认早上
    this.dayLength = 1200; // 秒（20 分钟一天）

    // 颜色表与太阳位置匹配：sunY = sin(time*2π - π/2)
    // time=0 半夜，0.25 日出（sunY=0），0.5 正午（sunY=1），0.75 日落（sunY=0），1 半夜
    this.skyColors = [
      { t: 0.00, color: new THREE.Color(0.02, 0.03, 0.10) },  // 半夜
      { t: 0.20, color: new THREE.Color(0.20, 0.18, 0.35) },  // 黎明
      { t: 0.25, color: new THREE.Color(0.85, 0.55, 0.40) },  // 日出（粉橙）
      { t: 0.30, color: new THREE.Color(0.55, 0.72, 0.95) },  // 早上
      { t: 0.50, color: new THREE.Color(0.45, 0.70, 1.00) },  // 正午
      { t: 0.70, color: new THREE.Color(0.55, 0.72, 0.95) },  // 下午
      { t: 0.75, color: new THREE.Color(0.85, 0.55, 0.40) },  // 日落（粉橙）
      { t: 0.80, color: new THREE.Color(0.20, 0.18, 0.35) },  // 黄昏
      { t: 1.00, color: new THREE.Color(0.02, 0.03, 0.10) }   // 半夜
    ];

    // 天空盒（大球）：每帧跟随玩家位置——固定在原点时玩家走远后球面超出相机
    // far(1000) 被裁剪，露出黑色 clear color（"远处天空纯黑"根因）
    const skyGeo = new THREE.SphereGeometry(500, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false });
    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.skyMesh.frustumCulled = false; // 包围球包住相机，视锥剔除无意义且可能误裁
    scene.add(this.skyMesh);

    // 太阳（方形贴图面片，MC 风格，billboard 正对玩家）
    this.sun = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 34),
      new THREE.MeshBasicMaterial({ map: makeSunTexture(), transparent: true, fog: false, depthWrite: false })
    );
    scene.add(this.sun);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
    scene.add(this.sunLight);

    // 月亮
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 24),
      new THREE.MeshBasicMaterial({ map: makeMoonTexture(), transparent: true, fog: false, depthWrite: false })
    );
    scene.add(this.moon);

    // 日出/日落光晕（加法混合 sprite，跟太阳走，贴近地平线才亮）
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(), color: 0xffb070, transparent: true,
      blending: THREE.AdditiveBlending, fog: false, depthWrite: false, opacity: 0
    }));
    this.sunGlow.scale.set(160, 160, 1);
    scene.add(this.sunGlow);

    // 星空（Points，挂在随太阳同角旋转的天球上，夜晚淡入）
    this.stars = this._makeStars();
    scene.add(this.stars);

    // 云层（世界固定高度大平面，纹理按世界坐标锚定 + 缓慢漂移）
    const cloudTex = makeCloudTexture();
    cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
    cloudTex.magFilter = THREE.NearestFilter;
    this.cloudTex = cloudTex;
    const cloudGeo = new THREE.PlaneGeometry(1536, 1536);
    cloudGeo.rotateX(-Math.PI / 2);
    this.clouds = new THREE.Mesh(cloudGeo, new THREE.MeshBasicMaterial({
      map: cloudTex, transparent: true, opacity: 0.55, depthWrite: false, fog: false, side: THREE.DoubleSide
    }));
    this.clouds.frustumCulled = false; // 平面总以玩家为中心，包围盒剔除可能误裁
    this._wind = 0;
    scene.add(this.clouds);

    // 环境光（怪物/手持物仍用场景光；方块光照 L3 起由体素光接管）
    this.ambient = new THREE.AmbientLight(0x8090a0, 0.4);
    scene.add(this.ambient);

    // 雾
    scene.fog = new THREE.Fog(0x9fc8e8, 60, 160);
  }

  _makeStars() {
    const N = 450;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      // 均匀球面采样，半径 470（天空球 500 之内）
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(phi) * r * 470;
      pos[i * 3 + 1] = u * 470;
      pos[i * 3 + 2] = Math.sin(phi) * r * 470;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xd8e0ff, size: 1.8, sizeAttenuation: false,
      transparent: true, opacity: 0, fog: false, depthWrite: false
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return points;
  }

  update(dt, playerPos) {
    this.time = (this.time + dt / this.dayLength) % 1;

    // 天空球/太阳/月亮/星空/云层全部跟随玩家（天空球保持以相机为球心）
    this.skyMesh.position.set(playerPos.x, playerPos.y, playerPos.z);

    // 太阳角度
    const angle = this.time * Math.PI * 2 - Math.PI / 2;
    const sunX = Math.cos(angle) * 200;
    const sunY = Math.sin(angle) * 200;

    this.sun.position.set(playerPos.x + sunX, playerPos.y + sunY, playerPos.z);
    this.sun.lookAt(playerPos.x, playerPos.y, playerPos.z);
    this.moon.position.set(playerPos.x - sunX, playerPos.y - sunY, playerPos.z);
    this.moon.lookAt(playerPos.x, playerPos.y, playerPos.z);

    this.sunLight.position.set(sunX, sunY, 0).normalize();

    // 光强（sin 可能负，取 max(0,.)）
    const dayFactor = Math.max(0, Math.sin(angle));
    this.sunLight.intensity = 0.15 + dayFactor * 1.3;  // 正午 1.45，夜晚 0.15（月光余晖）
    this.ambient.intensity = 0.30 + dayFactor * 0.50;  // 正午 0.80，夜晚 0.30

    // 晨昏时太阳光偏暖（作用于怪物等仍用场景光的物体），正午回白色，夜晚偏冷月光
    const horizonT = Math.min(1, Math.max(0, (sunY / 200) / 0.35));
    if (dayFactor > 0) {
      this.sunLight.color.setRGB(0.98 + 0.02 * horizonT, 0.66 + 0.34 * horizonT, 0.42 + 0.58 * horizonT);
    } else {
      this.sunLight.color.setRGB(0.72, 0.78, 1.0);
    }
    // 体素光天光染色（VoxelLightUniforms.uSunTint 每帧从这里取）：正午白、晨昏暖、夜晚冷
    if (!this.sunTint) this.sunTint = new THREE.Color(1, 1, 1);
    if (dayFactor > 0) {
      this.sunTint.setRGB(1.0, 0.62 + 0.38 * horizonT, 0.42 + 0.58 * horizonT);
    } else {
      this.sunTint.setRGB(0.80, 0.85, 1.0);
    }

    // 日出/日落光晕：太阳贴近地平线时最亮，其余时间隐藏
    const glowT = 1 - Math.min(1, Math.abs(sunY / 200) / 0.28);
    this.sunGlow.position.copy(this.sun.position);
    this.sunGlow.material.opacity = Math.max(0, glowT) * 0.9;

    // 星空：与太阳同角旋转，夜晚淡入
    this.stars.position.set(playerPos.x, playerPos.y, playerPos.z);
    this.stars.rotation.z = angle;
    const nightFade = Math.max(0, 1 - dayFactor * 4);
    this.stars.material.opacity = nightFade * 0.9;
    this.stars.visible = nightFade > 0.02;

    // 云层：跟随玩家，纹理按世界坐标锚定（offset 抵消平面移动）+ 缓慢漂移
    this._wind += dt * 2.0;
    this.clouds.position.set(playerPos.x, 140, playerPos.z);
    this.cloudTex.offset.set((playerPos.x + this._wind) / 1536, playerPos.z / 1536);

    // 天空颜色插值
    const c = this.interpolateSkyColor(this.time);
    this.skyMesh.material.color.copy(c);
    if (this.scene.fog) this.scene.fog.color.copy(c);
  }

  interpolateSkyColor(t) {
    let prev = this.skyColors[0], next = this.skyColors[this.skyColors.length - 1];
    for (let i = 0; i < this.skyColors.length - 1; i++) {
      if (t >= this.skyColors[i].t && t <= this.skyColors[i + 1].t) {
        prev = this.skyColors[i];
        next = this.skyColors[i + 1];
        break;
      }
    }
    const localT = (t - prev.t) / (next.t - prev.t);
    return prev.color.clone().lerp(next.color, localT);
  }

  isDay() { return this.time > 0.25 && this.time < 0.75; }
  isNight() { return !this.isDay(); }
  getLightLevel() { return Math.max(0, Math.sin(this.time * Math.PI * 2 - Math.PI / 2)); }
}
