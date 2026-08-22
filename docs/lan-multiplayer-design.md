# Project-MC 局域网联机设计文档

> 版本：v0.3（阶段 1 已实现并通过验证）
> 状态：阶段 0（MVP）完成（2026-08-21）；阶段 1（掉落物/断线重连）完成（2026-08-22）
> 阶段 0 新增：`server/`（index/room/protocol）、`src/net/NetworkManager.js`、`src/entity/RemotePlayer.js`、`src/ui/ChatBox.js`
> 阶段 0 改动：`World.js`（setBlock 上报钩子）、`Game.js`（联机集成）、`MobManager.js`（spawnEnabled）、`MenuScreen.js`/`main.js`（联机入口）、`start.cmd`（server 子命令）
> 阶段 0 验证：`server/test-mp.mjs` 协议 13/13 PASS；浏览器 host + Node 客户端双端链路验证通过
> 阶段 1 新增能力：掉落物生成/拾取/过期同步（`drop_spawn`/`drop_taken`）、服务器掉落物账本、断线指数退避自动重连（原位续玩不重启）、玩家离开广播带昵称、首次加入方块/掉落物账本回放缓冲修复
> 阶段 1 验证：`server/test-mp.mjs` 协议 19/19 PASS；浏览器 host + Node 客户端掉落物全链路（生成→广播→拾取→移除）+ 两轮服务器宕机/重启断线重连验证通过
> 开发中发现并修复：①服务器心跳误用协议层 pong（应用层 JSON ping 需客户端回 JSON pong，否则 30s 踢出）；②`set_time/time` 时间字段与消息类型键 `t` 冲突（改为 `time` 字段）；③方块同步需统一挂 `World.setBlock` 钩子（`bindWorld`）而非散点手动上报，保证爆炸/活塞也同步；④首次加入时 `world_info` 后紧接的方块/掉落物账本回放可能先于世界就绪到达而被丢弃——增加 `_ready` 预就绪缓冲队列；⑤重连关闭旧 socket 时旧 onclose 会误触发重连调度——用 `this.ws !== ws` 守卫只处理当前 socket

---

## 1. 目标与范围

### 1.1 目标

在现有单机 Project-MC（Vite 5 + Three.js 0.160 纯前端 Minecraft 风格游戏）上增加**局域网多人联机**能力：

- 多台局域网电脑（或同一台电脑多个浏览器标签）同时进入同一个世界。
- 玩家之间互相可见、可移动、可共建/破坏方块。
- 玩家状态（生命/食物/模式/手持物品/死亡重生）互相可见并可交互。
- 聊天与昼夜时间同步。

### 1.2 本期范围（阶段 0 MVP）

- [x] 独立 Node 房间服务器（`server/`）。
- [x] 方块修改的跨端同步（建造/破坏/TNT 爆炸）。
- [x] 远端玩家实体渲染与平滑移动。
- [x] 玩家状态全量/增量同步（健康、食物、模式、手持物品）。
- [x] 死亡/重生广播与互殴（玩家伤害玩家）。
- [x] 昼夜时间同步。
- [x] 聊天。
- [ ] 怪物同步（**明确本期不做**，见 §9）。
- [ ] 红石状态细同步（各端独立收敛，见 §9.3）。

### 1.3 非目标

- 互联网公网联机（不做 NAT 穿透 / 中继服务器）。
- 反作弊 / 权限体系（局域网信任环境）。
- 服务器权威物理（见 §3 架构取舍）。
- 无缝大世界流式（沿用现有渲染距离 6 区块的按需加载）。

---

## 2. 现状架构与关键约束

### 2.1 架构现状

