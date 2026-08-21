# AGENTS.md

## 语言

- 对话回复使用简体中文（用户全局约束，见 `~/.claude/CLAUDE.md`）。
- 代码标识符用英文，不用汉语拼音。

## 开发命令

```bash
.\start.cmd start    # 启动 Vite 开发服务器 (127.0.0.1:5173)，后台常驻
.\start.cmd stop     # 停止服务器
.\start.cmd restart  # 重启
.\start.cmd status   # 查看是否在跑
npm run build        # 生产构建
npm run preview      # 预览构建产物
node --check <file>  # 语法检查（唯一可自动化验证手段）
```

- 不走 `npm run dev`：`start.cmd` 直接后台拉起 `node node_modules\vite\bin\vite.js`，最小化窗口标题 `vite-dev-server`。端口 5173 无响应时先 `.\start.cmd status`，必要时 `restart`。
- 无测试框架、无 lint、无 typecheck。修改后必须 `node --check` 改动的每个文件，再用浏览器/playwright 手测。
- Vite 5 + Three.js 0.160，ESM 原生导入，无打包工具链额外配置。

## 验证 / playwright-cli

- 不要直接 `playwright-cli open <url>`（启动失败）。要用带 `.cmd` 扩展的完整路径：
  `& "C:\Users\illag\AppData\Roaming\npm\playwright-cli.cmd" reload|click|eval|console <args>`
- `playwright-cli eval` 中的字符串字面量常被 PowerShell 吃掉引号/反引号；传含 `name: "torch"` 之类参数时改用 `String.fromCharCode(...)` 拼接，或把脚本写到临时文件再 `eval --filename`。
- playwright 无 pointer lock 能力，ESC 暂停 / 死亡屏幕等 pointer-lock 相关流程只能 `eval` 直接调用 `pauseMenu.show()`/`deathScreen.show()` 验证。
- **不要用 Read 工具读取 PNG 截图文件**，会导致进程异常停止。

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

### 纹理管线（硬性约束：所有纹理必须 SVG 程序化生成）

**禁止使用外部图片文件或读取图片。** 纹理全由 SVG 字符串生成：

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

- 区块 16×16×256，`Uint8Array` 存储方块 ID，海平面 Y=64。
- 渲染距离 6 区块半径，每帧最多重建 2 个脏区块网格。
- 贪心网格合并（Greedy Meshing）在 `src/render/ChunkMesh.js`。
- `World.setBlock` 会把当前 chunk 和边界邻居标记 `dirty=true`；任何写方块的路径必须走 `setBlock`，否则网格不更新。
- `ChunkMeshBuilder.build()` 输出三个 mesh：`solid` / `water`（半透明 DoubleSide） / `light`。`light` 是 `light >= 13` 的方块（火把/红石火把/荧石/海晶灯/岩浆/红石灯）单独用 `MeshBasicMaterial` 重画一遍，使其夜里也明亮。`Game.rebuildDirtyChunks` 和卸载逻辑必须同时处理三者。
- **UV 朝向陷阱**：solid 面 UV 顺序为 `(u0,v0)(u0,v1)(u1,v0)(u1,v1)`（顶点顺序 [底,顶,底,顶]，方块顶部对应 SVG 顶部）。cross 类型（火把/花/按钮）UV 顺序相同。颠倒这顺序会导致草侧面、火把等纹理上下倒置。
- **水体纹理独立于图集**：水面/侧面/底面用 `waterTexture`（独立 `CanvasTexture`，`RepeatWrapping`，16×16），UV 按**世界坐标** `(x+offX, z+offZ)` 平铺，跨 chunk 连续（不要改回图集子区域 UV，否则远处水面会出方格分界）。`ChunkMeshBuilder` 构造函数第 4 个参数接收 `waterTexture`；water mesh 的材质 `map` 必须指向它。
- **水下方块面剔除陷阱**：`ChunkMesh.build()` 中三段面剔除：① 邻居是不透明非流体 → 剔除；② 当前是水且邻居是同 id 水 → 剔除；③ 非水方块相邻流体且流体不透明 → 剔除。**关键**：水和岩浆都是 `transparent: true`，故其二段"剔除"条件包含 `&& !neighborDef.transparent`，否则水下方块（沙子/石头与水相邻的方向）会被错误剔除，导致水里看不到任何方块。曾经 bug 表现为"水下方块不渲染、远处只见 chunk 边界"——远 chunk 未生成时 `getBlock` 返回 0（air），邻居 air 时不触发任何剔除，所以 chunk 边界方块反而画了。
- **跨 chunk 邻居查询**：`ChunkMeshBuilder.build()` 的 `getBlock` 在 `x/z` 越界时调 `world.getBlock(gx,gy,gz)`（line 76-78）；`y` 越界直接返回 0（air）。`World.getBlock` 在 chunk 不存在时也返回 0，远 chunk 边界因此被当成 air 看——这是"远处只见区块边界"的隐藏成因。

