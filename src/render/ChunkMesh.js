// ChunkMesh.js -- 贪心网格合并（Greedy Meshing）
import * as THREE from 'three';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from '../core/Chunk.js';
import { SVGTextures } from './SVGTextures.js';

// 6 个面的方向定义：[dx, dy, dz]
const FACES = [
  { dir: [1, 0, 0], uvFace: 'side' },   // +X
  { dir: [-1, 0, 0], uvFace: 'side' },  // -X
  { dir: [0, 1, 0], uvFace: 'top' },    // +Y
  { dir: [0, -1, 0], uvFace: 'bottom' },// -Y
  { dir: [0, 0, 1], uvFace: 'side' },   // +Z
  { dir: [0, 0, -1], uvFace: 'side' }   // -Z
];

const faceCorners = [
  // +X
  [[1,0,0],[1,1,0],[1,0,1],[1,1,1]],
  // -X
  [[0,0,1],[0,1,1],[0,0,0],[0,1,0]],
  // +Y
  [[0,1,1],[1,1,1],[0,1,0],[1,1,0]],
  // -Y
  [[0,0,0],[1,0,0],[0,0,1],[1,0,1]],
  // +Z
  [[1,0,1],[1,1,1],[0,0,1],[0,1,1]],
  // -Z
  [[0,0,0],[0,1,0],[1,0,0],[1,1,0]]
];

export class ChunkMeshBuilder {
  constructor(world, atlasTexture, atlasUV, waterTexture) {
    this.world = world;
    this.atlasTexture = atlasTexture;
    this.atlasUV = atlasUV;
    this.waterTexture = waterTexture;  // 独立水纹理（RepeatWrapping，世界坐标 UV）
  }

  // 判断方块面是否可见
  isFaceVisible(cx, cy, cz, neighborGetter) {
    const b = neighborGetter(cx, cy, cz);
    if (b === 0) return true;
    const def = BlockRegistry.getById(b);
    if (!def) return false;
    // 流体且不透明（理论情况）遮挡视线，否则按 transparent 决定
    if (def.fluid) return def.transparent ? true : false;
    return def.transparent;
  }

  build(chunk) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const colors = [];
    let idx = 0;

    const waterPositions = [];
    const waterNormals = [];
    const waterUvs = [];
    const waterIndices = [];
    const waterColors = [];
    let wIdx = 0;

    const lightPos = [];
    const lightNorm = [];
    const lightUv = [];
    const lightIdx = [];
    const lightCol = [];
    let lIdx = 0;

    // 收集水面方块（顶面暴露空气的水方块），用于贪心合并
    const waterTops = [];

    // 发光面（light mesh）顶点微抬量：避免与 solid 面共面深度冲突（z-fighting）。
    // 此前主循环内联的 light 面直接引用 yOff 但从未定义——含发光方块（火把/荧石等）
    // 的 chunk 一旦重建就 ReferenceError，rAF 链断裂画面冻结（阶段 9 修复）。
    const yOff = 0.001;

