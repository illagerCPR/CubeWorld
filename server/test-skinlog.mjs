// test-skinlog.mjs -- Build 22 ④：皮肤代理拉取写管理日志（面板"操作日志"可见）
// 覆盖：非法格式 400 出口即记日志、detail 带 IP/用户名/结果码、逐次拉取逐条记录。
// 用法：node server/test-skinlog.mjs（先启动 server/index.mjs，端口 3001）
// 不访问外网：用非法格式用户名走 400 快速失败出口验证日志链路；Mojang 三跳链路由浏览器冒烟覆盖。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'http://127.0.0.1:3001/api';
const SKIN = 'http://127.0.0.1:3001/api/skin/';

// 跑批中前序套件可能开启鉴权（config.json 持久化）——带未过期 op 账号
const cfgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json');
let opToken = null;
try {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const accs = Array.isArray(cfg.adminAccounts) ? cfg.adminAccounts : [];
  const live = accs.filter((a) => !a.expires || Date.now() / 1000 < a.expires);
  opToken = (live.find((a) => a.role !== 'viewer') || live[0] || {}).token || null;
} catch { /* 无 config = 未开鉴权 */ }

const api = async (p) => {
  const res = await fetch(API + p, {
    headers: opToken ? { Authorization: `Bearer ${opToken}` } : {},
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

let failed = 0;
function assert(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed = 1;
}

// 1. 非法格式用户名（2 位）→ 400，代理出口即拒
const bad = await fetch(SKIN + 'xx');
assert('非法格式用户名返回 400', bad.status === 400);

// 2. 管理日志含 skin-fetch 条目：带用户名 + 结果码
const logs = await api('/logs');
assert('/api/logs 200', logs.status === 200);
const entry = (logs.data.logs || []).find((l) => l.op === 'skin-fetch' && l.detail.includes('"xx"'));
assert('日志含 skin-fetch 条目（用户名 "xx"）', !!entry);
assert('日志 detail 带结果码 400', !!entry && entry.detail.includes('400'));
assert('日志 detail 带来源 IP', !!entry && /127\.0\.0\.1/.test(entry.detail));

// 3. 逐次拉取逐条记录（第二次拉取再记一条，共 2 条）
await fetch(SKIN + 'xx');
const logs2 = await api('/logs');
const hits = (logs2.data.logs || []).filter((l) => l.op === 'skin-fetch' && l.detail.includes('"xx"'));
assert('每次拉取各记一条日志（共 2 条）', hits.length === 2);

process.exit(failed);
