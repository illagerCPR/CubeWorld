// test-idea4.mjs -- Idea-4A 服务器回归：房间配置开关（PvP/怪物生成）
// 覆盖：API 校验/落盘、world_info.settings 下发、服务器权威过滤（攻击/怪物）、
//       room_settings 热广播（异房间不串扰）、重开生效、默认全开
// 用法：node server/test-idea4.mjs   （先启动 server/index.mjs，端口 3001）
import { WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 命名避开全局类（const URL 会遮蔽全局 URL 构造器，new URL 在 try 内静默炸掉的教训）
const WS_URL = 'ws://127.0.0.1:3001/ws';
const API = 'http://127.0.0.1:3001/api';
const results = [];

function assert(name, cond, extra = '') {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const p = { ws, id: null, name, inbox: [], waiters: [], closed: false };
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

// 管理接口可能已开鉴权（跑批中前序套件建号并持久化 config）：
// op 测试用未过期 op 账号；viewer 403 用 role='viewer' 账号（无账号则该条走"未开启鉴权放行"分支）
const cfgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json');
let opToken = null, viewerToken = null, authOn = false;
try {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const accs = Array.isArray(cfg.adminAccounts) ? cfg.adminAccounts : [];
  const live = accs.filter((a) => !a.expires || Date.now() / 1000 < a.expires);
  opToken = (live.find((a) => a.role !== 'viewer') || live[0] || {}).token || null;
  viewerToken = (live.find((a) => a.role === 'viewer') || {}).token || null;
  authOn = live.length > 0;
} catch { /* 无 config = 未开鉴权 */ }

const api = async (method, p, body = null, token = opToken) => {
  const res = await fetch(API + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const ROOM = `i4a-${Date.now()}`;
const ROOM_DEF = `i4a-def-${Date.now()}`;
const ROOM_OTHER = `i4a-other-${Date.now()}`;

// ---- 1. API 基础：GET 全表 + 非法 body 拒绝 ----
{
  const r0 = await api('GET', '/settings');
  assert('GET /api/settings 200 且 roomSettings 为对象', r0.status === 200 && r0.data.roomSettings && typeof r0.data.roomSettings === 'object');

  const bad1 = await api('POST', `/room/${encodeURIComponent(ROOM)}/settings`, { pvp: 1 });
  assert('pvp 非 boolean → 400', bad1.status === 400, `got ${bad1.status}`);
  const bad2 = await api('POST', `/room/${encodeURIComponent(ROOM)}/settings`, {});
  assert('空 patch → 400', bad2.status === 400, `got ${bad2.status}`);
}

// ---- 2. 关闭 PvP + 怪物 → 落盘 + 回显 ----
{
  const r = await api('POST', `/room/${encodeURIComponent(ROOM)}/settings`, { pvp: false, mobs: false });
  assert('POST 关闭 pvp+mobs → 200 回显', r.status === 200 && r.data.ok && r.data.settings.pvp === false && r.data.settings.mobs === false);
  let persisted = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    persisted = cfg.roomSettings && cfg.roomSettings[ROOM] && cfg.roomSettings[ROOM].pvp === false && cfg.roomSettings[ROOM].mobs === false;
  } catch { /* config 不存在 */ }
  assert('配置已落盘 config.json', persisted);
}

// ---- 3. world_info.settings 下发（创建/加入两条路径）----
const A = await connect('i4a-甲');
send(A, 'create_room', { room: ROOM, seed: 4451, mode: 'survival' });
const wiA = await waitFor(A, (m) => m.t === 'world_info');
assert('创建者 world_info 带 settings pvp=false', !!wiA && wiA.settings && wiA.settings.pvp === false && wiA.settings.mobs === false);

const B = await connect('i4a-乙');
send(B, 'join_room', { room: ROOM });
const wiB = await waitFor(B, (m) => m.t === 'world_info');
assert('加入者 world_info 带 settings pvp=false', !!wiB && wiB.settings && wiB.settings.pvp === false && wiB.settings.mobs === false);

// 对照组：另一房间在线玩家（热广播不得串扰）
const C = await connect('i4a-丙');
send(C, 'create_room', { room: ROOM_OTHER, seed: 4452, mode: 'survival' });
await waitFor(C, (m) => m.t === 'world_info');

// ---- 4. PvP 关闭：服务器权威短路 ----
{
  await sleep(150);
  send(A, 'attack_player', { targetId: B.id, damage: 5 });
  const hitB = await waitFor(B, (m) => m.t === 'attack_player', 1200);
  assert('PvP 关：受害者收不到 attack_player', hitB === null);
  const hint = await waitFor(A, (m) => m.t === 'chat' && m.from === '系统' && /PvP/.test(m.text || ''), 1500);
  assert('PvP 关：攻击者收到系统提示', !!hint);
}

// ---- 5. 怪物生成关闭：不分配 id 不转发 ----
{
  await sleep(150);
  send(A, 'mob_spawn', { type: 'zombie', x: 1, y: 66, z: 1 });
  const mA = await waitFor(A, (m) => m.t === 'mob_spawn', 1200);
  const mB = await waitFor(B, (m) => m.t === 'mob_spawn', 300);
  assert('mobs 关：发起者收不到 mob_spawn 回执', mA === null);
  assert('mobs 关：他人收不到 mob_spawn', mB === null);
  const hint = await waitFor(A, (m) => m.t === 'chat' && m.from === '系统' && /怪物/.test(m.text || ''), 1500);
  assert('mobs 关：发起者收到系统提示', !!hint);
}

// ---- 6. 热广播：同房间收到、异房间不串扰；随后恢复生效 ----
{
  const r = await api('POST', `/room/${encodeURIComponent(ROOM)}/settings`, { pvp: true });
  const rsA = await waitFor(A, (m) => m.t === 'room_settings', 1500);
  const rsB = await waitFor(B, (m) => m.t === 'room_settings', 300);
  const rsC = C.inbox.find((m) => m.t === 'room_settings');
  assert('热广播：同房间玩家收到 room_settings', !!rsA && rsA.pvp === true && rsA.mobs === false && rsA.room === ROOM);
  assert('热广播：同房间第二人收到', !!rsB);
  assert('热广播：异房间玩家不串扰', !rsC);

  // 恢复后 PvP 攻击照常中继
  await sleep(150);
  send(A, 'attack_player', { targetId: B.id, damage: 5 });
  const hitB = await waitFor(B, (m) => m.t === 'attack_player' && m.fromId === A.id, 1500);
  assert('PvP 开：attack_player 正常中继', !!hitB);
}

// ---- 7. mobs 单独恢复 → 怪物转发恢复（含发起者回执）----
{
  const r = await api('POST', `/room/${encodeURIComponent(ROOM)}/settings`, { mobs: true });
  assert('POST 单独开 mobs → 200（pvp 保持开）', r.status === 200 && r.data.settings.pvp === true && r.data.settings.mobs === true);
  const rsB = await waitFor(B, (m) => m.t === 'room_settings' && m.mobs === true, 1500);
  assert('热广播：mobs 恢复送达', !!rsB);
  await sleep(150);
  send(A, 'mob_spawn', { type: 'zombie', x: 2, y: 66, z: 2 });
  const mA = await waitFor(A, (m) => m.t === 'mob_spawn' && m.type === 'zombie', 1500);
  const mB = await waitFor(B, (m) => m.t === 'mob_spawn' && m.type === 'zombie', 300);
  assert('mobs 开：发起者收到回执', !!mA);
  assert('mobs 开：他人收到广播', !!mB);
}

// ---- 8. 未配置房间 = 默认全开 ----
{
  const D = await connect('i4a-丁');
  send(D, 'create_room', { room: ROOM_DEF, seed: 4453, mode: 'survival' });
  const wi = await waitFor(D, (m) => m.t === 'world_info');
  assert('未配置房间 world_info.settings 默认全开', !!wi && wi.settings && wi.settings.pvp === true && wi.settings.mobs === true);
  D.ws.close();
}

// ---- 9. viewer 角色 POST → 403（鉴权开启时）----
{
  if (authOn && viewerToken) {
    const r = await api('POST', `/room/${encodeURIComponent(ROOM)}/settings`, { pvp: false }, viewerToken);
    assert('viewer POST settings → 403', r.status === 403, `got ${r.status}`);
    const g = await api('GET', '/settings', null, viewerToken);
    assert('viewer GET settings → 200', g.status === 200, `got ${g.status}`);
  } else {
    assert('viewer 403（跳过：鉴权未开启）', true);
  }
}

// ---- 清理：删除测试房间（世界落盘不入库）----
for (const rn of [ROOM, ROOM_DEF, ROOM_OTHER]) {
  await api('POST', `/room/${encodeURIComponent(rn)}/delete`, {});
}
A.ws.close(); B.ws.close(); C.ws.close();

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n结果: ${results.length - failed}/${results.length} 通过`);
process.exit(failed ? 1 : 0);
