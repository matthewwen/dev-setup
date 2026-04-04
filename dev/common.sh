autoload -Uz compinit && compinit

export DEV_WS="$HOME/workspaces"
export MR_WS="$HOME/workspaces/MonoRepo"

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
    sed -i '' "s|^export ${key}=.*|export ${key}=\"${val}\"|" "$rc"
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

# ==============================================================================
# tmux
# ==============================================================================
start_tmux_session() {
    session_name=$1
    shift
    command="$@"
    if [[ $session_name != "workspace" ]]; then
        tmux kill-session -t $session_name 2>/dev/null
    fi
    tmux new-session -d -s $session_name && \
        tmux send-keys -t $session_name "$command" "ENTER"
}

workspace() {
    start_tmux_session "workspace" "cd $DEV_WS"
    tmux a -t workspace
}

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
    git log > ${USER}_git_log.txt
    git status > ${USER}_git_status.txt

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

# ==============================================================================
# cleanup / bye
# ==============================================================================
cleanup() {
    tmux ls 2>/dev/null | grep -v "workspace" | awk '{print substr($1, 0, length($1))}' | while read line; do tmux kill-session -t $line; done
    wait
}

bye() {
    cleanup
    tmux kill-server
    pmset displaysleepnow
}

# ==============================================================================
# work
# ==============================================================================
parse_work_args() {
    unset WORK_HOST
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --host) WORK_HOST="$2"; shift 2 ;;
            --port) PORT="$2";      shift 2 ;;
            *) echo "Unknown option: $1"; return 1 ;;
        esac
    done
    WORK_HOST=${WORK_HOST:-"ssh-desktop"}
    _devsetuprc_set WORK_HOST "$WORK_HOST"
}

work() {
    cleanup
    parse_work_args "$@"

    start_tmux_session workspace "cd $DEV_WS" &
    start_tmux_session terminal  "cd $DEV_WS" &
    start_tmux_session ssh       "ssh $WORK_HOST" &
    wait
}

_work_complete() {
    case "$words[-2]" in
        --host) compadd ssh-desktop ;;
        --port) compadd 8000 8001 8002 8003 8004 ;;
        *)      compadd -- --host --port ;;
    esac
}
compdef _work_complete work

# ==============================================================================
# autocomplete for work-* scripts in bin/setups/
# ==============================================================================
COMMON_PATH=$(dirname $0)
DEV_SETUP=$(realpath $COMMON_PATH/..)
for script in $DEV_SETUP/bin/setups/work-*; do
    local base=$(basename $script)
    eval "_${base//-/_}_complete() {
        local funcs=(\$(grep -E '^[a-zA-Z_][a-zA-Z0-9_-]*[[:space:]]*\(\)' "$script" | awk -F'(' '{print \$1}'))
        compadd \$funcs
    }
    "
    compdef "_${base//-/_}_complete" "$base"
done

_edit_completion() {
    local -a scripts
    scripts=($DEV_SETUP/bin/setups/*(:t))
    _describe 'work scripts' scripts
}

edit() {
    vi $DEV_SETUP/bin/setups/$1
}

compdef _edit_completion edit

# ==============================================================================
# get path of pkg / mono repo
# ==============================================================================
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