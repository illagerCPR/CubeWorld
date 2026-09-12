# Agent 备忘 · UI 与综合

> 本文件内容为 AGENTS.md 批次备忘**原文搬移（未改写）**，用于控制 AGENTS.md 体积（会话注入预算 65536 字节，超限会被静默截断）。
> 导航见 AGENTS.md「批次备忘索引」；新批次备忘按主题追加到对应小节，并同步更新 AGENTS.md 索引表。

### CubeWorld 改造批次备忘（防回退）—— 改名/全景/粒子/物品重绘/视频设置

- **仓库已改名 CubeWorld**（原 Web-MC），GitHub 仓库与本地 remote 均为新地址；**localStorage 存档前缀 `project-mc-save-` 特意不改**（改名会孤立所有浏览器现有存档）。物理目录 `project-mc/` 保留（会话工作目录依赖）。
- **渲染器包装类陷阱（曾致主菜单白屏）**：`game.renderer` 是 `Renderer` **包装类**，其 `render()` **无参**、固定渲染游戏 scene/camera——子系统想自己画别的场景（如 Panorama）必须取底层 `game.renderer.renderer`（THREE.WebGLRenderer），把 `(scene, camera)` 传给包装类会被静默忽略（不报错、帧帧渲染空游戏场景 → 白屏）。PanoramaBake 与 Panorama 两处均已按此写法，新渲染入口勿持包装类调 render。菜单期 `Game.loop` 因 `running=false` 自停，画布仅由 Panorama `_tick` 驱动，无双渲染打架。
- **主菜单全景背景（预烘焙播放器）**：`src/render/Panorama.js` 播放 `res/panorama/{px,nx,py,ny,pz,nz}.jpg`（512² 六面 90°，~280KB）——BoxGeometry(BackSide) 内壁天空盒自转 + 动态云层（`makeCloudTexture` 从 Sky.js 导出，纹理 offset 漂移）。**勿回退实时渲染小世界**：构建等待 2-4s、机位难控、无头验证困难。水平面贴图需 flipH（repeat.x=-1）校正盒内镜像，py/ny 旋转 180°。烘焙工具 `src/render/PanoramaBake.js`（URL `?bake-panorama=1` 触发，main.js 分支）——复用同款 vantage 评估（雪原占比/近景平整度），产出 `window.bakedFaces` 手动落盘 res/panorama/；换机位重烘即可。天空盒 BoxGeometry 面序 [+x,-x,+y,-y,+z,-z]。菜单期不再驱动体素光 uniform（无 chunk mesh）。激活期画布 CSS `blur(4px)+brightness(0.9)`，游戏期必须清除。
- **粒子系统**：`src/render/ParticleSystem.js`（THREE.Points + 顶点色 + 对象池 1600 swap-with-last）。两个实例：`game.particles`（方块碎屑 size 0.12，生成时从图集 canvas 采样贴图像素色并按体素光衰减）/ `game.fireParticles`（火焰烟 size 0.09，自发光不衰减）。**新建型子系统**：`start()` 创建、`_disposeWorld()` dispose。爆炸碎屑经 `redstone.onBlockDestroyed` / `mobManager.onBlockDestroyed` 回调（Game.start 注入，回调内必须判空 `this.particles`）。熔岩点燃：`_updateWaterState` 判脚/眼在熔岩 → `player.onFire=3`（入水即灭），`_updateFireEffects` 每秒 1 血（低频伤害不走红屏）+ 火焰粒子 + `hud.setOnFire` 火屏滤镜。
- **视频设置**：`src/core/Settings.js`（localStorage key `cubeworld-settings`，全局不按存档）+ `src/ui/VideoSettings.js`（**app 级单例**，PauseMenu 与 MenuScreen 共用）。渲染距离改的是 `game.settings.renderDistance`（旧 RENDER_DISTANCE 常量已删）；平滑光照开关写 `ChunkMesh.js` 导出的 `RenderQuality`，**切换后必须 `world.markAllDirty()`**；MenuScreen 的入口按钮用**事件委托挂构造期**（render() 重建 innerHTML 后仍有效，勿改回 per-render 绑定）。VideoSettings 的 ESC 用 document capture 拦截（stopPropagation），防止同一次按键穿透到暂停菜单切换。
- **物品重绘**：`ItemDefs.js` 用 `art()` 助手（g.s/g.r/g.d/g.h 对角柄/g.spi 撒点）+ `P` 调色板（[亮,基,暗] 三色纪律）；**撒点必须用确定性 `rng(seed)`**，勿回退 Math.random（破坏确定性生成约定）。注册名与 def 字段（stack/food/tool/tier/durability/damage）是存档/合成兼容面，**不得改动**。
- **Hud 准星**：构造期默认 display:none（原 updateVisibility('creative') 初始化会让准星在主菜单可见）；进游戏后 update()/updateVisibility() 按模式接管。
- **无头截图伪影**：本环境 agent-browser screenshot 对持续渲染的 WebGL 画布可能在数秒后冻结在旧帧（合成器表面不更新），**验证全景/粒子等画面以 `gl.readPixels` 帧缓冲导出为准**（eval 内 render→readPixels→小画布→toDataURL），DOM 截图不受影响。

