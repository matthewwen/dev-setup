source $(dirname $0)/common.sh

# ==============================================================================
# Function to show last 5 directories (or fewer if higher up)
# ==============================================================================
setopt prompt_subst
prompt_pwd_short() {
  local p="${PWD/#$HOME/~}"   # substitute $HOME -> ~
  local -a parts
  parts=("${(@s:/:)p}")       # split path by "/"

  if (( ${#parts[@]} > 5 )); then
    echo ".../${(j:/:)parts[-5,-1]}"
  else
    echo "$p"
  fi
}

# ==============================================================================
# Terminal colours
# ==============================================================================
export CLICOLOR=1
export LSCOLORS=BxFxCxDxBxegedabagacad
export WORKSPACE=~/workspaces/mwenclubhouse

# ==============================================================================
# Terminal Text
# ==============================================================================
git_prompt_info() {
  # Are we inside a git repo?
  local branch
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || return
  echo " %F{yellow}($branch$dirty)%f"
}

export PROMPT='%F{208}[$(prompt_pwd_short)]%f
%F{red}%n%f$(git_prompt_info) %F{white}%#%f '
