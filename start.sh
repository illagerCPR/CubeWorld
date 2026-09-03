#!/usr/bin/env bash
# start.sh -- 启动/停止 Vite 开发服务器 / LAN 联机服务器（Linux 版，对标 start.cmd）
# Usage: ./start.sh [start|stop|restart|status|server|server-stop]  (default: start)

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ACTION="${1:-start}"
ACTION="${ACTION,,}"

PORT=5173          # Vite 开发服务器端口（对应 start.cmd 的 PORT）
SERVER_PORT=3001   # LAN 服务器端口（bash 无 cmd 的变量继承问题，index.mjs 直接绑定 3001）

RUN_DIR="$ROOT_DIR/.run"
VITE_PID_FILE="$RUN_DIR/vite.pid"
SERVER_PID_FILE="$RUN_DIR/lan-server.pid"
VITE_OUT="$ROOT_DIR/dev-out.log"
VITE_ERR="$ROOT_DIR/dev-err.log"
SERVER_OUT="$ROOT_DIR/server-out.log"
SERVER_ERR="$ROOT_DIR/server-err.log"
VITE_JS="$ROOT_DIR/node_modules/vite/bin/vite.js"

usage() {
    echo "Usage: ./start.sh [start|stop|restart|status|server|server-stop]"
    echo "  start        Start the Vite dev server (default)"
    echo "  stop         Stop the server"
    echo "  restart      Restart the server"
    echo "  status       Show running status"
    echo "  server       Start the LAN multiplayer server (ws://0.0.0.0:3001/ws)"
    echo "  server-stop  Stop the LAN server"
}

# find_pid PORT -- 查找监听指定 TCP 端口的进程 PID（对标 start.cmd :find_pid 的 netstat 查询）
# 依次尝试 lsof / ss / fuser，用第一个可用者
find_pid() {
    local port="$1" pid=""
    if command -v lsof >/dev/null 2>&1; then
        pid="$(lsof -nP -t -s TCP:LISTEN -i "TCP:$port" 2>/dev/null | head -n1)"
    fi
    if [ -z "$pid" ] && command -v ss >/dev/null 2>&1; then
        pid="$(ss -tlnp 2>/dev/null \
            | awk -v p=":$port" '$4 ~ p"$"' \
            | grep -o 'pid=[0-9]\+' | head -n1 | cut -d= -f2)"
    fi
    if [ -z "$pid" ] && command -v fuser >/dev/null 2>&1; then
        pid="$(fuser -n tcp "$port" 2>/dev/null | tr -s ' \t' '\n' | grep -E '^[0-9]+$' | head -n1)"
    fi
    printf '%s' "$pid"
}

# alive_pid PIDFILE KEYWORD -- 读取 pidfile，仅当进程存活且 cmdline 含 KEYWORD 时返回 PID
# 用于端口查询失败时的兜底；校验身份防止 PID 复用误杀
alive_pid() {
    local f="$1" key="$2" pid cmd
    [ -f "$f" ] || return 0
    pid="$(cat "$f" 2>/dev/null)"
    if [ -z "$pid" ]; then
        rm -f "$f"
        return 0
    fi
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"
    if [ -n "$cmd" ] && printf '%s' "$cmd" | grep -qF "$key"; then
        printf '%s' "$pid"
    else
        rm -f "$f"
    fi
}

# kill_pid PID -- 先 TERM 优雅退出，3 秒后仍存活则 SIGKILL；返回 0 表示进程已终止
kill_pid() {
    local pid="$1" i
    kill "$pid" 2>/dev/null
    for i in 1 2 3 4 5 6; do
        kill -0 "$pid" 2>/dev/null || return 0
        sleep 0.5
    done
    if kill -0 "$pid" 2>/dev/null; then
        echo "WARN: TERM failed, sending SIGKILL ..."
        kill -9 "$pid" 2>/dev/null
        sleep 0.5
    fi
    if kill -0 "$pid" 2>/dev/null; then
        return 1
    fi
    return 0
}

