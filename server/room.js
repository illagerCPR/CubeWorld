// room.js -- 房间管理：玩家集合 + 方块账本 + 消息路由（MVP 单房间实现）
// 职责：方块仲裁(last-write-wins)、玩家状态中继、host 权限（改模式/设时间）
import { MSG } from './protocol.js';

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
  constructor() {
    this.players = new Map();   // id -> player
    this.blocks = new Map();    // "x,y,z" -> id  (方块账本主副本)
    this.drops = new Map();     // dropId -> {x,y,z,name,count,spawnedAt}  (掉落物账本主副本)
    this.nextDropId = 1;
    this.nextMobId = 1;         // 怪物 id 分配（事件同步，服务器仅分配/中继不跑 AI）
    this.seed = null;
    this.time = 0.35;
    this.hostId = null;
    this.nextId = 1;
  }

  addPlayer(ws, name) {
    const id = this.nextId++;
    const p = {
      id, ws, name,
      mode: 'survival',
      health: 20, food: 20, saturation: 5,
      pos: { x: 0.5, y: 66, z: 0.5, yaw: 0, pitch: 0 },
      onGround: false, flying: false, inWater: false,
      selected: 0, alive: true,
    };
    this.players.set(id, p);
    return p;
  }

  playerList() {
    return [...this.players.values()].map(p => ({
      id: p.id, name: p.name, mode: p.mode, pos: p.pos,
      health: p.health, food: p.food, selected: p.selected,
    }));
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

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.broadcast(MSG.PLAYER_LEAVE, { id, name: p.name });
    if (this.hostId === id) {
      this.hostId = this.players.size ? this.players.keys().next().value : null;
    }
    console.log(`[!] ${p.name} 离开，剩余 ${this.players.size} 人`);
  }

  createRoom(player, msg) {
    this.seed = safeInt(msg.seed, Math.floor(Math.random() * 2147483647));
    player.mode = msg.mode === 'creative' ? 'creative' : (msg.mode === 'spectator' ? 'spectator' : 'survival');
    this.hostId = player.id;
    this.sendTo(player, MSG.ROOM_CREATED, { roomId: 'lan' });
    this.sendTo(player, MSG.WORLD_INFO, { seed: this.seed, mode: player.mode, time: this.time, hostId: this.hostId });
    this.broadcast(MSG.PLAYER_JOIN, { id: player.id, name: player.name, mode: player.mode, pos: player.pos }, player.id);
    console.log(`[+] ${player.name} 创建房间 seed=${this.seed} (host)`);
  }

  joinRoom(player, msg) {
    // 房间不存在（尚未创建）时首个加入者自动成为 host
    if (this.seed === null) {
      this.createRoom(player, { seed: 0, mode: 'survival' });
      return;
    }
    this.sendTo(player, MSG.WORLD_INFO, { seed: this.seed, mode: this.modeOfHost(), time: this.time, hostId: this.hostId });
    // 回放方块账本：新玩家加入即见世界现状
    for (const [key, id] of this.blocks) {
      const [x, y, z] = key.split(',').map(Number);
      this.sendTo(player, MSG.BLOCK_CHANGE, { x, y, z, id, by: 0 });
    }
    // 回放当前掉落物：新玩家加入即见现存掉落物
    for (const [id, d] of this.drops) {
      this.sendTo(player, MSG.DROP_SPAWN, { id, x: d.x, y: d.y, z: d.z, name: d.name, count: d.count });
    }
    this.broadcast(MSG.PLAYER_JOIN, { id: player.id, name: player.name, mode: player.mode, pos: player.pos }, player.id);
    console.log(`[+] ${player.name} 加入房间 seed=${this.seed}`);
  }

  modeOfHost() {
    const h = this.players.get(this.hostId);
    return h ? h.mode : 'survival';
  }

  // 玩家消息路由
  handle(player, msg) {
    switch (msg.t) {
      case MSG.BLOCK_SET: this.onBlockSet(player, msg); break;
      case MSG.DROP_SPAWN: this.onDropSpawn(player, msg); break;
      case MSG.DROP_TAKEN: this.onDropTaken(player, msg); break;
      case MSG.MOB_SPAWN: this.onMobSpawn(player, msg); break;
      case MSG.MOB_ATTACK: this.onMobAttack(player, msg); break;
      case MSG.MOB_DIED: this.onMobDied(player, msg); break;
      case MSG.REDSTONE_STATE: this.onRedstoneState(player, msg); break;
      case MSG.PLAYER_STATE: this.onPlayerState(player, msg); break;
      case MSG.PLAYER_FULL: this.onPlayerFull(player, msg); break;
      case MSG.ATTACK_PLAYER: this.onAttack(player, msg); break;
      case MSG.RESPAWN: this.onRespawn(player, msg); break;
      case MSG.GAMEMODE: this.onGamemode(player, msg); break;
      case MSG.SET_TIME: this.onSetTime(player, msg); break;
      case MSG.CHAT: this.onChat(player, msg); break;
      case MSG.PING: this.sendTo(player, MSG.PONG, { seq: msg.seq }); break;
      default: break;
    }
  }

  onBlockSet(player, msg) {
    const x = safeInt(msg.x), y = safeInt(msg.y), z = safeInt(msg.z), id = safeInt(msg.id);
    if (id < 0 || id > 65535) return;
    if (id === 0) this.blocks.delete(`${x},${y},${z}`);
    else this.blocks.set(`${x},${y},${z}`, id);
    this.broadcast(MSG.BLOCK_CHANGE, { x, y, z, id, by: player.id });
  }

  // 掉落物：客户端请求生成 -> 服务器分配唯一 id 并广播（含发起者，各端据此创建同一实体）
  onDropSpawn(player, msg) {
    const x = safeNum(msg.x), y = safeNum(msg.y), z = safeNum(msg.z);
    const count = Math.min(64, Math.max(1, safeInt(msg.count, 1)));
    const name = String(msg.name || '').slice(0, 32);
    if (!name) return;
    const id = this.nextDropId++;
    this.drops.set(id, { x, y, z, name, count, spawnedAt: Date.now() });
    this.broadcast(MSG.DROP_SPAWN, { id, x, y, z, name, count });
    console.log(`[掉落] ${player.name} 生成 ${name}x${count} @(${x},${y},${z}) id=${id}`);
  }

  // 掉落物拾取：从账本删除并广播（重复/无效 id 直接忽略）
  onDropTaken(player, msg) {
    const id = safeInt(msg.id);
    if (!this.drops.has(id)) return;
    this.drops.delete(id);
    this.broadcast(MSG.DROP_TAKEN, { id, by: player.id });
  }

  // 清理过期掉落物（5 分钟），广播移除（by=0 表示过期自然消失）
  expireDrops() {
    const now = Date.now();
    for (const [id, d] of this.drops) {
      if (now - d.spawnedAt > 300000) {
        this.drops.delete(id);
        this.broadcast(MSG.DROP_TAKEN, { id, by: 0 });
      }
    }
  }

  // 怪物事件（阶段 2 方案①：服务器只分配 id + 中继，不跑 AI）
  // host 端请求生成 -> 分配唯一 id 广播（含发起者，各端据此创建同一怪物实体）
  onMobSpawn(player, msg) {
    const type = String(msg.type || '').slice(0, 24);
    const x = safeNum(msg.x), y = safeNum(msg.y), z = safeNum(msg.z);
    if (!type) return;
    const id = this.nextMobId++;
    this.broadcast(MSG.MOB_SPAWN, { id, type, x, y, z });
    console.log(`[怪] ${player.name} 生成 ${type} @(${x},${y},${z}) id=${id}`);
  }

  // 玩家攻击怪物：转发（except 发起者，发起者端已本地处理）
  onMobAttack(player, msg) {
    const id = safeInt(msg.id);
    const damage = Math.max(0, safeNum(msg.damage, 1));
    const x = safeNum(msg.x), y = safeNum(msg.y), z = safeNum(msg.z);
    this.broadcast(MSG.MOB_ATTACK, { id, fromId: player.id, damage, x, y, z }, player.id);
  }

  // 怪物死亡：转发（except 发起者，掉落物由击杀端产出）
  onMobDied(player, msg) {
    const id = safeInt(msg.id);
    this.broadcast(MSG.MOB_DIED, { id }, player.id);
  }

  // 红石源状态（lever/button）：转发 except 发起者，各端对齐 poweredBlocks
  onRedstoneState(player, msg) {
    const x = safeInt(msg.x), y = safeInt(msg.y), z = safeInt(msg.z);
    this.broadcast(MSG.REDSTONE_STATE, { x, y, z, on: !!msg.on, by: player.id }, player.id);
  }

  onPlayerState(player, msg) {
    const p = player.pos;
    p.x = safeNum(msg.x, p.x); p.y = safeNum(msg.y, p.y); p.z = safeNum(msg.z, p.z);
    p.yaw = safeNum(msg.yaw, p.yaw); p.pitch = safeNum(msg.pitch, p.pitch);
    player.onGround = !!msg.onGround; player.flying = !!msg.flying; player.inWater = !!msg.inWater;
    this.broadcast(MSG.PLAYER_STATE, {
      id: player.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      onGround: player.onGround, flying: player.flying, inWater: player.inWater,
    }, player.id);
  }

  onPlayerFull(player, msg) {
    player.health = safeNum(msg.health, player.health);
    player.food = safeNum(msg.food, player.food);
    player.saturation = safeNum(msg.saturation, player.saturation);
    if (msg.mode) player.mode = msg.mode === 'creative' ? 'creative' : (msg.mode === 'spectator' ? 'spectator' : 'survival');
    player.selected = safeInt(msg.selected, player.selected);
    this.broadcast(MSG.PLAYER_FULL, {
      id: player.id, health: player.health, food: player.food,
      saturation: player.saturation, mode: player.mode, selected: player.selected,
    }, player.id);
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

  onRespawn(player, msg) {
    player.health = 20; player.food = 20; player.saturation = 5; player.alive = true;
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

  onSetTime(player, msg) {
    if (player.id !== this.hostId) return; // 仅 host 可设时间
    this.time = Math.min(1, Math.max(0, safeNum(msg.time, this.time)));
    this.broadcast(MSG.TIME, { time: this.time });
    console.log(`[时间] host=${this.hostId} 设定 time=${this.time}`);
  }

  onChat(player, msg) {
    const text = String(msg.text || '').slice(0, 120);
    if (!text) return;
    console.log(`[聊天] ${player.name}: ${text}`);
    this.broadcast(MSG.CHAT, { from: player.name, fromId: player.id, text });
  }
}
