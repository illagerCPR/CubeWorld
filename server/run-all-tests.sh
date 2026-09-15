#!/usr/bin/env bash
# run-all-tests.sh -- 一键回归：结构确定性（无需服务器）→ 清状态 → 起真实服务器 → 跑全部 6 个套件 → 停服
# 任何套件失败则整体退出 1；CI 与本地共用同一入口（本地须在 3001 空闲时执行）

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# 结构生成确定性回归（纯 node，不依赖服务器；放最前避免占用 3001 端口检查）
echo "=== structure-determinism ==="
if node tests/structure-determinism.mjs; then
    echo "structure-determinism: OK"
else
    echo "structure-determinism: FAILED"
    exit 1
fi

# T5 战利品/交易表确定性回归（纯 node）
echo "=== loot-determinism ==="
if node tests/loot-determinism.mjs; then
    echo "loot-determinism: OK"
else
    echo "loot-determinism: FAILED"
    exit 1
fi

# W3 洞穴生成回归（纯 node）
echo "=== cave-determinism ==="
if node tests/cave-determinism.mjs; then
    echo "cave-determinism: OK"
else
    echo "cave-determinism: FAILED"
    exit 1
fi

# 主世界群系回归（纯 node：确定性/在场占比/高山海拔锚点/相邻列连续性）
echo "=== biome-determinism ==="
if node tests/biome-determinism.mjs; then
    echo "biome-determinism: OK"
else
    echo "biome-determinism: FAILED"
    exit 1
fi

# 维度地形生成回归（纯 node：下界等已实现维度的确定性/顺序无关/出生点安全）
echo "=== dimension-determinism ==="
if node tests/dimension-determinism.mjs; then
    echo "dimension-determinism: OK"
else
    echo "dimension-determinism: FAILED"
    exit 1
fi

# 生物群系规模档位回归（纯 node：small 与旧版逐字节一致/档位单调放大/清洗兜底）
echo "=== biome-scale-determinism ==="
if node tests/biome-scale-determinism.mjs; then
    echo "biome-scale-determinism: OK"
else
    echo "biome-scale-determinism: FAILED"
    exit 1
fi

# 传送门逻辑回归（纯 node：框校验/填充/拆门清波/自动返程门/账本搜门）
echo "=== portals-unit ==="
if node tests/portals-unit.mjs; then
    echo "portals-unit: OK"
else
    echo "portals-unit: FAILED"
    exit 1
fi

# 下界要塞结构回归（纯 node：维度作用域/记录自洽/布局确定性/区块落地/战利品表）
echo "=== nether-fortress ==="
if node tests/nether-fortress.mjs; then
    echo "nether-fortress: OK"
else
    echo "nether-fortress: FAILED"
    exit 1
fi

# 下界怪物回归（纯 node：类型注册/模型一致/生成表分布/中立悬浮标记）
echo "=== nether-mobs ==="
if node tests/nether-mobs.mjs; then
    echo "nether-mobs: OK"
else
    echo "nether-mobs: FAILED"
    exit 1
fi

# 下界烬火纪基石（世界观批次 N1：ember_stele/mourn_tear/方块 lore/碑文跨维度 dim 完备）
echo "=== nether-steles ==="
if node tests/nether-steles.mjs; then
    echo "nether-steles: OK"
else
    echo "nether-steles: FAILED"
    exit 1
fi

# 潮火之炉（世界观批次 N2：选址确定性/落地/三向注册/要塞碑位/FORCED 哀潮之泪）
echo "=== nether-structures ==="
if node tests/nether-structures.mjs; then
    echo "nether-structures: OK"
else
    echo "nether-structures: FAILED"
    exit 1
fi

# 主世界雨土纪基石（世界观批次 W1：moss_stele/page_rain/凋灵骷髅头 lore/雨土纪 3 章）
echo "=== overworld-steles ==="
if node tests/overworld-steles.mjs; then
    echo "overworld-steles: OK"
else
    echo "overworld-steles: FAILED"
    exit 1
fi

# 潮冢（世界观批次 W2：河段锚点选址/显式水填/三向注册/陆地零命中/FORCED 雨潮残页）
echo "=== overworld-structures ==="
if node tests/overworld-structures.mjs; then
    echo "overworld-structures: OK"
else
    echo "overworld-structures: FAILED"
    exit 1
fi

# 末地外岛锚点场回归（纯 node：群系在场/密度带宽/锚点确定性/群系方块同源）
echo "=== end-islands ==="
if node tests/end-islands.mjs; then
    echo "end-islands: OK"
else
    echo "end-islands: FAILED"
    exit 1
fi

# 末地·无潮彼岸基石（世界观批次 E1：界纹石碑注册/彼岸碑文 2 章/拾遗者体系 lore/龙留白纪律）
echo "=== end-steles ==="
if node tests/end-steles.mjs; then
    echo "end-steles: OK"
else
    echo "end-steles: FAILED"
    exit 1
fi

# 拾遗者石环 + 主岛守望界碑（世界观批次 E2：密度预案/高原门控/三向注册/对拍/守望碑位/不变量绊线）
echo "=== end-structures ==="
if node tests/end-structures.mjs; then
    echo "end-structures: OK"
else
    echo "end-structures: FAILED"
    exit 1
