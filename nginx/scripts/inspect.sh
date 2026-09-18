#!/usr/bin/env bash
set -euo pipefail

# Serve Inspect AI (inspect_ai) eval logs through the local nginx.
#
# Usage:
#   ./inspect.sh viewer                 install the shared viewer for *.eval URLs
#   ./inspect.sh embed <log-dir>        write the static viewer into a log dir
#   ./inspect.sh serve [log-dir]        run the live viewer for inspect.localhost
#   ./inspect.sh link <dir> [name]      expose a directory under the webroot
#   ./inspect.sh url <path>             print the http URL for a path
#   ./inspect.sh bundle <log-dir> <out> write a standalone viewer + logs copy

ROOT="${NGINX_ROOT:-/usr/share/nginx/html}"
# Set NGINX_BASE_URL when the site is reached on another port, such as through
# an SSH tunnel: export NGINX_BASE_URL=http://localhost:8002
BASE="${NGINX_BASE_URL:-http://localhost}"
VIEWER_DIR="${INSPECT_VIEWER_DIR:-/usr/share/nginx/inspect-view}"
HOSTNAME_LIVE="${INSPECT_HOSTNAME:-inspect.localhost}"
PORT="${INSPECT_PORT:-7575}"

die() { echo "$*" >&2; exit 1; }

require_inspect() {
  command -v inspect >/dev/null 2>&1 ||
    die "inspect is not on PATH. Activate the environment with inspect_ai installed."
}

sudo_cmd() {
  if (( EUID == 0 )); then "$@"; else sudo "$@"; fi
}

# Map a filesystem path to its http URL by matching the webroot symlinks.
path_url() {
  local target entry link rel slash=""
  target="$(realpath "$1")"
  [[ -d "$target" ]] && slash="/"
  for entry in "$ROOT"/*; do
    [[ -e "$entry" ]] || continue
    link="$(realpath "$entry")"
    if [[ "$target" == "$link" ]]; then
      echo "${BASE}/$(basename "$entry")${slash}"
      return 0
    fi
    if [[ "$target" == "$link"/* ]]; then
      rel="${target#"$link"/}"
      echo "${BASE}/$(basename "$entry")/${rel}${slash}"
      return 0
    fi
  done
  return 1
}

# One copy of the viewer serves every .eval in the webroot. inspect_ai only
# writes it into a log directory, so embed into a temporary directory and move
# the page and its assets out.
cmd_viewer() {
  require_inspect
  local stage
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' RETURN
  inspect view embed --log-dir "$stage" >/dev/null
  [[ -f "${stage}/index.html" ]] || die "inspect view embed wrote no index.html"

  sudo_cmd rm -rf "$VIEWER_DIR"
  sudo_cmd mkdir -p "$VIEWER_DIR"
  sudo_cmd cp -a "${stage}/index.html" "${stage}/assets" "$VIEWER_DIR/"
  echo "Installed the Inspect viewer in ${VIEWER_DIR}"
  echo "Open any .eval file under ${BASE}/"
}

cmd_embed() {
  local dir="${1:-}" url
  [[ -n "$dir" ]] || die "Usage: ./inspect.sh embed <log-dir>"
  [[ -d "$dir" ]] || die "No such directory: $dir"
  require_inspect
  inspect view embed --log-dir "$dir"
  echo
  if url="$(path_url "$dir")"; then
    echo "Open ${url}"
  else
    echo "$dir is outside ${ROOT}. Expose it first:"
    echo "  ./inspect.sh link $dir"
  fi
}

cmd_bundle() {
  local dir="${1:-}" out="${2:-}" url
  [[ -n "$dir" && -n "$out" ]] || die "Usage: ./inspect.sh bundle <log-dir> <output-dir>"
  require_inspect
  inspect view bundle --log-dir "$dir" --output-dir "$out" --overwrite
  echo
  if url="$(path_url "$out")"; then
    echo "Open ${url}"
  else
    echo "$out is outside ${ROOT}. Expose it first:"
    echo "  ./inspect.sh link $out"
  fi
}

cmd_serve() {
  local dir="${1:-${INSPECT_LOG_DIR:-./logs}}"
  [[ -d "$dir" ]] || die "No such directory: $dir"
  require_inspect
  echo "Serving $dir on http://${HOSTNAME_LIVE}/ (127.0.0.1:${PORT})"
  exec inspect view \
    --log-dir "$dir" \
    --recursive \
    --host 127.0.0.1 \
    --port "$PORT" \
    --trusted-host "$HOSTNAME_LIVE" \
    --trusted-origin "http://${HOSTNAME_LIVE}"
}

cmd_link() {
  local dir="${1:-}" name="${2:-}"
  [[ -n "$dir" ]] || die "Usage: ./inspect.sh link <dir> [name]"
  [[ -d "$dir" ]] || die "No such directory: $dir"
  dir="$(realpath "$dir")"
  name="${name:-$(basename "$dir")}"
  sudo_cmd ln -sfn "$dir" "${ROOT}/${name}"
  echo "Linked ${ROOT}/${name} -> ${dir}"
  echo "Open ${BASE}/${name}/"
}

cmd_url() {
  local path="${1:-}"
  [[ -n "$path" ]] || die "Usage: ./inspect.sh url <path>"
  path_url "$path" || die "$path is outside ${ROOT}"
}

case "${1:-}" in
  viewer) shift; cmd_viewer "$@" ;;
  embed)  shift; cmd_embed "$@" ;;
  bundle) shift; cmd_bundle "$@" ;;
  serve)  shift; cmd_serve "$@" ;;
  link)   shift; cmd_link "$@" ;;
  url)    shift; cmd_url "$@" ;;
  *)      sed -n '4,12p' "$0" | sed 's/^# \{0,1\}//' ; exit 1 ;;
esac
