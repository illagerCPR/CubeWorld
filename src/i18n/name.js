// i18n/name.js -- 方块/物品/怪物显示名多语言出口（Build 5 i18n / Build 6 扩 7 语）
// NAME_I18N（names.js）按注册名给 [zh-CN, zh-TW, en, fr, de, ja, ko] 七列；
// 简体直接用注册侧 displayName（BlockCN/ItemCN/MobTypes 兜底），其余语言查表缺项回落。
import { getLocale } from './index.js';
import { NAME_I18N } from './names.js';

const LANG_IDX = { 'zh-CN': 0, 'zh-TW': 1, 'en': 2, 'fr': 3, 'de': 4, 'ja': 5, 'ko': 6 };

// 按注册名取当前语言显示名；fallback 传注册侧简体名
export function tName(name, fallback) {
  const idx = LANG_IDX[getLocale()] ?? 0;
  if (idx === 0) return fallback;
  const e = NAME_I18N[name];
  return (e && e[idx]) || fallback;
}
