// Entity.js -- 实体基类（玩家/怪物共用）
import * as THREE from 'three';

const GRAVITY = -32;

export class Entity {
  constructor() {
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.onGround = false;
    this.health = 20;
    this.maxHealth = 20;
    this.dead = false;
    this.width = 0.6;
    this.height = 1.8;
    this.flying = false;
    this.noClip = false;
    this.onFire = 0;
    this.id = Entity.nextId++;
    this.invulnerable = 0;
  }

  get half() { return this.width * 0.5; }

  damage(amount) {
    if (this.invulnerable > 0) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
    return true;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }
}

Entity.nextId = 1;