do_start() {
    local pid
    pid="$(find_pid "$PORT")"
    if [ -n "$pid" ]; then
        echo "Server already running, PID=$pid, port $PORT"
        return 0
    fi
    if [ ! -f "$VITE_JS" ]; then
        echo "ERROR: node_modules/vite/bin/vite.js not found. Run \"npm install\" first."
        return 1
    fi
    echo "Starting Vite dev server (http://127.0.0.1:$PORT) ..."
    mkdir -p "$RUN_DIR"
    : > "$VITE_OUT"
    : > "$VITE_ERR"
    # 对标 start.cmd 的 start "vite-dev-server" /MIN：后台常驻，不走 npm run dev
    nohup node "$VITE_JS" >>"$VITE_OUT" 2>>"$VITE_ERR" </dev/null &
    echo "$!" > "$VITE_PID_FILE"
    # 最多等 5 秒确认端口就绪（便于脚本化使用；期间未就绪不视为失败）
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
        sleep 0.5
        pid="$(find_pid "$PORT")"
        [ -n "$pid" ] && break
    done
    if [ -n "$pid" ]; then
        echo "Started in background (PID=$pid, logs: dev-out.log / dev-err.log)"
        echo "Tip: run \"./start.sh stop\" to stop."
    else
        echo "WARN: launched but port $PORT is not listening yet; check dev-err.log or run \"./start.sh status\"."
    fi
    return 0
}

do_stop() {
    local pid
    pid="$(find_pid "$PORT")"
    if [ -z "$pid" ]; then
        pid="$(alive_pid "$VITE_PID_FILE" "bin/vite.js")"
    fi
    if [ -z "$pid" ]; then
        echo "Server is not running."
        rm -f "$VITE_PID_FILE"
        return 0
    fi
    echo "Stopping server process PID=$pid ..."
    if ! kill_pid "$pid"; then
        echo "ERROR: process still running (PID=$pid). Kill it manually (e.g. kill -9 $pid)."
        return 1
    fi
    rm -f "$VITE_PID_FILE"
    echo "Stopped."
    return 0
}

do_restart() {
    # 对标 start.cmd :restart：无论 stop 结果如何都继续 start
    do_stop
    do_start
}

do_status() {
    local pid
    pid="$(find_pid "$PORT")"
    if [ -n "$pid" ]; then
        echo "Running: PID=$pid, port $PORT"
        return 0
    fi
    echo "Not running."
    return 1
}

do_server() {
    if [ ! -d "$ROOT_DIR/server/node_modules/ws" ]; then
        echo "Installing LAN server dependencies ..."
        (cd "$ROOT_DIR/server" && npm install) || return 1
    fi
    echo "Starting LAN server (ws://0.0.0.0:3001/ws) ..."
    mkdir -p "$RUN_DIR"
    : > "$SERVER_OUT"
    : > "$SERVER_ERR"
    # 对标 start.cmd 的 start "lan-server" /MIN
    nohup node "$ROOT_DIR/server/index.mjs" >>"$SERVER_OUT" 2>>"$SERVER_ERR" </dev/null &
    local pid=$!
    echo "$pid" > "$SERVER_PID_FILE"
    echo "Started LAN server in background (PID=$pid, logs: server-out.log / server-err.log)."
    echo "Stop with \"./start.sh server-stop\"."
    return 0
}

do_server_stop() {
    local pid
    pid="$(alive_pid "$SERVER_PID_FILE" "server/index.mjs")"
    if [ -z "$pid" ]; then
        pid="$(find_pid "$SERVER_PORT")"
    fi
    if [ -z "$pid" ]; then
        pid="$(pgrep -f 'node .*server/index\.mjs' 2>/dev/null | head -n1)"
    fi
    if [ -z "$pid" ]; then
        echo "LAN server is not running."
        rm -f "$SERVER_PID_FILE"
        return 0
    fi
    echo "Stopping LAN server process PID=$pid ..."
    kill_pid "$pid"
    rm -f "$SERVER_PID_FILE"
    echo "LAN server stopped."
    return 0
}

case "$ACTION" in
    start)          do_start ;;
    stop)           do_stop ;;
    restart)        do_restart ;;
    status)         do_status ;;
    server)         do_server ;;
    server-stop)    do_server_stop ;;
    -h|--help|help) usage ;;
    *)              usage; exit 1 ;;
esac
