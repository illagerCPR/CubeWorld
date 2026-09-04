# AGENTS.md

## 语言

- 对话回复使用简体中文（用户全局约束，见 `~/.claude/CLAUDE.md`）。
- 代码标识符用英文，不用汉语拼音。

## 开发命令

```bash
# Windows (PowerShell)
.\start.cmd start    # 启动 Vite 开发服务器 (127.0.0.1:5173)，后台常驻
.\start.cmd stop     # 停止服务器
.\start.cmd restart  # 重启
.\start.cmd status   # 查看是否在跑

# Linux / macOS
./start.sh start     # 同上（默认动作，可省略参数）
./start.sh stop      # 停止服务器
./start.sh restart   # 重启
./start.sh status    # 查看是否在跑

npm run build        # 生产构建
npm run preview      # 预览构建产物
node --check <file>  # 语法检查（唯一可自动化验证手段）
```

- 不走 `npm run dev`：`start.cmd`（Windows，最小化窗口标题 `vite-dev-server`）/ `start.sh`（Linux，`nohup` 后台常驻 + 日志 `dev-out.log`/`dev-err.log`）都直接后台拉起 `node node_modules/vite/bin/vite.js`。端口 5173 无响应时先 `status`，必要时 `restart`。
- 无测试框架、无 lint、无 typecheck。修改后必须 `node --check` 改动的每个文件，再用浏览器/playwright 手测。
- Vite 5 + Three.js 0.160，ESM 原生导入，无打包工具链额外配置。

## 验证 / playwright-cli

- （Windows）不要直接 `playwright-cli open <url>`（启动失败）。要用带 `.cmd` 扩展的完整路径：
  `& "C:\Users\illag\AppData\Roaming\npm\playwright-cli.cmd" reload|click|eval|console <args>`
- （Linux/macOS）直接 `playwright-cli reload|click|eval|console <args>`，无 `.cmd` 后缀问题。
- `playwright-cli eval` 中的字符串字面量常被 PowerShell 吃掉引号/反引号（Windows）；传含 `name: "torch"` 之类参数时改用 `String.fromCharCode(...)` 拼接，或把脚本写到临时文件再 `eval --filename`。Linux/macOS 下 bash 引号规则正常，此陷阱不适用。
- playwright 无 pointer lock 能力，ESC 暂停 / 死亡屏幕等 pointer-lock 相关流程只能 `eval` 直接调用 `pauseMenu.show()`/`deathScreen.show()` 验证。
- PNG 截图可直接用 Read 工具（read_image）查看，用于画面级渲染验证。

## 验证 / agent-browser（可真实操作 3D 世界，已实测 2026-08-31）

agent-browser（本机 0.35.2，`npm i -g agent-browser`）是本项目的**第二套浏览器冒烟工具**，与 playwright-cli 互补。核心差异：**能捕获指针锁 + 真实键盘/鼠标输入 → 单机与联机都能真实移动/转向/挖/放/聊天**（playwright-cli 做不到）。DOM UI 用快照 + `@eN` 语义引用（无需选择器），HUD DOM 直接桥接实时 3D 状态（坐标/生物群系/时间/准星方块）。详细实测见 `docs/agent-browser-eval.md`。

**PowerShell 使用注意（仅 Windows，每条命令都要记住；Linux/macOS 下会话变量用内联前缀 `AGENT_BROWSER_SESSION=my-session agent-browser <cmd>`，bash 不吃 `@` 但建议引号）**：
- `$env:AGENT_BROWSER_SESSION` 在**每次 pwsh 调用间不保留**（新进程）——每条命令内联设置：`$env:AGENT_BROWSER_SESSION="my-session"; agent-browser <cmd>`。
- `@eN` 参数会被 PowerShell 吃掉 `@`——必须加引号：`agent-browser click '@e7'`。
- `eval` 要传**表达式** `"(...)"`；传函数 `() => {...}` 会返回函数本身（显示 `{}`）而非结果。等价于 playwright-cli 的 eval，可读任意 game 状态。
- 会话隔离是硬要求：联机多会话（host/join）必须用不同命名会话，否则共享浏览器互抢页面。

**世界内交互（实测有效命令面）**：
- 指针锁：`click 'canvas[data-engine]'` 捕获（`canvas` 裸选择器命中 10 个元素 → strict mode 违规，必须精确定位主渲染 canvas）。
- 移动：`press w`（单次按压位移很小 ~0.01m，连续多按才有明显位移）；转向：`mouse move <dx> <dy>`。
- 挖/放：`mouse down left` + 延迟 + `mouse up left`（挖）；`mouse down right` + up（放）。CDP 鼠标事件能到达游戏 handler 并同步置位 `controls.mouseLeft/mouseRight`（已用同步监听器验证）。
- **高陷阱：用 eval 改 `player.pitch/yaw` 不会可靠同步相机 → 射线指偏、挖/放打不中目标**。瞄准必须用真实 `mouse move`，命中块以 `game.selectedBlock` 为准。
- 在自己脚下/身上放方块会被玩家重叠检查拒绝（游戏设计行为，非失败）；对墙放置即成功。
- 联机链路（已实测全通）：host/join 建/加入房间 → 互见（`game.remotePlayers`，位置在 `rp.group.position`）→ 挖方块同步 → 双向聊天（`press t` + `keyboard type` + `press Enter`，输入框自动聚焦）→ 移动同步。
- 服务端残留：联机测试房间落盘 `server/world/<房间名>.json`，用一次性房间名（如 `ab-eval-<ts>`）或测完删除；先起服务（Vite/LAN）再开会话，否则 `ERR_CONNECTION_REFUSED`。

**定位与边界**：覆盖并超出 playwright-cli 三会话冒烟（真实输入驱动）；不替代 `node server/test-*.mjs` 确定性回归；agent 驱动**不可重复**，产出需人工复核，不能进 CI 回归门槛。

## 架构要点

### 入口与主循环

- `src/main.js` -> 创建 `Game` 实例和 `MenuScreen`，`window.game`、`window.BlockRegistry`、`window.ItemRegistry`、`window.SaveSystem` 暴露用于调试。
- `src/player/Game.js` 是中央枢纽：持有所有子系统（World、Renderer、Physics、Controls、Inventory、MobManager、RedstoneSystem、Hotbar、InventoryScreen、Hud、InfoBar、PauseMenu、DeathScreen），`update(dt)` 每帧驱动所有子系统。
- 主循环受 `this.paused` 门控：暂停 / 死亡 / 物品栏打开时 `loop()` 仍渲染但跳过 `update()`。
- `game.onExit = () => menu.show()` 由 `main.js` 注册；`game.start(mode, seed, loadData, slot)` 启动，`game.returnToMenu(save=true)` 关闭所有 UI 并触发 `onExit`。`controls.enabled` 是 UI 进入/退出的统一开关，新加 UI 必须在 show/hide 中维护它。

### 存档切换时的状态清理（高陷阱，曾引发多个 bug）

`Game` 构造时一次性创建的子系统（Renderer/scene、Sky、Player、Physics、Inventory、Hud、InfoBar、highlight、breakMesh）**跨存档共享实例**，不会在 `start()` 中重建。其余（World、MobManager、RedstoneSystem、Hotbar、InventoryScreen、PauseMenu、DeathScreen）每次 `start()` 新建。若新增状态性子系统，必须决定它属于哪一组，否则会泄漏上一存档的状态：

- 共享型：必须在 `start()` 开头显式重置（例：`this.sky.time = 0.35` 在 loadData 覆盖之前；`this.inventory.slots.fill(null)` 在物品栏分支之前）。
- 新建型：必须在 `Game._disposeWorld()` 中从 scene 移除其 Three 资源并 dispose，否则切换存档后旧 mesh 残留为"幽灵方块"。
- `returnToMenu()` 末尾调用 `_disposeWorld()`，确保回到菜单前已释放 mesh 资源，避免下次 `start()` 再 add 时重复。

近期已修复的泄漏案例：Sky.time 沿用上一存档时间（未先重置）；Inventory 残留上一存档的物品（未先清空）；chunk mesh / mob mesh 未从 scene 移除（_disposeWorld 缺失）。

### 纹理管线（SVG 程序化生成为主）

纹理全由 SVG 字符串程序化生成（现存管线以 SVG 为准）：

