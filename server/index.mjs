// index.mjs -- Project-MC 局域网联机服务器入口
// 用法：node server/index.mjs  （端口可用环境变量 PORT 覆盖，默认 3001）
// WebSocket 路径固定为 /ws
// 阶段 3：多房间（房间名隔离世界）+ 世界落盘（server/world/<房间名>.json，重启恢复）
// 阶段 4：服务器配置面板（http://<host>:<port>/ 管理页 + /api/* JSON 接口 + server/config.json 持久化配置）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { MSG } from './protocol.js';
import * as store from './store.js';
import * as config from './config.js';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// 服务器配置（管理面板可改，落盘 config.json，重启保留）
const serverConfig = config.loadConfig();
const BOOT_TIME = Math.floor(Date.now() / 1000);

// 房间管理器：房间名 -> Room（同名房间共享同一世界，世界按名隔离并落盘）
const rooms = new Map();
let nextPlayerId = 1;

// 取（或创建）指定房间；创建时若磁盘有该房间存档则恢复其世界
function getRoom(name) {
  const key = String(name || '').trim() || 'default';
  let room = rooms.get(key);
  if (!room) {
    room = new Room(key, (r) => store.saveRoom(r), serverConfig);
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

// 服务器管理面板（阶段 4）：HTTP 路由 + JSON API
// 管理页 /   -> server/admin.html
// /api/status  -> 服务器/房间/玩家/配置状态
// /api/broadcast {text} -> 向所有房间广播系统消息
// /api/kick {playerId} -> 踢出玩家（发 kicked，客户端停止自动重连）
// /api/config (GET/POST) -> 读取/更新服务器配置（落盘）
// /api/room/<name>/clear-drops -> 清空该房间掉落物
// /api/room/<name>/delete -> 删除房间（踢出所有玩家 + 删磁盘存档 + 从内存移除）
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 64 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const adminHtml = (() => {
  try {
    return fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'admin.html'), 'utf8');
  } catch { return '<h1>管理面板文件缺失</h1>'; }
})();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + req.headers.host);
  const p = url.pathname;

  // 管理面板页面
  if (req.method === 'GET' && p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(adminHtml);
    return;
  }

  // JSON API
  if (p.startsWith('/api/')) {
    try {
      if (p === '/api/status' && req.method === 'GET') {
        const onlinePlayers = [...rooms.values()].reduce((n, r) => n + r.players.size, 0);
        sendJson(res, 200, {
          bootTime: BOOT_TIME,
          onlinePlayers,
          rooms: [...rooms.values()].map((r) => r.info()),
          config: { ...serverConfig },
        });
        return;
      }
      if (p === '/api/config' && req.method === 'GET') {
        sendJson(res, 200, { config: { ...serverConfig } });
        return;
      }
      if (p === '/api/config' && req.method === 'POST') {
        const body = await readBody(req);
        Object.assign(serverConfig, config.applyConfig(serverConfig, body));
        config.saveConfig(serverConfig);
        console.log(`[配置] 已更新: dropTtlMs=${serverConfig.dropTtlMs} heartbeatMs=${serverConfig.heartbeatMs} maxPlayersPerRoom=${serverConfig.maxPlayersPerRoom}`);
        sendJson(res, 200, { ok: true, config: { ...serverConfig } });
        return;
      }
      if (p === '/api/broadcast' && req.method === 'POST') {
        const body = await readBody(req);
        const text = String(body.text || '').slice(0, 200);
        if (!text) { sendJson(res, 400, { error: '消息为空' }); return; }
        for (const r of rooms.values()) {
          r.broadcast(MSG.CHAT, { from: '系统', fromId: 0, text: `【管理】${text}` });
        }
        console.log(`[管理] 广播: ${text}`);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (p === '/api/kick' && req.method === 'POST') {
        const body = await readBody(req);
        const id = Number(body.playerId);
        for (const r of rooms.values()) {
          if (r.players.has(id)) {
            r.kickPlayer(id, body.reason || '被服务器管理员移出');
            sendJson(res, 200, { ok: true, room: r.name });
            return;
          }
        }
        sendJson(res, 404, { error: '玩家不在任何房间' });
        return;
      }
      // /api/room/<name>/<action>
      const m = p.match(/^\/api\/room\/([^/]+)\/(clear-drops|delete)$/);
      if (m && req.method === 'POST') {
        const roomName = decodeURIComponent(m[1]);
        const action = m[2];
        const room = rooms.get(roomName);
        if (!room) { sendJson(res, 404, { error: '房间不存在' }); return; }
        if (action === 'clear-drops') {
          const removed = room.clearDrops();
          sendJson(res, 200, { ok: true, removed });
          return;
        }
        if (action === 'delete') {
          for (const id of [...room.players.keys()]) room.kickPlayer(id, '房间已被服务器管理员删除');
          store.deleteRoomFile(roomName);
          rooms.delete(roomName);
          console.log(`[管理] 删除房间「${roomName}」（世界存档已移除）`);
          sendJson(res, 200, { ok: true });
          return;
        }
      }
      sendJson(res, 404, { error: '未知接口' });
    } catch (e) {
      sendJson(res, 500, { error: String(e && e.message || e) });
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
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

  // 心跳：每 heartbeatMs（可配置，默认 15s）发应用层 ping，超时未收到 JSON pong 则断开
  let alive = true;
  const hb = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false;
    send(ws, { t: MSG.PING, seq: Date.now() });
  }, serverConfig.heartbeatMs);

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
      if (!room.addPlayer(player)) return; // 房间已满：addPlayer 已发 kicked
      player.room = room;
      room.createRoom(player, msg);
    } else if (msg.t === MSG.JOIN_ROOM) {
      const room = getRoom(msg.room);
      if (!room.addPlayer(player)) return; // 房间已满：addPlayer 已发 kicked
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
  console.log(`管理面板: http://127.0.0.1:${PORT}/ （房间/玩家/配置/世界管理）`);
  console.log(`已加载磁盘房间存档: ${store.loadRooms().length} 个`);
  console.log(`配置: 掉落物过期 ${serverConfig.dropTtlMs}ms 心跳 ${serverConfig.heartbeatMs}ms 每房上限 ${serverConfig.maxPlayersPerRoom}人`);
});
