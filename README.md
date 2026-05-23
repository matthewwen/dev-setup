# dev-setup

Shell utilities for managing a local dev environment with tmux and remote SSH desktops.

## Structure

```
dev-setup/
├── dev/
│   ├── common.sh       ← source this in your .zshrc
│   ├── macos.sh        ← macOS-specific setup (sources ~/.zshrc)
│   ├── clouddesk.sh    ← CloudDesk setup with a red prompt scheme
│   └── vimrc           ← legacy vim config
├── nvim/
│   ├── install.sh      ← one-shot installer (nvim + deps + config)
│   ├── init.lua        ← bootstraps lazy.nvim + LazyVim
│   └── lua/            ← config and plugin specs
├── tmux/
│   ├── tmux.conf       ← main tmux config
│   ├── tmux.remote.conf← remote session overrides
│   ├── yank.sh         ← clipboard helper (pbcopy/xclip/OSC52)
│   ├── renew_env.sh    ← renew env vars in live panes
│   ├── claude-status.sh← Claude Code status line (context %)
│   └── codex-status.sh ← Codex tmux status segment (context %)
├── ghostty/
│   └── config          ← Ghostty terminal config
│   └── renew_env.sh    ← renew env vars in live panes
├── unison/
│   ├── README.md       ← local/remote Unison setup instructions
│   └── dev-sync.prf    ← example Unison sync profile
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
ln -sf $(pwd)/tmux/codex-status.sh ~/.tmux/codex-status.sh
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

## Claude Code

Symlink the status line script:
```bash
ln -sf $(pwd)/tmux/claude-status.sh ~/.tmux/claude-status.sh
```

Then add the `statusLine` config to `~/.claude/settings.json`:
```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.tmux/claude-status.sh",
    "refreshInterval": 10
  }
}
```

This displays a context window usage bar at the bottom of the Claude Code terminal:
```
ctx: 42% ▰▰▰▰▱▱▱▱▱▱
```

## Neovim (LazyVim)

Full IDE experience via [LazyVim](https://www.lazyvim.org/) — includes autocomplete, file explorer, fuzzy finder, git integration, and more.

### Install

```bash
./nvim/install.sh
```

This installs:
- Neovim 0.11.2+ (appimage on Linux, Homebrew on macOS)
- ripgrep, fd (for Telescope)
- tree-sitter CLI (static binary on Linux, Homebrew on macOS)
- Symlinks config to `~/.config/nvim` and bootstraps plugins

### Key Bindings

| Key | Action |
|-----|--------|
| `Space` | Leader key (shows which-key popup) |
| `Ctrl-p` | Find files (Telescope) |
| `Ctrl-f` | Search current buffer lines |
| `<leader>f` or `\f` | Live grep across project |
| `<leader>b` or `\b` | Switch buffers |
| `Ctrl-t` | New tab |
| `t` (in explorer) | Open file in new tab |
| `gcc` | Comment/uncomment line |
| `gc` (visual) | Comment/uncomment selection |
| `\|` | Vertical split |
| `_` | Horizontal split |
| `<leader>e` | Toggle file explorer (snacks) |
| `Ctrl-h/j/k/l` | Move between splits |
| `V` select + `J/K` | Move selected lines up/down |
| `Ctrl-d` / `Ctrl-u` | Half-page scroll (centered) |

### Config Structure

```
nvim/
├── install.sh            ← one-shot installer
├── init.lua              ← bootstraps lazy.nvim + LazyVim
├── lazyvim.json          ← LazyVim extras config
└── lua/
    ├── config/
    │   ├── options.lua   ← editor options (tabs, clipboard, OSC52)
    │   └── keymaps.lua   ← custom keybindings
    └── plugins/
        ├── colorscheme.lua ← dracula theme
        ├── editor.lua      ← telescope, snacks explorer, gitsigns
        ├── coding.lua      ← treesitter, LSP servers
        ├── comment.lua     ← gcc/gc commenting
        └── ui.lua          ← disabled plugins (noice, bufferline, etc.)
```

---

## Vim (legacy)

Plugins are managed with [vim-plug](https://github.com/junegunn/vim-plug) (auto-installs on first launch). Symlink the vimrc:

```bash
ln -sf $(pwd)/dev/vimrc ~/.vimrc
```

Then install plugins:

```bash
vim +PlugInstall +qall
```

### fzf Key Bindings

| Key | Command | Description |
|-----|---------|-------------|
| `Ctrl-p` | `:GFiles` | Fuzzy find git-tracked files |
| `Ctrl-f` | `:BLines` | Search lines in current buffer |
| `\f` | `:Rg` | Ripgrep across file contents |
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
## Unison

See `unison/README.md` for bidirectional local/remote sync setup.
