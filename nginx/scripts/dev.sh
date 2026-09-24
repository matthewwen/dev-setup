#!/usr/bin/env bash
set -euo pipefail

# Throwaway dev loop: rebuilds the app on save and serves it through a
# second nginx on a high port, without touching the installed server.
#
# Usage:
#   npm run dev
#   ./scripts/dev.sh [--port <n>]
#
# Ctrl-C stops the watcher; the trap below then stops the throwaway nginx
# and removes its temp config dir.

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PORT=8089
if [[ "${1:-}" == "--port" ]]; then
  PORT="${2:-8089}"
fi

command -v nginx >/dev/null 2>&1 || { echo "nginx is not installed." >&2; exit 1; }

T="$(mktemp -d)"
mkdir -p "$T/etc" "$T/www" "$T/log"
cp "$(nginx -V 2>&1 | tr ' ' '\n' | sed -n 's|--conf-path=||p' | xargs dirname)/mime.types" "$T/etc/"

WATCH_PID=""
# Stop the watcher and wait for it first: a rebuild still in flight would
# otherwise write into $T after the rm and leave the temp dir behind.
cleanup() {
  if [[ -n "$WATCH_PID" ]]; then
    kill "$WATCH_PID" 2>/dev/null || true
    wait "$WATCH_PID" 2>/dev/null || true
  fi
  if [[ -f "$T/etc/nginx.pid" ]]; then
    nginx -c "$T/etc/nginx.conf" -p "$T" -s stop 2>/dev/null || true
  fi
  rm -rf "$T"
}
trap cleanup EXIT

echo "Dev nginx config: $T"
NGINX_DIR="$T/etc" NGINX_ROOT="$T/www" NGINX_LOG_DIR="$T/log" NGINX_PID="$T/etc/nginx.pid" \
  NGINX_TEMP_DIR="$T/tmp" "${BASE_DIR}/install.sh" --port "$PORT" --no-services

nginx -c "$T/etc/nginx.conf" -p "$T"

echo
echo "  http://localhost:${PORT}/"
echo "  Symlink a directory into ${T}/www to browse content, e.g.:"
echo "    ln -s ~/some/project ${T}/www/project"
echo

cd "$BASE_DIR"
node build.mts --dev --watch --out "$T/etc/dev-setup/app" &
WATCH_PID=$!
wait "$WATCH_PID" || true
