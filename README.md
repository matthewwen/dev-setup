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
├── codex/
│   └── hooks.json      ← Codex hooks (tnotify on Stop)
├── ghostty/
│   └── config          ← Ghostty terminal config
│   └── renew_env.sh    ← renew env vars in live panes
├── unison/
│   ├── README.md       ← local/remote Unison setup instructions
│   └── dev-sync.prf    ← example Unison sync profile
└── bin/setups/
    ├── work-example    ← example work script, copy and customize
    └── ...             ← scripts created by `edit`, added to PATH
```

## Setup

Add to your `.zshrc`:
```zsh
source ~/**/dev-setup/dev/common.sh
```

Set your workspace paths (in `.zshrc`, before sourcing):
```zsh
export DEV_WS="$HOME/workspaces/"              # multi-package workspace
export MR_WS="$HOME/workspaces/MyScripts"      # YOUR mono repo — your work scripts live here
export PATH="$MR_WS/bin/setups:$PATH"          # make your work scripts bare-runnable
```

## nginx

This nginx setup gives local agent work a browsable, searchable webroot:

- file explorer with content and filename search
- raw files plus rendered Markdown, JSON, Jupyter notebooks, text, and Inspect
  AI eval logs
- authenticated file create, edit, directory creation, and deletion through
  `/__api/files`
- a persistent Explorer API managed by `nginx-explorer.service`

Turn both services off when the machine is busy, and back on later:

```zsh
nginxctl off      # stop and disable nginx and the explorer API
nginxctl on       # enable and start both
nginxctl status
```

## Herdr

[Herdr](https://github.com/herdrdev/herdr) keeps terminal-based coding agents
running and observable across disconnects and restarts. Install it and link
the tmux-style keybindings in `herdr/config.toml` with:

```bash
./herdr/install.sh
```

## Commands

| Command | Description |
|---------|-------------|
| `ws [dir]` | cd into a package under `DEV_WS` (tab-complete) |
| `mr [dir]` | cd into a directory under `MR_WS` (directories only, tab-complete) |
| `sync_command <host> [dest]` | rsync current directory to a remote SSH host |
| `start_tmux_session <name> <cmd>` | create/replace a tmux session running a command |
| `work [--host <host>]` | open workspace/terminal/ssh tmux sessions |
| `cleanup` | kill all dev tmux sessions; on macOS, save tmux state first for tmux-resurrect |
| `bye` | cleanup + kill tmux server |
| `edit <work-script>` | edit a work script; creates it in `bin/setups` if absent |
| `nginxctl on\|off\|restart\|status` | manage the nginx web server and explorer API |

## Work Scripts

This repo ships `bin/setups/work-example` as a template only. Copy it into
**your own** `$MR_WS/bin/setups/` and customize it per project:

```zsh
cp bin/setups/work-example "$MR_WS/bin/setups/work-myproject"
work-myproject           # runs setup() by default
work-myproject <fn>      # call any function directly
```

Each work script sources `common.sh` and defines a `setup()` that calls `work` + `sync_command` for the relevant packages. With `$MR_WS/bin/setups` on `PATH`, they're runnable as bare commands.

### Scaffold a new work script

`edit` opens a work script. If the script does not exist, `edit` creates it from
a template, makes it executable, and registers its tab-completion:

```zsh
edit work-hello          # creates bin/setups/work-hello in THIS repo, then opens it
work-hello hello         # runnable immediately — no new shell needed
work-hello               # no args runs setup()
```

`edit` never overwrites an existing script. It searches `$DEV_SETUP/bin/setups`
first, then this repo, and opens the first match. Use `edit-vscode` to open in
VS Code.

The generated script sources `$(dirname $0)/../../dev/common.sh`, exports
`PYTHONPATH`, and defines a placeholder `setup()`:

```zsh
#!/usr/bin/env zsh
source $(dirname $0)/../../dev/common.sh

export PYTHONPATH=${PYTHONPATH}

hello() {
    echo "hello from ${ZSH_ARGZERO:t} in $(pwd -L)"
}

setup() {
    echo "setup work script"
}

if [ -z $1 ]; then
    setup
else
    $@
fi
```

`DEV_WS`, `MR_WS`, and `CUSTOM_WORK` reach the script through the environment,
because your shell exports them. A script launched from a shell that never
sourced your setup (cron, for example) sees them empty, so `ws`/`mr` will not
resolve there.

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

## Codex

Symlink the Codex hooks config:
```bash
mkdir -p ~/.codex
ln -sf $(pwd)/codex/hooks.json ~/.codex/hooks.json
```

The `Stop` hook calls `tnotify` after each Codex turn, which sends a tmux bell when Codex is waiting for your next response.

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