1. `src/blocks/BlockDefs.js` 和 `src/items/ItemDefs.js` 在注册方块/物品时同时生成 SVG 字符串，分别导出 `BlockSVGDefinitions` 和 `ItemSVGDefinitions`（`{ 纹理名: svgString }`）。方块/物品建议同时填中文 `displayName`（用于 HUD/物品栏悬浮提示/快捷栏切换气泡）。
2. `Game.start()` 合并两个 SVG map，先注入 `MobManager.init()` 添加怪物 SVG，再调用 `SVGTextures.buildAtlas()` 打包为一张 Canvas 图集纹理 + UV map。
- **缺 `textures` 字段陷阱**：`reg(name, def, svgs)` 不传 `def.textures` 时 `BlockRegistry` 默认用 `name` 作 top/side/bottom（例如 `'piston'`），但 SVG map 里只有带后缀的名字（`piston_top/...`）。`ChunkMeshBuilder` 在 `atlasUV.get(name)` 查不到时 fallback 到整张 atlas UV `{0,0,1,1}`，方块面会**显示所有材质拼图**。修复：所有多面带不同纹理的方块必须显式传 `textures: { top, side, bottom }`。
- **方块重复注册陷阱**：BlockDefs.js 中同一 `reg(name,...)` 多次调用会互相覆盖 BlockRegistry 实例和 svgMap。例如曾出现两次 `reg('tnt',...)`，旧版只有 top/side 两张 svg 但带 textures，新版有三张 svg 但缺 textures —— 后注册覆盖前者，导致缺 textures 又全部 fallback 到整图集。修复原则：同一只能注册一次，且必须带 textures + 完整 SVG。
- **SVG 名后缀约定**：多面方块的三张 SVG 名通常用 `<block>_top` / `<block>_side` / `<block>_bottom`，方块名只在 SVG map 里挂带后缀的 key；单面统一方块（如圆石、活塞头 head）直接用 `<block>` 作 SVG key。
3. `MobManager.buildMaterials()` 必须在 `buildAtlas()` 之后调用（依赖图集 UV）。
4. `ChunkMeshBuilder` 用 `atlasUV` 查询每面的 UV 坐标。
5. UI（Hotbar、InventoryScreen）通过 `game.blockSvgMap` / `game.itemSvgMap` 查 SVG 字符串，用 `SVGTextures.svgToImage()` 绘制到 canvas。

新增方块/物品时，必须同时：注册到 Registry + 生成对应 SVG + 确认 SVG map 中纹理名与 `block.textures` 引用一致 + 按需补 `displayName`。

### 区块、网格与光照

- 区块 16×16×256，`Uint8Array` 存储方块 ID，海平面 Y=64。每区块另有 `light` 数组（高 4 位天光 / 低 4 位方块光，0-15），由 `LightEngine` 维护，`hasLight` 标记是否已初始化。
- 渲染距离 6 区块半径，每帧最多重建 2 个脏区块网格。
- 网格构建：实体方块逐块生成面，**只有水顶面**做贪心合并（`_mergeWaterTops`）；build 前先填 18×256×18 局部方块缓存（`_fillCache`，跨构建复用 scratch）+ 不透明 LUT，剔除/AO/光照采样全走缓存查表。
- `World.setBlock` 会把当前 chunk 和边界邻居标记 `dirty=true`；任何写方块的路径必须走 `setBlock`，否则网格不更新。
- `ChunkMeshBuilder.build()` 输出三个 mesh：`solid` / `water`（半透明 DoubleSide） / `light`。`light` 是 `light >= 13` 的方块（火把/红石火把/荧石/海晶灯/岩浆/红石灯）单独用 `MeshBasicMaterial` 重画一遍，使其夜里也明亮。`Game.rebuildDirtyChunks` 和卸载逻辑必须同时处理三者。
- **UV 朝向陷阱**：solid 面 UV 顺序为 `(u0,v0)(u0,v1)(u1,v0)(u1,v1)`（顶点顺序 [底,顶,底,顶]，方块顶部对应 SVG 顶部）。cross 类型（火把/花/按钮）UV 顺序相同。颠倒这顺序会导致草侧面、火把等纹理上下倒置。
- **水体纹理独立于图集**：水面/侧面/底面用 `waterTexture`（独立 `CanvasTexture`，`RepeatWrapping`，16×16），UV 按**世界坐标** `(x+offX, z+offZ)` 平铺，跨 chunk 连续（不要改回图集子区域 UV，否则远处水面会出方格分界）。`ChunkMeshBuilder` 构造函数第 4 个参数接收 `waterTexture`；water mesh 的材质 `map` 必须指向它。
- **水下方块面剔除陷阱**：`ChunkMesh.build()` 中三段面剔除：① 邻居是不透明非流体 → 剔除；② 当前是水且邻居是同 id 水 → 剔除；③ 非水方块相邻流体且流体不透明 → 剔除。**关键**：水和岩浆都是 `transparent: true`，故其二段"剔除"条件包含 `&& !neighborDef.transparent`，否则水下方块（沙子/石头与水相邻的方向）会被错误剔除，导致水里看不到任何方块。曾经 bug 表现为"水下方块不渲染、远处只见 chunk 边界"——远 chunk 未生成时 `getBlock` 返回 0（air），邻居 air 时不触发任何剔除，所以 chunk 边界方块反而画了。
- **跨 chunk 邻居查询**：`ChunkMeshBuilder.build()` 的 `getBlock` 在 `x/z` 越界时调 `world.getBlock(gx,gy,gz)`（line 76-78）；`y` 越界直接返回 0（air）。`World.getBlock` 在 chunk 不存在时也返回 0，远 chunk 边界因此被当成 air 看——这是"远处只见区块边界"的隐藏成因。

### 体素光照管线（光影改造，防回退）

- **双通道体素光**：`src/core/LightEngine.js`——天光（日光柱 + BFS 横向扩散）与方块光（`def.light>=13` 作源）各 0-15。天光特例：**垂直向下穿过全透格无衰减（15 保持 15）**；其他方向 -1-不透明度。方块光每步 -1-不透明度。
- **增量更新**：`World.setBlock` 末尾调 `lightEngine.onBlockChanged(oldId, newId)`——移除走**双队列算法**（removal BFS + 前沿重泛洪），天光 removal 有"向下 15 光柱一并移除"特例；挖开方块走"列重播种（`_reseedColumn`）+ 邻居流入"；新光源直接 set+BFS。**任何写方块必须走 `World.setBlock`**，光照才会跟着更新（远程方块改动同样经它，视觉自动同步）。
- **新区块**：`ensureChunk` 生成+应用修改后立即 `initChunkLight`（列播种 + 光源 + 已加载邻居边界光入队，泛洪自然完成双向导入导出并标脏邻居）。未加载区块采样兜底：天光按 15、方块光按 0。
- **着色**：`ChunkMesh.js` 顶点携带 `voxelLight`（skyL/blockL 归一化）+ `color`（面向系数 × AO）。平滑光照 = 面邻格 + AO 三格中不透明格跳过后的均值；AO 用 `AO_SAMPLES` 静态偏移表 + `AO_CURVE`，**各向异性时翻转对角线**（`a[1]+a[2] > a[0]+a[3]` → 换对角索引，绕向不变）。cross 植物取自身格光；合并水顶面取每角上方格光。
- **材质**：solid/water 是 builder 上的**共享 MeshBasicMaterial**（`applyVoxelLight` 注入 onBeforeCompile：`max(uSunTint*skyL*uDayLight, uTorchTint*blockL)` 再抬底 `uMinLight=0.035`）。**勿改回 Lambert**——场景方向光/环境光会把洞穴再次照亮，体素光失效；**勿改回每区块新建材质**（泄漏 + uniform 失联）。发光方块 light mesh 保持全亮 Basic，**不乘 AO/voxelLight**。
- **昼夜**：`Game.update` 每帧只更新共享 uniform（`uDayLight = 0.10+0.90*getLightLevel()`、`uSunTint` 晨昏暖/夜晚冷，来源 `Sky.sunTint`）——**时间流逝零网格重建**。
- **怪物受光**：`MobManager.update` 普通帧按所在格光调制 `material.color`（洞穴变暗/火把旁暖色）；受击/死亡 emissive 反馈是独立通道不冲突。
- **边界**：光照纯客户端视觉，**不进存档**（由方块数据重算）、**不进联机协议**；服务器测试零感知。
- **性能锚点**（headless 软渲染）：单 chunk build ≈ 7ms（基线 3.5ms），仍在 2 chunk/帧预算内；真实 GPU 环境更宽裕。改动采样逻辑后必须重测。

### 天空与昼夜（修改前必读）

- `Sky.time` 语义：`sunY = sin(time*2π - π/2)`，即 `0=半夜, 0.25=日出, 0.5=正午, 0.75=日落, 1=半夜`。`Sky.dayLength = 1200` 秒。
- `skyColors` 数组的 t 锚点**必须**与上述太阳位置一一对应（0.25=粉橙日出，0.5=蓝天正午，0.75=粉橙日落，0/1=深夜）。错位会让玩家在白天看到夜空色，全屏偏暗。
- 光强：`sunLight = 0.15 + dayFactor*1.3`，`ambient = 0.30 + dayFactor*0.50`，`dayFactor = max(0, sin(angle))`。夜晚保留 0.15 余晖避免伸手不见五指。

### 怪物系统

