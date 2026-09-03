import { Game } from './player/Game.js';
import { BlockRegistry } from './core/BlockRegistry.js';
import { ItemRegistry } from './core/ItemRegistry.js';
import { SaveSystem } from './core/SaveSystem.js';
import { MenuScreen } from './ui/MenuScreen.js';
import { NetworkManager } from './net/NetworkManager.js';
import { Panorama } from './render/Panorama.js';
import { VideoSettings } from './ui/VideoSettings.js';

const app = document.getElementById('app');
const game = new Game(app);

// 视频设置面板（ESC 暂停菜单与主菜单共用的单例）
const videoSettings = new VideoSettings(game);
game.videoSettings = videoSettings;

// 主菜单全景背景（原版 MC 风格：固定种子小世界 + 慢速旋转 + 画布模糊）
const panorama = new Panorama(game);

// 局域网联机网络层
const net = new NetworkManager(game);
game.net = net;

// 主菜单
const menu = new MenuScreen((mode, seed, loadData, slot, cheatsEnabled) => {
  if (game.running) game.returnToMenu(false);
  menu.hide();
  game.start(mode, seed, loadData, slot, cheatsEnabled);
}, net);

// 菜单显隐联动全景启停（game.running 期间全景循环自身也会早退）
menu.onHide = () => panorama.setActive(false);
menu.onShow = () => panorama.setActive(true);
menu.videoSettings = videoSettings; // 主菜单"视频设置"入口
window.panorama = panorama; // 调试暴露

game.onExit = () => {
  menu.show();
};

// 联机：收到世界信息后用服务器 seed 启动本地世界（msg.room 用于房间展示）
net.on('world_info', async ({ seed, mode, time, room }) => {
  net.room = room || net.room || 'default';
  menu.hide();
  await game.start(mode, seed, null, 0, false, true);
  game.sky.time = time;
  net.onWorldStarted();
  net.sendPlayerFull();
});

// 阶段5：世界内换房 / 重建世界 —— 保持连接，用新 seed 重启本地世界（不回主菜单）
net.on('restart_world', async ({ seed, mode, time, room }) => {
  net.room = room || net.room || 'default';
  await game.start(mode, seed, null, 0, false, true);
  game.sky.time = time;
  net.onWorldStarted();
  net.sendPlayerFull();
});

// 联机连接状态提示
net.onStatusChange = (status, text) => {
  menu.setMpStatus(text, status === 'connected' ? '#6f6' : (status === 'reconnecting' ? '#fa0' : '#f88'));
  console.log('[联机]', status, text);
  if (status === 'closed' && game.networkMode) {
    alert('与服务器断开连接，返回主菜单');
    game.returnToMenu(false);
  }
};

// 暴露到 window 便于调试
window.game = game;
window.BlockRegistry = BlockRegistry;
window.ItemRegistry = ItemRegistry;
window.SaveSystem = SaveSystem;
window.net = net;
