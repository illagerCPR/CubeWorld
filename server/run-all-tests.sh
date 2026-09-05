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

# 维度地形生成回归（纯 node：下界等已实现维度的确定性/顺序无关/出生点安全）
echo "=== dimension-determinism ==="
if node tests/dimension-determinism.mjs; then
    echo "dimension-determinism: OK"
else
    echo "dimension-determinism: FAILED"
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

# 末地外岛锚点场回归（纯 node：群系在场/密度带宽/锚点确定性/群系方块同源）
echo "=== end-islands ==="
if node tests/end-islands.mjs; then
    echo "end-islands: OK"
else
    echo "end-islands: FAILED"
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
for t in test-mp test-store test-admin test-stage5 test-stage6 test-stage10 test-t5 test-dim; do
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
