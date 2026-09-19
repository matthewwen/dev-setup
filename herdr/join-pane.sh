#!/usr/bin/env bash
# Join the panes of another tab into the active pane's tab, like tmux join-pane.
# Usage: join-pane.sh [tab-number-or-label] [right|down]
# With no argument, list the other tabs in the workspace and prompt.
set -euo pipefail

pane="${HERDR_ACTIVE_PANE_ID:-${HERDR_PANE_ID:-}}"
[[ -n "$pane" ]] || { echo "No active pane id in environment." >&2; sleep 2; exit 1; }

panes_json=$(herdr pane list)
read -r target_tab workspace < <(jq -r --arg p "$pane" \
  '.result.panes[] | select(.pane_id == $p) | "\(.tab_id) \(.workspace_id)"' <<<"$panes_json")
[[ -n "${target_tab:-}" ]] || { echo "Pane ${pane} not found." >&2; sleep 2; exit 1; }

mapfile -t rows < <(herdr tab list --workspace "$workspace" \
  | jq -r --arg t "$target_tab" \
    '.result.tabs[] | select(.tab_id != $t) | "\(.tab_id)\t\(.number)\t\(.label)\t\(.pane_count)"')
(( ${#rows[@]} )) || { echo "No other tabs in this workspace."; sleep 2; exit 0; }

src="${1:-}"
dir="${2:-right}"
if [[ -z "$src" ]]; then
  echo "Join panes into tab ${target_tab} from:"
  for row in "${rows[@]}"; do
    IFS=$'\t' read -r _ num label count <<<"$row"
    printf '  %s) %s  (%s pane%s)\n' "$num" "$label" "$count" "$([[ $count == 1 ]] || echo s)"
  done
  echo
  read -r -e -p "tab number or label [direction right|down]: " src dir_in
  dir="${dir_in:-right}"
fi
[[ -n "$src" ]] || exit 0
[[ "$dir" == right || "$dir" == down ]] || { echo "direction must be right or down" >&2; sleep 2; exit 1; }

src_tab=""
for row in "${rows[@]}"; do
  IFS=$'\t' read -r id num label _ <<<"$row"
  if [[ "$src" == "$num" || "$src" == "$label" ]]; then src_tab="$id"; break; fi
done
[[ -n "$src_tab" ]] || { echo "No tab '${src}' in this workspace." >&2; sleep 2; exit 1; }

mapfile -t src_panes < <(jq -r --arg t "$src_tab" \
  '.result.panes[] | select(.tab_id == $t) | .pane_id' <<<"$panes_json")
for p in "${src_panes[@]}"; do
  herdr pane move "$p" --tab "$target_tab" --split "$dir" --target-pane "$pane" --no-focus >/dev/null
done
echo "joined ${#src_panes[@]} pane(s) from ${src_tab} into ${target_tab}"
