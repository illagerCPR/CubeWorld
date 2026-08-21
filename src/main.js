import { Game } from './player/Game.js';
import { BlockRegistry } from './core/BlockRegistry.js';
import { ItemRegistry } from './core/ItemRegistry.js';
import { SaveSystem } from './core/SaveSystem.js';

const app = document.getElementById('app');
const game = new Game(app);

// 主菜单
import { MenuScreen } from './ui/MenuScreen.js';
const menu = new MenuScreen((mode, seed, loadData, slot, cheatsEnabled) => {
  if (game.running) game.returnToMenu(false);
  menu.hide();
  game.start(mode, seed, loadData, slot, cheatsEnabled);
});

game.onExit = () => {
  menu.show();
};

// 暴露到 window 便于调试
window.game = game;
window.BlockRegistry = BlockRegistry;
window.ItemRegistry = ItemRegistry;
window.SaveSystem = SaveSystem;