    const getBlock = (x, y, z) => {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) {
        return this.world.getBlock(chunk.cx * CHUNK_SIZE + x, y, chunk.cz * CHUNK_SIZE + z);
      }
      if (y < 0 || y >= CHUNK_HEIGHT) return 0;
      return chunk.get(x, y, z);
    };

    const pushFace = (targetPos, targetNorm, targetUv, targetIdx, startIdx, posArr, nrmArr, uvArr, face, uv, yOff, isCross = false) => {
      for (let c = 0; c < 4; c++) {
        const [cx, cy, cz] = posArr[c];
        targetPos.push(cx, cy + (cy === 1 && !isCross ? yOff : 0), cz);
        targetNorm.push(nrmArr[c][0], nrmArr[c][1], nrmArr[c][2]);
      }
      targetUv.push(uvArr[0], uvArr[1], uvArr[2], uvArr[3], uvArr[4], uvArr[5], uvArr[6], uvArr[7]);
      targetIdx.push(startIdx, startIdx + 1, startIdx + 2, startIdx + 2, startIdx + 1, startIdx + 3);
      return startIdx + 4;
    };

    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const id = chunk.get(x, y, z);
          if (id === 0) continue;
          const def = BlockRegistry.getById(id);
          if (!def) continue;
          if (def.renderType === 'cross') {
            this.addCross(positions, normals, uvs, colors, indices, x, y, z, def, idx);
            idx += 4;
            if (def.light >= 13) {
              this.addCross(lightPos, lightNorm, lightUv, lightCol, lightIdx, x, y, z, def, lIdx);
              lIdx += 4;
            }
            continue;
          }

          const isWater = def.fluid && def.name === 'water';
          const hasLight = def.light >= 13 && !isWater;
          const targetPos = isWater ? waterPositions : positions;
          const targetNorm = isWater ? waterNormals : normals;
          const targetUv = isWater ? waterUvs : uvs;
          const targetCol = isWater ? waterColors : colors;
          const targetIdx = isWater ? waterIndices : indices;
          let curIdx = isWater ? wIdx : idx;

          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const nx = x + face.dir[0], ny = y + face.dir[1], nz = z + face.dir[2];
            const neighborId = getBlock(nx, ny, nz);
            const neighborDef = BlockRegistry.getById(neighborId);

            // 面剔除
            if (neighborDef && !neighborDef.transparent && !neighborDef.fluid) continue;
            if (isWater && neighborId === id) continue;
            // 非水方块相邻流体：流体透明（水/岩浆）时绘制其面，否则剔除
            if (!isWater && neighborDef && neighborDef.fluid && !neighborDef.transparent) continue;

            // 水面（顶面）单独收集，贪心合并绘制
            if (isWater && f === 2) {
              waterTops.push(x, y, z);
              continue;
            }

            const texName = def[face.uvFace] || def.side;
            const uv = this.atlasUV.get(texName) || { u0: 0, v0: 0, u1: 1, v1: 1 };
            const corners = faceCorners[f];

            // 光照系数（简单 AO：顶面最亮，底面最暗）
            let light = 1.0;
            if (f === 2) light = 1.0;
            else if (f === 3) light = 0.5;
            else if (f === 0 || f === 1) light = 0.7;
            else light = 0.85;

            for (let c = 0; c < 4; c++) {
              const [cx, cy, cz] = corners[c];
              targetPos.push(x + cx, y + cy, z + cz);
              targetNorm.push(face.dir[0], face.dir[1], face.dir[2]);
              targetCol.push(light, light, light);
            }
            // UV：水面/侧面/底面使用世界坐标平铺（1 unit per tile，RepeatWrapping）
            // 非水方块用图集子区域
            if (isWater) {
              const offX = chunk.cx * CHUNK_SIZE;
              const offZ = chunk.cz * CHUNK_SIZE;
              for (let c = 0; c < 4; c++) {
                const [cx, cy, cz] = corners[c];
                let u, v;
                if (f === 0 || f === 1) {
                  // +X/-X 面：沿 z 走 u，沿 y 走 v
                  u = z + cz + offZ;
                  v = y + cy;
                } else if (f === 4 || f === 5) {
                  // +Z/-Z 面：沿 x 走 u，沿 y 走 v
                  u = x + cx + offX;
                  v = y + cy;
                } else {
                  // -Y 底面：沿 x 走 u，沿 z 走 v
                  u = x + cx + offX;
                  v = z + cz + offZ;
                }
                waterUvs.push(u, v);
              }
            } else {
              // 图集 UV：顶点顺序为 [底,顶,底,顶]，让方块顶部对应纹理 v=v1（SVG 顶部）
              targetUv.push(uv.u0, uv.v0, uv.u0, uv.v1, uv.u1, uv.v0, uv.u1, uv.v1);
            }
            // 索引
            targetIdx.push(curIdx, curIdx + 1, curIdx + 2, curIdx + 2, curIdx + 1, curIdx + 3);
            curIdx += 4;

            if (hasLight) {
              for (let c = 0; c < 4; c++) {
                const [cx, cy, cz] = corners[c];
                lightPos.push(x + cx, y + cy + (cy === 1 ? yOff : 0), z + cz);
                lightNorm.push(face.dir[0], face.dir[1], face.dir[2]);
              }
              lightUv.push(uv.u0, uv.v0, uv.u0, uv.v1, uv.u1, uv.v0, uv.u1, uv.v1);
              lightIdx.push(lIdx, lIdx + 1, lIdx + 2, lIdx + 2, lIdx + 1, lIdx + 3);
              lIdx += 4;
            }
          }
          if (isWater) wIdx = curIdx; else idx = curIdx;
        }
      }
    }

    // 贪心合并水面（顶面），消除网格分界
    wIdx = this._mergeWaterTops(waterTops, waterPositions, waterNormals, waterUvs, waterColors, waterIndices, wIdx, chunk);

    const meshes = {};
    if (positions.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setIndex(indices);
      const mat = new THREE.MeshLambertMaterial({
        map: this.atlasTexture,
        vertexColors: true,
        alphaTest: 0.1,
        transparent: false,
        side: THREE.FrontSide
      });
      meshes.solid = new THREE.Mesh(geo, mat);
      meshes.solid.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    }
    if (waterPositions.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(waterPositions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(waterNormals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(waterUvs, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(waterColors, 3));
      geo.setIndex(waterIndices);
      const mat = new THREE.MeshLambertMaterial({
        map: this.waterTexture,
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      meshes.water = new THREE.Mesh(geo, mat);
      meshes.water.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    }
    if (lightPos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(lightPos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(lightNorm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(lightUv, 2));
      geo.setIndex(lightIdx);
      const mat = new THREE.MeshBasicMaterial({
        map: this.atlasTexture,
        side: THREE.FrontSide,
        alphaTest: 0.1,
      });
      meshes.light = new THREE.Mesh(geo, mat);
      meshes.light.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    }
    return meshes;
  }

  // 贪心合并水面顶面，消除方块边界网格
  _mergeWaterTops(waterTops, wPos, wNorm, wUv, wCol, wIdx, startIdx, chunk) {
    if (waterTops.length === 0) return startIdx;
    const WATER_Y_OFF = -0.1;
    const offX = chunk.cx * CHUNK_SIZE;
    const offZ = chunk.cz * CHUNK_SIZE;

    // 按 y 分层
    const layers = new Map();
    for (let i = 0; i < waterTops.length; i += 3) {
      const x = waterTops[i], y = waterTops[i + 1], z = waterTops[i + 2];
      if (!layers.has(y)) layers.set(y, []);
      layers.get(y).push(x, z);
    }

    let idx = startIdx;
    for (const [y, coords] of layers) {
      // 构建该层的 boolean grid
      const grid = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
      for (let i = 0; i < coords.length; i += 2) {
        grid[coords[i] + coords[i + 1] * CHUNK_SIZE] = 1;
      }
      const merged = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);

      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          if (!grid[x + z * CHUNK_SIZE] || merged[x + z * CHUNK_SIZE]) continue;
          // 向右扩展
          let w = 1;
          while (x + w < CHUNK_SIZE && grid[(x + w) + z * CHUNK_SIZE] && !merged[(x + w) + z * CHUNK_SIZE]) w++;
          // 向下扩展
          let h = 1;
          outer: for (let zz = z + 1; zz < CHUNK_SIZE; zz++) {
            for (let xx = x; xx < x + w; xx++) {
              if (!grid[xx + zz * CHUNK_SIZE] || merged[xx + zz * CHUNK_SIZE]) break outer;
            }
            h++;
          }
          // 标记已合并
          for (let zz = z; zz < z + h; zz++) {
            for (let xx = x; xx < x + w; xx++) {
              merged[xx + zz * CHUNK_SIZE] = 1;
            }
          }
          // 生成 quad（4 顶点，水面在 y+1+yOff）
          const sy = y + 1 + WATER_Y_OFF;
          const x0 = x, x1 = x + w, z0 = z, z1 = z + h;
          wPos.push(x0, sy, z0, x0, sy, z1, x1, sy, z0, x1, sy, z1);
          wNorm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
          wCol.push(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
          // UV：world-space 平铺，每世界单位 1 tile（水纹理 RepeatWrapping）
          // 顶点顺序 (x0,z0)(x0,z1)(x1,z0)(x1,z1) 对应 UV (u0,v0)(u0,v1)(u1,v0)(u1,v1)
          wUv.push(x0 + offX, z0 + offZ, x0 + offX, z1 + offZ, x1 + offX, z0 + offZ, x1 + offX, z1 + offZ);
          wIdx.push(idx, idx + 1, idx + 2, idx + 2, idx + 1, idx + 3);
          idx += 4;
        }
      }
    }
    return idx;
  }

  // 十字形渲染（火把/花）
  addCross(positions, normals, uvs, colors, indices, x, y, z, def, idx) {
    const texName = def.side;
    const uv = this.atlasUV.get(texName) || { u0: 0, v0: 0, u1: 1, v1: 1 };
    const corners = [
      [[0,0,0],[0,1,0],[1,0,1],[1,1,1]],
      [[1,0,0],[1,1,0],[0,0,1],[0,1,1]]
    ];
    for (const cross of corners) {
      for (const [cx, cy, cz] of cross) {
        positions.push(x + cx, y + cy, z + cz);
        normals.push(0, 1, 0);
        colors.push(1, 1, 1);
      }
      uvs.push(uv.u0, uv.v0, uv.u0, uv.v1, uv.u1, uv.v0, uv.u1, uv.v1);
      indices.push(idx, idx + 1, idx + 2, idx + 2, idx + 1, idx + 3);
      idx += 4;
    }
  }
}
