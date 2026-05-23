#!/usr/bin/env bash
set -u

codex_home="${CODEX_HOME:-$HOME/.codex}"
state_db="$codex_home/state_5.sqlite"
log_file="$codex_home/log/codex-tui.log"
models_cache="$codex_home/models_cache.json"
bar_width="${CODEX_STATUS_BAR_WIDTH:-10}"

is_int() {
  case "${1:-}" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

sql_quote() {
  printf "%s" "$1" | sed "s/'/''/g"
}

active_cmd=$(tmux display-message -p '#{pane_current_command}' 2>/dev/null || true)
case "$active_cmd" in
  codex|node) ;;
  *) exit 0 ;;
esac

[ -r "$state_db" ] || exit 0
[ -r "$log_file" ] || exit 0

cwd=$(tmux display-message -p '#{pane_current_path}' 2>/dev/null || true)
thread_row=""
if [ -n "$cwd" ]; then
  cwd_sql=$(sql_quote "$cwd")
  thread_row=$(sqlite3 "$state_db" \
    "select id || char(9) || coalesce(model, '') || char(9) || rollout_path from threads where cwd = '$cwd_sql' and archived = 0 order by updated_at_ms desc limit 1;" \
    2>/dev/null || true)
fi

if [ -z "$thread_row" ]; then
  thread_row=$(sqlite3 "$state_db" \
    "select id || char(9) || coalesce(model, '') || char(9) || rollout_path from threads where archived = 0 order by updated_at_ms desc limit 1;" \
    2>/dev/null || true)
fi

thread_id=${thread_row%%	*}
rest=${thread_row#*	}
model=${rest%%	*}
rollout_path=${rest#*	}
[ -n "$thread_id" ] || exit 0

if [ -r "$rollout_path" ]; then
  token_row=$(tail -n 2000 "$rollout_path" 2>/dev/null \
    | jq -r '
      select(.type == "event_msg" and .payload.type == "token_count")
      | [
          (.payload.info.last_token_usage.input_tokens // empty),
          (.payload.info.model_context_window // empty)
        ]
      | select(length == 2)
      | @tsv
    ' 2>/dev/null \
    | tail -n 1)

  if [ -n "$token_row" ]; then
    input_tokens=${token_row%%	*}
    context_window=${token_row#*	}
    if is_int "$input_tokens" && is_int "$context_window" && [ "$context_window" -gt 0 ]; then
      pct=$(( (input_tokens * 100 + context_window / 2) / context_window ))
      bar_pct=$pct
      [ "$bar_pct" -gt 100 ] && bar_pct=100

      filled=$(( bar_pct * bar_width / 100 ))
      empty=$(( bar_width - filled ))
      bar=""
      for ((i = 0; i < filled; i++)); do bar+="▰"; done
      for ((i = 0; i < empty; i++)); do bar+="▱"; done

      if [ "$pct" -gt 100 ]; then
        echo "ctx: >100% ${bar}"
      else
        echo "ctx: ${pct}% ${bar}"
      fi
      exit 0
    fi
  fi
fi

usage_line=$(grep "thread.id=$thread_id" "$log_file" 2>/dev/null \
  | grep 'codex.turn.token_usage.input_tokens=' \
  | tail -n 1)

if [ -z "$usage_line" ]; then
  usage_line=$(grep 'codex.turn.token_usage.input_tokens=' "$log_file" 2>/dev/null | tail -n 1)
fi

input_tokens=$(printf "%s\n" "$usage_line" \
  | sed -n 's/.*codex\.turn\.token_usage\.input_tokens=\([0-9][0-9]*\).*/\1/p')
[ -n "$input_tokens" ] || exit 0

if [ -z "$model" ]; then
  model=$(printf "%s\n" "$usage_line" | sed -n 's/.* model=\([^ ]*\) .*/\1/p')
fi

context_window="${CODEX_CONTEXT_WINDOW:-}"
if ! is_int "$context_window"; then
  context_window=""
  if [ -r "$models_cache" ] && [ -n "$model" ]; then
    context_window=$(jq -r --arg model "$model" \
      '.models[] | select(.slug == $model) | ([.context_window, .max_context_window] | map(select(type == "number")) | max) // empty' \
      "$models_cache" 2>/dev/null)
  fi
fi

if ! is_int "$context_window" || [ "$context_window" -le 0 ]; then
  echo "ctx: ${input_tokens}t"
  exit 0
fi

if [ -r "$models_cache" ] && [ "$input_tokens" -gt "$context_window" ]; then
  global_context_window=$(jq -r '[.models[].max_context_window | select(type == "number")] | max // empty' \
    "$models_cache" 2>/dev/null)
  if is_int "$global_context_window" && [ "$global_context_window" -gt "$context_window" ]; then
    context_window="$global_context_window"
  fi
fi

pct=$(( (input_tokens * 100 + context_window / 2) / context_window ))
bar_pct=$pct
[ "$bar_pct" -gt 100 ] && bar_pct=100

filled=$(( bar_pct * bar_width / 100 ))
empty=$(( bar_width - filled ))
bar=""
for ((i = 0; i < filled; i++)); do bar+="▰"; done
for ((i = 0; i < empty; i++)); do bar+="▱"; done

if [ "$pct" -gt 100 ]; then
  echo "ctx: >100% ${bar}"
else
  echo "ctx: ${pct}% ${bar}"
fi
