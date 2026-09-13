// ui/itemName.js -- 方块/物品显示名统一出口（Build 5 i18n）
// 原 Hotbar/InventoryScreen/ChestScreen/FurnaceScreen/TradeScreen/RecipeViewer 各持一份
// getDisplayName 副本，此处收敛为单实现并接入三语（tName：简体用注册名，繁/英查 names.js）。
import { BlockRegistry } from '../core/BlockRegistry.js';
import { ItemRegistry } from '../core/ItemRegistry.js';
import { tName } from '../i18n/name.js';

export function getDisplayName(name) {
  const item = ItemRegistry.getByName(name);
  if (item && item.displayName && item.displayName !== name) return tName(name, item.displayName);
  const block = BlockRegistry.getByName(name);
  if (block && block.displayName && block.displayName !== name) return tName(name, block.displayName);
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
