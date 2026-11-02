#!/usr/bin/env zsh

set -e

case "$(uname -s)" in
    Darwin)
        if (( ! $+commands[brew] )); then
            print -u2 -- 'visidata: install Homebrew first: https://brew.sh'
            exit 1
        fi
        brew install visidata || exit
        ;;
    Linux)
        if (( ! $+commands[pipx] )); then
            print -u2 -- 'visidata: install pipx first (sudo apt install pipx or sudo dnf install pipx).'
            exit 1
        fi
        pipx install visidata || exit
        pipx ensurepath || exit
        if [[ -n "$WAYLAND_DISPLAY" ]] && (( ! $+commands[wl-copy] )); then
            print -u2 -- 'visidata: install wl-clipboard for system clipboard support.'
            exit 1
        elif [[ -z "$WAYLAND_DISPLAY" ]] && (( ! $+commands[xclip] && ! $+commands[xsel] )); then
            print -u2 -- 'visidata: install xclip or xsel for system clipboard support.'
            exit 1
        fi
        ;;
    *)
        print -u2 -- 'visidata: supported platforms are macOS and Linux.'
        exit 1
        ;;
esac

config="$HOME/.visidatarc"
config_root="${XDG_CONFIG_HOME:-$HOME/.config}"
if [[ "$(uname -s)" == Darwin && -z "$XDG_CONFIG_HOME" ]]; then
    config_root="$HOME/Library/Preferences"
fi
if [[ -e "$config_root/visidata/config.py" ]]; then
    config="$config_root/visidata/config.py"
fi
python3 - "$config" "${0:A:h}/visidata.py" <<'PYTHON'
from pathlib import Path
import re
import sys

config = Path(sys.argv[1])
settings = Path(sys.argv[2]).read_text()
existing = config.read_text() if config.exists() else ''
pattern = r'(?ms)^def _dev_setup_visidata_clipboard\(\):\n.*?^_dev_setup_visidata_clipboard\(\)[ \t]*(?:\n|$)'
updated, count = re.subn(pattern, lambda match: settings, existing)
if not count:
    updated = existing + '\n' + settings
config.write_text(updated)
PYTHON
print -r -- "visidata: installed and configured system clipboard copying in $config"
