// config.js -- 服务器配置：默认参数 + 磁盘持久化（server/config.json，管理面板可改，重启保留）
// 阶段10：管理鉴权升级为多账号 adminAccounts [{token,label,expires}]；
//         旧字段 adminToken/adminTokenExpires 保留为兼容接口（等价于 label='default' 的账号）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json');

// 默认配置（字段说明见 README / 管理面板）
const DEFAULTS = {
  dropTtlMs: 300000,     // 掉落物过期毫秒（默认 5 分钟）
  heartbeatMs: 15000,    // 心跳间隔毫秒（超过该时间未收到 pong 视为掉线）
  maxPlayersPerRoom: 10, // 单个房间最大玩家数（超出拒绝加入）
  adminToken: '',        // 兼容接口：等价于 default 账号（空=无 default 账号；全部账号为空时=不鉴权）
  adminTokenExpires: 0,  // 兼容接口：default 账号过期时间（Unix 秒，0=永不过期）
  adminAccounts: [],     // 阶段10：管理账号列表 [{token,label,expires}]；空数组=不鉴权（局域网信任）
};

// 数字配置的合法范围（防止管理面板提交脏值）
const RANGES = {
  dropTtlMs: [1000, 3600000],       // 1s ~ 1h
  heartbeatMs: [2000, 60000],       // 2s ~ 60s
  maxPlayersPerRoom: [1, 64],       // 1 ~ 64
  adminTokenExpires: [0, 4102444800], // Unix 秒，0=永不过期 ~ 2100 年
};

// 字符串配置的最大长度（如管理口令）
const STRING_MAX = { adminToken: 64 };

// 校验管理账号数组（阶段10）：≤10 项，每项 {token 1..64, label ≤24, expires 0..2100年}；非法整体丢弃
export function sanitizeAccounts(raw) {
  if (!Array.isArray(raw) || raw.length > 10) return null;
  const out = [];
  for (const a of raw) {
    if (!a || typeof a.token !== 'string' || a.token.length === 0 || a.token.length > 64) return null;
    const label = typeof a.label === 'string' ? a.label.slice(0, 24) : '';
    const n = Number(a.expires);
    const expires = Number.isFinite(n) && n >= 0 && n <= 4102444800 ? Math.round(n) : 0;
    out.push({ token: a.token, label, expires });
  }
  return out;
}

// 找 default 兼容账号（旧 adminToken 等价物）
function findDefaultAccount(accounts) {
  return accounts.find((a) => a.label === 'default') || null;
}

// 读取磁盘配置，缺失/非法字段回退默认值；旧配置（仅 adminToken）自动迁移为 default 账号
export function loadConfig() {
  const cfg = { ...DEFAULTS, adminAccounts: [] };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      for (const key of ['dropTtlMs', 'heartbeatMs', 'maxPlayersPerRoom', 'adminTokenExpires']) {
        const range = RANGES[key];
        const n = Number(data[key]);
        if (Number.isFinite(n) && n >= range[0] && n <= range[1]) cfg[key] = Math.round(n);
      }
      if (typeof data.adminToken === 'string' && data.adminToken.length <= STRING_MAX.adminToken) cfg.adminToken = data.adminToken;
      const accounts = sanitizeAccounts(data.adminAccounts);
      if (accounts) {
        cfg.adminAccounts = accounts;
      } else if (cfg.adminToken) {
        // 旧版配置迁移：adminToken 非空 → default 账号（沿用 adminTokenExpires）
        cfg.adminAccounts = [{ token: cfg.adminToken, label: 'default', expires: cfg.adminTokenExpires }];
      }
    }
  } catch (e) {
    console.error(`[配置] 读取 ${CONFIG_PATH} 失败: ${e.message}`);
  }
  return cfg;
}

// 校验并合并一份新配置（非法字段忽略），返回更新后的配置
// adminAccounts 为主接口；旧字段 adminToken/adminTokenExpires 作为 default 账号的兼容读写
export function applyConfig(current, patch) {
  const next = { ...current, adminAccounts: [...(current.adminAccounts || [])] };
  for (const key of ['dropTtlMs', 'heartbeatMs', 'maxPlayersPerRoom', 'adminTokenExpires']) {
    if (!(key in patch)) continue;
    const range = RANGES[key];
    const n = Number(patch[key]);
    if (Number.isFinite(n) && n >= range[0] && n <= range[1]) next[key] = Math.round(n);
  }
  if ('adminToken' in patch) {
    if (typeof patch.adminToken === 'string' && patch.adminToken.length <= STRING_MAX.adminToken) next.adminToken = patch.adminToken;
  }
  // 主接口：整体替换账号列表（非法丢弃）
  if ('adminAccounts' in patch) {
    const accounts = sanitizeAccounts(patch.adminAccounts);
    if (accounts) next.adminAccounts = accounts;
  }
  // 兼容语义：adminToken 变更同步到 default 账号（空=移除 default 账号；其余账号不受影响）
  if ('adminToken' in patch) {
    const def = findDefaultAccount(next.adminAccounts);
    if (next.adminToken) {
      if (def) def.token = next.adminToken;
      else next.adminAccounts.push({ token: next.adminToken, label: 'default', expires: next.adminTokenExpires });
    } else if (def) {
      next.adminAccounts = next.adminAccounts.filter((a) => a !== def);
    }
  }
  // 兼容语义：adminTokenExpires 变更只作用于 default 账号
  if ('adminTokenExpires' in patch) {
    const def = findDefaultAccount(next.adminAccounts);
    if (def) def.expires = next.adminTokenExpires;
  }
  // 回写兼容字段（default 账号优先）
  const def = findDefaultAccount(next.adminAccounts);
  next.adminToken = def ? def.token : '';
  next.adminTokenExpires = def ? def.expires : 0;
  return next;
}

export function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8'); } catch (e) {
    console.error(`[配置] 写入 ${CONFIG_PATH} 失败: ${e.message}`);
  }
}
