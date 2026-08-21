// ItemRegistry.js -- 物品注册表（非方块物品）
const items = new Map();
const nameToId = new Map();
let nextId = 1;

function register(def) {
  const id = def.id ?? nextId++;
  const name = def.name;
  const item = {
    id,
    name,
    displayName: def.displayName || name,
    stack: def.stack ?? 64,
    food: def.food ?? 0,
    tool: def.tool || null,
    tier: def.tier ?? 0,
    durability: def.durability ?? 0,
    damage: def.damage ?? 0,
    blockName: def.blockName || null
  };
  items.set(id, item);
  nameToId.set(name, id);
  return id;
}

function getById(id) { return items.get(id); }
function getByName(name) { const id = nameToId.get(name); return id ? items.get(id) : undefined; }
function getId(name) { return nameToId.get(name) || 0; }
function all() { return [...items.values()]; }

export const ItemRegistry = { register, getById, getByName, getId, all };
