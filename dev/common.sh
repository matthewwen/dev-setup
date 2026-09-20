autoload -Uz compinit && compinit

# ============================================================================
# set DEV_WS, MR_WS, and DEV_SETUP via ~/.zshrc or init caller script
#
# export DEV_WS=...
# export MR_WS=...
# export DEV_SETUP=...
# source $HOME/.../dev-setup/dev/macos.sh
# ============================================================================

# Source user config if it exists
[ -f "$HOME/.devsetuprc" ] && source "$HOME/.devsetuprc"

# ==============================================================================
# common setup for ws and mr
# ==============================================================================
_common() {
    local loc=$1
    local dir=$2
    if [ -z "$dir" ]; then
        cd $loc
    else
        local target=$loc/"$dir"
        if [ -L "$target" ]; then
            local curr=$target
            while [[ -L $curr ]]; do
                curr="$(realpath "$curr")"
            done
            cd $curr
        else
            cd "$target"
        fi
    fi
}

_devsetuprc_set() {
    local key="$1" val="$2"
    [[ -z "$val" ]] && return
    local rc="$HOME/.devsetuprc"
    export "$key=$val"
    if grep -q "^${key}=" "$rc"; then
        sed -i '' "s|^${key}=.*|${key}=${val}|" "$rc"
    else
        echo "${key}=${val}" >>"$rc"
    fi
}

