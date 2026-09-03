// ChunkMesh.js -- 区块网格构建（局部方块缓存 + 逐顶点 AO + 平滑体素光照 + 水面贪心合并）
import * as THREE from 'three';
import { BlockRegistry } from '../core/BlockRegistry.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from '../core/Chunk.js';
import { SVGTextures } from './SVGTextures.js';
import { applyVoxelLight } from './VoxelLight.js';

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

// 光照系数（简单 AO：顶面最亮，底面最暗）
const FACE_LIGHT = [0.7, 0.7, 1.0, 0.5, 0.85, 0.85];

// AO 档位 → 顶点色乘子（0=无遮蔽，3=两侧+对角全遮蔽）
const AO_CURVE = [1.0, 0.8, 0.62, 0.45];

// 渲染质量开关（视频设置面板写入；改动后需 markAllDirty 重建区块网格生效）
export const RenderQuality = {
  smoothLighting: true,  // 平滑光照（四角取邻格均值）
  aoEnabled: true,       // 环境光遮蔽
};

// 逐面逐顶点的 AO 采样偏移（相对方块坐标）：[side1, side2, corner]
// 由 FACES + faceCorners 在模块加载时静态推导，热循环零分配
const AO_SAMPLES = FACES.map((face, f) => {
  const ax = face.dir[0] !== 0 ? 0 : (face.dir[1] !== 0 ? 1 : 2);
  const t1 = ax === 0 ? 1 : 0;
  const t2 = ax === 2 ? 1 : 2;
  return faceCorners[f].map((c) => {
    const o1 = c[t1] === 1 ? 1 : -1;
    const o2 = c[t2] === 1 ? 1 : -1;
    const mk = (u1, u2) => {
      const p = [face.dir[0], face.dir[1], face.dir[2]];
      p[t1] += u1;
      p[t2] += u2;
      return p;
    };
    return [mk(o1, 0), mk(0, o2), mk(o1, o2)];
  });
});

// 缓存尺寸：区块四周各垫 1 格（18×256×18），AO/剔除查表全走本地数组
const PAD = CHUNK_SIZE + 2; // 18

