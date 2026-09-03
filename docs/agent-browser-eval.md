# agent-browser 引入实测评估报告（CubeWorld，原 Web-MC）

> 目的：用实测（而非推测）评估把 agent-browser 引入本项目测试体系带来的变化。
> 方法：同一台机器、同一个 Vite 开发服务器（http://127.0.0.1:5173），同一套"菜单建档 → 进世界 → 世界内交互"流程，分别用现有工具（playwright-cli）和 agent-browser 各跑一遍，对比能力与摩擦点。
> 环境：Windows / PowerShell 5.1 / agent-browser 0.35.2 / playwright-cli / 单机模式。
> 日期：2026-08-31。

---

## 1. 结论速览

- **引入前的最大瓶颈（指针锁不可捕获 → 3D 世界完全不可交互）被 agent-browser 打破**：实测 agent-browser 能捕获指针锁，并用真实键盘/鼠标输入完成移动、转向、挖方块、放方块——整个 3D 交互面全部打通。这是 playwright-cli 做不到的。
- **DOM UI 层从"写选择器/查源码"升级为"语义化快照 + @eN 直接点"**：菜单/存档流程无需任何选择器。
- **HUD DOM 是 3D 世界的桥**：坐标/生物群系/时间/准星方块实时可读，无需 eval。
- **代价**：确定性丧失（agent 驱动不可重复，不能当回归基线）；PowerShell 下有几处新的使用注意（会话变量、@ref 引号、eval 表达式语法）。

**结论：agent-browser 值得引入作为"能真实操作 3D 游戏的 UI/冒烟/探索测试员"，与现有确定性回归（node server/test-*.mjs）和状态断言（eval）互补，而不是替代。**

---

## 2. 实测矩阵

### 2.1 引入前（playwright-cli）基线

| 能力 | 结果 | 证据 |
|---|---|---|
| 打开页面 / 读标题 | ✅ | goto 5173 → title "CubeWorld"（实测时为旧名 Project-MC） |
| DOM 快照读菜单 | ✅ | snapshot 输出 6 槽位 + 模式按钮 + 联机面板 |
| 点击菜单建档 | ⚠️ 可用但有摩擦 | ref `e8` 点击成功；但 CSS 选择器 `data-slot="1"` 被 PowerShell 吃掉引号 → 非法选择器报错（复现 AGENTS.md 记载的坑） |
| 定位主 canvas | ❌ 摩擦 | `canvas` 命中 10 个元素（主渲染 + 9 个 UI 图标小 canvas）→ strict mode 违规，需 `canvas[data-engine]` 精确定位 |
| **指针锁** | ❌ **不可捕获** | 点击主 canvas 后 `pointerLock=false` → 无法旋转视角/交互 3D 世界 |
| 读游戏状态 | ✅ | eval 可读 `game.running/player.position/pointerLock` 等 |
| 读 HUD | ✅ | snapshot 可见 InfoBar：坐标/生物群系/时间 |

**基线结论**：DOM UI 能驱动但依赖选择器/ref 且摩擦多；**3D 世界只能"读"（eval）不能"玩"（指针锁不可用）**。ESC 暂停/死亡屏等 pointer-lock 流程只能 eval 直接调 `pauseMenu.show()` 绕过（AGENTS.md 记载的做法）。

### 2.2 引入后（agent-browser）实测

| 能力 | 结果 | 证据 |
|---|---|---|
| 语义化快照 | ✅ | `snapshot -i` 直接列出 `button "创造模式" [ref=e7]`、`checkbox "启用命令" [ref=e17]` 等，无需选择器 |
| 菜单建档 | ✅ 零摩擦 | `click '@e7'`（创造）+ `click '@e1'`（槽位1）→ 游戏启动 |
| **指针锁** | ✅ **成功捕获** | `click canvas[data-engine]` 后 `pointerLock=true, element=CANVAS` |
| **键盘移动** | ✅ 真实生效 | 指针锁下 `press w` → 坐标 z 0.50→0.38（真前移） |
| **鼠标转向** | ✅ 真实生效 | `mouse move 200 0` → yaw 0.00→0.94、pitch 0.00→0.62，准星方块联动变化 |
| **挖方块（左键）** | ✅ 真实生效 | 指针锁下 `mouse down left` 按住 → 脚下 y59~y64 整片变空气，玩家坠落 y64→55 |
| **放方块（右键）** | ✅ 真实生效 | 对准洞壁 `mouse down right` → 命中块邻格 air(0)→stone(1) |
| 读实时 3D 状态（免 eval） | ✅ | HUD DOM 快照直接显示 `XYZ: 0.50 / 64.00 / 0.50`、`生物群系: 平原`、`时间: 12:01`、`准星方块: 泥土` |
| eval 全状态读取 | ✅ | `agent-browser eval "(...)"` 可读任意 game 状态（与 playwright-cli 等价） |

