// Player.js -- 玩家实体
import * as THREE from 'three';

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.position = new THREE.Vector3(0, 100, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.creative = false;
    this.spectator = false;
    this.survival = false;
    
    // 生存属性
    this.health = 20;
    this.maxHealth = 20;
    this.food = 20;
    this.maxFood = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.xp = 0;
    this.xpLevel = 0;
    this.armor = 0;
    
    // 状态
    this.gamemode = 'creative';
    this.inWater = false;
    this.onFire = 0;
    this.airTicks = 300; // 氧气（原版 300 tick = 15 秒）
    this.invulnerable = 0;     // 受击后无敌帧（秒），> 0 时阻止 hurt()
    this.onHurt = null;          // 受击回调 (amount, source) => void，由 Game 注册
    this.onDeath = null;
  }

  // 统一受击入口：处理无敌帧 + 触发 onHurt 回调。
  //   amount   - 扣血量
  //   source   - 触发来源标签（'mob' / 'fall' / 'drown' / 'starve' / 'fire' / 'lava'）
  //   showVignette - 是否触发屏幕红闪（攻击 / 摔落是；溺水 / 饥饿否）
  // 返回 true 表示成功扣血，false 表示被无敌帧/模式拦截。
  hurt(amount, source = 'mob', showVignette = true) {
    if (this.creative || this.spectator) return false;
    if (this.invulnerable > 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.invulnerable = 0.5;     // 10 tick 的受击无敌期
    if (showVignette && this.onHurt) this.onHurt(amount, source);
    if (this.health <= 0 && this.onDeath) this.onDeath();
    return true;
  }

  // 食用食物：增加 food / saturation，返回是否成功吃下。
  //   原版规则：food += item.food，saturation += food * 0.6（简化版无 saturation 越界控制）
  //   创造/旁观 / 饱腹 时直接拒绝，不消耗物品。
  eat(itemDef) {
    if (this.creative || this.spectator) return false;
    if (!itemDef || !itemDef.food) return false;
    if (this.food >= this.maxFood) return false;
    this.food = Math.min(this.maxFood, this.food + itemDef.food);
    this.saturation = Math.min(this.maxFood, this.saturation + itemDef.food * 0.6);
    return true;
  }

  setMode(mode) {
    this.gamemode = mode;
    this.creative = mode === 'creative';
    this.survival = mode === 'survival';
    this.spectator = mode === 'spectator';
    if (mode === 'creative') {
      this.flying = false;
      this.health = 20;
      this.food = 20;
    } else if (mode === 'spectator') {
      this.flying = true;
    } else {
      this.flying = false;
    }
  }

  updateCamera() {
    this.camera.position.copy(this.position);
    this.camera.position.y += 1.62; // 视点高度
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }
}
