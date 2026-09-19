#!/usr/bin/env bash
set -euo pipefail

# Turn the nginx web server and the explorer API on or off.
#
# Usage:
#   ./service.sh on         enable and start nginx and the explorer API
#   ./service.sh off        stop and disable both, so they stay off after a reboot
#   ./service.sh restart    restart both
#   ./service.sh status     show service state and answer the health URLs
#
# Linux uses systemctl (nginx as a system unit, the explorer as a user unit).
# macOS uses brew services for nginx and a launch agent for the explorer.
# Run install.sh once before this script; it creates the units.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=platform.sh
source "${SCRIPT_DIR}/platform.sh"

EXPLORER_UNIT="nginx-explorer.service"
EXPLORER_PORT="${EXPLORER_PORT:-7576}"
LAUNCH_LABEL="com.dev-setup.nginx-explorer"
LAUNCH_PLIST="${HOME}/Library/LaunchAgents/${LAUNCH_LABEL}.plist"
LAUNCH_DOMAIN="gui/$(id -u)"

die() { echo "$*" >&2; exit 1; }

SUDO=""
((EUID == 0)) || SUDO=sudo
BREW_SUDO=""
[[ "$NGINX_OS" == macos && "$NGINX_PORT" -lt 1024 && $EUID -ne 0 ]] && BREW_SUDO=sudo

have_systemd() { [[ "$NGINX_OS" == linux ]] && command -v systemctl >/dev/null 2>&1; }

# Retry for a few seconds after a start so a service that is still booting
# does not read as down.
probe() {
  local label="$1" url="$2" tries="${3:-1}"
  local i
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      echo "  ${label}  answers at ${url}"
      return 0
    fi
    ((i < tries)) && sleep 1
  done
  echo "  ${label}  no answer at ${url}"
}

# --- Linux ------------------------------------------------------------------

linux_on() {
  $SUDO systemctl enable --now nginx
  if systemctl --user cat "$EXPLORER_UNIT" >/dev/null 2>&1; then
    systemctl --user enable --now "$EXPLORER_UNIT"
  else
    echo "No ${EXPLORER_UNIT} user unit. Run nginx/install.sh once to create it." >&2
  fi
}

linux_off() {
  $SUDO systemctl disable --now nginx
  systemctl --user disable --now "$EXPLORER_UNIT" 2>/dev/null || true
}

linux_restart() {
  $SUDO systemctl restart nginx
  systemctl --user restart "$EXPLORER_UNIT"
}

# is-active and is-enabled exit non-zero for inactive or disabled units, so
# capture the word and ignore the exit code.
unit_state() { "$@" 2>/dev/null || true; }

linux_status() {
  printf '  nginx     %s, %s\n' \
    "$(unit_state systemctl is-active nginx)" \
    "$(unit_state systemctl is-enabled nginx)"
  printf '  explorer  %s, %s\n' \
    "$(unit_state systemctl --user is-active "$EXPLORER_UNIT")" \
    "$(unit_state systemctl --user is-enabled "$EXPLORER_UNIT")"
}

# --- macOS ------------------------------------------------------------------

# brew services start exits non-zero when the service already runs, so check
# the state first. launchctl bootstrap fails on an agent that is already
# loaded, and kickstart fails on one that is not, so pick by state too.
brew_state() { brew services list 2>/dev/null | awk '$1 == "nginx" {print $2}'; }
agent_loaded() { launchctl print "${LAUNCH_DOMAIN}/${LAUNCH_LABEL}" >/dev/null 2>&1; }

agent_start() {
  [[ -f "$LAUNCH_PLIST" ]] || { echo "No launch agent at ${LAUNCH_PLIST}. Run nginx/install.sh once to create it." >&2; return 0; }
  launchctl enable "${LAUNCH_DOMAIN}/${LAUNCH_LABEL}" 2>/dev/null || true
  if agent_loaded; then
    launchctl kickstart -k "${LAUNCH_DOMAIN}/${LAUNCH_LABEL}"
  else
    launchctl bootstrap "$LAUNCH_DOMAIN" "$LAUNCH_PLIST"
  fi
}

macos_on() {
  [[ "$NGINX_PKG" == brew ]] || die "nginx is not from Homebrew; start it manually."
  [[ "$(brew_state)" == started ]] || $BREW_SUDO brew services start nginx
  agent_start
}

macos_off() {
  # brew services stop also removes nginx from login start.
  if [[ "$NGINX_PKG" == brew && "$(brew_state)" == started ]]; then
    $BREW_SUDO brew services stop nginx
  fi
  if agent_loaded; then
    launchctl bootout "${LAUNCH_DOMAIN}/${LAUNCH_LABEL}"
  fi
  launchctl disable "${LAUNCH_DOMAIN}/${LAUNCH_LABEL}" 2>/dev/null || true
}

macos_restart() {
  [[ "$NGINX_PKG" == brew ]] && $BREW_SUDO brew services restart nginx
  agent_start
}

macos_status() {
  if [[ "$NGINX_PKG" == brew ]]; then
    printf '  nginx     %s\n' "$(brew_state)"
  else
    printf '  nginx     not from Homebrew\n'
  fi
  if agent_loaded; then
    printf '  explorer  loaded\n'
  elif [[ -f "$LAUNCH_PLIST" ]]; then
    printf '  explorer  not loaded\n'
  else
    printf '  explorer  not installed\n'
  fi
}

# --- dispatch ---------------------------------------------------------------

run() {
  local action="$1"
  if have_systemd; then
    "linux_${action}"
  elif [[ "$NGINX_OS" == macos ]]; then
    "macos_${action}"
  else
    die "No supported service manager (systemctl or launchd) found."
  fi
}

cmd_status() {
  local tries="${1:-1}"
  echo "Services (${NGINX_OS})"
  run status
  echo "Health"
  probe nginx    "${NGINX_BASE_URL}/" "$tries"
  probe explorer "http://127.0.0.1:${EXPLORER_PORT}/api/health" "$tries"
}

case "${1:-}" in
  on | start | enable)    run on;      cmd_status 5 ;;
  off | stop | disable)   run off;     cmd_status ;;
  restart)                run restart; cmd_status 5 ;;
  status)                 cmd_status ;;
  -h | --help | help)     sed -n '4,14p' "$0" | sed 's/^# \{0,1\}//' ;;
  *)                      sed -n '4,14p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 1 ;;
esac
