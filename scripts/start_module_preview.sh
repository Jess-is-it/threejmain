#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  ./scripts/start_module_preview.sh <agent> <module-name> [task-name]

Example:
  ./scripts/start_module_preview.sh codex-3 billing billing-form-modals

Starts or restarts this Codex session's isolated preview stack on unique ports.
This is for fast visual checks only; Integration Codex still combines module work
into staging.
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ "$#" -lt 2 ]; then
  usage
  exit 0
fi

AGENT="$1"
MODULE_NAME="$2"
TASK_NAME="${3:-module-preview}"

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
MAIN_REPO="${MAIN_REPO:-/home/threejmain}"
AI_COORD_STATE_DIR="${AI_COORD_STATE_DIR:-/home/threejmain/.ai_coord}"
PREVIEW_ROOT="${PROJECT_ROOT}/.preview/${AGENT}"
RUNTIME_LOCK="runtime/preview/${AGENT}"

case "$AGENT" in
  codex-[0-9]*)
    AGENT_NUMBER="${AGENT#codex-}"
    ;;
  *)
    echo "ERROR: agent must look like codex-N, for example codex-3."
    exit 1
    ;;
esac

API_PORT="${MODULE_PREVIEW_API_PORT:-$((8200 + AGENT_NUMBER))}"
WEB_PORT="${MODULE_PREVIEW_WEB_PORT:-$((8300 + AGENT_NUMBER))}"
API_URL="http://127.0.0.1:${API_PORT}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"

cd "$PROJECT_ROOT"
export AI_COORD_STATE_DIR

if [ ! -d "$MODULE_NAME" ]; then
  echo "ERROR: module folder not found: $MODULE_NAME"
  exit 1
fi

if [ ! -d "app-shell/api/app" ] || [ ! -d "app-shell/web" ]; then
  echo "ERROR: app-shell/api/app or app-shell/web is missing."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is required to start the web preview."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required for preview health checks."
  exit 1
fi

if ! python3 -c "import uvicorn" >/dev/null 2>&1; then
  echo "ERROR: uvicorn is not installed for python3."
  echo "Install API dependencies first, for example:"
  echo "  python3 -m pip install -r app-shell/api/requirements.txt"
  exit 1
fi

mkdir -p "$PREVIEW_ROOT"

cleanup_lock() {
  python3 "$MAIN_REPO/scripts/ai_coord.py" unlock "$RUNTIME_LOCK" "$AGENT" >/dev/null 2>&1 || true
}

echo "Checking coordination before preview runtime change..."
python3 "$MAIN_REPO/scripts/ai_coord.py" recent --limit 5 || true
python3 "$MAIN_REPO/scripts/ai_coord.py" locks || true
python3 "$MAIN_REPO/scripts/ai_coord.py" lock "$RUNTIME_LOCK" "$AGENT" "$TASK_NAME" "Start/restart isolated preview runtime for ${MODULE_NAME}"
trap cleanup_lock EXIT

stop_if_running() {
  local name="$1"
  local pid_file="$2"

  if [ ! -f "$pid_file" ]; then
    return 0
  fi

  local pid
  pid="$(cat "$pid_file")"

  if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
    echo "Stopping previous ${name} preview process: ${pid}"
    kill "$pid" >/dev/null 2>&1 || true
    sleep 1
  fi

  rm -f "$pid_file"
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local log_file="$3"

  for _ in $(seq 1 40); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "${label} is ready: ${url}"
      return 0
    fi
    sleep 0.5
  done

  echo "ERROR: ${label} did not become ready: ${url}"
  echo "Last log lines from ${log_file}:"
  tail -n 80 "$log_file" || true
  return 1
}

API_PID_FILE="${PREVIEW_ROOT}/api.pid"
WEB_PID_FILE="${PREVIEW_ROOT}/web.pid"
API_LOG="${PREVIEW_ROOT}/api.log"
WEB_LOG="${PREVIEW_ROOT}/web.log"
PORTS_FILE="${PREVIEW_ROOT}/ports.env"

stop_if_running "API" "$API_PID_FILE"
stop_if_running "web" "$WEB_PID_FILE"

cat > "$PORTS_FILE" <<EOF
AGENT=${AGENT}
MODULE_NAME=${MODULE_NAME}
API_PORT=${API_PORT}
WEB_PORT=${WEB_PORT}
API_URL=${API_URL}
WEB_URL=${WEB_URL}
PROJECT_ROOT=${PROJECT_ROOT}
EOF

echo "Starting API preview on ${API_URL}..."
(
  cd "$PROJECT_ROOT"
  export PYTHONPATH="${PROJECT_ROOT}/app-shell/api"
  export CORS_ALLOW_ORIGINS="http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}"
  exec python3 -m uvicorn app.main:app \
    --app-dir "${PROJECT_ROOT}/app-shell/api" \
    --host 0.0.0.0 \
    --port "$API_PORT" \
    --reload
) >"$API_LOG" 2>&1 &
echo "$!" > "$API_PID_FILE"

wait_for_url "API preview" "${API_URL}/health" "$API_LOG"

echo "Starting web preview on ${WEB_URL}..."
(
  cd "$PROJECT_ROOT/app-shell/web"
  export VITE_DEV_PORT="$WEB_PORT"
  export VITE_API_TARGET="$API_URL"
  exec npm run dev -- --host 0.0.0.0
) >"$WEB_LOG" 2>&1 &
echo "$!" > "$WEB_PID_FILE"

wait_for_url "Web preview" "$WEB_URL" "$WEB_LOG"

python3 "$MAIN_REPO/scripts/ai_coord.py" update "$AGENT" "$TASK_NAME" "Started isolated preview for ${MODULE_NAME}: web ${WEB_URL}, API ${API_URL}" --files "$RUNTIME_LOCK" "$MODULE_NAME" || true

echo
echo "Module preview is running."
echo "Agent:      ${AGENT}"
echo "Module:     ${MODULE_NAME}"
echo "Web URL:    ${WEB_URL}"
echo "API URL:    ${API_URL}"
echo "API log:    ${API_LOG}"
echo "Web log:    ${WEB_LOG}"
echo
echo "To restart after code changes, run this script again from the same worktree."
echo "To stop manually:"
echo "  kill \$(cat ${API_PID_FILE}) \$(cat ${WEB_PID_FILE})"