_common_completion() {
    local -a dirs
    dirs=($1/*(-/:t))
    _describe 'directories' dirs
}

ws() {
    _common $DEV_WS "$@"
}

_ws_completion() {
    _common_completion $DEV_WS
}

compdef _ws_completion ws

mr() {
    _common $MR_WS "$@"
}

_mr_completion() {
    _common_completion $MR_WS
}

compdef _mr_completion mr

ws_path() {
    ws $1
    pwd -L
}

compdef _ws_completion ws_path

mr_path() {
    mr $1
    pwd -L
}

compdef _mr_completion mr_path

workspace() {
    start_tmux_session "workspace"
    tmux a -t workspace
}

hub() {
    start_tmux_session "hub"
    tmux a -t hub
}

agent() {
    tmux a -t agent
}

tmp() {
    start_tmux_session "local" mr
    tmux a -t local
}

remote-hub() {
    local hub_name="$1"
    start_tmux_session $hub_name ssh $WORK_HOST
    tmux a -t $hub_name
}

alias vi=nvim
alias vim=nvim

# ==============================================================================
# git worktrees update
# ==============================================================================
_mw-git-branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null
}

_git-tmp-save() {
    if git diff --cached --quiet; then
        git add .
        git commit -m "tmp"
    else
        git commit -m "tmp"
    fi
}

git-add-worktree() {
    local dir=${1}
    _git-tmp-save
    git worktree add .claude/worktrees/${dir} ${2}
}

git-rm-worktree() {
    local wt=${1}
    shift 1
    git worktree remove .claude/worktrees/${wt} $@
}

git-to-worktree() {
    local wt=${1}
    local branch=$(_mw-git-branch)
    local wt_dir=.claude/worktrees/${wt}
    _git-tmp-save
    local did_commit=$?
    (
        [[ ! -d $wt_dir ]] && git-add-worktree $wt
        cd $wt_dir
        git reset --hard ${branch}
    )
    if [[ $did_commit -eq 0 ]]; then
        git reset HEAD~1
        (cd $wt_dir && git reset HEAD~1)
    fi
}

git-from-worktree() {
    local wt=${1}
    (cd .claude/worktrees/${wt} && _git-tmp-save)
    local did_commit=$?
    git reset --hard ${wt}
    if [[ $did_commit -eq 0 ]]; then
        git reset HEAD~1
        (cd .claude/worktrees/${wt} && git reset HEAD~1)
    fi
}

_git_wt_completion() {
    local wt_dir=".claude/worktrees"
    [[ -d "$wt_dir" ]] || return
    compadd -- ${wt_dir}/*(:t)
}
compdef _git_wt_completion git-rm-worktree git-to-worktree git-from-worktree

git-set-commit-today() {
    GIT_COMMITTER_DATE="$(date)" git commit --amend --no-edit --date "now"
}

# ==============================================================================
# tmux
# ==============================================================================
start_tmux_target() {
    session_name=$1
    target=$2
    shift 2
    command="$@"
    if tmux has-session -t $session_name 2>/dev/null; then
        if [[ -n $command ]]; then
            tmux new-window -a -t $session_name -n $target
        fi
    else
        tmux new-session -d -s $session_name -n $target
    fi
    if [[ -n $command ]]; then
        tmux send-keys -t "${session_name}:${target}" "$command" "ENTER"
    fi
}

start_tmux_session() {
    session_name=$1
    shift 1
    if [[ $session_name != "workspace" && $session_name != "hub" ]]; then
        tmux kill-session -t $session_name 2>/dev/null
    fi
    start_tmux_target $session_name $session_name "$@"
}

start_tmux_hub() {
    start_tmux_target "hub" "$@"
}

# ==============================================================================
# tnotify - notify via tmux bell when a command finishes (or immediately)
# Usage: tnotify cmd args...   — run cmd, then bell on inactive window
#        cmd1 && cmd2; tnotify — bell immediately (no command to run)
# ==============================================================================
tnotify() {
    local ret=0
    if [[ $# -gt 0 ]]; then
        "$@"
        ret=$?
    fi

    if [ -n "$TMUX" ] && [[ "${1:-}" != "claude" ]]; then
        local target_pane="${TNOTIFY_TMUX_PANE:-${TMUX_PANE:-}}"
        local pane_tty
        pane_tty=$(tmux display-message -p -t "$target_pane" '#{pane_tty}' 2>/dev/null) || pane_tty=
        [[ -n "$pane_tty" ]] && printf '\a' >"$pane_tty"
    fi

    return $ret
}

# ==============================================================================
# Auto-bell: notify via tmux bell when any command runs longer than threshold
# Set TNOTIFY_THRESHOLD to adjust (default 10 seconds). Set to 0 to disable.
# ==============================================================================
TNOTIFY_THRESHOLD=${TNOTIFY_THRESHOLD:-10}
zmodload zsh/datetime

_tnotify_preexec() {
    _tnotify_cmd_start=$EPOCHSECONDS
    _tnotify_cmd_name="${1%% *}"
}

_tnotify_precmd() {
    [[ -z "$_tnotify_cmd_start" ]] && return
    [[ -z "$TMUX" ]] && {
        unset _tnotify_cmd_start _tnotify_cmd_name
        return
    }
    [[ "$TNOTIFY_THRESHOLD" -eq 0 ]] && {
        unset _tnotify_cmd_start _tnotify_cmd_name
        return
    }

    local elapsed=$((EPOCHSECONDS - _tnotify_cmd_start))
    unset _tnotify_cmd_start

    # Skip interactive commands that the user is already watching
    case "$_tnotify_cmd_name" in
    vim | nvim | nano | less | more | man | top | htop | claude | ssh | tmux) return ;;
    esac
    unset _tnotify_cmd_name

    if ((elapsed >= TNOTIFY_THRESHOLD)); then
        local target_pane="${TNOTIFY_TMUX_PANE:-${TMUX_PANE:-}}"
        local pane_tty
        pane_tty=$(tmux display-message -p -t "$target_pane" '#{pane_tty}' 2>/dev/null) || pane_tty=
        [[ -n "$pane_tty" ]] && printf '\a' >"$pane_tty"
    fi
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _tnotify_preexec
add-zsh-hook precmd _tnotify_precmd

# ==============================================================================
# sync - rsync current directory to a remote SSH desktop
# Usage: sync_command <host> [dest]
#
# for liv_sync, install fswatch via brew install fswatch
# ==============================================================================
sync_command() {
    host=$1
    dest=${2:-"$DEV_WS/$(basename $(pwd -L))"}
    dest="${dest%/}"

    rm -rf ${USER}_git_log.txt ${USER}_git_status.txt
    git log >${USER}_git_log.txt
    git status >${USER}_git_status.txt

    rsync -av --progress --stats \
        --delete \
        --exclude ".git" \
        --exclude ".hatch" \
        --exclude ".ruff_cache" \
        --exclude "build" \
        --exclude "node_modules" \
        --exclude "Cargo.lock" \
        --exclude "target" \
        --exclude "coverage" \
        --exclude ".venv" \
        --exclude ".mypy_cache" \
        --exclude "__pycache__" \
        -e ssh . "$host:${dest}"

    rm -rf ${USER}_git_log.txt ${USER}_git_status.txt
}

live_sync() {
    host=$1
    dest=${2:-"$DEV_WS/$(basename "$(pwd -L)")"}
    dest="${dest%/}"

    # brew install fswatch
    sync_command $host $dest
    eval "fswatch -o . \
      --exclude='\.git/' \
      --exclude='node_modules/' \
      --exclude='\.venv/' \
      --exclude='__pycache__/' \
      --exclude='${USER}_git_log.txt' \
      --exclude='${USER}_git_status.txt' \
      --exclude='build/' \
      --exclude='coverage/' \
    | while read -r _; do
        echo "Change detected, syncing..."
        sync_command $host $dest
      done
    "
}

sync_dir() {
    local host="$1"
    local dir="$2"
    local name=$(basename $(pwd -L))
    start_tmux_session "sync-$name" "while true; do (sync_command $host $dir && sleep 600); done"
}

# ==============================================================================
# cleanup / bye
# ==============================================================================
cleanup() {
    (( $+functions[_cleanup_pre_hook] )) && _cleanup_pre_hook
    tmux ls 2>/dev/null | grep -v "workspace" | awk '{print substr($1, 0, length($1))}' | while read line; do tmux kill-session -t $line; done
    wait
}

bye() {
    cleanup
    pmset displaysleepnow
    exit
}

# ==============================================================================
# work
# ==============================================================================
if [[ -z "$CUSTOM_WORK" ]]; then
    parse_work_args() {
        unset WORK_HOST
        while [[ $# -gt 0 ]]; do
            case "$1" in
            --host)
                WORK_HOST="$2"
                shift 2
                ;;
            --port)
                PORT="$2"
                shift 2
                ;;
            *)
                echo "Unknown option: $1"
                return 1
                ;;
            esac
        done
        WORK_HOST=${WORK_HOST:-"clouddesk"}
        _devsetuprc_set WORK_HOST "$WORK_HOST"
    }

    work() {
        parse_work_args "$@"
        start_tmux_session workspace
    }

    _work_complete() {
        case "$words[-2]" in
        --host) compadd ssh-desktop ;;
        --port) compadd 8000 8001 8002 8003 8004 ;;
        *) compadd -- --host --port ;;
        esac
    }

fi

compdef _work_complete work
compdef _work_complete work-mr

# ==============================================================================
# autocomplete for work-* scripts in bin/setups/
#
# DEV_SETUP_HOME is this repo (the one that holds common.sh). DEV_SETUP is your
# own scripts repo, and defaults to this repo. `edit` creates new scripts under
# DEV_SETUP_HOME, and opens existing scripts from either repo.
# ==============================================================================
DEV_SETUP_HOME=$(mr_path)
if [[ -z ${DEV_SETUP} ]]; then
    DEV_SETUP=$DEV_SETUP_HOME
fi

WORK_SCRIPT_DIRS=()
[[ "$DEV_SETUP" != "$DEV_SETUP_HOME" ]] && WORK_SCRIPT_DIRS+=("$DEV_SETUP/bin/setups")
WORK_SCRIPT_DIRS+=("$DEV_SETUP_HOME/bin/setups")

if [[ ":$PATH:" != *":$DEV_SETUP_HOME/bin/setups:"* ]]; then
    export PATH="$PATH:$DEV_SETUP_HOME/bin/setups"
fi

# ==============================================================================
# nginx web server and explorer API: nginxctl on | off | restart | status
# ==============================================================================
# Resolve from this file, because DEV_SETUP_HOME can be a scripts repo that
# does not carry nginx/.
_NGINX_SERVICE_SH="${${(%):-%x}:A:h:h}/nginx/scripts/service.sh"
nginxctl() {
    "$_NGINX_SERVICE_SH" "$@"
}

_nginxctl_completion() {
    local -a actions
    actions=('on:enable and start nginx and the explorer API'
             'off:stop and disable both'
             'restart:restart both'
             'status:show service state and health')
    _describe 'action' actions
}
compdef _nginxctl_completion nginxctl

_register_work_completion() {
    local script=$1
    local base=$(basename $script)
    eval "_${base//-/_}_complete() {
        local funcs=(\$(grep -E '^[a-zA-Z_][a-zA-Z0-9_-]*[[:space:]]*\(\)' "$script" | awk -F'(' '{print \$1}' | grep -v '^_'))
        compadd \$funcs
    }
    "
    compdef "_${base//-/_}_complete" "$base"
}

for script in ${^WORK_SCRIPT_DIRS}/work-*(N); do
    _register_work_completion $script
done

_edit_completion() {
    local -a scripts
    scripts=(${^WORK_SCRIPT_DIRS}/*(N:t))
    scripts=(${(u)scripts})
    _describe 'work scripts' scripts
}

# ==============================================================================
# work script scaffolding
# `edit work-hello` opens the script. If it does not exist, create it in
# $DEV_SETUP_HOME/bin/setups, make it executable, and register its completion.
# ==============================================================================
_work_script_template() {
    cat <<'EOF'
#!/usr/bin/env zsh
source $(dirname $0)/../../dev/common.sh

export PYTHONPATH=${PYTHONPATH}

# ==============================================================================
# Add one function per task. Call them as: <script> <function> [args...]
# ==============================================================================
hello() {
    echo "hello from ${ZSH_ARGZERO:t} in $(pwd -L)"
}

setup() {
    echo "setup work script"
}

if [ -z $1 ]; then
    setup
else
    $@
fi

# vim: filetype=sh sw=4
EOF
}

_ensure_work_script() {
    local name="$1"
    if [[ -z "$name" ]]; then
        echo "usage: edit <work-script>" >&2
        return 1
    fi
    local dir
    for dir in $WORK_SCRIPT_DIRS; do
        if [[ -e "$dir/$name" ]]; then
            print -r -- "$dir/$name"
            return 0
        fi
    done
    local target="$DEV_SETUP_HOME/bin/setups/$name"
    mkdir -p "$DEV_SETUP_HOME/bin/setups"
    _work_script_template >"$target"
    chmod +x "$target"
    _register_work_completion "$target"
    rehash
    echo "created $target  (run: $name hello)" >&2
    print -r -- "$target"
}

edit() {
    local target
    target=$(_ensure_work_script "$1") || return 1
    vi "$target"
}

edit-vscode() {
    local target
    target=$(_ensure_work_script "$1") || return 1
    code "$target"
}

compdef _edit_completion edit
compdef _edit_completion edit-vscode

# ##########################################################################
# COLORS - colored echo helpers
#
# echo_red / echo_green / echo_orange / ... one line, any color.
# Run `echo_palette` to print every helper in its own color.
# Generic: echo_256 208 msg | echo_rgb 255 105 180 msg | echo_style '1;4;31' msg
# ##########################################################################

# Color is dropped when stdout is not a terminal or NO_COLOR is set.
# Set FORCE_COLOR to keep color through a pipe, e.g. for `less -R`.
_echo_color() {
    local code="$1"
    shift
    if { [ -t 1 ] || [ -n "$FORCE_COLOR" ]; } && [ -z "$NO_COLOR" ]; then
        printf '\033[%sm%s\033[0m\n' "$code" "$*"
    else
        printf '%s\n' "$*"
    fi
}

# --- generic: any SGR code, any 256-color index, any 24-bit rgb ------------
echo_style() { _echo_color "$@"; }                                    # echo_style '1;4;31' msg
echo_256() { local n="$1"; shift; _echo_color "38;5;$n" "$@"; }        # echo_256 208 msg
echo_bg256() { local n="$1"; shift; _echo_color "48;5;$n" "$@"; }      # echo_bg256 22 msg
echo_rgb() { local r="$1" g="$2" b="$3"; shift 3; _echo_color "38;2;$r;$g;$b" "$@"; }
echo_bgrgb() { local r="$1" g="$2" b="$3"; shift 3; _echo_color "48;2;$r;$g;$b" "$@"; }

# --- the 8 standard colors ------------------------------------------------
echo_black() { _echo_color '0;30' "$@"; }
echo_red() { _echo_color '0;31' "$@"; }
echo_green() { _echo_color '0;32' "$@"; }
echo_yellow() { _echo_color '0;33' "$@"; }
echo_blue() { _echo_color '0;34' "$@"; }
echo_magenta() { _echo_color '0;35' "$@"; }
echo_cyan() { _echo_color '0;36' "$@"; }
echo_white() { _echo_color '0;37' "$@"; }

# --- the 8 bright colors --------------------------------------------------
echo_bright_black() { _echo_color '0;90' "$@"; }
echo_bright_red() { _echo_color '0;91' "$@"; }
echo_bright_green() { _echo_color '0;92' "$@"; }
echo_bright_yellow() { _echo_color '0;93' "$@"; }
echo_bright_blue() { _echo_color '0;94' "$@"; }
echo_bright_magenta() { _echo_color '0;95' "$@"; }
echo_bright_cyan() { _echo_color '0;96' "$@"; }
echo_bright_white() { _echo_color '0;97' "$@"; }
echo_gray() { _echo_color '0;90' "$@"; }
echo_grey() { _echo_color '0;90' "$@"; }

# --- extended named colors (256-color palette) ----------------------------
echo_orange() { _echo_color '38;5;208' "$@"; }
echo_amber() { _echo_color '38;5;214' "$@"; }
echo_gold() { _echo_color '38;5;220' "$@"; }
echo_peach() { _echo_color '38;5;216' "$@"; }
echo_salmon() { _echo_color '38;5;209' "$@"; }
echo_coral() { _echo_color '38;5;203' "$@"; }
echo_crimson() { _echo_color '38;5;160' "$@"; }
echo_maroon() { _echo_color '38;5;88' "$@"; }
echo_brown() { _echo_color '38;5;130' "$@"; }
echo_tan() { _echo_color '38;5;180' "$@"; }
echo_khaki() { _echo_color '38;5;143' "$@"; }
echo_olive() { _echo_color '38;5;100' "$@"; }
echo_lime() { _echo_color '38;5;118' "$@"; }
echo_chartreuse() { _echo_color '38;5;82' "$@"; }
echo_forest() { _echo_color '38;5;28' "$@"; }
echo_mint() { _echo_color '38;5;121' "$@"; }
echo_teal() { _echo_color '38;5;30' "$@"; }
echo_turquoise() { _echo_color '38;5;44' "$@"; }
echo_aqua() { _echo_color '38;5;51' "$@"; }
echo_sky() { _echo_color '38;5;117' "$@"; }
echo_azure() { _echo_color '38;5;33' "$@"; }
echo_steel() { _echo_color '38;5;67' "$@"; }
echo_slate() { _echo_color '38;5;103' "$@"; }
echo_navy() { _echo_color '38;5;18' "$@"; }
echo_indigo() { _echo_color '38;5;54' "$@"; }
echo_violet() { _echo_color '38;5;99' "$@"; }
echo_purple() { _echo_color '38;5;141' "$@"; }
echo_lavender() { _echo_color '38;5;183' "$@"; }
echo_plum() { _echo_color '38;5;96' "$@"; }
echo_orchid() { _echo_color '38;5;170' "$@"; }
echo_pink() { _echo_color '38;5;205' "$@"; }
echo_rose() { _echo_color '38;5;211' "$@"; }
echo_hotpink() { _echo_color '38;5;198' "$@"; }
echo_silver() { _echo_color '38;5;250' "$@"; }
echo_charcoal() { _echo_color '38;5;238' "$@"; }

# --- text styles ----------------------------------------------------------
echo_bold() { _echo_color '1' "$@"; }
echo_dim() { _echo_color '2' "$@"; }
echo_italic() { _echo_color '3' "$@"; }
echo_underline() { _echo_color '4' "$@"; }
echo_blink() { _echo_color '5' "$@"; }
echo_reverse() { _echo_color '7' "$@"; }
echo_strike() { _echo_color '9' "$@"; }

# --- semantic wrappers ----------------------------------------------------
echo_err() { _echo_color '0;31' "$@" >&2; }
echo_warn() { _echo_color '38;5;208' "$@" >&2; }
echo_ok() { _echo_color '0;32' "$@"; }
echo_info() { _echo_color '0;36' "$@"; }
echo_debug() { _echo_color '0;90' "$@"; }
echo_header() { _echo_color '1;4;36' "$@"; }

# print every named helper in its own color
echo_palette() {
    local name
    for name in black red green yellow blue magenta cyan white \
        bright_black bright_red bright_green bright_yellow \
        bright_blue bright_magenta bright_cyan bright_white gray \
        orange amber gold peach salmon coral crimson maroon brown tan \
        khaki olive lime chartreuse forest mint teal turquoise aqua sky \
        azure steel slate navy indigo violet purple lavender plum orchid \
        pink rose hotpink silver charcoal \
        bold dim italic underline blink reverse strike; do
        "echo_$name" "echo_$name"
    done
}

# vim: sw=4
