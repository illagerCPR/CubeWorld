// NetworkManager.js -- 局域网联机网络层：连接/重连、消息路由、方块/玩家/掉落物/聊天同步
import { MSG } from '../../server/protocol.js';
import { RemotePlayer } from '../entity/RemotePlayer.js';
import { playerColorCss } from './playerColor.js';
import { BlockRegistry } from '../core/BlockRegistry.js';

const RECONNECT_MAX = 8; // 断线自动重连最大尝试次数

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
    this._ready = false;          // 世界已就绪（可创建远端玩家/落地方块与掉落物）
    this._pendingPlayers = [];    // 世界就绪前的玩家加入缓存
    this._pendingBlocks = [];     // 世界就绪前的 block_change 缓存（修复首次加入丢包）
    this._pendingDrops = [];      // 世界就绪前的 drop_* 缓存
    this._pendingMobs = [];       // 世界就绪前的 mob_spawn 缓存
    this._pendingOpen = [];       // 连接打开前的待发消息
    this.isHost = false;          // 是否房间 host（host 端负责怪物自然生成）
    this.room = 'default';        // 当前房间名（阶段 3：同名房间共享同一世界）
    this._url = null;             // 服务器地址（重连用）
    this._reconnectAttempt = 0;   // 当前重连尝试次数
    this._reconnectTimer = null;  // 重连定时器
    this._explicitClose = false;  // 主动关闭（returnToMenu）则不自动重连
    this.onStatusChange = null;   // (status: 'connected'|'reconnecting'|'closed', text) => void
    // 阶段10：RTT 直测（应用层 ping/pong 计时），供插值自适应与信息栏显示
    this.rttMs = null;            // 平滑后的往返延迟（毫秒，EMA 0.8/0.2）；null=尚未测得
    this._pingSeq = 0;
    this._pingTimer = 0;
    this._pingInterval = 2;       // 每 2 秒直测一次 RTT
  }

  on(type, fn) { this._handlers.set(type, fn); }
  _emit(type, data) { const fn = this._handlers.get(type); if (fn) fn(data); }

  // 建立连接并发送 hello；name 为昵称（每次新连接重置状态，不触发自动重连）
  connect(url, name) {
    this.name = name || '玩家';
    this._url = url;
    this._reconnectAttempt = 0;
    this._ready = false;
    this._pendingPlayers = [];
    this._pendingBlocks = [];
    this._pendingDrops = [];
    this._pendingMobs = [];
    this._pendingOpen = [];
    this._connectSocket(false);
  }

  // 打开 WebSocket 并注册事件；isReconnect=true 时重连成功会自动重新加入房间
  _connectSocket(isReconnect) {
    this._explicitClose = false;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch {} }
    const ws = new WebSocket(this._url);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this._reconnectAttempt = 0; // 连接成功，重连计数清零
      this._send(MSG.HELLO, { name: this.name, version: '0.1' });
      if (isReconnect) {
        // 重连：世界已在运行，不重启，直接重新加入房间（服务器回放方块/掉落物账本）
        // 必须携带 room 名——曾发空 payload 落到 default 房（房间静默漂移，村民/方块全对不上）
        this._pendingPlayers = [];
        this._send(MSG.JOIN_ROOM, { room: this.room });
        if (this.onStatusChange) this.onStatusChange('connected', '已重新连接服务器');
      } else {
        for (const q of this._pendingOpen) this._send(q.type, q.data);
        this._pendingOpen = [];
        if (this.onStatusChange) this.onStatusChange('connected', '已连接服务器');
      }
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      this._handle(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // 旧 socket 的关闭事件忽略（已被替换/主动关闭）
      this.connected = false;
      if (this._ready && !this._explicitClose) this._scheduleReconnect();
      else if (this.onStatusChange) this.onStatusChange('closed', '与服务器断开连接');
    };
    ws.onerror = () => {};
  }

  // 指数退避重连：1s,2s,4s,8s,... 封顶 15s；超过 RECONNECT_MAX 次放弃
  _scheduleReconnect() {
    this._reconnectAttempt++;
    if (this._reconnectAttempt > RECONNECT_MAX) {
      if (this.onStatusChange) this.onStatusChange('closed', '重连失败，请检查服务器');
      return;
    }
    const delay = Math.min(15000, 1000 * Math.pow(2, this._reconnectAttempt - 1));
    if (this.onStatusChange) this.onStatusChange('reconnecting', `连接断开，${delay / 1000}s 后自动重连(${this._reconnectAttempt}/${RECONNECT_MAX})`);
    this._reconnectTimer = setTimeout(() => this._connectSocket(true), delay);
  }

  _send(type, data) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: type, ...data }));
  }

  // 连接未打开时排队，打开后立即发送（用于 create_room/join_room）
  _sendQueued(type, data) {
    if (this.connected) this._send(type, data);
    else this._pendingOpen.push({ type, data });
  }

  // 世界就绪后调用（Game.start 完成后）：落地缓存的远端玩家/方块/掉落物/怪物
  onWorldStarted() {
    this._ready = true;
    for (const info of this._pendingPlayers) this._addRemote(info);
    this._pendingPlayers = [];
    for (const b of this._pendingBlocks) this.applyRemoteBlock(b.x, b.y, b.z, b.id);
    this._pendingBlocks = [];
    for (const d of this._pendingDrops) {
      if (d.type === 'spawn') this._spawnDrop(d.msg);
      else this._takeDrop(d.msg);
    }
    this._pendingDrops = [];
    for (const m of this._pendingMobs) this._spawnMob(m);
    this._pendingMobs = [];
  }

  _addRemote(info) {
    if (info.id === this.selfId) return;
    if (this.game.remotePlayers.has(info.id)) return;
    const rp = new RemotePlayer(this.game.renderer.scene, info.id, info.name, info.pos, this.game);
    this.game.remotePlayers.set(info.id, rp);
    // 阶段10：joinRoom 回放的 PLAYER_JOIN 携带 selected/heldItem/hotbar（新加入者立即看到在线玩家手持物）
    if (info.health !== undefined || info.hotbar !== undefined || info.heldItem !== undefined) rp.applyFull(info);
  }

  _removeRemote(id) {
    const rp = this.game.remotePlayers.get(id);
    if (rp) { rp.dispose(); this.game.remotePlayers.delete(id); }
  }

  _queueOrAdd(info) {
    if (this._ready) this._addRemote(info);
    else this._pendingPlayers.push(info);
  }

  _spawnDrop(msg) {
    if (!this.game.mobManager) return;
    // 阶段10：透传归属锁（死亡掉落物：ownerLock 毫秒内仅 owner 本人可拾取）
    this.game.mobManager.spawnRemoteDrop(msg.id, msg.x, msg.y, msg.z, msg.name, msg.count, msg.owner, msg.ownerLock);
  }

  _takeDrop(msg) {
    if (!this.game.mobManager) return;
    this.game.mobManager.removeDropById(msg.id);
  }

  _spawnMob(msg) {
    if (!this.game.mobManager) return;
    this.game.mobManager.createMobFromNet(msg.id, msg.type, msg.x, msg.y, msg.z);
  }

  _handle(msg) {
    switch (msg.t) {
      case MSG.WELCOME:
        this.selfId = msg.selfId;
        for (const p of (msg.players || [])) this._queueOrAdd(p);
        break;
      case MSG.WORLD_INFO:
        this.room = msg.room || this.room;
        if (this._ready && this.game && this.game.world && this.game.running) {
          if (msg.restart) {
            // 阶段5：世界内换房 / 重建世界 —— 重启本地世界（保持连接），期间缓存远端数据
            this._ready = false;
            this.isHost = (msg.hostId === this.selfId);
            this._emit('restart_world', msg);
          } else {
            // 断线重连成功：世界已在运行，不重启，仅同步时间/模式并刷新远端玩家
            this.isHost = (msg.hostId === this.selfId);
            if (this.game.sky) this.game.sky.time = msg.time;
            if (msg.mode && this.game.player) this.game.player.setMode(msg.mode);
            this.onWorldStarted();
            this._emit('system', `已重新连接服务器（房间 ${this.room}）`);
            this.sendPlayerFull();
          }
        } else {
          this.isHost = (msg.hostId === this.selfId);
          this._emit('world_info', msg);   // 首次进入：由 main.js 用该 seed 启动世界
        }
        break;
      case MSG.PLAYER_JOIN:
        this._queueOrAdd(msg);
        this._emit('system', { parts: [{ text: msg.name, color: playerColorCss(msg.id) }, { text: ' 加入了游戏' }] });
        break;
      case MSG.PLAYER_LEAVE:
        this._removeRemote(msg.id);
        this._emit('system', { parts: [{ text: msg.name || '玩家', color: playerColorCss(msg.id) }, { text: ' 离开了游戏' }] });
        break;
      case MSG.BLOCK_CHANGE:
        if (this._ready) this.applyRemoteBlock(msg.x, msg.y, msg.z, msg.id);
        else this._pendingBlocks.push(msg);
        break;
      case MSG.DROP_SPAWN:
        if (this._ready) this._spawnDrop(msg);
        else this._pendingDrops.push({ type: 'spawn', msg });
        break;
      case MSG.DROP_TAKEN:
        if (this._ready) this._takeDrop(msg);
        else this._pendingDrops.push({ type: 'take', msg });
        break;
      case MSG.MOB_SPAWN:
        if (this._ready) this._spawnMob(msg);
        else this._pendingMobs.push(msg);
        break;
      case MSG.MOB_ATTACK:
        if (!this.game.mobManager) break;
        this.game.mobManager.applyRemoteMobAttack(msg.id, msg.damage, msg.x, msg.y, msg.z);
        break;
      case MSG.MOB_DIED:
        if (!this.game.mobManager) break;
        this.game.mobManager.applyRemoteMobDeath(msg.id);
        break;
      case MSG.REDSTONE_STATE:
        if (this.game.redstone) this.game.redstone.applyRemoteState(msg.x, msg.y, msg.z, msg.on);
        break;
      case MSG.CONTAINER_SET: {
        // T5：他人修改箱子 → 覆盖本地容器缓存，开着的同箱界面刷新
        if (!this.game.world || !Array.isArray(msg.items) || msg.items.length !== 27) break;
        this.game.world.setContainer(msg.x, msg.y, msg.z, msg.items);
        const cs = this.game.chestScreen;
        if (cs && cs.visible && cs.pos && cs.pos.x === msg.x && cs.pos.y === msg.y && cs.pos.z === msg.z) {
          cs._changed = false; // 已收敛到远端状态，hide 不回发
          cs.refresh(msg.items);
        }
        break;
      }
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
        this._send(MSG.PONG, { seq: msg.seq });   // 回应服务器心跳，防踢出（不带 ts，与 RTT 直测区分）
        break;
      case MSG.PONG:
        // 阶段10：自己发起的 RTT 直测回包（服务器回显 ts）——与心跳 PONG（无 ts）区分
        if (typeof msg.ts === 'number' && msg.ts > 0) {
          const rtt = performance.now() - msg.ts;
          if (rtt >= 0 && rtt < 10000) {
            this.rttMs = this.rttMs == null ? rtt : this.rttMs * 0.8 + rtt * 0.2;
          }
        }
        break;
      case MSG.DROP_DENY:
        // 阶段10：拾取被归属锁拒绝（死亡掉落物锁定期内他人拾取）——交给 Game 回滚本地拾取
        this._emit('drop_deny', msg);
        break;
      case MSG.KICKED:
        // 服务器管理面板踢出：停止自动重连并断开
        this._explicitClose = true;
        if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
        if (this.ws) { try { this.ws.close(); } catch {} }
        this.connected = false;
        if (this.onStatusChange) this.onStatusChange('closed', msg.reason || '已被服务器移出');
        break;
      default: break;
    }
  }

  // 远端方块落地：重建网格/红石但不回环上报
  applyRemoteBlock(x, y, z, id) {
    const world = this.game.world;
    if (!world) return;
    // T5：远端挖掉箱子 → 清本地容器缓存，开着的界面一并关闭（内容散落由挖掘方上报）
    const oldDef = BlockRegistry.getById(world.getBlock(x, y, z));
    const wasChest = oldDef && oldDef.name === 'chest';
    this._applyingRemote = true;
    world.setBlock(x, y, z, id, false); // 远端落地：不写入本地 modifiedBlocks
    if (this.game.redstone) this.game.redstone.onBlockChange(x, y, z);
    this._applyingRemote = false;
    if (wasChest) {
      world.removeContainer(x, y, z);
      const cs = this.game.chestScreen;
      if (cs && cs.visible && cs.pos && cs.pos.x === x && cs.pos.y === y && cs.pos.z === z) {
        cs._changed = false;
        cs.hide();
      }
    }
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

  // 本地发起掉落物生成（联机挖矿等）；实体由服务器广播 drop_spawn 回执后创建
  sendDropSpawn(x, y, z, name, count) { this._send(MSG.DROP_SPAWN, { x, y, z, name, count }); }
  // 本地拾取掉落物，通知服务器移除并广播
  sendDropTaken(id) { this._send(MSG.DROP_TAKEN, { id }); }

  // 联机怪物事件（host 生成 / 玩家攻击 / 怪物死亡）
  sendMobSpawn(type, x, y, z) { this._send(MSG.MOB_SPAWN, { type, x, y, z }); }
  sendMobAttack(id, damage, x, y, z) { this._send(MSG.MOB_ATTACK, { id, damage, x, y, z }); }
  sendMobDied(id) { this._send(MSG.MOB_DIED, { id }); }

  // 红石源状态（lever/button），低频广播让各端 poweredBlocks 对齐
  sendRedstoneState(x, y, z, on) { this._send(MSG.REDSTONE_STATE, { x, y, z, on }); }

  // T5：容器整箱上报（箱子内容改动；服务器记账本 + 广播其他端）
  sendContainerSet(x, y, z, items) {
    const packed = items.map((s) => (s ? { name: s.name, count: s.count } : null));
    this._send(MSG.CONTAINER_SET, { x, y, z, items: packed });
  }

  // 每帧调用：节流上报本地玩家状态 + RTT 直测
  update(dt) {
    if (!this.connected || !this.game.world) return;
    if (this.game.spectating) return; // 观战中不上报位置（避免观战者被吸附到目标处广播出去）
    // 阶段10：RTT 直测——发 ping（带本地时间戳），服务器回显 ts，PONG 分支计算平滑 RTT
    this._pingTimer -= dt;
    if (this._pingTimer <= 0) {
      this._pingTimer = this._pingInterval;
      this._send(MSG.PING, { seq: ++this._pingSeq, ts: performance.now() });
    }
    this._stateTimer -= dt;
    if (this._stateTimer > 0) return;
    this._stateTimer = this._stateInterval;
    const p = this.game.player;
    // 阶段6：上报手持物品（当前快捷栏槽位 + 物品名），服务器随 player_state 广播，远端渲染手持物
    const sel = this.game.inventory.getSelected();
    this._send(MSG.PLAYER_STATE, {
      x: p.position.x, y: p.position.y, z: p.position.z,
      yaw: p.yaw, pitch: p.pitch,
      onGround: p.onGround, flying: p.flying, inWater: p.inWater,
      selected: this.game.inventory.hotbarSelected,
      held: sel ? sel.name : null,
    });
  }

  sendPlayerFull() {
    const p = this.game.player;
    const sel = this.game.inventory.getSelected();
    // 阶段10：上报完整快捷栏（9 槽快照），服务器记录并在 joinRoom 回放给新加入者
    const hotbar = this.game.inventory.slots.slice(0, 9).map((s) => (s ? { name: s.name, count: s.count } : null));
    this._send(MSG.PLAYER_FULL, {
      health: p.health, food: p.food, saturation: p.saturation,
      mode: p.gamemode, selected: this.game.inventory.hotbarSelected,
      held: sel ? sel.name : null,
      hotbar,
    });
  }

  sendAttackPlayer(targetId, damage) { this._send(MSG.ATTACK_PLAYER, { targetId, damage }); }
  sendPlayerDied() {
    // 阶段6：死亡上报死亡位置 + 背包内容（服务器据此生成世界掉落物并广播）
    const p = this.game.player;
    const drops = [];
    for (const s of this.game.inventory.slots) {
      if (s) drops.push({ name: s.name, count: s.count });
    }
    this._send(MSG.PLAYER_DIED, { x: p.position.x, y: p.position.y, z: p.position.z, drops });
  }
  sendRespawn(x, y, z) { this._send(MSG.RESPAWN, { x, y, z }); }
  sendGamemode(mode) { this._send(MSG.GAMEMODE, { mode }); }
  sendSetTime(t) { this._send(MSG.SET_TIME, { time: t }); }
  sendChat(text) { this._send(MSG.CHAT, { text }); }
  createRoom(seed, mode, room) { this._sendQueued(MSG.CREATE_ROOM, { seed, mode, room }); }
  joinRoom(room) { this._sendQueued(MSG.JOIN_ROOM, { room }); }

  // 阶段5：世界内换房 / 重建世界（保持连接，服务器回 WORLD_INFO(restart) 后重启本地世界）
  sendSwitchRoom(room) { this._send(MSG.SWITCH_ROOM, { room }); }
  sendWorldReset() { this._send(MSG.WORLD_RESET, {}); }

  close() {
    this._explicitClose = true; // 主动关闭：不触发自动重连
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    this.connected = false;
  }
}
