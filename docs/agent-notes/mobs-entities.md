# Agent 备忘 · 怪物与实体

> 本文件内容为 AGENTS.md 批次备忘**原文搬移（未改写）**，用于控制 AGENTS.md 体积（会话注入预算 65536 字节，超限会被静默截断）。
> 导航见 AGENTS.md「批次备忘索引」；新批次备忘按主题追加到对应小节，并同步更新 AGENTS.md 索引表。

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

### P3 批次备忘（防回退）—— 被动动物 / 末影人（可再生掉落源）

- **四类新生物**：牛（beef+leather）、羊（white_wool）、鸡（feather+raw_chicken）——`passive: true` 走村民系 AI 分支，白天草地成群（2-3 只）生成，独立上限 `MAX_PASSIVE=12`（不含村民，不挤 MAX_MOBS 敌对名额）；末影人（ender_pearl 0-1）——`neutral: true` 受击激怒 + **受击 60% 瞬移**（`_teleportMob`：±16 格下扫首个"实心+2 格净空"，8 次失败原地不动），夜晚主世界表 10% 混入 + 末地主产。
- **trySpawn 结构**：被动动物分支插在"亮度门**之前**"（白天可生成）；`_spawnAt(typeName,wx,wy,wz)` 是 trySpawn 尾部提取的共用入口（群生成也走它，联机自动经 mobNet 广播）。末地原先 `return` 改为末影人 50% 生成。
- **⚠ 命中球改身体中点（攻击几何变更）**：attackMob/findMobByRay 的球心从**脚底**改为**身体中点**（oc.y -= height*0.5）、半径 `max(width,height)*0.5`——旧脚底球对高个怪（末影人/凋零骷髅）球顶只到 height/2，平射/平砍被切顶（disc≈-8e-15 浮点负零实测）几乎无法命中。改后平射可命中高个怪；矮怪（蜘蛛等）横向覆盖同步变准。
- **掉落是"世界实体"不是直进背包**：mob 掉落经 `dropLoot→spawnDrop→droppedItems`（pickupDelay 1s + 走近拾取）——验证掉落要数 `mm.droppedItems` 而非 inventory；挖矿/砾石掉落才是直进背包（Game._blockDropName 路径）。
- **agent-browser 生成验证**：trySpawn 有 SPAWN_INTERVAL=2.5s 节流——直连循环 `mm.trySpawn(playerPos, isNight)` 绕过节流；**敌对名额满员会让末影人挤不进**（清场必须驱动 update 让 dyingAnim 走完 splice，光标 dead=true 不够）；桩随机需用**循环值序列**（恒值会把生成落点也固定死在无效格）。

- **agent-browser 打怪验证**：怪会走位导致脱靶——`m0.speed = 0` 冻结 AI 再射；箭矢伤害断言读 `hpBefore-hpAfter`（=6），勿断言必杀（20 血怪一箭不死是正确行为）。

- **agent-browser 验证手法**：右键交互用 `controls.mouseRight = true + update(1/60) 步进`（真实处理器路径）；掷眼碎裂桩用 `random => 0.9`（**≥0.8 才碎**，0.1 是落回分支——桩方向勿写反）；床重生断言 respawn() 直调 + 位置比对床顶。

- **agent-browser 验证经验链**：夜晚奖励经验走真实路径（`sky.time=0` + RAF 实跑数秒等 MobManager 夜间生成 → attackMob 击杀）比 eval 造实体可靠（Mob 类未挂 window）；**跨级时"xp+level*100"复合度量会被升级权重污染**——断言分项读 `player.xp` 与 `xpLevel`；经验瓶消耗断言读数量（2→1）而非槽位消失。

- **agent-browser 断言注意**：存档 JSON 的槽位字段是 `n/c/d`（不是 name/count）——eval 断言读 `.n`；槽位点击可用 `el.dispatchEvent(new MouseEvent('mousedown', {button:0}))` 直击 InventoryScreen 的 onmousedown 处理器（a11y 树对纯 div 槽位不可见，@eN 引用拿不到）。

- **headless 挖掘时长验证必须手动驱动**：RAF 在软渲染下变速（~2.3× 慢），墙钟采样不可信——`g.running=false` 停循环 + 循环 `g.update(1/60)` 步进数帧（mouseLeft 直接置位），断言 `brokenAt` 帧数/背包增量；复用会话前记得 `running=true; requestAnimationFrame(g.loop)` 恢复。

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