- `MobManager` 管理生成（夜晚优先，MAX_MOBS=20）、更新、渲染、掉落物。
- 怪物模型用 **box-parts cuboid**：每只怪是一个 BufferGeometry，由若干 cuboid 部件合并而成（head/body/2 arm/2 leg 等），共 ≈ 6 部位 × 6 面 × 2 三角形 = 72 三角形/怪。**不再用 4 面 billboard**。
- 怪物纹理用**独立 96×64 皮肤 atlas**（4 行 × 6 列，cell 16×16 方形像素），每 type 一份私有 `CanvasTexture`，**不再合并到全局方块/物品图集**。
- 皮肤 atlas 布局：row 0=head, row 1=body, row 2=前组肢体(臂/前腿), row 3=后组肢体(腿/后腿)；col 0/1/2/3/4/5 = front/back/left/right/top/bot（**每面独立 cell，顶/底不再复用 front/back**——复用会导致"脸贴在头顶"）。UV 查表用 `mobSkinUV(partRow, faceCol)`，col 映射由 `FACE_COL`；atlas 尺寸常量 `MOB_ATLAS` 导出，`buildMaterials` 画布必须同步 96×64。每 face 按朝向套基础明暗（front 1.0 / back 0.80 / left 1.05 / right 0.88 / top 0.96 / bottom 0.70）。
- **法线是立体感关键（阶段 7 修复）**：`MobManager.buildMaterials()` 合并 geometry 后必须 `geo.computeVertexNormals()`，且 FACE_DEFS 每面两三角形绕序必须统一为 `(0,1,2)(1,3,2)`——若沿用 `(0,1,2)(0,2,3)`，每面两三角形一个朝外一个朝内，`computeVertexNormals` 平均成 ~0 法线，`MeshLambertMaterial` 方向光失效 → 全表面同色无明暗（"同色纸片"根因）。修绕序不改 UV。
- **UV 朝向（阶段 8 修复）**：FACE_DEFS 每面带显式 `uvs` 选择器——侧面统一 `[[1,0],[1,1],[0,0],[0,1]]`（u1 落在观察者右侧→从外看不镜像），top/bot 用 `[[0,0],[1,0],[0,1],[1,1]]`。旧写法 `c<2 ? u0 : u1` 会让 4 个侧面全部水平镜像，勿回退。
- **怪物朝向（阶段 8 修复）**：mesh 局部 **+Z 是脸/头的方向**；`Mob.js` 的 yaw 必须为 `atan2(nx, nz)`（nx/nz 指向移动/玩家方向），使 +Z 旋到移动方向。旧公式 `atan2(-nx, -nz)` 会让脸背对移动方向（蜘蛛头拖在身后），勿回退。
- 模型部件定义在 `MobTextures.js` 中 `HUMANOID_PARTS`（僵尸，**手臂沿 +Z 前伸**）/`SKELETON_PARTS`（骷髅，细肢 0.14 宽）/`CREEPER_PARTS`/`SPIDER_PARTS`（头胸在前 z∈[0.26,0.60]）常量；`MobTypes[type].model.parts` 引用。box = `[minX, minY, minZ, maxX, maxY, maxZ]`，**局部坐标系原点在脚 y=0，+Z 朝脸的方向**。
- `MobManager.buildMaterials()` 是 **async**（要 await SVG → Image → Canvas）；`Game.start()` 中必须 `await this.mobManager.buildMaterials()`，否则下一次 `start()` 时 master geometry/material 上下文未就绪。
- `Mob.js` 含 AI：chase/wander/attack/jump/burn/explode/lineOfSight。
- 注意 `Mob` 中攻击伤害属性名为 `attackDamage`（早期叫 `damage` 曾引发"该属性和同名方法冲突"的 bug，勿回退命名）。
- `MobManager.dispose()` 必须释放 type 级共享资源（`mobGeometries` 全 dispose、`mobMaterials.map` 全 dispose、`mobTextures` 清空），**`Game._disposeWorld()` 末尾必须调用 `mobManager.dispose()`**，否则切换存档时旧 master geometry/texture 会泄漏到 GPU。

### 怪物受击反馈系统（per-mob 资源、勿共享）

- `MobManager.spawnMob()` 中每只怪克隆 material（`mat.clone()`）—— **绝对不要让所有同 type 共享一份 material**，因为 emissive 是 per-mob 状态（受击红光 / 死亡红光 / 燃烧火光三态都靠 emissive 表达）。共享的话一只怪受击会让全部同 type 变红。
- 每只怪还挂载：`healthBarCanvas`（64×8 CanvasContext）+ `healthBarTex`（`CanvasTexture`，NearestFilter）+ `healthBarSprite`（`THREE.Sprite`，renderOrder=1000，depthTest=false）。受击时 `_updateHealthBar(mob)` 重绘并 `healthBarFadeTimer = 3.0`，3 秒中末 1 秒透明淡出。常量定义在文件头：`HIT_FLASH_DURATION=0.25` / `HEALTH_BAR_FADE=3.0` / `DEATH_ANIM_DURATION=0.4` / `HEALTH_BAR_WIDTH=1.0`。
- 死亡走两段式：`mob.dead=true` 当帧 → 末段设 `mob.dyingAnim={progress:0,total:0.4}` → 后续每帧 dyingAnim 分支累积进度（缩小 scale 到 0.05、旋转、`material.opacity` 1→0、emissive 红光淡出）→ `t>=1` 时才 `dropLoot` + `_removeMobResources` + splice。**不要在 dead 当帧立即 splice**，否则玩家看不到死亡动画。
- 玩家攻击 mob 不走 `Entity.damage()`（有无敌帧），改在 `MobManager.attackMob()` 内直接 `mob.health -= dmg` 并自己设 hitFlash / knockback / blood bar。
- `MobManager.dispose()` / `_removeMobResources()` 必须释放 per-mob 资源：material.dispose()、SpriteMaterial.dispose()、CanvasTexture.dispose()。geometry 是 type 共享不能 dispose。

### 玩家受击与无敌帧

- 玩家走 `Player.hurt(amount, source, showVignette=true)`，内部 0.5 秒无敌帧（`invulnerable`），创造/旁观模式直接返回 false。`Game.update()` 每帧衰减 `invulnerable`。
- `player.onHurt = (amount, source) => this.hud.flashDamage(amount)` 在 `Game.start()` 中注册。新加伤害源时**所有一次性攻击**（怪物 `Mob.attack`、摔落、爆炸）应调用 `player.hurt(amount, source, true)`；持续/低频伤害（溺水每秒 1 血、饥饿每秒 0.5 血）直接 `player.health -= amount`，**不要**触发红屏（连续闪屏很烦）。
- `Hud.flashDamage(damage)` 内部 set opacity 到 `Math.min(0.9, 0.3 + damage * 0.04)` 后用双层 `requestAnimationFrame` 启动 `transition: opacity 0.5s ease-out` → 0 的淡出。修改时**不要去掉双层 RAF**——少了会让 opacity 0 立刻写回覆盖 intensity。

### 玩家物理与游泳

- `Physics.moveAxis()` 对每个轴单独移动+碰撞回退，**收集所有碰撞方块取最保守的回退位置**（不要改回"命中即停"的早期实现，曾导致穿墙）。
- **auto-jump（自动台阶）**：`moveAxis` 中水平碰撞时若 `maxBlockTopY - entity.position.y > 0 && <= 1.0+0.01`，且抬升后 `[targetY, targetY+height]` 范围内无碰撞，则直接抬升 y 而不回退水平位置。陆上台阶和水中上岸共用此逻辑——不要依赖 `inWater` 触发水岸上岸（玩家头出水后 inWater 会变 false，会失败）。
- 水中物理：`inWater` 由 `Game._updateWaterState()` 根据眼睛位置方块 `def.fluid && name==='water'` 判定；水中重力 -8、阻力 0.8、水平速度上限 ~4.3；Space 上浮、Shift 下潜（逻辑在 `Game.update()` 中而非 Physics）；`airTicks=300`，水下递减，<0 溺水扣血。
- Hud 顶部 `airBar` 显示剩余氧气（仅 `inWater && airTicks<300` 时渲染）。

### 食物与饥饿

- `Player.eat(itemDef)` 是统一食用入口：创造/旁观 / `food >= maxFood` 时拒绝；否则 `food += itemDef.food`、`saturation += food * 0.6`，都 clamp 到 `maxFood`。返回 true 表示成功吃下。
- `Game.handleMouseInput` 右键分支**优先**检查食物：玩家 survival + 手持物品 `itemDef.food > 0` + `food < maxFood` 时调 `eat` 并消耗 1 个（`inventory.removeSelected(1)` + `hotbar.update()`）。饱腹时跳过食用分支继续走工作台/红石/放方块逻辑（与原版一致）。
- 饥饿衰减在 `Game.updateSurvival()`：`saturation > 0` 优先扣 saturation，否则扣 food；`food >= 18` 缓慢回血，`food <= 0` 持续掉血到 1。
- 物品 `food` 字段在 `ItemDefs.js` 注册：面包=5、苹果=4、牛排=8 等。新增食物必须填 `food` 数值。

### 合成系统

- `src/core/Crafting.js`：`addShaped()` 接受一维或二维 pattern，一维 9 元素=3×3、4 元素=2×2，二维如 `[['a'],['b']]`。内部自动转二维并收缩到最小包围盒。`matchRecipe()` 接受二维网格数组。
- `InventoryScreen.js`：E 键打开 2×2 背包合成；右键点击 `crafting_table` 方块打开 3×3 合成。支持鼠标拖放物品（左键交换/合并，右键取半）。点击输出槽获取合成结果并消耗材料。

### 红石系统

- `src/core/RedstoneSystem.js`：信号传播与方块交互。
- 支持：lever（拉杆切换）、button（1秒后自动关闭）、redstone_wire（信号传播）、redstone_torch/block（恒定电源）、piston/sticky_piston（推出/收回活塞头）、redstone_lamp（充能指示）、TNT（引爆）、door/trapdoor（切换状态）。
- `Game.js` 右键点击 lever/button 时调用 `redstone.onBlockInteract()`；放置/破坏方块时调用 `redstone.onBlockChange()`；`update()` 中每帧调用 `redstone.update(dt)`。

