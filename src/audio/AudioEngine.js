// AudioEngine.js -- WebAudio 程序化音频引擎（零资产合成，延续"SVG 程序化纹理"思路）
// 惰性初始化：AudioContext 必须在首次用户手势后创建（浏览器自动播放策略），
// main.js 调 installUnlock() 在 pointerdown/keydown 上挂一次性解锁。
// 总线：sfx/music 分轨 -> master（音量/静音统一控制）。所有发声入口在 ctx 未就绪时静默早退。
const CATEGORY_PARAMS = {
  stone:  { filter: 'lowpass',  freq: 900,  q: 1,   dur: 0.16, gain: 1.0 },
  wood:   { filter: 'lowpass',  freq: 650,  q: 1.2, dur: 0.14, gain: 0.9, thump: 95 },
  gravel: { filter: 'highpass', freq: 500,  q: 0.8, dur: 0.12, gain: 0.8 },
  grass:  { filter: 'bandpass', freq: 2600, q: 2,   dur: 0.09, gain: 0.7 },
  glass:  { filter: 'highpass', freq: 3200, q: 3,   dur: 0.12, gain: 0.8, ping: 1900 },
  metal:  { filter: 'bandpass', freq: 1400, q: 4,   dur: 0.14, gain: 0.85, ping: 900 },
  cloth:  { filter: 'lowpass',  freq: 480,  q: 1,   dur: 0.12, gain: 0.6 },
  snow:   { filter: 'lowpass',  freq: 700,  q: 1,   dur: 0.10, gain: 0.55 },
  liquid: { filter: 'lowpass',  freq: 600,  q: 1,   dur: 0.14, gain: 0.7, plop: 260 },
};

// 方块定义 -> 音效材质类别（名称启发式，未命中回退 stone）
export function blockCategory(def) {
  const n = def && def.name ? def.name : '';
  if (/glass|ice|shulker|sea_lantern/.test(n)) return 'glass';
  if (/wool|carpet|bed|banner/.test(n)) return 'cloth';
  if (/plank|wood|log|door|fence|chest|crafting|bookshelf|trapdoor|barrel|bamboo/.test(n)) return 'wood';
  if (/sand|gravel|soul|powder|dirt|farmland|clay|mud|concrete_powder/.test(n)) return 'gravel';
  if (/grass|leaves|flower|crop|wheat|hay|moss|vine|tall_|sculk_|nylium|fungus|shroomlight/.test(n)) return 'grass';
  if (/iron|gold|anvil|cauldron|rail|hopper|piston|lantern|chain|netherite|bell/.test(n)) return 'metal';
  if (/snow/.test(n)) return 'snow';
  if (def && def.fluid) return 'liquid';
  return 'stone';
}

class AudioEngine {
  constructor() {
    this.ctx = null;       // AudioContext（首次手势后创建）
    this.master = null;    // 总增益（音量）
    this.sfx = null;       // 音效分轨
    this.music = null;     // BGM 分轨（A-② 使用，预留）
    this.enabled = true;
    this.volume = 0.6;
    this.noiseBuf = null;  // 1s 白噪声缓存
    this._unlockWired = false;
  }

  // 首次用户手势后创建/恢复 AudioContext（幂等，可反复调用）
  unlock() {
    try {
      if (!this.ctx) {
        const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return;
        this.ctx = new AC();
        this._buildGraph();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* 无音频设备等忽略 */ }
  }

  // 挂一次性手势监听（main.js 启动时调用一次）
  installUnlock() {
    if (this._unlockWired || typeof document === 'undefined') return;
    this._unlockWired = true;
    const handler = () => this.unlock();
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('keydown', handler, true);
  }

  _buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0.5;
    this.music.connect(this.master);
    // 白噪声缓存（1s，单声道）
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  }

