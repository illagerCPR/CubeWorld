// Controls.js -- 输入控制
export class Controls {
  constructor(domElement, player) {
    this.dom = domElement;
    this.player = player;
    this.keys = {};
    this.mouseLeft = false;
    this.mouseRight = false;
    this.locked = false;
    this.lastJumpTap = 0;
    this.wheelDelta = 0;
    this.enabled = false;
    
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onPointerLockChange = this.onPointerLockChange.bind(this);
    
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('wheel', this.onWheel);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  dispose() {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }

  requestLock() {
    this.dom.requestPointerLock();
  }

  onPointerLockChange() {
    this.locked = document.pointerLockElement === this.dom;
  }

  onKeyDown(e) {
    this.keys[e.code] = true;
    if (!this.enabled) return;
    if (e.code === 'Space') {
      const now = performance.now();
      if (now - this.lastJumpTap < 300 && this.player.creative) {
        this.player.flying = !this.player.flying;
        if (this.player.flying) this.player.velocity.y = 0;
      }
      this.lastJumpTap = now;
    }
  }

  onKeyUp(e) {
    this.keys[e.code] = false;
  }

  onMouseMove(e) {
    if (!this.locked) return;
    const sensitivity = 0.0022;
    this.player.yaw -= e.movementX * sensitivity;
    this.player.pitch -= e.movementY * sensitivity;
    const lim = Math.PI / 2 - 0.01;
    this.player.pitch = Math.max(-lim, Math.min(lim, this.player.pitch));
  }

  onMouseDown(e) {
    if (!this.enabled) return;
    if (!this.locked) {
      this.requestLock();
      return;
    }
    if (e.button === 0) this.mouseLeft = true;
    if (e.button === 2) this.mouseRight = true;
  }

  onMouseUp(e) {
    if (e.button === 0) this.mouseLeft = false;
    if (e.button === 2) this.mouseRight = false;
  }

  onWheel(e) {
    this.wheelDelta += Math.sign(e.deltaY);
  }

  // 获取移动方向（基于朝向）
  getMoveVector() {
    let fx = 0, fz = 0;
    if (this.keys['KeyW']) fz -= 1;
    if (this.keys['KeyS']) fz += 1;
    if (this.keys['KeyA']) fx -= 1;
    if (this.keys['KeyD']) fx += 1;
    
    // 转换到世界空间（基于 yaw）
    // Three.js 中 yaw 绕 Y 轴右手旋转，yaw=0 时相机朝 -Z
    // forward = (-sin(yaw), 0, -cos(yaw))
    // right   = ( cos(yaw), 0, -sin(yaw))
    // W (fz=-1) 朝 forward，D (fx=+1) 朝 right
    const sin = Math.sin(this.player.yaw);
    const cos = Math.cos(this.player.yaw);
    const wx = (-fz) * (-sin) + fx * cos;
    const wz = (-fz) * (-cos) + fx * (-sin);
    
    const len = Math.sqrt(wx * wx + wz * wz);
    if (len > 0) return { x: wx / len, z: wz / len };
    return { x: 0, z: 0 };
  }

  isJumping() { return !!this.keys['Space']; }
  isSneaking() { return !!this.keys['ShiftLeft'] || !!this.keys['ShiftRight']; }
  isSprinting() { return !!this.keys['ControlLeft']; }
}
