// test-idea2.mjs -- Idea-2B 服务器回归：箭矢事件同步（arrow_shot 转发 / 无回声 / 脏包丢弃）
// 用法：node server/test-idea2.mjs   （先启动 server/index.mjs，端口 3001；跑批前清空 server/world/ 与 server/config.json）
import { WebSocket } from 'ws';

const URL = 'ws://127.0.0.1:3001/ws';
const results = [];

function assert(name, cond, extra = '') {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const p = { ws, id: null, inbox: [], waiters: [], closed: false };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      p.inbox.push(m);
      for (let i = p.waiters.length - 1; i >= 0; i--) {
        if (p.waiters[i](m)) p.waiters.splice(i, 1);
      }
    });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name, version: '0.1' })));
    ws.on('message', function h(raw) {
      const m = JSON.parse(raw.toString());
      if (m.t === 'welcome') {
        ws.off('message', h);
        p.id = m.selfId;
        resolve(p);
      }
    });
    ws.on('error', reject);
    ws.on('close', () => { p.closed = true; });
  });
}

const send = (p, t, d = {}) => p.ws.send(JSON.stringify({ t, ...d }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(p, pred, timeout = 3000) {
  return new Promise((resolve) => {
    const hit = p.inbox.find(pred);
    if (hit) return resolve(hit);
    const t = setTimeout(() => resolve(null), timeout);
    p.waiters.push((m) => { if (pred(m)) { clearTimeout(t); resolve(m); return true; } return false; });
  });
}

// --- 用例：箭矢事件转发 ---
{
  const room = `i2-arrow-${Date.now()}`;
  const a = await connect('i2-甲');
  const b = await connect('i2-乙');

  send(a, 'create_room', { room, seed: 20260912, mode: 'survival' });
  const wa = await waitFor(a, (m) => m.t === 'room_created');
  assert('甲建房', !!wa);

  send(b, 'join_room', { room });
  const wb = await waitFor(b, (m) => m.t === 'welcome');
  assert('乙入房', !!wb);
  await sleep(200);
  b.inbox.length = 0; a.inbox.length = 0;

  // 甲射箭 → 乙收到初速；甲无回声
  const shot = { x: 1.5, y: 70.25, z: -3.75, dx: 19.6, dy: -2.8, dz: 0 };
  send(a, 'arrow_shot', shot);
  const got = await waitFor(b, (m) => m.t === 'arrow_shot');
  assert('乙收到 arrow_shot', !!got);
  assert('初速字段一致', !!got && Math.abs(got.x - shot.x) < 1e-6 && Math.abs(got.dx - shot.dx) < 1e-6 && Math.abs(got.dz - shot.dz) < 1e-6,
    got ? `x=${got.x} dx=${got.dx}` : '');
  assert('携带射者 id', !!got && got.id === a.id, got ? `id=${got.id}` : '');
  await sleep(300);
  assert('甲不收自己的箭（无回声）', !a.inbox.some((m) => m.t === 'arrow_shot'));

  // 脏包：非有限数值 → 服务器丢弃，乙不应收到
  b.inbox.length = 0;
  send(a, 'arrow_shot', { x: 'abc', y: 70, z: 0, dx: 1, dy: 1, dz: 1 });
  send(a, 'arrow_shot', { x: 1, y: 70, z: 0 });
  send(a, 'arrow_shot', { x: NaN, y: 70, z: 0, dx: 1, dy: 1, dz: 1 });
  await sleep(400);
  assert('脏包被服务器丢弃', !b.inbox.some((m) => m.t === 'arrow_shot'));

  a.ws.close(); b.ws.close();
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\nIdea-2 回归：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) { console.log('失败项：'); for (const [name] of failed) console.log('  - ' + name); process.exit(1); }
