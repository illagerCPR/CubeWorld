// StoneStyle.js -- 石质按钮共享样式（Build 4：全界面按钮统一主界面石头材质）
// 确定性哈希噪点 SVG data-URI（与 BlockDefs stoneTex 同风格，禁用 Math.random）；
// ensureStoneStyles() 幂等向 head 注入一次 .cw-stone-btn 样式表——hover/active 伪类必须走 class。

function menuHash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 974634073) >>> 0;
  h = ((h ^ (h >>> 13)) * 1103515245) >>> 0;
  return (h >>> 16) / 65536;
}

function stoneSvgDataUri(seed = 7) {
  const rects = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const t = menuHash2(x, y, seed);
      let f = 1 + (menuHash2(x, y, seed + 1) - 0.5) * 0.06;
      if (t < 0.2) f *= 0.9;
      else if (t > 0.85) f *= 1.08;
      const c = Math.max(0, Math.min(255, Math.round(125 * f)));
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${c},${c},${c})"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects.join('')}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const STONE_BG = stoneSvgDataUri(7);

// 幂等注入：任何界面用 .cw-stone-btn 前调用一次即可（重复调用无害）
export function ensureStoneStyles() {
  if (document.getElementById('cw-stone-styles')) return;
  const style = document.createElement('style');
  style.id = 'cw-stone-styles';
  style.textContent = `
    .cw-stone-btn {
      background-image: ${STONE_BG};
      background-size: 64px 64px;
      image-rendering: pixelated;
      border: 2px solid #000;
      box-shadow: inset 2px 2px 0 rgba(255,255,255,0.35), inset -2px -4px 0 rgba(0,0,0,0.45);
      color: #fff;
      text-shadow: 2px 2px 0 rgba(0,0,0,0.55);
      cursor: pointer;
      font-weight: bold;
      font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
    }
    .cw-stone-btn:hover { filter: brightness(1.22); border-color: #fff; }
    .cw-stone-btn:active {
      filter: brightness(0.92);
      box-shadow: inset -2px -2px 0 rgba(255,255,255,0.2), inset 2px 2px 0 rgba(0,0,0,0.45);
    }
    .cw-stone-btn.selected {
      border-color: #fff;
      box-shadow: inset 2px 2px 0 rgba(255,255,255,0.35), inset -2px -4px 0 rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.55);
    }
    .cw-stone-btn:disabled { filter: brightness(0.75); cursor: default; }
    /* 危险动作变体（退出/删除）：暗红描边提示语义，材质仍为石头 */
    .cw-stone-btn.danger { border-color: #6a2a2a; }
    .cw-stone-btn.danger:hover { border-color: #c06060; }
    /* 面板内嵌迷你按钮（命令面板列表行等）：材质同源、尺寸由内联样式覆盖 */
    .cw-stone-btn.mini { text-shadow: 1px 1px 0 rgba(0,0,0,0.55); }
  `;
  document.head.appendChild(style);
}

// 石头按钮工厂：label 文案 + 可选变体 class（danger/mini/selected 由调用方追加）
export function stoneBtn(label, extraClass = '', inline = '') {
  ensureStoneStyles();
  const b = document.createElement('button');
  b.className = `cw-stone-btn${extraClass ? ' ' + extraClass : ''}`;
  b.textContent = label;
  if (inline) b.style.cssText = inline;
  return b;
}
