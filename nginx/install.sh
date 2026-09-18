#!/usr/bin/env bash
set -euo pipefail

# Install the repo's nginx configuration.
#
# Usage:
#   ./nginx/install.sh                       use conf/hosts.conf
#   ./nginx/install.sh --hosts <file>        use another hosts file
#   ./nginx/install.sh --port <n>            listen port (80 Linux, 8080 macOS)
#   ./nginx/install.sh --show                print the detected layout and exit
#   ./nginx/install.sh --no-services         write the configs only
#   HOSTS_CONF=<file> ./nginx/install.sh     same, through the environment
#
# Host-based routes are per machine, so hosts.conf takes an override. Without
# one, conf/hosts.local.conf wins when it exists, else conf/hosts.conf.
#
# Works on Linux (apt or yum/dnf nginx, systemd) and macOS (Homebrew nginx,
# brew services + launchd). scripts/platform.sh reads the layout from
# `nginx -V`; NGINX_DIR, NGINX_ROOT, NGINX_PORT, and friends override it.
#
# Every conf lands in the nginx config directory under its base name, with the
# @...@ fields filled in. The viewer pages are symlinked.

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HOSTS_CONF="${HOSTS_CONF:-}"
SHOW_ONLY=0
NO_SERVICES=0
PORT_ARG=""

while (($#)); do
  case "$1" in
    --hosts)
      [[ -n "${2:-}" ]] || { echo "--hosts needs a file" >&2; exit 1; }
      HOSTS_CONF="$2"
      shift 2
      ;;
    --hosts=*)
      HOSTS_CONF="${1#--hosts=}"
      shift
      ;;
    --port)
      [[ -n "${2:-}" ]] || { echo "--port needs a number" >&2; exit 1; }
      PORT_ARG="$2"
      shift 2
      ;;
    --port=*)
      PORT_ARG="${1#--port=}"
      shift
      ;;
    --show)
      SHOW_ONLY=1
      shift
      ;;
    --no-services)
      NO_SERVICES=1
      shift
      ;;
    -h | --help)
      sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v nginx >/dev/null 2>&1; then
  case "$(uname -s)" in
    Darwin) echo "nginx is not installed. Run: brew install nginx" >&2 ;;
    *)      echo "nginx is not installed. Run: sudo apt install nginx  or  sudo dnf install nginx" >&2 ;;
  esac
  exit 1
fi

# --port wins over the port of an installed config.
[[ -n "$PORT_ARG" ]] && export NGINX_PORT="$PORT_ARG"
# shellcheck source=scripts/platform.sh
source "${BASE_DIR}/scripts/platform.sh"
[[ "$NGINX_PORT" =~ ^[0-9]+$ ]] || { echo "Bad port: ${NGINX_PORT}" >&2; exit 1; }

nginx_describe
if ((SHOW_ONLY)); then
  exit 0
fi

NGINX_DIR_BACKUP="${NGINX_DIR}/nginx.conf.pre-dev-setup"
WEBROOT="$NGINX_ROOT"

if [[ -z "$HOSTS_CONF" && -f "${BASE_DIR}/conf/hosts.local.conf" ]]; then
  HOSTS_CONF="${BASE_DIR}/conf/hosts.local.conf"
fi
HOSTS_CONF="${HOSTS_CONF:-${BASE_DIR}/conf/hosts.conf}"
[[ -f "$HOSTS_CONF" ]] || { echo "No such hosts file: ${HOSTS_CONF}" >&2; exit 1; }
HOSTS_CONF="$(cd "$(dirname "$HOSTS_CONF")" && pwd -P)/$(basename "$HOSTS_CONF")"

RENDERED=(
  conf/nginx.conf conf/proxy-dev.conf conf/maps.conf
  conf/md.conf conf/json.conf conf/text.conf
  conf/inspect.conf conf/explorer.conf
)
LINKED=(
  html/md-viewer.html html/json-viewer.html html/text-viewer.html html/explorer.html
)
EXPLORER_CONFIG_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/nginx-explorer"
EXPLORER_TOKEN_FILE="${EXPLORER_CONFIG_DIR}/edit-token"
HTML_LINK="${HOME}/html"
RENDER_MARK="# dev-setup:rendered"

# Homebrew's tree is user-owned, so no sudo there. Anything under /etc needs it.
SUDO=""
if ((EUID != 0)) && [[ ! -w "$NGINX_DIR" ]]; then
  command -v sudo >/dev/null 2>&1 || { echo "Run this script as root or install sudo." >&2; exit 1; }
  SUDO=sudo
fi
priv() { if [[ -n "$SUDO" ]]; then sudo "$@"; else "$@"; fi; }

# realpath -m is GNU only; macOS falls back to readlink -f, then the input.
abspath() {
  realpath -m "$1" 2>/dev/null || readlink -f "$1" 2>/dev/null || echo "$1"
}

if [[ "$NGINX_OS" == macos && "$NGINX_PORT" -lt 1024 && $EUID -ne 0 ]]; then
  echo "Note: port ${NGINX_PORT} needs root on macOS. Start nginx with" >&2
  echo "  sudo brew services start nginx" >&2
  echo "or rerun with --port 8080 to run it as ${USER}." >&2
