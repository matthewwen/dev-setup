source $(dirname $0)/common.sh

# ==============================================================================
# Function to show last 5 directories (or fewer if higher up)
# ==============================================================================
setopt prompt_subst
prompt_pwd_short() {
  local p="${PWD/#$HOME/~}"   # substitute $HOME → ~
  local -a parts
  parts=("${(@s:/:)p}")       # split path by "/"

  if (( ${#parts[@]} > 5 )); then
    echo ".../${(j:/:)parts[-5,-1]}"
  else
    echo "$p"
  fi
}

# ==============================================================================
# macos util functions
# ==============================================================================
agent() {
    # example: ssh into a clouddesktop
    start_tmux_session agent ssh clouddesk || true
    tmux a -t agent
}

# Save tmux state before cleanup so tmux-resurrect can restore it later.
_cleanup_pre_hook() {
    local save="$HOME/.tmux/plugins/tmux-resurrect/scripts/save.sh"
    tmux ls &>/dev/null || return 0
    [[ -f "$save" ]] || return 0
    bash "$save" quiet 2>/dev/null || true
}


# ==============================================================================
# Terminal colours
# ==============================================================================
export CLICOLOR=1
export LSCOLORS=ExFxCxDxBxegedabagacad
export WORKSPACE=~/workspaces/mwenclubhouse

# ==============================================================================
# Terminal Text
# ==============================================================================
git_prompt_info() {
  # Are we inside a git repo?
  local branch
  branch=$(_mw-git-branch) || return
  echo " %F{yellow}($branch$dirty)%f"
}

export PROMPT='%F{blue}[$(prompt_pwd_short)]%f
%F{magenta}%n%f$(git_prompt_info) %F{cyan}%#%f '
