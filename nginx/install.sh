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
#   ./nginx/install.sh --uninstall           remove dev-setup/, restore the backup
#   HOSTS_CONF=<file> ./nginx/install.sh     same, through the environment
#
# Host-based routes are per machine, so hosts.conf takes an override. Without
# one, conf/hosts.local.conf wins when it exists, else conf/hosts.conf.
#
# Works on Linux (apt or yum/dnf nginx, systemd) and macOS (Homebrew nginx,
# brew services + launchd). scripts/platform.sh reads the layout from
# `nginx -V`; NGINX_DIR, NGINX_ROOT, NGINX_PORT, and friends override it.
#
# Everything the repo owns is copied — no symlinks back into the checkout — so
# an upgrade is `git pull` then a rerun of this script. The confs land in the
# nginx config directory with the @...@ fields filled in; the built app lands
# under dev-setup/app/ beside them.

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
HOSTS_CONF="${HOSTS_CONF:-}"
SHOW_ONLY=0
NO_SERVICES=0
UNINSTALL=0
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
    --uninstall)
      UNINSTALL=1
      shift
      ;;
    -h | --help)
      sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'
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

if ! command -v node >/dev/null 2>&1; then
  echo "node is not installed. The app is built with it before install." >&2
  echo "Run: mise use -g node@lts   or   brew install node" >&2
  exit 1
fi
# build.mts and the tests run as TypeScript through node's type stripping,
# which is on by default from 22.18 (22.x) and 23.6.
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>23||(a===23&&b>=6)||(a===22&&b>=18)?0:1)'; then
  echo "node $(node --version) is too old. The build needs node 22.18 or newer." >&2
  echo "Run: mise use -g node@lts   or   brew upgrade node" >&2
  exit 1
fi

# --port wins over the port of an installed config.
[[ -n "$PORT_ARG" ]] && export NGINX_PORT="$PORT_ARG"
# shellcheck source=scripts/platform.sh
source "${BASE_DIR}/scripts/platform.sh"
[[ "$NGINX_PORT" =~ ^[0-9]+$ ]] || { echo "Bad port: ${NGINX_PORT}" >&2; exit 1; }

nginx_describe
if ((SHOW_ONLY)); then
  if [[ -f "${NGINX_PKG_DIR}/manifest.json" ]]; then
    echo "  installed manifest: ${NGINX_PKG_DIR}/manifest.json"
    cat "${NGINX_PKG_DIR}/manifest.json"
  else
    echo "  not installed: ${NGINX_PKG_DIR}/manifest.json does not exist"
  fi
  exit 0
fi

NGINX_DIR_BACKUP="${NGINX_DIR}/nginx.conf.pre-dev-setup"
WEBROOT="$NGINX_ROOT"
PKG_DIR="$NGINX_PKG_DIR"

# Homebrew's tree is user-owned, so no sudo there. Anything under /etc needs it.
SUDO=""
if ((EUID != 0)) && [[ ! -w "$NGINX_DIR" ]]; then
  command -v sudo >/dev/null 2>&1 || { echo "Run this script as root or install sudo." >&2; exit 1; }
  SUDO=sudo
fi
priv() { if [[ -n "$SUDO" ]]; then sudo "$@"; else "$@"; fi; }

if ((UNINSTALL)); then
  if [[ -d "$PKG_DIR" ]]; then
    echo "Removing ${PKG_DIR}"
    priv rm -rf "$PKG_DIR"
  fi
  if [[ -e "$NGINX_DIR_BACKUP" ]]; then
    echo "Restoring ${NGINX_DIR}/nginx.conf from ${NGINX_DIR_BACKUP}"
    priv rm -f "${NGINX_DIR}/nginx.conf"
    priv mv "$NGINX_DIR_BACKUP" "${NGINX_DIR}/nginx.conf"
    echo "Validating and reloading nginx..."
    priv nginx -t -c "${NGINX_DIR}/nginx.conf"
    if [[ "$NGINX_OS" == linux ]] && command -v systemctl >/dev/null 2>&1; then
      priv systemctl reload nginx
    elif [[ "$NGINX_PKG" == brew ]]; then
      nginx -s reload 2>/dev/null || sudo nginx -s reload
    else
      echo "Reload nginx manually: nginx -s reload"
    fi
  else
    echo "No backup at ${NGINX_DIR_BACKUP}; nginx.conf left as-is."
  fi
  if [[ "$NGINX_OS" == linux ]] && command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now nginx-explorer.service 2>/dev/null || true
  elif [[ "$NGINX_OS" == macos ]]; then
    launchctl bootout "gui/$(id -u)/com.dev-setup.nginx-explorer" >/dev/null 2>&1 || true
  fi
  echo "Done."
  exit 0
