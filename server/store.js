// store.js -- 房间世界落盘：server/world/<房间名>.json 读写
// 服务器重启后从磁盘恢复各房间（方块账本/掉落物/种子/时间/计数器），实现"重启不丢世界"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'world');

// 房间名 -> 安全文件名（中文/字母/数字/连字符保留，其余替换为 _，空名回退 default）
export function roomFileName(name) {
  const s = String(name || '').trim() || 'default';
  return s.replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 40);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// 将房间世界写入磁盘 <dir>/<房间名>.json
// 快照 V2（M4）：blocks/containers 按维度分桶 {dim: [entries]}；旧格式由 Room.restore 迁移
export function saveRoom(room, dir = DEFAULT_DIR) {
  ensureDir(dir);
  const dimensionBlocks = {};
  for (const [dim, m] of room.dimensionBlocks) dimensionBlocks[dim] = [...m.entries()];
  const dimensionContainers = {};
  for (const [dim, m] of room.dimensionContainers) dimensionContainers[dim] = [...m.entries()];
  const data = {
    name: room.name,
    seed: room.seed,
    biomeScale: room.biomeScale || null, // 群系规模档位（旧快照无字段 → restore 回落 null→small）
    time: room.time,
    nextDropId: room.nextDropId,
    nextMobId: room.nextMobId,
    dimensionBlocks,
    dimensionContainers,
    drops: [...room.drops.entries()].map(([id, d]) => ({ id, ...d })),
    savedAt: Date.now(),
  };
  fs.writeFileSync(path.join(dir, roomFileName(room.name) + '.json'), JSON.stringify(data, null, 2), 'utf8');
}

// 读取磁盘上全部房间快照（原始对象数组，恢复逻辑在 Room.restore）
export function loadRooms(dir = DEFAULT_DIR) {
  const rooms = [];
  if (!fs.existsSync(dir)) return rooms;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (data && typeof data.name === 'string' && Number.isInteger(data.seed)) rooms.push(data);
    } catch (e) {
      console.error(`[世界] 读取 ${f} 失败: ${e.message}`);
    }
  }
  return rooms;
}

// 删除某房间的世界存档（供测试/管理使用）
export function deleteRoomFile(name, dir = DEFAULT_DIR) {
  try { fs.unlinkSync(path.join(dir, roomFileName(name) + '.json')); } catch {}
}

// ---- Idea-3C：玩家档案（server/world/players/<房间名>.players.json）----
// 独立目录存储：档案高频写（每 10s 脏刷新 + 退房即写），与房间世界快照分离避免写放大。
// 结构：{ 昵称: { inventory, position, dim, health, food, saturation, xp, xpLevel, savedAt } }

export function loadPlayerProfiles(roomName, dir = DEFAULT_DIR) {
  const file = path.join(dir, 'players', roomFileName(roomName) + '.players.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {}; // 不存在/损坏 → 空档案（首次进房即建档）
  }
}

export function savePlayerProfiles(roomName, profiles, dir = DEFAULT_DIR) {
  const playersDir = path.join(dir, 'players');
  if (!fs.existsSync(playersDir)) fs.mkdirSync(playersDir, { recursive: true });
  const file = path.join(playersDir, roomFileName(roomName) + '.players.json');
  fs.writeFileSync(file, JSON.stringify(profiles, null, 2), 'utf8');
}

export function deletePlayerProfiles(roomName, dir = DEFAULT_DIR) {
  try { fs.unlinkSync(path.join(dir, 'players', roomFileName(roomName) + '.players.json')); } catch {}
}
