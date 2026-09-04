// room.js -- 房间管理：玩家集合 + 维度化方块账本 + 消息路由（多房间，世界按房间名隔离）
// 职责：方块仲裁(last-write-wins)、玩家状态中继、host 权限（改模式/设时间）、世界落盘回调
// 阶段 3：每个房间独立持有世界（seed/blocks/drops/时间），变更即落盘，服务器重启后可恢复
// M4：方块/容器账本按维度分桶（同坐标跨维互不干扰）；掉落物/怪物/状态广播按维度过滤
import { MSG } from './protocol.js';
import { DIMENSIONS, DEFAULT_DIMENSION } from '../src/core/dimensions.js';

// 安全整数/浮点转换，防脏包
function safeInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isInteger(n) && Math.abs(n) <= 30000000 ? n : fallback;
}
function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export class Room {
  // name: 房间名（同名房间共享同一世界）；onSave: (room) => void 世界变更落盘回调（index.mjs 注入）
  // config: 服务器配置引用（读取 dropTtlMs 等），管理面板可实时改
  constructor(name = 'default', onSave = null, config = null) {
    this.name = String(name).trim() || 'default';
    this.onSave = onSave;
    this.config = config;
    this.players = new Map();   // id -> player
    // M4 维度分桶账本：dim -> Map("x,y,z" -> id)；同坐标跨维度互不干扰
    this.dimensionBlocks = new Map();
    this.dimensionContainers = new Map(); // dim -> Map("x,y,z" -> 27 槽数组)
    this.drops = new Map();     // dropId -> {x,y,z,name,count,dim,spawnedAt,owner?,ownerUntil?}
    this.nextDropId = 1;
    this.nextMobId = 1;         // 怪物 id 分配（事件同步，服务器仅分配/中继不跑 AI）
    this.seed = null;
    this.time = 0.35;
    this.hostId = null;
    this.nextId = 1;
  }

  // 取（或建）指定维度的账本桶
  dimBucket(store, dim) {
    let m = store.get(dim);
    if (!m) { m = new Map(); store.set(dim, m); }
    return m;
  }

  // 维度名合法性（只认注册表中 implemented 的维度；非法回退主世界）
  static safeDim(dim) {
    const d = DIMENSIONS[dim];
    return d && d.implemented ? dim : DEFAULT_DIMENSION;
  }

  // 全维度方块总数（info//seed 展示用）
  blocksTotal() {
    let n = 0;
    for (const m of this.dimensionBlocks.values()) n += m.size;
    return n;
  }

  // 掉落物过期毫秒（默认 5 分钟；管理面板配置 dropTtlMs 实时生效）
  dropTtlMs() { return (this.config && this.config.dropTtlMs) || 300000; }

  // 从磁盘快照恢复房间世界状态（服务器重启后复活），过期掉落物丢弃；旧 host 已不在线，由新进玩家接管
  // 快照 V2：dimensionBlocks/dimensionContainers {dim: [entries]}；旧格式（平铺 blocks/containers 数组）迁移进主世界桶
  restore(snap) {
    this.seed = safeInt(snap.seed, this.seed);
    this.time = safeNum(snap.time, this.time);
    this.nextDropId = Math.max(1, safeInt(snap.nextDropId, 1));
    this.nextMobId = Math.max(1, safeInt(snap.nextMobId, 1));
    this.dimensionBlocks = new Map();
    if (snap.dimensionBlocks && typeof snap.dimensionBlocks === 'object' && !Array.isArray(snap.dimensionBlocks)) {
      for (const [dim, entries] of Object.entries(snap.dimensionBlocks)) {
        const m = this.dimBucket(this.dimensionBlocks, Room.safeDim(dim));
        for (const [k, id] of entries) if (typeof k === 'string') m.set(k, safeInt(id, 0));
      }
    } else {
      const m = this.dimBucket(this.dimensionBlocks, DEFAULT_DIMENSION);
      for (const [k, id] of (snap.blocks || [])) if (typeof k === 'string') m.set(k, safeInt(id, 0));
    }
    this.dimensionContainers = new Map();
    if (snap.dimensionContainers && typeof snap.dimensionContainers === 'object' && !Array.isArray(snap.dimensionContainers)) {
      for (const [dim, entries] of Object.entries(snap.dimensionContainers)) {
        const m = this.dimBucket(this.dimensionContainers, Room.safeDim(dim));
        for (const [k, items] of entries) {
          if (typeof k === 'string' && Array.isArray(items) && items.length === 27) {
            m.set(k, items.map((s) => this.sanitizeStack(s)));
          }
        }
      }
    } else {
      const m = this.dimBucket(this.dimensionContainers, DEFAULT_DIMENSION);
      for (const [k, items] of (snap.containers || [])) {
        if (typeof k === 'string' && Array.isArray(items) && items.length === 27) {
          m.set(k, items.map((s) => this.sanitizeStack(s)));
        }
      }
    }
    this.drops = new Map();
    const now = Date.now();
    const ttl = this.dropTtlMs();
    for (const d of (snap.drops || [])) {
      if (!d || typeof d.id !== 'number' || !d.name) continue;
      if (now - safeNum(d.spawnedAt, now) > ttl) continue; // 过期掉落物不恢复
      this.drops.set(d.id, {
        x: safeNum(d.x), y: safeNum(d.y), z: safeNum(d.z),
        name: String(d.name).slice(0, 32),
        count: Math.min(64, Math.max(1, safeInt(d.count, 1))),
        dim: Room.safeDim(d.dim),
        spawnedAt: safeNum(d.spawnedAt, now),
        // 阶段10：归属锁恢复（ownerId 需为正整数；过期锁自动失效）
        owner: Number.isInteger(d.owner) && d.owner > 0 ? d.owner : null,
        ownerUntil: safeNum(d.ownerUntil, 0),
      });
    }
    this.hostId = null;
  }

  // 世界状态变更后落盘（回调由 index.mjs 注入为 store.saveRoom）
  save() { if (this.onSave) this.onSave(this); }

  // T5：容器物品栈校验（name 限长、count 1-64；非法/数量<1 → null 空槽）
  sanitizeStack(s) {
    if (!s || typeof s !== 'object' || !s.name) return null;
    const count = safeInt(s.count, 1);
    if (count < 1) return null;
    return { name: String(s.name).slice(0, 32), count: Math.min(64, count) };
  }

  // 房间是否已满（管理面板配置 maxPlayersPerRoom）
  isFull() {
    const cap = (this.config && this.config.maxPlayersPerRoom) || 10;
    return this.players.size >= cap;
  }

  addPlayer(p) {
    // 管理面板配置的房间人数上限（超出拒绝入房）
    const cap = (this.config && this.config.maxPlayersPerRoom) || 10;
    if (this.players.size >= cap) {
      this.sendTo(p, MSG.KICKED, { reason: `房间「${this.name}」已满（上限 ${cap} 人）` });
      setTimeout(() => { try { p.ws.close(); } catch {} }, 50);
      return false;
    }
    p.mode = 'survival';
    p.health = 20; p.food = 20; p.saturation = 5;
    p.pos = { x: 0.5, y: 66, z: 0.5, yaw: 0, pitch: 0 };
    p.onGround = false; p.flying = false; p.inWater = false;
    p.dim = DEFAULT_DIMENSION; // M4：加入恒在主世界（此后经 switch_dimension 切换）
    p.selected = 0; p.heldItem = null; p.alive = true;
    p.hotbar = null; // 阶段10：完整快捷栏快照（player_full 上报；joinRoom 回放给新加入者）
    p._diedDrops = false; // 阶段6：本次死亡周期的掉落是否已产出（防重复上报刷掉落）
    this.players.set(p.id, p);
    return true;
  }

  playerList() {
    return [...this.players.values()].map(p => ({
      id: p.id, name: p.name, mode: p.mode, pos: p.pos,
      health: p.health, food: p.food, selected: p.selected,
    }));
  }

  // 阶段10：玩家加入回放信息（含选中槽位/手持物/完整快捷栏 + M4 维度，让新加入者立即看到在线玩家）
  joinInfo(p) {
    const info = { id: p.id, name: p.name, mode: p.mode, pos: p.pos, selected: p.selected, held: p.heldItem, dim: p.dim };
    if (Array.isArray(p.hotbar)) info.hotbar = p.hotbar;
    return info;
  }

  sendTo(p, type, data) {
    if (p && p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify({ t: type, ...data }));
  }

  broadcast(type, data, exceptId = null) {
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      this.sendTo(p, type, data);
    }
  }

  // M4：按维度广播（只发给与 dim 相同的在线玩家——异维端不应用别维度的方块/掉落/怪）
  broadcastDim(type, data, dim, exceptId = null) {
    for (const p of this.players.values()) {
      if (p.id === exceptId || p.dim !== dim) continue;
      this.sendTo(p, type, data);
    }
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.broadcast(MSG.PLAYER_LEAVE, { id, name: p.name });
    if (this.hostId === id) {
      this.hostId = this.players.size ? this.players.keys().next().value : null;
    }
    console.log(`[!] ${p.name} 离开房间「${this.name}」，剩余 ${this.players.size} 人`);
  }

  // 管理面板操作（阶段 4）--------

  // 踢出玩家：发送 kicked 消息（客户端停止自动重连），再从房间移除
  kickPlayer(id, reason = '被服务器管理员移出') {
    const p = this.players.get(id);
    if (!p) return false;
    this.sendTo(p, MSG.KICKED, { reason });
    this.removePlayer(id);
    // 让 kicked 消息有时间送达再断开底层连接
    setTimeout(() => { try { p.ws.close(); } catch {} }, 50);
    return true;
  }

  // 清空该房间全部掉落物（广播 drop_taken by=0 让各端移除），返回移除数量
  clearDrops() {
    const n = this.drops.size;
    for (const [id, d] of this.drops) {
      this.broadcastDim(MSG.DROP_TAKEN, { id, by: 0 }, d.dim || DEFAULT_DIMENSION);
    }
    this.drops.clear();
    if (n) this.save();
    return n;
  }

  // 房间状态快照（管理面板展示）
  info() {
    return {
      name: this.name,
      seed: this.seed,
      time: this.time,
      hostId: this.hostId,
      blocks: this.blocksTotal(),
      drops: this.drops.size,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, mode: p.mode, dim: p.dim,
        health: p.health, food: p.food, pos: p.pos, host: p.id === this.hostId,
      })),
    };
  }

  createRoom(player, msg) {
    // 已有世界的房间（重复开房/从磁盘恢复）沿用原 seed，仅首次开房时由 host 决定种子
    if (this.seed === null) this.seed = safeInt(msg.seed, Math.floor(Math.random() * 2147483647));
    player.mode = msg.mode === 'creative' ? 'creative' : (msg.mode === 'spectator' ? 'spectator' : 'survival');
    this.hostId = player.id;
    this.sendTo(player, MSG.ROOM_CREATED, { roomId: this.name });
    // restart=true 表示世界内换房到新房间：客户端需重启本地世界（新 seed）
    this.sendTo(player, MSG.WORLD_INFO, { seed: this.seed, mode: player.mode, time: this.time, hostId: this.hostId, room: this.name, restart: !!msg.restart });
    this.broadcast(MSG.PLAYER_JOIN, this.joinInfo(player), player.id);
    this.save();
    console.log(`[+] ${player.name} 创建房间「${this.name}」seed=${this.seed} (host)`);
  }

  // opts.restart=true 表示世界内换房/重建：客户端收到 WORLD_INFO 后重启本地世界（保持连接）
  joinRoom(player, msg, opts = {}) {
    // 房间世界不存在（尚未创建/无存档）时，首个加入者自动成为 host 并随机生成世界
    if (this.seed === null) {
      this.createRoom(player, { seed: Math.floor(Math.random() * 2147483647), mode: 'survival', restart: !!opts.restart });
      return;
    }
    // 无 host 时（如房间从磁盘恢复且暂无玩家在线）首个加入者接管 host
    if (this.hostId === null || !this.players.has(this.hostId)) this.hostId = player.id;
    this.sendTo(player, MSG.WORLD_INFO, { seed: this.seed, mode: this.modeOfHost(), time: this.time, hostId: this.hostId, room: this.name, restart: !!opts.restart });
    // 回放现存玩家：加入者立即可见房间内已有玩家（阶段10：附带选中槽位/手持物/完整快捷栏）
    for (const p of this.players.values()) {
      if (p.id === player.id) continue;
      this.sendTo(player, MSG.PLAYER_JOIN, this.joinInfo(p));
    }
    // 回放方块账本：新玩家加入即见世界现状（M4：只回放其所在维度的桶）
    for (const [key, id] of this.dimBucket(this.dimensionBlocks, player.dim)) {
      const [x, y, z] = key.split(',').map(Number);
      this.sendTo(player, MSG.BLOCK_CHANGE, { x, y, z, id, by: 0, d: player.dim });
    }
    // 回放容器账本（T5）：玩家动过的箱子；未动过的箱子两端由确定性生成对齐，无需回放
    for (const [key, items] of this.dimBucket(this.dimensionContainers, player.dim)) {
      const [x, y, z] = key.split(',').map(Number);
      this.sendTo(player, MSG.CONTAINER_SET, { x, y, z, items, by: 0 });
    }
    // 回放当前掉落物：新玩家加入即见现存掉落物（M4：只回放同维度的；阶段10：携带归属锁剩余毫秒）
    for (const [id, d] of this.drops) {
      if ((d.dim || DEFAULT_DIMENSION) !== player.dim) continue;
      const remainLock = d.ownerUntil > Date.now() && d.owner ? Math.ceil(d.ownerUntil - Date.now()) : 0;
      const back = { id, x: d.x, y: d.y, z: d.z, name: d.name, count: d.count, d: player.dim };
      if (d.owner && remainLock > 0) { back.owner = d.owner; back.ownerLock = remainLock; }
      this.sendTo(player, MSG.DROP_SPAWN, back);
    }
    this.broadcast(MSG.PLAYER_JOIN, { id: player.id, name: player.name, mode: player.mode, pos: player.pos }, player.id);
    console.log(`[+] ${player.name} 加入房间「${this.name}」seed=${this.seed} (${this.players.size}人)`);
  }

  modeOfHost() {
    const h = this.players.get(this.hostId);
    return h ? h.mode : 'survival';
  }

  // 重建当前房间世界（阶段5，仅 host 可触发）：新种子 + 清空方块/掉落/时间，
  // 广播 WORLD_INFO(restart) 让所有端重启本地世界，并重放 PLAYER_JOIN 让各端重建远端玩家
  resetWorld() {
    this.seed = Math.floor(Math.random() * 2147483647);
    this.dimensionBlocks.clear();
    this.dimensionContainers.clear();
    this.drops.clear();
    this.time = 0.35;
    this.nextMobId = 1;
    this.nextDropId = 1;
    this.broadcast(MSG.WORLD_INFO, { seed: this.seed, mode: this.modeOfHost(), time: this.time, hostId: this.hostId, room: this.name, restart: true });
    for (const p of this.players.values()) {
      this.broadcast(MSG.PLAYER_JOIN, this.joinInfo(p), p.id);
    }
    this.save();
    console.log(`[世界] 房间「${this.name}」已重建 seed=${this.seed} (${this.players.size}人)`);
  }

  // 玩家消息路由
  handle(player, msg) {
    switch (msg.t) {
      case MSG.BLOCK_SET: this.onBlockSet(player, msg); break;
      case MSG.CONTAINER_SET: this.onContainerSet(player, msg); break;
      case MSG.DROP_SPAWN: this.onDropSpawn(player, msg); break;
      case MSG.DROP_TAKEN: this.onDropTaken(player, msg); break;
      case MSG.MOB_SPAWN: this.onMobSpawn(player, msg); break;
      case MSG.MOB_ATTACK: this.onMobAttack(player, msg); break;
      case MSG.MOB_DIED: this.onMobDied(player, msg); break;
      case MSG.REDSTONE_STATE: this.onRedstoneState(player, msg); break;
      case MSG.PLAYER_STATE: this.onPlayerState(player, msg); break;
      case MSG.PLAYER_FULL: this.onPlayerFull(player, msg); break;
      case MSG.ATTACK_PLAYER: this.onAttack(player, msg); break;
      case MSG.PLAYER_DIED: this.onPlayerDied(player, msg); break;
      case MSG.RESPAWN: this.onRespawn(player, msg); break;
      case MSG.GAMEMODE: this.onGamemode(player, msg); break;
      case MSG.SWITCH_DIMENSION: this.onSwitchDimension(player, msg); break;
      case MSG.SET_TIME: this.onSetTime(player, msg); break;
      case MSG.CHAT: this.onChat(player, msg); break;
      case MSG.PING:
        // 阶段10：回显 seq + 客户端时间戳 ts，供客户端直测网络 RTT
        this.sendTo(player, MSG.PONG, { seq: safeInt(msg.seq), ts: safeNum(msg.ts, 0) });
        break;
      default: break;
    }
  }

  onBlockSet(player, msg) {
    const x = safeInt(msg.x), y = safeInt(msg.y), z = safeInt(msg.z), id = safeInt(msg.id);
    if (id < 0 || id > 65535) return;
    const dim = player.dim; // M4：归入发起者当前维度的账本，广播只发同维度玩家
    const blocks = this.dimBucket(this.dimensionBlocks, dim);
    const containers = this.dimBucket(this.dimensionContainers, dim);
    if (id === 0) {
      blocks.delete(`${x},${y},${z}`);
      containers.delete(`${x},${y},${z}`); // T5：箱子被挖 → 容器账本一并清除（内容散落由挖掘方 drop_spawn 上报）
    } else {
      blocks.set(`${x},${y},${z}`, id);
    }
    this.broadcastDim(MSG.BLOCK_CHANGE, { x, y, z, id, by: player.id, d: dim }, dim, player.id);
    this.save();
  }

  // T5：容器整箱同步（last-write-wins，与方块账本同仲裁策略；M4：按维度分桶 + 同维广播）
  onContainerSet(player, msg) {
    const x = safeInt(msg.x), y = safeInt(msg.y), z = safeInt(msg.z);
    if (!Array.isArray(msg.items) || msg.items.length !== 27) return;
    const items = msg.items.map((s) => this.sanitizeStack(s));
    const dim = player.dim;
    this.dimBucket(this.dimensionContainers, dim).set(`${x},${y},${z}`, items);
    this.broadcastDim(MSG.CONTAINER_SET, { x, y, z, items, by: player.id, d: dim }, dim, player.id);
    this.save();
  }

  // 掉落物：客户端请求生成 -> 服务器分配唯一 id 并广播（含发起者，各端据此创建同一实体；M4：同维度广播）
  onDropSpawn(player, msg) {
    const x = safeNum(msg.x), y = safeNum(msg.y), z = safeNum(msg.z);
    const count = Math.min(64, Math.max(1, safeInt(msg.count, 1)));
    const name = String(msg.name || '').slice(0, 32);
    if (!name) return;
    const id = this.nextDropId++;
    const dim = player.dim;
    this.drops.set(id, { x, y, z, name, count, dim, spawnedAt: Date.now() });
    this.broadcastDim(MSG.DROP_SPAWN, { id, x, y, z, name, count, d: dim }, dim);
    this.save();
    console.log(`[掉落] ${player.name} 生成 ${name}x${count} @(${x},${y},${z}) id=${id} [${dim}]`);
  }

  // 掉落物拾取：从账本删除并广播
  // 阶段10：死亡掉落物有归属锁——锁定期内只有 owner 本人可拾取，他人拾取被拒（回 drop_deny，账本保留）
  // M4：跨维度拾取一律拒绝（掉落物只存在于其生成维度）
  onDropTaken(player, msg) {
    const id = safeInt(msg.id);
    const d = this.drops.get(id);
    if (!d) {
      // 账本中已不存在（他人抢先拾取/过期移除/管理清空）→ 通知请求者回滚本地拾取，防物品复制
      this.sendTo(player, MSG.DROP_DENY, { id, owner: 0 });
      return;
    }
    if ((d.dim || DEFAULT_DIMENSION) !== player.dim) {
      this.sendTo(player, MSG.DROP_DENY, { id, owner: 0 });
      return;
    }
    if (d.owner && d.ownerUntil > Date.now() && player.id !== d.owner) {
      this.sendTo(player, MSG.DROP_DENY, { id, owner: d.owner });
      // 补发实体数据（客户端若已抢先本地拾取移除，凭此重建；数据以服务器账本为准）
      this.sendTo(player, MSG.DROP_SPAWN, {
        id, x: d.x, y: d.y, z: d.z, name: d.name, count: d.count,
        owner: d.owner, ownerLock: Math.ceil(d.ownerUntil - Date.now()),
      });
      return;
    }
    this.drops.delete(id);
    this.broadcastDim(MSG.DROP_TAKEN, { id, by: player.id, d: player.dim }, player.dim);
    this.save();
  }

  // 清理过期掉落物（默认 5 分钟，取配置值），广播移除（by=0 表示过期自然消失；M4：按掉落物维度广播）
  expireDrops() {
    const now = Date.now();
    const ttl = this.dropTtlMs();
    let changed = false;
    for (const [id, d] of this.drops) {
      if (now - d.spawnedAt > ttl) {
        this.drops.delete(id);
        this.broadcastDim(MSG.DROP_TAKEN, { id, by: 0 }, d.dim || DEFAULT_DIMENSION);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  // 怪物事件（阶段 2 方案①：服务器只分配 id + 中继，不跑 AI）
  // host 端请求生成 -> 分配唯一 id 广播（含发起者，各端据此创建同一怪物实体；M4：同维度广播）
  onMobSpawn(player, msg) {
    const type = String(msg.type || '').slice(0, 24);
    const x = safeNum(msg.x), y = safeNum(msg.y), z = safeNum(msg.z);
    if (!type) return;
    const id = this.nextMobId++;
    const dim = player.dim;
    // T5：tradeSeed 透传（村民交易表派生种子，服务器不解释；缺省 = 旧客户端不带）
    const back = { id, type, x, y, z, d: dim };
    if (msg.tradeSeed !== undefined) back.tradeSeed = safeInt(msg.tradeSeed, 0);
    this.broadcastDim(MSG.MOB_SPAWN, back, dim);
    console.log(`[怪] ${player.name} 生成 ${type} @(${x},${y},${z}) id=${id} [${dim}]`);
  }

  // 玩家攻击怪物：转发（except 发起者，发起者端已本地处理；M4：同维度）
  onMobAttack(player, msg) {
    const id = safeInt(msg.id);
    const damage = Math.max(0, safeNum(msg.damage, 1));
    const x = safeNum(msg.x), y = safeNum(msg.y), z = safeNum(msg.z);
    this.broadcastDim(MSG.MOB_ATTACK, { id, fromId: player.id, damage, x, y, z }, player.dim, player.id);
  }

  // 怪物死亡：转发（except 发起者，掉落物由击杀端产出；M4：同维度）
  onMobDied(player, msg) {
    const id = safeInt(msg.id);
    this.broadcastDim(MSG.MOB_DIED, { id }, player.dim, player.id);
  }

  // 红石源状态（lever/button）：转发 except 发起者，各端对齐 poweredBlocks（M4：同维度）
  onRedstoneState(player, msg) {
    const x = safeInt(msg.x), y = safeInt(msg.y), z = safeInt(msg.z);
    this.broadcastDim(MSG.REDSTONE_STATE, { x, y, z, on: !!msg.on, by: player.id }, player.dim, player.id);
  }

  onPlayerState(player, msg) {
    const p = player.pos;
    p.x = safeNum(msg.x, p.x); p.y = safeNum(msg.y, p.y); p.z = safeNum(msg.z, p.z);
    p.yaw = safeNum(msg.yaw, p.yaw); p.pitch = safeNum(msg.pitch, p.pitch);
    player.onGround = !!msg.onGround; player.flying = !!msg.flying; player.inWater = !!msg.inWater;
    // 阶段6：手持物品同步——广播当前快捷栏槽位与物品名（远端模型据此渲染手持物）
    if (msg.selected !== undefined) player.selected = safeInt(msg.selected, player.selected);
    if (typeof msg.held === 'string') player.heldItem = msg.held.slice(0, 32);
    this.broadcastDim(MSG.PLAYER_STATE, {
      id: player.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      onGround: player.onGround, flying: player.flying, inWater: player.inWater,
      selected: player.selected, held: player.heldItem,
      ts: Date.now(), // 阶段5：服务器时间戳，客户端做时间对齐的缓冲插值
    }, player.dim, player.id);
  }

  // 阶段10：校验客户端上报的完整快捷栏（≤9 槽，每项 null 或 {name,count}），非法整体丢弃
  sanitizeHotbar(raw) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 9) return null;
    const out = [];
    for (const s of raw) {
      if (!s) { out.push(null); continue; }
      const name = typeof s.name === 'string' ? s.name.slice(0, 32) : '';
      if (!name) return null; // 脏包：一项非法则整条丢弃
      out.push({ name, count: Math.min(64, Math.max(1, safeInt(s.count, 1))) });
    }
    return out;
  }

  onPlayerFull(player, msg) {
    player.health = safeNum(msg.health, player.health);
    player.food = safeNum(msg.food, player.food);
    player.saturation = safeNum(msg.saturation, player.saturation);
    if (msg.mode) player.mode = msg.mode === 'creative' ? 'creative' : (msg.mode === 'spectator' ? 'spectator' : 'survival');
    if (msg.selected !== undefined) player.selected = safeInt(msg.selected, player.selected);
    if (typeof msg.held === 'string') player.heldItem = msg.held.slice(0, 32);
    const hotbar = this.sanitizeHotbar(msg.hotbar);
    if (hotbar) player.hotbar = hotbar; // 阶段10：记录完整快捷栏（joinRoom 回放给新加入者）
    const back = {
      id: player.id, health: player.health, food: player.food,
      saturation: player.saturation, mode: player.mode, selected: player.selected, held: player.heldItem,
    };
    if (player.hotbar) back.hotbar = player.hotbar;
    this.broadcastDim(MSG.PLAYER_FULL, back, player.dim, player.id);
  }

  onAttack(player, msg) {
    const target = this.players.get(safeInt(msg.targetId));
    if (!target || target.id === player.id || !target.alive) return;
    const damage = Math.max(0, safeNum(msg.damage, 1));
    target.health = Math.max(0, target.health - damage);
    this.broadcast(MSG.ATTACK_PLAYER, { fromId: player.id, targetId: target.id, damage });
    if (target.health <= 0) {
      target.health = 0;
      target.alive = false;
      this.broadcast(MSG.PLAYER_DIED, { id: target.id });
    }
  }

  // 玩家死亡（阶段6）：广播死亡 + 把客户端上报的背包物品生成世界掉落物（drop_spawn 广播，各端一致可拾取）
  // 由客户端在本地检测到死亡时上报（携带死亡位置 + 背包掉落列表）；PvP 致死时 alive 已 false，此处只产出掉落
  onPlayerDied(player, msg) {
    if (player.alive) {
      player.alive = false;
      this.broadcast(MSG.PLAYER_DIED, { id: player.id });
    }
    // 同一死亡周期只产出一次掉落（防重复上报刷掉落）
    if (player._diedDrops) return;
    player._diedDrops = true;
    const x = safeNum(msg.x, player.pos.x);
    const y = safeNum(msg.y, player.pos.y);
    const z = safeNum(msg.z, player.pos.z);
    const drops = Array.isArray(msg.drops) ? msg.drops : [];
    let n = 0;
    for (let i = 0; i < drops.length && n < 64; i++) {
      const d = drops[i] || {};
      const name = String(d.name || '').slice(0, 32);
      const count = Math.min(64, Math.max(1, safeInt(d.count, 1)));
      if (!name) continue;
      // 掉落位置做微小确定性偏移，避免整叠重叠成一点
      const ox = ((i % 5) - 2) * 0.3;
      const oz = ((Math.floor(i / 5) % 5) - 2) * 0.3;
      const id = this.nextDropId++;
      // 阶段10：死亡掉落归属锁——3 秒内只有死者本人可拾取（防止别人的死亡掉落被路过玩家瞬间抢走）
      const ownerLockMs = 3000;
      const ownerUntil = Date.now() + ownerLockMs;
      const dim = player.dim; // M4：死亡掉落落在死者当前维度
      this.drops.set(id, { x: x + ox, y, z: z + oz, name, count, dim, spawnedAt: Date.now(), owner: player.id, ownerUntil });
      this.broadcastDim(MSG.DROP_SPAWN, { id, x: x + ox, y, z: z + oz, name, count, owner: player.id, ownerLock: ownerLockMs, d: dim }, dim);
      n++;
    }
    if (n) this.save();
    console.log(`[死亡] ${player.name} 死亡 @(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}) 掉落 ${n} 组`);
  }

  onRespawn(player, msg) {
    player.health = 20; player.food = 20; player.saturation = 5; player.alive = true;
    player._diedDrops = false; // 阶段6：新死亡周期允许再次产出掉落
    player.pos.x = safeNum(msg.x, 0.5); player.pos.y = safeNum(msg.y, 66); player.pos.z = safeNum(msg.z, 0.5);
    this.broadcast(MSG.RESPAWN, {
      id: player.id, x: player.pos.x, y: player.pos.y, z: player.pos.z,
      health: player.health, food: player.food,
    });
  }

  onGamemode(player, msg) {
    if (player.id !== this.hostId) return; // 仅 host 可改模式
    player.mode = msg.mode === 'creative' ? 'creative' : (msg.mode === 'spectator' ? 'spectator' : 'survival');
    this.broadcast(MSG.GAMEMODE, { id: player.id, mode: player.mode });
  }

  // M4：维度切换（联机）。流程：核对维度合法 → 记账 player.dim → 全体广播 player_dimension
  // → 向切换者下发目标维度账本（dimension_world）→ 回放同维度玩家列表（切换者本地世界重建远端玩家）
  onSwitchDimension(player, msg) {
    const raw = String(msg.dim || '');
    const def = DIMENSIONS[raw];
    if (!def || !def.implemented) {
      this.sendTo(player, MSG.CHAT, { from: '系统', fromId: 0, text: `未知维度「${raw}」` });
      return;
    }
    const dim = raw;
    if (player.dim === dim) return;
    player.dim = dim;
    // 广播给所有人（含切换者）：异维端移除其实体、同维端重建
    this.broadcast(MSG.PLAYER_DIMENSION, { id: player.id, dim, name: player.name, pos: player.pos, selected: player.selected, held: player.heldItem });
    // 目标维度账本（blocks/containers）下发，切换者据此收敛本地世界
    const blocks = [];
    for (const [key, id] of this.dimBucket(this.dimensionBlocks, dim)) {
      const [x, y, z] = key.split(',').map(Number);
      blocks.push({ x, y, z, id });
    }
    const containers = [];
    for (const [key, items] of this.dimBucket(this.dimensionContainers, dim)) {
      const [x, y, z] = key.split(',').map(Number);
      containers.push({ x, y, z, items });
    }
    this.sendTo(player, MSG.DIMENSION_WORLD, { dim, blocks, containers });
    // 回放目标维度的现存掉落物（M4：与 joinRoom 同口径，含归属锁剩余毫秒）
    for (const [id, d] of this.drops) {
      if ((d.dim || DEFAULT_DIMENSION) !== dim) continue;
      const remainLock = d.ownerUntil > Date.now() && d.owner ? Math.ceil(d.ownerUntil - Date.now()) : 0;
      const back = { id, x: d.x, y: d.y, z: d.z, name: d.name, count: d.count, d: dim };
      if (d.owner && remainLock > 0) { back.owner = d.owner; back.ownerLock = remainLock; }
      this.sendTo(player, MSG.DROP_SPAWN, back);
    }
    // 回放同维度玩家（切换者重建同维远端玩家；joinInfo 携带 dim）
    for (const p of this.players.values()) {
      if (p.id === player.id || p.dim !== dim) continue;
      this.sendTo(player, MSG.PLAYER_JOIN, this.joinInfo(p));
    }
    this.save();
    console.log(`[维度] ${player.name} → ${dim}（房间「${this.name}」）`);
  }

  onSetTime(player, msg) {
    if (player.id !== this.hostId) return; // 仅 host 可设时间
    this.time = Math.min(1, Math.max(0, safeNum(msg.time, this.time)));
    this.broadcast(MSG.TIME, { time: this.time });
    this.save();
    console.log(`[时间] host=${this.hostId} 设定 time=${this.time}`);
  }

  onChat(player, msg) {
    const text = String(msg.text || '').slice(0, 120);
    if (!text) return;
    console.log(`[聊天] ${player.name}: ${text}`);
    this.broadcast(MSG.CHAT, { from: player.name, fromId: player.id, text });
  }
}
