// BlockRegistry.js -- 方块注册表
// 每个方块定义: { id, name, textures:{top,side,bottom} 或 all, transparent, solid, hardness, light }

const blocks = new Map();
const nameToId = new Map();
const idToName = new Map();
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
    minTier: def.minTier ?? 0,
    light: def.light ?? 0,
    fluid: def.fluid ?? false,
    fluidType: def.fluidType || null, // B26 流体模拟：'water'/'lava'（流动等级方块与源同值，判定按此不按 name）
    renderType: def.renderType || 'cube',
    // B27 床/门形制：格内 AABB（单位坐标）——渲染 addBox 与碰撞 cellBox 共用
    shape: def.shape || null,
    // B27 门/床/活板门状态家族：'door_lower'|'door_upper'|'bed_foot'|'bed_head'|null
    part: def.part || null,
    // B27 朝向（'n'|'s'|'e'|'w'）：门=关态面板贴的边；床=foot→head 方向；活板门=开态贴边
    facing: def.facing || null,
    open: def.open ?? false,
    baseBlock: def.baseBlock || null, // 家族基名（'oak_door' 等）——掉落/物品映射用
    updraft: def.updraft ?? false, // 天域批次 B：上升气流柱（Game._updateUpdraftState 消费）
    lore: def.lore || null, // 世界观批次 N1：方块悬浮 lore（InventoryScreen._bindHover 消费）
    stele: def.stele ?? false, // 世界观批次 W3：石碑家族标记（Game 右键读碑按此判定，修 wind_stele 硬编码遗漏 ember/moss）
    ambientParticles: def.ambientParticles ?? false,
    color: def.color || null
  };
  blocks.set(id, block);
  nameToId.set(name, id);
  idToName.set(id, name);
  return id;
}

function getById(id) { return blocks.get(id); }
function getByName(name) { const id = nameToId.get(name); return id ? blocks.get(id) : undefined; }
function getId(name) { return nameToId.get(name) || 0; }
function getNameById(id) { return idToName.get(id) || null; }
function all() { return [...blocks.values()]; }

export const BlockRegistry = { register, getById, getByName, getId, getNameById, all };
