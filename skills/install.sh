#!/usr/bin/env bash
set -euo pipefail

SKILLS_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIRS=(
    "${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
    "${CODEX_SKILLS_DIR:-${CODEX_HOME:-$HOME/.codex}/skills}"
)

for target_dir in "${TARGET_DIRS[@]}"; do
    mkdir -p "$target_dir"
    for src in "$SKILLS_DIR"/*/; do
        src="${src%/}"
        [ -f "$src/SKILL.md" ] || continue
        name="$(basename "$src")"
        target="$target_dir/$name"
        if [ -e "$target" ] && [ ! -L "$target" ]; then
            echo "Backing up $target -> $target.bak"
            mv "$target" "$target.bak"
        fi
        ln -sfn "$src" "$target"
        echo "Linked $target -> $src"
    done
done
echo "Restart Claude Code or Codex to pick up new skills."