### JEI 伴随面板批次备忘（防回退）—— 容器界面内嵌配方查询（原独立浮层已改版）

- **RecipeViewer 是"伴随面板"非独立浮层**：`updateFrame()` 每帧（Game.update 内）同步 `containerVisible`（inventory/chest/furnace/trade 四 screen 任一 visible）；`visible = containerVisible && userEnabled`（J 键偏好，localStorage `cubeworld-jei-panel-enabled`）。**不再接管 controls / 不进 ESC、handleMouseInput、pauseOnUnlock guard 登记**（随容器界面显隐，容器界面自身已处理指针与按键）——勿回退为给 Game 四处 guard 加 recipeViewer。
- **新增容器类 UI 必须把它的 visible 加进 `RecipeViewer.updateFrame` 的 containerVisible 检测**，否则面板不跟随新界面显隐。
- **J 键双语义**：容器界面打开时 `togglePanel()`；无容器界面时打开背包（面板随之自动出现）。R/U 作用目标优先级：面板内 `_hoverName` > `game._uiHoverName()`（容器内悬浮）> `current`（弹窗当前物品），全在 `_actionTarget()` 一处；showFor/showUsages 内 `_ensureShown()`——面板被 J 关闭时主动查询配方会重新启用面板。
- **布局**：右缘竖条（搜索 + 左收藏夹列 + 右全物品网格，fixed right:6px，z-index 35）；配方详情弹窗在竖条左侧（`popEl`，right:214px），显示条件 `current && _shown`，✕ 关闭；点物品/配方材料格继续导航，右键=用途，A 收藏（localStorage `cubeworld-jei-favorites` 全局持久）。
- **冒烟注意**：eval 内 show/toggle 后面板 DOM 状态下一帧才被 updateFrame 刷新，同步断言会假阴性——sleep ≥0.3s 再断言；物品名在 `title` 属性不在 innerText。
- **布局已二次重构（围绕物品栏，勿回退为右缘竖条）**：三块常驻 fixed 面板按**当前容器 panel 的 getBoundingClientRect 动态定位**——收藏夹（加宽 1-3 列 40px 格）贴 panel 左侧、全物品列表（加宽 3-9 列 40px 格，顶部搜索框）贴 panel 右侧、配方弹窗（z-index 36）居中覆盖 panel 之上；`_layout()` 在 updateFrame 内每帧 dirty-check（rect+视口+弹窗开关为 key，无变化不写 style 防 reflow），列数按 panel 两侧剩余空间自适应。`_visiblePanel()` 与 containerVisible 检测同源——**新增容器 UI 两处都要加**。弹窗显隐在 renderRecipe 内、定位在 _layout（key 含 popOn，弹窗开关会触发重排）。

### 命令面板（作弊系统）