### 存档系统（多槽位）

- `src/core/SaveSystem.js`：localStorage 多槽位存档，`SAVE_PREFIX='project-mc-save-'`，`MAX_SAVE_SLOTS=6`，旧版无后缀键自动迁移到槽 1。API：`save(game, slot)` / `load(slot)` / `hasSave(slot)` / `listSaves()` / `deleteSave(slot)` / `findEmptySlot()`。
- `Game.currentSlot` 跟踪当前槽位，`Game.start(mode, seed, loadData, slot=1)` 接受槽位参数。
- `update()` 每 30 秒自动保存；F5 手动保存（注意要 `e.preventDefault()` 否则浏览器刷新）。
- `MenuScreen.js` 是存档选择界面：6 个槽位列表，有存档显示模式/时间/种子并可继续或删除，空槽用选定的模式+种子新建。构造时默认 `display:flex`。
- `cheatsEnabled` 持久化字段：存档数据 `data.cheatsEnabled` 由 `SaveSystem.save` 在 `game.cheatsEnabled` 上读取，`listSaves()` 返回项含 `cheatsEnabled`；`MenuScreen` 的"启用命令"复选框 → `selectedCheats` 状态 → `onStart(mode,seed,loadData,slot,cheatsEnabled)` 第 5 参数 → `Game.start(mode,seed,loadData,slot=1,cheatsEnabled=false)` 第 5 参数；加载存档时由 `loadData.cheatsEnabled` 覆盖（`Game.start` 第 145-149 行：有 loadData 走 `loadData.cheatsEnabled`，否则走函数参数）。改 API 要同步这 5 处签名。

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

## 代码风格

- 纯 vanilla JS（.js），无 TypeScript，无 JSX。
- 注释用中文，代码标识符用英文；不添加注释除非明确要求。
- 文件头部有简短中文说明注释（如 `// Game.js -- 游戏主类`），新文件保持此习惯。

## 平台

- 双平台开发环境：Windows（PowerShell 5.1，脚本 `start.cmd`）与 Linux/macOS（bash，脚本 `start.sh`），两脚本动作与语义对标。
- Windows：链式命令用 `;` + `if ($?)`，不要用 `&&`；路径含空格的可执行文件用 call 操作符 `& "..."`。
- Linux/macOS：标准 bash 语法，链式命令可用 `&&`；后台常驻进程由 `start.sh` 用 `nohup` 封装（pid 兜底在 `.run/`，日志落 `*.log`，均已 gitignore）。
- `Read` 工具对长文件有重复返回前几行的 bug，长文件请改用 `Read` 的 offset/limit 分段，或 `Select-String`（Windows）/ `grep`（Linux）。

## 局域网联机（LAN 多人，阶段 0-10 已完成）

- **架构 thin-host（方案C）**：Node 服务器 = 房间管理 + 方块/掉落物账本 + 消息中继 + 时间权威；每个客户端本地自模拟世界（确定性生成 `TerrainGenerator(seed)`，不用 Math.random），只同步增量。消息键 `t`（type），`server/protocol.js` 集中定义；S2C 表见 `docs/lan-multiplayer-design.md` §7。
- **端口**：服务器 TCP **3001**（`.\start.cmd server` / `./start.sh server`），前端 5173（`.\start.cmd start` / `./start.sh start`），管理面板 `http://127.0.0.1:3001/`。
- **多房间（阶段3）**：`RoomManager = Map<房间名, Room>`，同名房间 = 同世界，种子首次创建固定。`welcome.players` 恒为 `[]`，已有玩家经 join_room 里 `player_join` 重放。世界落盘 `server/store.js`（`server/world/<房间名>.json`，`server/*.json` 已 gitignore），重启恢复（hostId=null → 首个加入者成 host）。**换房（阶段5）**：游戏中 `/room <名>` 或 `switch_room` 直接换（保持连接，目标满则拒），客户端用新 seed 重启本地世界。
- **怪物/红石（阶段2）**：方案①事件同步——host 权威生成 + 攻击位置纠正，掉落只由击杀侧发；红石方块状态同步 + 周期性状态缓解。
- **玩家名着色**：`src/net/playerColor.js`（HUES 调色板）。
- **断线重连（阶段1）**：心跳 pong、断线自动重连（保位置/物品）；被踢 `kicked` → `_explicitClose` 停止自动重连。
- **远端插值（阶段4-①+5+6）**：`src/entity/RemotePlayer.js` 关节模型（head/armL/armR/legL/legR pivot 组），**阶段5 时间戳对齐插值**（样本缓冲 + 时钟偏移 + 延迟线性插值，见下方备忘），**阶段6 自适应延迟**（按缓冲"头余量"动态调 0.05~0.4s），距离>4 快照，行走摆臂 + 头部俯仰 + **右手手持物 3D 模型**（`held` 同步 + `HeldItemMesh` 共享缓存构建，阶段10 由 sprite 升级）。
- **死亡观战（阶段4-②+6）**：`Game.spectating/spectateTargetId`，死亡界面 `hideForSpectate()`（勿用 `hide()`，会重生），F5 切目标、R 重生，观战不广播位置（`NetworkManager.update` 早退）；**阶段6 相机平滑**（`_specSmoothed/_specSmoothYaw/Pitch` 指数平滑跟随，切换目标/瞬移不跳变）。
- **管理面板（阶段4-③+5+6+10）**：`server/admin.html` 自包含页 3s 轮询；`/api/status|config|broadcast|kick|logs|tokens|tokens/rotate|tokens/revoke|room/<name>/clear-drops|delete`；配置持久化 `server/config.json` 热生效（dropTtlMs/heartbeatMs/maxPlayersPerRoom/adminToken/adminTokenExpires/adminAccounts，范围校验非法值忽略）；**阶段10 多账号** `adminAccounts=[{token,label,expires}]` 任一未过期账号可通过鉴权，全部撤销=鉴权自动关闭；**阶段6** 过期后除 `POST /api/config` 续期外全 401 + 内存操作日志 200 条 `/api/logs` + 登录会话 TTL；**阶段10** 踢出 API 带可填写原因（透传 `kicked.reason`）。
- **死亡掉落物（阶段6+10）**：客户端死亡 `player_died` 上报背包 → 服务器 `Room.onPlayerDied` 广播死亡 + 逐项 `drop_spawn`（进账本持久化）；同一次死亡 `_diedDrops` 去重（`onRespawn` 复位）；死亡端清空背包、重生重发生存初始物品（`Game.respawn` 联机分支）；**阶段10 归属锁**：死亡掉落带 `owner`/`ownerUntil`（3 秒），锁内非 owner 拾取被服务器拒（`drop_deny` + 补发 `drop_spawn` 重建实体），客户端预判拦截 + deny 回滚背包（`Inventory.removeItems` + `takePendingPickup`）。
- **联机测试**：起真实 server 后跑 `node server/test-mp.mjs`（34/34）、`server/test-store.mjs`（15/15）、`server/test-admin.mjs`（26/26）、`server/test-stage5.mjs`（16/16）、`server/test-stage6.mjs`（20/20）、`server/test-stage10.mjs`（41/41），须保持全绿。**一键跑批**：`./server/run-all-tests.sh`（清状态→起服→跑全部套件→停服，任一失败退出 1；CI 同款入口，跑前须 3001 空闲）。**注意非幂等**：重复跑批前清空 `server/world/` 与 `server/config.json`（或重启服务器），否则遗留世界存档/管理口令会污染断言。浏览器冒烟用 playwright-cli 三会话 `-s=host/-s=join/-s=three`。CI：`.github/workflows/ci.yml` 在 push master/PR 时跑 build + 全套件（`node --check` 级语法由 build 与套件加载覆盖）；agent 驱动冒烟不进 CI。

## 任务进度（Roadmap）

已完成并推送 master（`https://github.com/illagerCPR/CubeWorld.git`，原 Web-MC 已改名 CubeWorld，本地存档前缀 `project-mc-save-` 为兼容保留）：阶段 0 房间服务器+网络层+方块/玩家/聊天同步（`893fb49`）→ 阶段 1 掉落物/拾取同步+断线重连（`4d9a2ea`）→ 阶段 2 怪物事件同步+红石缓解（`7048df0`）→ 阶段 3 多房间+世界落盘+换房/新建+玩家名颜色（`ce98e23`）→ 阶段 4 插值优化+死亡观战+配置面板（`74418d1`）→ 阶段 5 世界内换房/重建+时间戳对齐插值+管理面板鉴权（`d57403a`）→ 阶段 6 手持物品外观同步+死亡掉落物+观战平滑+鉴权增强+自适应插值延迟（`fab3b7f`）→ 阶段 7 4 种怪物建模优化（法线光照 + 方形皮肤 + 细节纹理 + 模型细化）（`a5fcbee`）→ 阶段 8 怪物朝向修复+原版化贴图+天空盒跟随（`0af6184`）→ 阶段 9 方块材质重绘+发光区块重建崩溃修复（`4f1e60f`）→ 阶段 10 手持物品 3D 化+整条快捷栏同步+死亡掉落归属锁+管理多账号/token 轮换+RTT 直测（见下方备忘）。设计文档 v1.1、README 已同步。

