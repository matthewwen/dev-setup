#!/usr/bin/env bash
# Move the active pane to a workspace by name. Runs in a herdr popup.
# Usage: move-pane.sh [workspace-name]
# With no argument, list workspaces and prompt. A name that does not exist
# creates a new workspace. A number picks from the list.
set -euo pipefail

pane="${HERDR_ACTIVE_PANE_ID:-${HERDR_PANE_ID:-}}"
[[ -n "$pane" ]] || { echo "No active pane id in environment." >&2; sleep 2; exit 1; }

mapfile -t rows < <(herdr workspace list \
  | jq -r '.result.workspaces[] | "\(.workspace_id)\t\(.label)"')

target="${1:-}"
if [[ -z "$target" ]]; then
  echo "Move pane ${pane} to workspace:"
  i=1
  for row in "${rows[@]}"; do
    printf '  %d) %s\n' "$i" "${row#*$'\t'}"
    ((i++))
  done
  echo
  read -r -e -p "name or number (new name creates a workspace): " target
fi
[[ -n "$target" ]] || exit 0

if [[ "$target" =~ ^[0-9]+$ ]] && (( target >= 1 && target <= ${#rows[@]} )); then
  target="${rows[target-1]#*$'\t'}"
fi

id=""
for row in "${rows[@]}"; do
  if [[ "${row#*$'\t'}" == "$target" ]]; then
    id="${row%%$'\t'*}"
    break
  fi
done

if [[ -n "$id" ]]; then
  out=$(herdr pane move "$pane" --new-tab --workspace "$id" --focus)
else
  out=$(herdr pane move "$pane" --new-workspace --label "$target" --focus)
fi
echo "$out" | jq -r '.result.move_result.pane | "moved to \(.workspace_id) tab \(.tab_id)"' \
  || { echo "$out"; sleep 3; exit 1; }
