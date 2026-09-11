# Agent 备忘 · 联机

> 本文件内容为 AGENTS.md 批次备忘**原文搬移（未改写）**，用于控制 AGENTS.md 体积（会话注入预算 65536 字节，超限会被静默截断）。
> 导航见 AGENTS.md「批次备忘索引」；新批次备忘按主题追加到对应小节，并同步更新 AGENTS.md 索引表。

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

### 阶段 10 关键实现备忘（防回退）—— 手持物 3D 化 + 快捷栏同步 + 掉落归属锁 + 多账号 + RTT

- **手持物 3D 化**：`src/render/HeldItemMesh.js`（模板缓存进程级，clone 复用；方块=六面贴图立方体、`renderType==='cross'` 方块=交叉双面薄片、物品=双面薄片；材质 `MeshLambertMaterial` + `emissiveMap` 同贴图 0.35 自发光，夜晚可见；**勿改回 sprite billboard**）。`src/render/FirstPersonHand.js` 第一人称：**camera 必须加入 scene（`scene.add(camera)`）其子节点才渲染**（`Game.constructor` 一次性挂载，属共享型子系统——`start()` 里重置 `currentName=undefined` 强制重建）；按住左键自动连续挥动（0.3s 冷却），放置/食用/命中命中时 `hand.swing()`。`RemotePlayer._setHeld` 挂 `armR.pivot`（dispose 只 remove 不 dispose，几何/材质为共享缓存）。
- **整条快捷栏同步**：`player_full` 带 `hotbar`（9 槽），`Room.sanitizeHotbar` 校验（一项非法整体丢弃、保留旧值）；`Room.joinInfo(p)` 供 joinRoom/createRoom/resetWorld 回放 `PLAYER_JOIN`（带 `selected`/`held`/`hotbar`）——**新加入者立即看到在线玩家手持物**；`RemotePlayer.applyFull` 无 held 时用 `hotbar[selected]` 推导。
- **死亡掉落归属锁**：账本 `owner`/`ownerUntil`（3 秒）；广播 `drop_spawn` 带 `owner`/`ownerLock`（剩余毫秒）；锁内非 owner `drop_taken` → 服务器 `drop_deny` + **补发 drop_spawn**（客户端重建实体）；**账本已不存在的 drop_taken 也回 deny**（防两人同时拾取复制物品，勿删此分支）；客户端 deny 回滚 = `takePendingPickup(id)` 取拾取留档 + `Inventory.removeItems(name, count)`；本地预判拦截在 `MobManager.updateDroppedItems`（`getSelfId` 由 Game 注入，勿删）。
- **管理多账号**：`config.adminAccounts=[{token,label,expires}]`（≤10）；旧 `adminToken`/`adminTokenExpires` 是 default 账号的兼容接口（`applyConfig` 双向同步）；`authState` 遍历账号匹配；**id = token 的 SHA-256 前 8 位**（`accountId()`），rotate/revoke 按 id 定位避免明文回传——**轮换后 id 会变**（客户端须重新拉列表）；token 生成用 `crypto.randomBytes(24).toString('base64url')`，明文仅创建/轮换响应返回一次。admin.html 生成/轮换用 `prompt` 显示新口令（agent-browser 需 `dialog accept`）。
- **RTT 直测**：客户端每 2s 发 `ping {seq, ts: performance.now()}`，`room.handle` PING 分支**回显 `ts`**（勿删）；客户端 PONG 分支按 `ts` 算 EMA(0.8/0.2) → `NetworkManager.rttMs`；`RemotePlayer` 自适应以 RTT 为主信号（目标 = clamp(0.05 + rtt/2000, 0.05, 0.4)，每秒 40% 平滑靠拢），头余量仅保留欠载保护（>0.22 降延迟仅限无 RTT 数据时）；InfoBar 联机显示「网络: Xms」（第 5 参数 `rttMs=null` 隐藏）。
- **验证**：`node --check` + `npm run build`（47 模块，655 kB）+ `test-stage10.mjs` 41/41 + 全基线绿 + agent-browser 冒烟（第一人称手持方块/火把/物品截图、远端手持模型、joinInfo 回放断言、InfoBar RTT 行、掉落锁确定性断言：**注入 fake drop（owner≠self, lockedUntil>now）手动驱动 updateDroppedItems → 拦截；置 lockedUntil=0 → 拾取**——浏览器实时 3 秒锁内断言受命令间隔/pickupDelay 干扰不可靠，用此注入法）。
