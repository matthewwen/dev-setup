---
name: dev-setup
description: >-
  Use when working in the dev-setup repo or when someone references its shell
  environment — `common.sh`, `ws`/`mr` navigation, `work`/`start_tmux_session`
  tmux helpers, `sync_command`/`live_sync` remote sync, `tnotify`, git-worktree
  helpers (`git-to-worktree`), the `work-example` template, or the tmux/nvim
  configs. Also use to explain how a person sets this up in their `.zshrc`
  (`DEV_WS`/`MR_WS`/`DEV_SETUP`), and how it relates to the personal work
  scripts (`work-gym`/`work-rl`/…) that live under `$MR_WS`.
---

# dev-setup — shareable zsh dev environment

`dev-setup` is the **public/shareable** layer of the local dev environment:
zsh functions + tmux/nvim/ghostty configs. No build system, no tests, no package
manager — everything is sourced into the shell. Anyone can clone it, set three
env vars, and get `ws`/`mr` navigation, tmux session management, and remote sync.

Personal, project-specific automation (the `work-gym`/`work-rl`/`work-rm`/
`work-web` scripts) lives in a **separate private repo** under `$MR_WS`, not
here. This repo ships only a `work-example` template showing the pattern. See
**Bridge to $MR work scripts** below.

## Layout

```
dev-setup/
├── dev/
│   ├── common.sh        ← THE CORE. Source this in .zshrc. All shell functions.
│   ├── macos.sh         ← sources common.sh + macOS prompt/colors
│   ├── clouddesk.sh     ← CloudDesk setup (red prompt scheme)
│   ├── vimrc            ← legacy vim config
│   └── vscode/          ← VS Code settings/keybindings
├── bin/setups/
│   └── work-example     ← copy → customize into your own work script
├── tmux/                ← tmux.conf, remote overrides, yank/status helpers
├── nvim/                ← LazyVim config + install.sh
├── ghostty/, unison/, codex/, claude/  ← terminal / sync / assistant configs
└── skills/dev-setup/    ← this skill
```

## Setup (what a new person does)

Three env vars must be set **before** sourcing `common.sh`, in `.zshrc` or in
`~/.devsetuprc` (which `common.sh` auto-sources if present):

```zsh
export DEV_WS="$HOME/workspaces/MegaT/src"   # multi-package workspace root
export MR_WS="$HOME/workspaces/<you>/MyScripts"  # YOUR mono repo — where your work scripts live
export DEV_SETUP="$HOME/.../dev-setup"       # this repo (auto-detected if unset)
source "$DEV_SETUP/dev/common.sh"            # or dev/macos.sh on macOS
# put YOUR work scripts on PATH so they're runnable as bare commands:
export PATH="$MR_WS/bin/setups:$PATH"
```

`_devsetuprc_set KEY VAL` persists a value into `~/.devsetuprc` (used e.g. to
remember `WORK_HOST`).

**The `$MR_WS` convention:** every user keeps their own work scripts in their
own mono repo at `$MR_WS` — this is what `mr` navigates to, and its
`bin/setups/` is what goes on `PATH`. `dev-setup` is the shared substrate you
*source*; you never add your personal scripts here. To start yours, copy this
repo's `work-example` into `$MR_WS/bin/setups/` and customize it (see below).

## What common.sh provides

**Navigation** (zsh tab-completion wired via `compdef`):
- `ws [pkg]` — cd to `$DEV_WS/<pkg>` (follows symlinks to the real checkout).
- `mr [dir]` — cd to `$MR_WS/<dir>`.
- `_common` is the shared impl; `mr_path <dir>` echoes the resolved path.

**tmux sessions:**
- `start_tmux_session <name> [cmd...]` — create/replace a session running `cmd`
  (kills existing unless name is `workspace`/`hub`).
- `start_tmux_target`, `start_tmux_hub` — lower-level window/hub variants.
- `workspace` / `hub` / `tmp` / `remote-hub <name>` — attach to named sessions.
- `work [--host <h>] [--port <p>]` — the default entry point (opens sessions;
  remembers `WORK_HOST` in `~/.devsetuprc`). **Overridable** — see CUSTOM_WORK.
- `cleanup` — kill all sessions except `workspace`. `bye` — cleanup + sleep/exit.

**Remote sync (rsync over ssh):**
- `sync_command <host> [dest]` — one-shot rsync of cwd → `host:dest`
  (default dest `$DEV_WS/<cwd-basename>`), excluding `.git`/`build`/`node_modules`/
  `.venv`/`__pycache__`/`target`/etc. Drops `${USER}_git_{log,status}.txt` alongside.
- `live_sync <host> [dest]` — initial sync then `fswatch` loop re-syncing on change
  (needs `brew install fswatch`).
- `sync_dir <host> <dir>` — background tmux session that re-syncs every 600s.

**Notifications:**
- `tnotify [cmd...]` — run `cmd`, then ring the tmux bell on its pane (or ring
  immediately if no args). Skips `claude`.
- Auto-bell: a zsh `preexec`/`precmd` hook rings the bell for any command that
  runs longer than `TNOTIFY_THRESHOLD` (default 10s; `0` disables). Interactive
  commands (`vim`, `less`, `ssh`, `claude`, …) are skipped.

**Git worktrees** (operate on `.claude/worktrees/<name>`):
- `git-add-worktree <name> [ref]`, `git-rm-worktree <name>`.
- `git-to-worktree <name>` — stash-commit current work, hard-reset the worktree
  to the current branch (moves WIP into the worktree).