fi

if [[ -z "$HOSTS_CONF" && -f "${BASE_DIR}/conf/hosts.local.conf" ]]; then
  HOSTS_CONF="${BASE_DIR}/conf/hosts.local.conf"
fi
HOSTS_CONF="${HOSTS_CONF:-${BASE_DIR}/conf/hosts.conf}"
[[ -f "$HOSTS_CONF" ]] || { echo "No such hosts file: ${HOSTS_CONF}" >&2; exit 1; }
HOSTS_CONF="$(cd "$(dirname "$HOSTS_CONF")" && pwd -P)/$(basename "$HOSTS_CONF")"

# Confs rendered under dev-setup/conf/. nginx.conf itself stays a top-level
# file in NGINX_DIR, next to its one-time backup, so the revert instructions
# in the README keep working unchanged.
RENDERED=(
  conf/proxy-dev.conf conf/maps.conf
  conf/md.conf conf/json.conf conf/ipynb.conf conf/text.conf
  conf/inspect.conf conf/explorer.conf conf/prompts.conf
)
EXPLORER_CONFIG_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/nginx-explorer"
EXPLORER_TOKEN_FILE="${EXPLORER_CONFIG_DIR}/edit-token"
# Same XDG default prompts.py's default_db_path() computes, made explicit
# here so the service and a manual `explorer.sh run` always agree on one
# database rather than each deriving it independently.
PROMPTS_DB="${XDG_DATA_HOME:-${HOME}/.local/share}/nginx-explorer/prompts.db"
HTML_LINK="${HOME}/html"
OLD_RENDER_MARK="# dev-setup:rendered"

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
# A non-root nginx cannot create the temp dirs compiled into a packaged
# binary, such as /var/lib/nginx/tmp. scripts/dev.sh sets NGINX_TEMP_DIR.
TEMP_PATHS="# temp paths: compiled-in defaults"
if [[ -n "${NGINX_TEMP_DIR:-}" ]]; then
  mkdir -p "$NGINX_TEMP_DIR"
  TEMP_PATHS=""
  for kind in client_body proxy fastcgi uwsgi scgi; do
    TEMP_PATHS+="${kind}_temp_path ${NGINX_TEMP_DIR}/${kind}; "
  done
fi

render() {
  local src="$1"
  sed \
    -e "s|@USER_DIRECTIVE@|${USER_DIRECTIVE}|g" \
    -e "s|@MODULES_INCLUDE@|${MODULES_INCLUDE}|g" \
    -e "s|@TEMP_PATHS@|${TEMP_PATHS}|g" \
    -e "s|@NGINX_DIR@|${NGINX_DIR}|g" \
    -e "s|@PKG_DIR@|${PKG_DIR}|g" \
    -e "s|@WEBROOT@|${WEBROOT}|g" \
    -e "s|@INSPECT_VIEWER_DIR@|${INSPECT_VIEWER_DIR}|g" \
    -e "s|@LOG_DIR@|${NGINX_LOG_DIR}|g" \
    -e "s|@PID_PATH@|${NGINX_PID}|g" \
    -e "s|@PORT@|${NGINX_PORT}|g" \
    "$src"
}

priv mkdir -p "$NGINX_DIR" "$WEBROOT" "$NGINX_LOG_DIR"

if [[ -e "${NGINX_DIR}/nginx.conf" && ! -L "${NGINX_DIR}/nginx.conf" && ! -e "${NGINX_DIR_BACKUP}" ]] \
  && ! grep -q "^${OLD_RENDER_MARK}" "${NGINX_DIR}/nginx.conf" 2>/dev/null; then
  echo "Backing up nginx.conf to ${NGINX_DIR_BACKUP}"
  priv cp -a "${NGINX_DIR}/nginx.conf" "${NGINX_DIR_BACKUP}"
fi

# Build the app when it is missing or older than its sources. Everything the
# repo owns on the machine is a copy of dist/, so the build always runs before
# the copy.
NEED_BUILD=0
if [[ ! -f "${BASE_DIR}/dist/app/app.js" ]]; then
  NEED_BUILD=1
elif [[ -n "$(find "${BASE_DIR}/src" "${BASE_DIR}/build.mts" "${BASE_DIR}/package.json" \
    -newer "${BASE_DIR}/dist/app/app.js" 2>/dev/null)" ]]; then
  NEED_BUILD=1