后续候选（见 `docs/lan-multiplayer-design.md` §11 阶段 11）：手持物挥动联动挖掘进度、远端玩家头顶快捷栏可视化（hotbar 数据已同步）、房间白名单/账号权限分级、插值延迟结合抖动方差。

### CubeWorld 改造批次备忘（防回退）—— 改名/全景/粒子/物品重绘/视频设置

- **仓库已改名 CubeWorld**（原 Web-MC），GitHub 仓库与本地 remote 均为新地址；**localStorage 存档前缀 `project-mc-save-` 特意不改**（改名会孤立所有浏览器现有存档）。物理目录 `project-mc/` 保留（会话工作目录依赖）。
- **渲染器包装类陷阱（曾致主菜单白屏）**：`game.renderer` 是 `Renderer` **包装类**，其 `render()` **无参**、固定渲染游戏 scene/camera——子系统想自己画别的场景（如 Panorama）必须取底层 `game.renderer.renderer`（THREE.WebGLRenderer），把 `(scene, camera)` 传给包装类会被静默忽略（不报错、帧帧渲染空游戏场景 → 白屏）。PanoramaBake 与 Panorama 两处均已按此写法，新渲染入口勿持包装类调 render。菜单期 `Game.loop` 因 `running=false` 自停，画布仅由 Panorama `_tick` 驱动，无双渲染打架。
- **主菜单全景背景（预烘焙播放器）**：`src/render/Panorama.js` 播放 `res/panorama/{px,nx,py,ny,pz,nz}.jpg`（512² 六面 90°，~280KB）——BoxGeometry(BackSide) 内壁天空盒自转 + 动态云层（`makeCloudTexture` 从 Sky.js 导出，纹理 offset 漂移）。**勿回退实时渲染小世界**：构建等待 2-4s、机位难控、无头验证困难。水平面贴图需 flipH（repeat.x=-1）校正盒内镜像，py/ny 旋转 180°。烘焙工具 `src/render/PanoramaBake.js`（URL `?bake-panorama=1` 触发，main.js 分支）——复用同款 vantage 评估（雪原占比/近景平整度），产出 `window.bakedFaces` 手动落盘 res/panorama/；换机位重烘即可。天空盒 BoxGeometry 面序 [+x,-x,+y,-y,+z,-z]。菜单期不再驱动体素光 uniform（无 chunk mesh）。激活期画布 CSS `blur(4px)+brightness(0.9)`，游戏期必须清除。
- **粒子系统**：`src/render/ParticleSystem.js`（THREE.Points + 顶点色 + 对象池 1600 swap-with-last）。两个实例：`game.particles`（方块碎屑 size 0.12，生成时从图集 canvas 采样贴图像素色并按体素光衰减）/ `game.fireParticles`（火焰烟 size 0.09，自发光不衰减）。**新建型子系统**：`start()` 创建、`_disposeWorld()` dispose。爆炸碎屑经 `redstone.onBlockDestroyed` / `mobManager.onBlockDestroyed` 回调（Game.start 注入，回调内必须判空 `this.particles`）。熔岩点燃：`_updateWaterState` 判脚/眼在熔岩 → `player.onFire=3`（入水即灭），`_updateFireEffects` 每秒 1 血（低频伤害不走红屏）+ 火焰粒子 + `hud.setOnFire` 火屏滤镜。
- **视频设置**：`src/core/Settings.js`（localStorage key `cubeworld-settings`，全局不按存档）+ `src/ui/VideoSettings.js`（**app 级单例**，PauseMenu 与 MenuScreen 共用）。渲染距离改的是 `game.settings.renderDistance`（旧 RENDER_DISTANCE 常量已删）；平滑光照开关写 `ChunkMesh.js` 导出的 `RenderQuality`，**切换后必须 `world.markAllDirty()`**；MenuScreen 的入口按钮用**事件委托挂构造期**（render() 重建 innerHTML 后仍有效，勿改回 per-render 绑定）。VideoSettings 的 ESC 用 document capture 拦截（stopPropagation），防止同一次按键穿透到暂停菜单切换。
- **物品重绘**：`ItemDefs.js` 用 `art()` 助手（g.s/g.r/g.d/g.h 对角柄/g.spi 撒点）+ `P` 调色板（[亮,基,暗] 三色纪律）；**撒点必须用确定性 `rng(seed)`**，勿回退 Math.random（破坏确定性生成约定）。注册名与 def 字段（stack/food/tool/tier/durability/damage）是存档/合成兼容面，**不得改动**。
- **Hud 准星**：构造期默认 display:none（原 updateVisibility('creative') 初始化会让准星在主菜单可见）；进游戏后 update()/updateVisibility() 按模式接管。
- **无头截图伪影**：本环境 agent-browser screenshot 对持续渲染的 WebGL 画布可能在数秒后冻结在旧帧（合成器表面不更新），**验证全景/粒子等画面以 `gl.readPixels` 帧缓冲导出为准**（eval 内 render→readPixels→小画布→toDataURL），DOM 截图不受影响。

### 自然建筑生成批次备忘（防回退）—— 结构基础设施/村庄/村民/要塞（T0-T4 进行中）

- **结构生成架构不变量**：布局只由 (seed, 结构类型, 锚点 cell) 决定；`StructureManager` 布局求解与逐区块裁剪严格分离，任意端/任意区块顺序结果逐字节一致（联机根基）。回归 = `node tests/structure-determinism.mjs`（同 seed 双次字节一致 / 生成顺序无关 / 跨区块连续 / 耗时预算），已接入 `server/run-all-tests.sh` 首位（纯 node 不占 3001）。新结构类型（要塞等）必须：`registerStructureType` 进 `structures/catalog.js` + solve 保持纯函数 + 追加顺序=绘制优先级。
- **StructureManager 高陷阱**：① `recordsNear` 只读缓存——LRU（maxCache=128）长距离探索后会把村庄记录挤出，**周期性运行时逻辑（村民生成）必须用 `recordsAround`（3×3 cell ensureRecord 按需重求解）**；② 选址门控别照搬 MC 直觉：本作河流/地形碎片化，海拔窗 65-92 + 坡度 ≤8 + `attempts: 6` + `probeR: [10,18]`（大探针环会系统性排除沙漠小斑块）才达到合理密度，改动前先跑 node 漏斗统计；③ 村民出生点必须 `spawnAt`（清柱+按 `baseAt` 实际地形垫台）——直接用 groundY+1 在坡地会卡实心方块掉虚空。
- **`EntityPhysics.moveAxis` z 轴碰撞回退曾误用 `bx`（存量高危 bug，已修）**：沿 z 撞墙的实体被瞬移到 z≈bx 的远点（一帧 ~180 格）——怪物游荡高频触发，表现为"怪物凭空消失/出现在远处地下后坠世界"。回退坐标必须取当前轴的方块坐标（`bc = axis==='z' ? bz : bx`），勿回退。`Mob` 攻击分流用 **`target.isMob` 鸭子标记**而非 instanceof（HMR 双模块实例下 instanceof 失效）。
- **村民系统**：`MobTypes.villager`（passive: true，damage 0/detectionRange 0，drops 空）；AI 三态 = 村庄绳拴游荡（home 半径 24，flee 时家向偏置防被拖远）/ 玩家 4 格注视 / 8 格敌对逃离（速度 ×1.6）；**僵尸/骷髅索敌含村民**（`findNearestMob` 取玩家与村民较近者；苦力怕/蜘蛛仅玩家——防自爆拆村），怪物咬村民走 `mobAttackMob`（伤害+hitFlash+击退），死亡走 update 通用链（sendMobDied 广播/drops 空）。村民不进存档，随村庄重载重生。
- **村民生成生命周期**：`MobManager.updateVillageSpawns` 每帧驱动——生成部分仅 host/单机（`spawnEnabled` 门控，联机经 mobNet 广播 mob_spawn，实体由回执创建）；**补挂 home 与随村清扫（村庄卸载 >120 格 → 村民移除+dedup 解除）全端执行**（客户端 spawnEnabled=false，早退会让客户端村民永无 home）。村民死亡本会话不重生；敌对 MAX_MOBS 上限不含村民。
- **重连丢房间名（存量 bug，已修）**：`NetworkManager` 重连重入房曾发空 payload `JOIN_ROOM {}` → 服务端落到 default 房（房间静默漂移，方块账本/村民全对不上）。重连必须 `JOIN_ROOM { room: this.room }`；排查"联机数据对不上"先查两端 `net.room` 是否一致。
- **要塞（T3）**：环带锚点走 `anchorForCell`（3 点 seed 派生 120°±抖动、半径 700-900；返回 null 即该 cell 无结构，attempts/chance 门不生效）；`place` 海拔门 60-100 拒绝深水/极峰（**个别 seed 第三座可被合理拒绝**，2-3 座属正常）。`hubY = min(surfaceY-26, minGround-9)`，minGround 取 ±40 步长 5 采样最低地表（步长 10 抓不到局部洼地，房间会戳出山体）。传送门室 = 12 框架环 + 3×3 未激活中心（末地维度另行立项）；风化混排 per-block 哈希 14% 苔/12% 裂。T5 后续候选（本批不做）：末地维度、战利品箱子（容器 UI+存档扩展）、村民交易。
- **批次性能锚点**：单区块地形生成+结构装饰 ≈ 8-10ms（node 实测，含锚点扫描/村庄求解首算进缓存）；结构装饰对多数区块为 O(cell数) 哈希跳过。基准 7ms 是 mesh build（另一条路径），二者不相加混淆。

