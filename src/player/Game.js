// Game.js -- 游戏主类：管理所有子系统
import * as THREE from 'three';
import { Renderer } from '../render/Renderer.js';
import { Sky } from '../render/Sky.js';
import { SVGTextures } from '../render/SVGTextures.js';
import { ChunkMeshBuilder } from '../render/ChunkMesh.js';
import { World } from '../core/World.js';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { Player } from './Player.js';
import { Physics } from './Physics.js';
import { Controls } from './Controls.js';
import { Inventory } from './Inventory.js';
import { Raycast } from './Raycast.js';
import { Hotbar, setSvgMaps } from '../ui/Hotbar.js';
import { Hud } from '../ui/Hud.js';
import { InfoBar } from '../ui/InfoBar.js';
import { InventoryScreen } from '../ui/InventoryScreen.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { DeathScreen } from '../ui/DeathScreen.js';
import { CommandPanel } from '../ui/CommandPanel.js';
import { ChatBox } from '../ui/ChatBox.js';
import { CHUNK_SIZE } from '../core/Chunk.js';
import { matchRecipe } from '../core/Crafting.js';
import { MobManager } from '../entity/MobManager.js';
import { RedstoneSystem } from '../core/RedstoneSystem.js';
import { SaveSystem } from '../core/SaveSystem.js';
import { playerColorCss } from '../net/playerColor.js';

// 触发方块/物品定义注册
import '../blocks/BlockDefs.js';
import '../items/ItemDefs.js';
import { BlockSVGDefinitions } from '../blocks/BlockDefs.js';
import { ItemSVGDefinitions } from '../items/ItemDefs.js';

const RENDER_DISTANCE = 6; // 区块半径