- 仅 `game.cheatsEnabled === true` 的存档允许按 C 打开命令面板；该标志在存档创建时由菜单"启用命令"复选框一次性确定（与原版 Minecraft 创建世界时定"允许作弊"一致），存的存档载入后自动恢复。
- `src/ui/CommandPanel.js`：构造 `(game)`，挂 panel DOM 到 body。四大功能：① `_teleport()` 通过 `game.player.position.set(x,y,z)` + `velocity.set(0,0,0)` 实现；② 切换模式按钮直接调 `game.player.setMode(name)`；③ `_spawnMob(typeName)` 用 `new Mob(typeName, world)` + 把 `position` 设到玩家前方 3 格（按 `player.yaw` 计算 fx/fz）+ 地面高度 + 调 `mobManager.spawnMob(mob)`，类型限于 zombie/skeleton/creeper/spider；④ `_setTime(t)` 直接写 `game.sky.time = clamp(t,0,1)`，配合 4 个预设按钮（日出 0.25 / 正午 0.50 / 日落 0.75 / 半夜 0.00）和数字输入框 + "设为"按钮。`timeInput` step=0.05、min/max 0~1；`curTimeLabel` 显示当前值与中文时段（半夜/黎明前/日出/上午/正午/下午/日落/黄昏/入夜）。`show()` 时同步 `timeInput.value = sky.time.toFixed(2)` 并调用 `_refreshTimeLabel()`。
- `show()`/`hide()` 与其他 UI 一致：联动 `game.controls.enabled`、`exitPointerLock`、`game.paused=true/false`（与 PauseMenu/DeathScreen 同款设暂停）。`toggle()` 自管。
- `Game.setupKeyBindings()` 处理 C 键时三重门：`!this.cheatsEnabled` / `!this.running` / `deathScreen.visible` 任何一个为真不响应；ESC 优先关闭 commandPanel（point-lock unlock 路径里 `_setupPauseOnUnlock` 也加了 `commandPanel.visible` 防护，避免面板打开瞬间触发暂停菜单）。
- `CommandPanel` 是新建型 UI 子系统（每次 `start()` 重建，`_disposeWorld()` 末尾 `el.remove()`），与 InventoryScreen/PauseMenu/DeathScreen 同组。

### UI 子系统

