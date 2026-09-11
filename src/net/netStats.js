// netStats.js -- 网络统计纯函数（阶段11）：RTT EMA + 抖动（相邻样本差绝对值的 EMA）
// 供插值延迟自适应（抖动大 → 目标延迟略增吸收抖动）与 InfoBar「网络: Xms ±Yms」显示。
// 纯逻辑、无 DOM/three 依赖，node 测试可直接单测。

// 新建统计器（rttMs/rttJitterMs 为 null 表示尚未测得）
export function createNetStats() {
  return { rttMs: null, rttJitterMs: null, _prevRttMs: null };
}

// 喂入一次 RTT 样本（毫秒）：RTT 走 EMA(0.8/0.2)（与阶段10 口径一致）；
// 抖动 = |本次 RTT − 上次 RTT| 的 EMA(0.8/0.2)。非法样本（非有限/负数/≥10s）直接忽略。
export function pushRttSample(st, rttMs) {
  if (!st) return st;
  if (typeof rttMs !== 'number' || !Number.isFinite(rttMs) || rttMs < 0 || rttMs >= 10000) return st;
  st.rttMs = st.rttMs == null ? rttMs : st.rttMs * 0.8 + rttMs * 0.2;
  if (st._prevRttMs != null) {
    const j = Math.abs(rttMs - st._prevRttMs);
    st.rttJitterMs = st.rttJitterMs == null ? j : st.rttJitterMs * 0.8 + j * 0.2;
  }
  st._prevRttMs = rttMs;
  return st;
}

// 目标插值延迟（秒）＝ 基线 0.05 + 单向 RTT(rtt/2000) + 抖动吸收(jitter/4000)，钳 0.05~0.4。
// 抖动权重取 RTT 的一半：局域网典型抖动数 ms 级，只作微调不做主导。
export function targetInterpDelay(rttMs, jitterMs) {
  const base = 0.05 + (rttMs || 0) / 2000 + (jitterMs || 0) / 4000;
  return Math.min(0.4, Math.max(0.05, base));
}
