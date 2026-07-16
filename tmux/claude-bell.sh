#!/usr/bin/env bash
# Ring the terminal bell so tmux flags the window when Claude needs attention,
# but only when the pane is in the background. Wired to Claude Code hooks
# (Stop / PermissionRequest / Elicitation / Notification) via settings.json.
#
# Not inside a tmux session: nothing to flag, so leave quietly.
[ -n "$TMUX_PANE" ] || exit 0

# Only ring when this pane's window is not the active one (window_active == 0).
if [ "$(tmux display-message -p -t "$TMUX_PANE" '#{window_active}' 2>/dev/null)" = 0 ]; then
  tty="$(tmux display-message -p -t "$TMUX_PANE" '#{pane_tty}' 2>/dev/null)"
  [ -n "$tty" ] && printf '\a' > "$tty"
fi
exit 0
