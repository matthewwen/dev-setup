#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
    echo "Run this as your normal user, not root. The script will use sudo when needed." >&2
    exit 1
fi

if [[ -r /etc/os-release ]]; then
    # shellcheck source=/dev/null
    . /etc/os-release
else
    echo "Cannot read /etc/os-release; this installer is intended for Ubuntu." >&2
    exit 1
fi

if [[ ${ID:-} != "ubuntu" && ${ID_LIKE:-} != *"ubuntu"* && ${ID_LIKE:-} != *"debian"* ]]; then
    echo "This installer is intended for Ubuntu/Debian-like hosts." >&2
    exit 1
fi

if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo is required to install packages and copy into /usr/local/bin." >&2
    exit 1
fi

echo "Installing Ubuntu packages..."
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    pkg-config \
    build-essential \
    unison

PATH="$HOME/.cargo/bin:$PATH"
export PATH

cargo_version() {
    cargo --version 2>/dev/null | awk '{ print $2 }'
}

version_ge() {
    [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]
}

ensure_modern_rust() {
    local required_version="1.85.0"
    local current_version=""

    if command -v cargo >/dev/null 2>&1; then
        current_version=$(cargo_version)
    fi

    if [[ -n $current_version ]] && version_ge "$current_version" "$required_version"; then
        echo "Using Cargo $current_version."
        return
    fi

    if [[ -n $current_version ]]; then
        echo "Cargo $current_version is too old; Rust 2024 crates need Cargo $required_version or newer."
    else
        echo "Cargo is not installed."
    fi

    if command -v rustup >/dev/null 2>&1; then
        echo "Installing/updating stable Rust with rustup..."
        rustup toolchain install stable
        rustup default stable
    else
        echo "Installing stable Rust with rustup..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
            | sh -s -- -y --profile minimal --default-toolchain stable
    fi

    hash -r
    current_version=$(cargo_version)
    if [[ -z $current_version ]] || ! version_ge "$current_version" "$required_version"; then
        echo "Cargo $required_version or newer is required, but found: ${current_version:-not installed}" >&2
        exit 1
    fi
}

ensure_modern_rust

tmpdir=$(mktemp -d)
cleanup() {
    rm -rf "$tmpdir"
}
trap cleanup EXIT

echo "Building unison-fsmonitor with Cargo..."
cargo install "${UNISON_FSMONITOR_CRATE:-unison-fsmonitor}" --locked --root "$tmpdir/root"

echo "Installing unison-fsmonitor to /usr/local/bin..."
sudo install -m 0755 "$tmpdir/root/bin/unison-fsmonitor" /usr/local/bin/unison-fsmonitor

if [[ ${UPDATE_WATCH_LIMITS:-0} == "1" ]]; then
    echo "Installing larger inotify limits..."
    sudo tee /etc/sysctl.d/99-unison-fsmonitor.conf >/dev/null <<'EOF'
fs.inotify.max_user_watches=1048576
fs.inotify.max_user_instances=1024
EOF
    sudo sysctl --system >/dev/null
fi

echo
echo "Installed:"
command -v unison
unison -version
command -v unison-fsmonitor
echo "Install complete."

cat <<'EOF'

Notes:
- This does not use apt source or deb-src repositories.
- /usr/local/bin must be visible in the SSH session that Unison starts on this host.
- unison-fsmonitor is not an interactive command. If you run it by hand, it will
  wait for Unison's stdin protocol and look stalled.
- watch mode requires unison-fsmonitor on both hosts, including the local Mac.
- Unison client and server versions must match. Ubuntu apt may install a
  different Unison version than Homebrew; use matching versions before debugging
  fsmonitor further.
- To raise Linux inotify watch limits during install, rerun with:
    UPDATE_WATCH_LIMITS=1 ./install-ubuntu-fsmonitor.sh
EOF
