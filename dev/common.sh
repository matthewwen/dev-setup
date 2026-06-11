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

workspace() {
    start_tmux_session "workspace"
    tmux a -t workspace
}

hub() {
    start_tmux_session "hub"
    tmux a -t hub
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
    tmux ls 2>/dev/null | grep -v "workspace" | awk '{print substr($1, 0, length($1))}' | while read line; do tmux kill-session -t $line; done
    wait
}

bye() {
    cleanup
    pmset displaysleepnow
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
# ==============================================================================
if [[ -z ${DEV_SETUP} ]]; then
    COMMON_PATH=$(dirname $0)
    DEV_SETUP=$(realpath $COMMON_PATH/..)
fi
for script in $DEV_SETUP/bin/setups/work-*; do
    local base=$(basename $script)
    eval "_${base//-/_}_complete() {
        local funcs=(\$(grep -E '^[a-zA-Z_][a-zA-Z0-9_-]*[[:space:]]*\(\)' "$script" | awk -F'(' '{print \$1}' | grep -v '^_'))
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

edit-vscode() {
    code $DEV_SETUP/bin/setups/$1
}

compdef _edit_completion edit
compdef _edit_completion edit-vscode

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
# vim: sw=4