**关键实验细节（防复现踩坑）**：
- 用 eval 改 `player.pitch/yaw` **不会可靠同步相机**，射线会指偏导致"挖不中目标"（实测挖错多处）。正确做法：用**真实 `mouse move`** 调整视角（与真实玩家一致），命中块以 `game.selectedBlock` 为准。
- 在自己脚下/身上放方块会被**玩家重叠检查**拒绝（游戏设计行为，不是失败）；对墙放置即成功。
- 事件送达链已验证：CDP `mousedown`/`mouseup` 能到达游戏 handler 并同步置位 `controls.mouseLeft/mouseRight`（用同步顺序监听器实测 `btn=0 mr=true`）。

### 2.3 逐项对比

| 维度 | playwright-cli（前） | agent-browser（后） |
|---|---|---|
| DOM UI 导航 | 选择器/ref，PowerShell 引号易碎 | `@eN` 语义引用，零选择器 |
| 主 canvas 定位 | 10 个 canvas 需精确选择器 | 同样需 `canvas[data-engine]`（少） |
| 指针锁 | ❌ 不可捕获 | ✅ 可捕获 |
| 移动/转向 | ❌ | ✅ 真实输入 |
| 挖/放方块 | ❌ | ✅ 真实输入 |
| 读 HUD | ✅ snapshot | ✅ snapshot（含准星方块） |
| 读深状态 | ✅ eval | ✅ eval |
| 3D 可见性（accessibility） | 不可见 | 不可见（但 HUD 桥接 + 真实交互弥补） |
| 确定性/可重复 | 中（脚本化，但输入受限） | 低（agent 驱动） |
| 回归基线能力 | ❌（无断言体系） | ❌（同样无，且更随机） |

---

## 3. 对测试工作的实际影响

### 3.1 新增能力（此前完全没有）
1. **能真实操作 3D 游戏**：指针锁 + 移动/转向/挖/放全通。可自动化"走到某地、挖掉某方块、放置某方块"的**世界内行为验证**——这是本作最独特的测试价值。
2. **免选择器的 DOM UI 流程自动化**：建档→进世界→开背包→合成→暂停→存档→删档 这类流程可直接让 agent 跑。
3. **探索性/冒烟（dogfood 技能）**：交付前让 agent 自主乱点找 bug，产出截图/汇报。
4. **HUD 桥接实时断言**：坐标/生物群系/时间/准星方块可直接断言，不用写 eval。

### 3.2 仍需保留的（未被替代）
1. **确定性回归**：`node server/test-mp.mjs` 等协议/联机测试（34+15+26+16+20）保持不动。
2. **3D 非 HUD 状态**：方块 ID、怪物数量、掉落物、红石状态等仍需 eval 读取（accessibility tree 看不到）。
3. **截图人工确认**：画面渲染正确性（贴图/光照/法线）仍需视觉确认——本会话模型无图像输入，截图无法自动判定。

### 3.3 新增成本与注意（实测）
1. **PowerShell 会话变量**：`$env:AGENT_BROWSER_SESSION` 在每次 pwsh 调用间不保留，每条命令需内联设置（或用 `--session`），否则会开错会话。
2. **@ref 引号**：`click @e7` 的 `@` 参数会被 PowerShell 吃掉，必须 `click '@e7'`。
3. **eval 语法**：agent-browser `eval` 需要**表达式**（`"(...)"`），传函数 `() => {...}` 会返回函数本身（`{}`）而非结果。
4. **瞄准校准**：世界内精确瞄准优先用真实 `mouse move`，不要用 eval 改 pitch/yaw。
5. **不可重复**：agent 每次决策不同，测试结果需人工复核，不能进 CI 回归门槛。

---

## 4. 建议落地姿势

1. **分层**：
   - 协议/联机回归 → `node server/test-*.mjs`（不变）
   - DOM UI 流程冒烟 → agent-browser 快照+点击
   - 世界内行为验证（挖/放/移动）→ agent-browser 真实输入 + eval 断言
   - 深度状态（方块/怪物/红石/掉落）→ eval
