#!/usr/bin/env bash
set -euo pipefail

# Run the browse and search API that backs the file explorer.
#
# Usage:
#   ./explorer.sh start     run in the background, log to /tmp/nginx-explorer.log
#   ./explorer.sh stop      stop the background process
#   ./explorer.sh status    report whether the API answers
#   ./explorer.sh run       run in the foreground

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="${SCRIPT_DIR}/explorer-server.py"
# shellcheck source=platform.sh
source "${SCRIPT_DIR}/platform.sh"
ROOT="$NGINX_ROOT"
PORT="${EXPLORER_PORT:-7576}"
PIDFILE="${EXPLORER_PIDFILE:-/tmp/nginx-explorer.pid}"
BASE="$NGINX_BASE_URL"
LOGFILE="${EXPLORER_LOG:-/tmp/nginx-explorer.log}"

die() { echo "$*" >&2; exit 1; }

python_bin() {
  local candidate
  for candidate in python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  die "No python3 on PATH."
}

running() {
  [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

cmd_start() {
  if running; then
    echo "Already running (pid $(cat "$PIDFILE")) on port ${PORT}."
    return 0
  fi
  local py
  py="$(python_bin)"
  nohup "$py" "$SERVER" --root "$ROOT" --port "$PORT" >"$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  for _ in 1 2 3; do
    sleep 1
    if curl -fsS --max-time 1 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
      break
    fi
  done
  if ! curl -fsS --max-time 1 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    rm -f "$PIDFILE"
    cat "$LOGFILE" >&2 || true
    die "Failed to start a healthy Explorer API. See ${LOGFILE}"
  fi
  echo "Explorer API on 127.0.0.1:${PORT} (pid $(cat "$PIDFILE")), log ${LOGFILE}"
  echo "Open ${BASE}/"
}

cmd_stop() {
  running || { echo "Not running."; rm -f "$PIDFILE"; return 0; }
  local pid
  pid="$(cat "$PIDFILE")"
  kill "$pid"
  rm -f "$PIDFILE"
  echo "Stopped pid ${pid}."
}

cmd_status() {
  if running; then
    echo "Process: pid $(cat "$PIDFILE")"
  else
    echo "Process: not running"
  fi
  if command -v curl >/dev/null 2>&1; then
    echo -n "API: "
    curl -s --max-time 3 "http://127.0.0.1:${PORT}/api/health" || echo "no answer"
    echo
  fi
}

cmd_run() {
  exec "$(python_bin)" "$SERVER" --root "$ROOT" --port "$PORT"
}

case "${1:-}" in
  start)  cmd_start ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  run)    cmd_run ;;
  *)      sed -n '4,10p' "$0" | sed 's/^# \{0,1\}//' ; exit 1 ;;
esac
