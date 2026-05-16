#!/usr/bin/env bash
data=$(cat)
pct=$(echo "$data" | jq -r '.context_window.used_percentage // 0' 2>/dev/null)
pct=${pct%.*}

filled=$(( pct / 10 ))
empty=$(( 10 - filled ))
bar=""
for ((i=0; i<filled; i++)); do bar+="▰"; done
for ((i=0; i<empty; i++)); do bar+="▱"; done

echo "ctx: ${pct}% ${bar}"
