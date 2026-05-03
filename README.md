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

Inside tmux, install plugins with `prefix + I`.

Key bindings:
- `|` / `_` — split pane horizontal/vertical
- `Tab` — cycle windows
- `+` — zoom pane
- `F12` — toggle key passthrough (for nested remote sessions)
- `M-Up` — enter copy mode (vi keys)
- `prefix + $` — renew environment variables in all panes
