// MeshWorkerClient.js -- MeshWorker 主线程客户端（Idea-3B-②）
// init 广播 atlasUV；build 传入三份缓存副本（buffer 转移）+ 渲染质量档，
// 回执带 version 供主线程丢弃过期结果。broken 熔断后调用方回退同步 build。
export class MeshWorkerClient {
  constructor(atlasUVEntries, workerCount = 2) {
    this.broken = false;
    this._nextId = 1;
    this._pending = new Map();
    this.workers = [];
    this._rr = 0;
    for (let i = 0; i < workerCount; i++) {
      const w = new Worker(new URL('./MeshWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this._onMessage(e.data);
      w.onerror = () => this._failAll();
      this.workers.push(w);
      w.postMessage({ t: 'init', atlasUV: atlasUVEntries });
    }
  }

  // 提交一次网格构建；caches 为副本，buffer 随消息转移
  build(cx, cz, cache, skyCache, blockLCache, quality, version) {
    const id = this._nextId++;
    const w = this.workers[this._rr++ % this.workers.length];
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      w.postMessage(
        { t: 'build', id, cx, cz, cache, skyCache, blockLCache, quality, version },
        [cache.buffer, skyCache.buffer, blockLCache.buffer]
      );
    });
  }

  _onMessage(msg) {
    const p = this._pending.get(msg.id);
    if (!p) return;
    this._pending.delete(msg.id);
    if (msg.t === 'built') p.resolve(msg.out);
    else p.reject(new Error(msg.error || 'MeshWorker 构建失败'));
  }

  _failAll() {
    this.broken = true;
    for (const p of this._pending.values()) p.reject(new Error('MeshWorker broken'));
    this._pending.clear();
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this._pending.clear();
    this.broken = true;
  }
}