export class ChunkMeshBuilder {
  constructor(world, atlasTexture, atlasUV, waterTexture) {
    this.world = world;
    this.atlasTexture = atlasTexture;
    this.atlasUV = atlasUV;
    this.waterTexture = waterTexture;  // 独立水纹理（RepeatWrapping，世界坐标 UV）

    // 共享材质：跨区块复用（此前每次 build 新建材质且从不释放，存在泄漏）；
    // geometry 仍按区块创建/释放，材质生命周期与 builder 一致。
    // 体素光照接管方块明暗（天光×昼夜 + 方块光暖色），材质用 Basic 避开场景光二次照明
    this.solidMaterial = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      vertexColors: true,
      alphaTest: 0.1,
      transparent: false,
      side: THREE.FrontSide
    });
    applyVoxelLight(this.solidMaterial);
    this.waterMaterial = new THREE.MeshBasicMaterial({
      map: this.waterTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    applyVoxelLight(this.waterMaterial);
    this.lightMaterial = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      side: THREE.FrontSide,
      alphaTest: 0.1,
    });

    // 局部方块缓存 scratch（跨构建复用，避免每帧分配 83KB）
    this._cache = new Uint8Array(PAD * CHUNK_HEIGHT * PAD);
    this._curChunk = null;
    this._opaqueLUT = new Uint8Array(256);
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

  // 缓存索引：x,z ∈ -1..16，y ∈ 0..255（越界 y 由调用方处理）
  _cidx(x, y, z) {
    return (y * PAD + z + 1) * PAD + x + 1;
  }

  // 采样缓存方块（y 越界视为空气）
  _solidAt(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    return this._cache[(y * PAD + z + 1) * PAD + x + 1];
  }

  // 天光采样：本地格直读区块光数组，边界格走 world（未加载按露天 15）
  _skyAt(x, y, z) {
    if (y >= CHUNK_HEIGHT) return 15;
    if (y < 0) return 0;
    const chunk = this._curChunk;
    if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) {
      return chunk.getSky(x, y, z);
    }
    return this.world.getSkyLight(chunk.cx * CHUNK_SIZE + x, y, chunk.cz * CHUNK_SIZE + z);
  }

  // 方块光采样（同上，未加载按 0）
  _blockLAt(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    const chunk = this._curChunk;
    if (x >= 0 && x < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) {
      return chunk.getBlockLight(x, y, z);
    }
    return this.world.getBlockLightAt(chunk.cx * CHUNK_SIZE + x, y, chunk.cz * CHUNK_SIZE + z);
  }

  // 填充局部缓存：内部直接拷贝，边界查 world
  _fillCache(chunk) {
    const cache = this._cache;
    const blocks = chunk.blocks;
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = -1; z <= CHUNK_SIZE; z++) {
        const rowBase = (y * PAD + z + 1) * PAD;
        if (z >= 0 && z < CHUNK_SIZE) {
          // 内部整行快速拷贝
          const src = (y * CHUNK_SIZE + z) * CHUNK_SIZE;
          cache.set(blocks.subarray(src, src + CHUNK_SIZE), rowBase + 1);
          // x 方向边界
          cache[rowBase] = this.world.getBlock(ox - 1, y, oz + z);
          cache[rowBase + PAD - 1] = this.world.getBlock(ox + CHUNK_SIZE, y, oz + z);
        } else {
          // z 方向边界整行（含四角）
          for (let x = -1; x <= CHUNK_SIZE; x++) {
            cache[rowBase + x + 1] = this.world.getBlock(ox + x, y, oz + z);
          }
        }
      }
    }
  }

  // 刷新不透明 LUT（与面剔除一致的遮挡定义：非 transparent 且非 fluid）
  _refreshOpaqueLUT() {
    const lut = this._opaqueLUT;
    for (let id = 1; id < 256; id++) {
      const def = BlockRegistry.getById(id);
      lut[id] = def && !def.transparent && !def.fluid ? 1 : 0;
    }
  }

  build(chunk) {
    this._curChunk = chunk;
    this._fillCache(chunk);
    this._refreshOpaqueLUT();

    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const colors = [];
    const voxLight = []; // solid 顶点体素光 (skyL, blockL) 归一化
    let idx = 0;

    const waterPositions = [];
    const waterNormals = [];
    const waterUvs = [];
    const waterIndices = [];
    const waterColors = [];
    const waterVoxLight = [];
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

    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const id = this._solidAt(x, y, z);
          if (id === 0) continue;
          const def = BlockRegistry.getById(id);
          if (!def) continue;
          if (def.renderType === 'cross') {
            this.addCross(positions, normals, uvs, colors, indices, x, y, z, def, idx, voxLight);
            idx += 4;
            if (def.light >= 13) {
              this.addCross(lightPos, lightNorm, lightUv, lightCol, lightIdx, x, y, z, def, lIdx, null);
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
            const neighborId = this._solidAt(nx, ny, nz);
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
            const faceLight = FACE_LIGHT[f];

            // 逐顶点 AO + 平滑体素光照：面外相邻层的 侧1/侧2/对角 三格
            const a = [0, 0, 0, 0];
            const skyV = [0, 0, 0, 0];
            const blkV = [0, 0, 0, 0];
            if (!isWater) {
              const lut = this._opaqueLUT;
              const samples = AO_SAMPLES[f];
              // 面邻格（N）光值为平滑基准
              const nSky = this._skyAt(nx, ny, nz);
              const nBlk = this._blockLAt(nx, ny, nz);
              if (RenderQuality.smoothLighting || RenderQuality.aoEnabled) {
                for (let c = 0; c < 4; c++) {
                  const s = samples[c];
                  const s1 = lut[this._solidAt(x + s[0][0], y + s[0][1], z + s[0][2])];
                  const s2 = lut[this._solidAt(x + s[1][0], y + s[1][1], z + s[1][2])];
                  const cc = lut[this._solidAt(x + s[2][0], y + s[2][1], z + s[2][2])];
                  a[c] = RenderQuality.aoEnabled ? ((s1 && s2) ? 3 : s1 + s2 + cc) : 0;
                  if (RenderQuality.smoothLighting) {
                    // 平滑光照均值：N 必算，不透明格不参与，两侧全挡时对角也不参与
                    let skySum = nSky, blkSum = nBlk, cnt = 1;
                    if (!s1) { skySum += this._skyAt(x + s[0][0], y + s[0][1], z + s[0][2]); blkSum += this._blockLAt(x + s[0][0], y + s[0][1], z + s[0][2]); cnt++; }
                    if (!s2) { skySum += this._skyAt(x + s[1][0], y + s[1][1], z + s[1][2]); blkSum += this._blockLAt(x + s[1][0], y + s[1][1], z + s[1][2]); cnt++; }
                    if (!cc && !(s1 && s2)) { skySum += this._skyAt(x + s[2][0], y + s[2][1], z + s[2][2]); blkSum += this._blockLAt(x + s[2][0], y + s[2][1], z + s[2][2]); cnt++; }
                    skyV[c] = skySum / cnt / 15;
                    blkV[c] = blkSum / cnt / 15;
                  } else {
                    skyV[c] = nSky / 15;
                    blkV[c] = nBlk / 15;
                  }
                }
              } else {
                // 平滑光照与 AO 全关：四角统一取面邻格光
                for (let c = 0; c < 4; c++) { skyV[c] = nSky / 15; blkV[c] = nBlk / 15; }
              }
            } else {
              // 水侧面：取面邻格光
              const nSky = this._skyAt(nx, ny, nz) / 15;
              const nBlk = this._blockLAt(nx, ny, nz) / 15;
              skyV[0] = skyV[1] = skyV[2] = skyV[3] = nSky;
              blkV[0] = blkV[1] = blkV[2] = blkV[3] = nBlk;
            }
            const targetLight = isWater ? waterVoxLight : voxLight;

            // 顶点色 = 面向系数 × AO；AO 各向异性时翻转对角线避免暗色斜纹
            for (let c = 0; c < 4; c++) {
              const [cx, cy, cz] = corners[c];
              targetPos.push(x + cx, y + cy, z + cz);
              targetNorm.push(face.dir[0], face.dir[1], face.dir[2]);
              const l = faceLight * AO_CURVE[a[c]];
              targetCol.push(l, l, l);
              targetLight.push(skyV[c], blkV[c]);
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
            // 索引（AO 各向异性时换对角线：v1-v2 ↔ v0-v3，绕向不变）
            if (!isWater && a[1] + a[2] > a[0] + a[3]) {
              targetIdx.push(curIdx, curIdx + 1, curIdx + 3, curIdx, curIdx + 3, curIdx + 2);
            } else {
              targetIdx.push(curIdx, curIdx + 1, curIdx + 2, curIdx + 2, curIdx + 1, curIdx + 3);
            }
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
    wIdx = this._mergeWaterTops(waterTops, waterPositions, waterNormals, waterUvs, waterColors, waterVoxLight, waterIndices, wIdx, chunk);

    const meshes = {};
    if (positions.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setAttribute('voxelLight', new THREE.Float32BufferAttribute(voxLight, 2));
      geo.setIndex(indices);
      meshes.solid = new THREE.Mesh(geo, this.solidMaterial);
      meshes.solid.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    }
    if (waterPositions.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(waterPositions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(waterNormals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(waterUvs, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(waterColors, 3));
      geo.setAttribute('voxelLight', new THREE.Float32BufferAttribute(waterVoxLight, 2));
      geo.setIndex(waterIndices);
      meshes.water = new THREE.Mesh(geo, this.waterMaterial);
      meshes.water.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    }
    if (lightPos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(lightPos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(lightNorm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(lightUv, 2));
      geo.setIndex(lightIdx);
      meshes.light = new THREE.Mesh(geo, this.lightMaterial);
      meshes.light.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    }
    return meshes;
  }

  // 贪心合并水面顶面，消除方块边界网格
  _mergeWaterTops(waterTops, wPos, wNorm, wUv, wCol, wVLight, wIdx, startIdx, chunk) {
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
          // 顶点体素光：取每角上方格（空气）的光
          const cornerL = (cxr, czr) => {
            wVLight.push(this._skyAt(cxr, y + 1, czr) / 15, this._blockLAt(cxr, y + 1, czr) / 15);
          };
          cornerL(x0, z0); cornerL(x0, z1); cornerL(x1, z0); cornerL(x1, z1);
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

  // 十字形渲染（火把/花）；voxLight 非空时写入自身格光照（发光体 light mesh 传 null 跳过）
  addCross(positions, normals, uvs, colors, indices, x, y, z, def, idx, voxLight) {
    const texName = def.side;
    const uv = this.atlasUV.get(texName) || { u0: 0, v0: 0, u1: 1, v1: 1 };
    const corners = [
      [[0,0,0],[0,1,0],[1,0,1],[1,1,1]],
      [[1,0,0],[1,1,0],[0,0,1],[0,1,1]]
    ];
    const skyL = voxLight ? this._skyAt(x, y, z) / 15 : 0;
    const blkL = voxLight ? this._blockLAt(x, y, z) / 15 : 0;
    for (const cross of corners) {
      for (const [cx, cy, cz] of cross) {
        positions.push(x + cx, y + cy, z + cz);
        normals.push(0, 1, 0);
        colors.push(1, 1, 1);
        if (voxLight) voxLight.push(skyL, blkL);
      }
      uvs.push(uv.u0, uv.v0, uv.u0, uv.v1, uv.u1, uv.v0, uv.u1, uv.v1);
      indices.push(idx, idx + 1, idx + 2, idx + 2, idx + 1, idx + 3);
      idx += 4;
    }
  }
}
