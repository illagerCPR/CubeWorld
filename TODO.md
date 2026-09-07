# TODO.md — 项目创意/提案暂存

> 已评审但暂缓排期的提案记录在此。恢复排期时从对应 Idea 的"前置条件"开始。

---

## Idea-1: 光照视觉增强 L4 —— 平面真反射 / 真实阴影贴图（A、B 均已交付）

- **状态**：A（平面真反射）已交付；B（阴影贴图）可行性探针**通过**（死结有绕法，见 AGENTS.md L4-B 备忘），批次①（打通）与批次②（snap 调校）均已交付；C（SSAO）按评审结论不做。
  （L1-L3：L1 `acd9425`、L2 `d6e497a`、L3 `f47382e`；L4-A/B：见 git log）
- **本条目已完结**。后续微调（影子强度/边缘/水面影子等）走正常迭代，不再挂 TODO。
- **推荐顺序**：先 A（平面反射）后 B（阴影贴图）；C（SSAO）不做或仅在关闭平滑光照时作为替代。

### A. 平面真反射（半分辨率 Reflector）

- **原理**：镜像相机（沿水面 y=64 翻转）二次渲染全场景到独立 RT，水面片元投影 UV 采样，乘菲涅尔混入。
- **难点**：
  1. 每帧第二次全场景渲染（169 区块 × 3 mesh），几何成本 ×2，真实 GPU 约 +30-50% 帧时间，须独立子开关；
  2. 水面自反射递归——反射 pass 需排除全部 water mesh（建议新增 layer 2 作反射排除层，layer 1 已被天体占用）；
  3. 幸运简化：所有水顶面都在 SEA_LEVEL=64，可假设唯一反射平面，oblique near-plane 裁剪只需一套参数；眼睛在水中时整体禁用并防闪帧；
  4. `applyVoxelLightWater` 注入重构：RT 反射**替换**现有菲涅尔天空色项（有 RT 用 RT、无 RT 回退），需波纹 UV 偏移采样 + 屏幕边缘 clamp/fade，uniform 翻倍；
  5. 反射画面不走 bloom/色调映射（链路位置决定），反射里的太阳无光晕——廉价反射通病，接受；
  6. 软渲染环境完全不可测性能，CI 守不住性能回归。
- **工作量**：1 批次。风险集中在集成面，不碰 shader 内部。

### B. 真实阴影贴图

- **原理**：方向光渲全场景深度到 shadow map，地面片元采样压暗。
- **难点**：
  1. **MeshBasicMaterial 不接收阴影（死结级）**：需 `material.lights=true` 硬改 + onBeforeCompile 手工补 shadow chunk 链（`shadowmap_pars_vertex/fragment`、`shadowmap_vertex/fragment`、worldPosition/vNormal varying、`directionalLightShadows` 结构体），片元手工调 `getShadow()` 乘进体素光公式——**与 three 版本强耦合，升级 0.160 可能静默失效，这是"风险最高"的本质**；
  2. shadow camera 覆盖 96-192 格 × 高度 0-256（depth 精度稀释），**必须 snap-to-texel**（位置按 texel 取整）防走路阴影游移闪烁；
  3. 太阳连续移动无法缓存——每 N 帧更新 shadow map 摊薄成本（角速度 0.03°/s，10 帧无视觉差），但与太阳视觉位置有滞后需实测；
  4. 与体素光语义冲突（设计难点）：树冠下天光 12-13 + 阴影再压 = 双重变暗。解法 = 阴影权重随 skyL 衰减（`shadowW = uShadowStrength * vVoxelLight.x`，varying 已有），影子含义从"方块遮挡"变为"太阳直射差"——核心卖点也是最难调得不像 bug 的部分（正午影子缩成脚下一团）；
  5. bias/薄片：1m 立方 + cross 双面薄片 + 256 高度 range → acne 与 peter-panning 都会出，normalBias 实测调；夜晚月光阴影直接关；
  6. 额外一次全场景 depth pass（MeshDepthMaterial override 可隔帧）。怪物 MeshLambertMaterial 天生支持——验收时防"只有怪有影子"的完成度错觉。
- **工作量**：2 批次（①chunk 注入打通+静态验证；②snap-to-texel+隔帧+融合调校）。
- **失败模式**：①走不通（Basic 上 chunk 注入有隐藏依赖）→ 停在 L3。

### C. SSAO/GTAO（不推荐主做）

- 需深度+法线双 prepass（Basic 无 MRT 法线，第三遍场景或深度重建）；收益与烘焙 AO 重叠（体素 AO 已表达方块角落暗化，SSAO 增量仅大树冠/屋檐尺度）；成本半分辨率+去噪不低。若做：GTAOPass(three 0.160 自带)半分辨率 + 强度 ≤0.4 + 与平滑光照互斥。

### 共性工程问题（三项都躲不开）

1. "关闭档逐字节现状"回归基线重验（L2 曾因光材质提亮泄漏被迫引入 `GfxState` 门控）；
2. 帧预算叠加：完整档已 3 pass，L4 再 +1 次场景级渲染——可能需要帧时间监视自动降级子系统（本身也是工作量）；
3. B 方案把项目钉死在 three 0.160 的 shader chunk 结构；
4. 软渲染验证盲区：性能与闪烁类问题（阴影游移/反射边缘）只能靠用户真机复核，迭代周期变长。

### 前置条件（恢复排期时）

1. B 方案先做 **1 天可行性探针**：Basic + lights=true + 手工 shadow chunk 在最小场景跑通 `getShadowMask()`；探针不通过则 B 永久搁置；
2. 用户真机确认 L1-L3 完整档帧率可接受（当前软渲染数据无参考价值）；
3. 恢复时从 A 开始排期，B 视探针结果决定。