fi
if ((NEED_BUILD)); then
  echo "Building the app (dist/ is missing or stale)..."
  # npm writes node_modules/.package-lock.json on each install. If package.json
  # is newer, a dependency changed after the last install.
  if [[ ! -f "${BASE_DIR}/node_modules/.package-lock.json" \
      || "${BASE_DIR}/package.json" -nt "${BASE_DIR}/node_modules/.package-lock.json" ]]; then
    (cd "$BASE_DIR" && npm install)
  fi
  (cd "$BASE_DIR" && npm run build)
fi

# One-time cleanup of the previous flat layout: rendered confs carried a marker
# comment, and the viewer pages and hosts.conf were symlinks into a checkout.
# The link target can be any checkout, or the file given to --hosts, so match
# the symlinks by the names the old layout used. Everything the repo owns now
# lives under dev-setup/, copied.
OLD_LINKS=(explorer.html md-viewer.html json-viewer.html ipynb-viewer.html text-viewer.html md-render.js hosts.conf)
for name in "${OLD_LINKS[@]}"; do
  entry="${NGINX_DIR}/${name}"
  if [[ -L "$entry" ]]; then
    echo "Removing old flat install: ${entry} -> $(readlink "$entry")"
    priv rm -f "$entry"
  fi
done
for entry in "${NGINX_DIR}"/*.conf; do
  [[ -f "$entry" && ! -L "$entry" ]] || continue
  [[ "$(basename "$entry")" == "nginx.conf" ]] && continue
  if grep -q "^${OLD_RENDER_MARK}" "$entry" 2>/dev/null; then
    echo "Removing old flat install: ${entry}"
    priv rm -f "$entry"
  fi
done

echo "Writing ${PKG_DIR}"
priv rm -rf "$PKG_DIR"
priv mkdir -p "${PKG_DIR}/conf" "${PKG_DIR}/app"

echo "Copying ${PKG_DIR}/conf/hosts.conf <- ${HOSTS_CONF}"
priv cp "$HOSTS_CONF" "${PKG_DIR}/conf/hosts.conf"

for config in "${RENDERED[@]}"; do
  name="$(basename "$config")"
  render "${BASE_DIR}/${config}" | priv tee "${PKG_DIR}/conf/${name}" >/dev/null
done

priv cp -r "${BASE_DIR}/dist/app/." "${PKG_DIR}/app/"

echo "Writing ${NGINX_DIR}/nginx.conf"
render "${BASE_DIR}/conf/nginx.conf" | priv tee "${NGINX_DIR}/nginx.conf" >/dev/null

# Manifest of what this run installed, for `install.sh --show` and for telling
# one checkout's install apart from another's.
SHASUM=(sha256sum)
command -v sha256sum >/dev/null 2>&1 || SHASUM=(shasum -a 256)
GIT_SHA="$(git -C "$BASE_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
INSTALLED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MANIFEST_TMP="$(mktemp)"
{
  echo "{"
  echo "  \"package\": \"@dev-setup/nginx-viewers\","
  echo "  \"source\": \"${BASE_DIR}\","
  echo "  \"git\": \"${GIT_SHA}\","
  echo "  \"installedAt\": \"${INSTALLED_AT}\","
  echo "  \"hosts\": \"${HOSTS_CONF}\","
  echo "  \"platform\": { \"os\": \"${NGINX_OS}\", \"pkg\": \"${NGINX_PKG}\", \"port\": ${NGINX_PORT}, \"webroot\": \"${WEBROOT}\" },"
  echo "  \"render\": { \"NGINX_DIR\": \"${NGINX_DIR}\", \"PKG_DIR\": \"${PKG_DIR}\" },"
  echo "  \"files\": {"
  first=1
  while IFS= read -r -d '' f; do
    rel="${f#"${PKG_DIR}"/}"
    sum="$("${SHASUM[@]}" "$f" | cut -d' ' -f1)"
    ((first)) || echo ","
    first=0
    printf '    "%s": "sha256:%s"' "$rel" "$sum"
  done < <(find "$PKG_DIR" -type f -print0 | sort -z)
  echo
  echo "  }"
  echo "}"
} > "$MANIFEST_TMP"
priv cp "$MANIFEST_TMP" "${PKG_DIR}/manifest.json"
priv chmod 644 "${PKG_DIR}/manifest.json"
rm -f "$MANIFEST_TMP"

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
      -e "s|@PROMPTS_DB@|${PROMPTS_DB}|g" \
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
      -e "s|@PROMPTS_DB@|${PROMPTS_DB}|g" \
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