### 天空与昼夜（修改前必读）

- `Sky.time` 语义：`sunY = sin(time*2π - π/2)`，即 `0=半夜, 0.25=日出, 0.5=正午, 0.75=日落, 1=半夜`。`Sky.dayLength = 1200` 秒。
- `skyColors` 数组的 t 锚点**必须**与上述太阳位置一一对应（0.25=粉橙日出，0.5=蓝天正午，0.75=粉橙日落，0/1=深夜）。错位会让玩家在白天看到夜空色，全屏偏暗。
- 光强：`sunLight = 0.15 + dayFactor*1.3`，`ambient = 0.30 + dayFactor*0.50`，`dayFactor = max(0, sin(angle))`。夜晚保留 0.15 余晖避免伸手不见五指。

### 怪物系统

- `MobManager` 管理生成（夜晚优先，MAX_MOBS=20）、更新、渲染、掉落物。
- 怪物模型用 **box-parts cuboid**：每只怪是一个 BufferGeometry，由若干 cuboid 部件合并而成（head/body/2 arm/2 leg 等），共 ≈ 6 部位 × 6 面 × 2 三角形 = 72 三角形/怪。**不再用 4 面 billboard**。
- 怪物纹理用**独立 64×32 皮肤 atlas**（4 行 × 4 列，cell 16×8 像素），每 type 一份私有 `CanvasTexture`，**不再合并到全局方块/物品图集**。
- 皮肤 atlas 布局：row 0=head, row 1=body, row 2=arm, row 3=leg；col 0/1/2/3 = front/back/left/right；顶/底面复用 col 0/1。UV 查表用 `mobSkinUV(partRow, faceCol)`，FaceEnum 由 `FACE_COL` 映射。
- 模型部件定义在 `MobTextures.js` 中 `HUMANOID_PARTS`/`CREEPER_PARTS`/`SPIDER_PARTS` 常量；`MobTypes[type].model.parts` 引用。box = `[minX, minY, minZ, maxX, maxY, maxZ]`，**局部坐标系原点在脚 y=0，+Z 朝玩家**。
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
- `InfoBar`：游戏内左上角 4 行 —— 坐标 / 生物群系 / 时间 / **准星目标**（`targetLine`）。`update(player, generator, sky, crosshairInfo)` 第 4 个参数是 `{type:'block'|'mob', displayName, name}` 或 null。`crosshairInfo` 由 `Game.updateRaycast()` 每帧算好并存到 `this.crosshairInfo`：方块 hit + mob hit 取较近者。Mob 命中靠 `MobManager.findMobByRay(origin, dir, maxDist)`（不伤害的纯查询版，球体射线检测半径 = `mob.height/2`，与 `attackMob` 同口径）。ator.getBiome()` 更新。
- `InventoryScreen`：每个 slot 通过 `_bindHover()` 挂载 mouseenter/mouseleave 悬浮 tooltip（显示 `displayName`）。`returnCursorItem()` / `hide()` 必须同时隐藏 tooltip。
- **创造栏去重陷阱**：`renderCreative()` 用 `[...BlockRegistry.all(), ...ItemRegistry.all()]` 合并展示列表。部分方块名在两边都注册——`lever` / `stone_button` 既在 `BlockDefs.js` 作方块又在 `ItemDefs.js` 作物品注册——不去重会出现两个相同物品槽。修复：方块优先，同名物品在合并时跳过。新加"既是方块也是物品"的项目时务必检查是否双注册。
- `PauseMenu` / `DeathScreen`：禁用 `controls.enabled` + `exitPointerLock`，hide 时恢复。`PauseMenu` 不要再自带 ESC 监听器（会与 Game 的 ESC 切换同一事件内既打开又关闭）。`Game._setupPauseOnUnlock()` 监听 `pointerlockchange` 在指针锁意外丢失时自动弹暂停菜单。

## 代码风格

- 纯 vanilla JS（.js），无 TypeScript，无 JSX。
- 注释用中文，代码标识符用英文；不添加注释除非明确要求。
- 文件头部有简短中文说明注释（如 `// Game.js -- 游戏主类`），新文件保持此习惯。

## 平台

- Windows 开发环境，PowerShell 5.1。链式命令用 `;` + `if ($?)`，不要用 `&&`。
- 路径含空格的可执行文件用 call 操作符 `& "..."`。
- `Read` 工具对长文件有重复返回前几行的 bug，长文件请改 `Get-Content ... | Select-Object -Skip N -First M` 或 `Select-String`。
