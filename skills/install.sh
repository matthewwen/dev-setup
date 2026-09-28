#!/usr/bin/env bash
set -euo pipefail

SKILLS_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

mkdir -p "$TARGET_DIR"
for src in "$SKILLS_DIR"/*/; do
    src="${src%/}"
    [ -f "$src/SKILL.md" ] || continue
    name="$(basename "$src")"
    target="$TARGET_DIR/$name"
    if [ -e "$target" ] && [ ! -L "$target" ]; then
        echo "Backing up $target -> $target.bak"
        mv "$target" "$target.bak"
    fi
    ln -sfn "$src" "$target"
    echo "Linked $target -> $src"
done
echo "Restart Claude Code to pick up new skills."