| 层 | 现状 | 对联机的影响 |
|---|---|---|
| 入口 | `src/main.js` 创建单个 `Game` 实例，`window.game` 全局暴露 | 网络层可从这里挂载 |
| 主循环 | `Game.update(dt)` 每帧驱动物理/怪物/红石/方块/UI | 物理与 AI 全在浏览器端 |
| 世界 | `World` 用 `Map` 存 chunk，方块存 `Uint8Array` | **确定性生成**，见下 |
| 地形 | `TerrainGenerator(seed)`：SimplexNoise + LCG 伪随机（`generateStructures` 的 `rand()`），全流程**无 `Math.random`** | **同 seed 各端生成完全一致的地形**——联机无需传输地形 |
| 方块写入 | 唯一入口 `World.setBlock()`，同时维护 `this.modifiedBlocks`（`"x,y,z" -> id` 增量表） | **天然的网络广播 hook 点**，增量表即传输格式 |
| 存档 | localStorage 多槽位：`seed + modifiedBlocks + player + redstone + sky` | 多人下需改保存策略（§8） |
| 怪物 | `MobManager` 浏览器端运行 AI/受击/掉落，`Mob.js` AI 不依赖 DOM 但耦合 `world/physics` | 怪物同步最重，本期不做（§9） |
| 玩家模型 | 无玩家第三人称模型；`MobTextures.js` 有 `HUMANOID_PARTS`（zombie/skeleton 共用）可复用 | 远端玩家模型可复用 box-parts 方案 |

### 2.2 三个可利用的"架构红利"

1. **确定性世界生成** → 客户端只需拿到 `seed` 即可本地生成世界，网络只同步"修改增量"。
2. **`setBlock` 唯一写入入口** → 只要在 `World.setBlock` 挂一个回调，即可截获所有方块变更（含挖掘/放置/活塞/TNT）。
3. **`modifiedBlocks` 现成增量格式** → 与网络消息格式天然一致，`"x,y,z" -> id`。

### 2.3 必须绕开的坑

- 浏览器端无法监听 TCP 端口 → 房间主机必须是独立 Node 进程。
- `Game.update()` 中物理/AI/红石与 DOM、Three.js 渲染紧耦合 → **不要把核心逻辑搬到服务器**（方案 A 否决，见 §3）。
- `World.setBlock` 会被"远端落地方案"再次触发 → 必须区分"本地发起"与"远端落地"，避免回环重发（§6.2）。

---

## 3. 总体架构：轻量主机 + 各端自跑

### 3.1 方案对比（选型记录）

| 方案 | 思路 | 结论 |
|---|---|---|
| A. 权威服务器 | 世界/物理/AI 全在 Node，客户端只发输入 | 否决：`Game.update()` 与 DOM/Three 紧耦合，等价于把核心逻辑重写一遍到服务端，工作量与风险最大 |
| B. WebRTC P2P | 浏览器直连，无服务器 | 否决：信令握手/仲裁麻烦，且仍需要一个协调节点，对局域网收益低 |
| **C. 轻量主机 + 各端自跑（选用）** | Node 服务器做**房间管理 + 方块仲裁 + 玩家中继**；各客户端**同 seed 自行生成世界、自跑本地物理/AI**，只同步增量 | 改动可控、可渐进，符合本期目标 |

### 3.2 职责划分

```
                    ┌─────────────────────────────┐
                    │   Node 房间服务器 (server/)  │
                    │  · 房间/玩家管理             │
                    │  · seed 唯一来源（host 决定） │
                    │  · modifiedBlocks 主副本     │
                    │  · 方块修改仲裁(last-write)   │
                    │  · 消息广播/转发             │
                    │  · 昼夜时间权威              │
                    └──────────────┬──────────────┘
                     WebSocket  /ws (ws://主机IP:3001)
          ┌───────────────────────┴────────────────────────┐
          ▼                                                  ▼
   ┌───────────────┐                                  ┌───────────────┐
   │  客户端 A      │                                  │  客户端 B      │
   │  Game 实例     │                                  │  Game 实例     │
   │  · 本地生成世界 │       同 seed，各自生成          │  · 本地生成世界 │
   │  · 本地物理     │◄──── 地形完全一致 ────►          │  · 本地物理     │
   │  · 本地怪物AI   │   （本期关闭生成）               │  · 本地怪物AI   │
   │  · 方块修改→上报│                                  │  · 方块修改→上报│
   │  · 渲染远端玩家 │                                  │  · 渲染远端玩家 │
   └───────────────┘                                  └───────────────┘
```

关键原则：**服务器不是游戏权威，只是"方块账本 + 广播总线"**。每个客户端对本地世界完全自洽（能单机运行），联机只是把"本地产生的外部可见状态"上送并接收"别人产生的状态"。

