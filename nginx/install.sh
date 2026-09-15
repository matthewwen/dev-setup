#!/usr/bin/env bash
set -euo pipefail

# Install the repo's nginx configuration.
# Usage: ./nginx/install.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_DIR="${NGINX_DIR:-/etc/nginx}"
BACKUP="${NGINX_DIR}/nginx.conf.pre-dev-setup"
CONFIGS=(nginx.conf hosts.conf proxy-dev.conf)

if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx is not installed. Install it first, then rerun this script." >&2
  exit 1
fi

if (( EUID == 0 )); then
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

for config in "${CONFIGS[@]}"; do
  echo "Linking ${NGINX_DIR}/${config}"
  "${SUDO[@]}" ln -sfn "${SCRIPT_DIR}/${config}" "${NGINX_DIR}/${config}"
done

echo "Validating nginx configuration..."
"${SUDO[@]}" nginx -t

if command -v systemctl >/dev/null 2>&1; then
  "${SUDO[@]}" systemctl enable nginx
  if "${SUDO[@]}" systemctl is-active --quiet nginx; then
    echo "Reloading nginx..."
    "${SUDO[@]}" systemctl reload nginx
  else
    echo "Starting nginx..."
    "${SUDO[@]}" systemctl start nginx
  fi
else
  echo "systemctl is unavailable; reload nginx manually."
fi

echo "Done. Open http://docs.localhost/"
