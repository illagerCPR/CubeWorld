// index.mjs -- Project-MC 局域网联机服务器入口
// 用法：node server/index.mjs  （端口可用环境变量 PORT 覆盖，默认 3001）
// WebSocket 路径固定为 /ws
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { MSG } from './protocol.js';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

const room = new Room();

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Project-MC LAN server 运行中 (WebSocket: ws://<host>:' + PORT + '/ws)\n');
});

const wss = new WebSocketServer({ server, path: '/ws' });

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress;
  console.log(`[+] 连接: ${addr}`);
  let player = null;

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
      // 首条必须是 hello
      if (msg.t === MSG.HELLO) {
        player = room.addPlayer(ws, String(msg.name || '玩家').slice(0, 16));
        send(ws, { t: MSG.WELCOME, selfId: player.id, players: room.playerList() });
        console.log(`[*] ${player.name} 已连接 (id=${player.id})`);
      }
      return;
    }

    if (msg.t === MSG.CREATE_ROOM) {
      room.createRoom(player, msg);
    } else if (msg.t === MSG.JOIN_ROOM) {
      room.joinRoom(player, msg);
    } else if (msg.t === MSG.LEAVE_ROOM) {
      room.removePlayer(player.id);
      player = null;
      ws.close();
    } else {
      if (process.env.DEBUG) console.log(`[msg] ${msg.t} from id=${player.id}`);
      room.handle(player, msg);
    }
  });

  ws.on('close', () => {
    clearInterval(hb);
    if (player) room.removePlayer(player.id);
    console.log(`[-] 断开: ${addr}`);
  });
  ws.on('error', () => {});
});

server.listen(PORT, HOST, () => {
  console.log(`Project-MC LAN server 监听 http://${HOST}:${PORT} (WebSocket: /ws)`);
  console.log('局域网内其它电脑用 ws://<本机IP>:' + PORT + '/ws 加入');
});
