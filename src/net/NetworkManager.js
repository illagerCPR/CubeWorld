// NetworkManager.js -- 局域网联机网络层：连接、消息路由、方块/玩家/聊天同步
import { MSG } from '../../server/protocol.js';
import { RemotePlayer } from '../entity/RemotePlayer.js';

export class NetworkManager {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.selfId = null;
    this.connected = false;
    this.name = '玩家';
    this._handlers = new Map();
    this._stateTimer = 0;
    this._stateInterval = 0.05; // 20Hz 状态上报
    this._applyingRemote = false;
    this._ready = false;          // 世界已就绪（可创建远端玩家）
    this._pendingPlayers = [];    // 世界就绪前的玩家加入缓存
    this._pendingOpen = [];       // 连接打开前的待发消息
    this.onStatusChange = null;   // (status: 'connected'|'closed', text) => void
  }

  on(type, fn) { this._handlers.set(type, fn); }
  _emit(type, data) { const fn = this._handlers.get(type); if (fn) fn(data); }

  // 建立连接并发送 hello；name 为昵称
  connect(url, name) {
    this.name = name || '玩家';
    this.close();
    this._ready = false;
    this._pendingPlayers = [];
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.connected = true;
      this._send(MSG.HELLO, { name: this.name, version: '0.1' });
      for (const q of this._pendingOpen) this._send(q.type, q.data);
      this._pendingOpen = [];
      if (this.onStatusChange) this.onStatusChange('connected', '已连接服务器');
    };
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      this._handle(m);
    };
    this.ws.onclose = () => {
      this.connected = false;
      if (this.onStatusChange) this.onStatusChange('closed', '与服务器断开连接');
    };
    this.ws.onerror = () => {};
  }

  _send(type, data) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: type, ...data }));
  }

  // 连接未打开时排队，打开后立即发送（用于 create_room/join_room）
  _sendQueued(type, data) {
    if (this.connected) this._send(type, data);
    else this._pendingOpen.push({ type, data });
  }

  // 世界就绪后调用（Game.start 完成后）：创建缓存中的远端玩家
  onWorldStarted() {
    this._ready = true;
    for (const info of this._pendingPlayers) this._addRemote(info);
    this._pendingPlayers = [];
  }

  _addRemote(info) {
    if (info.id === this.selfId) return;
    if (this.game.remotePlayers.has(info.id)) return;
    const rp = new RemotePlayer(this.game.renderer.scene, info.id, info.name, info.pos);
    this.game.remotePlayers.set(info.id, rp);
    if (info.health !== undefined) rp.applyFull(info);
  }

  _removeRemote(id) {
    const rp = this.game.remotePlayers.get(id);
    if (rp) { rp.dispose(); this.game.remotePlayers.delete(id); }
  }

  _queueOrAdd(info) {
    if (this._ready) this._addRemote(info);
    else this._pendingPlayers.push(info);
  }

  _handle(msg) {
    switch (msg.t) {
      case MSG.WELCOME:
        this.selfId = msg.selfId;
        for (const p of (msg.players || [])) this._queueOrAdd(p);
        break;
      case MSG.WORLD_INFO:
        this._emit('world_info', msg);   // 由 main.js 用该 seed 启动世界
        break;
      case MSG.PLAYER_JOIN:
        this._queueOrAdd(msg);
        this._emit('system', `${msg.name} 加入了游戏`);
        break;
      case MSG.PLAYER_LEAVE:
        this._removeRemote(msg.id);
        break;
      case MSG.BLOCK_CHANGE:
        this.applyRemoteBlock(msg.x, msg.y, msg.z, msg.id);
        break;
      case MSG.PLAYER_STATE: {
        if (msg.id === this.selfId) break;
        const rp = this.game.remotePlayers.get(msg.id);
        if (rp) rp.applyState(msg);
        break;
      }
      case MSG.PLAYER_FULL: {
        if (msg.id === this.selfId) break;
        const rp = this.game.remotePlayers.get(msg.id);
        if (rp) rp.applyFull(msg);
        break;
      }
      case MSG.ATTACK_PLAYER:
        if (msg.targetId === this.selfId) this._emit('attacked', msg);
        else { const rp = this.game.remotePlayers.get(msg.targetId); if (rp) rp.playHit(); }
        break;
      case MSG.PLAYER_DIED:
        if (msg.id === this.selfId) break;
        { const rp = this.game.remotePlayers.get(msg.id); if (rp) rp.playDeath(); }
        break;
      case MSG.RESPAWN:
        if (msg.id === this.selfId) break;
        { const rp = this.game.remotePlayers.get(msg.id); if (rp) rp.respawn(msg); }
        break;
      case MSG.GAMEMODE:
        if (msg.id === this.selfId) break;
        { const rp = this.game.remotePlayers.get(msg.id); if (rp) rp.setMode(msg.mode); }
        break;
      case MSG.TIME:
        this._emit('time', msg.time);
        break;
      case MSG.CHAT:
        this._emit('chat', msg);
        break;
      case MSG.PING:
        this._send(MSG.PONG, { seq: msg.seq });   // 回应用层心跳，防服务器踢出
        break;
      default: break;
    }
  }

  // 远端方块落地：重建网格/红石但不回环上报
  applyRemoteBlock(x, y, z, id) {
    const world = this.game.world;
    if (!world) return;
    this._applyingRemote = true;
    world.setBlock(x, y, z, id, false); // 远端落地：不写入本地 modifiedBlocks
    if (this.game.redstone) this.game.redstone.onBlockChange(x, y, z);
    this._applyingRemote = false;
  }

  // 绑定世界：World.setBlock 钩子统一上报（挖掘/放置/爆炸/活塞都走这一入口，含防回环）
  bindWorld(world) {
    world.onLocalBlockChange = (x, y, z, id) => {
      if (this._applyingRemote) return; // 远端落地不回环
      this.sendBlock(x, y, z, id);
    };
  }

  // 本地发起方块修改（挖掘/放置/爆炸后调用）
  sendBlock(x, y, z, id) { this._send(MSG.BLOCK_SET, { x, y, z, id }); }

  // 每帧调用：节流上报本地玩家状态
  update(dt) {
    if (!this.connected || !this.game.world) return;
    this._stateTimer -= dt;
    if (this._stateTimer > 0) return;
    this._stateTimer = this._stateInterval;
    const p = this.game.player;
    this._send(MSG.PLAYER_STATE, {
      x: p.position.x, y: p.position.y, z: p.position.z,
      yaw: p.yaw, pitch: p.pitch,
      onGround: p.onGround, flying: p.flying, inWater: p.inWater,
    });
  }

  sendPlayerFull() {
    const p = this.game.player;
    this._send(MSG.PLAYER_FULL, {
      health: p.health, food: p.food, saturation: p.saturation,
      mode: p.gamemode, selected: this.game.inventory.hotbarSelected,
    });
  }

  sendAttackPlayer(targetId, damage) { this._send(MSG.ATTACK_PLAYER, { targetId, damage }); }
  sendPlayerDied() { this._send(MSG.PLAYER_DIED, {}); }
  sendRespawn(x, y, z) { this._send(MSG.RESPAWN, { x, y, z }); }
  sendGamemode(mode) { this._send(MSG.GAMEMODE, { mode }); }
  sendSetTime(t) { this._send(MSG.SET_TIME, { time: t }); }
  sendChat(text) { this._send(MSG.CHAT, { text }); }
  createRoom(seed, mode) { this._sendQueued(MSG.CREATE_ROOM, { seed, mode }); }
  joinRoom() { this._sendQueued(MSG.JOIN_ROOM, {}); }

  close() {
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    this.connected = false;
  }
}
