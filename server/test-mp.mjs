// test-mp.mjs -- 局域网服务器协议端到端验证脚本（临时，测完删除）
// 用法：node server/test-mp.mjs  （需已启动 node server/index.mjs）
// 说明：id 从 welcome 动态读取，不依赖绝对 id；房间状态由本脚本自建（先 create_room）
import WebSocket from 'ws';

const URL = 'ws://127.0.0.1:3001/ws';
const results = [];

function assert(name, cond) {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws._queue = [];
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, version: '0.1' })));
    ws.on('message', (d) => ws._queue.push(JSON.parse(d.toString())));
    ws.on('error', reject);
    // 等 welcome 后 resolve，返回 {ws, selfId, queue}
    const timer = setInterval(() => {
      const w = ws._queue.find(m => m.t === 'welcome');
      if (w) {
        clearInterval(timer);
        resolve({ ws, selfId: w.selfId, queue: ws._queue });
      }
    }, 20);
    setTimeout(() => { clearInterval(timer); reject(new Error('timeout waiting welcome')); }, 3000);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// A 创建房间
const A = await connect('Alice');
assert('A 收到 welcome', !!A);
A.ws.send(JSON.stringify({ t: 'create_room', seed: 12345, mode: 'survival' }));
await sleep(200);
assert('A 收到 room_created', !!A.queue.find(m => m.t === 'room_created'));
const aWorld = A.queue.find(m => m.t === 'world_info');
assert('A 收到 world_info seed=12345', !!aWorld && aWorld.seed === 12345);

// B 加入
const B = await connect('Bob');
assert('B 收到 welcome（含 A 在线）', !!B && B.queue.find(m => m.t === 'welcome').players.some(p => p.id === A.selfId));
B.ws.send(JSON.stringify({ t: 'join_room' }));
await sleep(250);
const bWorld = B.queue.find(m => m.t === 'world_info');
assert('B 收到 world_info seed=12345', !!bWorld && bWorld.seed === 12345);
assert('A 收到 player_join Bob', !!A.queue.find(m => m.t === 'player_join' && m.id === B.selfId && m.name === 'Bob'));

// A 改方块 -> B 收到
A.ws.send(JSON.stringify({ t: 'block_set', x: 10, y: 64, z: 20, id: 1 }));
await sleep(200);
const bBlock = B.queue.find(m => m.t === 'block_change' && m.x === 10 && m.y === 64 && m.z === 20);
assert('B 收到 block_change(10,64,20)->1 by=A', !!bBlock && bBlock.id === 1 && bBlock.by === A.selfId);

// B 断开，C 加入应收到方块账本回放
B.ws.close();
await sleep(150);
const C = await connect('Carol');
C.ws.send(JSON.stringify({ t: 'join_room' }));
await sleep(250);
const cBlock = C.queue.find(m => m.t === 'block_change' && m.x === 10 && m.y === 64 && m.z === 20);
assert('C 加入收到方块账本回放 block_change', !!cBlock && cBlock.id === 1);

// C 玩家状态 -> A 收到
C.ws.send(JSON.stringify({ t: 'player_state', x: 5, y: 70, z: 5, yaw: 1.5, pitch: 0.2, onGround: true, flying: false, inWater: false }));
await sleep(200);
assert('A 收到 player_state(C)', !!A.queue.find(m => m.t === 'player_state' && m.id === C.selfId && m.x === 5));

// C 聊天 -> A 收到
C.ws.send(JSON.stringify({ t: 'chat', text: 'hello world' }));
await sleep(200);
const aChat = A.queue.find(m => m.t === 'chat');
assert('A 收到 chat from Carol', !!aChat && aChat.text === 'hello world' && aChat.from === 'Carol');

// 互殴：A 打 C -> C 收到 attack_player 且扣血
A.ws.send(JSON.stringify({ t: 'attack_player', targetId: C.selfId, damage: 5 }));
await sleep(200);
const cAttack = C.queue.find(m => m.t === 'attack_player' && m.targetId === C.selfId);
assert('C 收到 attack_player 5', !!cAttack && cAttack.damage === 5 && cAttack.fromId === A.selfId);

// host 设时间 -> C 收到 time
A.ws.send(JSON.stringify({ t: 'set_time', time: 0.75 }));
await sleep(300);
console.log('[debug] A.queue time:', JSON.stringify(A.queue.filter(m => m.t === 'time')));
console.log('[debug] C.queue time:', JSON.stringify(C.queue.filter(m => m.t === 'time')));
assert('C 收到 time=0.75', !!C.queue.find(m => m.t === 'time' && m.time === 0.75));

