// protocol.js -- 局域网联机消息类型常量（纯常量，客户端浏览器与服务器共用）
// 消息统一为 { t: '<type>', ...fields }，JSON over WebSocket

export const MSG = {
  // 握手与房间
  HELLO: 'hello',
  WELCOME: 'welcome',
  CREATE_ROOM: 'create_room',
  JOIN_ROOM: 'join_room',
  LEAVE_ROOM: 'leave_room',
  SWITCH_ROOM: 'switch_room',   // 阶段5：世界内直接换房（无需回主菜单）
  WORLD_RESET: 'world_reset',   // 阶段5：重建当前房间世界（仅 host）

  // 维度（M4：联机维度同步；迭代 M2：switch_dimension/dimension_world 携带可选 pos={x,z,portal} 传送门落点）
  SWITCH_DIMENSION: 'switch_dimension',   // C2S {dim, pos?}：请求切换维度（pos=传送门落点，原样回传本人）
  PLAYER_DIMENSION: 'player_dimension',   // S2C {id, dim, name, pos}：玩家维度变更广播
  DIMENSION_WORLD: 'dimension_world',     // S2C {dim, blocks, containers, pos?}：目标维度账本下发（换维者本地世界收敛用）
  ROOM_CREATED: 'room_created',
  WORLD_INFO: 'world_info',
  PLAYER_JOIN: 'player_join',
  PLAYER_LEAVE: 'player_leave',

  // 方块
  BLOCK_SET: 'block_set',
  BLOCK_CHANGE: 'block_change',

  // 容器（T5：箱子内容整箱同步；服务器账本持久化 + 新加入者回放）
  CONTAINER_SET: 'container_set',

  // 掉落物（阶段 1）；阶段 10：DROP_DENY = 拾取被归属锁拒绝（死亡掉落物归属期内他人拾取）
  DROP_SPAWN: 'drop_spawn',
  DROP_TAKEN: 'drop_taken',
  DROP_DENY: 'drop_deny',

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