### 3.3 为什么这个模型可行

- 方块：客户端本地 `setBlock` → 上报服务器 → 服务器更新主副本 → 广播 `block_change` → 其他客户端在本地 `setBlock` 落地并触发网格重建/红石。由于各端地形一致，同一坐标的方块修改在任意端产生相同的渲染结果。
- 玩家：各端本地物理（确定性+本地输入），位置/朝向按 20Hz 上报，远端用插值平滑（§7）。
- 怪物：本期直接不生成（见 §9），避免各端 AI 漂移造成"打空气"。

---

## 4. 主机模型与网络拓扑

### 4.1 运行形态

- **服务器**：`server/index.mjs`，原生 `node:http` + `ws` 依赖，监听 `0.0.0.0:3001`（端口可配）。
- **客户端**：普通浏览器页面（Vite dev `5173` 或 `npm run build` 产物）。
- **拓扑**：星型，所有客户端 WebSocket 直连服务器，不点对点。

### 4.2 启动流程

1. 开房者启动服务器：`node server/index.mjs`（或用扩展后的 `start.cmd server`）。
2. 开房者在页面"局域网联机"面板点击**创建房间** → 客户端连接 `ws://<本机IP>:3001`，发送 `create_room`（带 seed、模式、昵称）。
3. 其他玩家在页面输入 `ws://<开房机IP>:3001` → 发送 `join_room` → 服务器返回 `world_info`（含 seed）→ 客户端用该 seed 本地生成世界并进入游戏。
4. 服务器广播玩家进出，各端渲染远端玩家。

### 4.3 Windows 防火墙

- 监听端口需放行（Node 首次监听会弹防火墙授权，或手动 `netsh advfirewall` 放行 TCP 3001）。
- 客户端通过 `http://<开房机IP>:5173`（dev）或部署地址访问页面，**服务器 IP 与页面 IP 通常相同**（都在开房机）。

---

## 5. 通信协议设计

### 5.1 传输

- WebSocket 文本帧，JSON 消息。
- 消息统一为 `{ t: '<type>', ...fields }`，`t` 为类型。
- 连接建立即发送 `hello`，服务器回 `welcome`，随后进入房间流程。

### 5.2 客户端 → 服务器（C2S）

| `t` | 字段 | 说明 |
|---|---|---|
| `hello` | `name, version` | 连接握手，登记昵称 |
| `create_room` | `name, seed, mode, slot?` | 开房：决定世界 seed（唯一来源） |
| `join_room` | `room?` | 加入默认房间（单房间实现） |
| `leave_room` | — | 主动退出 |
| `block_set` | `x, y, z, id` | 客户端请求修改方块（含挖掘/放置/爆炸产物） |
| `drop_spawn` | `x, y, z, name, count` | 请求生成掉落物（服务器分配 id 并广播回执） |
| `drop_taken` | `id` | 拾取掉落物（从账本删除并广播） |
| `player_state` | `x,y,z,yaw,pitch,onGround,flying,inWater,selected` | 高频状态（20Hz） |
| `player_full` | `health,food,saturation,mode,slot,inventory?` | 低频全量（加入时/变更时/重生后） |
| `attack_player` | `targetId, damage` | 玩家攻击玩家 |
| `player_died` | — | 本地玩家死亡（服务器广播，供他人 UI） |
| `respawn` | — | 重生请求 |
| `gamemode` | `mode` | 切换模式（host 才被采纳） |
| `chat` | `text` | 聊天消息 |
| `set_time` | `t` | host 专用：设定昼夜时间 |
| `ping` | `seq` | 心跳/延迟测量 |

### 5.3 服务器 → 客户端（S2C）