// 非 host 设时间应被忽略
const before = C.queue.filter(m => m.t === 'time').length;
C.ws.send(JSON.stringify({ t: 'set_time', time: 0.1 }));
await sleep(200);
const after = C.queue.filter(m => m.t === 'time').length;
assert('非 host set_time 被忽略', before === after);

// --- 阶段 1：掉落物与拾取同步 ---
A.ws.send(JSON.stringify({ t: 'drop_spawn', x: 10, y: 70, z: 10, name: 'stone', count: 1 }));
await sleep(200);
const cDrop = C.queue.find(m => m.t === 'drop_spawn' && m.name === 'stone');
assert('C 收到 drop_spawn stone(含 id)', !!cDrop && cDrop.id > 0 && cDrop.x === 10 && cDrop.count === 1);
const dropId = cDrop.id;

// 无效 id 的 drop_taken 应被忽略（账本无此项，不广播）
C.ws.send(JSON.stringify({ t: 'drop_taken', id: 99999 }));
await sleep(150);
assert('无效 drop_taken 被忽略', !C.queue.some(m => m.t === 'drop_taken'));

// C 拾取 -> A 收到 drop_taken(by=C)
C.ws.send(JSON.stringify({ t: 'drop_taken', id: dropId }));
await sleep(200);
const aTaken = A.queue.filter(m => m.t === 'drop_taken' && m.id === dropId);
assert('A 收到 drop_taken by=C', aTaken.length === 1 && aTaken[0].by === C.selfId);

// 重复取同一 id 不再广播（账本已删除）
C.ws.send(JSON.stringify({ t: 'drop_taken', id: dropId }));
await sleep(150);
assert('重复 drop_taken 不再广播', A.queue.filter(m => m.t === 'drop_taken' && m.id === dropId).length === 1);

// 新掉落 + 新玩家 E 加入应收到掉落物回放
A.ws.send(JSON.stringify({ t: 'drop_spawn', x: 12, y: 70, z: 12, name: 'iron_ingot', count: 2 }));
await sleep(150);
const E = await connect('Eve');
E.ws.send(JSON.stringify({ t: 'join_room' }));
await sleep(250);
const eDrop = E.queue.find(m => m.t === 'drop_spawn' && m.name === 'iron_ingot');
assert('E 加入收到掉落物回放 iron_ingot', !!eDrop && eDrop.count === 2 && eDrop.id > 0);

// --- 阶段 1：玩家离开广播带 name ---
C.ws.close();
await sleep(150);
const leaveMsg = A.queue.filter(m => m.t === 'player_leave').find(m => m.id === C.selfId);
assert('A 收到 player_leave(C) 带 name', !!leaveMsg && leaveMsg.name === 'Carol');

// --- 阶段 2：怪物事件同步（host 生成 / 受击 / 死亡广播） ---
A.ws.send(JSON.stringify({ t: 'mob_spawn', type: 'zombie', x: 20, y: 70, z: 20 }));
await sleep(200);
const eMob = E.queue.find(m => m.t === 'mob_spawn' && m.type === 'zombie');
assert('E 收到 mob_spawn zombie(含 id)', !!eMob && eMob.id > 0 && eMob.x === 20);
const mobId = eMob.id;

E.ws.send(JSON.stringify({ t: 'mob_attack', id: mobId, damage: 5, x: 21, y: 70, z: 21 }));
await sleep(200);
const aAttack = A.queue.find(m => m.t === 'mob_attack' && m.id === mobId);
assert('A 收到 mob_attack 5', !!aAttack && aAttack.damage === 5 && aAttack.fromId === E.selfId);

E.ws.send(JSON.stringify({ t: 'mob_died', id: mobId }));
await sleep(200);
assert('A 收到 mob_died', !!A.queue.find(m => m.t === 'mob_died' && m.id === mobId));

// --- 阶段 2：红石源状态转发 ---
A.ws.send(JSON.stringify({ t: 'redstone_state', x: 30, y: 65, z: 30, on: true }));
await sleep(200);
const eRs = E.queue.find(m => m.t === 'redstone_state' && m.x === 30);
assert('E 收到 redstone_state on', !!eRs && eRs.on === true);

// 断开
A.ws.close(); E.ws.close();
await sleep(100);

const failCount = results.filter(r => !r[1]).length;
console.log(`---\n${results.length - failCount}/${results.length} PASS`);
process.exit(failCount ? 1 : 0);
