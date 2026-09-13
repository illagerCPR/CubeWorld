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

### Idea-2E 批次备忘（防回退）—— 铁傀儡（村庄护卫）

- **类型定义**：`MobTypes.iron_golem`（passive:true + guardian:true 双标记）——passive 使其不占敌对 MAX_MOBS/动物 MAX_PASSIVE 名额（`_passiveCount` 已排除）且被动族互不威胁（村民不逃铁傀儡、僵尸不猎铁傀儡）；guardian 驱动专属 AI 分支（先于 passive 分支判断）。血 100/伤 12/速 2.8（须能咬住 2.5 的僵尸骷髅）/xp:0。
- **护卫 AI（`Mob.updateGuardianAI`）**：敌对怪（非 passive 且 attackDamage>0）进入 detectionRange(12) → `chase()`（chase 的 `target.isMob` 分支自动走 `mobAttackMob`，勿另写攻击路径）；被玩家攻击 → `attackMob` 里 guardian 分支设 aggro(20s) 死追攻击者（复用中立 aggro 计时衰减，该衰减块对任意 mob 生效）；无敌情 → 有 home 走 `wanderVillage`，无则 `wander`。
- **大击退**：`mobAttackMob` 按 attacker.typeName==='iron_golem' 加倍击退（水平 12/垂直 7）——勿改成通用参数化（会动到僵尸咬村民的手感）。
- **村庄自动补员**：挂 `updateVillageSpawns` 的 spawnEnabled 块内（**必须在 for(rec) 循环体内**，曾插错作用域引用不到 rec）；门控 = 存活村民(home 匹配)≥5 且无存活护卫；冷却 = `villageGolemSeen` Map 记录"最后存活时刻"，死亡后 60s 补员，村庄卸载清记录（卸载即补）；生成点 = `meta.villagerSpawns[0] + x偏2`（确定性，两端一致）；联机走 `_spawnAt`→mob_spawn 回执（与村民同惯例，勿本地直接 spawnMob）。home 补挂与随村清扫两个循环都已扩到 iron_golem（清扫时同步删 seen 记录）。
- **手工召唤（`Game._trySummonIronGolem`）**：只在**本地放置成功路径**调用（放置分支内）——联机远端 block_set 不检测，防多端重复召唤；T 型 = 南瓜头 + 2 格铁柱 + 双臂（头/柱底/柱中三个完成入口都识别）；命中后 5 块 setBlock(0)（自动广播账本）+ `_spawnAt` 就地召唤。**验证教训**：agent-browser 瞄准放置精确格位不可行（mouse move 是绝对坐标制、movement=相邻两次差，且指针锁瞄准本就不可靠）——方法体用 eval 补块后直调 `_trySummonIronGolem` 走真实代码路径验证，钩子布线靠代码审查（单行、坐标即放置坐标）。
- **实测锚点**：索敌 chase+targetIsZombie、一拳 20→6.9、追至 0.81、击杀后回 idle；死亡掉落 iron_ingot 3-5；白天燃烧的亡灵尸体堆属正常现象（sky.time=0.5 引发，非 bug）。

### Idea-2D-① 备忘 —— 凋零骷髅头颅

- `wither_skeleton_skull` 物品（焦黑颅骨图标，stack 64）；凋零骷髅 drops 增 10% 掉率（原版 2.5%+抢夺，本作无附魔取 10%，200 次采样实测 8.5%）。凋零骷髅本身早已全挂钩生成表（`pickNetherSpawn` 纯函数：要塞 10%/灵魂沙峡谷 45%/其余 15%，有单测）——本批只补头颅。
- **凋灵 Boss + 信标维持独立立项**（TODO.md D 节）：召唤检测复用 `_trySummonIronGolem`/`detectEndRing` 套路，Boss 三段血条可参考 DragonAI + BossBar，玩家 buff 系统是 Player 状态机新领域——立项时先评审。

### Idea-2D-② 批次备忘（防回退）—— 凋灵 Boss + 头颅方块化

