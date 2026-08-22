# Project-MC

网页版 3D Minecraft（Web 版我的世界），基于 **Vite 5 + Three.js 0.160** 的纯前端体素游戏，支持**单机存档**与**局域网联机**。

- 程序化生成无限世界（确定性种子，联机时各端生成一致地形）
- 创造 / 生存 / 旁观三种模式
- 方块挖掘、放置、合成、背包、快捷栏
- 日夜循环、怪物系统（单机）、红石电路（拉杆/活塞/TNT/红石灯等）
- 多槽位本地存档（localStorage）
- **局域网联机**：Node 房间服务器 + 各端同种子生成世界，方块/玩家/聊天实时同步

---

## 快速开始

### 环境要求

- Node.js 18+（开发用 24 验证）
- npm

### 安装依赖

```bash
npm install            # 前端依赖（three / vite）
npm install --prefix server ws   # 联机服务器依赖
```

### 启动开发服务器

```bash
.\start.cmd start      # 启动 Vite dev server → http://127.0.0.1:5173
.\start.cmd stop       # 停止
.\start.cmd restart    # 重启
.\start.cmd status     # 查看状态
```

浏览器打开 `http://127.0.0.1:5173` 即可开始单机游戏。

### 生产构建

```bash
npm run build          # 产物输出到 dist/
npm run preview        # 预览构建产物
```

---

## 局域网联机

> 阶段 1：方块共建/破坏、玩家可见与移动、互殴、死亡重生、昼夜同步、聊天、**掉落物与拾取同步**、**断线自动重连**。联机模式**不生成怪物**、**不写本地存档**。
>
> 联机小提示：生存模式下挖矿会掉落**物理掉落物**（谁都能拾取，掉落物 5 分钟消失）；断线后会自动重连回原房间，位置与背包不丢。

### 1. 启动房间服务器

```bash
.\start.cmd server     # 启动联机服务器 → ws://0.0.0.0:3001/ws
.\start.cmd server-stop  # 停止
```

> Windows 首次监听可能弹出防火墙授权，需放行 TCP 3001。

### 2. 开房 / 加入

1. 开房者打开 `http://<开房机IP>:5173`，主菜单 →「局域网联机」→ 填昵称 → **创建房间**（决定世界种子）。
2. 其它玩家在局域网内访问 `http://<开房机IP>:5173`，填昵称与服务器地址 `ws://<开房机IP>:3001/ws` → **加入房间**。
3. 进入同一世界后即可共建方块、互相可见、按 **T** 聊天。

> 联机世界由开房者种子决定；新加入者会自动收到已存在的方块改动（账本回放），所见即世界现状。

### 3. 服务器协议回归测试

```bash
node server/index.mjs      # 先启动服务器
node server/test-mp.mjs    # 跑 19 项协议断言（含方块/玩家/掉落物/离开广播）
```

---

## 操作说明

| 键位 | 功能 |
|---|---|
| WASD | 移动 |
| 空格 | 跳跃（创造模式下双击切换飞行） |
| Shift | 下蹲 / 潜行 |
| 鼠标左键 / 右键 | 破坏 / 放置方块 |
| 滚轮 / 1-9 | 切换快捷栏物品 |
| E | 打开背包（合成） |
| C | 命令面板（仅"启用命令"的存档） |
| T | 联机聊天 |
| F5 | 手动保存（联机模式不保存） |
| ESC | 暂停菜单 |

---

## 项目结构

```
project-mc/
├── src/
│   ├── main.js          # 入口：Game + MenuScreen + NetworkManager
│   ├── player/          # Game(中枢/主循环)、Player、Controls、Physics、Inventory、Raycast
│   ├── world/           # 地形生成（SimplexNoise）、生物群系
│   ├── blocks/ items/   # 方块/物品定义 + SVG 纹理
│   ├── core/            # World、Chunk、RedstoneSystem、Crafting、SaveSystem、Registry
│   ├── render/          # Renderer、ChunkMesh(贪心合并)、Sky、SVGTextures
│   ├── entity/          # Mob、MobManager、RemotePlayer(远端玩家)
│   ├── ui/              # MenuScreen、HUD、Hotbar、InventoryScreen、ChatBox 等
│   └── net/             # NetworkManager（联机客户端网络层）
├── server/              # 局域网房间服务器（Node + ws）
│   ├── index.mjs        # 入口（http + WebSocket /ws）
│   ├── room.js          # 房间：玩家集合、方块账本、消息路由
│   ├── protocol.js      # 消息类型常量（浏览器与服务器共用）
│   ├── test-mp.mjs      # 协议端到端回归测试
│   └── client-sim.mjs   # 双端验证模拟客户端
├── docs/
│   └── lan-multiplayer-design.md  # 局域网联机设计文档（含分阶段路线）
├── start.cmd            # 开发/联机服务器启停脚本
└── .gitignore
```

---

## 架构要点

- **确定性世界生成**：地形由 `TerrainGenerator(seed)` 用 SimplexNoise + LCG 伪随机生成，全流程无 `Math.random`。这是联机"各端自行生成相同地形、只同步修改增量"的基础。
- **单一方块写入入口**：`World.setBlock` 是唯一方块修改入口，联机时统一经它上报（挖掘/放置/TNT 爆炸/活塞全覆盖），并带 `_applyingRemote` 防回环标志。
- **存档**：localStorage 多槽位（`project-mc-save-N`），存 `seed + modifiedBlocks 增量 + 玩家状态 + 红石 + 时间`。
- **联机模型**：轻量主机 + 各端自跑。Node 服务器只做房间管理、方块账本（last-write-wins 仲裁）、玩家中继、昼夜权威；客户端各自生成世界、自跑物理，只同步外部可见状态。

---

## 开发命令

```bash
node --check <file>   # 语法检查（唯一可自动化验证手段）
npm run build         # 生产构建
```

无测试框架 / lint / typecheck；修改后请 `node --check` 每个改动文件并浏览器手测。

---

## 已知限制（联机阶段 1）

- 联机模式不生成怪物（避免各端 AI 漂移），怪物同步方案见设计文档 §9。
- 红石各端独立收敛，高频红石可能有轻微 tick 漂移。
- 联机不持久化世界（服务器内存账本，重启即清空）；世界落盘属后续阶段。
- 方块冲突采用 last-write-wins（局域网信任场景可接受）。
- 背包/物品栏**不做全量同步**（各端自管自身背包），仅同步手持槽位与生命/饥饿；拾取掉落物由拾取端本地入包。
- 掉落后若背包恰好满格，拾取会只取部分（联机下余量按"整个掉落物消失"处理，极少数情况）。
- 断线自动重连依赖服务器仍在运行；服务器重启会清空世界账本（已放置方块不保留）。
- 单房间实现，多房间为后续阶段。
