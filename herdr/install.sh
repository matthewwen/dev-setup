#!/usr/bin/env bash
set -euo pipefail

# Install herdr and link the repo's config into place.
#
# Usage:
#   ./herdr/install.sh
#
# Installs the herdr binary when it is missing, backs up an existing
# ~/.config/herdr/config.toml, links the repo config and helper scripts there,
# validates the config, and reloads a running server.

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
CONFIG_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/herdr"
CONFIG="${CONFIG_DIR}/config.toml"
BACKUP="${CONFIG}.pre-dev-setup"

if ! command -v herdr >/dev/null 2>&1; then
  echo "Installing herdr..."
  curl -fsSL https://herdr.dev/install.sh | sh
  export PATH="${HOME}/.local/bin:${PATH}"
fi
command -v herdr >/dev/null 2>&1 || { echo "herdr is not on PATH after install." >&2; exit 1; }
echo "herdr $(herdr --version)"

mkdir -p "$CONFIG_DIR"
if [[ -e "$CONFIG" && ! -L "$CONFIG" && ! -e "$BACKUP" ]]; then
  echo "Backing up ${CONFIG} to ${BACKUP}"
  mv "$CONFIG" "$BACKUP"
fi
echo "Linking ${CONFIG} -> ${BASE_DIR}/config.toml"
ln -sfn "${BASE_DIR}/config.toml" "$CONFIG"
ln -sfn "${BASE_DIR}/move-pane.sh" "${CONFIG_DIR}/move-pane.sh"
ln -sfn "${BASE_DIR}/join-pane.sh" "${CONFIG_DIR}/join-pane.sh"
ln -sfn "${BASE_DIR}/select-layout.sh" "${CONFIG_DIR}/select-layout.sh"

echo "Validating config..."
herdr config check

if herdr status server 2>/dev/null | grep -q '^status: running'; then
  echo "Reloading running herdr server..."
  herdr server reload-config
fi

echo "Done."
echo "  config    ${CONFIG}"
echo "  launch    herdr"