- **命名陷阱**：`WITHER_PARTS` 常量早已被**凋零骷髅**占用——凋灵 Boss 部件必须用 `WITHER_BOSS_PARTS`（勿复用旧名）。
- **头颅方块化**：BlockDefs 文件**末尾**追加 `wither_skeleton_skull` 方块（追加位置防 ID 错位）；与同名物品互通 = 放置走 `BlockRegistry.getByName(sel.name)` 命中（Game.js 通用放置分支）、破坏走 `_blockDropName` 默认同名词掉回物品——**零额外掉落/放置代码**。方块纹理三张（top/side/bottom，face 只在 side）。
- **召唤检测 `_trySummonWither`**：底排 4 灵魂沙 + 头排 3 头颅（头排相对底排左/右两种对齐 × x/z 两轴）；头/沙层位由**放置物**决定（放头→头层 y 底层 y-1；放沙→底层 y 头层 y+1）；h0 枚举 [-3,3] 由校验保证正确性（宽枚举无害）。只在本地放置分支调用（同铁傀儡防多端重复）；移除 7 块 setBlock 自动广播 + `_spawnAt('wither')`（联机自动 mob_spawn 回执，零额外协议）。
- **WitherAI**（`src/entity/WitherAI.js`）：rise（升空蓄能 4s）→ hover（绕玩家 8 格切向引导点，同 DragonAI circle 套路 + 正弦浮沉）→ 血量 <50% 狂暴（速度 ×1.45、射程 1.6s）。齐射经 `mobManager.onWitherShoot` 回调（Game.start 注入 `_spawnWitherSkullVolley` 三发扇形 ±0.14rad）——AI 不直接碰渲染层。Mob.js 分发插在 dragon 分支后、**传 mobManager**（dragon 分支不传）。
- **弹射物语义**（凋灵之首）：各端本地积分 + **命中本地玩家本地结算**（同怪咬人语义，非箭矢"射端权威"——箭矢打怪、弹丸打人）；广播纯视觉（服务器 `WITHER_SKULL` 同 arrow_shot except 发起者转发，server/room.js `onWitherSkull`）。命中判定 = 水平 0.6 格半径 + 1.8 身高线段（AABB 近似）；`spawnRemoteWitherSkull` 不再广播（防回声环）。限速：tierOf 未列出 → 天然不限速。
- **凋零 II**：`player.withered` 秒数（`applyWither` 取最大值刷新，创造/旁观拒绝）；**扣血节拍在 Game.updateSurvival**（每秒 1 血直扣不走 hurt、可致死、统一死亡判定在函数尾部）；**满食物回血会抵消凋零扣血**——验证时先 `player.food = 5`，否则 hp 不变误判失效。视觉 `Hud.setWithered` 紫黑滤镜（update 每帧同步 >0），hideAll 复位 + Game.start 重置 withered（Player 是共享型子系统）。
- **BossBar 多实例**：`update(mobs[])` 改传 **type.boss 数组**（Game 917 行 find 单龙旧调用勿回退）；内部 Map<typeName, row> 惰性建行，凋灵红条/龙紫条；新增 Boss 类型在 `_row` 补配色分支。
- **免击退**：`attackMob` 击退段包 `if (!closest.type.boss)`——只包玩家攻击路径，mobAttackMob 不动（铁傀儡仍可击退凋灵，可接受）。
- **实测锚点**：召唤→hover 索敌 41→28.5 收敛；自动齐射 skulls 0→2；弹丸命中 8 伤 + withered 8.4s；击杀掉 rotten_flesh+nether_star；BossBar fill 100%→1.7%；模型 168 顶点（7 部件 ×24）/皮肤 96×64。**冒烟陷阱**：召唤点选玩家脚下——上方有实心方块时 mob 嵌入被 collide 钳制（位置不动非 AI 失效），先传送开阔地再验；headless 页面 RAF 会停转（截图冻结帧），恢复 `g.running=true + requestAnimationFrame(g.loop)`，逻辑验证一律手动 `g.update(1/60)` 步进。

### Idea-2D-③ 批次备忘（防回退）—— 信标 + 玩家 buff 系统

- **`Player.effects` Map**（`name -> {level, time}`）：`applyEffect` 同名取 max(level,time) 刷新；`getEffectLevel` 过期返 0；`tickEffects(dt)` Game.update 每帧走。**凋零已迁入**（`applyWither` = applyEffect('wither',2,s)，扣血节拍仍在 Game.updateSurvival 读 `getEffectLevel('wither')`）。Player 是共享型子系统：`Game.start` 用 `clearEffects()` 重置（勿再找 `player.withered` 字段——已删）。
- **五个挂钩点**（改手感勿绕开）：移速 = Game 742 `speed` 式（+20%/级）；跳跃 = physics.jump 后乘（+25%/级，仅 velocity.y>0 时）；急迫 = 挖掘 `speedMul` 式（+30%/级，叠加在工具倍率上）；力量 = `getAttackDamage()` 尾部（+2/级，空手/剑/斧全分支）；抗性 = `Player.hurt` 盔甲减伤之后（-20%/级）。
- **信标方块**：BlockDefs **末尾**追加（light:15 进 light mesh 夜亮）；合成 = Crafting.js `['glass'×3, 'obsidian','nether_star','obsidian', 'obsidian'×3]`（原版式，node 侧 matchRecipe 断言过）。
- **金字塔检测 `_getBeaconPower`**：信标正下逐层 5×5/7×7/9×9/11×11（层 l @ y-l，half=l+1），**连续**层全为铁/金/钻石/绿宝石块才计数，断层即停。拆 1 层 = 降级（power 变小仍激活，效果等级 min(2,power) 实时调整）；全拆 = 失效（beacons.delete + 光柱移除 + 已上身 buff 自然衰减）。
- **脉冲**：`_updateBeaconPulse` 每 4s 遍历 beacons Map，范围 10×power，效果时长 12s > 周期 4s = **无缝续期**。效果选择是**内存级**（Game.beacons Map，换世界/重启丢失，方块本身走账本可重建激活）——勿当 bug。
- **光柱**：`_beaconBeams` Map<key, Mesh>（BoxGeometry 半透明白，y 到 250），`_ensureBeaconBeam` 先 remove 再建；`_breakBeacon`/失效/`_clearBeaconState`（Game.start 换世界）三处都清 + dispose。
- **BeaconScreen**：ChestScreen 同款生命周期（show 设 controls.enabled=false + 退指针锁 / hide 恢复 / E 键关闭 / paused 判定 / `_disposeWorld` dispose）。事件委托挂 **panel** 构造期（render 重建 innerHTML 无需重绑）。无基座只显示提示不出效果按钮。
- **实测锚点**：power:4 / 脉冲 lv2 无缝续期（time 9.8@5s 步进）/ 抗性 hurt(5)→3.0 / 力量 1→5 / 拆层降级 & 全拆 beacons:0 beams:0 / UI"金字塔 3 级"实时 / beacon 方块 ID 129 / 配方 matchRecipe→beacon x1。
