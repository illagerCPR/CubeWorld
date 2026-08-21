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
};