| `t` | 字段 | 说明 |
|---|---|---|
| `welcome` | `selfId, players: [{id,name,pos}]` | 握手回执 + 当前在线列表 |
| `world_info` | `seed, mode, time` | 客户端据此生成世界（进入房间后下发） |
| `room_created` | `roomId` | 开房确认 |
| `player_join` | `id, name, pos, mode` | 新玩家进入 |
| `player_leave` | `id` | 玩家离开 |
| `block_change` | `x,y,z,id,by` | 仲裁后的方块修改广播（**服务器唯一权威**） |
| `drop_spawn` | `id, x,y,z,name,count` | 掉落物生成广播（含发起者，各端创建同一实体） |
| `drop_taken` | `id, by` | 掉落物拾取/过期移除广播（by=0 为过期自然消失） |
| `player_state` | `id, ...(同 C2S 字段)` | 转发某玩家高频状态 |
| `player_full` | `id, ...(同 C2S 字段)` | 转发某玩家低频全量 |
| `player_died` | `id` | 某玩家死亡 |
| `respawn` | `id, x,y,z,health,food` | 某玩家重生位置 |
| `attack_player` | `fromId, targetId, damage` | 玩家互殴伤害广播 |
| `gamemode` | `id, mode` | 玩家模式变更 |
| `chat` | `from, text` | 聊天广播 |
| `time` | `t` | 昼夜时间广播（host 每 ~5s + 变更时） |
| `pong` | `seq` | 心跳回执 |

### 5.4 编号与来源

- `selfId` 由服务器分配（递增整数），客户端用它区分"自己 vs 远端"。
- 所有 S2C 消息带 `id` 表示来源玩家；客户端对 `id === selfId` 的消息一般忽略（自己已经本地应用过），`block_change` 除外（用于冲突校正）。

---

## 6. 客户端改造详细设计

### 6.1 `src/net/NetworkManager.js`（新增）

职责：连接管理、消息编解码、事件分发、心跳。

```
class NetworkManager {
  constructor(game)                    // 绑定 Game，但不要求在构造时已 start
  connect(url, name)                   // 建立 ws，注册 onopen/onmessage/onclose
  on(type, handler) / emit(type, data) // 内部事件总线
  send(type, data)                     // 序列化发送
  _handle(msg)                         // 消息路由：block_change / player_* / chat / time ...
  isConnected() / selfId
  sendState(player, lowFreq=false)     // 打包 player_state / player_full
  sendBlock(x,y,z,id)                  // 本地发起方块修改上报
  applyRemoteBlock(x,y,z,id)           // 远端落地（见 §6.2 防回环）
  close()
}
```

关键点：
- 高频 `player_state` 节流 50ms（20Hz），`player_full` 只在变更时发。
- 断线重连：指数退避重试（1s→15s 封顶，8 次）+ 提示"已断开/重连中"；重连成功重新 `hello`+`join_room`，由于世界已就绪（`_ready`），`world_info` 走"续玩分支"（不重启，仅同步时间/模式 + 账本回放纠正）。主动 `close()` 不重连。
- 消息容错：未知类型忽略；字段缺失按 0 处理，不让远端脏包崩游戏。
- 首次加入缓冲：`world_info` 与账本回放之间世界未就绪，`block_change`/`drop_*` 先入 `_pending*` 队列，`onWorldStarted()` 后统一落地。

### 6.2 `World.setBlock` 挂钩与防回环

```js
// World.js 增加
this.onLocalBlockChange = null; // 本地发起回调 (x,y,z,id) => void，由 NetworkManager 注册

setBlock(gx, gy, gz, id, recordMod = true) {
  // ...原有逻辑不变...
  if (this.onLocalBlockChange) this.onLocalBlockChange(gx, gy, gz, id);
}
```

**防回环**：`NetworkManager.applyRemoteBlock(x,y,z,id)` 内部：
```js
this._applyingRemote = true;
game.world.setBlock(x, y, z, id);
this._applyingRemote = false;
```
`onLocalBlockChange` 中判断 `if (this._applyingRemote) return;` —— 远端落地方案**只重建网格/红石，不再上报**，杜绝"广播回来又发回去"的无限回环。

同时：远端 `block_change` 落地时**跳过写入 `modifiedBlocks`**（联机模式下 `modifiedBlocks` 只存本地发起项，见 §8），或统一以服务器账本为准。

### 6.3 `src/player/Game.js` 改造点