export class Game {
  constructor(container) {
    this.container = container;
    this.renderer = new Renderer(container);
    this.sky = new Sky(this.renderer.scene);
    this.player = new Player(this.renderer.camera);
    this.physics = new Physics(null);
    this.controls = new Controls(this.renderer.domElement, this.player);
    this.inventory = new Inventory();
    this.hud = new Hud();
    this.infoBar = new InfoBar();
    this.raycast = null;
    this.chunkBuilder = null;
    this.world = null;
    this.hotbar = null;
    this.inventoryScreen = null;
    this.pauseMenu = null;
    this.deathScreen = null;
    this.commandPanel = null;
    this.cheatsEnabled = false;
    this.paused = false;
    this.currentSlot = 1;
    this.onExit = null;
    this.mobManager = null;
    this.selectedBlock = null;
    this.breakingProgress = 0;
    this.lastTime = 0;
    this.running = false;
    this.frame = 0;
    this.autoSaveTimer = 0;
    this.autoSaveInterval = 30; // 每30秒自动保存
    this.networkMode = false;   // 局域网联机模式
    this.net = null;            // NetworkManager 实例（由 main.js 注入）
    this.remotePlayers = new Map(); // id -> RemotePlayer 远端玩家
    this.chatBox = null;        // 联机聊天框
    this.spectating = false;    // 是否处于观战模式（死亡后旁观其他玩家）
    this.spectateTargetId = null; // 当前观战跟随的玩家 id（null=自由飞行）
    // 阶段6 观战相机平滑：跟随目标时对位置/朝向做指数平滑，切换目标/目标瞬移时不跳变
    this._specSmoothed = null;    // Vector3，平滑后的观战位置
    this._specSmoothYaw = 0;
    this._specSmoothPitch = 0;
    
    this.blockSvgMap = BlockSVGDefinitions;
    this.itemSvgMap = ItemSVGDefinitions;
    setSvgMaps(ItemSVGDefinitions, BlockSVGDefinitions);
    
    // 高亮选中方块的线框
    const wireGeo = new THREE.BoxGeometry(1.001, 1.001, 1.001);
    const edges = new THREE.EdgesGeometry(wireGeo);
    this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
    this.highlight.visible = false;
    this.renderer.scene.add(this.highlight);
    
    // 破坏进度方块
    const breakGeo = new THREE.BoxGeometry(1.02, 1.02, 1.02);
    this.breakMesh = new THREE.Mesh(breakGeo, new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0, depthWrite: false }));
    this.breakMesh.visible = false;
    this.renderer.scene.add(this.breakMesh);
    
    this.setupKeyBindings();
    this._setupPauseOnUnlock();
  }

  _setupPauseOnUnlock() {
    document.addEventListener('pointerlockchange', () => {
      if (!this.running || this.paused) return;
      if (document.pointerLockElement) return;
      if (!this.controls.enabled) return;
      if (this.chatBox && this.chatBox.input) return; // 聊天输入中不弹暂停
      if (this.inventoryScreen && this.inventoryScreen.visible) return;
      if (this.commandPanel && this.commandPanel.visible) return;
      if (this.pauseMenu && this.pauseMenu.visible) return;
      if (this.deathScreen && this.deathScreen.visible) return;
      this.pauseMenu?.show();
    });
  }

  // 清理旧世界所有 Three.js 资源和 UI DOM，防止切换存档时残留"幽灵方块"等
  _disposeWorld() {
    const scene = this.renderer.scene;
    // 旧区块网格
    if (this.world && this.world.chunks) {
      for (const chunk of this.world.chunks.values()) {
        if (chunk.mesh) { scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); }
        if (chunk.waterMesh) { scene.remove(chunk.waterMesh); chunk.waterMesh.geometry.dispose(); }
        if (chunk.lightMesh) { scene.remove(chunk.lightMesh); chunk.lightMesh.geometry.dispose(); }
      }
    }
    // 旧怪物和掉落物 + 释放 type 级共享 mesh/texture/material 资源
    if (this.mobManager) {
      this.mobManager.dispose();
    }
    // 高亮和破坏进度
    this.selectedBlock = null;
    this.breakingProgress = 0;
    if (this.highlight) this.highlight.visible = false;
    if (this.breakMesh) this.breakMesh.visible = false;
    // 旧 UI DOM
    if (this.hotbar) { this.hotbar.el.remove(); this.hotbar = null; }
    if (this.inventoryScreen) {
      if (this.inventoryScreen.tooltip) this.inventoryScreen.tooltip.remove();
      if (this.inventoryScreen.cursorEl) this.inventoryScreen.cursorEl.remove();
      this.inventoryScreen.el.remove();
      this.inventoryScreen = null;
    }
    if (this.pauseMenu) { this.pauseMenu.el.remove(); this.pauseMenu = null; }
    if (this.deathScreen) { this.deathScreen.el.remove(); this.deathScreen = null; }
    if (this.commandPanel) { this.commandPanel.el.remove(); this.commandPanel = null; }
    // 远端玩家与联机聊天框
    for (const rp of this.remotePlayers.values()) rp.dispose();
    this.remotePlayers.clear();
    if (this.chatBox) { this.chatBox.dispose(); this.chatBox = null; }
  }

  async start(mode, seed, loadData = null, slot = 1, cheatsEnabled = false, networkMode = false) {
    try {
    // 清理旧世界资源，防止切换存档时残留
    this._disposeWorld();
    this.currentSlot = slot;
    this.networkMode = networkMode;
    this.paused = false;
    this.running = false;
    this.spectating = false;        // 阶段4：新世界默认不观战
    this.spectateTargetId = null;
    this._specSmoothed = null;      // 阶段6：观战平滑状态重置
    this._specSmoothYaw = 0;
    this._specSmoothPitch = 0;
    // 显示加载界面
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
      loadingEl.style.display = 'flex';
      const fill = document.getElementById('load-fill');
      if (fill) fill.style.width = '0%';
    }
    // 如果有存档数据，使用存档的种子和模式
    if (loadData) {
      seed = loadData.seed;
      mode = loadData.gamemode;
      this.cheatsEnabled = !!loadData.cheatsEnabled;
    } else {
      this.cheatsEnabled = !!cheatsEnabled;
    }
    
    this.world = new World(seed);
    this.physics.world = this.world;
    // 重置跨存档共享的玩家运行时状态（避免上一存档的 invulnerable 残留）
    this.player.invulnerable = 0;
    // 受击红屏：所有调用 player.hurt(amount, ..., true) 的源都触发
    this.player.onHurt = (amount, source) => {
      if (this.hud) this.hud.flashDamage(amount);
    };
    // 死亡屏的统一入口仍由 updateSurvival 末段处理，这里不重设 onDeath
    this.raycast = new Raycast(this.world);
    this.redstone = new RedstoneSystem(this.world);
    this.redstone.onExplosion = (x, y, z, radius) => {
      const dx = this.player.position.x - x;
      const dy = this.player.position.y + 1 - y;
      const dz = this.player.position.z - z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (dist < radius * 1.5) {
        const dmg = Math.max(0, (radius * 1.5 - dist) * 8);
        this.player.hurt(dmg, 'explosion', true);
      }
    };
    
    // 如果有存档，恢复修改的方块
    if (loadData && loadData.modifiedBlocks) {
      for (const [key, id] of Object.entries(loadData.modifiedBlocks)) {
        this.world.modifiedBlocks.set(key, id);
      }
    }
    
    // 构建纹理图集（包含怪物纹理）
    const allSvgs = { ...this.blockSvgMap, ...this.itemSvgMap };
    // 先创建 MobManager 并注入怪物 SVG
    this.mobManager = new MobManager(this.world, this.renderer.scene, null, null);
    await this.mobManager.init(allSvgs);
    
    const { atlasTexture, atlasUV } = await SVGTextures.buildAtlas(allSvgs);
    this.atlasUV = atlasUV;
    // 水面独立纹理：RepeatWrapping + 世界坐标 UV 平铺，避免 chunk 边界方格
    this.waterTexture = await SVGTextures.buildRepeatTexture(allSvgs['water'] || '', 'water');
    this.chunkBuilder = new ChunkMeshBuilder(this.world, atlasTexture, atlasUV, this.waterTexture);
    // 用图集初始化怪物材质
    this.mobManager.atlasUV = atlasUV;
    this.mobManager.atlasTexture = atlasTexture;
    await this.mobManager.buildMaterials();
    
    // 生成初始区块
    const loadFill = document.getElementById('load-fill');
    const chunks = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        chunks.push([dx, dz]);
      }
    }
    let i = 0;
    for (const [dx, dz] of chunks) {
      this.world.ensureChunk(dx, dz);
      if (loadFill) loadFill.style.width = `${(i / chunks.length) * 100}%`;
      i++;
      await new Promise(r => setTimeout(r, 0));
    }
    
    // 玩家出生点
    if (loadData && loadData.player) {
      const p = loadData.player;
      this.player.position.set(p.x, p.y, p.z);
      this.player.yaw = p.yaw || 0;
      this.player.pitch = p.pitch || 0;
      this.player.health = p.health ?? 20;
      this.player.food = p.food ?? 20;
      this.player.saturation = p.saturation ?? 5;
      this.player.exhaustion = p.exhaustion ?? 0;
      this.player.xp = p.xp ?? 0;
      this.player.xpLevel = p.xpLevel ?? 0;
      this.player.onFire = p.onFire ?? 0;
      this.player.airTicks = p.airTicks ?? 300;
    } else {
      const h = this.world.getHeightAt(0, 0);
      this.player.position.set(0.5, h + 2, 0.5);
    }
    this.player.setMode(mode);
    
    // 物品栏：先清空，避免上一个存档的物品残留
    this.inventory.slots = new Array(this.inventory.size).fill(null);
    this.inventory.hotbarSelected = 0;
    if (loadData && loadData.inventory) {
      this.inventory.deserialize(loadData.inventory);
    } else if (mode === 'creative') {
      const items = [...BlockRegistry.all(), ...ItemRegistry.all()].filter(b => b.name !== 'air').slice(0, 9);
      this.inventory.fillCreative(items);
    } else {
      // 生存初始物品
      this.inventory.add('wood_pickaxe');
      this.inventory.add('wood_axe');
      this.inventory.add('wood_sword');
      this.inventory.add('torch', 16);
      this.inventory.add('bread', 5);
    }
    
    // 恢复红石状态
    if (loadData && loadData.redstone && this.redstone) {
      this.redstone.deserialize(loadData.redstone);
    }
    
    // 天空时间：始终先重置为新存档默认（早上），再按存档恢复
    if (this.sky) this.sky.time = 0.35;
    if (loadData && loadData.sky && this.sky) {
      this.sky.time = loadData.sky.time || 0.35;
    }
    
    this.hotbar = new Hotbar(this.inventory);
    await this.hotbar.update();
    this.inventoryScreen = new InventoryScreen(this.inventory, this.player, this);
    this.pauseMenu = new PauseMenu(this);
    this.deathScreen = new DeathScreen(this);
    this.commandPanel = new CommandPanel(this);

    // 联机模式初始化：host 端跑怪物自然生成（事件同步）、绑定方块同步钩子、注册网络回调、创建聊天框
    if (this.networkMode && this.net) {
      // 阶段 2 怪物事件同步：host 端权威生成（mob_spawn 广播），非 host 端只接收广播创建
      if (this.mobManager) {
        this.mobManager.spawnEnabled = !!this.net.isHost;
        this.mobManager.mobNet = this.net; // 生成/攻击/死亡事件上报接口
      }
      this.net.bindWorld(this.world); // World.setBlock 统一上报（含防回环）
      // 联机拾取掉落物：通知服务器移除并广播
      if (this.mobManager) this.mobManager.onDropTaken = (id) => this.net.sendDropTaken(id);
      // 红石源状态（lever/button）：低频广播让各端 poweredBlocks 对齐
      if (this.redstone) this.redstone.onStateChange = (x, y, z, on) => this.net.sendRedstoneState(x, y, z, on);
      this.net.on('time', (t) => { if (this.sky) this.sky.time = t; });
      this.net.on('chat', ({ from, fromId, text }) => {
        if (!this.chatBox) return;
        if (fromId === 0) { this.chatBox.add(text, '#aaa'); return; } // 服务器系统回复
        this.chatBox.addSegments([{ text: `<${from}> `, color: playerColorCss(fromId) }, { text, color: '#fff' }]);
      });
      this.net.on('system', (m) => {
        if (!this.chatBox) return;
        if (m && m.parts) this.chatBox.addSegments(m.parts);
        else this.chatBox.add(typeof m === 'string' ? m : (m && m.text) || String(m), '#aaa');
      });
      this.net.on('attacked', ({ damage }) => { this.player.hurt(damage, 'player', true); });
      this.chatBox = new ChatBox(this, (text) => this.net.sendChat(text));
      this.chatBox.add(`已进入局域网世界 · 房间「${this.net.room || 'default'}」 · 按 T 聊天（/room 换房 /rebuild 重建世界 host）`, '#ff8');
    }

    // 隐藏加载界面
    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'none';

    this.running = true;
    this.controls.enabled = true;
    this.infoBar.show();
    this.lastTime = performance.now();
    this.loop();
    } catch (e) {
      console.error('游戏启动失败:', e);
      const loading = document.getElementById('loading');
      if (loading) {
        loading.innerHTML = `<div style="color:#f88;font-size:16px;text-align:center;padding:20px;">游戏启动失败: ${e.message}<br><br>请按 F5 刷新或清除 localStorage 后重试</div>`;
      }
    }
  }

  setupKeyBindings() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE') {
        if (this.paused || this.spectating || (this.deathScreen && this.deathScreen.visible)) return;
        if (this.inventoryScreen) {
          this.inventoryScreen.toggle(2);
        }
      }
      // C 键：命令面板（仅在启用命令的存档可用）
      if (e.code === 'KeyC') {
        if (!this.running || this.spectating || !this.cheatsEnabled) return;
        if (this.deathScreen && this.deathScreen.visible) return;
        if (this.pauseMenu && this.pauseMenu.visible) return;
        if (this.commandPanel) this.commandPanel.toggle();
      }
      // 数字键切换快捷栏
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5)) - 1;
        if (n >= 0 && n < 9) {
          this.inventory.setSelected(n);
          if (this.hotbar) { this.hotbar.update(); this.hotbar.flashName(); }
        }
      }
      // F5 手动保存（联机模式不保存本地槽位）；观战模式下 F5 切换观战目标
      if (e.code === 'F5') {
        e.preventDefault();
        if (this.spectating) {
          this.cycleSpectateTarget();
          this._spectateHint();
        } else if (this.running && this.world && !this.networkMode) SaveSystem.save(this);
      }
      // R 键：观战模式重生退出观战
      if (e.code === 'KeyR' && this.spectating) {
        this.respawn();
        return;
      }
      // ESC 兜底：pointer lock 未激活时也切换暂停菜单（pointerlockchange 不会触发）
      if (e.code === 'Escape') {
        if (!this.running || (this.deathScreen && this.deathScreen.visible)) return;
        // 优先关闭命令面板
        if (this.commandPanel && this.commandPanel.visible) {
          this.commandPanel.hide();
          return;
        }
        if (this.inventoryScreen && this.inventoryScreen.visible) return;
        if (this.pauseMenu && this.pauseMenu.visible) {
          this.pauseMenu.hide();
        } else if (!this.controls.locked) {
          this.pauseMenu?.show();
        }
      }
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  loop = () => {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.frame++;
    if (!this.paused) this.update(dt);
    this.renderer.render();
    requestAnimationFrame(this.loop);
  };

  // 检测眼睛位置是否在水里，更新 inWater / 氧气 / 溺水
  _updateWaterState() {
    const p = this.player;
    const eyeY = p.position.y + 1.62;
    const bx = Math.floor(p.position.x);
    const by = Math.floor(eyeY);
    const bz = Math.floor(p.position.z);
    const id = this.world.getBlock(bx, by, bz);
    const def = BlockRegistry.getById(id);
    p.inWater = !!(def && def.fluid && def.name === 'water');

    if (p.survival) {
      if (p.inWater) {
        p.airTicks -= 1;
        if (p.airTicks <= 0) {
          // 溺水：每秒扣 1 血（约每 20 帧一次）
          p.airTicks = 20;
          p.health = Math.max(0, p.health - 1);
        }
      } else {
        p.airTicks = Math.min(300, p.airTicks + 10);
      }
    }
  }

  update(dt) {
    // 检测玩家是否在水中（眼睛位置）
    this._updateWaterState();

    // 受击无敌帧衰减
    if (this.player.invulnerable > 0) {
      this.player.invulnerable = Math.max(0, this.player.invulnerable - dt);
    }

    // 玩家移动
    // 观战模式：跟随目标时本地实体吸附到目标（无碰撞）+ 相机贴合目标视角；无目标时 spectator 自由飞行（穿墙）
    let specTarget = this.spectating ? this.remotePlayers.get(this.spectateTargetId) : null;
    if (specTarget && specTarget.dead) { this.spectateTargetId = null; specTarget = null; } // 目标死亡/离开 → 回自由
    if (specTarget) {
      // 观战跟随：吸附（平滑）+ 相机贴合 + 天空跟随（区块加载以吸附后的位置为中心，正好加载目标周围）
      // 阶段6 平滑：对目标插值位置再做指数平滑（帧率无关系数），切换目标/目标瞬移时不跳变
      const targetPos = specTarget.group.position;
      if (!this._specSmoothed) {
        this._specSmoothed = targetPos.clone();
        this._specSmoothYaw = specTarget.yaw;
        this._specSmoothPitch = specTarget.pitch;
      } else {
        const k = 1 - Math.pow(0.0001, dt); // ~0.9 @60fps，帧率无关
        this._specSmoothed.lerp(targetPos, k);
        let dy = specTarget.yaw - this._specSmoothYaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this._specSmoothYaw += dy * k;
        this._specSmoothPitch += (specTarget.pitch - this._specSmoothPitch) * k;
      }
      this.player.position.copy(this._specSmoothed);
      this.player.velocity.set(0, 0, 0);
      this.updateSpectateCamera();
      this.sky.update(dt, this.player.position);
    } else {
      const move = this.controls.getMoveVector();
      const speed = this.player.flying ? 12 : (this.player.survival ? 4.3 : 5.6);
      const sprint = this.controls.isSprinting() ? 1.3 : 1;
      
      if (this.player.flying || this.player.spectator) {
        this.player.velocity.x = move.x * speed * sprint;
        this.player.velocity.z = move.z * speed * sprint;
        let vy = 0;
        if (this.controls.isJumping()) vy = speed * 0.6;
        if (this.controls.isSneaking()) vy = -speed * 0.6;
        this.player.velocity.y = vy;
      } else if (this.player.inWater) {
        // 游泳：水平速度降低，Space 上浮 / Shift 下潜
        const swimSpeed = speed * 0.5 * sprint;
        this.player.velocity.x = move.x * swimSpeed;
        this.player.velocity.z = move.z * swimSpeed;
        if (this.controls.isJumping()) this.player.velocity.y = 4.0;
        else if (this.controls.isSneaking()) this.player.velocity.y = -4.0;
        // 其余交给 Physics 的水中重力与阻力
      } else {
        this.player.velocity.x = move.x * speed * sprint;
        this.player.velocity.z = move.z * speed * sprint;
        if (this.controls.isJumping()) this.physics.jump(this.player);
      }
      
      this.physics.collide(this.player, dt);
      this.player.updateCamera();
      this.sky.update(dt, this.player.position);
    }
    
    // 水下视野雾效
    const fog = this.renderer.scene.fog;
    if (fog) {
      if (this.player.inWater) {
        fog.color.setRGB(0.1, 0.25, 0.45);
        fog.near = 0;
        fog.far = 24;
      } else {
        fog.near = 60;
        fog.far = 160;
      }
    }
    // 滚轮切换
    if (this.controls.wheelDelta !== 0) {
      let idx = this.inventory.hotbarSelected + this.controls.wheelDelta;
      if (idx < 0) idx = 8;
      if (idx > 8) idx = 0;
      this.inventory.setSelected(idx);
      this.hotbar.update();
      this.hotbar.flashName();
      this.controls.wheelDelta = 0;
    }
    
    // 区块加载/卸载
    this.updateChunks();
    
    // 重新构建脏区块网格
    this.rebuildDirtyChunks();
    
    // 射线选择
    this.updateRaycast();
    
    // 鼠标交互（观战模式不操作方块/物品）
    if (this.spectating) {
      this.controls.mouseLeft = false;
      this.controls.mouseRight = false;
      this.breakingProgress = 0;
      if (this.breakMesh) this.breakMesh.visible = false;
    } else {
      this.handleMouseInput(dt);
    }
    
    // HUD
    this.hud.update(this.player);
    if (this.infoBar && this.world && this.world.generator) {
      this.infoBar.update(this.player, this.world.generator, this.sky, this.crosshairInfo);
    }
    
    // 怪物系统
    if (this.mobManager) {
      this.mobManager.onPickup = (name, count) => {
        const remaining = this.inventory.add(name, count);
        this.hotbar.update();
        return remaining; // 返回未放入的剩余数量（0 = 全部拾取）
      };
      this.mobManager.update(dt, this.player, this.sky);
    }
    
    // 红石系统
    if (this.redstone) {
      this.redstone.update(dt);
    }

    // 联机网络更新：本地状态上报 + 远端玩家插值
    if (this.networkMode && this.net) {
      this.net.update(dt);
      for (const rp of this.remotePlayers.values()) rp.update(dt);
    }
    
    // 生存模式更新
    if (this.player.survival) {
      this.updateSurvival(dt);
    }
    
    // 自动保存（联机模式不自动保存，避免覆盖本地槽位）
    if (!this.networkMode) {
      this.autoSaveTimer += dt;
      if (this.autoSaveTimer >= this.autoSaveInterval) {
        this.autoSaveTimer = 0;
        SaveSystem.save(this);
      }
    }
  }

  updateChunks() {
    const pcx = Math.floor(this.player.position.x / CHUNK_SIZE);
    const pcz = Math.floor(this.player.position.z / CHUNK_SIZE);
    
    // 加载
    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
      for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
        const cx = pcx + dx, cz = pcz + dz;
        if (!this.world.getChunk(cx, cz)) {
          this.world.ensureChunk(cx, cz);
        }
      }
    }
    
    // 卸载（距离过远）
    const maxDist = RENDER_DISTANCE + 2;
    for (const [key, chunk] of this.world.chunks) {
      const dx = chunk.cx - pcx, dz = chunk.cz - pcz;
      if (Math.abs(dx) > maxDist || Math.abs(dz) > maxDist) {
        if (chunk.mesh) this.renderer.scene.remove(chunk.mesh);
        if (chunk.waterMesh) this.renderer.scene.remove(chunk.waterMesh);
        if (chunk.lightMesh) this.renderer.scene.remove(chunk.lightMesh);
        this.world.unloadChunk(chunk.cx, chunk.cz);
      }
    }
  }

  rebuildDirtyChunks() {
    // 每帧最多重建 1 个区块，避免卡顿
    let count = 0;
    for (const [, chunk] of this.world.chunks) {
      if (chunk.dirty && count < 2) {
        if (chunk.mesh) {
          this.renderer.scene.remove(chunk.mesh);
          chunk.mesh.geometry.dispose();
          chunk.mesh = null;
        }
        if (chunk.waterMesh) {
          this.renderer.scene.remove(chunk.waterMesh);
          chunk.waterMesh.geometry.dispose();
          chunk.waterMesh = null;
        }
        if (chunk.lightMesh) {
          this.renderer.scene.remove(chunk.lightMesh);
          chunk.lightMesh.geometry.dispose();
          chunk.lightMesh = null;
        }
        const meshes = this.chunkBuilder.build(chunk);
        if (meshes.solid) {
          chunk.mesh = meshes.solid;
          this.renderer.scene.add(chunk.mesh);
        }
        if (meshes.water) {
          chunk.waterMesh = meshes.water;
          this.renderer.scene.add(chunk.waterMesh);
        }
        if (meshes.light) {
          chunk.lightMesh = meshes.light;
          this.renderer.scene.add(chunk.lightMesh);
        }
        chunk.dirty = false;
        count++;
      }
    }
  }

  updateRaycast() {
    const origin = this.player.position.clone();
    origin.y += 1.62;
    const dir = new THREE.Vector3();
    this.renderer.camera.getWorldDirection(dir);

    const maxDist = this.player.creative ? 5 : 4.5;
    const hit = this.raycast.cast(origin, dir, maxDist);
    this.selectedBlock = hit;

    if (hit) {
      this.highlight.visible = true;
      this.highlight.position.set(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5);
    } else {
      this.highlight.visible = false;
      this.breakingProgress = 0;
    }

    // 计算准星目标 —— 方块与实体取较近者，用于 InfoBar 显示
    let blockDist = Infinity;
    if (hit) {
      const cx = hit.block.x + 0.5 - origin.x;
      const cy = hit.block.y + 0.5 - origin.y;
      const cz = hit.block.z + 0.5 - origin.z;
      blockDist = Math.sqrt(cx * cx + cy * cy + cz * cz);
    }
    let info = null;
    if (this.mobManager) {
      const mh = this.mobManager.findMobByRay(origin, dir, maxDist);
      if (mh && mh.distance < blockDist) {
        const t = mh.mob.type;
        info = { type: 'mob', displayName: t.displayName || t.name, name: t.name };
      }
    }
    if (!info && hit) {
      const def = BlockRegistry.getById(hit.id);
      info = { type: 'block', displayName: def ? def.displayName : '未知', name: def ? def.name : '?' };
    }
    this.crosshairInfo = info;
  }

  handleMouseInput(dt) {
    if (this.inventoryScreen && this.inventoryScreen.visible) return;
    if (!this.selectedBlock && !(this.controls.mouseLeft && this.mobManager)) return;
    
    if (this.controls.mouseLeft) {
      // 联机互殴：先检测远端玩家（射线命中优先于怪物）
      if (this.networkMode && this.net && !this.inventoryScreen?.visible) {
        const origin = this.player.position.clone();
        origin.y += 1.62;
        const dir = new THREE.Vector3();
        this.renderer.camera.getWorldDirection(dir);
        const rp = this._findRemoteByRay(origin, dir, 4);
        if (rp) {
          this.net.sendAttackPlayer(rp.id, this.getAttackDamage());
          this.controls.mouseLeft = false;
          return;
        }
      }
      // 先尝试攻击怪物
      if (this.mobManager && !this.inventoryScreen?.visible) {
        const origin = this.player.position.clone();
        origin.y += 1.62;
        const dir = new THREE.Vector3();
        this.renderer.camera.getWorldDirection(dir);
        const damage = this.player.creative ? 100 : this.getAttackDamage();
        const hit = this.mobManager.attackMob(origin, dir, 4, damage);
        if (hit) {
          this.controls.mouseLeft = false;
          return;
        }
      }
      
      if (!this.selectedBlock) return;
      const hit = this.selectedBlock;
      const def = BlockRegistry.getById(hit.id);
      if (!def) return;
      
      if (this.player.creative) {
        this.world.setBlock(hit.block.x, hit.block.y, hit.block.z, 0);
        if (this.redstone) this.redstone.onBlockChange(hit.block.x, hit.block.y, hit.block.z);
        this.controls.mouseLeft = false;
      } else if (this.player.survival) {
        // 挖掘进度
        const hardness = def.hardness;
        if (hardness < 0) { this.controls.mouseLeft = false; return; }
        this.breakingProgress += dt / hardness;
        this.breakMesh.visible = true;
        this.breakMesh.position.set(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5);
        this.breakMesh.material.opacity = Math.min(0.5, this.breakingProgress * 0.5);
        if (this.breakingProgress >= 1) {
          this.world.setBlock(hit.block.x, hit.block.y, hit.block.z, 0);
          if (this.redstone) this.redstone.onBlockChange(hit.block.x, hit.block.y, hit.block.z);
          this.breakingProgress = 0;
          this.breakMesh.visible = false;
          this.controls.mouseLeft = false;
          if (this.networkMode && this.net) {
            // 联机：生成物理掉落物（服务器广播 drop_spawn，各端看到同一个），谁都能拾取
            this.net.sendDropSpawn(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5, def.name, 1);
          } else {
            // 单机：简化直接进入背包
            this.inventory.add(def.name, 1);
            this.hotbar.update();
          }
        }
      } else if (this.player.spectator) {
        this.controls.mouseLeft = false;
      }
    } else {
      this.breakingProgress = 0;
      this.breakMesh.visible = false;
    }
    
    if (this.controls.mouseRight) {
      const hit = this.selectedBlock;
      const sel = this.inventory.getSelected();

      // 先处理食用：手持物品是食物且玩家不在创造/旁观模式且饥饿未满
      if (sel && this.player.survival) {
        const itemDef = ItemRegistry.getByName(sel.name);
        if (itemDef && itemDef.food && this.player.food < this.player.maxFood) {
          if (this.player.eat(itemDef)) {
            this.inventory.removeSelected(1);
            this.hotbar.update();
          }
          this.controls.mouseRight = false;
          return;
        }
      }

      // 先检查是否右键点击了工作台
      if (hit) {
        const targetDef = BlockRegistry.getById(hit.id);
        if (targetDef && targetDef.name === 'crafting_table') {
          this.inventoryScreen.show(3);
          this.controls.mouseRight = false;
          return;
        }
        // 红石交互：拉杆/按钮
        if (targetDef && this.redstone) {
          const interacted = this.redstone.onBlockInteract(hit.block.x, hit.block.y, hit.block.z, hit.id);
          if (interacted) {
            this.controls.mouseRight = false;
            return;
          }
        }
      }
      
      if (sel) {
        const placeX = hit.block.x + hit.normal.x;
        const placeY = hit.block.y + hit.normal.y;
        const placeZ = hit.block.z + hit.normal.z;
        
        // 检查是否会与玩家重叠
        const px = this.player.position.x, py = this.player.position.y, pz = this.player.position.z;
        if (placeX >= Math.floor(px - 0.3) && placeX <= Math.floor(px + 0.3) &&
            placeY >= Math.floor(py) && placeY <= Math.floor(py + 1.8) &&
            placeZ >= Math.floor(pz - 0.3) && placeZ <= Math.floor(pz + 0.3)) {
          return;
        }
        
        const blockDef = BlockRegistry.getByName(sel.name);
        if (blockDef) {
          this.world.setBlock(placeX, placeY, placeZ, blockDef.id);
          if (this.redstone) this.redstone.onBlockChange(placeX, placeY, placeZ);
          if (this.player.survival) {
            this.inventory.removeSelected(1);
            this.hotbar.update();
          }
        }
      }
      this.controls.mouseRight = false;
    }
  }

  updateSurvival(dt) {
    // 饥饿/生命恢复
    this.player.exhaustion += dt * 0.4;
    if (this.player.exhaustion >= 4) {
      this.player.exhaustion -= 4;
      if (this.player.saturation > 0) {
        this.player.saturation = Math.max(0, this.player.saturation - 1);
      } else if (this.player.food > 0) {
        this.player.food = Math.max(0, this.player.food - 1);
      }
    }
    
    if (this.player.food >= 18 && this.player.health < this.player.maxHealth) {
      this.player.health = Math.min(this.player.maxHealth, this.player.health + dt);
    }
    
    if (this.player.food <= 0 && this.player.health > 1) {
      this.player.health -= dt * 0.5;
    }
    
    // 摔落伤害
    if (this.player.onGround && this.player.velocity.y < -15) {
      const dmg = Math.floor(-this.player.velocity.y / 3 - 3);
      if (dmg > 0) {
        this.player.hurt(dmg, 'fall', true);
      }
    }
    
    if (this.player.health <= 0) {
      this.player.health = 0;
      if (this.deathScreen && !this.deathScreen.visible) {
        this.deathScreen.show();
        if (this.networkMode && this.net) {
          // 阶段6：死亡上报（含背包掉落列表）→ 服务器生成世界掉落物广播；随后清空背包
          this.net.sendPlayerDied();
          this.inventory.slots = new Array(this.inventory.size).fill(null);
          this.inventory.hotbarSelected = 0;
          if (this.hotbar) this.hotbar.update();
        }
      }
    }
  }

  respawn() {
    this.player.health = 20;
    this.player.food = 20;
    this.player.saturation = 5;
    this.player.exhaustion = 0;
    this.player.onFire = 0;
    this.player.invulnerable = 0;
    this.player.position.set(0.5, this.world.getHeightAt(0, 0) + 2, 0.5);
    this.player.velocity.set(0, 0, 0);
    // 观战结束：重置观战状态并恢复正常模式
    if (this.spectating) {
      this.spectating = false;
      this.spectateTargetId = null;
      this._specSmoothed = null;
      if (this._preSpectateMode && this.player.spectator) this.player.setMode(this._preSpectateMode);
      this._preSpectateMode = null;
    }
    if (this.networkMode && this.net) {
      // 阶段6：联机重生——背包已在死亡时清空，重新发放生存初始物品
      this.inventory.slots = new Array(this.inventory.size).fill(null);
      this.inventory.hotbarSelected = 0;
      this.inventory.add('wood_pickaxe');
      this.inventory.add('wood_axe');
      this.inventory.add('wood_sword');
      this.inventory.add('torch', 16);
      this.inventory.add('bread', 5);
      if (this.hotbar) this.hotbar.update();
      this.net.sendRespawn(this.player.position.x, this.player.position.y, this.player.position.z);
    }
  }

  // 进入观战模式（死亡后）：旁观模式自由飞行，相机可第一人称跟随存活玩家
  enterSpectate() {
    if (!this.running || this.spectating) return;
    this.spectating = true;
    this.spectateTargetId = null;
    this._specSmoothed = null;
    this._specSmoothYaw = 0;
    this._specSmoothPitch = 0;
    this._preSpectateMode = this.player.gamemode === 'spectator' ? 'survival' : this.player.gamemode;
    this.player.setMode('spectator'); // 旁观：穿墙自由飞行
    if (this.deathScreen) this.deathScreen.hideForSpectate();
    this.paused = false;
    if (this.controls) { this.controls.enabled = true; }
    if (document.pointerLockElement) document.exitPointerLock();
    // 自动跟随第一个存活玩家（若有）
    this.cycleSpectateTarget();
    this._spectateHint();
  }

  // 观战目标循环：在存活远端玩家间切换（targetId 循环）
  cycleSpectateTarget() {
    const alive = [...this.remotePlayers.values()].filter((rp) => !rp.dead);
    if (!alive.length) { this.spectateTargetId = null; return; }
    const ids = alive.map((rp) => rp.id);
    const idx = ids.indexOf(this.spectateTargetId);
    this.spectateTargetId = ids[(idx + 1) % ids.length];
    this._specSmoothed = null; // 阶段6：切换目标即重置平滑，直接贴合新目标（避免跨图横扫）
    this._specSmoothYaw = 0;
    this._specSmoothPitch = 0;
  }

  // 观战提示（聊天栏显示当前跟随目标 / 操作说明）
  _spectateHint() {
    if (!this.chatBox) return;
    const rp = this.spectateTargetId != null ? this.remotePlayers.get(this.spectateTargetId) : null;
    const who = rp ? `跟随 ${rp.name}` : '自由飞行（无存活玩家）';
    this.chatBox.add(`观战中 · ${who} · F5 切换目标 / R 重生`, '#aac');
  }

  // 每帧观战相机：跟随目标时第一人称视角贴合目标（平滑后的位置/朝向）；无目标则自由飞行（spectator 已穿墙）
  updateSpectateCamera() {
    if (!this.spectating) return;
    const rp = this.spectateTargetId != null ? this.remotePlayers.get(this.spectateTargetId) : null;
    if (!rp || rp.dead) {
      if (this.spectateTargetId != null) this.spectateTargetId = null; // 目标死亡/离开，回到自由
      return;
    }
    const cam = this.renderer.camera;
    cam.position.copy(this.player.position); // 已被 update() 平滑吸附到目标附近
    cam.position.y += 1.62; // 视点高度
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this._specSmoothed ? this._specSmoothYaw : rp.yaw;
    cam.rotation.x = this._specSmoothed ? this._specSmoothPitch : rp.pitch;
  }

  getAttackDamage() {
    const sel = this.inventory.getSelected();
    if (!sel) return 1;
    const item = ItemRegistry.getByName(sel.name);
    if (item && item.tool === 'sword') return 2 + (item.tier || 1) + 2;
    if (item && item.tool === 'axe') return 2 + (item.tier || 1);
    return 1;
  }

  // 射线检测远端玩家（简化球体检测，半径 0.5，高度 1.8），返回命中的 RemotePlayer 或 null
  _findRemoteByRay(origin, dir, maxDist) {
    let best = null, bestDist = maxDist;
    for (const rp of this.remotePlayers.values()) {
      if (rp.dead) continue;
      const oc = new THREE.Vector3().subVectors(origin, rp.group.position);
      const b = oc.dot(dir);
      const c = oc.dot(oc) - 0.5 * 0.5;
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > bestDist) continue;
      const hy = origin.y + dir.y * t;
      if (hy < rp.group.position.y || hy > rp.group.position.y + 1.8) continue;
      bestDist = t;
      best = rp;
    }
    return best;
  }

  stop() {
    this.running = false;
  }

  // 返回主菜单，save=true 时保存存档到当前槽位
  returnToMenu(save = true) {
    if (save && this.world && !this.networkMode) {
      SaveSystem.save(this);
    }
    this.stop();
    // 清理旧世界 Three.js 资源和 UI DOM，防止回到菜单再进新存档时残留
    this._disposeWorld();
    // 联机：断开网络连接并复位联机状态
    if (this.net) this.net.close();
    this.networkMode = false;
    if (this.infoBar) this.infoBar.hide();
    this.paused = false;
    if (this.controls) this.controls.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.onExit) this.onExit();
  }
}
