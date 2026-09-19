# herdr

[herdr](https://github.com/herdrdev/herdr) keeps terminal coding agents running
and observable across disconnects and restarts.

## Install

```bash
./herdr/install.sh
```

The script installs the binary when it is missing, links `config.toml` to
`~/.config/herdr/config.toml`, validates it, and reloads a running server.

## Keybindings

`config.toml` mirrors `tmux/tmux.conf`. Prefix is `ctrl+b`.

| Action | Key | tmux |
|---|---|---|
| Split side by side | `prefix \|` | `prefix \|` |
| Split stacked | `prefix _` | `prefix _` |
| Zoom pane | `prefix +` or `prefix z` | `prefix +` |
| Close pane | `prefix x` | `prefix x` |
| Focus pane | `prefix h/j/k/l` | arrows |
| Resize pane | `prefix ctrl+arrows` | `prefix ctrl+arrows` |
| Resize mode | `prefix alt+r` | n/a |
| Move pane to new tab | `prefix !` | `prefix !` |
| Move pane to workspace by name | `prefix .` | n/a |
| Join another tab's panes into this tab | `prefix @` | `join-pane` |
| Cycle pane layout | `prefix space` | `prefix space` |
| New tab | `prefix c` | `prefix c` (window) |
| Rename tab | `prefix r` | `prefix r` |
| Close tab | `prefix X` | `prefix X` |
| Switch tab | `prefix 1..9`, `prefix n/p` | same |
| Rename workspace | `prefix R` | `prefix R` (session) |
| Close workspace | `prefix Q` | `prefix Q` |
| Detach | `prefix d` | `prefix d` |
| Toggle sidebar | `prefix b` or `prefix ctrl+s` | `prefix ctrl+s` (status) |
| Reload config | `prefix ctrl+r` | `prefix ctrl+r` |
| Edit config | `prefix ctrl+e` | `prefix ctrl+e` |

`select-layout.sh <layout>` also takes an explicit layout: `tiled`,
`even-horizontal`, `even-vertical`, `main-vertical`, or `main-horizontal`.

Not mapped: tmux `prefix Tab` (last window) has no herdr equivalent.
herdr defaults stay for help (`prefix ?`), settings (`prefix s`), workspace
picker (`prefix w`), and new workspace (`prefix N`).