2. **固定会话**：脚本化时统一 `$env:AGENT_BROWSER_SESSION="project-mc-test"`，避免与主 GUI 浏览器互抢。
3. **试点范围**：先跑"菜单建档→进世界→移动到指定坐标→挖/放一个方块→读 HUD 断言"的冒烟脚本，验证后再推广。
4. **注意指针锁相关流程**（ESC 暂停/死亡屏）仍建议 eval 直调 UI 方法兜底，两者双保险。

---

## 5. 联机场景实测（补充，2026-08-31）

> 目标：验证 agent-browser 能否替代现有 playwright-cli 三会话（host/join/three）浏览器冒烟。
> 方法：起真实 LAN 服务器（node server/index.mjs，端口 3001）+ Vite(5173)，用 **两个并发命名会话**（`project-mc-host` / `project-mc-join`）各开一个独立 Chrome，真实输入驱动完整联机链路。

### 5.1 实测结果

| 联机能力 | 结果 | 证据（均为真实输入） |
|---|---|---|
| 多会话并发浏览器 | ✅ | `session list` 同时显示 host/join 两个独立会话各自开 Chrome |
| host 建房间 | ✅ | `fill '@e10' HostAgent` + `fill '@e12' ab-eval-1` + `click '@e13'` → `networkMode=true, room=ab-eval-1` |
| join 加入房间 | ✅ | `fill '@e10' JoinAgent` + `fill '@e12' ab-eval-1` + `click '@e14'` → 进同一房间 |
| 跨玩家可见性 | ✅ | host 见 `JoinAgent`，join 见 `HostAgent`（`game.remotePlayers`，位置/可见性正确） |
| 方块破坏同步 | ✅ | host 真实左键挖 `(-1,64,0)` id=2 → host 与 join 的 `world.getBlock` 均变 0 |
| 聊天同步（双向） | ✅ | host `press t` + `keyboard type` + `press Enter` → join 收到 `<HostAgent> hello-from-host`；join 反向发 → host 收到 `<JoinAgent> reply-from-join` |
| 移动同步 | ✅ | host 真实 W 移动至 (0.50,64,0.40) → join 端 `RemotePlayer.group.position` 完全一致 (0.50,64,0.40)，yaw 同步 |
| 加入通知 | ✅ | host 收到系统消息 `JoinAgent 加入了游戏` |

### 5.2 与现有 playwright-cli 三会话冒烟的对比

- playwright-cli 三会话冒烟只能做"进世界 + 各自移动可见"这类**状态级**验证，无法在指针锁下真实挖/放/聊天。
- agent-browser 两会话即覆盖并超出：建/加入房间、互见、挖方块同步、双向聊天、移动同步——**完整联机链路全部真实输入驱动**。
- 三会话（如加一个旁观者）只是再开一个 `$env:AGENT_BROWSER_SESSION="project-mc-three"` 的同类扩展，无新机制。

### 5.3 联机场景新注意事项（实测）

1. **会话隔离是硬要求**：host/join 必须用不同命名会话，否则共享浏览器互相抢页面。
2. **每个会话的命令都要内联各自 `$env:AGENT_BROWSER_SESSION`**（pwsh 每次新进程），脚本里要写成"切会话变量→跑命令"的模式。
3. **服务端状态要清理**：测试房间会在 `server/world/<房间名>.json` 落盘（本测试产生 ab-eval-1.json，已删）。用一次性房间名（如 `ab-eval-<ts>`）或跑完删除，避免污染。
4. **先起服务再开会话**：Vite 中途掉线会导致 agent-browser 报 `ERR_CONNECTION_REFUSED`（实测遇到一次，`.\start.cmd start` 恢复）。
5. **聊天输入**：`press t` 后输入框自动聚焦，用 `keyboard type`（作用于当前焦点）即可，无需选择器。

### 5.4 结论（联机）

agent-browser 的**多会话 + 真实输入**使其能完整驱动 LAN 联机冒烟（建房/加入/互见/挖方块/聊天/移动），覆盖并超出当前 playwright-cli 三会话冒烟的能力边界。联机回归仍以 `node server/test-*.mjs` 确定性测试为主，agent-browser 用于**浏览器层联机冒烟**与**端到端联机行为验证**。

---

## 6. 遗留问题

- 本会话无法查看截图（模型无图像输入 + describe-image 服务未配置），画面级渲染正确性未验证；程序化状态断言已覆盖功能层。
- 三会话（host/join/spectator）未逐一实测，但机制与两会话相同，仅数量扩展。
- 死亡掉落物、观战等联机进阶流程未在浏览器层实测（协议层已有 test-stage6.mjs 覆盖）。
