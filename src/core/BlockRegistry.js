// BlockRegistry.js -- 方块注册表
// 每个方块定义: { id, name, textures:{top,side,bottom} 或 all, transparent, solid, hardness, light }

const blocks = new Map();
const nameToId = new Map();
let nextId = 1; // 0 保留给空气

function register(def) {
  const id = def.id ?? nextId++;
  const name = def.name;
  const tex = def.textures;
  // 统一为 {top, side, bottom}；未指定时用方块名作为贴图名
  let top, side, bottom;
  if (typeof tex === 'string') { top = side = bottom = tex; }
  else if (tex && typeof tex === 'object') {
    top = tex.top || tex.side || name;
    side = tex.side || tex.top || name;
    bottom = tex.bottom || tex.side || name;
  } else {
    top = side = bottom = name;
  }
  const block = {
    id,
    name,
    displayName: def.displayName || name,
    top, side, bottom,
    transparent: def.transparent ?? false,
    solid: def.solid ?? true,
    hardness: def.hardness ?? 1,
    tool: def.tool || null,
    light: def.light ?? 0,
    fluid: def.fluid ?? false,
    renderType: def.renderType || 'cube',
    color: def.color || null
  };
  blocks.set(id, block);
  nameToId.set(name, id);
  return id;
}

function getById(id) { return blocks.get(id); }
function getByName(name) { const id = nameToId.get(name); return id ? blocks.get(id) : undefined; }
function getId(name) { return nameToId.get(name) || 0; }
function all() { return [...blocks.values()]; }

export const BlockRegistry = { register, getById, getByName, getId, all };
