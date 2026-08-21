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
    this.broadcast(MSG.PLAYER_LEAVE, { id });
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
    this.sendTo(player, MSG.WORLD_INFO, { seed: this.seed, mode: player.mode, time: this.time });
    this.broadcast(MSG.PLAYER_JOIN, { id: player.id, name: player.name, mode: player.mode, pos: player.pos }, player.id);
    console.log(`[+] ${player.name} 创建房间 seed=${this.seed} (host)`);
  }

  joinRoom(player, msg) {
    // 房间不存在（尚未创建）时首个加入者自动成为 host
    if (this.seed === null) {
      this.createRoom(player, { seed: 0, mode: 'survival' });
      return;
    }
    this.sendTo(player, MSG.WORLD_INFO, { seed: this.seed, mode: this.modeOfHost(), time: this.time });
    // 回放方块账本：新玩家加入即见世界现状
    for (const [key, id] of this.blocks) {
      const [x, y, z] = key.split(',').map(Number);
      this.sendTo(player, MSG.BLOCK_CHANGE, { x, y, z, id, by: 0 });
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
