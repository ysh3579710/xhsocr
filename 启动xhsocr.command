#!/bin/bash
set -Eeuo pipefail

# Fill in your current OpenRouter key here before using cloud LLM features.
OPENROUTER_API_KEY="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"
OPENROUTER_MODEL="openai/gpt-5-mini"

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
RUN_DIR="$ROOT/.run/launcher"
REDIS_DIR="$ROOT/.run/redis-6380"
REDIS_PORT=6380
API_PORT=8001
WEB_PORT=3000
WORKER_COUNT=5
CHILD_PIDS=""
REDIS_PID=""
PG_STARTED_BY_SCRIPT=0
PG_FORMULA=""

mkdir -p "$RUN_DIR" "$REDIS_DIR"

say() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { say "启动失败：$*"; exit 1; }

port_open() { nc -z 127.0.0.1 "$1" >/dev/null 2>&1; }
wait_for_port() {
  local port="$1" label="$2" tries="${3:-60}"
  for ((i=1; i<=tries; i++)); do
    port_open "$port" && return 0
    sleep 1
  done
  fail "$label 未能在端口 $port 就绪。查看 $RUN_DIR 中的日志。"
}
wait_for_api() {
  for ((i=1; i<=60; i++)); do
    if curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  fail "API 健康检查未通过。查看 $RUN_DIR/api.log。"
}
check_free_port() {
  if port_open "$1"; then
    fail "端口 $1 已被占用；请先确认对应服务，避免重复启动。"
  fi
  return 0
}
start_logged() {
  local label="$1" log="$2"; shift 2
  "$@" >>"$RUN_DIR/$log" 2>&1 &
  CHILD_PIDS="$CHILD_PIDS $!"
  say "$label 已启动，日志：$RUN_DIR/$log"
}
stop_all() {
  trap - INT TERM EXIT
  if [[ -z "$CHILD_PIDS" && -z "$REDIS_PID" && "$PG_STARTED_BY_SCRIPT" -eq 0 ]]; then return; fi
  say "正在按顺序停止 Worker、API、前端、Redis。"
  for pid in $CHILD_PIDS; do kill -TERM "$pid" 2>/dev/null || true; done
  if [[ -n "$REDIS_PID" ]]; then kill -TERM "$REDIS_PID" 2>/dev/null || true; fi
  for pid in $CHILD_PIDS; do wait "$pid" 2>/dev/null || true; done
  if [[ -n "$REDIS_PID" ]]; then wait "$REDIS_PID" 2>/dev/null || true; fi
  if (( PG_STARTED_BY_SCRIPT )); then
    say "停止本脚本启动的 PostgreSQL 服务。"
    brew services stop "$PG_FORMULA" >/dev/null 2>&1 || true
  fi
  say "服务已停止。"
}
trap stop_all INT TERM EXIT

[[ -d "$BACKEND/.venv" ]] || fail "找不到后端虚拟环境：$BACKEND/.venv。请先按项目指南安装依赖。"
[[ -x "$FRONTEND/node_modules/.bin/next" ]] || fail "前端依赖未安装：请先在 frontend 执行 npm install。"
command -v brew >/dev/null || fail "找不到 Homebrew。"
command -v nc >/dev/null || fail "系统缺少 nc 命令。"
command -v curl >/dev/null || fail "系统缺少 curl 命令。"

say "项目目录：$ROOT"
for port in "$API_PORT" "$WEB_PORT" "$REDIS_PORT"; do check_free_port "$port"; done

# The repository defaults to PostgreSQL on 5432. Reuse an existing server;
# otherwise start an installed Homebrew PostgreSQL service.
if port_open 5432; then
  say "PostgreSQL 已在 5432 运行，将复用现有服务。"
else
  while read -r formula _; do
    if [[ "$formula" == postgresql* ]]; then PG_FORMULA="$formula"; fi
  done < <(brew list --versions 2>/dev/null)
  [[ -n "$PG_FORMULA" ]] || fail "未发现运行中的 PostgreSQL 或已安装的 Homebrew PostgreSQL。"
  brew services start "$PG_FORMULA" >/dev/null || fail "无法启动 PostgreSQL（$PG_FORMULA）。"
  PG_STARTED_BY_SCRIPT=1
  wait_for_port 5432 PostgreSQL 60
  say "PostgreSQL 已就绪（5432）。"
fi