- `Hotbar`：`flashName()` 在切换快捷栏槽位时显示物品名气泡 2 秒；数字键 / 滚轮切换处需主动调用。
- `Hud`：血量/饥饿行 `bottom:86px`，经验条 `bottom:72px`，都贴在快捷栏上方，改动二者距离时务必同步避免遮挡快捷栏。
- `InfoBar`：游戏内左上角 4+1 行 —— 坐标 / 生物群系 / 时间 / **准星目标**（`targetLine`）/ **网络 RTT**（联机时显示「网络: Xms」，`rttLine`）。`update(player, generator, sky, crosshairInfo, rttMs = null)` 第 4 个参数是 `{type:'block'|'mob', displayName, name}` 或 null，第 5 个参数为联机平滑 RTT（毫秒，null=单机隐藏该行）。`crosshairInfo` 由 `Game.updateRaycast()` 每帧算好并存到 `this.crosshairInfo`：方块 hit + mob hit 取较近者。Mob 命中靠 `MobManager.findMobByRay(origin, dir, maxDist)`（不伤害的纯查询版，球体射线检测半径 = `mob.height/2`，与 `attackMob` 同口径）。ator.getBiome()` 更新。
- `InventoryScreen`：每个 slot 通过 `_bindHover()` 挂载 mouseenter/mouseleave 悬浮 tooltip（显示 `displayName`）。`returnCursorItem()` / `hide()` 必须同时隐藏 tooltip。
- **创造栏去重陷阱**：`renderCreative()` 用 `[...BlockRegistry.all(), ...ItemRegistry.all()]` 合并展示列表。部分方块名在两边都注册——`lever` / `stone_button` 既在 `BlockDefs.js` 作方块又在 `ItemDefs.js` 作物品注册——不去重会出现两个相同物品槽。修复：方块优先，同名物品在合并时跳过。新加"既是方块也是物品"的项目时务必检查是否双注册。
- `PauseMenu` / `DeathScreen`：禁用 `controls.enabled` + `exitPointerLock`，hide 时恢复。`PauseMenu` 不要再自带 ESC 监听器（会与 Game 的 ESC 切换同一事件内既打开又关闭）。`Game._setupPauseOnUnlock()` 监听 `pointerlockchange` 在指针锁意外丢失时自动弹暂停菜单。

### Idea-3A 音频底座批次备忘（防回退）

- **`src/audio/AudioEngine.js` 模块级单例 `audio`**：WebAudio 程序化合成（零资产，延续 SVG 纹理思路），总线 sfx/music → master（音量+静音统一控制）。**所有发声入口 `if (!this.ctx) return` 静默早退**——headless/未解锁环境零副作用。
- **自动播放策略**：AudioContext 必须首次真实用户手势后创建——`main.js` 调 `audio.installUnlock()` 在 document capture 挂 pointerdown/keydown，`unlock()` 幂等（无 ctx 则建 + suspended 则 resume）。eval 里 `document.body.click()` 这类**合成事件不解锁**，必须 agent-browser 真实 `click`。
- **设置面**：`Settings.js` 新增 `sound: true` / `volume: 60`（clamp 0-100），`applySettings` 实时套 `audio.setEnabled/setVolume`；VideoSettings 面板加「音量」(步进 10 循环)、「音效」两行。**unlock 前改设置也不丢**——volume/enabled 记在实例字段，`_buildGraph()` 时回放。
- **材质分路**：`blockCategory(def)` 按名称启发式把方块归 9 类（stone/wood/gravel/grass/glass/metal/cloth/snow/liquid），`CATEGORY_PARAMS` 定滤波器/时长/增益，未命中回退 stone。新方块若音色怪，先查是否被启发式误分类。
- **接线锚点（全在 Game.js）**：挖掘命中音挂 **0.25s 挖掘碎粒定时器**（`_miningPuffTimer`，天然限频勿另加节流）；创造/生存破坏、放置、`player.onHurt`（与 flashDamage 同源）、食用（`player.eat` 成功分支）、`_releaseBow`、箭命中（`_updateArrows`，远端视觉箭也响）。
- **验证口径**：headless 听不到声，断言走引擎内部——eval 动态 `import('/src/audio/AudioEngine.js')`（与 Game.js 同模块实例，`window.__ae` 缓存）→ 包一层 `_noise/_tone` 计数 → 直调 7 个事件方法断言调用数/滤波频率；真实路径抽 3 条（创造挖掘/放置/生存长按）用同一计数探针验证。**headless 帧极慢**，生存长按 0.6s 可能攒不满 0.25s 碎粒节拍——延长按住时间再断言。

### Idea-3A-② 怪物音/脚步/BGM 批次备忘（防回退）

- **怪物语音**：`AudioEngine` 内 `VOICE_PRESETS` 按typeName 预设合成参数（tones+noise，音量克制 0.05~0.16），`_mobVoice(typeName, dist, mode)` mode=idle/hurt/death 决定音高（×1.35/×0.75）时长增益倍率；距离衰减 `att = 1 - dist/28`，>28 格全静音。**全局限频 `_gate('voice', 0.3)` 只门 idle**——受击/死亡是反馈音必须即时。新怪类型若不匹配预设回退 VOICE_DEFAULT；新增怪时在 VOICE_PRESETS 补一行。
- **钩子位置**：环境叫声在 `Mob.update` 顶部（dragon/shulker 早退分支**之前**，`_voiceTimer` 4-12s 随机）；受击/死亡在 `MobManager.attackMob`（扣血处判 dead）与 `applyRemoteMobAttack`（远端同步伤害也响）两处；距离用 `MobManager._playerPos`（update(dt,player,sky) 开头存）。**怪 vs 怪（mobAttackMob 链）不播受击音**——避免混战噪音，防回退勿加。
- **脚步/落地**：`Game._updateFootsteps(dt)` 在 Game.update 末段调用——**距离驱动步频**（累计水平位移 ≥2.1m，涉水 1.6m 播 splash），`_blockUnderFoot()` 贴脚格→脚下 0.45m 兜底（流体不算材质）；落地 = 上一帧 `_prevFallSpeed > 8` 且本帧 onGround 且不在水中。跨帧状态 `_wasOnGround/_prevFallSpeed/_stepDist` 是 Game 共享型字段，构造函数无需重置（数值型零值无害）。
- **环境音/BGM**：`audio.tickAmbient(dt, daylight)` 每帧由 Game.update 驱动——**计划式调度**（风声 swell 9-23s 随机 + BGM 和弦垫 4.6s 节拍 C-G-Am-F 低音区），无常驻节点，**暂停时 update 停止调用即自然静默**；全部走 music 分轨。`audio.resetAmbient()` 必须在 `Game.start` 调（sky.time 重置旁）——新存档继承上一局调度相位会显得"闹鬼"。
- **music 设置**：Settings `music: true` → `applySettings` 调 `audio.setMusicEnabled`（music 分轨 gain 0/0.5），VideoSettings 面板第三行「音乐」。
- **⚠️ eval 探针的 Vite HMR 实例分裂陷阱（重要）**：页面开着时编辑过某模块后，Vite 会给 importer 的 import 规格永久加 `?t=<时间戳>`（dev server 生命周期内不消失）——**动态 `import('/src/xxx.js')` 裸 URL 会拿到与页面不同的模块实例**，探针量的是假实例（单例字段如 `_unlockWired`/patch 计数全对不上）。正确姿势：先 `fetch('/src/main.js')` 提取页面实际 import 的 URL（含 ?t=）再 import 同一 URL。生产 build 无此问题（单 bundle）。

### Idea-3B-0/B-① 地形 Worker 化批次备忘（防回退）

- **B-0 探针结论（2026-09-12 通过）**：地形模块图（noise/biomes/terrain/Chunk/structures/catalog + BlockDefs）纯计算零 DOM，Worker 可直接运行。三区块字节级一致（确定性生成跨线程成立）、Transferable 回传正常、build 产出独立 worker chunk（`TerrainWorker-*.js`）。headless 软渲染 worker 反而慢（12.1ms vs 8.3ms/块）——收益是主线程解堵不是裸生成速度，真机帧时间才作数。
- **⚠️ 最高危坑：worker 图必须补 `import '../blocks/BlockDefs.js'`（副作用注册）**。方块 id 注册在 BlockDefs 模块顶层执行，主线程由 Game.js 导入完成；worker 图缺它 → BlockRegistry 空 → getByName 全 undefined → 生成**全空气**（表面 ok:true 不报错，只表现为 17500/65536 字节差异、非零块数 0）。BlockDefs 顶层只做 SVG 字符串生成，DOM 全在函数体内，worker 安全。
- **架构（B-①）**：`TerrainWorker.js`（每 seed+规模缓存生成器 LRU≤4，`chunk.blocks.buffer` Transferable）+ `TerrainWorkerClient`（请求队列 RR 分发 2 worker，`broken` 标志熔断）。**World.ensureChunk 保持同步**（setBlock 等大量调用方依赖）；新增 `requestChunk(cx,cz)`：已有/在途返回 true，不可用返回 false，调用方 `if (!requestChunk()) ensureChunk()` 回退。`_finalizeChunk(c)` = applyModifications → initChunkLight → 作物扫描公共收尾，**顺序勿变**（LightEngine 邻居导入语义耦合）；worker 回执在 `chunks.set` 后 finalize，与同步路径逐语句一致。回执落地时同步路径已建 → 丢弃；`.catch` 置 `broken=true` 熔断回退。
- **门控与生命周期**：仅主世界注入（dimension==='overworld'，nether/end/aether 生成器类不同）；注入点在 `Game.start` 的 `new World` 后（换维/联机重启全走 start，天然覆盖）；`_disposeWorld` 首行 `terrainWorker.dispose()` terminate（新建型资源，跨存档必须销毁）。
- **验证锚点**：瞬移远端 → `world.chunks.size==169` 且 patch 实例 `generator.generateChunk` 计数 **syncGens==0**（全 worker）；`terrainWorker.broken=true` 后再瞬移 → syncGens 增 169（回退接管）；worker 生成块 `hasLight==true`；returnToMenu 后 worker terminate。headless 无 Worker 环境自动走同步路径（构造失败 onerror→broken）。
