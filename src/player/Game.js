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
import { ChestScreen } from '../ui/ChestScreen.js';
import { TradeScreen } from '../ui/TradeScreen.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { DeathScreen } from '../ui/DeathScreen.js';
import { CommandPanel } from '../ui/CommandPanel.js';
import { ChatBox } from '../ui/ChatBox.js';
import { CHUNK_SIZE } from '../core/Chunk.js';
import { matchRecipe } from '../core/Crafting.js';
import { MobManager } from '../entity/MobManager.js';
import { VoxelLightUniforms } from '../render/VoxelLight.js';
import { RedstoneSystem } from '../core/RedstoneSystem.js';
import { SaveSystem } from '../core/SaveSystem.js';
import { getDimension } from '../core/dimensions.js';
import { FirstPersonHand } from '../render/FirstPersonHand.js';
import { ParticleSystem } from '../render/ParticleSystem.js';
import { loadSettings, applySettings, applyFogRange } from '../core/Settings.js';
import { playerColorCss } from '../net/playerColor.js';

// 触发方块/物品定义注册
import '../blocks/BlockDefs.js';
import '../items/ItemDefs.js';
import { BlockSVGDefinitions } from '../blocks/BlockDefs.js';
import { ItemSVGDefinitions } from '../items/ItemDefs.js';

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
    // 视频设置：加载并实时套用（FOV/亮度/云/灵敏度/AO 等，主菜单期即可生效）
    this.settings = loadSettings();
    applySettings(this);
    this.raycast = null;
    this.chunkBuilder = null;
    this.world = null;
    this.hotbar = null;
    this.inventoryScreen = null;
    this.chestScreen = null;
    this.tradeScreen = null;
    this.pauseMenu = null;
    this.deathScreen = null;
    this.commandPanel = null;
    this.cheatsEnabled = false;
    this.paused = false;
    // 阶段10：第一人称手持物（跨存档共享相机挂点，start 时重置手持内容）
    this.hand = new FirstPersonHand(this);
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
      if (this.chestScreen && this.chestScreen.visible) return;
      if (this.tradeScreen && this.tradeScreen.visible) return;
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
    // 粒子系统（新建型：随世界销毁）
    if (this.particles) { this.particles.dispose(); this.particles = null; }
    if (this.fireParticles) { this.fireParticles.dispose(); this.fireParticles = null; }
    // 旧 UI DOM
    if (this.hotbar) { this.hotbar.el.remove(); this.hotbar = null; }
    if (this.inventoryScreen) {
      if (this.inventoryScreen.tooltip) this.inventoryScreen.tooltip.remove();
      if (this.inventoryScreen.cursorEl) this.inventoryScreen.cursorEl.remove();
      this.inventoryScreen.el.remove();
      this.inventoryScreen = null;
    }
    if (this.chestScreen) { this.chestScreen.dispose(); this.chestScreen = null; }
    if (this.tradeScreen) { this.tradeScreen.dispose(); this.tradeScreen = null; }
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
    // 阶段10：重置第一人称手持物（跨存档共享实例，物品由下方物品栏初始化后同步）
    this.hand.currentName = undefined;
    this.hand.itemGroup.clear();
    this.hand.setVisible(true);
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

    // 维度：存档携带（V2）或新建默认主世界；世界与天空档案按维度装配
    const dimension = (loadData && loadData.dimension) || 'overworld';
    this.world = new World(seed, dimension);
    if (this.sky) this.sky.applyDimensionProfile(this.world.dimDef);
    this.physics.world = this.world;
    // M4：网络方块钩子必须趁早绑定——start 的异步加载窗口（图集构建/区块加载/
    // 换维等待）内 world 已可用，此时本地放置方块也要上报服务器（曾因绑定过晚
    // 丢失换维后立即放置的方块，联机账本不收敛）
    if (this.networkMode && this.net) this.net.bindWorld(this.world);
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
    
    // 恢复修改的方块/容器：V2 按维度分桶装入；V1 旧档字段直接进当前维度桶（迁移）
    if (loadData && (loadData.dimensionBlocks || loadData.dimensionContainers)) {
      this.world.loadDimensionBuckets(loadData.dimensionBlocks, loadData.dimensionContainers);
    } else {
      if (loadData && loadData.modifiedBlocks) {
        for (const [key, id] of Object.entries(loadData.modifiedBlocks)) {
          this.world.modifiedBlocks.set(key, id);
        }
      }
      // T5：恢复打开过/改过的容器（箱子）
      if (loadData && loadData.containers) {
        for (const [key, items] of Object.entries(loadData.containers)) {
          if (Array.isArray(items) && items.length === 27) this.world.containers.set(key, items);
        }
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
    // 粒子系统（新建型：每次 start 重建，_disposeWorld 释放）
    this.particles = new ParticleSystem(this.renderer.scene, atlasTexture, atlasUV, 0.12);
    this.fireParticles = new ParticleSystem(this.renderer.scene, atlasTexture, atlasUV, 0.09);
    // 爆炸销毁方块时的碎屑粒子出口（TNT / 苦力怕爆炸共用）
    this.redstone.onBlockDestroyed = (x, y, z, def) => {
      if (this.particles) this.particles.burstBlockBreak(x + 0.5, y, z + 0.5, def, this.world, 10);
    };
    this.mobManager.onBlockDestroyed = (x, y, z, def) => {
      if (this.particles) this.particles.burstBlockBreak(x + 0.5, y, z + 0.5, def, this.world, 8);
    };
    // 新建的粒子系统按视频设置套密度（其余项已在构造时套用，跨存档不变）
    applySettings(this);
    // 用图集初始化怪物材质
    this.mobManager.atlasUV = atlasUV;
    this.mobManager.atlasTexture = atlasTexture;
    await this.mobManager.buildMaterials();
    
    // 出生点：存档坐标 > 维度出生点（新建存档 / 换维，dimensionSpawn 标记忽略存档坐标）
    const spawn = this.world.getSpawnPoint();
    // 生成初始区块（以落点为中心，保证周围有地形；主世界 (0.5, 地表+2, 0.5) 行为不变）
    const center = (loadData && loadData.player && !loadData.dimensionSpawn) ? loadData.player : spawn;
    const pcx = Math.floor(center.x / CHUNK_SIZE), pcz = Math.floor(center.z / CHUNK_SIZE);
    const loadFill = document.getElementById('load-fill');
    const chunks = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        chunks.push([pcx + dx, pcz + dz]);
      }
    }
    let i = 0;
    for (const [dx, dz] of chunks) {
      this.world.ensureChunk(dx, dz);
      if (loadFill) loadFill.style.width = `${(i / chunks.length) * 100}%`;
      i++;
      await new Promise(r => setTimeout(r, 0));
    }

    // 玩家位置
    if (loadData && loadData.player && !loadData.dimensionSpawn) {
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
      this.player.position.set(spawn.x, spawn.y, spawn.z);
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
    this.chestScreen = new ChestScreen(this);
    this.tradeScreen = new TradeScreen(this);
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
      // 方块同步钩子已在 start() 前段趁早绑定（见 new World 处），此处不重复
      // 联机拾取掉落物：通知服务器移除并广播
      if (this.mobManager) this.mobManager.onDropTaken = (id) => this.net.sendDropTaken(id);
      // 阶段10：归属锁判定需要本地联机 id（死亡掉落物锁定期内他人不可拾取）
      if (this.mobManager) this.mobManager.getSelfId = () => (this.net ? this.net.selfId : null);
      // 阶段10：拾取被归属锁拒绝（drop_deny）→ 从背包扣回 + 凭服务器补发的 drop_spawn 重建实体
      this.net.on('drop_deny', ({ id }) => {
        const info = this.mobManager ? this.mobManager.takePendingPickup(id) : null;
        if (!info) return; // 未抢先拾取（本地预判已拦下），无需回滚
        this.inventory.removeItems(info.name, info.count);
        if (this.hotbar) this.hotbar.update();
        if (this.chatBox) this.chatBox.add('该掉落物仍归属其主人，已归还。', '#fa8');
      });
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
        if (this.chestScreen && this.chestScreen.visible) { this.chestScreen.hide(); return; }
        if (this.tradeScreen && this.tradeScreen.visible) { this.tradeScreen.hide(); return; }
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
        if (this.chestScreen && this.chestScreen.visible) {
          this.chestScreen.hide();
          return;
        }
        if (this.tradeScreen && this.tradeScreen.visible) {
          this.tradeScreen.hide();
          return;
        }
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
      // 熔岩点燃（离开熔岩后延续 onFire 秒再熄灭）；入水即灭火
      if (p.inWater) {
        p.onFire = 0;
      } else {
        const feetDef = BlockRegistry.getById(this.world.getBlock(bx, Math.floor(p.position.y + 0.2), bz));
        const inLava = !!(def && def.fluid && def.name === 'lava') || !!(feetDef && feetDef.fluid && feetDef.name === 'lava');
        if (inLava) p.onFire = 3;
      }
    }
  }

  // 燃烧表现：着火实体喷火焰+烟，玩家着火叠屏幕火光
  _updateFireEffects(dt) {
    // 玩家自身
    const p = this.player;
    if (p.onFire > 0) {
      if (this.fireParticles) {
        this.fireParticles.flameBox(p.position.x, p.position.y + 0.3, p.position.z, 0.5, 1.4, 0.5);
      }
      if (this.hud) this.hud.setOnFire(true);
      p.onFire = Math.max(0, p.onFire - dt);
      // 火焰灼烧：每秒 1 血（生存；低频伤害按约定不走红屏）
      if (p.survival) {
        this._fireTick = (this._fireTick || 0) + dt;
        if (this._fireTick >= 1) {
          this._fireTick = 0;
          p.health = Math.max(0, p.health - 1);
        }
      }
    } else {
      this._fireTick = 0;
      if (this.hud) this.hud.setOnFire(false);
    }
    // 燃烧中的怪物（日光燃烧的僵尸/骷髅等）
    if (this.fireParticles && this.mobManager && this.mobManager.mobs) {
      const emit = (this.frame % 5) === 0; // ~0.3s 一波
      if (emit) {
        for (const mob of this.mobManager.mobs) {
          if (!mob.isBurning || mob.dead) continue;
          this.fireParticles.flameBox(mob.position.x, mob.position.y + 0.2, mob.position.z,
            Math.max(0.5, mob.width * 0.8), mob.height * 0.95, Math.max(0.5, mob.width * 0.8));
        }
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
    
    // 体素光昼夜系数与天光染色：所有区块材质共享 uniform，逐帧更新无需重建网格
    //（Sky.getLightLevel 已按维度档案覆盖——下界/末地恒定；sunTint 可被维度档案固定）
    const lp = this.world.dimDef.light;
    VoxelLightUniforms.uDayLight.value = 0.10 + 0.90 * this.sky.getLightLevel();
    if (lp.sunTint) {
      VoxelLightUniforms.uSunTint.value.setRGB(lp.sunTint[0], lp.sunTint[1], lp.sunTint[2]);
    } else if (this.sky.sunTint) {
      VoxelLightUniforms.uSunTint.value.copy(this.sky.sunTint);
    }

    // 水下视野雾效（出水恢复的雾距与 applySettings 同源，随渲染距离收口 + 维度雾系数）
    const fog = this.renderer.scene.fog;
    if (fog) {
      if (this.player.inWater) {
        fog.color.setRGB(0.1, 0.25, 0.45);
        fog.near = 0;
        fog.far = 24;
      } else {
        applyFogRange(fog, this.settings.renderDistance, this.world.dimDef.sky ? this.world.dimDef.sky.fog : null);
      }
    }
    // 水下屏幕滤镜（HUD 蓝色薄纱）
    this.hud.setUnderwater(this.player.inWater);

    // 粒子系统推进
    if (this.particles) this.particles.update(dt);
    if (this.fireParticles) this.fireParticles.update(dt);
    this._updateFireEffects(dt);

    // 水面流动（水纹理 UV 沿 v 滚动，RepeatWrapping）
    if (this.waterTexture) {
      this.waterTexture.offset.y = (this.waterTexture.offset.y + dt * 0.06) % 1;
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
      this.infoBar.update(this.player, this.world.generator, this.sky, this.crosshairInfo,
        this.networkMode && this.net ? this.net.rttMs : null, // 阶段10：联机时显示 RTT
        this.world.dimension !== 'overworld' ? this.world.dimDef.name : null); // 非主世界显示维度
    }

    // 阶段10：第一人称手持物（物品变化检测 + bob/挥动；观战与旁观隐藏）
    this.hand.setVisible(!this.spectating && !this.player.spectator);
    {
      const sel = this.inventory.getSelected();
      const selName = sel ? sel.name : null;
      if (selName !== this.hand.currentName) this.hand.setItem(selName);
    }
    this.hand.update(dt,
      Math.hypot(this.player.velocity.x, this.player.velocity.z) > 0.8,
      this.controls.isSprinting());

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
    const renderDistance = this.settings ? this.settings.renderDistance : 6;

    // 加载（分帧预算）：跨入新区块列时一次会缺 13+ 个区块，全量同步生成曾致单帧
    // 690ms 卡顿。收集缺口 → 按距玩家距离排序（脚下优先）→ 每帧限时生成。
    // 生成是纯函数且顺序无关（structure-determinism 顺序测试背书），分帧无正确性影响。
    const missing = [];
    for (let dx = -renderDistance; dx <= renderDistance; dx++) {
      for (let dz = -renderDistance; dz <= renderDistance; dz++) {
        if (!this.world.getChunk(pcx + dx, pcz + dz)) {
          missing.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
        }
      }
    }
    if (missing.length) {
      missing.sort((a, b) => a[2] - b[2]);
      const t0 = performance.now();
      let made = 0;
      for (const [cx, cz] of missing) {
        this.world.ensureChunk(cx, cz);
        made++;
        // 至少 1 块保证推进（首次进入世界也按预算渐次补齐）；超 8ms 停手让出帧
        if (made >= 1 && performance.now() - t0 > 8) break;
      }
    }

    // 卸载（距离过远）
    const maxDist = renderDistance + 2;
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
    // 时间预算制（W-卡顿批次）：洞穴后单块 mesh ~15ms，固定"2 个/帧"会叠加出 29ms+
    // 重建帧；改为限时 ~12ms（至少 1 块保证推进）。遍历序=加载序（近似近处优先）。
    const t0 = performance.now();
    let count = 0;
    for (const [, chunk] of this.world.chunks) {
      if (!chunk.dirty) continue;
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
      if (count >= 1 && performance.now() - t0 > 12) break;
    }
  }

  // T5：箱子被本地破坏 → 容器内容散落 + 清容器数据；开着的箱子界面一并关闭
  _breakChest(block, dropContents) {
    const items = this.world.getContainer(block.x, block.y, block.z);
    this.world.removeContainer(block.x, block.y, block.z);
    if (this.chestScreen && this.chestScreen.visible && this.chestScreen.pos &&
        this.chestScreen.pos.x === block.x && this.chestScreen.pos.y === block.y &&
        this.chestScreen.pos.z === block.z) {
      this.chestScreen._changed = false; // 容器已销毁，hide 不再上报
      this.chestScreen.hide();
    }
    if (!items || !dropContents) return;
    for (const s of items) {
      if (!s) continue;
      if (this.networkMode && this.net) {
        this.net.sendDropSpawn(block.x + 0.5, block.y + 0.5, block.z + 0.5, s.name, s.count);
      } else if (this.mobManager) {
        this.mobManager.spawnDrop(
          new THREE.Vector3(block.x + 0.5, block.y + 0.5, block.z + 0.5), s.name, s.count);
      }
    }
  }

  // T5：容器修改上报出口（ChestScreen 每次改动调用）；联机整箱广播，单机 noop
  onContainerChanged(pos, items) {
    if (this.networkMode && this.net) this.net.sendContainerSet(pos.x, pos.y, pos.z, items);
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
    if (this.chestScreen && this.chestScreen.visible) return;
    if (this.tradeScreen && this.tradeScreen.visible) return;
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
          this.hand.swing(); // 阶段10：命中远端玩家挥动
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
          this.hand.swing(); // 阶段10：命中怪物挥动
          this.controls.mouseLeft = false;
          return;
        }
      }
      
      if (!this.selectedBlock) return;
      const hit = this.selectedBlock;
      const def = BlockRegistry.getById(hit.id);
      if (!def) return;
      
      if (this.player.creative) {
        if (this.particles) this.particles.burstBlockBreak(hit.block.x + 0.5, hit.block.y, hit.block.z + 0.5, def, this.world);
        if (def.name === 'chest') this._breakChest(hit.block, false);
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
        // 挖掘中小碎粒（每 0.25s 一两粒）
        this._miningPuffTimer = (this._miningPuffTimer || 0) + dt;
        if (this._miningPuffTimer >= 0.25 && this.particles) {
          this._miningPuffTimer = 0;
          this.particles.puffMining(hit.block.x + 0.5, hit.block.y, hit.block.z + 0.5, def, this.world);
        }
        if (this.breakingProgress >= 1) {
          if (this.particles) this.particles.burstBlockBreak(hit.block.x + 0.5, hit.block.y, hit.block.z + 0.5, def, this.world);
          if (def.name === 'chest') this._breakChest(hit.block, true);
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
      // T5：右键村民优先交互（开交易屏；旁观不可）
      if (this.mobManager && this.tradeScreen && !this.player.spectator) {
        const o = this.player.position.clone();
        o.y += 1.62;
        const d = new THREE.Vector3();
        this.renderer.camera.getWorldDirection(d);
        const mh = this.mobManager.findMobByRay(o, d, 4);
        if (mh && mh.mob.typeName === 'villager' && !mh.mob.dead) {
          this.tradeScreen.show(mh.mob);
          this.controls.mouseRight = false;
          return;
        }
      }

      const hit = this.selectedBlock;
      const sel = this.inventory.getSelected();

      // 先处理食用：手持物品是食物且玩家不在创造/旁观模式且饥饿未满
      if (sel && this.player.survival) {
        const itemDef = ItemRegistry.getByName(sel.name);
        if (itemDef && itemDef.food && this.player.food < this.player.maxFood) {
          if (this.player.eat(itemDef)) {
            this.hand.swing(); // 阶段10：进食挥动
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
        // T5：右键箱子打开容器界面（创造/生存都可；旁观不可）
        if (targetDef && targetDef.name === 'chest' && this.chestScreen && !this.player.spectator) {
          this.chestScreen.show(hit.block.x, hit.block.y, hit.block.z);
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
          this.hand.swing(); // 阶段10：放置方块挥动
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

    // 虚空伤害（末地/天域等无底维度）：y<-16 持续扣血（持续伤害口径，不走红屏）
    if (this.world.dimDef.hasVoid && this.player.position.y < -16) {
      this.player.health -= dt * 6;
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
    // 重生到当前维度出生点（跨维度回主世界重生需重建世界，此处不切换维度）
    const sp = this.world.getSpawnPoint();
    this.player.position.set(sp.x, sp.y, sp.z);
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

  // 维度切换（M1 单机 / M4 联机）：把当前完整状态合成 loadData 重走 start()——
  // 保留背包/血量/xp/时间与全部维度账本，落到目标维度出生点
  async switchDimension(dim) {
    if (!this.running || !this.world) return false;
    const def = getDimension(dim);
    if (!def || !def.implemented) return false;
    if (this.networkMode) {
      // M4 联机：服务器权威——发请求，收 DIMENSION_WORLD 回执后由 applyDimensionWorld 落地
      if (!this.net || dim === this.world.dimension) return false;
      if (this.chatBox) this.chatBox.add(`正在切换到「${def.name}」…`, '#8f8');
      this.net.sendSwitchDimension(dim);
      return true;
    }
    if (dim === this.world.dimension) return false;
    return this._enqueueDimensionSwitch(async () => {
      // 检查在出队时再做（排队期间维度可能已被更早的任务改变）
      if (!this.running || !this.world || dim === this.world.dimension) return false;
      const loadData = this._composeSwitchLoadData(dim, null, null);
      await this.start(loadData.gamemode, loadData.seed, loadData, this.currentSlot, loadData.cheatsEnabled, this.networkMode);
      return true;
    });
  }

  // 维度重建串行化：start() 不可重入——连续换维（上一次重建未完成）并发执行会互相
  // 覆盖共享子系统，表现为"切过去又弹回旧维度"。所有维度重建走同一 promise 链。
  _enqueueDimensionSwitch(job) {
    const run = (this._dimSwitchJob || Promise.resolve()).then(job, job);
    this._dimSwitchJob = run.catch(() => {});
    return run;
  }

  // 合成换维用 loadData（单机用本地全维账本；联机传入服务器权威的目标维账本覆盖）
  _composeSwitchLoadData(dim, dimBlocksOverride, dimContainersOverride) {
    const p = this.player;
    const dimBuckets = {};
    for (const [d, m] of this.world.dimensionBlocks) dimBuckets[d] = Object.fromEntries(m);
    if (dimBlocksOverride) dimBuckets[dim] = dimBlocksOverride;
    const contBuckets = {};
    for (const [d, m] of this.world.dimensionContainers) contBuckets[d] = Object.fromEntries(m);
    if (dimContainersOverride) contBuckets[dim] = dimContainersOverride;
    return {
      seed: this.world.seed,
      gamemode: p.gamemode,
      cheatsEnabled: this.cheatsEnabled,
      dimension: dim,
      dimensionSpawn: true, // 忽略合成存档中的坐标，落到目标维度出生点
      player: {
        yaw: p.yaw, pitch: p.pitch, health: p.health, food: p.food,
        saturation: p.saturation, exhaustion: p.exhaustion,
        xp: p.xp, xpLevel: p.xpLevel, onFire: 0, airTicks: 300
      },
      inventory: this.inventory.serialize(),
      dimensionBlocks: dimBuckets,
      dimensionContainers: contBuckets,
      redstone: this.redstone ? this.redstone.serialize() : null,
      sky: { time: this.sky ? this.sky.time : 0.35 }
    };
  }

  // M4 联机换维落地：服务器 dimension_world 回执（目标维度权威账本）→ 重建本地世界
  //（走维度重建串行链——连续换维不并发 start()）
  applyDimensionWorld(dim, blockList, containerList) {
    if (!this.running || !this.world) return Promise.resolve(false);
    const def = getDimension(dim);
    if (!def || !def.implemented) return Promise.resolve(false);
    return this._enqueueDimensionSwitch(async () => {
      if (!this.running || !this.world) return false;
      const key3 = (v) => { const n = Number(v); return Number.isInteger(n) && Math.abs(n) <= 30000000 ? n : 0; };
      const dimBlocks = {};
      for (const b of blockList || []) dimBlocks[`${key3(b.x)},${key3(b.y)},${key3(b.z)}`] = key3(b.id) | 0;
      const dimContainers = {};
      for (const c of containerList || []) {
        if (Array.isArray(c.items) && c.items.length === 27) {
          dimContainers[`${key3(c.x)},${key3(c.y)},${key3(c.z)}`] = c.items;
        }
      }
      const sameDim = this.world.dimension === dim;
      if (sameDim) {
        // 同维账本收敛（重连/重复回执）：不重建世界，直接覆盖本地桶并重载受影响区块
        this.world.loadDimensionBuckets(
          { [dim]: dimBlocks }, { [dim]: dimContainers }
        );
        this.world.markAllDirty();
        return true;
      }
      const loadData = this._composeSwitchLoadData(dim, dimBlocks, dimContainers);
      await this.start(loadData.gamemode, loadData.seed, loadData, this.currentSlot, loadData.cheatsEnabled, this.networkMode);
      if (this.chatBox) this.chatBox.add(`已切换到「${def.name}」`, '#8f8');
      return true;
    });
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
    if (this.hud) this.hud.setUnderwater(false);
    this.paused = false;
    if (this.controls) this.controls.enabled = false;
    if (this.hand) this.hand.setVisible(false); // 回菜单不显示第一人称手臂
    if (this.hud) this.hud.setOnFire(false);
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.onExit) this.onExit();
  }
}
