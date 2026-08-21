// Raycast.js -- DDA 射线选择方块
import { BlockRegistry } from '../core/BlockRegistry.js';

export class Raycast {
  constructor(world) {
    this.world = world;
  }

  // 从 origin 沿 direction 射出，最大距离 maxDist
  // 返回 { block: {x,y,z}, normal: {x,y,z} } 或 null
  cast(origin, direction, maxDist = 5) {
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    
    const stepX = direction.x > 0 ? 1 : -1;
    const stepY = direction.y > 0 ? 1 : -1;
    const stepZ = direction.z > 0 ? 1 : -1;
    
    const tDeltaX = direction.x !== 0 ? Math.abs(1 / direction.x) : Infinity;
    const tDeltaY = direction.y !== 0 ? Math.abs(1 / direction.y) : Infinity;
    const tDeltaZ = direction.z !== 0 ? Math.abs(1 / direction.z) : Infinity;
    
    let tMaxX = direction.x !== 0 ? (stepX > 0 ? (x + 1 - origin.x) / direction.x : (origin.x - x) / -direction.x) : Infinity;
    let tMaxY = direction.y !== 0 ? (stepY > 0 ? (y + 1 - origin.y) / direction.y : (origin.y - y) / -direction.y) : Infinity;
    let tMaxZ = direction.z !== 0 ? (stepZ > 0 ? (z + 1 - origin.z) / direction.z : (origin.z - z) / -direction.z) : Infinity;
    
    let lastFace = { x: 0, y: 0, z: 0 };
    let t = 0;
    
    while (t <= maxDist) {
      const id = this.world.getBlock(x, y, z);
      if (id !== 0) {
        const def = BlockRegistry.getById(id);
        if (def && def.solid && !def.fluid) {
          return {
            block: { x, y, z },
            normal: lastFace,
            id
          };
        }
      }
      
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        lastFace = { x: -stepX, y: 0, z: 0 };
      } else if (tMaxY < tMaxZ) {
        y += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        lastFace = { x: 0, y: -stepY, z: 0 };
      } else {
        z += stepZ;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        lastFace = { x: 0, y: 0, z: -stepZ };
      }
    }
    return null;
  }
}
