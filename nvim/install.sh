#!/usr/bin/env bash
set -euo pipefail

# Install Neovim + LazyVim config
# Usage: ./nvim/install.sh

NVIM_VERSION="${NVIM_VERSION:-v0.11.2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Install Neovim -----------------------------------------------------------

install_nvim_linux() {
  echo "Installing Neovim ${NVIM_VERSION} (Linux appimage)..."
  local tmp
  tmp=$(mktemp -d)
  curl -fsSL "https://github.com/neovim/neovim/releases/download/${NVIM_VERSION}/nvim-linux-x86_64.appimage" \
    -o "${tmp}/nvim.appimage"
  chmod +x "${tmp}/nvim.appimage"

  # AppImage needs FUSE; fall back to extracting if unavailable
  if "${tmp}/nvim.appimage" --version &>/dev/null; then
    sudo mv "${tmp}/nvim.appimage" /usr/local/bin/nvim
  else
    echo "FUSE unavailable, extracting appimage..."
    cd "${tmp}"
    ./nvim.appimage --appimage-extract &>/dev/null
    sudo rm -rf /usr/local/lib/nvim
    sudo mv squashfs-root /usr/local/lib/nvim
    sudo ln -sf /usr/local/lib/nvim/usr/bin/nvim /usr/local/bin/nvim
    cd -
  fi
  rm -rf "${tmp}"
}

install_nvim_macos() {
  echo "Installing Neovim via Homebrew..."
  brew install neovim
}

if command -v nvim &>/dev/null; then
  echo "Neovim already installed: $(nvim --version | head -1)"
else
  case "$(uname -s)" in
    Linux)  install_nvim_linux ;;
    Darwin) install_nvim_macos ;;
    *)      echo "Unsupported OS"; exit 1 ;;
  esac
fi

echo "nvim: $(nvim --version | head -1)"

# --- Dependencies -------------------------------------------------------------

install_deps() {
  if [[ "$(uname -s)" == "Linux" ]]; then
    # ripgrep (for telescope live_grep)
    if ! command -v rg &>/dev/null; then
      echo "Installing ripgrep..."
      local rg_ver="14.1.1"
      curl -fsSL "https://github.com/BurntSushi/ripgrep/releases/download/${rg_ver}/ripgrep-${rg_ver}-x86_64-unknown-linux-musl.tar.gz" \
        | tar xz --strip-components=1 -C /tmp "ripgrep-${rg_ver}-x86_64-unknown-linux-musl/rg"
      sudo mv /tmp/rg /usr/local/bin/rg
    fi

    # fd (for telescope find_files)
    if ! command -v fd &>/dev/null; then
      echo "Installing fd..."
      local fd_ver="10.2.0"
      curl -fsSL "https://github.com/sharkdp/fd/releases/download/v${fd_ver}/fd-v${fd_ver}-x86_64-unknown-linux-musl.tar.gz" \
        | tar xz --strip-components=1 -C /tmp "fd-v${fd_ver}-x86_64-unknown-linux-musl/fd"
      sudo mv /tmp/fd /usr/local/bin/fd
    fi
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    brew install ripgrep fd
  fi
}

install_deps

# tree-sitter CLI (required by nvim-treesitter)
if ! command -v tree-sitter &>/dev/null; then
  echo "Installing tree-sitter-cli..."
  if [[ "$(uname -s)" == "Darwin" ]]; then
    brew install tree-sitter
  else
    local ts_ver="0.25.5"
    curl -fsSL "https://github.com/tree-sitter/tree-sitter/releases/download/v${ts_ver}/tree-sitter-linux-x64.gz" \
      | gunzip > /tmp/tree-sitter
    chmod +x /tmp/tree-sitter
    sudo mv /tmp/tree-sitter /usr/local/bin/tree-sitter
  fi
fi

# --- Link config --------------------------------------------------------------

NVIM_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/nvim"

if [[ "$(readlink -f "${NVIM_CONFIG}" 2>/dev/null)" == "${SCRIPT_DIR}" ]]; then
  echo "Config already linked."
elif [[ -e "${NVIM_CONFIG}" ]]; then
  echo "Backing up existing config to ${NVIM_CONFIG}.bak"
  mv "${NVIM_CONFIG}" "${NVIM_CONFIG}.bak"
  ln -snf "${SCRIPT_DIR}" "${NVIM_CONFIG}"
else
  mkdir -p "$(dirname "${NVIM_CONFIG}")"
  ln -snf "${SCRIPT_DIR}" "${NVIM_CONFIG}"
fi

# --- Bootstrap plugins --------------------------------------------------------

echo "Bootstrapping LazyVim plugins (headless)..."
nvim --headless "+Lazy! sync" +qa 2>/dev/null || true

echo ""
echo "Done! Launch with: nvim"
echo ""
echo "First launch tips:"
echo "  - :Lazy       — plugin manager UI"
echo "  - :Mason      — LSP/formatter installer"
echo "  - <Space>     — leader key (shows which-key popup)"
echo "  - <C-p>       — find files"
echo "  - <C-f>       — search current buffer"
echo "  - <leader>f   — grep across project"