### T5 批次备忘（防回退）—— 战利品箱子 / 村民交易

- **容器惰性生成不变量**：箱子内容不在结构求解时生成——solve 只放 chest 方块并在 `meta.chests` 声明 `[x,y,z,表名]`；`StructureManager` 求解记录时注册进 `sm.chests` Map（**只增不减、幂等，不受布局缓存 LRU 驱逐影响**，与 recordsNear 缓存机制不同）。玩家打开箱子时 `World.getOrOpenContainer` 才按 `(seed, 表名, 坐标)` 生成 27 槽 loot；查不到注册 = 玩家自放箱子 = 空容器。`chestLoot`/`villagerTrades` 是纯函数（loot.js），任何改动都会改变全服所有箱子内容——两端一致性的根基，勿引入 Math.random。
- **联机容器同步**：`container_set` 整箱 27 槽 last-write-wins（与方块账本同策略）；服务器 `sanitizeStack` 将 count<1 清为 null 空槽（曾钳到 1 出过幻影物品，勿改回 Math.max(1,...)）；挖箱 `block_set id=0` 时服务器顺带删容器账本（内容散落由挖掘方 drop_spawn 上报，其他端不重复散落）；joinRoom 回放容器账本（只回放动过的箱子）。客户端收到远端挖箱（applyRemoteBlock）要清本地容器 + 关开着的 ChestScreen。
- **TradeScreen 交易种子**：`villagerTradeSeed(ax, az, i)` 是单机与 mob_spawn 广播共用的唯一派生函数——**勿在调用处各自造哈希**（两端表不一致即 bug）。`createMobFromNet` 接收广播值；`spawnMob` 内位置哈希只是旧广播/命令面板的兜底。村民不进存档 → 交易进度也不持久化（会话内），与村民生命周期一致。
- **新建型 UI 惯例**：ChestScreen/TradeScreen 与 InventoryScreen 同组——`start()` 重建、`_disposeWorld()` dispose；ChestScreen 保存 document 监听器引用并在 dispose 移除（InventoryScreen 的 document mousemove 监听器有跨存档残留，属存量问题）。E/ESC 关闭 + `pauseOnUnlock` 防护 + `handleMouseInput` 开头 guard 三处都要挂新 UI 的 visible 检查。
- **测试**：`tests/loot-determinism.mjs`（5 表确定性/交易表发散/51 箱坐标-表名-方块三向一致/两端 chests 注册表一致）与 `server/test-t5.mjs`（容器协议 14 断言含脏包消毒/挖箱清账/回放/tradeSeed 透传/store 落盘）均接入 `run-all-tests.sh`。

### W 批次备忘（防回退）—— 水面叠加修复 / 建筑显示与探索 / 自然洞穴

- **水面"区块边界"两段真因（均已修，勿回退）**：① α 叠加——视线先后穿过两片分离水体（近滩+远海）时 α=0.7 叠 ~91% 遮盖，opacity 已降 0.48；② **雾距大于加载边界（W1 二次修复，主因）**——旧 fog near60/far160 而 6 区块加载圈只有 96 格，方形边界在雾起效前硬截断，"固定距离+直线+跟随玩家"即此（浅滩等高线不会跟随玩家）。现 `Settings.applyFogRange(fog, renderDistance)`：near=dist×0.5、far=dist×0.95，applySettings 与 Game.update 出水恢复**必须同源调用**（出水分支曾写死 60/160，改渲染距离即复发）；VideoSettings 改距离经 applySettings 自动联动。定位手法：先查 `scene.fog.far` 与 `settings.renderDistance×16` 的相对大小，再看水 mesh/α。
- **洞穴雕刻不变量（terrain.js W3）**：三通道 3D Simplex（seed+6/7/8），世界对齐 4 格采样网格 + 三线性插值——**采样点必须世界对齐**（跨区块连续的根基）；判定 = 意面 `a²+b²<0.006` 或奶酪 `c>0.66`；保护 = y<4 不挖 + 水面列（height<SEA_LEVEL+2）水下 6 格壳（防湖海倒灌，cave-determinism 有断言）+ y≤10 空腔填岩浆。密度锚点：空腔 6-7%、露头 2.3-3.4% 列、单区块 +0.6ms。改阈值先跑漏斗统计（`node` 双 seed 扫 17×17 区块）。
- **ringPoints 唯一来源**：`stronghold.js` 导出的环带 3 点计算同时供选址（ringAnchor）与命令面板探索列表——公式改动会移动全世界要塞，两处必须共用同一函数（loot-determinism ⑤ 有锚点一致性断言）。
- **建筑归属查询**：`structureNameAt` 走 recordsAround（抗 LRU），InfoBar 内部 0.5s 节流（performance.now，update 无 dt 参数）；CommandPanel 探索区在 `show()` 时重建（村庄 ±3 cell 扫描 + 要塞 O(1)），新增结构类型在 structureNameAt 加一个分支即可。

- **行走卡顿三件套（W-卡顿批次）**：① `LightEngine.initChunkLight` **价差入队**——只把"光照 <15 的格 + 与已处理邻列（左/后）价差 ≥2 的边缘格"入队 BFS，旧版全量入队 5 万+格致 48ms/块（跨区块行走 690ms/帧卡顿主犯），新版 2.2ms（22×）；对照验证：653 万格仅 0.09% 差异且**全部 +1**（新版传播是旧版超集，修复了旧版链式横向光漏一级的缺陷）。**勿回退全量入队**；改光照传播逻辑必须跑 node 新旧对照（653 万格 dark/哈希+单调性）。注意：光照 forward/reverse 顺序本就不幂等（存量，纯视觉不进存档/协议）。② `updateChunks` 分帧预算：缺口按距玩家排序、每帧限时 8ms（至少 1 块）；③ `rebuildDirtyChunks` 时间预算 12ms（洞穴后单块 mesh ~15ms，固定 2 个/帧会叠出 29ms）。实测跨边界：单帧 690ms → 13 帧×≤33ms 渐次补完。已知尖峰残余：30s 自动保存序列化长探索存档的单帧尖峰（未处理）。

### 维度批次备忘（防回退）—— 维度基建/下界/末地（M1+M2；M3 天域 / M4 联机同步待做）

- **维度注册表 `src/core/dimensions.js`**：新增维度 = 加注册表项（生成器必须纯函数 of (seed, 坐标)）；`implemented:false` 不可达（面板不展示 / switchDimension 拒绝）。天空/光照/雾/出生点全走档案，勿在 Sky/LightEngine 里硬编码维度分支。
- **World 维度化**：`new World(seed, dimension)`；`modifiedBlocks`/`containers` 是"当前维度"桶的指针（全量在 `dimensionBlocks`/`dimensionContainers` 分桶），换维 = 整体重建 World（`switchDimension` 合成 loadData 重走 `start()`），指针永不跨维换绑。存档 V2：`dimension` + `dimensionBlocks/dimensionContainers`；`SaveSystem.load` 把 V1 平铺字段迁移进主世界桶（内存升级不回写）。
- **无天光维度（下界）光照不变量**：LightEngine `!hasSkylight` → 整块填恒定环境天光 `ambientSky`（下界=5）+ **方块光源必须独立播种**（曾因光源播种随列循环被包进天光分支导致下界全黑——`_lt` 光源 LUT 独立扫描，勿回退）；`onBlockChanged` 天光通道整体跳过；`World.getSkyLight` 未加载兜底 = ambientSky（与 `_skyFallback` 同源）。浏览器冒烟必须断言 `getBlockLightAt(光源格)==15`——确定性测试不跑 LightEngine，此 bug 只有冒烟能抓到（已真出过）。
- **下界生成器（`dimensions/nether.js`）**：y0/y255 基岩 + 2 格保护壳；三通道 3D 噪声场（世界对齐 4 格网格 + 三线性插值，W3 同款）；空腔 = 奶酪 c>0.46 或意面 a²+b²<0.010；y≤31 熔岩海；表面斑块（上方露天+下方空腔/岩浆）= soul_sand>0.30 / gravel<-0.42 / 熔岩缘 6 格内 6% 黑曜石（per-block hash3）；荧石挂顶（上方实心 netherrack + 3D 噪声>0.52）。密度锚点：air 14-17%、荧石 ~100/区块。改阈值先跑 9×9 漏斗统计。
- **末地生成器（`dimensions/end.js`）**：透镜形主岛（r~60、顶 64±3、厚 (1-t²)×22+2），边缘半径用 (cos,sin) 角度域噪声保证 ±π 连续；黑曜石柱环 6-10 根（r 25±4、高 74-95、半径 2-4，全部 hashSeed(seed,i) 派生，顶端荧石）；外环小岛 r>180 阈值 0.60；无 bedrock 无天光（hasVoid）。出生探测上限 y=72（低于柱群，防出生在柱顶荧石上）；性能 0.1ms/块（纯列填充，无 3D 场）。
- **Physics 坠落救援陷阱（M2 虚空，曾真出）**：`Physics.collide` 末尾有旧主世界安全网 `y<-10 → y=100`——**hasVoid 维度必须跳过**，否则玩家永远到不了 -16 虚空伤害线（表现为"末地/天域虚空不掉血"）；`EntityPhysics`（怪物）的 y<-10 → dead 是正确语义（虚空杀怪）保留。冒烟断言：置 y=-30 手动驱动 `game.update(0.1)`×8 → y 持续下降 + hp 递减；走到 deathScreen.visible → respawn() → 回维度出生点满血（eval 直调 respawn 不隐藏死亡屏属测试痕迹，正常流程按钮 hide()→respawn）。
- **Sky 维度档案**：`applyDimensionProfile(dimDef)`——fixedColor / 天体显隐 / 云显隐+高度；`noDayCycle` → `isDay()` 恒 false（怪物不燃烧）、`isNight()` 恒 true（生成无视昼夜）、`getLightLevel()` 走 `light.skyLightLevel`（uDayLight 恒定）；applySettings 的云开关改写 `sky.cloudsEnabled`（Sky.update 里与维度显隐相与，勿回退成直接写 clouds.visible）。
- **换维流程（单机）**：CommandPanel 维度区 → `game.switchDimension(id)` → 合成 loadData（`dimensionSpawn:true` 忽略坐标落维度出生点）→ 重走 `start()`（**必须透传 this.networkMode 第 6 参**，否则联机标志被重置）；联机分支 M1 拒绝（chat 提示），M4 接入。初始区块以落点为中心生成（不再固定原点 0,0）。
- **spawnScanTop**：下界 200（基岩天花之下）——MobManager 怪物扫描与生成器 findSpawn、CommandPanel 生成实体共用此语义，有天花维度勿用 CHUNK_HEIGHT-1 从顶扫（会落在天花上/被 bedrock 顶格拒绝）。
- **虚空伤害**：`dimDef.hasVoid && y<-16` 每秒 6 血（持续伤害口径不走红屏）；重生 = 当前维度出生点（`World.getSpawnPoint()`），不跨维重建；主世界 getSpawnPoint 与旧 `getHeightAt(0,0)+2` 逐字节同值。
- **测试**：`tests/dimension-determinism.mjs`（每实现维度 × 2 seeds：双次字节一致 / 顺序无关 / 孤立=区域 / 出生点确定性+落点安全 / 特征方块存在 / 耗时预算）已接入 `run-all-tests.sh`；新增维度必须先让它在该测试下全绿。


