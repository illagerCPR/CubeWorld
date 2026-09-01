// Sky.js -- 天空、太阳、月亮、雾
import * as THREE from 'three';

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
    
    // 太阳
    const sunGeo = new THREE.SphereGeometry(8, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffff80, fog: false });
    this.sun = new THREE.Mesh(sunGeo, sunMat);
    scene.add(this.sun);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
    scene.add(this.sunLight);
    
    // 月亮
    const moonGeo = new THREE.SphereGeometry(6, 16, 16);
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xddddff, fog: false });
    this.moon = new THREE.Mesh(moonGeo, moonMat);
    scene.add(this.moon);
    
    // 环境光
    this.ambient = new THREE.AmbientLight(0x8090a0, 0.4);
    scene.add(this.ambient);
    
    // 雾
    scene.fog = new THREE.Fog(0x9fc8e8, 60, 160);
  }

  update(dt, playerPos) {
    this.time = (this.time + dt / this.dayLength) % 1;

    // 天空球/太阳/月亮全部跟随玩家（天空球保持以相机为球心，任何位置都在 far 内）
    this.skyMesh.position.set(playerPos.x, playerPos.y, playerPos.z);

    // 太阳角度
    const angle = this.time * Math.PI * 2 - Math.PI / 2;
    const sunX = Math.cos(angle) * 200;
    const sunY = Math.sin(angle) * 200;
    
    this.sun.position.set(playerPos.x + sunX, playerPos.y + sunY, playerPos.z);
    this.moon.position.set(playerPos.x - sunX, playerPos.y - sunY, playerPos.z);
    
    this.sunLight.position.set(sunX, sunY, 0).normalize();
    
    // 光强（sin 可能负，取 max(0,.)）
    const dayFactor = Math.max(0, Math.sin(angle));
    this.sunLight.intensity = 0.15 + dayFactor * 1.3;  // 正午 1.45，夜晚 0.15（月光余晖）
    this.ambient.intensity = 0.30 + dayFactor * 0.50;  // 正午 0.80，夜晚 0.30
    
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
