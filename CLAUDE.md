# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

Shell utilities for managing a local dev environment with tmux and remote SSH desktops. Everything is zsh — no build system, no tests, no package manager.

## Architecture

**`dev/common.sh`** is the core. It's sourced into the user's `.zshrc` and provides all shell functions: workspace navigation (`ws`, `mr`), tmux session management (`start_tmux_session`, `work`, `cleanup`, `bye`), and remote sync (`sync_command`, `live_sync`, `sync_dir`). It also wires up zsh tab-completion for all commands.

**`bin/setups/work-*`** scripts source `common.sh` and define project-specific `setup()` functions that compose `work` + `sync_command` calls. These are the user-facing entry points. Functions in these scripts are auto-completed by `common.sh`.

**`tmux/`** is a standalone tmux configuration. `tmux.conf` is the main config (symlinked to `~/.tmux.conf`). It supports nested local/remote sessions — F12 toggles key passthrough. `tmux.remote.conf` is auto-loaded over SSH. `yank.sh` handles cross-platform clipboard (pbcopy/xclip/xsel/OSC52). `renew_env.sh` pushes updated env vars into live panes.

**`dev/macos.sh`** sources `common.sh` and adds macOS-specific prompt/color setup. This is what gets sourced in `.zshrc` on macOS.

## Configuration

Three env vars must be set before sourcing (in `.zshrc` or `~/.devsetuprc`):
- `DEV_WS` — path to multi-package workspace root
- `MR_WS` — path to mono repo root
- `DEV_SETUP` — path to this repo (auto-detected from `common.sh` location if unset)

`~/.devsetuprc` is sourced automatically by `common.sh` if it exists. The `_devsetuprc_set` helper persists values there.

## Conventions

- Shell scripts use `#!/usr/bin/env zsh` (work scripts) or `#!/usr/bin/env bash` (tmux helpers).
- Section headers use `# ===...===` comment blocks.
- `sync_command` excludes `.git`, `node_modules`, `build`, `target`, `.venv`, `__pycache__`, and similar build artifacts via rsync `--exclude`.
- Tmux plugins are managed via TPM (`~/.tmux/plugins/tpm`). Plugin install: `prefix + I` inside tmux.
- The `CUSTOM_WORK` env var, if set, prevents `common.sh` from defining the default `work`/`parse_work_args` functions — allowing work scripts to override them.