- `git-from-worktree <name>` — reverse: pull the worktree's state back.
- `git-set-commit-today` — amend HEAD's date to now.
- Completion for these is wired to the worktree dir names.

**Editing work scripts:**
- `edit <script>` / `edit-vscode <script>` — open a work script in nvim / VS Code
  (tab-completes the script names). Resolution order is `$DEV_SETUP/bin/setups/`
  then `$DEV_SETUP_HOME/bin/setups/`. If the script exists in neither, `edit`
  creates it in `$DEV_SETUP_HOME/bin/setups/` from a template and `chmod +x` it.
  `$DEV_SETUP_HOME` is this repo, auto-detected from the path of `common.sh`, and
  `common.sh` appends its `bin/setups` to `PATH` so new scripts run immediately.
- `ws_path [pkg]` / `mr_path [dir]` — like `ws`/`mr` but *echo* the resolved
  path instead of cd'ing (for `$(ws_path pkg)` command substitution).

**Auto-completion for `work-*` scripts:** on source, `common.sh` loops over
`work-*` in both setup dirs and, for each, generates a `compdef` that greps
the script's top-level `func()` definitions (skipping `_`-prefixed ones) so
`work-myproject <TAB>` completes its subcommands. This is why any function you
add to a work script is completable with no extra wiring.

**Review comments:** `mdreview` runs `nginx/scripts/mdreview.py`. It lists,
adds, replies to, and resolves comments on rendered Markdown. The `md-review`
skill covers how an agent answers them.

**Misc:** `alias vi=nvim`, `alias vim=nvim`.

## The CUSTOM_WORK override (important)

`common.sh` only defines the default `work`/`parse_work_args` **if `CUSTOM_WORK`
is unset**. Personal work scripts (in `$MR_WS`) set `CUSTOM_WORK=1` before
sourcing so they can define their own `work`/`setup`. So: dev-setup ships a
sensible default `work`; a power user's mono-repo overrides it.

## work-example template

`bin/setups/work-example` is the copy-me starting point. **Copy it into your own
`$MR_WS/bin/setups/`** — don't add personal scripts to dev-setup:

```zsh
cp "$DEV_SETUP/bin/setups/work-example" "$MR_WS/bin/setups/work-myproject"
```

```zsh
#!/usr/bin/env zsh
source $(dirname $0)/../../dev/common.sh
SSH_HOST="ssh-desktop"
setup() { work --host $SSH_HOST; sleep 2; (ws pkg1; ws pkg2; wait); }
if [ -z $1 ]; then setup; else $@; fi
```

Pattern: source `common.sh`, define functions, and the trailer dispatches —
bare invocation runs `setup`, else `$@` runs the named function. Functions
defined here are auto-completed by `common.sh`.

## Bridge to $MR work scripts

The real per-project drivers live in the **private mono repo** at `$MR_WS`
(e.g. `bin/setups/work-gym`, `work-rl`, `work-rm`, `work-web`). They:

1. `source .../dev/common.sh` (this repo's core) — often via a mono-repo
   `common.sh` that sets `CUSTOM_WORK=1` and re-sources this one.
2. Define project functions (CDK deploys, k8s setup, integ tests, …).
3. End with the same dispatch trailer: `if [[ -z "$@" ]]; then setup; else eval "$@"; fi`.

So `work-gym cdk-wandb-redo` = source helpers → `eval 'cdk-wandb-redo'`. Those
scripts are documented by a separate **`work-scripts`** skill (they are personal
and not shipped in dev-setup). This repo is the shareable substrate; `$MR_WS` is
where individuals build on top of it.

## Configs (sourced/symlinked, not shell functions)

Beyond `common.sh`, the repo ships editor/terminal/sync configs. They're
independent — adopt any subset:

- **`tmux/`** — `tmux.conf` (symlink to `~/.tmux.conf`) supports nested
  local/remote sessions; **F12 toggles key passthrough** to the inner session.
  `tmux.remote.conf` auto-loads over SSH. `yank.sh` = cross-platform clipboard
  (pbcopy/xclip/xsel/OSC52). `renew_env.sh` pushes updated env into live panes.
  `claude-status.sh` / `codex-status.sh` render the assistant context-% status
  segment. Plugins via TPM (`prefix + I` to install).
- **`nvim/`** — LazyVim config; `install.sh` is a one-shot installer
  (nvim + deps + config). `vi`/`vim` alias to `nvim`.
- **`ghostty/`**, **`dev/vscode/`** — terminal / editor settings.
- **`unison/`** — bidirectional sync profile (`dev-sync.prf`) + setup README;
  the two-way alternative to the one-way `sync_command`/`live_sync` rsync.
- **`codex/`**, **`claude/`** — assistant hooks/config (e.g. `codex/hooks.json`
  rings `tnotify` on Stop).

## Conventions

- Work scripts: `#!/usr/bin/env zsh`; tmux/other helpers: `#!/usr/bin/env bash`.
- Section headers are `# ===…===` comment blocks.
- No build/test tooling — validate changes by sourcing in a shell and running
  the function. Keep it zsh-portable (macOS + Linux/CloudDesk).
- `DEV_SETUP`/`DEV_WS`/`MR_WS` are the only required config; prefer reading them
  over hardcoding paths.
