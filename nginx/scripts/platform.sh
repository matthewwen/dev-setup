# Platform detection shared by install.sh, explorer.sh, and inspect.sh.
# Source this file; do not run it. Every value keeps an existing environment
# variable, so any path can be forced from the outside.
#
#   NGINX_OS            linux | macos
#   NGINX_PKG           brew | apt | rpm | source   (how nginx was installed)
#   NGINX_PREFIX        Homebrew prefix on macOS, else empty
#   NGINX_DIR           config directory, from `nginx -V` --conf-path
#   NGINX_ROOT          webroot
#   NGINX_LOG_DIR       from --error-log-path
#   NGINX_PID           from --pid-path
#   NGINX_MODULES_DIR   directory of load_module snippets, or empty
#   INSPECT_VIEWER_DIR  shared Inspect viewer, a sibling of the webroot
#   NGINX_PORT          port of the installed config, else 80 (Linux) or 8080 (macOS)
#   NGINX_BASE_URL      http://localhost or http://localhost:<port>
#
# Homebrew keeps everything under its prefix (/opt/homebrew or /usr/local) and
# runs nginx as the user on 8080. apt uses /etc/nginx with /var/www/html and
# modules-enabled/; rpm uses /etc/nginx with /usr/share/nginx/html and
# /usr/share/nginx/modules/. `nginx -V` reports the compiled paths for all of
# them, so the layout is read from the binary rather than guessed.

_nginx_configure_arg() {
  nginx -V 2>&1 | tr ' ' '\n' | sed -n "s|^$1=||p" | head -1
}

_nginx_detect() {
  local sbin real conf errlog pid prefix

  case "$(uname -s)" in
    Darwin) NGINX_OS="${NGINX_OS:-macos}" ;;
    *)      NGINX_OS="${NGINX_OS:-linux}" ;;
  esac

  NGINX_PREFIX="${NGINX_PREFIX:-}"
  if [[ "$NGINX_OS" == macos && -z "$NGINX_PREFIX" ]] && command -v brew >/dev/null 2>&1; then
    NGINX_PREFIX="$(brew --prefix 2>/dev/null || true)"
  fi

  sbin="$(command -v nginx 2>/dev/null || true)"
  real="$sbin"
  [[ -n "$sbin" ]] && real="$(readlink -f "$sbin" 2>/dev/null || echo "$sbin")"

  if [[ -z "${NGINX_PKG:-}" ]]; then
    NGINX_PKG=source
    if [[ "$NGINX_OS" == macos ]]; then
      [[ -n "$NGINX_PREFIX" && "$real" == "$NGINX_PREFIX"/* ]] && NGINX_PKG=brew
    elif [[ -n "$sbin" ]]; then
      if command -v dpkg >/dev/null 2>&1 && dpkg -S "$real" >/dev/null 2>&1; then
        NGINX_PKG=apt
      elif command -v rpm >/dev/null 2>&1 && rpm -qf "$real" >/dev/null 2>&1; then
        NGINX_PKG=rpm
      fi
    fi
  fi

  conf="" errlog="" pid="" prefix=""
  if [[ -n "$sbin" ]]; then
    conf="$(_nginx_configure_arg --conf-path)"
    errlog="$(_nginx_configure_arg --error-log-path)"
    pid="$(_nginx_configure_arg --pid-path)"
    prefix="$(_nginx_configure_arg --prefix)"
  fi

  if [[ -z "${NGINX_DIR:-}" ]]; then
    if [[ -n "$conf" ]]; then
      NGINX_DIR="$(dirname "$conf")"
    elif [[ "$NGINX_PKG" == brew ]]; then
      NGINX_DIR="${NGINX_PREFIX}/etc/nginx"
    else
      NGINX_DIR=/etc/nginx
    fi
  fi

  if [[ -z "${NGINX_LOG_DIR:-}" ]]; then
    if [[ -n "$errlog" ]]; then
      NGINX_LOG_DIR="$(dirname "$errlog")"
    elif [[ "$NGINX_PKG" == brew ]]; then
      NGINX_LOG_DIR="${NGINX_PREFIX}/var/log/nginx"
    else
      NGINX_LOG_DIR=/var/log/nginx
    fi
  fi

  if [[ -z "${NGINX_PID:-}" ]]; then
    if [[ -n "$pid" ]]; then
      NGINX_PID="$pid"
    elif [[ "$NGINX_PKG" == brew ]]; then
      NGINX_PID="${NGINX_PREFIX}/var/run/nginx.pid"
    else
      NGINX_PID=/run/nginx.pid
    fi
  fi

  if [[ -z "${NGINX_ROOT:-}" ]]; then
    case "$NGINX_PKG" in
      brew) NGINX_ROOT="${NGINX_PREFIX}/var/www" ;;
      apt)  NGINX_ROOT=/var/www/html ;;
      *)    NGINX_ROOT="${prefix:-/usr/share/nginx}/html" ;;
    esac
  fi

  if [[ -z "${NGINX_MODULES_DIR+x}" ]]; then
    NGINX_MODULES_DIR=""
    local candidate
    for candidate in "${NGINX_DIR}/modules-enabled" "${prefix:-/usr/share/nginx}/modules"; do
      if [[ -d "$candidate" ]]; then
        NGINX_MODULES_DIR="$candidate"
        break
      fi
    done
  fi

  INSPECT_VIEWER_DIR="${INSPECT_VIEWER_DIR:-$(dirname "$NGINX_ROOT")/inspect-view}"

  if [[ -z "${NGINX_PORT:-}" ]]; then
    NGINX_PORT=""
    if grep -q '^# dev-setup:rendered' "${NGINX_DIR}/nginx.conf" 2>/dev/null; then
      NGINX_PORT="$(sed -n 's/^[[:space:]]*listen[[:space:]][[:space:]]*\([0-9][0-9]*\)[[:space:]][[:space:]]*default_server.*/\1/p' \
        "${NGINX_DIR}/nginx.conf" 2>/dev/null | head -1)"
    fi
    if [[ -z "$NGINX_PORT" ]]; then
      [[ "$NGINX_OS" == macos ]] && NGINX_PORT=8080 || NGINX_PORT=80
    fi
  fi

  if [[ -z "${NGINX_BASE_URL:-}" ]]; then
    if [[ "$NGINX_PORT" == 80 ]]; then
      NGINX_BASE_URL=http://localhost
    else
      NGINX_BASE_URL="http://localhost:${NGINX_PORT}"
    fi
  fi

  export NGINX_OS NGINX_PKG NGINX_PREFIX NGINX_DIR NGINX_ROOT NGINX_LOG_DIR \
    NGINX_PID NGINX_MODULES_DIR INSPECT_VIEWER_DIR NGINX_PORT NGINX_BASE_URL
}

_nginx_detect

nginx_describe() {
  local where="$NGINX_PKG"
  case "$NGINX_PKG" in
    brew)   where="Homebrew (${NGINX_PREFIX})" ;;
    apt)    where="apt package" ;;
    rpm)    where="rpm package (yum/dnf)" ;;
    source) where="source or unknown package" ;;
  esac
  echo "Platform  ${NGINX_OS}, nginx from ${where}"
  echo "  conf    ${NGINX_DIR}"
  echo "  webroot ${NGINX_ROOT}"
  echo "  logs    ${NGINX_LOG_DIR}"
  echo "  pid     ${NGINX_PID}"
  echo "  modules ${NGINX_MODULES_DIR:-(none)}"
  echo "  port    ${NGINX_PORT}"
}
