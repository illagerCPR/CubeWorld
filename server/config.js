// config.js -- 服务器配置：默认参数 + 磁盘持久化（server/config.json，管理面板可改，重启保留）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json');

// 默认配置（字段说明见 README / 管理面板）
const DEFAULTS = {
  dropTtlMs: 300000,     // 掉落物过期毫秒（默认 5 分钟）
  heartbeatMs: 15000,    // 心跳间隔毫秒（超过该时间未收到 pong 视为掉线）
  maxPlayersPerRoom: 10, // 单个房间最大玩家数（超出拒绝加入）
  adminToken: '',        // 管理面板口令（阶段5）：空=不鉴权（局域网信任），非空=API 需 Bearer 口令
};

// 数字配置的合法范围（防止管理面板提交脏值）
const RANGES = {
  dropTtlMs: [1000, 3600000],       // 1s ~ 1h
  heartbeatMs: [2000, 60000],       // 2s ~ 60s
  maxPlayersPerRoom: [1, 64],       // 1 ~ 64
};

// 字符串配置的最大长度（如管理口令）
const STRING_MAX = { adminToken: 64 };

// 读取磁盘配置，缺失/非法字段回退默认值
export function loadConfig() {
  const cfg = { ...DEFAULTS };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      for (const key of Object.keys(DEFAULTS)) {
        if (key in STRING_MAX) {
          if (typeof data[key] === 'string' && data[key].length <= STRING_MAX[key]) cfg[key] = data[key];
          continue;
        }
        const range = RANGES[key];
        const n = Number(data[key]);
        if (Number.isFinite(n) && n >= range[0] && n <= range[1]) cfg[key] = Math.round(n);
      }
    }
  } catch (e) {
    console.error(`[配置] 读取 ${CONFIG_PATH} 失败: ${e.message}`);
  }
  return cfg;
}

// 校验并合并一份新配置（非法字段忽略），返回更新后的配置
export function applyConfig(current, patch) {
  const next = { ...current };
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in patch)) continue;
    if (key in STRING_MAX) {
      if (typeof patch[key] === 'string' && patch[key].length <= STRING_MAX[key]) next[key] = patch[key];
      continue;
    }
    const range = RANGES[key];
    const n = Number(patch[key]);
    if (Number.isFinite(n) && n >= range[0] && n <= range[1]) next[key] = Math.round(n);
  }
  return next;
}

export function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8'); } catch (e) {
    console.error(`[配置] 写入 ${CONFIG_PATH} 失败: ${e.message}`);
  }
}
