#!/usr/bin/env bash
set -euo pipefail

# Install the repo's nginx configuration.
#
# Usage:
#   ./nginx/install.sh                       use conf/hosts.conf
#   ./nginx/install.sh --hosts <file>        use another hosts file
#   HOSTS_CONF=<file> ./nginx/install.sh     same, through the environment
#
# Host-based routes are per machine, so hosts.conf takes an override. Without
# one, conf/hosts.local.conf wins when it exists, else conf/hosts.conf.
#
# Every file lands in /etc/nginx under its base name, because the configs
# include each other by base name.

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
NGINX_DIR="${NGINX_DIR:-/etc/nginx}"
WEBROOT="${NGINX_ROOT:-/usr/share/nginx/html}"
BACKUP="${NGINX_DIR}/nginx.conf.pre-dev-setup"
HOSTS_CONF="${HOSTS_CONF:-}"

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
    -h | --help)
      sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$HOSTS_CONF" && -f "${BASE_DIR}/conf/hosts.local.conf" ]]; then
  HOSTS_CONF="${BASE_DIR}/conf/hosts.local.conf"
fi
HOSTS_CONF="${HOSTS_CONF:-${BASE_DIR}/conf/hosts.conf}"
[[ -f "$HOSTS_CONF" ]] || { echo "No such hosts file: ${HOSTS_CONF}" >&2; exit 1; }
HOSTS_CONF="$(cd "$(dirname "$HOSTS_CONF")" && pwd -P)/$(basename "$HOSTS_CONF")"

CONFIGS=(
  conf/nginx.conf conf/proxy-dev.conf conf/maps.conf
  conf/md.conf html/md-viewer.html
  conf/json.conf html/json-viewer.html
  conf/text.conf html/text-viewer.html
  conf/inspect.conf
  conf/explorer.conf html/explorer.html
)
USER_SYSTEMD_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
EXPLORER_UNIT="nginx-explorer.service"
EXPLORER_CONFIG_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/nginx-explorer"
EXPLORER_TOKEN_FILE="${EXPLORER_CONFIG_DIR}/edit-token"
HTML_LINK="${HOME}/html"

if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx is not installed. Install it first, then rerun this script." >&2
  exit 1
fi

if ((EUID == 0)); then
  SUDO=()
elif command -v sudo >/dev/null 2>&1; then
  SUDO=(sudo)
else
  echo "Run this script as root or install sudo." >&2
  exit 1
fi

if [[ -e "${NGINX_DIR}/nginx.conf" && ! -e "${BACKUP}" ]]; then
  echo "Backing up nginx.conf to ${BACKUP}"
  "${SUDO[@]}" cp -a "${NGINX_DIR}/nginx.conf" "${BACKUP}"
fi