### 阶段 10 关键实现备忘（防回退）—— 手持物 3D 化 + 快捷栏同步 + 掉落归属锁 + 多账号 + RTT

- **手持物 3D 化**：`src/render/HeldItemMesh.js`（模板缓存进程级，clone 复用；方块=六面贴图立方体、`renderType==='cross'` 方块=交叉双面薄片、物品=双面薄片；材质 `MeshLambertMaterial` + `emissiveMap` 同贴图 0.35 自发光，夜晚可见；**勿改回 sprite billboard**）。`src/render/FirstPersonHand.js` 第一人称：**camera 必须加入 scene（`scene.add(camera)`）其子节点才渲染**（`Game.constructor` 一次性挂载，属共享型子系统——`start()` 里重置 `currentName=undefined` 强制重建）；按住左键自动连续挥动（0.3s 冷却），放置/食用/命中命中时 `hand.swing()`。`RemotePlayer._setHeld` 挂 `armR.pivot`（dispose 只 remove 不 dispose，几何/材质为共享缓存）。
- **整条快捷栏同步**：`player_full` 带 `hotbar`（9 槽），`Room.sanitizeHotbar` 校验（一项非法整体丢弃、保留旧值）；`Room.joinInfo(p)` 供 joinRoom/createRoom/resetWorld 回放 `PLAYER_JOIN`（带 `selected`/`held`/`hotbar`）——**新加入者立即看到在线玩家手持物**；`RemotePlayer.applyFull` 无 held 时用 `hotbar[selected]` 推导。
- **死亡掉落归属锁**：账本 `owner`/`ownerUntil`（3 秒）；广播 `drop_spawn` 带 `owner`/`ownerLock`（剩余毫秒）；锁内非 owner `drop_taken` → 服务器 `drop_deny` + **补发 drop_spawn**（客户端重建实体）；**账本已不存在的 drop_taken 也回 deny**（防两人同时拾取复制物品，勿删此分支）；客户端 deny 回滚 = `takePendingPickup(id)` 取拾取留档 + `Inventory.removeItems(name, count)`；本地预判拦截在 `MobManager.updateDroppedItems`（`getSelfId` 由 Game 注入，勿删）。
- **管理多账号**：`config.adminAccounts=[{token,label,expires}]`（≤10）；旧 `adminToken`/`adminTokenExpires` 是 default 账号的兼容接口（`applyConfig` 双向同步）；`authState` 遍历账号匹配；**id = token 的 SHA-256 前 8 位**（`accountId()`），rotate/revoke 按 id 定位避免明文回传——**轮换后 id 会变**（客户端须重新拉列表）；token 生成用 `crypto.randomBytes(24).toString('base64url')`，明文仅创建/轮换响应返回一次。admin.html 生成/轮换用 `prompt` 显示新口令（agent-browser 需 `dialog accept`）。
- **RTT 直测**：客户端每 2s 发 `ping {seq, ts: performance.now()}`，`room.handle` PING 分支**回显 `ts`**（勿删）；客户端 PONG 分支按 `ts` 算 EMA(0.8/0.2) → `NetworkManager.rttMs`；`RemotePlayer` 自适应以 RTT 为主信号（目标 = clamp(0.05 + rtt/2000, 0.05, 0.4)，每秒 40% 平滑靠拢），头余量仅保留欠载保护（>0.22 降延迟仅限无 RTT 数据时）；InfoBar 联机显示「网络: Xms」（第 5 参数 `rttMs=null` 隐藏）。
- **验证**：`node --check` + `npm run build`（47 模块，655 kB）+ `test-stage10.mjs` 41/41 + 全基线绿 + agent-browser 冒烟（第一人称手持方块/火把/物品截图、远端手持模型、joinInfo 回放断言、InfoBar RTT 行、掉落锁确定性断言：**注入 fake drop（owner≠self, lockedUntil>now）手动驱动 updateDroppedItems → 拦截；置 lockedUntil=0 → 拾取**——浏览器实时 3 秒锁内断言受命令间隔/pickupDelay 干扰不可靠，用此注入法）。

### 阶段 5 关键实现备忘（防回退）

- **换房/重建协议**：`switch_room`（C2S，保持连接换房，目标满则拒）、`world_reset`（C2S，仅 host）；`world_info` 加 `restart` 标记（含新建房走 `createRoom` 分支也要带）。客户端 `NetworkManager` 收到 restart → `_ready=false` + `restart_world` 事件 → `main.js` 用新 seed 重启本地世界 → `onWorldStarted()` 落地缓存，全程不断连接。聊天命令 `/room <名>` `/rebuild`。
- **时间戳插值**：`player_state` 广播带 `ts: Date.now()`；`RemotePlayer` 样本缓冲(≤40) + 时钟偏移平滑(0.9/0.1) + 固定 120ms 延迟，`renderTime = now + offset - delay` 线性插值重放。**高陷阱：包围 renderTime 的下标 i 必须钳到 `len-2`**（`b = buf[i+1]` 不能越界），否则 `b.ts` 抛错会让整条 `Game.loop` 停摆（曾真出过）。SNAP>4 快照并清空缓冲防传送回拉。
- **面板鉴权**：`config.js` 的 `adminToken`（字符串 ≤64，空=关）+ `adminTokenExpires`（阶段6，Unix 秒，0=永不过期）；`index.mjs` `authState(req)` 返回 `'ok'/'no'/'expired'`（`Bearer <token>` 校验 + 过期判断），`maskedConfig()` 掩码回显；`admin.html` 登录弹层 + localStorage 存口令，配置卡口令框 `****` 未改不提交。未授权 401。
- **ChatBox 全局 T 键监听器必须在 dispose 移除**（`this._onKey` 引用保存并 `removeEventListener`），否则换房/重建反复 `start()` 会堆积监听器导致一次 T 开多个输入框。

### 阶段 6 关键实现备忘（防回退）