fi

USER_DIRECTIVE="user root;"
if [[ "$NGINX_OS" == macos && "$NGINX_PORT" -ge 1024 ]]; then
  USER_DIRECTIVE="# nginx runs as the login user under brew services; no user directive."
fi
MODULES_INCLUDE="# no load_module snippet directory on this install"
if [[ -n "$NGINX_MODULES_DIR" ]]; then
  MODULES_INCLUDE="include ${NGINX_MODULES_DIR}/*.conf;"
fi

render() {
  local src="$1"
  echo "${RENDER_MARK} ${src}"
  sed \
    -e "s|@USER_DIRECTIVE@|${USER_DIRECTIVE}|g" \
    -e "s|@MODULES_INCLUDE@|${MODULES_INCLUDE}|g" \
    -e "s|@NGINX_DIR@|${NGINX_DIR}|g" \
    -e "s|@WEBROOT@|${WEBROOT}|g" \
    -e "s|@INSPECT_VIEWER_DIR@|${INSPECT_VIEWER_DIR}|g" \
    -e "s|@LOG_DIR@|${NGINX_LOG_DIR}|g" \
    -e "s|@PID_PATH@|${NGINX_PID}|g" \
    -e "s|@PORT@|${NGINX_PORT}|g" \
    "$src"
}

priv mkdir -p "$NGINX_DIR" "$WEBROOT" "$NGINX_LOG_DIR"

if [[ -e "${NGINX_DIR}/nginx.conf" && ! -L "${NGINX_DIR}/nginx.conf" && ! -e "${NGINX_DIR_BACKUP}" ]] \
  && ! grep -q "^${RENDER_MARK}" "${NGINX_DIR}/nginx.conf" 2>/dev/null; then
  echo "Backing up nginx.conf to ${NGINX_DIR_BACKUP}"
  priv cp -a "${NGINX_DIR}/nginx.conf" "${NGINX_DIR_BACKUP}"
fi

