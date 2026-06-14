#!/usr/bin/env bash
data=$(cat)
pct=$(echo "$data" | jq -r '.context_window.used_percentage // 0' 2>/dev/null)
pct=${pct%.*}

filled=$(( pct / 10 ))
empty=$(( 10 - filled ))
bar=""
for ((i=0; i<filled; i++)); do bar+="▰"; done
for ((i=0; i<empty; i++)); do bar+="▱"; done

# Current working dir, trimmed to its last 5 path segments
cwd=$(echo "$data" | jq -r '.workspace.current_dir // .cwd // ""' 2>/dev/null)
cwd=${cwd/#$HOME/\~}
dir=""
if [ -n "$cwd" ]; then
  IFS='/' read -ra parts <<< "$cwd"
  segs=()
  for seg in "${parts[@]}"; do
    [ -n "$seg" ] && segs+=("$seg")
  done
  total=${#segs[@]}
  start=0
  (( total > 5 )) && start=$(( total - 5 ))
  for ((i=start; i<total; i++)); do
    dir+="/${segs[i]}"
  done
  if (( total > 5 )); then
    dir="…${dir}"
  elif [[ "$cwd" != /* ]]; then
    dir=${dir#/}
  fi
fi

if [ -n "$dir" ]; then
  echo "ctx: ${pct}% ${bar}  ${dir}"
else
  echo "ctx: ${pct}% ${bar}"
fi
