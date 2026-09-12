// TerrainWorker.js -- 地形生成 Worker（Idea-3B-①）
// 地形模块图（noise/biomes/terrain/Chunk/BlockRegistry/structures）纯计算零 DOM，
// 在 Worker 上下文可直接运行；块数据以 Transferable ArrayBuffer 回传（零拷贝）。
import { Chunk } from '../core/Chunk.js';
import { TerrainGenerator } from '../world/terrain.js';
// 关键：方块 id 注册在 BlockDefs 模块顶层执行（主线程由 Game.js 导入完成注册）。
// Worker 图里若缺这一导入，BlockRegistry 为空 → getByName 全 undefined → 生成全空气。
// BlockDefs 顶层只做 SVG 字符串生成（DOM 全在函数体内），Worker 上下文安全。
import '../blocks/BlockDefs.js';

// 每个 seed+规模缓存一个生成器（噪声表初始化较重），LRU 上限防换房/换维堆积
const generators = new Map();
const MAX_GENERATORS = 4;

function getGenerator(seed, biomeScale) {
  const key = seed + '|' + (biomeScale || '');
  let gen = generators.get(key);
  if (!gen) {
    if (generators.size >= MAX_GENERATORS) {
      generators.delete(generators.keys().next().value);
    }
    gen = new TerrainGenerator(seed, biomeScale);
    generators.set(key, gen);
  }
  return gen;
}

self.onmessage = (e) => {
  const { id, cx, cz, seed, biomeScale } = e.data || {};
  try {
    const gen = getGenerator(seed, biomeScale);
    const chunk = new Chunk(cx, cz);
    gen.generateChunk(chunk);
    const buf = chunk.blocks.buffer;
    self.postMessage({ id, ok: true, cx, cz, blocks: buf }, [buf]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
