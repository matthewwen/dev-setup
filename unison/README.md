# Unison Sync

Bidirectional file sync between a local machine and a remote SSH server.

Unison runs from the local machine over SSH. The remote host does not need a
profile, but it does need SSH access and a compatible `unison` binary. Watch
mode also requires `unison-fsmonitor` on both machines.

## Quick Start

Install Unison on the local machine:

```sh
brew install unison
```

Verify the local tools:

```sh
command -v unison
unison -version
```

Verify SSH access to the remote host:

```sh
ssh <remote-host>
```

Create the local profile:

```sh
mkdir -p ~/.unison
cp unison/dev-sync.prf ~/.unison/dev-sync.prf
```

Edit `~/.unison/dev-sync.prf` and replace:

- `<local-path>` with the local directory to sync.
- `<remote-host>` with the SSH host alias or `user@host`.
- `<remote-path>` with the absolute remote directory to sync.

Create the remote directory:

```sh
ssh <remote-host> 'mkdir -p <remote-path>'
```

Run the first sync interactively:

```sh
unison dev-sync
```

Review the proposed changes, then press `g` to apply them.

## Remote Setup

Install Unison on the remote host with the platform package manager.

Ubuntu or Debian:

```sh
sudo apt-get update
sudo apt-get install unison
```

Fedora:

```sh
sudo dnf install unison
```

Arch:

```sh
sudo pacman -S unison
```

Verify the remote version:

```sh
ssh <remote-host> 'command -v unison && unison -version'
```

The local and remote Unison versions should match. If sync fails with a protocol
or archive-version error, install the same Unison version on both machines
before debugging anything else.

Check remote directory permissions:

```sh
ssh <remote-host> 'test -r <remote-path> && test -w <remote-path>'
```

## Watch Mode

The included profile uses:

```ini
repeat = watch+3600
```

This runs event-driven sync when possible and performs a full rescan every hour.
It requires `unison-fsmonitor` on both the local machine and the remote host.

On macOS:

```sh
brew install unison
cargo install unison-fsmonitor --locked
command -v unison-fsmonitor
```

On Ubuntu or Debian, copy this repo to the remote host and run:

```sh
./install-ubuntu-fsmonitor.sh
```

The installer installs Unison, installs or updates Rust if needed, builds the
Rust `unison-fsmonitor` helper, and places it in `/usr/local/bin`.

If watch mode fails with this error:

```text
No file monitoring helper program found
```

confirm the helper is visible in the SSH session that Unison starts:

```sh
command -v unison-fsmonitor
ssh <remote-host> 'command -v unison-fsmonitor'
```

If you do not need watch mode, change the profile to a polling interval:

```ini
repeat = 10
```

## Profile Behavior

`dev-sync.prf` is configured for unattended development sync:

```ini
auto = true
copyonconflict = true
confirmbigdel = false
fastcheck = false
prefer = newer
times = true
```

This means Unison applies non-conflicting changes automatically, keeps a copy of
the overwritten side on conflict, allows large deletes without prompting, uses
full file checks, prefers the newer file when resolving conflicts, and preserves
modification times.

The profile ignores common generated and local-only files, including:

- macOS metadata: `.DS_Store`
- Vim artifacts: `*.swp`, `*.swo`, `*.swn`, `*~`, `.netrwhist`, `Session.vim`
- JetBrains metadata: `.idea`, `*.iml`
- Python environments and caches: `.hatch`, `.venv`, `venv`, `env`,
  `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.tox`, `__pycache__`
- Python compiled files and packaging outputs: `*.pyc`, `*.pyo`, `*.pyd`,
  `*.egg-info`, `.eggs`, `pip-wheel-metadata`
- Node dependencies: `node_modules`
- Build and coverage outputs: `build`, `dist`, `out`, `site`, `htmlcov`,
  `target`, `.coverage`, `.coverage.*`
- Logs: `logs`, `log`, `*.log`

## Troubleshooting

If Unison cannot connect, confirm plain SSH works first:

```sh
ssh <remote-host>
```

If Unison reports a version or archive mismatch, compare both versions:

```sh
unison -version
ssh <remote-host> 'unison -version'
```

If file changes are not noticed in watch mode, check `unison-fsmonitor` on both
machines and make sure `/usr/local/bin` is on the remote non-interactive SSH
`PATH`.

For large trees on Linux, the default inotify limits may be too low. The Ubuntu
installer can raise them:

```sh
UPDATE_WATCH_LIMITS=1 ./install-ubuntu-fsmonitor.sh
```

Unison is bidirectional. Use `rsync` instead if you only want one-way copying.
