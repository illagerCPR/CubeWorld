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
export function saveRoom(room, dir = DEFAULT_DIR) {
  ensureDir(dir);
  const data = {
    name: room.name,
    seed: room.seed,
    time: room.time,
    nextDropId: room.nextDropId,
    nextMobId: room.nextMobId,
    blocks: [...room.blocks.entries()],
    drops: [...room.drops.entries()].map(([id, d]) => ({ id, ...d })),
    containers: room.containers ? [...room.containers.entries()] : [],
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