- **手持物品同步**：`player_state`/`player_full` 广播 `selected`（槽位）+ `held`（物品名），`Room.onPlayerState/onPlayerFull` 透传记录；`RemotePlayer._setHeld(name)` 异步重建右臂挂载物（**阶段10 已升级为 3D 模型**，见阶段 10 备忘），`_heldSeq` 序号防竞态，`dispose()` 必须释放挂载物。
- **PARTS 关节 role 必须唯一**：左右臂/腿用 `armL/armR/legL/legR`（**勿回退为重复 `'arm'`/`'leg'`**——后者覆盖前者导致 `joints.armL/armR/legL/legR` 全部不存在，行走摆臂失效、手持 sprite 挂不上右臂，曾真出过）。手持 sprite 挂在 `joints.armR.pivot` 末端。
- **死亡掉落物**：`player_died` 携带死亡位置 + 背包列表（客户端 `sendPlayerDied()` 先读背包再清空）；`Room.onPlayerDied` 广播死亡 + 逐项 `drop_spawn`（确定性偏移防重叠，进账本）；同一次死亡 `_diedDrops` 去重（`addPlayer`/`onRespawn` 复位，防重复上报刷掉落）；`Game.respawn` 联机分支重发生存初始物品。
- **鉴权过期**：`adminTokenExpires` 到期后 `authState` 返回 `'expired'`——**仅放行 `POST /api/config` 供续期/关闭**（避免永久锁死），其余 401（错误含"过期"，admin.html 据此显示续期横幅而非登录弹层）；`/api/logs` 内存环形缓冲 200 条记录 config/broadcast/kick/clear-drops/delete-room/auth-fail。**注意：PowerShell `Get-Date -UFormat %s` 的 epoch 会偏 ~8 小时（时区 bug），设过期时间要用 `[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()`**。
- **观战平滑**：`_specSmoothed/_specSmoothYaw/_specSmoothPitch` 帧率无关指数平滑（`k = 1 - Math.pow(0.0001, dt)`），切换目标（`cycleSpectateTarget`）/进入观战/重生时重置为 null（避免跨图横扫）；`updateSpectateCamera` 读平滑后位置/朝向。
- **自适应插值延迟**：`RemotePlayer.update` 按"头余量 = 最新样本 ts − renderTime"动态调 `_interpDelay`（<0.03 → +0.004 加大吸收抖动；>0.22 → −0.002 降低滞后；钳 0.05~0.4）。**仍须保留 stage5 的 `i 钳到 len-2` 防越界**。
- **测试非幂等**：服务器回归测试对同一 live 服务器重复跑批会被污染（遗留 `server/world/*.json`、config 里的 adminToken/expires）——跑批前清空 `server/world/` 与 `server/config.json`（或重启服务器）。

### 阶段 7 关键实现备忘（防回退）—— 4 种怪物建模优化

- **"同色纸片"根因 = 法线缺失**：`MobManager.buildMaterials()` 合并的 cuboid geometry 原本**无 normal attribute**（three.js 不绑定 → WebGL 默认 (0,0,0)）→ `MeshLambertMaterial` 的 `max(dot(N,L),0)=0`，太阳光对怪物零贡献、只吃环境光 → 全表面同色无明暗。方块正常是因为 `ChunkMesh.js` 手动写死每面法线。修复：`geo.computeVertexNormals()`。
- **绕序陷阱（必读）**：FACE_DEFS 每个面 4 顶点的原索引 `(0,1,2)(0,2,3)` 使两个三角形**一个朝外一个朝内**（已验证 right 面 +X/-X 各一）——直接 computeVertexNormals 会平均成 ~0 法线，仍扁平。修复：索引改为 `(0,1,2)(1,3,2)`（绕序统一、**不改 UV**）。**勿回退成 `(0,2,3)`**。
- **atlas 64×64**：皮肤 atlas 由 64×32（cell 16×8）升级为 **64×64（cell 16×16 方形）**，修掉方形面上 UV 拉伸；`MobManager.buildMaterials` 的 canvas 与 `drawImage` 必须同步 64×64。`mobSkinUV(partRow, faceCol)` 公式不变。
- **面朝向亮度**：`MobTextures.js` `FACE_BRIGHTNESS`（front 1.0 / back 0.80 / left 1.05 / right 0.88）在生成 cell 时逐像素乘系数——方向光之外的静态体积感，夜晚也保持辨识。改色板 `C.*` 时保持 rgb 数组。
- **模型**：蜘蛛由 4 腿改为 **8 腿（4 对）+ 头胸 + 腹部**（SPIDER_PARTS 10 部件 → 240 顶点）；苦力怕身体更方；人形臂略细腿加粗。box 仍为 `[minX,minY,minZ,maxX,maxY,maxZ]`，原点脚底 y=0。
- **验证**：浏览器断言 `geo.attributes.normal` 存在、单位向量、各轴平均绝对值≈1/3（axial 法线分布）；`npm run build`（45 模块）；服务器单测不涉及（仅前端渲染）。

### 阶段 8 关键实现备忘（防回退）—— 怪物朝向 + 原版化贴图 + 天空盒

- **"脸贴头顶"根因 = top/bot 复用 front cell**：旧 `FACE_COL` 把 top→0 / bot→1，头顶画的是"脸"。修复：atlas 64×64 → **96×64（4 行 × 6 列，col 4=top / col 5=bot 独立绘制）**，`FACE_COL = {front:0, back:1, left:2, right:3, top:4, bot:5}`，`FACE_BRIGHTNESS` 增补 4:0.96 / 5:0.70。**`MobTextures.MOB_ATLAS` 导出尺寸常量，`buildMaterials` 画布必须 `canvas.width=96` + `drawImage(img,0,0,96,64)` 同步**（不同步会把 96 宽图压进 64 画布，UV 全错）。
- **"蜘蛛头在身后"根因 = yaw 公式反向**：`Mob.js` 的 `yaw = atan2(-nx,-nz)` 使局部 +Z（脸/头面）指向移动反方向。修复为 `atan2(nx, nz)`（chase 与 wander 两处）。**勿回退**。验证法：chase 中 `dot((sin yaw, cos yaw), normalize(playerPos-mobPos)) ≈ 1`。
- **侧面贴图镜像修复**：FACE_DEFS 每面带显式 `uvs` 选择器（侧面 `[[1,0],[1,1],[0,0],[0,1]]`、顶底 `[[0,0],[1,0],[0,1],[1,1]]`），`uvs.push(us ? uv.u1 : uv.u0, vs ? uv.v1 : uv.v0)`。旧 `c<2 ? u0 : u1` 是镜像根源。
- **原版化皮肤**：僵尸无发 + 青衫 + **HUMANOID_PARTS 手臂沿 +Z 前伸**（box y 1.28..1.50，z 0.14..0.89）；骷髅用 **SKELETON_PARTS**（细肢 0.14 宽，MobTypes.skeleton 引用）+ 全骨白；苦力怕经典脸（眼 4×4 @ rows4-7，嘴上窄中宽下分叉）；蜘蛛头前红眼。改皮肤时保持 6 面 partCells 结构。
- **天空盒跟随（防"远处纯黑"）**：`Sky.update()` 必须 `skyMesh.position.set(playerPos)` + 构造时 `frustumCulled = false`。天空球半径 500 固定在原点时，玩家离原点 >far(1000)−500 后球面被远裁剪面裁掉露出黑色 clearColor。
- **验证**：agent-browser 冒烟——atlas 96×64 断言（`mobTextures.get('zombie').image.width===96`）、top-cell UV 使用断言（u∈[0.667,0.833]）、4 怪正午特写截图（脸在头正面/手臂前伸/经典脸/蜘蛛红眼）、传送 (2500,95,2500) 天空蓝天无黑。拍摄技巧：`spawnEnabled=false` + `detectionRange=0` + `burningInDay=false` 防走位/爆炸/燃烧干扰；旁观模式瞬移后相机有平滑，需置 `_specSmoothed/_specSmoothYaw/_specSmoothPitch = null`。

### 阶段 9 关键实现备忘（防回退）—— 方块材质重绘 + 发光区块重建崩溃修复

- **`ChunkMesh.js` 的 `yOff` 未定义曾致画面永久冻结（高危，勿删）**：light 面（发光方块 light≥13，如火把/荧石/岩浆/红石灯）顶点微抬引用的 `yOff` 曾从未定义——**含发光方块的 chunk 一旦重建即 `ReferenceError` → `Game.update` 抛错 → `Game.loop` 的 rAF 链断裂（`requestAnimationFrame` 不再排下一帧）→ 画面冻结且时间不走**。现已在 `build()` 作用域定义 `const yOff = 0.001`（顶面微抬防 z-fighting）。浏览器侧没有覆盖"放置发光方块后区块重建"的回归，排查"画面冻住"类问题先手动 `game.update(0.016)` 抓异常（`agent-browser console` 只显示 console.*，不捕获 pageerror）。
- **材质重绘结构**：`BlockDefs.js` 用 `makeTex/setPx/fillRect/rgb([r,g,b],f)/hash2` 像素画工具 + 三色噪声 `noiseTex`（基色为主 + 暗/亮碎点 + 轻微抖动）+ 2×2 斑驳 `blotchTex`，结构化图案（圆石砌块错位、石砖大砖受光边、红砖交错缝、木板拼条端缝、原木年轮、矿石晶簇高光/阴影点、TNT 白带字样、工作台网格、熔炉炉口、砂岩分层）按原版配色校准。注册名 / textures key / SVG 管线未变；`redstone_block` 双注册已清理（保留 light 0）。
- **水体纹理平铺**：`waterTex` 的波纹用 `sin(x*π/8 + y*π/4)`（16 的整数分频周期）保证世界坐标 RepeatWrapping 平铺无缝，勿改回非周期函数。
- **验证**：`node --check` + `npm run build`（45 模块）+ agent-browser 冒烟（创造物品栏一屏全图标核对 + 16 种方块阵列特写 + 摆放荧石后 `sky.time` 持续推进无冻结）。
