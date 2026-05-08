# dev-setup

Shell utilities for managing a local dev environment with tmux and remote SSH desktops.

## Structure

```
dev-setup/
├── dev/
│   ├── common.sh       ← source this in your .zshrc
│   ├── macos.sh        ← macOS-specific setup (sources ~/.zshrc)
│   └── clouddesk.sh    ← CloudDesk setup with a red prompt scheme
├── tmux/
│   ├── tmux.conf       ← main tmux config
│   ├── tmux.remote.conf← remote session overrides
│   ├── yank.sh         ← clipboard helper (pbcopy/xclip/OSC52)
│   └── renew_env.sh    ← renew env vars in live panes
└── bin/setups/
    └── work-example    ← example work script, copy and customize
```

## Setup

Add to your `.zshrc`:
```zsh
source ~/**/dev-setup/dev/common.sh
```

Set your workspace paths in `common.sh`:
```zsh
export DEV_WS="$HOME/workspaces/"           # multi-package workspace
export MR_WS="$HOME/workspaces/MonoRepo"    # mono repo
```

## Commands

| Command | Description |
|---------|-------------|
| `ws [dir]` | cd into a package under `DEV_WS` (tab-complete) |
| `mr [dir]` | cd into a directory under `MR_WS` (directories only, tab-complete) |
| `sync_command <host> [dest]` | rsync current directory to a remote SSH host |
| `start_tmux_session <name> <cmd>` | create/replace a tmux session running a command |
| `work [--host <host>]` | open workspace/terminal/ssh tmux sessions |
| `cleanup` | kill all dev tmux sessions |
| `bye` | cleanup + kill tmux server |

## Work Scripts

Copy `bin/setups/work-example` and customize it for your project:

```zsh
./bin/setups/work-example          # runs setup() by default
./bin/setups/work-example <fn>     # call any function directly
```

Each work script sources `common.sh` and defines a `setup()` that calls `work` + `sync_command` for the relevant packages.

## Tmux

Install [TPM](https://github.com/tmux-plugins/tpm) first:
```bash
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
```

Then symlink or copy the config files:
```bash
ln -sf $(pwd)/tmux/tmux.conf ~/.tmux.conf
ln -sf $(pwd)/tmux/yank.sh ~/.tmux/yank.sh
ln -sf $(pwd)/tmux/renew_env.sh ~/.tmux/renew_env.sh
ln -sf $(pwd)/tmux/tmux.remote.conf ~/.tmux/tmux.remote.conf
```

### Plugins

The config uses the following TPM plugins:

| Plugin | Description |
|--------|-------------|
| [tmux-battery](https://github.com/tmux-plugins/tmux-battery) | Battery status in the status bar |
| [tmux-prefix-highlight](https://github.com/tmux-plugins/tmux-prefix-highlight) | Highlights when prefix key is active |
| [tmux-online-status](https://github.com/tmux-plugins/tmux-online-status) | Online/offline indicator |
| [tmux-sidebar](https://github.com/tmux-plugins/tmux-sidebar) | Directory tree sidebar (`prefix + t`) — requires `tree` (`sudo dnf install -y tree`) |
| [tmux-copycat](https://github.com/tmux-plugins/tmux-copycat) | Regex search in copy mode |
| [tmux-open](https://github.com/tmux-plugins/tmux-open) | Open highlighted file/URL (`xdg-open` required) |
| [tmux-plugin-sysstat](https://github.com/samoshkin/tmux-plugin-sysstat) | CPU/MEM stats in the status bar |
| [tmux-resurrect](https://github.com/tmux-plugins/tmux-resurrect) | Save/restore sessions across restarts |
| [tmux-continuum](https://github.com/tmux-plugins/tmux-continuum) | Auto-save sessions every 5 minutes |
| [tmux-assistant-resurrect](https://github.com/timvw/tmux-assistant-resurrect) | AI-aware session restore |

Install all plugins inside tmux with `prefix + I`. TPM will clone and load them automatically.

### Session Persistence

The config includes [tmux-resurrect](https://github.com/tmux-plugins/tmux-resurrect) and [tmux-continuum](https://github.com/tmux-plugins/tmux-continuum) for automatic session save/restore across tmux server restarts.

- Sessions auto-save every 5 minutes
- Last saved session auto-restores on tmux start
- Manual save: `prefix + M-s` | Manual restore: `prefix + M-r`

Key bindings:
- `|` / `_` — split pane horizontal/vertical
- `Tab` — cycle windows
- `+` — zoom pane
- `F12` — toggle key passthrough (for nested remote sessions)
- `M-Up` — enter copy mode (vi keys)
- `prefix + $` — renew environment variables in all panes

## Vim

Plugins are managed with [vim-plug](https://github.com/junegunn/vim-plug) (auto-installs on first launch). Symlink the vimrc:

```bash
ln -sf $(pwd)/dev/vimrc ~/.vimrc
```

Then install plugins:

```bash
vim +PlugInstall +qall
```

### Dependencies

Install [ripgrep](https://github.com/BurntSushi/ripgrep) for the `:Rg` fzf command:

```bash
# Amazon Linux 2023 (binary install)
curl -LO https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz
tar xzf ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz
sudo cp ripgrep-14.1.1-x86_64-unknown-linux-musl/rg /usr/local/bin/
rm -rf ripgrep-14.1.1-x86_64-unknown-linux-musl*

# macOS
brew install ripgrep

# Ubuntu / Debian
sudo apt install -y ripgrep

# Fedora / RHEL
sudo dnf install -y ripgrep
```

### fzf Key Bindings

| Key | Command | Description |
|-----|---------|-------------|
| `Ctrl-p` | `:Files` | Fuzzy find files in current directory |
| `Ctrl-f` | `:Rg` | Ripgrep across file contents |
| `\b` | `:Buffers` | Fuzzy switch between open buffers |

Inside the fzf popup:
- `Ctrl-j` / `Ctrl-k` — move down/up
- `Enter` — select
- `Esc` — cancel

### Other Useful fzf Commands

| Command | Description |
|---------|-------------|
| `:Lines` | Search lines in open buffers |
| `:History` | Recently opened files |
| `:GFiles` | Git-tracked files only |
| `:Commits` | Browse git commits |
