#!/usr/bin/env zsh

target="${1:-${TMUX_PANE:-}}"

dev_setup="${DEV_SETUP:-}"
[[ -f "$dev_setup/dev/common.sh" ]] || dev_setup="$HOME/workspaces/dev-setup"
[[ -f "$dev_setup/dev/common.sh" ]] || exit 0

if [[ "$target" == %* ]]; then
    pane="$target"
else
    pane=$(tmux display-message -p -t "$target" '#{pane_id}' 2>/dev/null) || exit 0
fi

source "$dev_setup/dev/common.sh"
TNOTIFY_TMUX_PANE="$pane" tnotify
