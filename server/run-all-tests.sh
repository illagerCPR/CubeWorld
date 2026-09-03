#!/usr/bin/env bash
# run-all-tests.sh -- 一键回归：清状态 → 起真实服务器 → 跑全部 6 个套件 → 停服
# 任何套件失败则整体退出 1；CI 与本地共用同一入口（本地须在 3001 空闲时执行）

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

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
for t in test-mp test-store test-admin test-stage5 test-stage6 test-stage10; do
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