| 位置 | 改动 |
|---|---|
| `constructor` | 创建 `this.remotePlayers = new Map()`；`this.net = null` |
| `start()` | 若 `net.connect` 已建立：**跳过本地怪物生成**（`mobManager.update` 中 spawn 分支关闭）、加载远端玩家全量、注册 `net.on('block_change', ...)` 等回调 |
| `update()` | 网络模式下每 50ms 上报 `player_state`；每帧更新 `remotePlayers`（插值） |
| `handleMouseInput()` | `setBlock` 分支（挖掘/放置/爆炸）在本地应用后调用 `net.sendBlock(...)` |
| `Player.hurt` / 互殴 | 联机模式下：攻击命中远端玩家 → `net.send('attack_player', {targetId, damage})`；被攻击 → 显示受击红闪/扣血 |
| 死亡/重生 | `deathScreen` 显示时发 `player_died`；`respawn()` 后发 `respawn` |
| 自动保存 | 联机模式下关闭（或降频），保存逻辑交给开房者（§8） |
| `returnToMenu()` | `net.close()`；清空 `remotePlayers` |

### 6.4 `src/entity/RemotePlayer.js`（新增）

远端玩家渲染实体，复用 `MobTextures.js` 的 box-parts 思路：

```
class RemotePlayer {
  constructor(scene, id, name)
  // 模型：复用 HUMANOID_PARTS 的部件拼接逻辑（可抽公共函数），
  //       或用简化方块人（头/身/四肢），皮肤用玩家名下发的颜色。
  // 状态缓冲：ring buffer 存最近 ~5 帧 {x,y,z,yaw,pitch,onGround,...}
  // update(dt)：对目标位置做指数插值（smooth = 1 - exp(-dt*10)），yaw 走最短角插值
  applyState(st) / applyFull(st)
  showNameTag()            // THREE.Sprite 显示昵称（可选）
  setMode(mode)            // 飞行/游泳/蹲伏姿态切换
  dispose()                // 释放 mesh/material（进 _disposeWorld 流程）
}
```

- 模型复用 `HUMANOID_PARTS`（`MobTextures.js:195`），皮肤可用单色材质 + 玩家颜色区分。
- 位置用插值而非直接 set：避免远端玩家"瞬移/抖动"。

### 6.5 `src/ui/MenuScreen.js` + `src/main.js`

- MenuScreen 增加"局域网联机"区块：
  - 创建房间：昵称 + 模式 + seed（留空随机）→ `net.connect('ws://<默认>', name)` + `create_room`。
  - 加入房间：昵称 + 服务器地址 → `net.connect(url, name)` + `join_room`。
- `main.js`：创建 `NetworkManager`，注入 `MenuScreen` 回调链，进游戏后由 `Game.start` 接管。

### 6.6 触发"本地修改 → 上报"的完整路径核对

挖掘：`Game.handleMouseInput` → `world.setBlock(..., 0)` → `onLocalBlockChange` → `net.sendBlock` ✓
放置：同上 → `world.setBlock(..., blockDef.id)` → 上报 ✓
TNT/爆炸：`MobManager.processExplosions` → `world.setBlock(..., 0)` → 上报 ✓（本端已生成爆炸的端会上报，未生成爆炸的端只收广播落地）
活塞：`RedstoneSystem` 推方块 → `world.setBlock` → 上报 ✓
红石拉杆/按钮：改方块 → 上报 ✓（状态漂移见 §9.3）

---

## 7. 同步策略细节

### 7.1 方块（核心，必然一致性）

- **仲裁**：服务器 `modifiedBlocks` 主副本 `Map<"x,y,z", id>`；收到 `block_set` 直接覆盖并广播 `block_change`（**last-write-wins**）。
- **收敛**：发送方本地已预测应用；若被后到消息覆盖，会收到新的 `block_change` 再覆盖回来。局域网 RTT < 5ms，冲突窗口极小。
- **记录**：`World.setBlock` 的 `recordMod` 在联机模式下对远端落地跳过，保证本地 `modifiedBlocks` 不混入远端改动导致存档膨胀/漂移。

### 7.2 玩家

- 高频 `player_state`（20Hz）：位置/朝向/姿态布尔。远端插值。
- 低频 `player_full`：健康/食物/模式/手持物品槽位（变更触发）。
- 互殴：`attack_player` 广播扣血 + 受击反馈；死亡/重生走独立消息。
- 手持物品：`player_full.selected` 变化广播，远端玩家模型切换手持物（MVP 可仅同步数字，渲染可选）。