  setEnabled(v) {
    this.enabled = !!v;
    if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.enabled) this.master.gain.value = this.volume;
  }

  // 滤波噪声 burst：挖掘/放置/脚步类的基础粒子
  _noise({ when = 0, dur = 0.15, filter = 'lowpass', freq = 800, q = 1, gain = 0.5, rate = 1 } = {}) {
    if (!this.ctx || !this.sfx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rate;
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.frequency.value = freq;
    bq.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  // 振荡器音：包络 + 可选下滑（exponentialRamp 需正频率）
  _tone({ when = 0, dur = 0.15, from = 220, to = 0, type = 'sine', gain = 0.3, attack = 0.008 } = {}) {
    if (!this.ctx || !this.sfx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), t);
    if (to > 0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // —— 游戏事件音 ——

  // 挖掘命中（由 0.25s 挖掘节奏定时器驱动，天然限频）
  digHit(def) {
    if (!this.ctx) return;
    const p = CATEGORY_PARAMS[blockCategory(def)];
    this._noise({ dur: p.dur * 0.6, filter: p.filter, freq: p.freq * 1.15, q: p.q, gain: 0.18 * p.gain, rate: 1.2 });
  }

  blockBreak(def) {
    if (!this.ctx) return;
    const p = CATEGORY_PARAMS[blockCategory(def)];
    this._noise({ dur: p.dur * 1.6, filter: p.filter, freq: p.freq * 0.85, q: p.q, gain: 0.55 * p.gain, rate: 0.8 });
    if (p.ping) this._tone({ dur: 0.22, from: p.ping, to: p.ping * 0.6, type: 'sine', gain: 0.14 });
    if (p.thump) this._tone({ dur: 0.12, from: p.thump, to: p.thump * 0.7, type: 'sine', gain: 0.3 });
    if (p.plop) this._tone({ dur: 0.1, from: p.plop, to: p.plop * 0.55, type: 'sine', gain: 0.25 });
  }

  blockPlace(def) {
    if (!this.ctx) return;
    const p = CATEGORY_PARAMS[blockCategory(def)];
    this._noise({ dur: p.dur * 0.8, filter: p.filter, freq: p.freq, q: p.q, gain: 0.32 * p.gain, rate: 1.0 });
    if (p.thump) this._tone({ dur: 0.09, from: p.thump * 1.1, to: p.thump * 0.8, type: 'sine', gain: 0.2 });
  }

  // 玩家受击：低哑下滑音（音量随伤害微调）
  hurt(amount) {
    if (!this.ctx) return;
    const g = Math.min(0.45, 0.22 + amount * 0.02);
    this._tone({ dur: 0.16, from: 210, to: 140, type: 'sawtooth', gain: g });
    this._tone({ when: 0.05, dur: 0.1, from: 150, to: 110, type: 'triangle', gain: g * 0.6 });
    this._noise({ dur: 0.08, filter: 'lowpass', freq: 500, gain: g * 0.4 });
  }

  // 进食：三连咀嚼 + 收尾吞咽
  eat() {
    if (!this.ctx) return;
    for (let i = 0; i < 3; i++) {
      this._noise({ when: i * 0.11, dur: 0.05, filter: 'lowpass', freq: 700 + i * 90, gain: 0.35, rate: 0.9 + i * 0.1 });
    }
    this._tone({ when: 0.36, dur: 0.14, from: 280, to: 180, type: 'sine', gain: 0.18 });
  }

  // 弓发射：弦震 + 破空（蓄力越满音越低沉）
  bowShoot(charge = 1) {
    if (!this.ctx) return;
    const c = Math.max(0, Math.min(1, charge));
    this._tone({ dur: 0.1 + c * 0.1, from: 150 + c * 70, to: 90, type: 'triangle', gain: 0.25 });
    this._noise({ dur: 0.16, filter: 'bandpass', freq: 1100 + c * 500, q: 1.5, gain: 0.16, rate: 1.1 });
  }

  // 箭命中（怪/方块钉住）
  arrowHit() {
    if (!this.ctx) return;
    this._noise({ dur: 0.05, filter: 'highpass', freq: 1800, gain: 0.3, rate: 1.6 });
  }
}

export const audio = new AudioEngine();
