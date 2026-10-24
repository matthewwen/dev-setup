#!/usr/bin/env zsh

_dev_setup_fzf_init() {
    local fzf_dir="${XDG_DATA_HOME:-$HOME/.local/share}/fzf"
    if [[ -x "$fzf_dir/bin/fzf" && ${path[(Ie)$fzf_dir/bin]} -eq 0 ]]; then
        path=("$fzf_dir/bin" $path)
    fi
    (( $+commands[fzf] )) || return 0
    [[ -o interactive ]] || return 0

    local integration
    if integration=$(fzf --zsh 2>/dev/null); then
        eval "$integration"
        return
    fi

    local dir
    for dir in /usr/share/fzf/shell /usr/share/fzf /usr/share/doc/fzf/examples "$HOME/.fzf/shell"; do
        if [[ -r "$dir/completion.zsh" && -r "$dir/key-bindings.zsh" ]]; then
            source "$dir/completion.zsh"
            source "$dir/key-bindings.zsh"
            return
        fi
    done
    print -u2 -- 'fzf: shell integration unavailable; run fzf-install to install a current version.'
    return 1
}

fzf-install() {
    case "$(uname -s)" in
        Darwin)
            if (( ! $+commands[brew] )); then
                print -u2 -- 'fzf: install Homebrew first: https://brew.sh'
                return 1
            fi
            brew install fzf || return
            ;;
        Linux)
            if (( ! $+commands[curl] )); then
                print -u2 -- 'fzf: curl is required (sudo apt install curl or sudo yum install curl).'
                return 1
            fi
            local fzf_dir="${XDG_DATA_HOME:-$HOME/.local/share}/fzf"
            local installer
            mkdir -p "$fzf_dir" || return
            installer=$(mktemp "$fzf_dir/install.XXXXXXXX") || return
            {
                curl -fsSL https://raw.githubusercontent.com/junegunn/fzf/master/install \
                    -o "$installer" || return
                bash "$installer" --bin || return
            } always {
                command rm -f -- "$installer"
            }
            ;;
        *)
            print -u2 -- 'fzf: supported platforms are macOS and Linux.'
            return 1
            ;;
    esac
    rehash
    _dev_setup_fzf_init
}

if [[ "$ZSH_EVAL_CONTEXT" == toplevel ]]; then
    fzf-install "$@"
else
    _dev_setup_fzf_init
fi