say "启动独立 Redis（6380）。"
REDIS_BIN="$(brew --prefix redis 2>/dev/null)/bin/redis-server"
[[ -x "$REDIS_BIN" ]] || REDIS_BIN="$(command -v redis-server || true)"
[[ -x "$REDIS_BIN" ]] || fail "找不到 redis-server，请先安装 Redis。"
"$REDIS_BIN" --bind 127.0.0.1 --port "$REDIS_PORT" --dir "$REDIS_DIR" \
  --save '' --appendonly no --timeout 0 --tcp-keepalive 60 \
  >>"$RUN_DIR/redis.log" 2>&1 &
REDIS_PID="$!"
wait_for_port "$REDIS_PORT" Redis 30
REDIS_CLI="$(brew --prefix redis 2>/dev/null)/bin/redis-cli"
[[ -x "$REDIS_CLI" ]] || REDIS_CLI="$(command -v redis-cli || true)"
[[ -x "$REDIS_CLI" ]] && [[ "$("$REDIS_CLI" -p "$REDIS_PORT" ping 2>/dev/null)" == "PONG" ]] || fail "Redis 6380 未返回 PONG。"

DATABASE_URL="postgresql+psycopg://xhsocr:change_me@127.0.0.1:5432/xhsocr"
API_REDIS_URL="redis://127.0.0.1:$REDIS_PORT/0?socket_connect_timeout=5&socket_timeout=15&socket_keepalive=true&health_check_interval=30"
WORKER_REDIS_URL="redis://127.0.0.1:$REDIS_PORT/0?socket_connect_timeout=10&socket_timeout=900&socket_keepalive=true&health_check_interval=30"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
APP_CORS_ORIGINS="http://localhost:$WEB_PORT,http://127.0.0.1:$WEB_PORT${LAN_IP:+,http://$LAN_IP:$WEB_PORT}"

say "启动 API（8001）。"
start_logged API api.log env DATABASE_URL="$DATABASE_URL" REDIS_URL="$API_REDIS_URL" \
  LLM_PROVIDER=openrouter OPENROUTER_API_KEY="$OPENROUTER_API_KEY" \
  OPENROUTER_MODEL="$OPENROUTER_MODEL" OCR_PROVIDER=rapidocr_onnxruntime \
  OCR_TIMEOUT_SECONDS=90 OCR_ISOLATE_SUBPROCESS=true APP_CORS_ORIGINS="$APP_CORS_ORIGINS" \
  bash -c 'cd "$1" && source .venv/bin/activate && exec uvicorn app.main:app --host 0.0.0.0 --port 8001' _ "$BACKEND"
wait_for_api
say "API 健康检查通过。"

say "启动前端（3000）。"
FRONTEND_API_HOST="${LAN_IP:-127.0.0.1}"
start_logged 前端 frontend.log env NEXT_PUBLIC_API_BASE_URL="http://$FRONTEND_API_HOST:$API_PORT" \
  bash -c 'cd "$1" && exec ./node_modules/.bin/next dev --hostname 0.0.0.0 --port 3000' _ "$FRONTEND"
wait_for_port "$WEB_PORT" 前端 60

say "启动 $WORKER_COUNT 个 Worker。"
for ((n=1; n<=WORKER_COUNT; n++)); do
  start_logged "Worker $n" "worker-$n.log" env DATABASE_URL="$DATABASE_URL" \
    REDIS_URL="$WORKER_REDIS_URL" LLM_PROVIDER=openrouter \
    OPENROUTER_API_KEY="$OPENROUTER_API_KEY" OPENROUTER_MODEL="$OPENROUTER_MODEL" \
    OCR_PROVIDER=rapidocr_onnxruntime OCR_TIMEOUT_SECONDS=90 OCR_ISOLATE_SUBPROCESS=true \
    bash -c 'cd "$1" && source .venv/bin/activate; worker_pid=""; stop_worker(){ [[ -z "$worker_pid" ]] || kill -TERM "$worker_pid" 2>/dev/null || true; }; trap stop_worker INT TERM; while true; do python worker.py & worker_pid=$!; wait "$worker_pid"; code=$?; worker_pid=""; echo "Worker 退出码：$code，3 秒后重启"; sleep 3; done' _ "$BACKEND"
done

say "全部服务已启动。"
say "本机访问：http://localhost:$WEB_PORT"
[[ -n "$LAN_IP" ]] && say "局域网访问：http://$LAN_IP:$WEB_PORT"
say "按 Ctrl+C 按顺序停止本次启动的服务。日志目录：$RUN_DIR"
while true; do sleep 3600; done