fi

# 终局篇 F1 候潮基石（原初祭坛/原初纹章注册、龙蛋 lore、i18n 盲区键、接线绊线）
echo "=== endgame-content ==="
if node tests/endgame-content.mjs; then
    echo "endgame-content: OK"
else
    echo "endgame-content: FAILED"
    exit 1
fi

# 终局篇 F2 四界同潮演出管线（段配置/包络确定性/还原纯度绊线/零持久化）
echo "=== endgame-tide ==="
if node tests/endgame-tide.mjs; then
    echo "endgame-tide: OK"
else
    echo "endgame-tide: FAILED"
    exit 1
fi

# 终局篇 F3 听潮仪式（门控真值表/状态序列化/协议链路/龙影绊线/BUILD 18）
echo "=== endgame-finale ==="
if node tests/endgame-finale.mjs; then
    echo "endgame-finale: OK"
else
    echo "endgame-finale: FAILED"
    exit 1
fi

# 鲸骨冢篇 K1（鲸骨块注册/归云章/solve 确定性/选址拒绝/箱表/探索列表绊线）
echo "=== whale-barrow ==="
if node tests/whale-barrow.mjs; then
    echo "whale-barrow: OK"
else
    echo "whale-barrow: FAILED"
    exit 1
fi

# 末影龙 Boss 回归（纯 node：类型注册/柱顶水晶/DragonAI 状态机/击败链路/末地门控）
echo "=== end-dragon ==="
if node tests/end-dragon.mjs; then
    echo "end-dragon: OK"
else
    echo "end-dragon: FAILED"
    exit 1
fi

# 龙败奖励链回归（纯 node：折跃门注册/选址/建门/角度配对/返程喷泉门/幂等门控）
echo "=== end-gateway ==="
if node tests/end-gateway.mjs; then
    echo "end-gateway: OK"
else
    echo "end-gateway: FAILED"
    exit 1
fi

# 末地城结构回归（纯 node：方块/潜影贝注册/选址漏斗/落地/箱子三向/loot 保底/确定性）
echo "=== end-city ==="
if node tests/end-city.mjs; then
    echo "end-city: OK"
else
    echo "end-city: FAILED"
    exit 1
fi

# 天域三结构回归（纯 node：维度作用域/选址漏斗/落地/箱子三向/loot/确定性）
echo "=== aether-structures ==="
if node tests/aether-structures.mjs; then
    echo "aether-structures: OK"
else
    echo "aether-structures: FAILED"
    exit 1
fi

# 天域生物回归（纯 node：类型注册/模型/生成表分布/悬浮被动标记）
echo "=== aether-mobs ==="
if node tests/aether-mobs.mjs; then
    echo "aether-mobs: OK"
else
    echo "aether-mobs: FAILED"
    exit 1
fi

# 天域叙事基石回归（纯 node：方块/物品注册/分类/碑文章节表/石碑注册表/id 追加纪律）
echo "=== aether-content ==="
if node tests/aether-content.mjs; then
    echo "aether-content: OK"
else
    echo "aether-content: FAILED"
    exit 1
fi

# 守誓巨像回归（纯 node：注册/状态机/齐射震地回调/图腾配方）
echo "=== aether-boss ==="
if node tests/aether-boss.mjs; then
    echo "aether-boss: OK"
else
    echo "aether-boss: FAILED"
    exit 1
fi

# 语言包三重校验（纯 node：10 包键集对齐/占位符对齐/静态∪动态键覆盖审计/重复键扫描）
echo "=== i18n-parity ==="
if node tests/i18n-parity.mjs; then
    echo "i18n-parity: OK"
else
    echo "i18n-parity: FAILED"
    exit 1
fi

# 测试非幂等：先确认 3001 空闲，再清空运行时数据保证干净状态
if (exec 3<>/dev/tcp/127.0.0.1/3001) 2>/dev/null; then
    exec 3>&- 3<&- 2>/dev/null
    echo "ERROR: port 3001 already in use. Stop the LAN server first (./start.sh server-stop)." >&2
    exit 1
fi
rm -rf server/world
rm -f server/config.json

./start.sh server >/dev/null 2>&1

# 等端口 3001 就绪（最多 10 秒）
port_ready=0
for i in $(seq 1 20); do
    if (exec 3<>/dev/tcp/127.0.0.1/3001) 2>/dev/null; then
        exec 3>&- 3<&- 2>/dev/null
        port_ready=1
        break
    fi
    sleep 0.5
done
if [ "$port_ready" -ne 1 ]; then
    echo "ERROR: LAN server did not listen on 3001 in time. See server-err.log." >&2
    ./start.sh server-stop >/dev/null 2>&1
    exit 1
fi

failed=0
for t in test-mp test-store test-admin test-stage5 test-stage6 test-stage10 test-stage11 test-idea2 test-profile test-idea4 test-t5 test-dim; do
    echo "=== $t ==="
    if node "server/$t.mjs"; then
        echo "$t: OK"
    else
        echo "$t: FAILED"
        failed=1
    fi
done

./start.sh server-stop >/dev/null 2>&1

if [ "$failed" -ne 0 ]; then
    echo "RESULT: FAILED"
    exit 1
fi
echo "RESULT: ALL PASS"