# nginx.service usually runs with PrivateTmp=true, which gives the service its
# own /tmp. A symlink into /tmp resolves for `nginx -t` and then fails on reload,
# so copy such a file instead of linking it.
PRIVATE_TMP="$(systemctl show nginx -p PrivateTmp --value 2>/dev/null || echo no)"
WANTED=(hosts.conf)
if [[ "$PRIVATE_TMP" == "yes" && "$HOSTS_CONF" == /tmp/* || "$HOSTS_CONF" == /var/tmp/* ]]; then
  echo "Copying ${NGINX_DIR}/hosts.conf <- ${HOSTS_CONF}"
  echo "  (the service runs with PrivateTmp, so a link into /tmp would not resolve)"
  "${SUDO[@]}" rm -f "${NGINX_DIR}/hosts.conf"
  "${SUDO[@]}" cp "$HOSTS_CONF" "${NGINX_DIR}/hosts.conf"
else
  echo "Linking ${NGINX_DIR}/hosts.conf -> ${HOSTS_CONF}"
  "${SUDO[@]}" ln -sfn "$HOSTS_CONF" "${NGINX_DIR}/hosts.conf"
fi

for config in "${CONFIGS[@]}"; do
  name="$(basename "$config")"
  WANTED+=("$name")
  echo "Linking ${NGINX_DIR}/${name}"
  "${SUDO[@]}" ln -sfn "${BASE_DIR}/${config}" "${NGINX_DIR}/${name}"
done

# Drop links this repo installed earlier and no longer owns, such as a renamed
# snippet. Anything not pointing into BASE_DIR is left alone.
for link in "${NGINX_DIR}"/*.conf "${NGINX_DIR}"/*.html; do
  [[ -L "$link" ]] || continue
  # realpath -m resolves /home vs /local/home and tolerates a moved target.
  target="$(realpath -m "$(readlink "$link")" 2>/dev/null || true)"
  [[ "$target" == "${BASE_DIR}/"* ]] || continue
  [[ "$target" == "$(realpath -m "$HOSTS_CONF")" ]] && continue
  name="$(basename "$link")"
  for wanted in "${WANTED[@]}"; do
    [[ "$name" == "$wanted" ]] && continue 2
  done
  echo "Removing stale ${link}"
  "${SUDO[@]}" rm -f "$link"
done

echo "Validating nginx configuration..."
"${SUDO[@]}" nginx -t

if command -v systemctl >/dev/null 2>&1; then
  "${SUDO[@]}" systemctl enable nginx
  if "${SUDO[@]}" systemctl is-active --quiet nginx; then
    echo "Reloading nginx..."
    # `nginx -t` above ran outside the service sandbox, so a reload can still
    # fail on a path the service cannot see.
    if ! "${SUDO[@]}" systemctl reload nginx; then
      echo "Reload failed. The running config is unchanged. Recent log:" >&2
      "${SUDO[@]}" journalctl -u nginx -n 5 --no-pager >&2 || true
      exit 1
    fi
  else
    echo "Starting nginx..."
    "${SUDO[@]}" systemctl start nginx
  fi
else
  echo "systemctl is unavailable; reload nginx manually."
fi

if command -v systemctl >/dev/null 2>&1 && [[ -n "${HOME:-}" ]]; then
  if [[ ! -e "$HTML_LINK" && ! -L "$HTML_LINK" ]]; then
    ln -s "$WEBROOT" "$HTML_LINK"
    echo "Linked ${HTML_LINK} -> ${WEBROOT}"
  fi
  if [[ ! -f "$EXPLORER_TOKEN_FILE" ]]; then
    mkdir -p "$EXPLORER_CONFIG_DIR"
    umask 077
    openssl rand -hex 32 > "$EXPLORER_TOKEN_FILE"
  fi
  "${SUDO[@]}" chown "$(id -u):$(id -g)" "$WEBROOT"
  mkdir -p "$USER_SYSTEMD_DIR"
  unit_file="${USER_SYSTEMD_DIR}/${EXPLORER_UNIT}"
  # The API must run as the logged-in user: the webroot often links into that
  # user's workspace.  Substitute the absolute repo path so the unit survives
  # being started by systemd with an unrelated working directory.
  sed "s|@BASE_DIR@|${BASE_DIR}|g" "${BASE_DIR}/systemd/${EXPLORER_UNIT}" > "$unit_file"
  systemctl --user daemon-reload
  systemctl --user enable "$EXPLORER_UNIT"
  systemctl --user restart "$EXPLORER_UNIT"
  echo "Restarted explorer API as user service: ${EXPLORER_UNIT}"
else
  echo "systemctl user services are unavailable; start the explorer with:"
  echo "  ${BASE_DIR}/scripts/explorer.sh start"
fi

# Set NGINX_BASE_URL when the site is reached on another port, such as through
# an SSH tunnel: export NGINX_BASE_URL=http://localhost:8002
BASE="${NGINX_BASE_URL:-http://localhost}"

echo "Done."
echo "  hosts     ${HOSTS_CONF}"
echo "  explorer  ${BASE}/<dir>/"
echo "  raw index ${BASE}/__raw/<path>"
echo "  edit API  POST ${BASE}/__api/files"