### 7.3 昼夜时间

- 服务器持有 `time` 权威值；host 每 ~5 秒 + 每次 `set_time` 广播 `time`。
- 客户端收到后 `sky.time = msg.t`（只覆盖不追帧，避免频繁抖动）。

### 7.4 聊天

- `chat` 广播，HUD 底部滚动区显示 `[name] text`。`player_join/leave` 也生成系统提示。

---

## 8. 存档与联机策略

- **原则**：房间开房者负责世界持久化；其他客户端不保存多人世界。
- **实现**：
  - 服务器保留 `modifiedBlocks` 主副本于内存；可选落盘 `server/world/<room>.json`（阶段 3）。
  - 开房者客户端仍可用现有 `SaveSystem` 保存（其本地 `modifiedBlocks` 即自己+远端增量，见 6.2 处理），**不建议**其他客户端自动保存。
  - `Game.update` 中 `autoSave` 在联机模式关闭；F5 手动保存仅开房者有效（或全部禁用，避免互相覆盖槽位）。
- 进入房间时客户端**不回读**本地存档的地形增量——以服务器 `block_change` 历史为准：服务器在 `join_room` 时把主副本全部 `block_change` 回放给新玩家（**加入世界即见现状**）。

---

## 9. 怪物与红石：本期取舍与后续方案

### 9.1 本期（阶段 0）：不生成怪物

- 联机模式下 `MobManager.trySpawn` 直接 return（保留本地单机功能不变）。
- 好处：避开"各端 AI 漂移 → 打空气/双份怪"这一最大一致性难题，让 MVP 聚焦方块与玩家。

### 9.2 后续怪物同步三方案（阶段 2 决策）

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| ① 事件同步 | 各端独立跑 AI，只同步生成/受击/死亡/掉落 | 改动小 | 位置漂移，观感差 |
| ② 主机权威怪物流 | 把 `Mob.js` AI 抽成不依赖 DOM 的共享模块（`Mob` 只依赖 `world/physics`，抽离可行性高），服务器跑怪物流，客户端只渲染 | 一致性好 | 需做服务器端 AI 循环 + 快照同步，工作量 +300 行左右 |
| ③ 关怪 | 局域网玩纯建造 | 零成本 | 无打怪玩法 |

### 9.3 红石状态（阶段 2+）

- 各端独立跑 `RedstoneSystem`：给定相同世界状态，红石网络会收敛到相同结果，**无需逐 tick 同步**。
- 风险：两台机器 tick 进度不同步 → 高频红石（快速闪烁灯）会闪断/漂移。
- 缓解：低频广播红石关键方块（lever/button/torch）状态，或接受轻微漂移（局域网信任场景可接受）。

---

## 10. 服务端设计（`server/`）

```
server/
  index.mjs        # 入口：node:http 监听 + ws upgrade，房间生命周期
  room.js          # Room 类：seed、players Map、modifiedBlocks 主副本、time
  protocol.js      # 消息类型常量 + 轻量字段校验（防脏包）
  package.json     # 依赖：ws（^8）
```

要点：
- `Room`：
  - `players: Map<id, {ws, name, pos, mode, health, food, ...}>`
  - `blocks: Map<"x,y,z", id>`（主副本）
  - `seed`（开房者 `create_room` 提供，不可再改）
  - `time`（权威）
  - `broadcast(type, data, exceptId?)`
- 事件流：
  - `create_room` → 设 seed，回 `room_created` + `world_info`，广播 `player_join`。
  - `join_room` → 回 `world_info`，回放 `blocks` 全量 `block_change`，广播 `player_join`。
  - `block_set` → 校验坐标/ID 合法 → 更新 `blocks` → `broadcast('block_change')`。
  - `player_state/player_full/chat/...` → 转发（`player_*` 除外自己）。
  - `attack_player` → 校验目标在线 → 扣服务器记录的 health → 广播 `attack_player`（若死亡发 `player_died`）。
  - `set_time`（仅 host）→ 更新 `time` → 广播。
- 心跳：每 15s ping，30s 无 pong 踢出并广播 `player_leave`。
- 单房间实现（MVP），房间内任意加入；多房间为阶段 3 扩展。

