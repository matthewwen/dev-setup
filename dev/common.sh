autoload -Uz compinit && compinit

export DEV_WS="$HOME/workspaces"
export MR_WS="$HOME/workspaces/MonoRepo"

# ==============================================================================
# ws
# ==============================================================================
_ws_completion() {
    local -a dirs
    dirs=($1/*(-/:t))
    _describe 'directories' dirs
}

ws() {
    local dir=$1
    if [ -z "$dir" ]; then
        cd $DEV_WS
    else
        local target=$DEV_WS/"$dir"
        if [ -L "$target" ]; then
            local curr=$target
            while [[ -L $curr ]]; do curr="$(realpath "$curr")"; done
            cd $curr
        else
            cd "$target"
        fi
    fi
}

compdef _ws_completion ws

# ==============================================================================
# mr - cd into a mono repo directory (directories only)
# ==============================================================================
_mr_completion() {
    local -a dirs
    dirs=(${(f)"$(find $MR_WS -mindepth 1 -maxdepth 1 -type d 2>/dev/null | xargs -n 1 basename)"})
    _describe 'directories' dirs
}

mr() {
    local dir=$1
    if [ -z "$dir" ]; then
        cd $MR_WS
    else
        cd $MR_WS/"$dir"
    fi
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

# ==============================================================================
# sync - rsync current directory to a remote SSH desktop
# Usage: sync_command <host> [dest]
# ==============================================================================
sync_command() {
    host=$1
    dest=${2:-"$DEV_WS/$(basename $(pwd -L))"}
    dest="${dest%/}"

    rm -rf mattwen_git_log.txt mattwen_git_status.txt
    git log > mattwen_git_log.txt
    git status > mattwen_git_status.txt

    rsync -av --progress --stats \
        --exclude ".git" \
        --exclude ".hatch" \
        --exclude ".ruff_cache" \
        --exclude "build" \
        --exclude "coverage" \
        --exclude ".venv" \
        --exclude ".mypy_cache" \
        --exclude "__pycache__" \
        -e ssh . "$host:${dest}"

    rm -rf mattwen_git_log.txt mattwen_git_status.txt
}

# ==============================================================================
# cleanup / bye
# ==============================================================================
cleanup() {
    tmux kill-session -t notebook 2>/dev/null &
    tmux kill-session -t terminal 2>/dev/null &
    tmux kill-session -t pod 2>/dev/null &
    tmux kill-session -t pod-dev 2>/dev/null &
    tmux ls 2>/dev/null | grep "sync" | awk '{print substr($1, 0, length($1))}' | while read line; do tmux kill-session -t $line; done
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

# ==============================================================================
# get path of pkg / mono repo
# ==============================================================================
ws_path() {
    ws $1
    pwd -L
}

mr_path() {
    mr $1
    pwd -L
}