# nginx.service usually runs with PrivateTmp=true, which gives the service its
# own /tmp. A symlink into /tmp resolves for `nginx -t` and then fails on reload,
# so copy such a file instead of linking it.
PRIVATE_TMP="$(systemctl show nginx -p PrivateTmp --value 2>/dev/null || echo no)"
WANTED=(hosts.conf)
if [[ "$PRIVATE_TMP" == "yes" && "$HOSTS_CONF" == /tmp/* || "$HOSTS_CONF" == /var/tmp/* ]]; then
  echo "Copying ${NGINX_DIR}/hosts.conf <- ${HOSTS_CONF}"
  echo "  (the service runs with PrivateTmp, so a link into /tmp would not resolve)"
  priv rm -f "${NGINX_DIR}/hosts.conf"
  priv cp "$HOSTS_CONF" "${NGINX_DIR}/hosts.conf"
else
  echo "Linking ${NGINX_DIR}/hosts.conf -> ${HOSTS_CONF}"
  priv ln -sfn "$HOSTS_CONF" "${NGINX_DIR}/hosts.conf"
fi

for config in "${RENDERED[@]}"; do
  name="$(basename "$config")"
  WANTED+=("$name")
  echo "Writing ${NGINX_DIR}/${name}"
  priv rm -f "${NGINX_DIR}/${name}"
  render "${BASE_DIR}/${config}" | priv tee "${NGINX_DIR}/${name}" >/dev/null
done

for page in "${LINKED[@]}"; do
  name="$(basename "$page")"
  WANTED+=("$name")
  echo "Linking ${NGINX_DIR}/${name}"
  priv ln -sfn "${BASE_DIR}/${page}" "${NGINX_DIR}/${name}"
done

# Drop files this repo installed earlier and no longer owns, such as a renamed
# snippet. A link that points elsewhere, or a file without the marker, stays.
for entry in "${NGINX_DIR}"/*.conf "${NGINX_DIR}"/*.html; do
  [[ -e "$entry" || -L "$entry" ]] || continue
  name="$(basename "$entry")"
  ours=0
  if [[ -L "$entry" ]]; then
    target="$(abspath "$(readlink "$entry")")"
    [[ "$target" == "${BASE_DIR}/"* ]] && ours=1
    [[ "$target" == "$(abspath "$HOSTS_CONF")" ]] && continue
  elif grep -q "^${RENDER_MARK} ${BASE_DIR}/" "$entry" 2>/dev/null; then
    ours=1
  fi
  ((ours)) || continue
  for wanted in "${WANTED[@]}"; do
    [[ "$name" == "$wanted" ]] && continue 2
  done
  echo "Removing stale ${entry}"
  priv rm -f "$entry"
done

echo "Validating nginx configuration..."
priv nginx -t -c "${NGINX_DIR}/nginx.conf"

nginx_running() {
  local pid
  [[ -r "$NGINX_PID" ]] || return 1
  pid="$(cat "$NGINX_PID" 2>/dev/null)"
  [[ -n "$pid" ]] && ps -p "$pid" >/dev/null 2>&1
}

if ((NO_SERVICES)); then
  echo "Skipping service management (--no-services)."
elif [[ "$NGINX_OS" == linux ]] && command -v systemctl >/dev/null 2>&1; then
  priv systemctl enable nginx
  if priv systemctl is-active --quiet nginx; then
    echo "Reloading nginx..."
    # `nginx -t` above ran outside the service sandbox, so a reload can still
    # fail on a path the service cannot see.
    if ! priv systemctl reload nginx; then
      echo "Reload failed. The running config is unchanged. Recent log:" >&2
      priv journalctl -u nginx -n 5 --no-pager >&2 || true
      exit 1
    fi
  else
    echo "Starting nginx..."
    priv systemctl start nginx
  fi
elif [[ "$NGINX_PKG" == brew ]]; then
  BREW_SUDO=""
  [[ "$NGINX_PORT" -lt 1024 && $EUID -ne 0 ]] && BREW_SUDO=sudo
  if nginx_running; then
    echo "Reloading nginx..."
    if [[ -O "$NGINX_PID" ]]; then nginx -s reload; else sudo nginx -s reload; fi
  else
    echo "Starting nginx with brew services..."
    ${BREW_SUDO} brew services start nginx
  fi
else
  if nginx_running; then
    echo "Reload nginx manually:  nginx -s reload"
  else
    echo "Start nginx manually:   nginx"
  fi
fi

# The explorer API. It must run as the logged-in user: the webroot often links
# into that user's workspace.
if [[ ! -e "$HTML_LINK" && ! -L "$HTML_LINK" ]]; then
  ln -s "$WEBROOT" "$HTML_LINK"
  echo "Linked ${HTML_LINK} -> ${WEBROOT}"
fi
if [[ ! -f "$EXPLORER_TOKEN_FILE" ]]; then
  mkdir -p "$EXPLORER_CONFIG_DIR"
  (umask 077; openssl rand -hex 32 > "$EXPLORER_TOKEN_FILE")
fi
[[ -O "$WEBROOT" ]] || priv chown "$(id -u):$(id -g)" "$WEBROOT"

if ((NO_SERVICES)); then
  :
elif [[ "$NGINX_OS" == linux ]] && command -v systemctl >/dev/null 2>&1; then
  USER_SYSTEMD_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
  EXPLORER_UNIT="nginx-explorer.service"
  mkdir -p "$USER_SYSTEMD_DIR"
  unit_file="${USER_SYSTEMD_DIR}/${EXPLORER_UNIT}"
  # Substitute the absolute repo path so the unit survives being started by
  # systemd with an unrelated working directory.
  sed -e "s|@BASE_DIR@|${BASE_DIR}|g" -e "s|@WEBROOT@|${WEBROOT}|g" \
    "${BASE_DIR}/systemd/${EXPLORER_UNIT}" > "$unit_file"
  systemctl --user daemon-reload
  systemctl --user enable "$EXPLORER_UNIT"
  systemctl --user restart "$EXPLORER_UNIT"
  echo "Restarted explorer API as user service: ${EXPLORER_UNIT}"
elif [[ "$NGINX_OS" == macos ]]; then
  LAUNCH_LABEL="com.dev-setup.nginx-explorer"
  LAUNCH_DIR="${HOME}/Library/LaunchAgents"
  LAUNCH_LOG="${HOME}/Library/Logs/nginx-explorer.log"
  LAUNCH_PATH="${NGINX_PREFIX:+${NGINX_PREFIX}/bin:}/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  mkdir -p "$LAUNCH_DIR" "$(dirname "$LAUNCH_LOG")"
  plist="${LAUNCH_DIR}/${LAUNCH_LABEL}.plist"
  # launchd starts agents with a bare PATH and no shell profile, so the plist
  # carries the resolved PATH, webroot, and token file.
  sed -e "s|@LABEL@|${LAUNCH_LABEL}|g" \
      -e "s|@BASE_DIR@|${BASE_DIR}|g" \
      -e "s|@WEBROOT@|${WEBROOT}|g" \
      -e "s|@PATH@|${LAUNCH_PATH}|g" \
      -e "s|@TOKEN_FILE@|${EXPLORER_TOKEN_FILE}|g" \
      -e "s|@LOG@|${LAUNCH_LOG}|g" \
      "${BASE_DIR}/launchd/nginx-explorer.plist" > "$plist"
  launchctl bootout "gui/$(id -u)/${LAUNCH_LABEL}" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "Started explorer API as launch agent: ${LAUNCH_LABEL} (log ${LAUNCH_LOG})"
else
  echo "No service manager found; start the explorer with:"
  echo "  ${BASE_DIR}/scripts/explorer.sh start"
fi

# NGINX_BASE_URL follows the port. Set it when the site is reached on another
# port, such as through an SSH tunnel: export NGINX_BASE_URL=http://localhost:8002
BASE="$NGINX_BASE_URL"

echo "Done."
echo "  hosts     ${HOSTS_CONF}"
echo "  explorer  ${BASE}/<dir>/"
echo "  raw index ${BASE}/__raw/<path>"
echo "  edit API  POST ${BASE}/__api/files"