---

## 11. 分阶段实施与验收

### 阶段 0（MVP）—— 本期目标

| 里程碑 | 验收标准 |
|---|---|
| M0 服务器骨架 | `node server/index.mjs` 启动，日志显示监听 3001 |
| M1 连接/房间 | 两台电脑（或两个浏览器标签）都能 join 同一房间，收到 `world_info` 并进入同一世界 |
| M2 方块同步 | A 建一块石头，B 端同步出现；B 破坏，A 端同步消失；TNT 爆炸双方一致 |
| M3 玩家可见 | A 看到 B 的人形模型，移动平滑无瞬移，昵称可见 |
| M4 状态/交互 | 生命/食物/模式同步；A 打 B 扣血；死亡/重生广播；昼夜一致；聊天可用 |

### 阶段 1（已完成）

- [x] 掉落物与拾取同步（`drop_spawn` / `drop_taken` 广播）。
  - 服务器维护掉落物账本（`Room.drops`，id 唯一、5 分钟过期自动清理）；新玩家加入回放现存掉落物。
  - 客户端 `MobManager` 扩展：网络掉落物实体（速度由 id 确定性派生，各端运动一致；去重防重连回放重复）、拾取按剩余数量扣减、拾取后 `drop_taken` 上报。
  - 联机模式挖矿改为生成物理掉落物（不再直接进背包），谁都能拾取；单机保持原「直接进背包」行为不变。
- [x] 断线重连 + 玩家离开清理。
  - 断线指数退避自动重连（1s/2s/4s/.../15s 封顶，最多 8 次）；重连成功后**原位续玩**（世界不重启，只同步时间/模式并刷新远端玩家 + 账本回放纠正），避免重进丢失背包/位置。
  - 主动返回菜单（`net.close()`）不触发重连；重连彻底失败才提示并回菜单。
  - `player_leave` 广播携带昵称，远端玩家实体移除 + 聊天系统提示「XXX 离开了游戏」。
- [x] 首次加入账本回放缓冲：`world_info` 后紧接的方块/掉落物回放先缓存，世界就绪后统一落地（修复首次加入丢包）。

### 阶段 2

- 怪物同步方案选型实施（§9.2）。
- 红石状态缓解（§9.3）。

### 阶段 3

- 服务器世界落盘/换房、多房间、玩家名颜色、观战、插值优化、服务器配置面板。

---

## 12. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 怪物各端漂移 | 高（若不处理） | 本期关闭生成；阶段 2 按 §9.2 选型 |
| 客户端逻辑无法直接搬服务端 | 高 | 架构采用"各端自跑 + 服务器只仲裁增量"，不搬运核心逻辑 |
| `setBlock` 回环广播 | 中 | 6.2 的 `_applyingRemote` 防回环标志，必须实现并测试 |
| 方块冲突 | 低 | last-write-wins，局域网信任场景接受 |
| 红石 tick 漂移 | 中 | 阶段 2 缓解，MVP 接受 |
| 防火墙/端口 | 低 | 文档说明 + `start.cmd server` 辅助脚本 |
| 存档互相覆盖 | 中 | 联机关自动保存，仅开房者持久化（§8） |
| 远端脏包导致崩溃 | 中 | 服务端/客户端双重字段校验，未知类型忽略 |

---

## 13. 实现工作量估算

| 项 | 新增/修改 | 规模 |
|---|---|---|
| `server/`（index/room/protocol/package.json） | 新增 | ~250–350 行 |
| `src/net/NetworkManager.js` | 新增 | ~250–300 行 |
| `src/entity/RemotePlayer.js` | 新增 | ~150–200 行 |
| `src/core/World.js` | 修改 | +10 行（钩子 + 防回环） |
| `src/player/Game.js` | 修改 | +80–120 行（钩子/上报/远端更新/存档策略） |
| `src/ui/MenuScreen.js` + `main.js` | 修改 | +60–100 行（联机入口） |
| `start.cmd` | 修改 | +20 行（server 子命令） |
| 依赖 | 新增 | `ws`（仅 server） |

合计：新增 ~700–850 行，修改 ~200–300 行。规模可控，建议按 §11 里程碑推进。
