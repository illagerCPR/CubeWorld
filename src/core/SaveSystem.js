// SaveSystem.js -- localStorage 多槽位存档系统
const SAVE_PREFIX = 'project-mc-save-';
const LEGACY_KEY = 'project-mc-save';
const SAVE_VERSION = 1;
export const MAX_SAVE_SLOTS = 6;

export class SaveSystem {
  static save(game, slot) {
    slot = slot ?? game.currentSlot ?? 1;
    try {
      const data = {
        version: SAVE_VERSION,
        slot,
        timestamp: Date.now(),
        seed: game.world.seed,
        gamemode: game.player.gamemode,
        cheatsEnabled: game.cheatsEnabled || false,
        player: {
          x: game.player.position.x,
          y: game.player.position.y,
          z: game.player.position.z,
          yaw: game.player.yaw,
          pitch: game.player.pitch,
          health: game.player.health,
          food: game.player.food,
          saturation: game.player.saturation,
          exhaustion: game.player.exhaustion,
          xp: game.player.xp,
          xpLevel: game.player.xpLevel,
          onFire: game.player.onFire,
          airTicks: game.player.airTicks
        },
        inventory: game.inventory.serialize(),
        modifiedBlocks: Object.fromEntries(game.world.modifiedBlocks),
        redstone: game.redstone ? game.redstone.serialize() : null,
        sky: { time: game.sky.time || 0 }
      };
      localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('保存失败:', e);
      return false;
    }
  }

  static load(slot) {
    try {
      const raw = localStorage.getItem(SAVE_PREFIX + slot);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.version !== SAVE_VERSION) {
        console.warn(`存档槽 ${slot} 版本不匹配`);
        return null;
      }
      return data;
    } catch (e) {
      console.error('加载失败:', e);
      return null;
    }
  }

  static hasSave(slot) {
    return localStorage.getItem(SAVE_PREFIX + slot) !== null;
  }

  static deleteSave(slot) {
    localStorage.removeItem(SAVE_PREFIX + slot);
  }

  static listSaves() {
    SaveSystem._migrateLegacy();
    const list = [];
    for (let slot = 1; slot <= MAX_SAVE_SLOTS; slot++) {
      const raw = localStorage.getItem(SAVE_PREFIX + slot);
      if (!raw) { list.push({ slot, empty: true }); continue; }
      try {
        const data = JSON.parse(raw);
        list.push({
          slot, empty: false,
          gamemode: data.gamemode || 'creative',
          cheatsEnabled: !!data.cheatsEnabled,
          timestamp: data.timestamp || 0,
          seed: data.seed || 0
        });
      } catch {
        list.push({ slot, empty: true });
      }
    }
    return list;
  }

  static findEmptySlot() {
    const list = SaveSystem.listSaves();
    const first = list.find(s => s.empty);
    return first ? first.slot : null;
  }

  static autoSave(game) {
    return SaveSystem.save(game);
  }

  // 旧版单存档迁移到槽位 1
  static _migrateLegacy() {
    if (SaveSystem._migrated) return;
    SaveSystem._migrated = true;
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      if (localStorage.getItem(SAVE_PREFIX + '1')) return;
      localStorage.setItem(SAVE_PREFIX + '1', raw);
      localStorage.removeItem(LEGACY_KEY);
      console.log('已迁移旧版存档到槽位 1');
    } catch { /* ignore */ }
  }
}