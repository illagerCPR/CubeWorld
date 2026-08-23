// index.mjs -- Project-MC 局域网联机服务器入口
// 用法：node server/index.mjs  （端口可用环境变量 PORT 覆盖，默认 3001）
// WebSocket 路径固定为 /ws
// 阶段 3：多房间（房间名隔离世界）+ 世界落盘（server/world/<房间名>.json，重启恢复）
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { MSG } from './protocol.js';
import * as store from './store.js';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// 房间管理器：房间名 -> Room（同名房间共享同一世界，世界按名隔离并落盘）
const rooms = new Map();
let nextPlayerId = 1;

// 取（或创建）指定房间；创建时若磁盘有该房间存档则恢复其世界
function getRoom(name) {
  const key = String(name || '').trim() || 'default';
  let room = rooms.get(key);
  if (!room) {
    room = new Room(key, (r) => store.saveRoom(r));
    const snap = store.loadRooms().find((s) => s.name === key);
    if (snap) {
      room.restore(snap);
      console.log(`[世界] 恢复房间「${key}」seed=${room.seed} 方块${room.blocks.size} 掉落${room.drops.size}`);
    }
    rooms.set(key, room);
  }
  return room;
}

// 服务器聊天命令（/rooms /seed /help），结果只回给发起者
function handleCommand(player, text) {
  const args = text.slice(1).trim().split(/\s+/);
  const cmd = args[0] || '';
  const room = player.room;
  if (!room) return;
  let reply = '';
  if (cmd === 'rooms') {
    const list = [...rooms.values()].map((r) => `「${r.name}」${r.players.size}人 seed=${r.seed}`).join('  ');
    reply = `现有房间: ${list || '无'}`;
  } else if (cmd === 'seed') {
    reply = `当前房间「${room.name}」seed=${room.seed} 方块改动${room.blocks.size} 掉落${room.drops.size}`;
  } else if (cmd === 'help') {
    reply = '命令: /rooms 列出房间  /seed 查看当前世界种子  /help 帮助';
  } else {
    reply = `未知命令 /${cmd}（/help 查看）`;
  }
  room.sendTo(player, MSG.CHAT, { from: '系统', fromId: 0, text: reply });
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Project-MC LAN server 运行中 (WebSocket: ws://<host>:' + PORT + '/ws)\n房间数: ' + rooms.size + '\n');
});

const wss = new WebSocketServer({ server, path: '/ws' });

// 掉落物过期清理：所有房间每 10s 扫一次，过期的广播 drop_taken
const dropSweep = setInterval(() => { for (const r of rooms.values()) r.expireDrops(); }, 10000);

// 优雅退出：全部房间世界落盘（重启不丢）
function shutdown() {
  console.log('正在保存所有房间世界...');
  for (const r of rooms.values()) store.saveRoom(r);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress;
  console.log(`[+] 连接: ${addr}`);
  let player = null; // { id, ws, name, room? }；创建/加入房间后才进入某房间

  // 心跳：15s 发应用层 ping，30s 未收到 JSON pong 则断开
  let alive = true;
  const hb = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    send(ws, { t: MSG.PING, seq: Date.now() });
  }, 15000);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    // 心跳 pong：任何连接的 pong 都刷新存活（浏览器端 NetworkManager 自动回复）
    if (msg.t === MSG.PONG) { alive = true; return; }

    if (!player) {
      // 首条必须是 hello；此时尚未分配房间（welcome 不带玩家列表，进房后由 joinRoom 回放）
      if (msg.t === MSG.HELLO) {
        player = { id: nextPlayerId++, ws, name: String(msg.name || '玩家').slice(0, 16) };
        send(ws, { t: MSG.WELCOME, selfId: player.id, players: [] });
        console.log(`[*] ${player.name} 已连接 (id=${player.id})`);
      }
      return;
    }

    if (msg.t === MSG.CREATE_ROOM) {
      const room = getRoom(msg.room);
      room.addPlayer(player);
      player.room = room;
      room.createRoom(player, msg);
    } else if (msg.t === MSG.JOIN_ROOM) {
      const room = getRoom(msg.room);
      room.addPlayer(player);
      player.room = room;
      room.joinRoom(player, msg);
    } else if (msg.t === MSG.LEAVE_ROOM) {
      if (player.room) player.room.removePlayer(player.id);
      player.room = null;
      player = null;
      ws.close();
    } else if (msg.t === MSG.CHAT && String(msg.text || '').startsWith('/')) {
      // 服务器聊天命令：/rooms /seed /help
      handleCommand(player, String(msg.text || '').slice(0, 120));
    } else {
      if (process.env.DEBUG) console.log(`[msg] ${msg.t} from id=${player.id}`);
      if (player.room) player.room.handle(player, msg);
    }
  });

  ws.on('close', () => {
    clearInterval(hb);
    if (player && player.room) player.room.removePlayer(player.id);
    console.log(`[-] 断开: ${addr}`);
  });
  ws.on('error', () => {});
});

server.listen(PORT, HOST, () => {
  console.log(`Project-MC LAN server 监听 http://${HOST}:${PORT} (WebSocket: /ws)`);
  console.log('局域网内其它电脑用 ws://<本机IP>:' + PORT + '/ws 加入');
  console.log(`已加载磁盘房间存档: ${store.loadRooms().length} 个`);
});
