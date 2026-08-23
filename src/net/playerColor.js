// playerColor.js -- 由玩家 id 派生稳定颜色（昵称/聊天区分不同玩家）
// 同一 id 在任何端颜色一致；id=0 用于服务器系统消息
const HUES = [210, 120, 300, 20, 40, 170, 0, 90, 260, 60, 330, 150, 30, 200, 280, 190];

export function playerColorHue(id) {
  const n = Math.abs(Number(id) || 0);
  return HUES[n % HUES.length];
}

// CSS 颜色字符串（用于昵称标签 / 聊天消息 / 系统进出提示）
export function playerColorCss(id) {
  return `hsl(${playerColorHue(id)},70%,62%)`;
}
