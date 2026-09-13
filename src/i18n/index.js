// i18n/index.js -- 本地化核心（Build 5）
// t() 以简体中文原文为键：zh-CN 直接返回原文（零字典）；zh-TW / en 查语言包，缺项回落原文。
// 语言选择持久化在 Settings.language（VideoSettings 下拉切换，即选即存）。
import { zhTW } from './locales/zh-TW.js';
import { en } from './locales/en.js';

// 语言清单（顺序即 VideoSettings 下拉顺序；label 各用本语言自称）
export const LOCALES = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'en', label: 'English' },
];

const PACKS = { 'zh-TW': zhTW, 'en': en };

let locale = 'zh-CN';
const changeListeners = new Set();

// 启动时由 Settings.language 调用；非法值忽略保持 zh-CN（不触发监听器）
export function initLocale(id) {
  if (id === 'zh-CN' || PACKS[id]) locale = id;
}

// 用户切换语言（VideoSettings 语言行）：更新并通知各常驻 UI 重绘文本
export function setLocale(id) {
  if (id !== 'zh-CN' && !PACKS[id]) return;
  if (locale === id) return;
  locale = id;
  for (const cb of changeListeners) {
    try { cb(); } catch { /* 单个界面刷新失败不阻断其它界面 */ }
  }
}

// 注册语言切换监听（返回解绑函数）；常驻 UI（主菜单/暂停菜单/死亡屏）用
export function onLocaleChange(cb) {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

export function getLocale() {
  return locale;
}

// 取某语言的界面自称（VideoSettings 行文本用）
export function localeLabel(id) {
  const l = LOCALES.find(x => x.id === id);
  return l ? l.label : id;
}

// 翻译：查当前语言包 → 回落键本身（简体中文原文）；params 做 {name} 插值
export function t(key, params) {
  let s = (PACKS[locale] && PACKS[locale][key]) || key;
  if (params) {
    for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]));
  }
  return s;
}
