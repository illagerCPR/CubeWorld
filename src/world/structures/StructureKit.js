// StructureKit.js -- 布局求解原语：全部为纯函数，向 blocks 数组追加 [wx,wy,wz,id]
// 约定：追加顺序即绘制优先级（同坐标后写覆盖先写，裁剪写入器不做去重）。
// 地基原语按 getBaseHeight 逐列下沉，保证建筑贴地且跨区块列高一致。

// 实心长方体填充（含边界）
export function fillBox(blocks, x0, y0, z0, x1, y1, z1, id) {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        blocks.push([x, y, z, id]);
}

// 空心长方体：四面墙（含四棱），不含顶底
export function wallsBox(blocks, x0, y0, z0, x1, y1, z1, id) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      blocks.push([x, y, z0, id]);
      blocks.push([x, y, z1, id]);
    }
    for (let z = z0 + 1; z <= z1 - 1; z++) {
      blocks.push([x0, y, z, id]);
      blocks.push([x1, y, z, id]);
    }
  }
}

// 清空为空气（挖腔/清植被）
export function clearBox(blocks, x0, y0, z0, x1, y1, z1) {
  fillBox(blocks, x0, y0, z0, x1, y1, z1, 0);
}

// 平台/地面：填充 x/z 范围的单一 y 层
export function floorBox(blocks, x0, z0, x1, z1, y, id) {
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      blocks.push([x, y, z, id]);
}

// 地基：把 [x0..x1]×[z0..z1] 列从 groundY-1 向下填到实际地形（getBaseHeight 纯函数），
// 材料用 columnId；用于建筑贴地、封住悬空。baseAt(wx, wz) 为地形高度查询闭包。
export function foundation(blocks, x0, z0, x1, z1, groundY, columnId, baseAt) {
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const terrain = baseAt(x, z);
      for (let y = terrain; y < groundY; y++) {
        blocks.push([x, y, z, columnId]);
      }
    }
  }
}
