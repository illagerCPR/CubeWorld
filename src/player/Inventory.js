// Inventory.js -- 背包系统
export class Inventory {
  constructor(size = 36) {
    this.size = size;
    this.slots = new Array(size).fill(null); // {name, count, data?}
    this.hotbarSelected = 0;
  }

  getSelected() {
    return this.slots[this.hotbarSelected];
  }

  setSelected(index) {
    this.hotbarSelected = Math.max(0, Math.min(8, index));
  }

  // 添加物品，返回剩余未放入数量
  add(name, count = 1, data = null) {
    let remaining = count;
    // 先堆叠到已有
    for (let i = 0; i < this.size && remaining > 0; i++) {
      const s = this.slots[i];
      if (s && s.name === name && s.count < 64) {
        const add = Math.min(64 - s.count, remaining);
        s.count += add;
        remaining -= add;
      }
    }
    // 再放入空槽
    for (let i = 0; i < this.size && remaining > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(64, remaining);
        this.slots[i] = { name, count: add, data };
        remaining -= add;
      }
    }
    return remaining;
  }

  // 从选中槽移除
  removeSelected(count = 1) {
    const s = this.slots[this.hotbarSelected];
    if (!s) return null;
    const removed = { ...s, count: Math.min(count, s.count) };
    s.count -= removed.count;
    if (s.count <= 0) this.slots[this.hotbarSelected] = null;
    return removed;
  }

  removeSlot(index, count = 1) {
    const s = this.slots[index];
    if (!s) return null;
    const removed = { ...s, count: Math.min(count, s.count) };
    s.count -= removed.count;
    if (s.count <= 0) this.slots[index] = null;
    return removed;
  }

  // 阶段10：按名称从背包扣除（deny 回滚用），从末尾槽向前扣；返回实际扣除数量
  removeItems(name, count = 1) {
    let left = count;
    for (let i = this.size - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.name === name) {
        const take = Math.min(s.count, left);
        s.count -= take;
        left -= take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return count - left;
  }

  swap(i, j) {
    const t = this.slots[i];
    this.slots[i] = this.slots[j];
    this.slots[j] = t;
  }

  // 创造模式：填充所有物品
  fillCreative(items) {
    this.slots = new Array(this.size).fill(null);
    let i = 0;
    for (const item of items) {
      if (i >= 9) break; // 只填快捷栏
      this.slots[i] = { name: item.name, count: 64, data: null };
      i++;
    }
  }

  serialize() {
    return this.slots.map(s => s ? { n: s.name, c: s.count, d: s.data } : null);
  }

  deserialize(data) {
    if (!Array.isArray(data)) return;
    for (let i = 0; i < this.size; i++) {
      const s = data[i];
      this.slots[i] = s ? { name: s.n, count: s.c, data: s.d } : null;
    }
  }
}
