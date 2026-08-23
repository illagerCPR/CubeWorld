// protocol.js -- 局域网联机消息类型常量（纯常量，客户端浏览器与服务器共用）
// 消息统一为 { t: '<type>', ...fields }，JSON over WebSocket

export const MSG = {
  // 握手与房间
  HELLO: 'hello',
  WELCOME: 'welcome',
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  ROOM_CREATED: 'room_created',
  WORLD_INFO: 'world_info',
  PLAYER_JOIN: 'player_join',
  PLAYER_LEAVE: 'player_leave',

  // 方块
  BLOCK_SET: 'block_set',
  BLOCK_CHANGE: 'block_change',

  // 掉落物（阶段 1）
  DROP_SPAWN: 'drop_spawn',
  DROP_TAKEN: 'drop_taken',

  // 怪物（阶段 2，事件同步：生成/受击/死亡广播）
  MOB_SPAWN: 'mob_spawn',
  MOB_ATTACK: 'mob_attack',
  MOB_DIED: 'mob_died',

  // 红石源状态（阶段 2，低频缓解：lever/button 状态广播）
  REDSTONE_STATE: 'redstone_state',

  // 玩家
  PLAYER_STATE: 'player_state',
  PLAYER_FULL: 'player_full',
  ATTACK_PLAYER: 'attack_player',
  PLAYER_DIED: 'player_died',
  RESPAWN: 'respawn',
  GAMEMODE: 'gamemode',

  // 世界
  SET_TIME: 'set_time',
  TIME: 'time',

  // 聊天与心跳
  CHAT: 'chat',
  PING: 'ping',
  PONG: 'pong',

  // 服务器管理（阶段 4）：踢出玩家（客户端停止自动重连）
  KICKED: 'kicked',
};
